import { vi } from 'vitest'

/*
 * Stand-ins for the browser's microphone and MediaRecorder (jsdom has neither), driven by the test: what the recorder
 * supports, what getUserMedia answers, and the microphone track ending by itself.
 */

export class FakeTrack extends EventTarget {
  kind = 'audio'
  readyState: 'live' | 'ended' = 'live'
  stop = vi.fn(() => {
    this.readyState = 'ended'
  })

  /** The browser ends the track by itself (permission taken back, device unplugged). */
  end(): void {
    this.readyState = 'ended'
    this.dispatchEvent(new Event('ended'))
  }
}

export class FakeStream {
  readonly tracks = [new FakeTrack()]
  getTracks(): FakeTrack[] {
    return this.tracks
  }
  getAudioTracks(): FakeTrack[] {
    return this.tracks
  }
}

export class FakeMediaRecorder extends EventTarget {
  static supported: string[] = ['audio/webm;codecs=opus', 'audio/webm']
  static instances: FakeMediaRecorder[] = []
  static isTypeSupported = vi.fn((type: string) => FakeMediaRecorder.supported.includes(type))

  state: 'inactive' | 'recording' | 'paused' = 'inactive'
  readonly mimeType: string
  timeslice: number | undefined

  constructor(
    readonly stream: FakeStream,
    readonly options: MediaRecorderOptions = {},
  ) {
    super()
    this.mimeType = options.mimeType ?? 'audio/webm'
    FakeMediaRecorder.instances.push(this)
  }

  start(timeslice?: number): void {
    this.timeslice = timeslice
    this.state = 'recording'
    this.dispatchEvent(new Event('start'))
  }

  /** Hands over a piece of the recording, as a real recorder does every `timeslice`. */
  emit(bytes: string): void {
    const event = new Event('dataavailable') as Event & { data: Blob }
    event.data = new Blob([bytes], { type: this.mimeType })
    this.dispatchEvent(event)
  }

  pause(): void {
    this.state = 'paused'
    this.dispatchEvent(new Event('pause'))
  }

  resume(): void {
    this.state = 'recording'
    this.dispatchEvent(new Event('resume'))
  }

  stop(): void {
    if (this.state === 'inactive') return
    this.state = 'inactive'
    // A real recorder delivers its last data, then "stop", a moment later.
    queueMicrotask(() => {
      this.emit('last')
      this.dispatchEvent(new Event('stop'))
    })
  }

  fail(): void {
    this.dispatchEvent(new Event('error'))
  }
}

export interface FakeMicrophone {
  getUserMedia: ReturnType<typeof vi.fn>
  streams: FakeStream[]
  lastRecorder: () => FakeMediaRecorder
}

/** Installs the fake recorder and microphone. `refuse` makes getUserMedia fail with that error name. */
export function useFakeMicrophone(options: { refuse?: string; supported?: string[] } = {}): FakeMicrophone {
  FakeMediaRecorder.instances = []
  FakeMediaRecorder.supported = options.supported ?? ['audio/webm;codecs=opus', 'audio/webm']
  const streams: FakeStream[] = []
  const getUserMedia = vi.fn(async () => {
    if (options.refuse) throw Object.assign(new Error(options.refuse), { name: options.refuse })
    const stream = new FakeStream()
    streams.push(stream)
    return stream
  })
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true })
  return {
    getUserMedia,
    streams,
    lastRecorder: () => {
      const recorder = FakeMediaRecorder.instances.at(-1)
      if (!recorder) throw new Error('no recorder was made')
      return recorder
    },
  }
}
