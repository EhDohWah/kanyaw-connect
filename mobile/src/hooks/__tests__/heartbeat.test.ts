// Ported from frontend/src/composables/__tests__/heartbeat.spec.ts (the app going to the background instead of a hidden tab).
import { ApiError } from '@/api/errors'
import { createHeartbeat } from '@/hooks/heartbeat'

let visible = true
let notify: (() => void) | null = null
function setVisible(value: boolean) {
  visible = value
  notify?.()
}

beforeEach(() => {
  jest.useFakeTimers()
  jest.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  visible = true
})
afterEach(() => {
  jest.useRealTimers()
})

function make(send: () => Promise<void>) {
  return createHeartbeat({
    send,
    isVisible: () => visible,
    watchVisibility: (onChange) => {
      notify = onChange
      return () => {
        notify = null
      }
    },
  })
}

describe('heartbeat', () => {
  it('sends one at once, then one every 45 seconds', async () => {
    const send = jest.fn().mockResolvedValue(undefined)
    const heartbeat = make(send)

    heartbeat.start()
    await jest.advanceTimersByTimeAsync(0)
    expect(send).toHaveBeenCalledTimes(1)

    await jest.advanceTimersByTimeAsync(44_000)
    expect(send).toHaveBeenCalledTimes(1)
    await jest.advanceTimersByTimeAsync(1_000)
    expect(send).toHaveBeenCalledTimes(2)
    await jest.advanceTimersByTimeAsync(45_000)
    expect(send).toHaveBeenCalledTimes(3)

    heartbeat.stop()
  })

  it('is quiet while the app is in the background and resumes when it is in the foreground again', async () => {
    const send = jest.fn().mockResolvedValue(undefined)
    const heartbeat = make(send)
    heartbeat.start()
    await jest.advanceTimersByTimeAsync(0)

    setVisible(false)
    await jest.advanceTimersByTimeAsync(5 * 60_000)
    expect(send).toHaveBeenCalledTimes(1)

    setVisible(true)
    await jest.advanceTimersByTimeAsync(0)
    expect(send).toHaveBeenCalledTimes(2)

    heartbeat.stop()
  })

  it('never goes faster than the server allows when the app is switched back and forth', async () => {
    const send = jest.fn().mockResolvedValue(undefined)
    const heartbeat = make(send)
    heartbeat.start()
    await jest.advanceTimersByTimeAsync(0)

    for (let i = 0; i < 20; i++) {
      setVisible(false)
      setVisible(true)
      await jest.advanceTimersByTimeAsync(100)
    }

    // 2 seconds of switching: nothing more than the first one has gone out yet (the gap is 10 s).
    expect(send).toHaveBeenCalledTimes(1)
    await jest.advanceTimersByTimeAsync(10_000)
    expect(send).toHaveBeenCalledTimes(2)

    heartbeat.stop()
  })

  it('does not start when the app is in the background', async () => {
    visible = false
    const send = jest.fn().mockResolvedValue(undefined)
    const heartbeat = make(send)

    heartbeat.start()
    await jest.advanceTimersByTimeAsync(60_000)
    expect(send).not.toHaveBeenCalled()

    setVisible(true)
    await jest.advanceTimersByTimeAsync(0)
    expect(send).toHaveBeenCalledTimes(1)

    heartbeat.stop()
  })

  it('backs off after a failure and returns to normal after a success', async () => {
    const send = jest
      .fn<Promise<void>, []>()
      .mockRejectedValueOnce(new ApiError({ status: 0, code: 'network', message: 'offline' }))
      .mockRejectedValueOnce(new ApiError({ status: 503, message: 'down' }))
      .mockResolvedValue(undefined)
    const heartbeat = make(send)

    heartbeat.start()
    await jest.advanceTimersByTimeAsync(0)
    expect(send).toHaveBeenCalledTimes(1) // fails: next after 90 s

    await jest.advanceTimersByTimeAsync(89_000)
    expect(send).toHaveBeenCalledTimes(1)
    await jest.advanceTimersByTimeAsync(1_000)
    expect(send).toHaveBeenCalledTimes(2) // fails again: next after 180 s

    await jest.advanceTimersByTimeAsync(179_000)
    expect(send).toHaveBeenCalledTimes(2)
    await jest.advanceTimersByTimeAsync(1_000)
    expect(send).toHaveBeenCalledTimes(3) // succeeds: back to 45 s

    await jest.advanceTimersByTimeAsync(45_000)
    expect(send).toHaveBeenCalledTimes(4)

    heartbeat.stop()
  })

  it('waits at least as long as Retry-After after a 429', async () => {
    const send = jest
      .fn<Promise<void>, []>()
      .mockRejectedValueOnce(new ApiError({ status: 429, message: 'slow down', retryAfter: 300 }))
      .mockResolvedValue(undefined)
    const heartbeat = make(send)

    heartbeat.start()
    await jest.advanceTimersByTimeAsync(0)

    await jest.advanceTimersByTimeAsync(299_000)
    expect(send).toHaveBeenCalledTimes(1)
    await jest.advanceTimersByTimeAsync(1_000)
    expect(send).toHaveBeenCalledTimes(2)

    heartbeat.stop()
  })

  it('stops for good on a 401 (the session is over)', async () => {
    const send = jest.fn().mockRejectedValue(new ApiError({ status: 401, message: 'Unauthenticated.' }))
    const heartbeat = make(send)

    heartbeat.start()
    await jest.advanceTimersByTimeAsync(10 * 60_000)

    expect(send).toHaveBeenCalledTimes(1)
  })

  it('stop() ends it, and start() twice does not double it', async () => {
    const send = jest.fn().mockResolvedValue(undefined)
    const heartbeat = make(send)

    heartbeat.start()
    heartbeat.start()
    await jest.advanceTimersByTimeAsync(0)
    expect(send).toHaveBeenCalledTimes(1)

    heartbeat.stop()
    await jest.advanceTimersByTimeAsync(10 * 60_000)
    setVisible(false)
    setVisible(true)
    await jest.advanceTimersByTimeAsync(60_000)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('never sends two at the same time', async () => {
    let finish: () => void = () => undefined
    const send = jest.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    const heartbeat = make(send)

    heartbeat.start()
    await jest.advanceTimersByTimeAsync(0)
    setVisible(false)
    setVisible(true)
    await jest.advanceTimersByTimeAsync(20_000)
    expect(send).toHaveBeenCalledTimes(1)

    finish()
    heartbeat.stop()
  })
})
