import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ScreenWakeLock } from '@/realtime/wakeLock'

class FakeSentinel {
  released = false
  release = vi.fn(async () => {
    this.released = true
  })
}

let request: ReturnType<typeof vi.fn>
let visibility: 'visible' | 'hidden' = 'visible'

beforeEach(() => {
  visibility = 'visible'
  request = vi.fn(async () => new FakeSentinel())
  Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true })
  Object.defineProperty(document, 'visibilityState', { get: () => visibility, configurable: true })
})

afterEach(() => {
  Reflect.deleteProperty(navigator, 'wakeLock')
  Reflect.deleteProperty(document, 'visibilityState')
})

describe('keeping the screen on during a call', () => {
  it('takes the screen lock, and lets it go at the end', async () => {
    const lock = new ScreenWakeLock()
    await lock.hold()
    expect(request).toHaveBeenCalledWith('screen')
    expect(lock.held()).toBe(true)

    const sentinel = (await request.mock.results[0]!.value) as FakeSentinel
    await lock.release()
    expect(sentinel.release).toHaveBeenCalled()
    expect(lock.held()).toBe(false)
  })

  it('takes it again when the page comes back (the browser drops it while hidden)', async () => {
    const lock = new ScreenWakeLock()
    await lock.hold()
    const first = (await request.mock.results[0]!.value) as FakeSentinel
    first.released = true // the browser let go when the page was hidden

    visibility = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))
  })

  it('does not take it again after the call', async () => {
    const lock = new ScreenWakeLock()
    await lock.hold()
    await lock.release()
    document.dispatchEvent(new Event('visibilitychange'))
    await Promise.resolve()
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('a lock the browser grants only after the call ended is given straight back', async () => {
    let grant: ((sentinel: FakeSentinel) => void) | null = null
    request.mockImplementationOnce(() => new Promise<FakeSentinel>((resolve) => (grant = resolve)))
    const lock = new ScreenWakeLock()
    const holding = lock.hold()
    await lock.release()

    const late = new FakeSentinel()
    grant!(late)
    await holding

    expect(late.release).toHaveBeenCalled()
    expect(lock.held()).toBe(false)
  })

  it('goes on without it where it is refused or missing', async () => {
    request.mockRejectedValueOnce(new Error('NotAllowedError'))
    const lock = new ScreenWakeLock()
    await expect(lock.hold()).resolves.toBeUndefined()
    expect(lock.held()).toBe(false)

    Reflect.deleteProperty(navigator, 'wakeLock')
    await expect(new ScreenWakeLock().hold()).resolves.toBeUndefined()
  })
})
