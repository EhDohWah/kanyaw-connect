import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useFakeAudio } from '@/__tests__/fakeAudio'
import { useFakeMicrophone } from '@/__tests__/fakeRecorder'
import {
  bucketWaveform,
  interruptRecording,
  MIC_CONSTRAINTS,
  micProblem,
  pickFormat,
  recordingSupported,
  useVoiceRecorder,
  VOICE_BITRATE,
  voiceFile,
  type VoiceRecorderOptions,
} from '@/composables/useVoiceRecorder'

let clock = 0

function host(options: VoiceRecorderOptions = {}) {
  let recorder!: ReturnType<typeof useVoiceRecorder>
  const wrapper = mount(
    defineComponent({
      setup() {
        recorder = useVoiceRecorder({ now: () => clock, ...options })
        return () => h('div')
      },
    }),
  )
  return { recorder, wrapper }
}

/** Lets time pass on the recording's clock and the sampling timer. */
async function pass(ms: number): Promise<void> {
  clock += ms
  await vi.advanceTimersByTimeAsync(ms)
}

beforeEach(() => {
  clock = 1000
  vi.useFakeTimers()
})

describe('choosing the format', () => {
  it('prefers MP4/AAC (it plays on iPhones too), then Opus in WebM, then Ogg', () => {
    expect(pickFormat(() => true)).toBe('audio/mp4;codecs=mp4a.40.2')
    expect(pickFormat((type) => type === 'audio/mp4')).toBe('audio/mp4')
    expect(pickFormat((type) => type.startsWith('audio/webm'))).toBe('audio/webm;codecs=opus')
    expect(pickFormat((type) => type.startsWith('audio/ogg'))).toBe('audio/ogg;codecs=opus')
    expect(pickFormat(() => false)).toBeNull()
  })

  it('records only where there is a recorder, a microphone, and a format it can make', () => {
    expect(recordingSupported()).toBe(false)

    useFakeMicrophone()
    expect(recordingSupported()).toBe(true)

    useFakeMicrophone({ supported: [] })
    expect(recordingSupported()).toBe(false)
  })

  it('names and types the file by its base type, without the codec, so the server can tell it is audio', () => {
    const blob = new Blob(['x'])
    expect(voiceFile(blob, 'audio/mp4;codecs=mp4a.40.2', 1773478800000)).toMatchObject({ name: 'voice-1773478800000.m4a', type: 'audio/mp4' })
    expect(voiceFile(blob, 'audio/webm;codecs=opus', 5)).toMatchObject({ name: 'voice-5.webm', type: 'audio/webm' })
    expect(voiceFile(blob, 'audio/ogg; codecs=opus', 5)).toMatchObject({ name: 'voice-5.ogg', type: 'audio/ogg' })
  })
})

describe('the waveform', () => {
  it('averages the levels into 48 bars, the loudest at 255', () => {
    const levels = Array.from({ length: 96 }, (_unused, i) => (i < 48 ? 0.1 : 0.2))
    const bars = bucketWaveform(levels)

    expect(bars).toHaveLength(48)
    expect(bars.slice(0, 24).every((bar) => bar === 128)).toBe(true)
    expect(bars.slice(24).every((bar) => bar === 255)).toBe(true)
  })

  it('a recording with fewer measurements than bars still fills every bar', () => {
    const bars = bucketWaveform([0.2, 0.1, 0.4])
    expect(bars).toHaveLength(48)
    expect(bars[0]).toBe(128)
    expect(bars[47]).toBe(255)
    expect(bars.every((bar) => Number.isInteger(bar) && bar >= 0 && bar <= 255)).toBe(true)
  })

  it('a quiet room is not blown up to full height', () => {
    expect(Math.max(...bucketWaveform(new Array(100).fill(0.005)))).toBeLessThan(30)
    expect(bucketWaveform([])).toEqual(new Array(48).fill(0))
  })

  it('the API takes 16–64 bars', () => {
    expect(bucketWaveform([0.1, 0.2], 16)).toHaveLength(16)
    expect(bucketWaveform([0.1, 0.2], 64)).toHaveLength(64)
  })
})

describe('recording', () => {
  it('asks for the microphone in mono with echo cancellation, and records at 32 kbps in the preferred format', async () => {
    const mic = useFakeMicrophone({ supported: ['audio/mp4', 'audio/webm;codecs=opus'] })
    useFakeAudio()
    const { recorder } = host()

    await recorder.start()

    expect(mic.getUserMedia).toHaveBeenCalledWith({ audio: MIC_CONSTRAINTS })
    expect(MIC_CONSTRAINTS).toEqual({ channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true })
    expect(mic.lastRecorder().options).toEqual({ mimeType: 'audio/mp4', audioBitsPerSecond: VOICE_BITRATE })
    expect(VOICE_BITRATE).toBe(32000)
    expect(recorder.state.value).toBe('recording')
  })

  it('times the recording by its own clock and shows the live level', async () => {
    useFakeMicrophone()
    const audio = useFakeAudio()
    const { recorder } = host()

    await recorder.start()
    audio.level = 0.15
    await pass(2000)

    expect(recorder.elapsedMs.value).toBe(2000)
    expect(recorder.level.value).toBeCloseTo(0.6)
  })

  it('stop: keeps the recording to listen to, with its length (from the clock, not the file) and its waveform', async () => {
    const mic = useFakeMicrophone()
    const audio = useFakeAudio()
    const { recorder } = host()

    await recorder.start()
    mic.lastRecorder().emit('chunk-1')
    audio.level = 0.1
    await pass(1500)
    audio.level = 0.3
    await pass(1500)
    await recorder.stop()

    const recording = recorder.recording.value!
    expect(recorder.state.value).toBe('preview')
    expect(recording.durationMs).toBe(3000)
    expect(recording.waveform).toHaveLength(48)
    expect(recording.waveform[0]).toBeLessThan(recording.waveform[47]!)
    expect(recording.file.type).toBe('audio/webm')
    expect(recording.file.name).toMatch(/^voice-\d+\.webm$/)
    expect(await recording.file.text()).toBe('chunk-1last')
    expect(recording.url).toBe('blob:preview')
  })

  it('turns the microphone off the moment recording stops, and closes the audio graph', async () => {
    const mic = useFakeMicrophone()
    const audio = useFakeAudio()
    const { recorder } = host()

    await recorder.start()
    await pass(1500)
    const stopping = recorder.stop()
    // Before the recorder has even handed over its last data.
    expect(mic.streams[0]!.tracks[0]!.stop).toHaveBeenCalled()
    expect(audio.contexts[0]!.close).toHaveBeenCalled()
    await stopping
  })

  it('a pause does not count toward the length', async () => {
    const mic = useFakeMicrophone()
    useFakeAudio()
    const { recorder } = host()

    await recorder.start()
    await pass(1000)
    mic.lastRecorder().pause()
    await pass(5000)
    mic.lastRecorder().resume()
    await pass(1000)
    await recorder.stop()

    expect(recorder.recording.value!.durationMs).toBe(2000)
  })

  it('under one second is dropped with a note', async () => {
    useFakeMicrophone()
    useFakeAudio()
    const { recorder } = host()

    await recorder.start()
    await pass(900)
    await recorder.stop()

    expect(recorder.state.value).toBe('idle')
    expect(recorder.recording.value).toBeNull()
    expect(recorder.problem.value).toBe('too-short')
  })

  it('at five minutes it stops by itself, keeps the recording and says so', async () => {
    const mic = useFakeMicrophone()
    useFakeAudio()
    const { recorder } = host()

    await recorder.start()
    await pass(5 * 60_000 + 200)

    expect(recorder.state.value).toBe('preview')
    expect(recorder.notice.value).toBe('limit')
    expect(recorder.recording.value!.durationMs).toBe(5 * 60_000)
    expect(mic.streams[0]!.tracks[0]!.stop).toHaveBeenCalled()
  })

  it('cancel throws it away and turns the microphone off', async () => {
    const mic = useFakeMicrophone()
    useFakeAudio()
    const { recorder } = host()

    await recorder.start()
    await pass(3000)
    recorder.cancel()

    expect(recorder.state.value).toBe('idle')
    expect(recorder.recording.value).toBeNull()
    expect(mic.streams[0]!.tracks[0]!.stop).toHaveBeenCalled()
  })

  it('take: stops if needed and hands the recording over to be sent', async () => {
    useFakeMicrophone()
    useFakeAudio()
    const { recorder } = host()

    await recorder.start()
    await pass(2500)
    const taken = await recorder.take()

    expect(taken?.durationMs).toBe(2500)
    expect(recorder.state.value).toBe('idle')
    expect(recorder.recording.value).toBeNull()
  })

  it('leaving the page (the composer going away) turns the microphone off', async () => {
    const mic = useFakeMicrophone()
    useFakeAudio()
    const { recorder, wrapper } = host()

    await recorder.start()
    wrapper.unmount()
    expect(mic.streams[0]!.tracks[0]!.stop).toHaveBeenCalled()
  })

  it('still records without Web Audio (a flat waveform)', async () => {
    useFakeMicrophone()
    vi.stubGlobal('AudioContext', undefined)
    const { recorder } = host()

    await recorder.start()
    await pass(2000)
    await recorder.stop()

    expect(recorder.recording.value!.durationMs).toBe(2000)
    expect(recorder.recording.value!.waveform).toEqual(new Array(48).fill(0))
  })
})

describe('interruptions keep what was recorded', () => {
  it('the microphone going away (permission taken back, a hidden tab) goes to the preview', async () => {
    const mic = useFakeMicrophone()
    useFakeAudio()
    const { recorder } = host()

    await recorder.start()
    await pass(2000)
    mic.streams[0]!.tracks[0]!.end()
    await vi.advanceTimersByTimeAsync(0)

    expect(recorder.state.value).toBe('preview')
    expect(recorder.notice.value).toBe('interrupted')
    expect(recorder.recording.value!.durationMs).toBe(2000)
  })

  it('the recorder failing does the same', async () => {
    const mic = useFakeMicrophone()
    useFakeAudio()
    const { recorder } = host()

    await recorder.start()
    await pass(1500)
    mic.lastRecorder().fail()
    await vi.advanceTimersByTimeAsync(0)

    expect(recorder.state.value).toBe('preview')
    expect(recorder.notice.value).toBe('interrupted')
  })

  it('a call coming in (interruptRecording) does the same', async () => {
    useFakeMicrophone()
    useFakeAudio()
    const { recorder } = host()

    await recorder.start()
    await pass(3000)
    interruptRecording()
    await vi.advanceTimersByTimeAsync(0)

    expect(recorder.state.value).toBe('preview')
    expect(recorder.notice.value).toBe('interrupted')
    expect(recorder.recording.value!.durationMs).toBe(3000)
  })

  it('an interruption after it stopped changes nothing', async () => {
    useFakeMicrophone()
    useFakeAudio()
    const { recorder } = host()

    await recorder.start()
    await pass(2000)
    await recorder.stop()
    interruptRecording()

    expect(recorder.notice.value).toBeNull()
  })
})

describe('a microphone that cannot be used', () => {
  it.each([
    ['NotAllowedError', 'blocked'],
    ['SecurityError', 'blocked'],
    ['NotFoundError', 'missing'],
    ['OverconstrainedError', 'missing'],
    ['NotReadableError', 'busy'],
    ['AbortError', 'busy'],
    ['TypeError', 'failed'],
  ])('%s: says "%s", and nothing is recording', async (name, problem) => {
    useFakeMicrophone({ refuse: name })
    useFakeAudio()
    const { recorder } = host()

    await recorder.start()

    expect(recorder.problem.value).toBe(problem)
    expect(recorder.state.value).toBe('idle')
  })

  it('reads the error name from anything thrown', () => {
    expect(micProblem({ name: 'NotAllowedError' })).toBe('blocked')
    expect(micProblem('nope')).toBe('failed')
  })

  it('cancelled while the browser was still asking: the microphone it then gives is turned off at once', async () => {
    const mic = useFakeMicrophone()
    useFakeAudio()
    let answer: (stream: unknown) => void = () => undefined
    const { FakeStream } = await import('@/__tests__/fakeRecorder')
    mic.getUserMedia.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)))
    const { recorder } = host()

    const starting = recorder.start()
    recorder.cancel()
    const stream = new FakeStream()
    answer(stream)
    await starting

    expect(stream.tracks[0]!.stop).toHaveBeenCalled()
    expect(recorder.state.value).toBe('idle')
  })
})
