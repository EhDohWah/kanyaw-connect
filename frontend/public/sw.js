// @ts-check
/// <reference lib="webworker" />

/*
 * The service worker. It does two things only: show the notifications the server pushes, and open the right page when
 * one is tapped. It caches nothing and never touches the app's requests, so a new version of the app is never held back
 * by it. It is a plain file (served as it is, in development and in the build) and is type-checked by tsconfig.sw.json.
 *
 * What the server sends (docs/API.md, sections 6.2 and 8.2):
 *   { type: "message.new", chat_id, message_id, sent_at, encrypted, title, body, message_type?, room_id? }
 *   { type: "call.incoming", call_id, chat_id, room_id, kind, title, body, icon, decline_url, ring_expires_at }
 *   { type: "call.missed", call_id, chat_id, kind, title, body }
 *
 * An incoming call rings in the app when one of its windows is visible (the window is told and rings itself; Chrome
 * does not add its "updated in the background" notice while a page of the site is visible). Otherwise it is a
 * notification that stays until answered, with Answer and Decline.
 */

const sw = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self))

const APP_NAME = 'Kanyaw Connect'
const GENERIC_BODY = 'New message'
/** The phone vibrates like a ringing phone while the call notification arrives. */
const CALL_VIBRATION = [500, 250, 500, 250, 500]

/**
 * @typedef {object} PushPayload
 * @property {string} [type]
 * @property {string} [chat_id]
 * @property {string} [message_id]
 * @property {string} [room_id]
 * @property {string} [sent_at]
 * @property {string} [title]
 * @property {string} [body]
 * @property {string} [call_id]
 * @property {string} [kind]
 * @property {string | null} [icon]
 * @property {string} [decline_url]
 * @property {string} [ring_expires_at]
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
 * A page of the app, as a full address.
 * @param {string} path
 * @returns {string}
 */
function appUrl(path) {
  return new URL(path, sw.registration.scope).href
}

/**
 * An address the server sent that the worker may fetch or show: https (or http on this site, for development).
 * @param {unknown} value
 * @returns {string | null}
 */
function safeUrl(value) {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.origin === new URL(sw.registration.scope).origin || url.hostname === 'localhost' ? url.href : null
  } catch {
    return null
  }
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
 * The app's windows, the visible one first.
 * @returns {Promise<WindowClient[]>}
 */
async function appWindows() {
  const windows = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true })
  return windows.filter((client) => client.url.startsWith(sw.registration.scope))
}

/**
 * Someone is calling: a visible window of the app rings by itself; otherwise a notification that stays until answered.
 * @param {PushPayload} data
 */
async function incomingCall(data) {
  const callId = idOf(data.call_id)
  if (!callId) return
  const expires = typeof data.ring_expires_at === 'string' ? Date.parse(data.ring_expires_at) : Number.NaN
  // Arrived after the ringing stopped (the push service held it): nothing to answer any more.
  if (Number.isFinite(expires) && expires <= Date.now()) return

  const visible = (await appWindows()).filter((client) => client.visibilityState === 'visible')
  if (visible.length > 0) {
    visible.forEach((client) => client.postMessage({ type: 'kc:call', call_id: callId }))
    return
  }

  const icons = new URL('icons/', sw.registration.scope).href
  /** @type {NotificationOptions & { renotify?: boolean, vibrate?: number[], actions?: { action: string, title: string }[] }} */
  const options = {
    body: typeof data.body === 'string' ? data.body : '',
    icon: safeUrl(data.icon) ?? `${icons}icon-192.png`,
    badge: `${icons}badge-96.png`,
    tag: `call-${callId}`,
    renotify: true,
    requireInteraction: true,
    vibrate: CALL_VIBRATION,
    data: { url: appUrl(`calls/${callId}`), call: { call_id: callId, decline_url: safeUrl(data.decline_url) } },
    actions: [
      { action: 'answer', title: 'Answer' },
      { action: 'decline', title: 'Decline' },
    ],
  }
  await sw.registration.showNotification(typeof data.title === 'string' && data.title.trim() !== '' ? data.title : APP_NAME, options)
}

/**
 * Nobody answered: the ringing notification becomes "Missed voice call" (same tag), which opens the chat.
 * @param {PushPayload} data
 */
async function missedCall(data) {
  const callId = idOf(data.call_id)
  const chat = idOf(data.chat_id)
  const icons = new URL('icons/', sw.registration.scope).href
  await sw.registration.showNotification(typeof data.title === 'string' && data.title.trim() !== '' ? data.title : APP_NAME, {
    body: typeof data.body === 'string' ? data.body : '',
    icon: `${icons}icon-192.png`,
    badge: `${icons}badge-96.png`,
    ...(callId ? { tag: `call-${callId}` } : {}),
    data: { url: appUrl(chat ? `chats/${chat}` : '') },
  })
}

/**
 * Shows the page in the app's window when one is open (the app moves there itself, without reloading), otherwise
 * opens a new window.
 * @param {string} url
 */
async function openPage(url) {
  const ours = await appWindows()
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
  const data = readPayload(event)
  if (data?.type === 'call.incoming') return event.waitUntil(incomingCall(data))
  if (data?.type === 'call.missed') return event.waitUntil(missedCall(data))
  const { title, options } = notificationFor(data)
  event.waitUntil(sw.registration.showNotification(title, options))
})

sw.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data
  const url = typeof data?.url === 'string' ? data.url : sw.registration.scope
  const call = data?.call

  // A call's Decline: said from here, without opening anything (the signed link stands for the person called).
  if (call && event.action === 'decline') {
    const declineUrl = typeof call.decline_url === 'string' ? call.decline_url : null
    if (declineUrl) event.waitUntil(fetch(declineUrl, { method: 'POST', headers: { Accept: 'application/json' } }).catch(() => undefined))
    return
  }
  // Answer: the app checks that it still rings, then answers. A tap on the notification itself shows the call.
  if (call && event.action === 'answer') return event.waitUntil(openPage(`${url}?answer=1`))
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
