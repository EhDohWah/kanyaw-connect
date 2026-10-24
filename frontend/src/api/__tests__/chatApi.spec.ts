import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CHAT_ID, ME, PAW, fakeApi, makeChat, makeMessage, page, restoreApi, signIn } from '@/__tests__/helpers'
import { uploadAttachment } from '@/api/attachments'
import { addMembers, createDirectChat, createGroupChat, getChat, leaveChat, listChats, markRead, removeMember, setMemberRole, updateChat } from '@/api/chats'
import { ApiError } from '@/api/errors'
import { deleteMessage, editMessage, getMessage, listMessages, sendMessage } from '@/api/messages'
import { getPresence } from '@/api/presence'

beforeEach(() => signIn())
afterEach(() => {
  restoreApi()
  vi.useRealTimers()
})

describe('chats', () => {
  it('lists 30 at a time, and follows a full "next" address as it is given', async () => {
    const { calls } = fakeApi(() => ({ data: page([makeChat()]) }))

    await listChats()
    await listChats('http://api.test/api/v1/chats?cursor=abc')

    expect(calls[0]?.uri).toContain('/chats?per_page=30')
    expect(calls[1]?.uri).toBe('http://api.test/api/v1/chats?cursor=abc')
  })

  it('reads one chat from its wrapper', async () => {
    fakeApi(() => ({ data: { data: makeChat({ unread_count: 4 }) } }))
    expect((await getChat(CHAT_ID)).unread_count).toBe(4)
  })

  it('tells a new direct chat (201) from one that already existed (200)', async () => {
    fakeApi((call) => ({ status: call.body && (call.body as { user_id: string }).user_id === PAW ? 200 : 201, data: { data: makeChat() } }))

    expect((await createDirectChat(PAW)).created).toBe(false)
    expect((await createDirectChat('someone-new')).created).toBe(true)
  })

  it('sends the group fields as the API expects, without yourself', async () => {
    const { calls } = fakeApi(() => ({ status: 201, data: { data: makeChat({ type: 'group' }) } }))

    await createGroupChat({ name: 'Committee', description: 'Plans', member_ids: [PAW] })

    expect(calls[0]).toMatchObject({ method: 'post', url: '/chats/group', body: { name: 'Committee', description: 'Plans', member_ids: [PAW] } })
  })

  it('uses the right verb and address for each group change', async () => {
    const { calls } = fakeApi(() => ({ data: { data: makeChat() } }))

    await updateChat(CHAT_ID, { name: 'New name' })
    await addMembers(CHAT_ID, [PAW])
    await setMemberRole(CHAT_ID, PAW, 'admin')
    await removeMember(CHAT_ID, PAW)
    await leaveChat(CHAT_ID)

    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `patch /chats/${CHAT_ID}`,
      `post /chats/${CHAT_ID}/members`,
      `patch /chats/${CHAT_ID}/members/${PAW}`,
      `delete /chats/${CHAT_ID}/members/${PAW}`,
      `delete /chats/${CHAT_ID}/leave`,
    ])
    expect(calls[1]?.body).toEqual({ user_ids: [PAW] })
    expect(calls[2]?.body).toEqual({ role: 'admin' })
  })

  it('reports the read position and returns the server’s unread count', async () => {
    const { calls } = fakeApi(() => ({ data: { data: { chat_id: CHAT_ID, last_read_message_id: 'm1', last_read_at: 'x', unread_count: 0 } } }))

    const receipt = await markRead(CHAT_ID, 'm1')

    expect(calls[0]).toMatchObject({ method: 'post', url: `/chats/${CHAT_ID}/read`, body: { message_id: 'm1' } })
    expect(receipt.unread_count).toBe(0)
  })
})

describe('messages', () => {
  it('lists a chat’s messages 30 at a time', async () => {
    const { calls } = fakeApi(() => ({ data: page([makeMessage()]) }))
    await listMessages(CHAT_ID)
    expect(calls[0]?.uri).toContain(`/chats/${CHAT_ID}/messages?per_page=30`)
  })

  it('sends a message with its client_id, and reads the answer from its wrapper', async () => {
    const message = makeMessage({ content: 'Hello', client_id: 'c1' })
    const { calls } = fakeApi(() => ({ status: 201, data: { data: message } }))

    const result = await sendMessage(CHAT_ID, { client_id: 'c1', type: 'text', content: 'Hello' })

    expect(calls[0]?.body).toEqual({ client_id: 'c1', type: 'text', content: 'Hello' })
    expect(result.message.id).toBe(message.id)
    expect(result.created).toBe(true)
  })

  it('also understands the answer when it is not wrapped (how docs/API.md used to show it)', async () => {
    const message = makeMessage({ content: 'Hello' })
    fakeApi(() => ({ status: 200, data: message }))

    const result = await sendMessage(CHAT_ID, { client_id: 'c1', type: 'text', content: 'Hello' })

    expect(result.message.id).toBe(message.id)
    expect(result.created).toBe(false) // 200: the server already had this client_id
  })

  it('waits and repeats a send after a 429 (it is safe: the client_id makes it idempotent)', async () => {
    vi.useFakeTimers()
    let attempt = 0
    const { calls } = fakeApi(() => {
      attempt += 1
      return attempt === 1 ? { status: 429, headers: { 'retry-after': '2' }, data: { message: 'Slow down' } } : { status: 201, data: { data: makeMessage() } }
    })

    const pending = sendMessage(CHAT_ID, { client_id: 'c1', type: 'text', content: 'Hi' })
    await vi.advanceTimersByTimeAsync(2100)
    await pending

    expect(calls).toHaveLength(2)
    expect(calls[0]?.body).toEqual(calls[1]?.body)
  })

  it('rejects with the server’s code on a conflict', async () => {
    fakeApi(() => ({ status: 409, data: { message: 'That client_id belongs to a message in another chat.', code: 'client_id_conflict' } }))

    const error = (await sendMessage(CHAT_ID, { client_id: 'c1', type: 'text', content: 'x' }).catch((e: unknown) => e)) as ApiError

    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(409)
    expect(error.code).toBe('client_id_conflict')
  })

  it('edits, deletes and fetches single messages', async () => {
    const { calls } = fakeApi(() => ({ data: { data: makeMessage() } }))

    await editMessage('m1', 'New text')
    await deleteMessage('m1')
    await getMessage('m1')

    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['patch /messages/m1', 'delete /messages/m1', 'get /messages/m1'])
    expect(calls[0]?.body).toEqual({ content: 'New text' })
  })
})

describe('attachments', () => {
  it('uploads the file in a multipart field called "file"', async () => {
    const { calls } = fakeApi(() => ({ status: 201, data: { data: { id: 'a1', original_name: 'agenda.txt', mime_type: 'text/plain', size: 5, url: 'u', thumbnail_url: null, created_at: 'x' } } }))

    const attachment = await uploadAttachment(CHAT_ID, new File(['hello'], 'agenda.txt', { type: 'text/plain' }))

    expect(calls[0]?.method).toBe('post')
    expect(calls[0]?.url).toBe(`/chats/${CHAT_ID}/attachments`)
    const form = calls[0]?.body as FormData
    expect(form).toBeInstanceOf(FormData)
    expect((form.get('file') as File).name).toBe('agenda.txt')
    expect(attachment.id).toBe('a1')
  })
})

describe('presence', () => {
  it('asks with ids[] and removes duplicates', async () => {
    const { calls } = fakeApi(() => ({ data: { data: [{ id: PAW, status: 'online', last_seen_at: null }] } }))

    const entries = await getPresence([PAW, PAW, ME])

    expect(decodeURIComponent(calls[0]?.uri ?? '')).toContain(`ids[]=${PAW}&ids[]=${ME}`)
    expect(entries).toHaveLength(1)
  })

  it('asks for at most 100 people at a time', async () => {
    const { calls } = fakeApi(() => ({ data: { data: [] } }))

    await getPresence(Array.from({ length: 230 }, (_, i) => `user-${i}`))

    expect(calls).toHaveLength(3)
    expect(decodeURIComponent(calls[2]?.uri ?? '').match(/ids\[\]/g)).toHaveLength(30)
  })

  it('does not ask at all for nobody', async () => {
    const { calls } = fakeApi(() => ({ data: { data: [] } }))
    await getPresence([])
    expect(calls).toHaveLength(0)
  })
})
