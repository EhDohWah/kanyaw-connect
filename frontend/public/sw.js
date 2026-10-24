// @ts-check
/// <reference lib="webworker" />

/*
 * The service worker. It does two things only: show the notifications the server pushes, and open the right page when
 * one is tapped. It caches nothing and never touches the app's requests, so a new version of the app is never held back
 * by it. It is a plain file (served as it is, in development and in the build) and is type-checked by tsconfig.sw.json.
 *
 * What the server sends (docs/API.md, section 6.2):
 *   { type: "message.new", chat_id, message_id, sent_at, encrypted, title, body, message_type?, room_id? }
 */

const sw = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self))

const APP_NAME = 'Kanyaw Connect'
const GENERIC_BODY = 'New message'

/**
 * @typedef {object} PushPayload
 * @property {string} [type]
 * @property {string} [chat_id]
 * @property {string} [message_id]
 * @property {string} [room_id]
 * @property {string} [sent_at]
 * @property {string} [title]
 * @property {string} [body]
 */

/**
 * An id from the payload, if it looks like one: it becomes part of an address.
 * @param {unknown} value
 * @returns {string | null}
 */
function idOf(value) {
  return typeof value === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(value) ? value : null
}

/**
 * The page a notification opens: the meeting it announces, else its chat, else the app's start page.
 * @param {PushPayload | null} data
 * @returns {string} a full address inside the app
 */
function pageFor(data) {
  const room = idOf(data?.room_id)
  const chat = idOf(data?.chat_id)
  const path = room ? `rooms/${room}` : chat ? `chats/${chat}` : ''
  return new URL(path, sw.registration.scope).href
}

/**
 * @param {PushEvent} event
 * @returns {PushPayload | null}
 */
function readPayload(event) {
  try {
    const data = event.data?.json()
    return data !== null && typeof data === 'object' ? /** @type {PushPayload} */ (data) : null
  } catch {
    // Not JSON: still show something (the browser expects every push to show a notification).
    return null
  }
}

/**
 * @param {PushPayload | null} data
 * @returns {{ title: string, options: NotificationOptions & { renotify?: boolean, timestamp?: number } }}
 */
function notificationFor(data) {
  const room = idOf(data?.room_id)
  const chat = idOf(data?.chat_id)
  // One notification per chat (or meeting): a newer message replaces the older one, and still makes a sound.
  const tag = room ? `room:${room}` : chat ? `chat:${chat}` : undefined
  const sentAt = typeof data?.sent_at === 'string' ? Date.parse(data.sent_at) : Number.NaN
  const icons = new URL('icons/', sw.registration.scope).href

  return {
    title: typeof data?.title === 'string' && data.title.trim() !== '' ? data.title : APP_NAME,
    options: {
      body: typeof data?.body === 'string' ? data.body : GENERIC_BODY,
      icon: `${icons}icon-192.png`,
      badge: `${icons}badge-96.png`,
      ...(tag ? { tag, renotify: true } : {}),
      ...(Number.isFinite(sentAt) ? { timestamp: sentAt } : {}),
      data: { url: pageFor(data) },
    },
  }
}

/**
 * Shows the page in the app's window when one is open (the app moves there itself, without reloading), otherwise
 * opens a new window.
 * @param {string} url
 */
async function openPage(url) {
  const windows = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const ours = windows.filter((client) => client.url.startsWith(sw.registration.scope))
  const client = ours.find((each) => each.focused) ?? ours.find((each) => each.visibilityState === 'visible') ?? ours[0]

  if (client) {
    client.postMessage({ type: 'kc:open', url })
    // The browser may refuse to bring the window forward; the page has been told where to go either way.
    await client.focus().catch(() => undefined)
    return
  }
  await sw.clients.openWindow(url)
}

// A new version takes over at once: there is no cache to keep in step with the page.
sw.addEventListener('install', () => {
  void sw.skipWaiting()
})

sw.addEventListener('activate', (event) => {
  event.waitUntil(sw.clients.claim())
})

sw.addEventListener('push', (event) => {
  const { title, options } = notificationFor(readPayload(event))
  event.waitUntil(sw.registration.showNotification(title, options))
})

sw.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = typeof event.notification.data?.url === 'string' ? event.notification.data.url : sw.registration.scope
  event.waitUntil(openPage(url))
})

// The browser replaced or dropped the subscription (Firefox does this). Only the page can tell the server (it has the
// sign-in), so open windows are asked to check; otherwise the app checks the next time it starts.
sw.addEventListener('pushsubscriptionchange', (event) => {
  const telling = sw.clients
    .matchAll({ type: 'window', includeUncontrolled: true })
    .then((windows) => windows.forEach((client) => client.postMessage({ type: 'kc:push-changed' })))
  event.waitUntil(telling)
})
