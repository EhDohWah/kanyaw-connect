import { onBeforeUnmount, ref, shallowRef } from 'vue'

/*
 * Recording a voice message: the microphone, the recorder, the clock and the loudness along the way. Cheap to send on
 * slow mobile data: mono, 32 kbps. Nothing in here touches livekit-client, so the chat does not load the video library.
 */

/** In order of preference: MP4/AAC first, because it also plays on iPhones; then Opus in WebM (Chrome, Firefox) or Ogg. */
export const VOICE_FORMATS = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/ogg;codecs=opus'] as const
export const VOICE_BITRATE = 32_000
export const MIC_CONSTRAINTS: MediaTrackConstraints = { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
/** The longest voice message: recording stops here and keeps what it has. */
export const MAX_RECORDING_MS = 5 * 60_000
/** Shorter than this is a slip of the thumb, not a message. */
export const MIN_RECORDING_MS = 1_000
/** Bars in the waveform sent with the message (the API takes 16–64 values of 0–255). */
export const WAVEFORM_BARS = 48
/** How often the loudness is measured while recording. */
const SAMPLE_MS = 50
/** The recorder hands over what it has this often, so an interrupted recording keeps nearly all of it. */
const TIMESLICE_MS = 250

const EXTENSIONS: Record<string, string> = { 'audio/mp4': 'm4a', 'audio/webm': 'webm', 'audio/ogg': 'ogg' }

export type RecorderState = 'idle' | 'starting' | 'recording' | 'preview'
/** Why a recording could not start, or was not kept. */
export type RecorderProblem = 'blocked' | 'missing' | 'busy' | 'failed' | 'too-short'
/** Something to say about a recording that was kept: it reached the limit, or something stopped it. */
export type RecorderNotice = 'limit' | 'interrupted'

export interface Recording {
  file: File
  /** For listening before sending. */
  url: string
  durationMs: number
  waveform: number[]
}

/** The first format this browser's recorder can make, or null when it can make none of them. */
export function pickFormat(isSupported: (type: string) => boolean): string | null {
  return VOICE_FORMATS.find((type) => isSupported(type)) ?? null
}

/** Recording needs both the recorder and the microphone; where either is missing the button is not shown. */
export function recordingSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.MediaRecorder === 'function' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    pickFormat((type) => MediaRecorder.isTypeSupported(type)) !== null
  )
}

/**
 * The file to upload: named for its format, and typed with the base type (no `;codecs=`), which is what the server's
 * rule for telling audio from video in WebM and MP4 looks at.
 */
export function voiceFile(blob: Blob, mimeType: string, now: number = Date.now()): File {
  const base = (mimeType.split(';')[0] ?? '').trim().toLowerCase()
  return new File([blob], `voice-${now}.${EXTENSIONS[base] ?? 'webm'}`, { type: base })
}

/**
 * The loudness along the recording as `bars` values of 0–255: the measured levels (RMS, 0–1) averaged into equal
 * stretches and scaled so the loudest is 255. Near-silence is not blown up to full height.
 */
export function bucketWaveform(levels: readonly number[], bars: number = WAVEFORM_BARS): number[] {
  const n = levels.length
  if (n === 0) return new Array<number>(bars).fill(0)

  const averages = Array.from({ length: bars }, (_unused, i) => {
    const start = Math.min(n - 1, Math.floor((i * n) / bars))
    const end = Math.max(start + 1, Math.min(n, Math.floor(((i + 1) * n) / bars)))
    let sum = 0
    for (let j = start; j < end; j++) sum += levels[j] ?? 0
    return sum / (end - start)
  })

  // A quiet room should look quiet: anything under this is scaled as if this were the loudest.
  const peak = Math.max(0.05, ...averages)
  return averages.map((value) => Math.max(0, Math.min(255, Math.round((value / peak) * 255))))
}

/** What went wrong with the microphone, from the browser's error names. */
export function micProblem(error: unknown): Exclude<RecorderProblem, 'too-short'> {
  const name = error instanceof Error || (typeof error === 'object' && error !== null) ? (error as { name?: string }).name : undefined
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
    case 'PermissionDeniedError':
      return 'blocked'
    case 'NotFoundError':
    case 'OverconstrainedError':
    case 'DevicesNotFoundError':
      return 'missing'
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'busy'
    default:
      return 'failed'
  }
}

/** Recorders that are recording now, so something else (an incoming call) can stop them and keep what they have. */
const active = new Set<() => void>()

/** Stops any recording in progress and keeps it for listening (used when a call comes in). */
export function interruptRecording(): void {
  active.forEach((interrupt) => interrupt())
}

export interface VoiceRecorderOptions {
  maxMs?: number
  minMs?: number
  now?: () => number
}

/** One voice recording at a time, for the composer. */
export function useVoiceRecorder(options: VoiceRecorderOptions = {}) {
  const maxMs = options.maxMs ?? MAX_RECORDING_MS
  const minMs = options.minMs ?? MIN_RECORDING_MS
  const now = options.now ?? (() => performance.now())

  const state = ref<RecorderState>('idle')
  const elapsedMs = ref(0)
  /** The loudness right now, 0–1, for the level meter. */
  const level = ref(0)
  const recording = shallowRef<Recording | null>(null)
  const problem = ref<RecorderProblem | null>(null)
  const notice = ref<RecorderNotice | null>(null)

  let stream: MediaStream | null = null
  let recorder: MediaRecorder | null = null
  let audio: AudioContext | null = null
  let sampler: ReturnType<typeof setInterval> | undefined
  let chunks: Blob[] = []
  let levels: number[] = []
  let format = ''
  /** The recording's own clock: when it started, how long it was paused, and since when (if it is now). */
  let startedAt = 0
  let pausedMs = 0
  let pausedAt: number | null = null
  let stopping: Promise<void> | null = null
  /** A start that was overtaken (cancelled while the browser was still asking for the microphone). */
  let attempt = 0

  function clockMs(): number {
    if (!startedAt) return 0
    const end = pausedAt ?? now()
    return Math.max(0, end - startedAt - pausedMs)
  }

  /** Turns the microphone off at once, so the browser's recording sign goes away. */
  function release(): void {
    clearInterval(sampler)
    sampler = undefined
    stream?.getTracks().forEach((track) => track.stop())
    stream = null
    void audio?.close().catch(() => undefined)
    audio = null
    level.value = 0
    active.delete(interrupt)
  }

  function clearRecording(): void {
    if (recording.value) URL.revokeObjectURL(recording.value.url)
    recording.value = null
  }

  function measure(analyser: AnalyserNode, buffer: Float32Array<ArrayBuffer>): void {
    analyser.getFloatTimeDomainData(buffer)
    let sum = 0
    for (const sample of buffer) sum += sample * sample
    const rms = Math.sqrt(sum / buffer.length)
    levels.push(rms)
    // The meter moves a little more than the raw level, so ordinary speech is visible on it.
    level.value = Math.min(1, rms * 4)
    elapsedMs.value = clockMs()
    if (elapsedMs.value >= maxMs) void finish('limit')
  }

  /** Starts recording (asks for the microphone the first time). */
  async function start(): Promise<void> {
    if (state.value === 'starting' || state.value === 'recording') return
    clearRecording()
    problem.value = null
    notice.value = null
    elapsedMs.value = 0
    state.value = 'starting'
    const mine = ++attempt

    try {
      format = pickFormat((type) => MediaRecorder.isTypeSupported(type)) ?? ''
      const media = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS })
      if (mine !== attempt) {
        media.getTracks().forEach((track) => track.stop())
        return
      }
      stream = media

      chunks = []
      levels = []
      startedAt = 0
      pausedMs = 0
      pausedAt = null
      const next = new MediaRecorder(media, { ...(format ? { mimeType: format } : {}), audioBitsPerSecond: VOICE_BITRATE })
      recorder = next
      next.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) chunks.push(event.data)
      })
      next.addEventListener('start', () => {
        startedAt = now()
      })
      next.addEventListener('pause', () => {
        pausedAt = now()
      })
      next.addEventListener('resume', () => {
        if (pausedAt !== null) pausedMs += now() - pausedAt
        pausedAt = null
      })
      next.addEventListener('error', () => void finish('interrupted'))

      // The microphone going away (the permission taken back, the device unplugged, the browser stopping it in a hidden
      // tab) ends the recording, keeping what there is.
      for (const track of media.getAudioTracks()) track.addEventListener('ended', () => void finish('interrupted'))

      // The loudness, for the meter now and the waveform later.
      try {
        audio = new AudioContext()
        const analyser = audio.createAnalyser()
        analyser.fftSize = 1024
        audio.createMediaStreamSource(media).connect(analyser)
        const buffer = new Float32Array(analyser.fftSize)
        sampler = setInterval(() => measure(analyser, buffer), SAMPLE_MS)
      } catch {
        // No Web Audio: the recording still works, with a flat waveform.
        sampler = setInterval(() => {
          elapsedMs.value = clockMs()
          if (elapsedMs.value >= maxMs) void finish('limit')
        }, SAMPLE_MS)
      }

      next.start(TIMESLICE_MS)
      startedAt ||= now()
      active.add(interrupt)
      state.value = 'recording'
    } catch (error) {
      if (mine !== attempt) return
      release()
      recorder = null
      problem.value = micProblem(error)
      state.value = 'idle'
    }
  }

  /**
   * Stops the recorder and waits for its last data. Keeps the recording for listening when it is long enough; a
   * recording under a second is dropped with a note.
   */
  function finish(reason: RecorderNotice | null): Promise<void> {
    if (stopping) return stopping
    const current = recorder
    if (state.value !== 'recording' || !current) return Promise.resolve()

    const durationMs = Math.round(Math.min(clockMs(), maxMs))
    elapsedMs.value = durationMs
    const waveform = bucketWaveform(levels)

    stopping = new Promise<void>((resolve) => {
      const done = (): void => {
        recorder = null
        stopping = null
        if (durationMs < minMs) {
          problem.value = 'too-short'
          state.value = 'idle'
        } else {
          const type = current.mimeType || format || 'audio/webm'
          const file = voiceFile(new Blob(chunks, { type: (type.split(';')[0] ?? type).trim() }), type)
          recording.value = { file, url: URL.createObjectURL(file), durationMs, waveform }
          notice.value = reason
          state.value = 'preview'
        }
        chunks = []
        resolve()
      }
      if (current.state === 'inactive') done()
      else {
        current.addEventListener('stop', done, { once: true })
        current.stop()
      }
    })
    // The microphone is turned off now, not when the recorder has finished writing.
    release()
    return stopping
  }

  /** "Stop": keep the recording to listen to before sending. */
  function stop(): Promise<void> {
    return finish(null)
  }

  function interrupt(): void {
    void finish('interrupted')
  }

  /** Throws the recording away (while recording or after). */
  function cancel(): void {
    attempt++
    const current = recorder
    recorder = null
    stopping = null
    if (current && current.state !== 'inactive') current.stop()
    release()
    chunks = []
    clearRecording()
    notice.value = null
    elapsedMs.value = 0
    state.value = 'idle'
  }

  /**
   * The recording to send, stopping first if it is still going. Null when there is nothing to send (too short). The
   * composer takes it over: the preview link is not revoked here, the message it becomes keeps the file.
   */
  async function take(): Promise<Recording | null> {
    if (state.value === 'recording') await finish(null)
    const taken = recording.value
    if (!taken) return null
    // Revoked once the preview player has gone from the page, so it never asks for an address that no longer exists.
    setTimeout(() => URL.revokeObjectURL(taken.url), 0)
    recording.value = null
    notice.value = null
    state.value = 'idle'
    return taken
  }

  function dismissProblem(): void {
    problem.value = null
  }

  onBeforeUnmount(cancel)

  return { state, elapsedMs, level, recording, problem, notice, start, stop, cancel, take, interrupt, dismissProblem }
}
