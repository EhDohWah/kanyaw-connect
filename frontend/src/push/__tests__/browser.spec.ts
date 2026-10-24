import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { base64UrlToBytes, realBrowserPush } from '@/push/browser'

/*
 * The real browser layer, against stand-ins for the browser's service worker, push and notification objects (jsdom has
 * none of them).
 */

const KEY = 'BOkHTBX7c6Iy4iAw-ZX54HhOcQ2y-QwO9Nn-k8NXXNmKdRHB8Ljr0pYb_tfu5GdKp8hHMTDdjmwoGOe6B7u5TrQ'

function fakeSubscription(endpoint: string, key: Uint8Array | null) {
  return {
    endpoint,
    options: { applicationServerKey: key ? key.slice().buffer : null },
    toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: 'p256dh-key', auth: 'auth-secret' } }),
    unsubscribe: vi.fn(async () => true),
  }
}

type FakeSubscription = ReturnType<typeof fakeSubscription>

function install(options: { subscription?: FakeSubscription | null; registered?: boolean } = {}) {
  let subscription = options.subscription ?? null
  const pushManager = {
    getSubscription: vi.fn(async () => subscription),
    subscribe: vi.fn(async (init: { applicationServerKey: Uint8Array }) => {
      subscription = fakeSubscription('https://fcm.googleapis.com/fcm/send/new', init.applicationServerKey)
      return subscription
    }),
  }
  const registration = { pushManager }
  let registered = options.registered ?? subscription !== null
  const container = Object.assign(new EventTarget(), {
    register: vi.fn(async () => {
      registered = true
      return registration
    }),
    getRegistration: vi.fn(async () => (registered ? registration : undefined)),
    ready: Promise.resolve(registration),
    startMessages: vi.fn(),
  })
  Object.defineProperty(navigator, 'serviceWorker', { value: container, configurable: true })
  return { container, pushManager, subscription: () => subscription }
}

beforeEach(() => {
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
  Object.defineProperty(window, 'PushManager', { value: class {}, configurable: true })
  Object.defineProperty(window, 'Notification', {
    value: Object.assign(class {}, { permission: 'default', requestPermission: vi.fn(async () => 'granted') }),
    configurable: true,
  })
})

afterEach(() => {
  for (const name of ['isSecureContext', 'PushManager', 'Notification'] as const) Reflect.deleteProperty(window, name)
  Reflect.deleteProperty(navigator, 'serviceWorker')
  Reflect.deleteProperty(navigator, 'permissions')
  vi.useRealTimers()
})

describe('base64UrlToBytes', () => {
  it('reads the server key (unpadded base64url) as the 65 bytes of a P-256 public key', () => {
    const bytes = base64UrlToBytes(KEY)
    expect(bytes).toHaveLength(65)
    expect(bytes[0]).toBe(0x04)
  })

  it('handles - and _ and missing padding', () => {
    expect([...base64UrlToBytes('-_8')]).toEqual([0xfb, 0xff])
    expect([...base64UrlToBytes('AQ')]).toEqual([1])
  })
})

describe('what the browser can do', () => {
  it('needs service workers, push, notifications and a secure page', () => {
    install()
    expect(realBrowserPush.supported()).toBe(true)

    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true })
    expect(realBrowserPush.supported()).toBe(false)
  })

  it('is not supported without push (Safari on an iPhone before the app is on the Home Screen)', () => {
    install()
    Reflect.deleteProperty(window, 'PushManager')
    expect(realBrowserPush.supported()).toBe(false)
  })

  it('an iPhone, or an iPad (which says it is a Mac, with a touch screen), needs the Home Screen first', () => {
    const agent = vi.spyOn(navigator, 'userAgent', 'get')
    const platform = vi.spyOn(navigator, 'platform', 'get')
    // jsdom has no touch points at all.
    let points = 5
    Object.defineProperty(navigator, 'maxTouchPoints', { get: () => points, configurable: true })
    window.matchMedia = vi.fn(() => ({ matches: false })) as unknown as typeof window.matchMedia

    agent.mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')
    platform.mockReturnValue('iPhone')
    expect(realBrowserPush.needsHomeScreen()).toBe(true)

    agent.mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')
    platform.mockReturnValue('MacIntel')
    expect(realBrowserPush.needsHomeScreen()).toBe(true)

    points = 0
    expect(realBrowserPush.needsHomeScreen()).toBe(false)
    Reflect.deleteProperty(navigator, 'maxTouchPoints')
  })

  it('opened from the Home Screen, an iPhone is ready', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')
    window.matchMedia = vi.fn(() => ({ matches: true })) as unknown as typeof window.matchMedia
    expect(realBrowserPush.needsHomeScreen()).toBe(false)
  })

  it('reads and asks the notification permission', async () => {
    expect(realBrowserPush.permission()).toBe('default')
    await expect(realBrowserPush.requestPermission()).resolves.toBe('granted')
  })
})

describe('subscribing', () => {
  it('registers the worker for the whole app (never served from a cache), waits for it to run, then subscribes with the key', async () => {
    const { container, pushManager } = install()

    const result = await realBrowserPush.subscribe(KEY)

    expect(container.register).toHaveBeenCalledWith('/sw.js', { scope: '/', updateViaCache: 'none' })
    const init = pushManager.subscribe.mock.calls[0]![0] as unknown as { userVisibleOnly: boolean; applicationServerKey: Uint8Array }
    expect(init.userVisibleOnly).toBe(true)
    expect([...init.applicationServerKey]).toEqual([...base64UrlToBytes(KEY)])
    expect(result).toEqual({
      endpoint: 'https://fcm.googleapis.com/fcm/send/new',
      expirationTime: null,
      keys: { p256dh: 'p256dh-key', auth: 'auth-secret' },
    })
  })

  it('keeps a subscription made with the same key', async () => {
    const existing = fakeSubscription('https://fcm.googleapis.com/fcm/send/old', base64UrlToBytes(KEY))
    install({ subscription: existing })

    await realBrowserPush.subscribe(KEY)
    expect(existing.unsubscribe).not.toHaveBeenCalled()
  })

  it('replaces a subscription made with another key (the server\'s keys were changed)', async () => {
    const existing = fakeSubscription('https://fcm.googleapis.com/fcm/send/old', new Uint8Array([4, 1, 2]))
    const { pushManager } = install({ subscription: existing })

    await realBrowserPush.subscribe(KEY)
    expect(existing.unsubscribe).toHaveBeenCalled()
    expect(existing.unsubscribe.mock.invocationCallOrder[0]).toBeLessThan(pushManager.subscribe.mock.invocationCallOrder[0]!)
  })

  it('a subscription without its keys is refused rather than sent to the server', async () => {
    const { pushManager } = install()
    pushManager.subscribe.mockResolvedValueOnce({
      ...fakeSubscription('https://fcm.googleapis.com/fcm/send/x', null),
      toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: {} }),
    } as never)

    await expect(realBrowserPush.subscribe(KEY)).rejects.toThrow(/keys/)
  })

  it('a worker that never starts gives up after 15 seconds instead of waiting for ever', async () => {
    vi.useFakeTimers()
    const { container } = install()
    container.ready = new Promise(() => undefined)

    const subscribing = realBrowserPush.subscribe(KEY)
    const failed = expect(subscribing).rejects.toThrow(/did not start/)
    await vi.advanceTimersByTimeAsync(15_000)
    await failed
  })
})

describe('the current subscription', () => {
  it('none without a registered worker, and nothing is registered to find out', async () => {
    const { container } = install({ registered: false })

    await expect(realBrowserPush.current()).resolves.toBeNull()
    expect(container.register).not.toHaveBeenCalled()
    expect(container.getRegistration).toHaveBeenCalledWith('/')
  })

  it('the browser\'s subscription when there is one', async () => {
    install({ subscription: fakeSubscription('https://fcm.googleapis.com/fcm/send/abc', base64UrlToBytes(KEY)) })
    await expect(realBrowserPush.current()).resolves.toMatchObject({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc' })
  })

  it('unsubscribes when there is one, and does nothing when there is none', async () => {
    const existing = fakeSubscription('https://fcm.googleapis.com/fcm/send/abc', base64UrlToBytes(KEY))
    install({ subscription: existing })
    await realBrowserPush.unsubscribe()
    expect(existing.unsubscribe).toHaveBeenCalled()

    install({ registered: false })
    await expect(realBrowserPush.unsubscribe()).resolves.toBeUndefined()
  })
})

describe('listening', () => {
  it('passes on messages from the worker, starting the queue of waiting ones, until stopped', () => {
    const { container } = install()
    const heard: unknown[] = []

    const stop = realBrowserPush.listen((message) => heard.push(message))
    expect(container.startMessages).toHaveBeenCalled()
    container.dispatchEvent(new MessageEvent('message', { data: { type: 'kc:open', url: '/chats/c1' } }))
    stop()
    container.dispatchEvent(new MessageEvent('message', { data: { type: 'kc:open', url: '/chats/c2' } }))

    expect(heard).toEqual([{ type: 'kc:open', url: '/chats/c1' }])
  })

  it('without service workers there is nothing to listen to', () => {
    expect(() => realBrowserPush.listen(() => undefined)()).not.toThrow()
  })

  it('hears the permission change in the browser\'s settings, until stopped', async () => {
    const status = new EventTarget()
    Object.defineProperty(navigator, 'permissions', { value: { query: vi.fn(async () => status) }, configurable: true })
    const changed = vi.fn()

    const stop = realBrowserPush.onPermissionChange(changed)
    await Promise.resolve()
    await Promise.resolve()
    status.dispatchEvent(new Event('change'))
    expect(changed).toHaveBeenCalledTimes(1)

    stop()
    status.dispatchEvent(new Event('change'))
    expect(changed).toHaveBeenCalledTimes(1)
  })

  it('a browser without the Permissions API simply never calls', () => {
    expect(() => realBrowserPush.onPermissionChange(vi.fn())()).not.toThrow()
  })
})
