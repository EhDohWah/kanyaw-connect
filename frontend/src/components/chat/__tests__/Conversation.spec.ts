import type { Pinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { lastEcho } from '@/__tests__/fakeEcho'
import { CHAT_ID, ME, PAW, fakeApi, makeChat, makeMember, makeMessage, mountApp, page, person, restoreApi, settle, signedInStores, type Call, type Reply } from '@/__tests__/helpers'
import Conversation from '@/components/chat/Conversation.vue'
import { realtime } from '@/realtime'
import { useChatsStore } from '@/stores/chats'
import { useDraftsStore } from '@/stores/drafts'
import { useMessagesStore } from '@/stores/messages'
import { useTypingStore } from '@/stores/typing'
import { useUiStore } from '@/stores/ui'
import type { Chat, Message } from '@/types/chat'

const theirs = (content: string) => makeMessage({ content })
const mine = (content: string) => makeMessage({ content, sender_id: ME, created_at: new Date().toISOString() })

interface Server {
  chat: Chat
  messages?: Message[]
  /** Answers other than the standard ones. */
  extra?: (call: Call) => Reply | Promise<Reply> | undefined
}

function serve({ chat, messages = [], extra }: Server) {
  return fakeApi((call) => {
    const special = extra?.(call)
    if (special) return special
    if (call.method === 'get' && call.url === `/chats/${chat.id}`) return { data: { data: chat } }
    if (call.method === 'get' && call.url === `/chats/${chat.id}/messages`) return { data: page([...messages].reverse()) }
    if (call.method === 'post' && call.url === `/chats/${chat.id}/read`) {
      return { data: { data: { chat_id: chat.id, last_read_message_id: (call.body as { message_id: string }).message_id, last_read_at: 'x', unread_count: 0 } } }
    }
    return { status: 204 }
  })
}

const reads = (calls: Call[]) => calls.filter((c) => c.method === 'post' && c.url === `/chats/${CHAT_ID}/read`)

async function open(server: Server, setup: (pinia: Pinia) => void = () => undefined, variant: 'page' | 'drawer' = 'page') {
  const chat = server.chat
  const mounted = await mountApp(Conversation, {
    props: { chatId: chat.id, variant },
    prepare: (pinia) => {
      signedInStores(pinia)
      useChatsStore(pinia).put(chat)
      setup(pinia)
    },
  })
  await settle(8)
  return mounted
}

beforeEach(() => vi.useRealTimers())
afterEach(() => {
  realtime.disconnect()
  restoreApi()
  vi.useRealTimers()
})

describe('opening a conversation', () => {
  it('shows the history oldest first, with the person’s name in the header', async () => {
    serve({ chat: makeChat(), messages: [theirs('First'), theirs('Second')] })
    const { wrapper } = await open({ chat: makeChat(), messages: [theirs('First'), theirs('Second')] })

    const text = wrapper.text()
    expect(text).toContain('Naw Paw Say')
    expect(text.indexOf('First')).toBeLessThan(text.indexOf('Second'))
  })

  it('shows a loading placeholder while the history is on its way', async () => {
    fakeApi((call) => (call.url.endsWith('/messages') ? new Promise<Reply>(() => undefined) : { data: { data: makeChat() } }))
    const { wrapper } = await open({ chat: makeChat(), messages: [] })

    expect(wrapper.find('[role=status]').exists()).toBe(true)
    expect(wrapper.find('textarea').exists()).toBe(true) // you can already start writing
  })

  it('invites you to write the first message in an empty chat', async () => {
    serve({ chat: makeChat(), messages: [] })
    const { wrapper } = await open({ chat: makeChat(), messages: [] })

    expect(wrapper.text()).toContain('Say hello')
  })

  it('shows an error with "Try again" when the history cannot be loaded, and loads it on retry', async () => {
    let online = false
    fakeApi((call) => {
      if (call.url === `/chats/${CHAT_ID}`) return { data: { data: makeChat() } }
      if (call.url.endsWith('/messages')) return online ? { data: page([theirs('Back')]) } : { network: true }
      return { status: 204 }
    })
    const { wrapper } = await open({ chat: makeChat(), messages: [] })
    expect(wrapper.text()).toContain('This conversation could not be loaded.')

    online = true
    await wrapper.findAll('button').find((b) => b.text().includes('Try again'))?.trigger('click')
    await settle(8)

    expect(wrapper.text()).toContain('Back')
  })

  it('says the chat does not exist (or you are not in it) for a chat you cannot see', async () => {
    fakeApi(() => ({ status: 403, data: { message: 'Forbidden' } }))
    const mounted = await mountApp(Conversation, { props: { chatId: 'not-mine', variant: 'page' }, prepare: (p) => signedInStores(p) })
    await settle(8)

    expect(mounted.wrapper.text()).toContain('This chat does not exist, or you are not in it.')
    expect(mounted.wrapper.find('textarea').exists()).toBe(false)
  })

  it('replaces messages and the box with a calm notice for an encrypted chat, and does not even ask for its messages', async () => {
    const chat = makeChat({ is_encrypted: true })
    const { calls } = serve({ chat, messages: [] })
    const { wrapper } = await open({ chat })

    expect(wrapper.text()).toContain('This chat is end-to-end encrypted. Encrypted chats are coming soon to this app.')
    expect(wrapper.find('textarea').exists()).toBe(false)
    expect(calls.some((c) => c.url.endsWith('/messages'))).toBe(false)
  })

  it('listens to the chat’s channels while it is open, and lets go when it is closed', async () => {
    serve({ chat: makeChat(), messages: [theirs('x')] })
    const nothing = () => undefined
    realtime.connect('t', ME, { messageSent: nothing, messageRead: nothing, chatUpdated: nothing, chatMemberAdded: nothing, chatMemberRemoved: nothing, roomAdmitted: nothing, roomDenied: nothing, roomJoinRequested: nothing }, { status: nothing, connected: nothing })
    const { wrapper } = await open({ chat: makeChat(), messages: [theirs('x')] })
    const echo = lastEcho()

    expect(echo.get(`private-chat.${CHAT_ID}`)).toBeDefined()
    expect(echo.get(`presence-chat.${CHAT_ID}`)).toBeDefined()
    expect(realtime.watchedChatIds()).toEqual([CHAT_ID])
    wrapper.unmount()

    expect(realtime.watchedChatIds()).toEqual([])
    expect(echo.left).toContain(`chat.${CHAT_ID}`)
  })

  it('does not listen to a chat it could not open', async () => {
    fakeApi(() => ({ status: 404, data: { message: 'Not found' } }))
    await mountApp(Conversation, { props: { chatId: 'nope', variant: 'page' }, prepare: (p) => signedInStores(p) })
    await settle(8)

    expect(realtime.watchedChatIds()).toEqual([])
  })

  it('tells the screen when the chat disappears while it is open (removed from the group)', async () => {
    serve({ chat: makeChat(), messages: [theirs('x')] })
    const { wrapper, pinia } = await open({ chat: makeChat(), messages: [theirs('x')] })

    useChatsStore(pinia).drop(CHAT_ID)
    await settle(3)

    expect(wrapper.emitted('gone')).toHaveLength(1)
    expect(wrapper.text()).toContain('This chat does not exist, or you are not in it.')
  })

  it('shows who is typing, from the whispers of the other people, by name', async () => {
    const chat = makeChat({ type: 'group', name: 'G', other_user: undefined, members: [makeMember(person(ME, 'Saw Eh Doh')), makeMember(person(PAW, 'Naw Paw Say'))] })
    serve({ chat, messages: [theirs('x')] })
    const { wrapper, pinia } = await open({ chat })

    useTypingStore(pinia).receive(CHAT_ID, PAW, true)
    await settle(2)

    expect(wrapper.text()).toContain('Naw Paw Say is typing…')
    useTypingStore(pinia).receive(CHAT_ID, PAW, false)
    await settle(2)
    expect(wrapper.text()).not.toContain('is typing')
  })
})

describe('telling the server how far you have read', () => {
  const chatWith = (lastRead: string | null, unread = 0) => makeChat({ unread_count: unread, my_membership: { ...makeChat().my_membership, last_read_message_id: lastRead } })

  it('reports the newest message once the history is shown and someone else wrote after your position', async () => {
    const [a, b] = [theirs('Old'), theirs('New')]
    const chat = chatWith(a.id, 1)
    const { calls } = serve({ chat, messages: [a, b] })

    await open({ chat, messages: [a, b] })
    await new Promise((resolve) => setTimeout(resolve, 450))

    expect(reads(calls)).toHaveLength(1)
    expect(reads(calls)[0]?.body).toEqual({ message_id: b.id })
  })

  it('reports it even though the badge in the list is still 0, as it is while you look at the chat (the server counts on its own)', async () => {
    const [a, b] = [theirs('Old'), theirs('New')]
    const chat = chatWith(a.id, 0)
    const { calls } = serve({ chat, messages: [a, b] })

    await open({ chat, messages: [a, b] })
    await new Promise((resolve) => setTimeout(resolve, 450))

    expect(reads(calls)).toHaveLength(1)
  })

  it('has nothing to report when you have read everything already', async () => {
    const [a, b] = [theirs('Old'), theirs('New')]
    const chat = chatWith(b.id)
    const { calls } = serve({ chat, messages: [a, b] })

    await open({ chat, messages: [a, b] })
    await new Promise((resolve) => setTimeout(resolve, 450))

    expect(reads(calls)).toHaveLength(0)
  })

  it('has nothing to report when only your own messages follow your position', async () => {
    const [a, b] = [theirs('Theirs'), mine('Mine')]
    const chat = chatWith(a.id)
    const { calls } = serve({ chat, messages: [a, b] })

    await open({ chat, messages: [a, b] })
    await new Promise((resolve) => setTimeout(resolve, 450))

    expect(reads(calls)).toHaveLength(0)
  })

  it('reports a message that arrives while you are looking at the chat, and does not count it unread in the list meanwhile', async () => {
    const a = theirs('Old')
    const chat = chatWith(a.id)
    const { calls } = serve({ chat, messages: [a] })
    const { pinia } = await open({ chat, messages: [a] })
    const incoming = theirs('Live')

    useMessagesStore(pinia).receive(incoming)
    expect(useChatsStore(pinia).get(CHAT_ID)?.unread_count).toBe(0)
    await new Promise((resolve) => setTimeout(resolve, 450))

    expect(reads(calls).at(-1)?.body).toEqual({ message_id: incoming.id })
  })

  it('does not report while the page is hidden (a message is not read in a background tab)', async () => {
    const a = theirs('Old')
    const chat = chatWith(null, 1)
    const { calls } = serve({ chat, messages: [a] })
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    try {
      await open({ chat, messages: [a] })
      await new Promise((resolve) => setTimeout(resolve, 450))

      expect(reads(calls)).toHaveLength(0)
      expect(useChatsStore().viewingId).toBeNull()
    } finally {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    }
  })

  it('reports at the moment you leave, even before the short pause is over', async () => {
    const [a, b] = [theirs('Old'), theirs('New')]
    const chat = chatWith(a.id, 1)
    const { calls } = serve({ chat, messages: [a, b] })
    const { wrapper } = await open({ chat, messages: [a, b] })
    // the history has just arrived; leave before the 300 ms pause is up
    await settle(1)

    wrapper.unmount()
    await settle(3)

    expect(reads(calls)).toHaveLength(1)
  })

  it('marks the chat as being looked at while it is open, and not any more when it is closed', async () => {
    const chat = chatWith(null)
    serve({ chat, messages: [theirs('x')] })
    const { wrapper, pinia } = await open({ chat, messages: [theirs('x')] })

    expect(useChatsStore(pinia).viewingId).toBe(CHAT_ID)
    wrapper.unmount()
    expect(useChatsStore(pinia).viewingId).toBeNull()
  })
})

describe('message actions', () => {
  const toolbarButton = (wrapper: Awaited<ReturnType<typeof open>>['wrapper'], text: string, label: string) =>
    wrapper.findAll('ol > li').find((li) => li.text().includes(text))?.find(`[role=toolbar] button[aria-label="${label}"]`)

  it('Reply puts the message in the box’s reply bar', async () => {
    const target = theirs('Question?')
    const chat = makeChat()
    serve({ chat, messages: [target] })
    const { wrapper, pinia } = await open({ chat, messages: [target] })

    await toolbarButton(wrapper, 'Question?', 'Reply')?.trigger('click')

    expect(useDraftsStore(pinia).get(CHAT_ID).replyToId).toBe(target.id)
    expect(wrapper.text()).toContain('Replying to Naw Paw Say')
  })

  it('Edit puts your message in the box, in edit mode', async () => {
    const own = mine('Typo here')
    const chat = makeChat()
    serve({ chat, messages: [own] })
    const { wrapper, pinia } = await open({ chat, messages: [own] })

    await toolbarButton(wrapper, 'Typo here', 'Edit')?.trigger('click')
    await settle(2)

    expect(useDraftsStore(pinia).get(CHAT_ID).editingId).toBe(own.id)
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('Typo here')
  })

  it('Copy puts the text on the clipboard and says so', async () => {
    const target = theirs('Copy me')
    const chat = makeChat()
    serve({ chat, messages: [target] })
    const written: string[] = []
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t: string) => void written.push(t) }, configurable: true })
    const { wrapper, pinia } = await open({ chat, messages: [target] })

    await toolbarButton(wrapper, 'Copy me', 'Copy')?.trigger('click')
    await settle(2)

    expect(written).toEqual(['Copy me'])
    expect(useUiStore(pinia).toasts.map((t) => t.message)).toContain('Copied')
  })

  it('says so, as an error, when the text could not be copied', async () => {
    const target = theirs('Copy me')
    const chat = makeChat()
    serve({ chat, messages: [target] })
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => Promise.reject(new Error('denied')) }, configurable: true })
    document.execCommand = vi.fn(() => false)
    const { wrapper, pinia } = await open({ chat, messages: [target] })

    await toolbarButton(wrapper, 'Copy me', 'Copy')?.trigger('click')
    await settle(2)

    const toast = useUiStore(pinia).toasts.at(-1)
    expect(toast?.kind).toBe('error')
    expect(toast?.message).not.toBe('Copied')
  })

  it('leaves edit mode, with an empty box, when the message being edited is deleted elsewhere', async () => {
    const own = mine('Typo here')
    const chat = makeChat()
    serve({ chat, messages: [own] })
    const { wrapper, pinia } = await open({ chat, messages: [own] })
    await toolbarButton(wrapper, 'Typo here', 'Edit')?.trigger('click')
    await settle(2)
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('Typo here')

    // deleted on the person's phone, or by a group admin: what the `message.deleted` event does
    useMessagesStore(pinia).receiveDeleted(CHAT_ID, own.id)
    await settle(2)

    expect(useDraftsStore(pinia).get(CHAT_ID).editingId).toBeNull()
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('')
    expect(wrapper.text()).not.toContain('Editing')
  })

  it('Delete asks first, says it cannot be undone, and deletes only after "Delete"', async () => {
    const own = mine('Delete me')
    const chat = makeChat()
    const { calls } = serve({ chat, messages: [own] })
    const { wrapper } = await open({ chat, messages: [own] })

    await toolbarButton(wrapper, 'Delete me', 'Delete')?.trigger('click')
    await settle(2)
    const dialog = document.body.querySelector('[role=dialog]')
    expect(dialog?.textContent).toContain('This cannot be undone')
    expect(calls.some((c) => c.method === 'delete')).toBe(false)

    ;[...(dialog?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim() === 'Delete')?.click()
    await settle(4)

    expect(calls.find((c) => c.method === 'delete')?.url).toBe(`/messages/${own.id}`)
    expect(wrapper.text()).not.toContain('Delete me')
    expect(document.body.querySelector('[role=dialog]')).toBeNull()
  })

  it('keeps the message and shows the reason when the server refuses to delete it', async () => {
    const own = mine('Stays')
    const chat = makeChat()
    serve({ chat, messages: [own], extra: (call) => (call.method === 'delete' ? { status: 403, data: { message: 'You cannot delete this message.' } } : undefined) })
    const { wrapper } = await open({ chat, messages: [own] })

    await toolbarButton(wrapper, 'Stays', 'Delete')?.trigger('click')
    await settle(2)
    ;[...document.body.querySelectorAll<HTMLButtonElement>('[role=dialog] button')].find((b) => b.textContent?.trim() === 'Delete')?.click()
    await settle(4)

    expect(document.body.querySelector('[role=dialog]')?.textContent).toContain('You cannot delete this message.')
    expect(wrapper.text()).toContain('Stays')
  })

  it('lets a group admin delete someone else’s message', async () => {
    const chat = makeChat({ type: 'group', name: 'G', other_user: undefined, my_membership: { ...makeChat().my_membership, role: 'admin' }, members: [makeMember(person(PAW, 'Naw Paw Say'))] })
    const target = theirs('Not allowed here')
    serve({ chat, messages: [target] })
    const { wrapper } = await open({ chat, messages: [target] })

    expect(toolbarButton(wrapper, 'Not allowed here', 'Delete')?.exists()).toBe(true)
  })
})

describe('the full-size picture', () => {
  const photo = (signature: string) =>
    makeMessage({
      id: 'photo-1',
      type: 'image',
      content: null,
      attachment: { id: 'a1', original_name: 'p.png', mime_type: 'image/png', size: 10, url: `https://x/file?sig=${signature}`, thumbnail_url: `https://x/thumb?sig=${signature}`, created_at: 'x' },
    })

  it('asks for fresh links when its link has run out, and shows the picture with them', async () => {
    const chat = makeChat()
    const { calls } = serve({ chat, messages: [photo('old')], extra: (call) => (call.url === '/messages/photo-1' ? { data: { data: photo('new') } } : undefined) })
    const { wrapper } = await open({ chat, messages: [photo('old')] })
    await wrapper.get('button[aria-label="Open photo"]').trigger('click')
    await settle(2)
    const big = () => document.body.querySelector<HTMLImageElement>('[role=dialog] img')
    expect(big()?.getAttribute('src')).toBe('https://x/file?sig=old')

    big()?.dispatchEvent(new Event('error'))
    await settle(4)

    expect(calls.filter((c) => c.url === '/messages/photo-1')).toHaveLength(1)
    expect(big()?.getAttribute('src')).toBe('https://x/file?sig=new')
  })
})
