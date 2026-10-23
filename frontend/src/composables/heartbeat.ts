import { isApiError } from '@/api/errors'

export interface HeartbeatOptions {
  /** Sends one heartbeat (`POST /me/heartbeat`). */
  send: () => Promise<void>
  /** Time between heartbeats while the page is visible. The API wants one every 30-60 seconds. */
  intervalMs?: number
  /** The server allows 12 a minute; coming back to the tab never sends faster than this. */
  minGapMs?: number
  /** The longest we wait after repeated failures. */
  maxBackoffMs?: number
  isVisible?: () => boolean
  now?: () => number
}

export interface Heartbeat {
  start(): void
  stop(): void
}

/**
 * Keeps the user "online" while the app is open and visible.
 *
 * - One heartbeat now, then one every `intervalMs`, only while the page is visible; hidden tabs stay quiet.
 * - Coming back to the tab sends one straight away (unless one just went out).
 * - A failure waits longer each time (doubling, up to `maxBackoffMs`); a 429 waits at least as long as the
 *   server's `Retry-After`. A success goes back to the normal rhythm.
 * - A 401 stops it for good: the session is over.
 */
export function createHeartbeat(options: HeartbeatOptions): Heartbeat {
  const intervalMs = options.intervalMs ?? 45_000
  const minGapMs = options.minGapMs ?? 10_000
  const maxBackoffMs = options.maxBackoffMs ?? 5 * 60_000
  const isVisible = options.isVisible ?? (() => document.visibilityState === 'visible')
  const now = options.now ?? (() => Date.now())

  let running = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let failures = 0
  let lastSentAt = Number.NEGATIVE_INFINITY
  let inFlight = false

  function clearTimer(): void {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }

  function schedule(delayMs: number): void {
    clearTimer()
    if (!running || !isVisible()) return
    timer = setTimeout(() => void beat(), delayMs)
  }

  async function beat(): Promise<void> {
    if (!running || !isVisible() || inFlight) return

    inFlight = true
    lastSentAt = now()

    let nextDelay = intervalMs
    try {
      await options.send()
      failures = 0
    } catch (error) {
      if (isApiError(error) && error.status === 401) {
        running = false
        inFlight = false
        return
      }

      failures += 1
      nextDelay = Math.min(intervalMs * 2 ** failures, maxBackoffMs)
      if (isApiError(error) && error.status === 429 && error.retryAfter !== undefined) {
        nextDelay = Math.max(nextDelay, error.retryAfter * 1000)
      }
    } finally {
      inFlight = false
    }

    schedule(nextDelay)
  }

  function onVisibilityChange(): void {
    if (!running) return

    if (!isVisible()) {
      clearTimer()
      return
    }

    schedule(Math.max(0, lastSentAt + minGapMs - now()))
  }

  return {
    start() {
      if (running) return
      running = true
      failures = 0
      document.addEventListener('visibilitychange', onVisibilityChange)
      schedule(0)
    },
    stop() {
      running = false
      clearTimer()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    },
  }
}
