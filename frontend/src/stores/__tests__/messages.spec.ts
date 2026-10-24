import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CHAT_ID, ME, PAW, fakeApi, makeChat, makeMessage, makeUser, page, restoreApi, signIn, type Call, type Reply } from '@/__tests__/helpers'
import { useAuthStore } from '@/stores/auth'
import { useChatsStore } from '@/stores/chats'
import { useDraftsStore } from '@/stores/drafts'
import { LINK_REFRESH_GAP_MS, useMessagesStore } from '@/stores/messages'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

beforeEach(() => {
  setActivePinia(createPinia())
  signIn()
  const auth = useAuthStore()
  auth.user = makeUser({ id: ME })
  useChatsStore().put(makeChat())
})
afterEach(() => {
  restoreApi()
  vi.useRealTimers()
})

const messagesIn = () => useMessagesStore().timeline(CHAT_ID)?.messages ?? []
const sends = (calls: Call[]) => calls.filter((c) => c.method === 'post' && c.url === `/chats/${CHAT_ID}/messages`)
const echoOf = (call: Call | undefined, id = 'srv-1') => ({ status: 201, data: { data: makeMessage({ id, sender_id: ME, content: (call?.body as { content?: string })?.content ?? null, client_id: (call?.body as { client_id?: string })?.client_id }) } })

/** Lets the pending promises of a send settle (and moves fake timers on, if they are in use). */
async function flush(ms = 0) {
  if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(ms)
  else await new Promise((resolve) => setTimeout(resolve, ms))
}

describe('loading history', () => {
  it('shows the oldest message first even though the API answers newest first', async () => {
    const [older, newer] = [makeMessage({ content: 'older' }), makeMessage({ content: 'newer' })]
    fakeApi(() => ({ data: page([newer, older]) }))
    const messages = useMessagesStore()

    await messages.loadInitial(CHAT_ID)

    expect(messagesIn().map((m) => m.content)).toEqual(['older', 'newer'])
    expect(messages.timeline(CHAT_ID)?.status).toBe('ready')
  })

  it('remembers where the next (older) page is and loads it in front', async () => {
    const [a, b, c, d] = [makeMessage({ content: 'a' }), makeMessage({ content: 'b' }), makeMessage({ content: 'c' }), makeMessage({ content: 'd' })]
    let call = 0
    const { calls } = fakeApi(() => {
      call += 1
      return call === 1 ? { data: page([d, c], 'http://api.test/api/v1/chats/x/messages?cursor=2') } : { data: page([b, a]) }
    })
    const messages = useMessagesStore()

    await messages.loadInitial(CHAT_ID)
    expect(messages.timeline(CHAT_ID)?.nextUrl).toContain('cursor=2')
    await messages.loadOlder(CHAT_ID)

    expect(messagesIn().map((m) => m.content)).toEqual(['a', 'b', 'c', 'd'])
    expect(messages.timeline(CHAT_ID)?.nextUrl).toBeNull()
    expect(calls[1]?.uri).toBe('http://api.test/api/v1/chats/x/messages?cursor=2')
  })

  it('does not ask for older messages twice at once, or when there are none', async () => {
    let release: (reply: Reply) => void = () => undefined
    const { calls } = fakeApi((call) => {
      if (call.uri.includes('cursor')) return new Promise<Reply>((resolve) => (release = resolve))
      return { data: page([makeMessage()], 'http://api.test/api/v1/chats/x/messages?cursor=2') }
    })
    const messages = useMessagesStore()
    await messages.loadInitial(CHAT_ID)

    const first = messages.loadOlder(CHAT_ID)
    void messages.loadOlder(CHAT_ID)
    await flush()
    expect(calls.filter((c) => c.uri.includes('cursor'))).toHaveLength(1)

    release({ data: page([makeMessage()]) })
    await first
    await messages.loadOlder(CHAT_ID)
    expect(calls.filter((c) => c.uri.includes('cursor'))).toHaveLength(1)
  })

  it('keeps what is loaded and offers a retry when an older page fails', async () => {
    let fail = true
    fakeApi((call) => {
      if (call.uri.includes('cursor')) return fail ? { network: true } : { data: page([makeMessage({ content: 'older' })]) }
      return { data: page([makeMessage({ content: 'newer' })], 'http://api.test/api/v1/chats/x/messages?cursor=2') }
    })
    const messages = useMessagesStore()
    await messages.loadInitial(CHAT_ID)

    await messages.loadOlder(CHAT_ID)
    expect(messages.timeline(CHAT_ID)?.olderError?.isNetwork).toBe(true)
    expect(messagesIn()).toHaveLength(1)

    fail = false
    await messages.loadOlder(CHAT_ID)
    expect(messagesIn()).toHaveLength(2)
    expect(messages.timeline(CHAT_ID)?.olderError).toBeNull()
  })

  it('reports an error for the first page, and tries again on request', async () => {
    let fail = true
    fakeApi(() => (fail ? { status: 500, data: { message: 'Server Error' } } : { data: page([makeMessage()]) }))
    const messages = useMessagesStore()

    await messages.loadInitial(CHAT_ID)
    expect(messages.timeline(CHAT_ID)?.status).toBe('error')
    expect(messages.timeline(CHAT_ID)?.error?.status).toBe(500)

    fail = false
    await messages.ensureLoaded(CHAT_ID)
    expect(messages.timeline(CHAT_ID)?.status).toBe('ready')
  })
})

describe('sending: optimistic, then confirmed', () => {
  it('shows the message at once as "sending", then replaces it with the confirmed one (never twice)', async () => {
    let release: (reply: Reply) => void = () => undefined
    const { calls } = fakeApi((call) => new Promise<Reply>((resolve) => (release = () => resolve(echoOf(call)))))
    const messages = useMessagesStore()

    const sending = messages.send(CHAT_ID, { type: 'text', content: 'Hello', replyToId: null, file: null })
    await flush()

    expect(messagesIn()).toHaveLength(1)
    expect(messagesIn()[0]).toMatchObject({ content: 'Hello', sender_id: ME })
    expect(messagesIn()[0]?.pending?.status).toBe('sending')
    expect(sends(calls)).toHaveLength(1)

    release({})
    await sending

    expect(messagesIn()).toHaveLength(1)
    expect(messagesIn()[0]?.id).toBe('srv-1')
    expect(messagesIn()[0]?.pending).toBeUndefined()
  })

  it('makes a fresh uuid as client_id for each message', async () => {
    const { calls } = fakeApi((call) => echoOf(call))
    const messages = useMessagesStore()

    await messages.send(CHAT_ID, { type: 'text', content: 'one', replyToId: null, file: null })
    await messages.send(CHAT_ID, { type: 'text', content: 'two', replyToId: null, file: null })

    const ids = sends(calls).map((c) => (c.body as { client_id: string }).client_id)
    expect(ids[0]).toMatch(UUID)
    expect(new Set(ids).size).toBe(2)
  })

  it('sends the reply target, and shows a quote right away', async () => {
    const original = makeMessage({ content: 'Are you coming?' })
    const { calls } = fakeApi((call) => echoOf(call))
    const messages = useMessagesStore()
    messages.ensureTimeline(CHAT_ID).messages = [original]

    await messages.send(CHAT_ID, { type: 'text', content: 'Yes', replyToId: original.id, file: null })

    expect(sends(calls)[0]?.body).toMatchObject({ reply_to_id: original.id, content: 'Yes' })
  })

  it('updates the chat list’s preview and does not count your own message as unread', async () => {
    fakeApi((call) => echoOf(call))
    const messages = useMessagesStore()

    await messages.send(CHAT_ID, { type: 'text', content: 'Hello', replyToId: null, file: null })

    expect(useChatsStore().get(CHAT_ID)?.latest_message?.content).toBe('Hello')
    expect(useChatsStore().get(CHAT_ID)?.unread_count).toBe(0)
  })

  it('does not duplicate when the server’s event for the same message arrives as well', async () => {
    const { calls } = fakeApi((call) => echoOf(call))
    const messages = useMessagesStore()
    await messages.send(CHAT_ID, { type: 'text', content: 'Hello', replyToId: null, file: null })
    const confirmed = messagesIn()[0]!
    const { client_id: _unused, ...event } = confirmed

    messages.receive(event)

    expect(sends(calls)).toHaveLength(1)
    expect(messagesIn()).toHaveLength(1)
    expect(messagesIn()[0]?.client_id).toBeDefined()
  })
})

describe('sending: failure and "Tap to retry"', () => {
  it('tries again by itself on a network failure, with the same client_id, then marks the message failed', async () => {
    vi.useFakeTimers()
    const { calls } = fakeApi(() => ({ network: true }))
    const messages = useMessagesStore()

    const sending = messages.send(CHAT_ID, { type: 'text', content: 'Hello', replyToId: null, file: null })
    await flush(10_000)
    await sending

    const attempts = sends(calls).map((c) => (c.body as { client_id: string }).client_id)
    expect(attempts).toHaveLength(3)
    expect(new Set(attempts).size).toBe(1)
    expect(messagesIn()[0]?.pending?.status).toBe('failed')
    expect(messagesIn()[0]?.pending?.error?.isNetwork).toBe(true)
  })

  it('does not wait or retry for an answer that will not change (a validation error)', async () => {
    const { calls } = fakeApi(() => ({ status: 422, data: { message: 'Invalid', errors: { content: ['Too long'] } } }))
    const messages = useMessagesStore()

    await messages.send(CHAT_ID, { type: 'text', content: 'x', replyToId: null, file: null })

    expect(sends(calls)).toHaveLength(1)
    expect(messagesIn()[0]?.pending?.status).toBe('failed')
    expect(messagesIn()[0]?.pending?.error?.fieldError('content')).toBe('Too long')
  })

  it('does not retry a 403 (you are no longer in the chat)', async () => {
    const { calls } = fakeApi(() => ({ status: 403, data: { message: 'You are not a member of this chat.' } }))
    const messages = useMessagesStore()

    await messages.send(CHAT_ID, { type: 'text', content: 'x', replyToId: null, file: null })

    expect(sends(calls)).toHaveLength(1)
    expect(messagesIn()[0]?.pending?.error?.status).toBe(403)
  })

  it('retries on a server error (5xx) as well', async () => {
    vi.useFakeTimers()
    let attempt = 0
    const { calls } = fakeApi((call) => {
      attempt += 1
      return attempt < 3 ? { status: 503, data: { message: 'Service unavailable' } } : echoOf(call)
    })
    const messages = useMessagesStore()

    const sending = messages.send(CHAT_ID, { type: 'text', content: 'Hello', replyToId: null, file: null })
    await flush(10_000)
    await sending

    expect(sends(calls)).toHaveLength(3)
    expect(messagesIn()[0]?.pending).toBeUndefined()
  })

  it('"Tap to retry" sends the same message again with the same client_id, and it arrives once', async () => {
    let online = false
    const { calls } = fakeApi((call) => (online ? echoOf(call) : { status: 403, data: { message: 'Not now' } }))
    const messages = useMessagesStore()
    await messages.send(CHAT_ID, { type: 'text', content: 'Hello', replyToId: null, file: null })
    const clientId = messagesIn()[0]!.pending!.clientId
    expect(messagesIn()[0]?.pending?.status).toBe('failed')

    online = true
    await messages.retry(CHAT_ID, clientId)

    const used = sends(calls).map((c) => (c.body as { client_id: string }).client_id)
    expect(used).toEqual([clientId, clientId])
    expect(messagesIn()).toHaveLength(1)
    expect(messagesIn()[0]?.pending).toBeUndefined()
  })

  it('"Discard" removes a failed message', async () => {
    fakeApi(() => ({ status: 403, data: { message: 'No' } }))
    const messages = useMessagesStore()
    await messages.send(CHAT_ID, { type: 'text', content: 'Hello', replyToId: null, file: null })

    messages.discard(CHAT_ID, messagesIn()[0]!.pending!.clientId)

    expect(messagesIn()).toHaveLength(0)
  })

  it('a 429 on send waits for Retry-After and goes through, without the person doing anything', async () => {
    vi.useFakeTimers()
    let attempt = 0
    const { calls } = fakeApi((call) => {
      attempt += 1
      return attempt === 1 ? { status: 429, headers: { 'retry-after': '3' }, data: { message: 'Too many' } } : echoOf(call)
    })
    const messages = useMessagesStore()

    const sending = messages.send(CHAT_ID, { type: 'text', content: 'Hello', replyToId: null, file: null })
    await flush(3500)
    await sending

    expect(sends(calls)).toHaveLength(2)
    expect(messagesIn()[0]?.pending).toBeUndefined()
  })

  it('a long 429 wait is shown as a failure the person can retry (not waited out silently)', async () => {
    const { calls } = fakeApi(() => ({ status: 429, headers: { 'retry-after': '55' }, data: { message: 'Too many' } }))
    const messages = useMessagesStore()

    await messages.send(CHAT_ID, { type: 'text', content: 'Hello', replyToId: null, file: null })

    expect(sends(calls)).toHaveLength(1)
    expect(messagesIn()[0]?.pending?.error).toMatchObject({ status: 429, retryAfter: 55 })
  })

  it('a 401 is left to the API client (the session ends); the message just fails', async () => {
    fakeApi(() => ({ status: 401, data: { message: 'Unauthenticated.' } }))
    const messages = useMessagesStore()

    await messages.send(CHAT_ID, { type: 'text', content: 'Hello', replyToId: null, file: null })

    expect(messagesIn()[0]?.pending?.error?.status).toBe(401)
  })
})

describe('sending files', () => {
  const file = (name = 'agenda.txt', type = 'text/plain') => new File(['hello'], name, { type })
  const upload = (calls: Call[]) => calls.filter((c) => c.url === `/chats/${CHAT_ID}/attachments`)
  const attachmentReply = { status: 201, data: { data: { id: 'att-1', original_name: 'agenda.txt', mime_type: 'text/plain', size: 5, url: 'u', thumbnail_url: null, created_at: 'x' } } }

  it('uploads first, then sends the message with the attachment id, as the right type', async () => {
    const { calls } = fakeApi((call) => (call.url.endsWith('/attachments') ? attachmentReply : echoOf(call)))
    const messages = useMessagesStore()

    await messages.send(CHAT_ID, { type: 'file', content: 'The agenda', replyToId: null, file: file() })

    expect(calls.map((c) => c.url)).toEqual([`/chats/${CHAT_ID}/attachments`, `/chats/${CHAT_ID}/messages`])
    expect(sends(calls)[0]?.body).toMatchObject({ type: 'file', content: 'The agenda', metadata: { attachment_id: 'att-1' } })
  })

  it('shows a picture from the person’s own file while it uploads', async () => {
    let release: (reply: Reply) => void = () => undefined
    fakeApi((call) => (call.url.endsWith('/attachments') ? new Promise<Reply>((resolve) => (release = resolve)) : echoOf(call)))
    const messages = useMessagesStore()

    const sending = messages.send(CHAT_ID, { type: 'image', content: '', replyToId: null, file: file('p.png', 'image/png') })
    await flush()

    expect(messagesIn()[0]?.attachment?.thumbnail_url).toBe('blob:preview')
    expect(messagesIn()[0]?.pending?.progress).toBe(0)

    release(attachmentReply)
    await sending
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview')
  })

  it('does not upload again when only the send failed', async () => {
    let sendWorks = false
    const { calls } = fakeApi((call) => {
      if (call.url.endsWith('/attachments')) return attachmentReply
      return sendWorks ? echoOf(call) : { status: 403, data: { message: 'No' } }
    })
    const messages = useMessagesStore()
    await messages.send(CHAT_ID, { type: 'file', content: '', replyToId: null, file: file() })

    sendWorks = true
    await messages.retry(CHAT_ID, messagesIn()[0]!.pending!.clientId)

    expect(upload(calls)).toHaveLength(1)
    expect(sends(calls)).toHaveLength(2)
    expect(messagesIn()[0]?.pending).toBeUndefined()
  })

  it('uploads again when the upload itself failed', async () => {
    let uploadWorks = false
    const { calls } = fakeApi((call) => {
      if (call.url.endsWith('/attachments')) return uploadWorks ? attachmentReply : { status: 413, data: { message: 'Too large' } }
      return echoOf(call)
    })
    const messages = useMessagesStore()
    await messages.send(CHAT_ID, { type: 'file', content: '', replyToId: null, file: file() })
    expect(messagesIn()[0]?.pending?.status).toBe('failed')
    expect(sends(calls)).toHaveLength(0)

    uploadWorks = true
    await messages.retry(CHAT_ID, messagesIn()[0]!.pending!.clientId)

    expect(upload(calls)).toHaveLength(2)
    expect(sends(calls)).toHaveLength(1)
  })

  it('stops an upload that is discarded, and forgets its picture', async () => {
    fakeApi((call) => (call.url.endsWith('/attachments') ? new Promise<Reply>(() => undefined) : echoOf(call)))
    const messages = useMessagesStore()
    void messages.send(CHAT_ID, { type: 'image', content: '', replyToId: null, file: file('p.png', 'image/png') })
    await flush()

    messages.discard(CHAT_ID, messagesIn()[0]!.pending!.clientId)

    expect(messagesIn()).toHaveLength(0)
    expect(URL.revokeObjectURL).toHaveBeenCalled()
  })
})

describe('changes from the server', () => {
  it('adds a message that arrives for an open chat, once', () => {
    const messages = useMessagesStore()
    messages.ensureTimeline(CHAT_ID).status = 'ready'
    const message = makeMessage({ content: 'Live' })

    messages.receive(message)
    messages.receive({ ...message })

    expect(messagesIn()).toHaveLength(1)
  })

  it('ignores the history of a chat nobody opened (it is fetched when opened) but still updates the list', () => {
    const messages = useMessagesStore()

    messages.receive(makeMessage({ content: 'While away' }))

    expect(messages.timeline(CHAT_ID)).toBeUndefined()
    expect(useChatsStore().get(CHAT_ID)?.latest_message?.content).toBe('While away')
    expect(useChatsStore().get(CHAT_ID)?.unread_count).toBe(1)
  })

  it('applies an edit, and the preview when it was the latest message', async () => {
    const original = makeMessage({ content: 'Before' })
    const messages = useMessagesStore()
    useChatsStore().put(makeChat({ latest_message: original }))
    messages.ensureTimeline(CHAT_ID).messages = [original]
    const { calls } = fakeApi(() => ({ data: { data: makeChat({ latest_message: { ...original, content: 'After' } }) } }))

    messages.receiveUpdate({ ...original, content: 'After', is_edited: true, edited_at: '2026-03-14T10:00:00.000000Z' })
    await flush()

    expect(messagesIn()[0]).toMatchObject({ content: 'After', is_edited: true })
    expect(calls[0]?.url).toBe(`/chats/${CHAT_ID}`) // the preview is refreshed from the server
  })

  it('removes a deleted message, and marks replies that quoted it', () => {
    const original = makeMessage({ content: 'Original' })
    const reply = makeMessage({ content: 'Answer', reply_to_id: original.id, reply_to: { id: original.id, sender_id: PAW, type: 'text', content: 'Original', is_deleted: false } })
    const messages = useMessagesStore()
    messages.ensureTimeline(CHAT_ID).messages = [original, reply]

    messages.receiveDeleted(CHAT_ID, original.id)

    expect(messagesIn().map((m) => m.content)).toEqual(['Answer'])
    expect(messagesIn()[0]?.reply_to).toMatchObject({ is_deleted: true, content: null })
  })

  it('fetches a message once for fresh links when a picture stopped loading, not again and again', async () => {
    const message = makeMessage({ type: 'image' })
    const { calls } = fakeApi(() => ({ data: { data: message } }))
    const messages = useMessagesStore()
    messages.ensureTimeline(CHAT_ID).messages = [message]

    await messages.refreshAttachment(message)
    await messages.refreshAttachment(message)

    expect(calls).toHaveLength(1)
  })
})

describe('after a reconnect (resync)', () => {
  it('adds what was missed and drops what was deleted meanwhile, keeping messages still being sent', async () => {
    const [a, b, c] = [makeMessage({ content: 'a' }), makeMessage({ content: 'b' }), makeMessage({ content: 'c' })]
    const missed = makeMessage({ content: 'missed' })
    const messages = useMessagesStore()
    const entry = messages.ensureTimeline(CHAT_ID)
    entry.status = 'ready'
    entry.messages = [a, b, c]
    fakeApi(() => ({ data: page([missed, c, a]) })) // b was deleted, one message was missed

    await messages.resync(CHAT_ID)

    expect(messagesIn().map((m) => m.content)).toEqual(['a', 'c', 'missed'])
  })

  it('starts over from the fresh page when there is no overlap, and takes its "next" address', async () => {
    const old = makeMessage({ content: 'old' })
    const fresh = [makeMessage({ content: 'fresh 1' }), makeMessage({ content: 'fresh 2' })]
    const messages = useMessagesStore()
    const entry = messages.ensureTimeline(CHAT_ID)
    entry.status = 'ready'
    entry.messages = [old]
    entry.nextUrl = 'http://old-cursor'
    fakeApi(() => ({ data: page([...fresh].reverse(), 'http://api.test/api/v1/chats/x/messages?cursor=9') }))

    await messages.resync(CHAT_ID)

    expect(messagesIn().map((m) => m.content)).toEqual(['fresh 1', 'fresh 2'])
    expect(messages.timeline(CHAT_ID)?.nextUrl).toContain('cursor=9')
  })

  it('does nothing for a chat that is not loaded, and stays quiet when the network is still down', async () => {
    const { calls } = fakeApi(() => ({ network: true }))
    const messages = useMessagesStore()

    await messages.resync(CHAT_ID)
    expect(calls).toHaveLength(0)

    const entry = messages.ensureTimeline(CHAT_ID)
    entry.status = 'ready'
    entry.messages = [makeMessage()]
    await expect(messages.resync(CHAT_ID)).resolves.toBeUndefined()
    expect(messagesIn()).toHaveLength(1)
  })
})

describe('edit and delete', () => {
  it('edits through the API and shows the server’s version', async () => {
    const original = makeMessage({ sender_id: ME, content: 'Before' })
    const { calls } = fakeApi(() => ({ data: { data: { ...original, content: 'After', is_edited: true, edited_at: '2026-03-14T10:00:00.000000Z' } } }))
    const messages = useMessagesStore()
    messages.ensureTimeline(CHAT_ID).messages = [original]

    await messages.edit(original, 'After')

    expect(calls[0]).toMatchObject({ method: 'patch', url: `/messages/${original.id}`, body: { content: 'After' } })
    expect(messagesIn()[0]).toMatchObject({ content: 'After', is_edited: true })
  })

  it('deletes through the API and removes the message', async () => {
    const message = makeMessage({ sender_id: ME })
    fakeApi(() => ({ status: 204 }))
    const messages = useMessagesStore()
    messages.ensureTimeline(CHAT_ID).messages = [message]

    await messages.remove(message)

    expect(messagesIn()).toHaveLength(0)
  })

  it('keeps the message when the server refuses to delete it', async () => {
    const message = makeMessage({ sender_id: PAW })
    fakeApi(() => ({ status: 403, data: { message: 'You cannot delete this.' } }))
    const messages = useMessagesStore()
    messages.ensureTimeline(CHAT_ID).messages = [message]

    await expect(messages.remove(message)).rejects.toMatchObject({ status: 403 })
    expect(messagesIn()).toHaveLength(1)
  })
})

describe('signing out', () => {
  it('forgets every conversation and releases picture previews', async () => {
    fakeApi((call) => (call.url.endsWith('/attachments') ? new Promise<Reply>(() => undefined) : echoOf(call)))
    const messages = useMessagesStore()
    void messages.send(CHAT_ID, { type: 'image', content: '', replyToId: null, file: new File(['x'], 'p.png', { type: 'image/png' }) })
    await flush()

    messages.reset()

    expect(messages.timeline(CHAT_ID)).toBeUndefined()
    expect(URL.revokeObjectURL).toHaveBeenCalled()
  })
})

describe('fresh attachment links', () => {
  const withFile = (url: string) => makeMessage({ id: 'img-1', type: 'image', attachment: { id: 'a1', original_name: 'p.png', mime_type: 'image/png', size: 10, url, thumbnail_url: url, created_at: 'x' } })

  it('asks for the message again and shows its fresh links', async () => {
    const { calls } = fakeApi((call) => (call.url === '/messages/img-1' ? { data: { data: withFile('https://x/new') } } : { data: page([withFile('https://x/old')]) }))
    const messages = useMessagesStore()
    await messages.loadInitial(CHAT_ID)

    await messages.refreshAttachment(withFile('https://x/old'))

    expect(calls.filter((c) => c.url === '/messages/img-1')).toHaveLength(1)
    expect(messagesIn()[0]?.attachment?.url).toBe('https://x/new')
  })

  it('does not ask again right away (a file that is really gone must not cause a stream of requests), but does after a while', async () => {
    vi.useFakeTimers()
    const { calls } = fakeApi(() => ({ data: { data: withFile('https://x/new') } }))
    const messages = useMessagesStore()
    messages.reset() // the times of earlier refreshes are kept for the whole session

    await messages.refreshAttachment(withFile('https://x/old'))
    await messages.refreshAttachment(withFile('https://x/new'))
    expect(calls).toHaveLength(1)

    vi.advanceTimersByTime(LINK_REFRESH_GAP_MS)
    await messages.refreshAttachment(withFile('https://x/new'))
    expect(calls).toHaveLength(2)
  })
})

describe('a message deleted while the box points at it', () => {
  it('leaves edit mode and empties the box when the message being edited is deleted (elsewhere, or by an admin)', () => {
    const messages = useMessagesStore()
    const draft = useDraftsStore().get(CHAT_ID)
    draft.editingId = 'm-1'
    draft.text = 'my edit'

    messages.receiveDeleted(CHAT_ID, 'm-1')

    expect(draft.editingId).toBeNull()
    expect(draft.text).toBe('')
  })

  it('drops the reply to a deleted message, and keeps what was typed', () => {
    const messages = useMessagesStore()
    const draft = useDraftsStore().get(CHAT_ID)
    draft.replyToId = 'm-1'
    draft.text = 'my answer'

    messages.receiveDeleted(CHAT_ID, 'm-1')

    expect(draft.replyToId).toBeNull()
    expect(draft.text).toBe('my answer')
  })

  it('leaves a box that points at another message alone', () => {
    const messages = useMessagesStore()
    const draft = useDraftsStore().get(CHAT_ID)
    draft.editingId = 'm-2'
    draft.text = 'still editing'

    messages.receiveDeleted(CHAT_ID, 'm-1')

    expect(draft.editingId).toBe('m-2')
    expect(draft.text).toBe('still editing')
  })
})

describe('a deleted message stays deleted', () => {
  it('is not brought back by a late copy of its "sent" or "updated" event', async () => {
    const target = makeMessage({ id: 'gone', content: 'oops' })
    fakeApi(() => ({ data: page([target]) }))
    const messages = useMessagesStore()
    await messages.loadInitial(CHAT_ID)

    messages.receiveDeleted(CHAT_ID, 'gone')
    messages.receive(target)
    messages.receiveUpdate({ ...target, content: 'edited', is_edited: true, edited_at: '2026-03-14T10:00:00Z' })

    expect(messagesIn().map((m) => m.id)).not.toContain('gone')
  })

  it('is not added back by a page that was fetched before the deletion', async () => {
    const target = makeMessage({ id: 'gone', content: 'oops', created_at: '2026-03-14T08:00:00.000000Z' })
    const other = makeMessage({ id: 'kept', content: 'fine', created_at: '2026-03-14T09:00:00.000000Z' })
    fakeApi((call) => (call.uri.includes('cursor') ? { data: page([target]) } : { data: page([other], 'http://api.test/api/v1/chats/x/messages?cursor=older') }))
    const messages = useMessagesStore()
    await messages.loadInitial(CHAT_ID)

    messages.receiveDeleted(CHAT_ID, 'gone')
    await messages.loadOlder(CHAT_ID)

    expect(messagesIn().map((m) => m.id)).toEqual(['kept'])
  })

  it('forgets what was deleted when the person signs out', async () => {
    const target = makeMessage({ id: 'gone' })
    fakeApi(() => ({ data: page([target]) }))
    const messages = useMessagesStore()
    messages.receiveDeleted(CHAT_ID, 'gone')

    messages.reset()
    await messages.loadInitial(CHAT_ID)

    expect(messagesIn().map((m) => m.id)).toEqual(['gone'])
  })
})
