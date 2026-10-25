// Ported from frontend/src/composables/heartbeat.ts. "Visible" is the app being in the foreground (AppState `active`)
// instead of the browser tab being shown; the rules are the same.
import { AppState } from 'react-native'

import { isApiError } from '@/api/errors'

export interface HeartbeatOptions {
  /** Sends one heartbeat (`POST /me/heartbeat`). */
  send: () => Promise<void>
  /** Time between heartbeats while the app is in the foreground. The API wants one every 30-60 seconds. */
  intervalMs?: number
  /** The server allows 12 a minute; coming back to the app never sends faster than this. */
  minGapMs?: number
  /** The longest we wait after repeated failures. */
  maxBackoffMs?: number
  isVisible?: () => boolean
  /** Calls `onChange` whenever the app moves between foreground and background; returns the function that stops. */
  watchVisibility?: (onChange: () => void) => () => void
  now?: () => number
}

export interface Heartbeat {
  start(): void
  stop(): void
}

/**
 * Keeps the user "online" while the app is open and in the foreground.
 *
 * - One heartbeat now, then one every `intervalMs`, only while the app is in the foreground; in the background it stays quiet.
 * - Coming back to the app sends one straight away (unless one just went out).
 * - A failure waits longer each time (doubling, up to `maxBackoffMs`); a 429 waits at least as long as the
 *   server's `Retry-After`. A success goes back to the normal rhythm.
 * - A 401 stops it for good: the session is over.
 */
export function createHeartbeat(options: HeartbeatOptions): Heartbeat {
  const intervalMs = options.intervalMs ?? 45_000
  const minGapMs = options.minGapMs ?? 10_000
  const maxBackoffMs = options.maxBackoffMs ?? 5 * 60_000
  const isVisible = options.isVisible ?? (() => AppState.currentState === 'active')
  const watchVisibility =
    options.watchVisibility ??
    ((onChange: () => void) => {
      const subscription = AppState.addEventListener('change', onChange)
      return () => subscription.remove()
    })
  const now = options.now ?? (() => Date.now())

  let running = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let failures = 0
  let lastSentAt = Number.NEGATIVE_INFINITY
  let inFlight = false
  let stopWatching: (() => void) | null = null

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
      stopWatching = watchVisibility(onVisibilityChange)
      schedule(0)
    },
    stop() {
      running = false
      clearTimer()
      stopWatching?.()
      stopWatching = null
    },
  }
}
