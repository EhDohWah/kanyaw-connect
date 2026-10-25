import { vi } from 'vitest'

/*
 * A stand-in for the Web Audio API (jsdom has none): an AudioContext whose analyser reports whatever loudness the test
 * sets, so the level meter and the waveform can be checked.
 */

export const audioState = {
  /** The RMS level the analyser reports now (0–1). */
  level: 0,
  contexts: [] as FakeAudioContext[],
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
  state: 'running' | 'suspended' | 'closed' = 'running'
  readonly currentTime = 0
  readonly destination = {}
  close = vi.fn(async () => {
    this.state = 'closed'
  })
  resume = vi.fn(async () => {
    this.state = 'running'
  })

  constructor() {
    audioState.contexts.push(this)
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
  vi.stubGlobal('AudioContext', FakeAudioContext)
  return audioState
}
