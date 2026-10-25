import { vi } from 'vitest'

/*
 * A stand-in for the Web Audio API (jsdom has none): an AudioContext whose analyser reports whatever loudness the test
 * sets, so the level meter and the waveform can be checked.
 */

export const audioState = {
  /** The RMS level the analyser reports now (0–1). */
  level: 0,
  contexts: [] as FakeAudioContext[],
  /** Every tone the ringer played: its frequencies, in order. */
  tones: [] as number[][],
  /** The state new contexts start in (`suspended`: the page has not been tapped yet). */
  startState: 'running' as 'running' | 'suspended',
  /** Whether `resume()` works (a browser refuses it until the person has tapped the page). */
  resumeWorks: true,
}

class FakeParam {
  readonly values: number[] = []
  setValueAtTime(value: number): this {
    this.values.push(value)
    return this
  }
  linearRampToValueAtTime(value: number): this {
    this.values.push(value)
    return this
  }
}

export class FakeOscillator {
  type = 'sine'
  readonly frequency = new FakeParam()
  connect(): void {}
  start(): void {
    audioState.tones.push(this.frequency.values)
  }
  stop(): void {}
}

export class FakeGain {
  readonly gain = new FakeParam()
  connect(): void {}
}

export class FakeAnalyserNode {
  fftSize = 2048
  getFloatTimeDomainData(buffer: Float32Array): void {
    // A square wave of the chosen amplitude has exactly that RMS.
    for (let i = 0; i < buffer.length; i++) buffer[i] = i % 2 === 0 ? audioState.level : -audioState.level
  }
  connect(): void {}
  disconnect(): void {}
}

export class FakeAudioContext {
  state: 'running' | 'suspended' | 'closed' = audioState.startState
  readonly currentTime = 0
  readonly destination = {}
  close = vi.fn(async () => {
    this.state = 'closed'
  })
  resume = vi.fn(async () => {
    if (audioState.resumeWorks) this.state = 'running'
  })

  constructor() {
    audioState.contexts.push(this)
  }

  createOscillator(): FakeOscillator {
    return new FakeOscillator()
  }

  createGain(): FakeGain {
    return new FakeGain()
  }

  createAnalyser(): FakeAnalyserNode {
    return new FakeAnalyserNode()
  }

  createMediaStreamSource(): { connect: (node: unknown) => void } {
    return { connect: () => undefined }
  }
}

export function useFakeAudio(): typeof audioState {
  audioState.level = 0
  audioState.contexts = []
  audioState.tones = []
  audioState.startState = 'running'
  audioState.resumeWorks = true
  vi.stubGlobal('AudioContext', FakeAudioContext)
  return audioState
}
