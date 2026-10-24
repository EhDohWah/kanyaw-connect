import { vi } from 'vitest'

/** An `IntersectionObserver` a test can drive: it never looks at the screen, it only does what `see()` tells it. */
export class FakeObserver {
  static all: FakeObserver[] = []
  observed: Element[] = []
  disconnected = 0

  constructor(
    readonly callback: (entries: Partial<IntersectionObserverEntry>[]) => void,
    readonly options?: IntersectionObserverInit,
  ) {
    FakeObserver.all.push(this)
  }

  observe(element: Element): void {
    this.observed.push(element)
  }

  disconnect(): void {
    this.disconnected += 1
    this.observed = []
  }

  /** The watched element comes into view (or leaves it). */
  see(visible: boolean): void {
    this.callback([{ isIntersecting: visible }])
  }

  static latest(): FakeObserver {
    const found = FakeObserver.all.at(-1)
    if (!found) throw new Error('Nothing is watching anything yet')
    return found
  }
}

export function installFakeObserver(): void {
  FakeObserver.all = []
  vi.stubGlobal('IntersectionObserver', FakeObserver)
}
