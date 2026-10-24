import type { BrowserSubscription } from '@/types/push'

/**
 * The browser's side of push notifications: the service worker, the permission, and this browser's subscription. The
 * only place that touches `navigator.serviceWorker`, `PushManager` and `Notification`; tests put a fake in its place
 * (`setBrowserPush`).
 */
export interface BrowserPush {
  /** Service workers, push and notifications are all there (and the page is on https or localhost). */
  supported(): boolean
  /**
   * An iPhone or iPad where the app was not added to the Home Screen. There, web push works only for the app opened
   * from the Home Screen, so the way to get notifications is to add it first.
   */
  needsHomeScreen(): boolean
  permission(): NotificationPermission
  /** Asks the person. Call it straight from a tap: Safari shows the question only in direct answer to one. */
  requestPermission(): Promise<NotificationPermission>
  /** This browser's subscription, if it has one. Registers nothing. */
  current(): Promise<BrowserSubscription | null>
  /** Registers the service worker if needed and subscribes with the server's key (a subscription made with another key is replaced). */
  subscribe(publicKey: string): Promise<BrowserSubscription>
  /** Ends this browser's subscription, if it has one. */
  unsubscribe(): Promise<void>
  /** Messages from the service worker. Returns the function that stops listening. */
  listen(handler: (message: unknown) => void): () => void
  /** Called when notifications are allowed or blocked in the browser's own settings. Returns the function that stops it. */
  onPermissionChange(handler: () => void): () => void
}

const BASE = import.meta.env.BASE_URL
/** The service worker file (`public/sw.js`) and the part of the site it looks after: the whole app. */
const WORKER_URL = `${BASE}sw.js`
/** A worker that never becomes active (an error in it) must not leave "Turning on…" forever. */
const READY_TIMEOUT_MS = 15_000

/** The server's key is unpadded base64url; the browser wants the bytes. */
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function sameBytes(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a || a.byteLength !== b.byteLength) return false
  const view = new Uint8Array(a)
  return view.every((byte, i) => byte === b[i])
}

function toJson(subscription: PushSubscription): BrowserSubscription {
  const json = subscription.toJSON()
  const p256dh = json.keys?.p256dh
  const auth = json.keys?.auth
  if (!json.endpoint || !p256dh || !auth) throw new Error('The browser gave a push subscription without its keys.')
  return { endpoint: json.endpoint, expirationTime: json.expirationTime ?? null, keys: { p256dh, auth } }
}

function existingRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  return navigator.serviceWorker.getRegistration(BASE)
}

/** Registers the worker (the browser keeps it, and checks for a newer file on later visits) and waits until it runs. */
async function activeRegistration(): Promise<ServiceWorkerRegistration> {
  // updateViaCache 'none': a host that caches files for a long time cannot hold back a new version of the worker.
  await navigator.serviceWorker.register(WORKER_URL, { scope: BASE, updateViaCache: 'none' })
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('The service worker did not start.')), READY_TIMEOUT_MS)
  })
  try {
    return await Promise.race([navigator.serviceWorker.ready, late])
  } finally {
    clearTimeout(timer)
  }
}

function standalone(): boolean {
  const legacy = (navigator as Navigator & { standalone?: boolean }).standalone === true
  return legacy || window.matchMedia?.('(display-mode: standalone)').matches === true
}

function appleMobile(): boolean {
  // iPadOS reports itself as a Mac; a Mac has no touch screen.
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

export const realBrowserPush: BrowserPush = {
  supported() {
    return (
      typeof window !== 'undefined' &&
      window.isSecureContext &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window
    )
  },

  needsHomeScreen() {
    return appleMobile() && !standalone()
  },

  permission() {
    return 'Notification' in window ? Notification.permission : 'denied'
  },

  requestPermission() {
    return Notification.requestPermission()
  },

  async current() {
    const registration = await existingRegistration()
    const subscription = await registration?.pushManager.getSubscription()
    return subscription ? toJson(subscription) : null
  },

  async subscribe(publicKey) {
    const registration = await activeRegistration()
    const key = base64UrlToBytes(publicKey)
    const existing = await registration.pushManager.getSubscription()
    // The server's keys were changed: the old subscription cannot be used with the new key.
    if (existing && !sameBytes(existing.options.applicationServerKey, key)) await existing.unsubscribe()
    return toJson(await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }))
  },

  async unsubscribe() {
    const registration = await existingRegistration()
    const subscription = await registration?.pushManager.getSubscription()
    await subscription?.unsubscribe()
  },

  listen(handler) {
    if (!('serviceWorker' in navigator)) return () => undefined
    const onMessage = (event: MessageEvent): void => handler(event.data)
    navigator.serviceWorker.addEventListener('message', onMessage)
    // Messages wait in a queue until the page says it is ready for them.
    navigator.serviceWorker.startMessages()
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  },

  onPermissionChange(handler) {
    let watched: PermissionStatus | null = null
    let stopped = false
    navigator.permissions
      ?.query({ name: 'notifications' })
      .then((permission) => {
        if (stopped) return
        watched = permission
        permission.addEventListener('change', handler)
      })
      .catch(() => undefined)
    return () => {
      stopped = true
      watched?.removeEventListener('change', handler)
    }
  },
}

let inUse: BrowserPush = realBrowserPush

export function browserPush(): BrowserPush {
  return inUse
}

/** Tests: a fake browser. `null` puts the real one back. */
export function setBrowserPush(fake: BrowserPush | null): void {
  inUse = fake ?? realBrowserPush
}
