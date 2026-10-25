import { beforeEach, describe, expect, it, vi } from 'vitest'

import SOURCE from '../../../public/sw.js?raw'

/*
 * Runs the real public/sw.js against a stand-in for the service worker's global scope, and fires the events the browser
 * would (push, notificationclick, ...).
 */

const CHAT = '0195e2c4-0004-7a03-8103-5f3a9c005ccd'
const ROOM = '0195e2c4-001a-7a19-8119-5f3a9c030557'

interface FakeWindow {
  url: string
  focused: boolean
  visibilityState: 'visible' | 'hidden'
  postMessage: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
}

function fakeWindow(url: string, over: Partial<FakeWindow> = {}): FakeWindow {
  return { url, focused: false, visibilityState: 'hidden', postMessage: vi.fn(), focus: vi.fn(async () => undefined), ...over }
}

function worker(scope = 'https://kanyaw.example/') {
  const listeners = new Map<string, (event: unknown) => void>()
  const windows: FakeWindow[] = []
  const self = {
    registration: { scope, showNotification: vi.fn(async () => undefined) },
    clients: {
      matchAll: vi.fn(async () => windows),
      openWindow: vi.fn(async () => null),
      claim: vi.fn(async () => undefined),
    },
    skipWaiting: vi.fn(async () => undefined),
    addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
  }
  new Function('self', SOURCE)(self)

  /** Fires an event and waits for what the worker handed to `waitUntil`. */
  async function fire(type: string, event: Record<string, unknown> = {}): Promise<void> {
    const waits: Promise<unknown>[] = []
    listeners.get(type)!({ ...event, waitUntil: (promise: Promise<unknown>) => waits.push(promise) })
    await Promise.all(waits)
  }

  const push = (payload: unknown) =>
    fire('push', {
      data: {
        json: () => {
          if (typeof payload === 'string') return JSON.parse(payload) as unknown
          return payload
        },
      },
    })

  const shown = () => self.registration.showNotification.mock.calls.at(-1) as unknown as [string, Record<string, unknown>]

  return { self, windows, fire, push, shown }
}

const message = (over: Record<string, unknown> = {}) => ({
  type: 'message.new',
  chat_id: CHAT,
  message_id: '0195e2c4-0008-7a07-8107-5f3a9c00d889',
  sent_at: '2026-03-14T09:02:18.628374Z',
  encrypted: false,
  title: 'Naw Paw Say',
  body: 'Hello Eh Doh, are you coming on Saturday?',
  message_type: 'text',
  ...over,
})

describe('the service worker: a push', () => {
  let w: ReturnType<typeof worker>
  beforeEach(() => {
    w = worker()
  })

  it('shows the message as the server wrote it, one notification per chat, and remembers the chat to open', async () => {
    await w.push(message())

    const [title, options] = w.shown()
    expect(title).toBe('Naw Paw Say')
    expect(options).toMatchObject({
      body: 'Hello Eh Doh, are you coming on Saturday?',
      tag: `chat:${CHAT}`,
      // A newer message in the same chat replaces the notification and still makes a sound.
      renotify: true,
      timestamp: Date.parse('2026-03-14T09:02:18.628374Z'),
      icon: 'https://kanyaw.example/icons/icon-192.png',
      badge: 'https://kanyaw.example/icons/badge-96.png',
      data: { url: `https://kanyaw.example/chats/${CHAT}` },
    })
  })

  it('a meeting invitation opens the meeting, not the chat it was posted in', async () => {
    await w.push(message({ room_id: ROOM, message_type: 'system', body: 'Saw Eh Doh started a video room: Committee' }))

    expect(w.shown()[1]).toMatchObject({ tag: `room:${ROOM}`, data: { url: `https://kanyaw.example/rooms/${ROOM}` } })
  })

  it('an encrypted chat: shows exactly what the server sent (the app name and "New message")', async () => {
    await w.push({ type: 'message.new', chat_id: CHAT, message_id: 'm1', encrypted: true, title: 'Kanyaw Connect', body: 'New message' })

    expect(w.shown()[0]).toBe('Kanyaw Connect')
    expect(w.shown()[1]).toMatchObject({ body: 'New message', data: { url: `https://kanyaw.example/chats/${CHAT}` } })
  })

  it('something that is not JSON still shows a notification (the browser expects one for every push), opening the app', async () => {
    await w.push('not json')

    const [title, options] = w.shown()
    expect(title).toBe('Kanyaw Connect')
    expect(options).toMatchObject({ body: 'New message', data: { url: 'https://kanyaw.example/' } })
    expect(options).not.toHaveProperty('tag')
    expect(options).not.toHaveProperty('renotify')
  })

  it('a push with no data at all shows the same', async () => {
    await w.fire('push', {})
    expect(w.shown()[0]).toBe('Kanyaw Connect')
  })

  it('an empty title falls back to the app name; a bad time is left out', async () => {
    await w.push(message({ title: '  ', sent_at: 'yesterday' }))

    expect(w.shown()[0]).toBe('Kanyaw Connect')
    expect(w.shown()[1]).not.toHaveProperty('timestamp')
  })

  it('ids that are not ids never become part of an address', async () => {
    await w.push(message({ chat_id: '../settings', room_id: 'https://evil.example/x' }))

    expect(w.shown()[1]).toMatchObject({ data: { url: 'https://kanyaw.example/' } })
    expect(w.shown()[1]).not.toHaveProperty('tag')
  })

  it('addresses follow where the app lives (a sub-folder)', async () => {
    const sub = worker('https://example.org/kanyaw/')
    await sub.push(message())

    expect(sub.shown()[1]).toMatchObject({
      icon: 'https://example.org/kanyaw/icons/icon-192.png',
      data: { url: `https://example.org/kanyaw/chats/${CHAT}` },
    })
  })
})

describe('the service worker: tapping a notification', () => {
  const url = `https://kanyaw.example/chats/${CHAT}`
  const tap = (w: ReturnType<typeof worker>, data: unknown = { url }) => {
    const notification = { data, close: vi.fn() }
    return { notification, done: w.fire('notificationclick', { notification }) }
  }

  it('closes it, and tells the open app window where to go, bringing it forward (no reload, no second window)', async () => {
    const w = worker()
    const app = fakeWindow('https://kanyaw.example/', { focused: true, visibilityState: 'visible' })
    w.windows.push(app)

    const { notification, done } = tap(w)
    await done

    expect(notification.close).toHaveBeenCalled()
    expect(app.postMessage).toHaveBeenCalledWith({ type: 'kc:open', url })
    expect(app.focus).toHaveBeenCalled()
    expect(w.self.clients.openWindow).not.toHaveBeenCalled()
    // Windows the worker does not control yet count too (the app opened before the worker was installed).
    expect(w.self.clients.matchAll).toHaveBeenCalledWith({ type: 'window', includeUncontrolled: true })
  })

  it('with several windows: the focused one, else a visible one, else the first; never a window of another site', async () => {
    const w = worker()
    const other = fakeWindow('https://elsewhere.example/', { focused: true, visibilityState: 'visible' })
    const first = fakeWindow('https://kanyaw.example/rooms')
    const visible = fakeWindow('https://kanyaw.example/chats', { visibilityState: 'visible' })
    w.windows.push(other, first, visible)

    await tap(w).done
    expect(visible.postMessage).toHaveBeenCalled()
    expect(first.postMessage).not.toHaveBeenCalled()
    expect(other.postMessage).not.toHaveBeenCalled()

    visible.visibilityState = 'hidden'
    visible.postMessage.mockClear()
    await tap(w).done
    expect(first.postMessage).toHaveBeenCalled()
    expect(visible.postMessage).not.toHaveBeenCalled()
  })

  it('a window of the same host outside the app folder is not the app', async () => {
    const w = worker('https://example.org/kanyaw/')
    w.windows.push(fakeWindow('https://example.org/blog/', { focused: true }))

    await tap(w, { url: 'https://example.org/kanyaw/chats/c1' }).done
    expect(w.self.clients.openWindow).toHaveBeenCalledWith('https://example.org/kanyaw/chats/c1')
  })

  it('when the browser will not bring the window forward, the page has still been told where to go', async () => {
    const w = worker()
    const app = fakeWindow('https://kanyaw.example/', { focus: vi.fn(async () => Promise.reject(new Error('InvalidAccessError'))) })
    w.windows.push(app)

    await expect(tap(w).done).resolves.toBeUndefined()
    expect(app.postMessage).toHaveBeenCalledWith({ type: 'kc:open', url })
  })

  it('with no app window open, opens one on the page', async () => {
    const w = worker()
    await tap(w).done
    expect(w.self.clients.openWindow).toHaveBeenCalledWith(url)
  })

  it('a notification without an address opens the app', async () => {
    const w = worker()
    await tap(w, null).done
    expect(w.self.clients.openWindow).toHaveBeenCalledWith('https://kanyaw.example/')
  })
})

describe('the service worker: its life', () => {
  it('a new version takes over at once (it caches nothing that could get out of step)', async () => {
    const w = worker()
    await w.fire('install')
    expect(w.self.skipWaiting).toHaveBeenCalled()

    await w.fire('activate')
    expect(w.self.clients.claim).toHaveBeenCalled()
  })

  it('it never answers the page\'s requests', () => {
    expect(SOURCE).not.toMatch(/addEventListener\(['"]fetch/)
  })

  it('when the browser changes the subscription, every open window is asked to register it again', async () => {
    const w = worker()
    const one = fakeWindow('https://kanyaw.example/')
    const two = fakeWindow('https://kanyaw.example/chats')
    w.windows.push(one, two)

    await w.fire('pushsubscriptionchange')
    expect(one.postMessage).toHaveBeenCalledWith({ type: 'kc:push-changed' })
    expect(two.postMessage).toHaveBeenCalledWith({ type: 'kc:push-changed' })
  })
})

describe('the service worker: calls', () => {
  const CALL = '0195e2c4-0030-7a2f-812f-5f3a9c05ade1'
  const incoming = (over: Record<string, unknown> = {}) => ({
    type: 'call.incoming',
    call_id: CALL,
    chat_id: CHAT,
    room_id: ROOM,
    kind: 'video',
    title: 'Saw Eh Doh',
    body: 'Incoming video call',
    icon: 'https://api.example.org/storage/avatars/a_256.webp',
    decline_url: `https://api.example.org/api/v1/calls/${CALL}/decline?expires=1773479745&signature=abc`,
    ring_expires_at: new Date(Date.now() + 40_000).toISOString(),
    ...over,
  })

  let w: ReturnType<typeof worker>
  beforeEach(() => {
    w = worker()
  })

  it('with the app open and visible: tells the window to ring, and shows no notification', async () => {
    const visible = fakeWindow('https://kanyaw.example/chats', { visibilityState: 'visible' })
    const hidden = fakeWindow('https://kanyaw.example/', { visibilityState: 'hidden' })
    w.windows.push(visible, hidden)

    await w.push(incoming())

    expect(visible.postMessage).toHaveBeenCalledWith({ type: 'kc:call', call_id: CALL })
    expect(hidden.postMessage).not.toHaveBeenCalled()
    expect(w.self.registration.showNotification).not.toHaveBeenCalled()
  })

  it('otherwise: a notification that stays until answered, with Answer and Decline, the caller\'s picture, and a ring', async () => {
    w.windows.push(fakeWindow('https://kanyaw.example/', { visibilityState: 'hidden' }))

    await w.push(incoming())

    const [title, options] = w.shown()
    expect(title).toBe('Saw Eh Doh')
    expect(options).toMatchObject({
      body: 'Incoming video call',
      icon: 'https://api.example.org/storage/avatars/a_256.webp',
      tag: `call-${CALL}`,
      renotify: true,
      requireInteraction: true,
      vibrate: [500, 250, 500, 250, 500],
      actions: [
        { action: 'answer', title: 'Answer' },
        { action: 'decline', title: 'Decline' },
      ],
      data: { url: `https://kanyaw.example/calls/${CALL}`, call: { call_id: CALL, decline_url: incoming().decline_url } },
    })
  })

  it('shows nothing for a call whose ringing is already over (a late delivery)', async () => {
    await w.push(incoming({ ring_expires_at: new Date(Date.now() - 1000).toISOString() }))
    expect(w.self.registration.showNotification).not.toHaveBeenCalled()
  })

  it('never shows a picture or uses a decline link from a strange address', async () => {
    await w.push(incoming({ icon: 'javascript:alert(1)', decline_url: 'ftp://evil.example/x' }))
    const [, options] = w.shown()
    expect(options.icon).toBe('https://kanyaw.example/icons/icon-192.png')
    expect((options.data as { call: { decline_url: unknown } }).call.decline_url).toBeNull()
  })

  it('a missed call replaces the ringing notification (same tag) and opens the chat', async () => {
    await w.push({ type: 'call.missed', call_id: CALL, chat_id: CHAT, kind: 'voice', title: 'Saw Eh Doh', body: 'Missed voice call' })

    const [title, options] = w.shown()
    expect(title).toBe('Saw Eh Doh')
    expect(options).toMatchObject({ body: 'Missed voice call', tag: `call-${CALL}`, data: { url: `https://kanyaw.example/chats/${CHAT}` } })
    expect(options.requireInteraction).toBeUndefined()
  })

  function callNotification() {
    return { close: vi.fn(), data: { url: `https://kanyaw.example/calls/${CALL}`, call: { call_id: CALL, decline_url: incoming().decline_url } } }
  }

  it('Decline declines from the worker with the signed link, and opens nothing', async () => {
    const fetchMock = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    const notification = callNotification()

    await w.fire('notificationclick', { notification, action: 'decline' })

    expect(notification.close).toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledWith(incoming().decline_url, { method: 'POST', headers: { Accept: 'application/json' } })
    expect(w.self.clients.openWindow).not.toHaveBeenCalled()
  })

  it('Answer opens the call with ?answer=1 (the app checks it still rings, then answers)', async () => {
    await w.fire('notificationclick', { notification: callNotification(), action: 'answer' })
    expect(w.self.clients.openWindow).toHaveBeenCalledWith(`https://kanyaw.example/calls/${CALL}?answer=1`)
  })

  it('a tap on the notification itself (or a browser without actions) opens the incoming screen', async () => {
    const open = fakeWindow('https://kanyaw.example/', { visibilityState: 'hidden' })
    w.windows.push(open)

    await w.fire('notificationclick', { notification: callNotification(), action: '' })

    expect(open.postMessage).toHaveBeenCalledWith({ type: 'kc:open', url: `https://kanyaw.example/calls/${CALL}` })
  })
})
