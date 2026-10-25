/**
 * Keeps the screen on for the whole of a call (Screen Wake Lock API). The browser drops the lock when the page is
 * hidden, so it is taken again when the page comes back. Where the API is missing, nothing happens.
 */
export class ScreenWakeLock {
  private sentinel: WakeLockSentinel | null = null
  private wanted = false
  private readonly onVisible = (): void => {
    if (this.wanted && document.visibilityState === 'visible') void this.take()
  }

  /** Keep the screen on from now until `release`. */
  async hold(): Promise<void> {
    if (this.wanted) return
    this.wanted = true
    document.addEventListener('visibilitychange', this.onVisible)
    await this.take()
  }

  async release(): Promise<void> {
    this.wanted = false
    document.removeEventListener('visibilitychange', this.onVisible)
    const sentinel = this.sentinel
    this.sentinel = null
    await sentinel?.release().catch(() => undefined)
  }

  /** Held right now (the page is visible and the browser granted it). */
  held(): boolean {
    return this.sentinel !== null && !this.sentinel.released
  }

  private async take(): Promise<void> {
    const api = typeof navigator !== 'undefined' ? navigator.wakeLock : undefined
    if (!api || document.visibilityState !== 'visible' || this.held()) return
    try {
      const sentinel = await api.request('screen')
      if (!this.wanted) {
        await sentinel.release().catch(() => undefined)
        return
      }
      this.sentinel = sentinel
    } catch {
      // refused (battery saver, an iframe): the call goes on without it
    }
  }
}
