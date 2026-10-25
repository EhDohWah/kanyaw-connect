/*
 * A stand-in for BroadcastChannel (jsdom has none): every channel with the same name hears what the others post, as tabs
 * of one browser do, delivered on the next tick. A test makes several "tabs" by creating several of them.
 */

export class FakeBroadcastChannel {
  static open: FakeBroadcastChannel[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  closed = false
  readonly posted: unknown[] = []

  constructor(readonly name: string) {
    FakeBroadcastChannel.open.push(this)
  }

  postMessage(message: unknown): void {
    if (this.closed) throw new Error('The channel is closed.')
    this.posted.push(message)
    // Like the real thing: a copy, to the others with the same name only, not to itself.
    const copy = JSON.parse(JSON.stringify(message)) as unknown
    for (const other of FakeBroadcastChannel.open) {
      if (other !== this && other.name === this.name && !other.closed) {
        queueMicrotask(() => other.onmessage?.({ data: copy } as MessageEvent))
      }
    }
  }

  close(): void {
    this.closed = true
    FakeBroadcastChannel.open = FakeBroadcastChannel.open.filter((channel) => channel !== this)
  }

  static reset(): void {
    FakeBroadcastChannel.open = []
  }
}

export const fakeChannelFactory = (name: string): FakeBroadcastChannel => new FakeBroadcastChannel(name)
