import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/errors'
import { createHeartbeat } from '@/composables/heartbeat'

let visible = true
function setVisible(value: boolean) {
  visible = value
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  visible = true
})
afterEach(() => {
  vi.useRealTimers()
})

function make(send: () => Promise<void>) {
  return createHeartbeat({ send, isVisible: () => visible })
}

describe('heartbeat', () => {
  it('sends one at once, then one every 45 seconds', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    const heartbeat = make(send)

    heartbeat.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(send).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(44_000)
    expect(send).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(send).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(45_000)
    expect(send).toHaveBeenCalledTimes(3)

    heartbeat.stop()
  })

  it('is quiet while the page is hidden and resumes when it is visible again', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    const heartbeat = make(send)
    heartbeat.start()
    await vi.advanceTimersByTimeAsync(0)

    setVisible(false)
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(send).toHaveBeenCalledTimes(1)

    setVisible(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(send).toHaveBeenCalledTimes(2)

    heartbeat.stop()
  })

  it('never goes faster than the server allows when the tab is switched back and forth', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    const heartbeat = make(send)
    heartbeat.start()
    await vi.advanceTimersByTimeAsync(0)

    for (let i = 0; i < 20; i++) {
      setVisible(false)
      setVisible(true)
      await vi.advanceTimersByTimeAsync(100)
    }

    // 2 seconds of switching: nothing more than the first one has gone out yet (the gap is 10 s).
    expect(send).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(send).toHaveBeenCalledTimes(2)

    heartbeat.stop()
  })

  it('does not start when the page is hidden', async () => {
    visible = false
    const send = vi.fn().mockResolvedValue(undefined)
    const heartbeat = make(send)

    heartbeat.start()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(send).not.toHaveBeenCalled()

    setVisible(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(send).toHaveBeenCalledTimes(1)

    heartbeat.stop()
  })

  it('backs off after a failure and returns to normal after a success', async () => {
    const send = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new ApiError({ status: 0, code: 'network', message: 'offline' }))
      .mockRejectedValueOnce(new ApiError({ status: 503, message: 'down' }))
      .mockResolvedValue(undefined)
    const heartbeat = make(send)

    heartbeat.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(send).toHaveBeenCalledTimes(1) // fails: next after 90 s

    await vi.advanceTimersByTimeAsync(89_000)
    expect(send).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(send).toHaveBeenCalledTimes(2) // fails again: next after 180 s

    await vi.advanceTimersByTimeAsync(179_000)
    expect(send).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(send).toHaveBeenCalledTimes(3) // succeeds: back to 45 s

    await vi.advanceTimersByTimeAsync(45_000)
    expect(send).toHaveBeenCalledTimes(4)

    heartbeat.stop()
  })

  it('waits at least as long as Retry-After after a 429', async () => {
    const send = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new ApiError({ status: 429, message: 'slow down', retryAfter: 300 }))
      .mockResolvedValue(undefined)
    const heartbeat = make(send)

    heartbeat.start()
    await vi.advanceTimersByTimeAsync(0)

    await vi.advanceTimersByTimeAsync(299_000)
    expect(send).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(send).toHaveBeenCalledTimes(2)

    heartbeat.stop()
  })

  it('stops for good on a 401 (the session is over)', async () => {
    const send = vi.fn().mockRejectedValue(new ApiError({ status: 401, message: 'Unauthenticated.' }))
    const heartbeat = make(send)

    heartbeat.start()
    await vi.advanceTimersByTimeAsync(10 * 60_000)

    expect(send).toHaveBeenCalledTimes(1)
  })

  it('stop() ends it, and start() twice does not double it', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    const heartbeat = make(send)

    heartbeat.start()
    heartbeat.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(send).toHaveBeenCalledTimes(1)

    heartbeat.stop()
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    setVisible(false)
    setVisible(true)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('never sends two at the same time', async () => {
    let finish: () => void = () => undefined
    const send = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    const heartbeat = make(send)

    heartbeat.start()
    await vi.advanceTimersByTimeAsync(0)
    setVisible(false)
    setVisible(true)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(send).toHaveBeenCalledTimes(1)

    finish()
    heartbeat.stop()
  })
})
