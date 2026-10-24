import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { lastEcho } from '@/__tests__/fakeEcho'
import { SUBSCRIPTION, useFakePush } from '@/__tests__/fakePush'
import { CHAT_ID, ME, PAW, fakeApi, makeChat, makeMember, makeMessage, makeRoom, makeUser, page, person, restoreApi, settle, signIn, type Call } from '@/__tests__/helpers'
import { useMessagingSession } from '@/composables/useMessagingSession'
import { realtime } from '@/realtime'
import { chatChannelHandlers } from '@/realtime/handlers'
import { useAuthStore } from '@/stores/auth'
import { useChatsStore } from '@/stores/chats'
import { useFeedStore } from '@/stores/feed'
import { useMessagesStore } from '@/stores/messages'
import { usePresenceStore } from '@/stores/presence'
import { PUSH_OWNER_KEY, usePushStore } from '@/stores/push'
import { useRealtimeStore } from '@/stores/realtime'
import { useRoomsStore } from '@/stores/rooms'
import { useTypingStore } from '@/stores/typing'
import { useUiStore } from '@/stores/ui'

const Host = defineComponent({
  setup() {
    useMessagingSession()
    return () => h('div')
  },
})

const direct = (over = {}) => makeChat({ latest_message: makeMessage({ sender_id: ME, content: 'earlier' }), ...over })

let chatsOnServer = [direct()]
const count = (calls: Call[], url: string) => calls.filter((c) => c.method === 'get' && c.url === url).length

function serve(extra: (call: Call) => ReturnType<Parameters<typeof fakeApi>[0]> | undefined = () => undefined) {
  return fakeApi(
    (call) =>
      extra(call) ??
      (call.url === '/chats' ? { data: page(chatsOnServer) } : call.url === '/users/presence' ? { data: { data: [{ id: PAW, status: 'online', last_seen_at: null }] } } : { data: {} }),
  )
}

const mounted: VueWrapper[] = []

async function start() {
  const auth = useAuthStore()
  auth.token = '1|secret-token'
  auth.user = makeUser({ id: ME })
  const wrapper = mount(Host)
  mounted.push(wrapper)
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  setActivePinia(createPinia())
  signIn()
  chatsOnServer = [direct()]
})
afterEach(() => {
  // A host left mounted would keep listening to the window's "online" event in the next test.
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  realtime.disconnect()
  restoreApi()
  vi.useRealTimers()
})

describe('starting and stopping', () => {
  it('connects with the token, listens on the user channel and loads the chat list', async () => {
    const { calls } = serve()
    await start()

    expect(lastEcho().token).toBe('1|secret-token')
    expect(lastEcho().get(`private-user.${ME}`)).toBeDefined()
    expect(count(calls, '/chats')).toBe(1)
    expect(useChatsStore().chats).toHaveLength(1)
  })

  it('asks who is online among the people it knows from the chats (after a short pause, so a burst is one lookup)', async () => {
    serve()
    await start()

    await vi.waitFor(() => expect(usePresenceStore().isOnline(PAW)).toBe(true))
  })

  it('closes the connection and forgets everything when it goes away (signing out)', async () => {
    serve()
    const wrapper = await start()
    const echo = lastEcho()

    wrapper.unmount()

    expect(echo.disconnected).toBe(true)
    expect(useChatsStore().chats).toEqual([])
    expect(usePresenceStore().isOnline(PAW)).toBe(false)
  })

  it('turns notifications back on for whoever had them on in this browser (signing out ended them)', async () => {
    window.localStorage.setItem(PUSH_OWNER_KEY, ME)
    useFakePush({ permission: 'granted' })
    const { calls } = serve((call) =>
      call.url === '/push/public-key'
        ? { data: { data: { enabled: true, public_key: 'BAfd' } } }
        : call.url === '/push/subscriptions' && call.method === 'post'
          ? { status: 201, data: { data: { id: 'sub-1', endpoint: SUBSCRIPTION.endpoint, created_at: '' } } }
          : undefined,
    )
    await start()
    await settle()

    expect(calls.filter((c) => c.method === 'post' && c.url === '/push/subscriptions')).toHaveLength(1)
    expect(usePushStore().status).toBe('on')
  })

  it('stops notifications on this browser when it goes away (signing out), so the next person does not get them', async () => {
    const fake = useFakePush({ permission: 'granted', subscription: SUBSCRIPTION })
    serve()
    const wrapper = await start()

    wrapper.unmount()
    await settle()

    expect(fake.unsubscribe).toHaveBeenCalled()
  })

  it('waits for the profile when it is not loaded yet, then connects', async () => {
    serve()
    const auth = useAuthStore()
    auth.token = '1|secret-token'
    const wrapper = mount(Host)
    mounted.push(wrapper)
    await flushPromises()
    expect(lastEchoOrNull()).toBeNull()

    auth.user = makeUser({ id: ME })
    await flushPromises()

    expect(lastEcho().token).toBe('1|secret-token')
    expect(wrapper.exists()).toBe(true)
  })
})

function lastEchoOrNull() {
  try {
    return lastEcho()
  } catch {
    return null
  }
}

describe('events change what is on screen', () => {
  it('a new message in a chat you are not looking at moves the preview and adds to the badge', async () => {
    serve()
    await start()

    lastEcho().get(`private-user.${ME}`)!.emit('.message.sent', { message: makeMessage({ content: 'Hi from Paw' }) })

    const chat = useChatsStore().get(CHAT_ID)
    expect(chat?.latest_message?.content).toBe('Hi from Paw')
    expect(chat?.unread_count).toBe(1)
  })

  it('counts a message once although it arrives on the user channel and on the open chat’s channel', async () => {
    serve()
    await start()
    const messages = useMessagesStore()
    messages.ensureTimeline(CHAT_ID).status = 'ready'
    realtime.watchChat(CHAT_ID, chatChannelHandlers(CHAT_ID))
    const event = { message: makeMessage({ content: 'Both channels' }) }

    lastEcho().get(`private-user.${ME}`)!.emit('.message.sent', event)
    lastEcho().get(`private-chat.${CHAT_ID}`)!.emit('.message.sent', event)

    expect(useChatsStore().get(CHAT_ID)?.unread_count).toBe(1)
    expect(messages.timeline(CHAT_ID)?.messages.filter((m) => m.content === 'Both channels')).toHaveLength(1)
  })

  it('clears the badge when you read the chat on another device', async () => {
    chatsOnServer = [direct({ unread_count: 3, latest_message: makeMessage({ id: 'last' }) })]
    serve()
    await start()

    lastEcho().get(`private-user.${ME}`)!.emit('.message.read', { chat_id: CHAT_ID, user_id: ME, last_read_message_id: 'last', last_read_at: 'x' })

    expect(useChatsStore().get(CHAT_ID)?.unread_count).toBe(0)
  })

  it('ignores another person’s "read" on your own list', async () => {
    chatsOnServer = [direct({ unread_count: 3, latest_message: makeMessage({ id: 'last' }) })]
    serve()
    await start()

    lastEcho().get(`private-user.${ME}`)!.emit('.message.read', { chat_id: CHAT_ID, user_id: PAW, last_read_message_id: 'last', last_read_at: 'x' })

    expect(useChatsStore().get(CHAT_ID)?.unread_count).toBe(3)
  })

  it('fetches a chat you were added to, and drops one you were removed from', async () => {
    const { calls } = serve((call) => (call.url === '/chats/new-chat' ? { data: { data: makeChat({ id: 'new-chat' }) } } : undefined))
    await start()
    const channel = lastEcho().get(`private-user.${ME}`)!

    channel.emit('.chat.member_added', { chat: { id: 'new-chat' }, user: { id: ME } })
    await flushPromises()
    expect(calls.some((c) => c.url === '/chats/new-chat')).toBe(true)
    expect(useChatsStore().get('new-chat')).toBeDefined()

    channel.emit('.chat.member_removed', { chat_id: 'new-chat', user_id: ME })
    expect(useChatsStore().get('new-chat')).toBeUndefined()
  })

  it('does not refetch anything when someone else joins a chat whose members are not on screen', async () => {
    const { calls } = serve()
    await start()

    lastEcho().get(`private-user.${ME}`)!.emit('.chat.member_added', { chat: { id: CHAT_ID }, user: { id: PAW } })
    await flushPromises()

    expect(calls.filter((c) => c.url === `/chats/${CHAT_ID}`)).toHaveLength(0)
  })

  it('applies a rename', async () => {
    chatsOnServer = [direct({ type: 'group', name: 'Old', other_user: undefined })]
    serve()
    await start()

    lastEcho().get(`private-user.${ME}`)!.emit('.chat.updated', { chat: { id: CHAT_ID, type: 'group', name: 'New', description: null, avatar_url: null, is_encrypted: false, member_count: 3, last_message_at: '2026-03-14T09:00:46.209458Z' } })

    expect(useChatsStore().get(CHAT_ID)?.name).toBe('New')
  })

  it('shows a typing indicator for 4 seconds after the last whisper, and hides it at once when they stop', async () => {
    vi.useFakeTimers()
    serve()
    await start()
    realtime.watchChat(CHAT_ID, chatChannelHandlers(CHAT_ID))
    const presence = lastEcho().get(`presence-chat.${CHAT_ID}`)!
    const typing = useTypingStore()

    presence.emitWhisper('typing', { user_id: PAW, typing: true })
    expect(typing.typingUserIds(CHAT_ID)).toEqual([PAW])

    vi.advanceTimersByTime(3000)
    presence.emitWhisper('typing', { user_id: PAW, typing: true }) // keeps it going
    vi.advanceTimersByTime(3000)
    expect(typing.typingUserIds(CHAT_ID)).toEqual([PAW])

    vi.advanceTimersByTime(1100)
    expect(typing.typingUserIds(CHAT_ID)).toEqual([])

    presence.emitWhisper('typing', { user_id: PAW, typing: true })
    presence.emitWhisper('typing', { user_id: PAW, typing: false })
    expect(typing.typingUserIds(CHAT_ID)).toEqual([])
  })

  it('never shows your own typing', async () => {
    serve()
    await start()
    realtime.watchChat(CHAT_ID, chatChannelHandlers(CHAT_ID))

    lastEcho().get(`presence-chat.${CHAT_ID}`)!.emitWhisper('typing', { user_id: ME, typing: true })

    expect(useTypingStore().typingUserIds(CHAT_ID)).toEqual([])
  })
})

describe('after the connection drops', () => {
  it('shows the offline banner state while it is down, and not while it first connects', async () => {
    serve()
    await start()
    const state = useRealtimeStore()
    expect(state.showOffline).toBe(false) // still "connecting" for the first time

    lastEcho().setStatus('connected')
    expect(state.showOffline).toBe(false)

    lastEcho().setStatus('disconnected')
    expect(state.showOffline).toBe(true)
    lastEcho().setStatus('connecting')
    expect(state.showOffline).toBe(true) // a reconnect attempt is still a problem
    lastEcho().setStatus('connected')
    expect(state.showOffline).toBe(false)
  })

  it('shows the banner when the browser itself is offline', async () => {
    serve()
    await start()
    lastEcho().setStatus('connected')

    window.dispatchEvent(new Event('offline'))
    expect(useRealtimeStore().showOffline).toBe(true)
    expect(useRealtimeStore().browserOnline).toBe(false)

    window.dispatchEvent(new Event('online'))
    expect(useRealtimeStore().showOffline).toBe(false)
  })

  it('refetches the chat list and the open chats when it comes back', async () => {
    const message = makeMessage({ content: 'one' })
    const { calls } = serve((call) => (call.url === `/chats/${CHAT_ID}/messages` ? { data: page([message]) } : undefined))
    await start()
    const messages = useMessagesStore()
    await messages.loadInitial(CHAT_ID)
    realtime.watchChat(CHAT_ID, chatChannelHandlers(CHAT_ID))
    lastEcho().setStatus('connected') // first connection
    await flushPromises()
    const listBefore = count(calls, '/chats')
    const historyBefore = count(calls, `/chats/${CHAT_ID}/messages`)

    lastEcho().setStatus('disconnected')
    chatsOnServer = [direct({ latest_message: makeMessage({ content: 'missed while away' }) })]
    lastEcho().setStatus('connected')
    await flushPromises()

    expect(count(calls, '/chats')).toBe(listBefore + 1)
    expect(count(calls, `/chats/${CHAT_ID}/messages`)).toBe(historyBefore + 1)
    expect(useChatsStore().get(CHAT_ID)?.latest_message?.content).toBe('missed while away')
  })

  it('refetches when the browser says it is back online', async () => {
    const { calls } = serve()
    await start()
    const before = count(calls, '/chats')

    window.dispatchEvent(new Event('online'))
    await flushPromises()

    expect(count(calls, '/chats')).toBe(before + 1)
  })
})

describe('what the sidebar needs', () => {
  const KLER = '0195e2c4-0005-7a04-8104-5f3a9c007bbc'

  it('looks up who is online among group members too, once for everyone who turned up together', async () => {
    const { calls } = serve()
    await start()
    await vi.waitFor(() => expect(count(calls, '/users/presence')).toBe(1))

    // two groups open one just after the other (separate answers from the server, a few milliseconds apart)
    const chats = useChatsStore()
    chats.put(makeChat({ id: 'g1', type: 'group', name: 'G1', other_user: undefined, members: [makeMember(person(ME, 'Eh Doh')), makeMember(person(KLER, 'Saw Kler Wah'))] }))
    await settle(2)
    chats.put(makeChat({ id: 'g2', type: 'group', name: 'G2', other_user: undefined, members: [makeMember(person(ME, 'Eh Doh')), makeMember(person('mu', 'Naw Mu Moo'))] }))

    await vi.waitFor(() => expect(count(calls, '/users/presence')).toBe(2))
    const last = calls.filter((call) => call.url === '/users/presence').at(-1)
    expect(decodeURIComponent(last?.uri ?? '')).toContain(`ids[]=${KLER}`)
    expect(decodeURIComponent(last?.uri ?? '')).toContain('ids[]=mu')
  })

  it('forgets the feed and the meetings when it goes away (signing out), so the next person starts clean', async () => {
    serve()
    const wrapper = await start()
    const feed = useFeedStore()
    const rooms = useRoomsStore()
    feed.dismissNote()
    rooms.upcoming = [makeRoom()]
    rooms.status = 'ready'

    wrapper.unmount()

    expect(feed.noteDismissed).toBe(false)
    expect(rooms.upcoming).toEqual([])
    expect(rooms.status).toBe('idle')
  })

  it('refreshes the upcoming meetings when a meeting is announced in a chat (and only then)', async () => {
    const { calls } = serve((call) => (call.url === '/rooms' ? { data: page([makeRoom()]) } : undefined))
    await start()
    const rooms = useRoomsStore()
    await rooms.fetchUpcoming()
    const before = count(calls, '/rooms')

    const announcement = makeMessage({ type: 'system', sender_id: null, sender: null, content: 'Naw Paw started a video room', metadata: { event: 'room_created', room_id: 'r1', host_id: PAW } })
    lastEcho().get(`private-user.${ME}`)!.emit('.message.sent', { message: announcement })
    await flushPromises()
    expect(count(calls, '/rooms')).toBe(before + 1)

    lastEcho().get(`private-user.${ME}`)!.emit('.message.sent', { message: makeMessage({ content: 'just words' }) })
    await flushPromises()
    expect(count(calls, '/rooms')).toBe(before + 1)
  })

  it('does not fetch meetings for an announcement when the list was never shown', async () => {
    const { calls } = serve((call) => (call.url === '/rooms' ? { data: page([]) } : undefined))
    await start()

    const announcement = makeMessage({ type: 'system', sender_id: null, sender: null, metadata: { event: 'room_created', room_id: 'r1', host_id: PAW } })
    lastEcho().get(`private-user.${ME}`)!.emit('.message.sent', { message: announcement })
    await flushPromises()

    expect(count(calls, '/rooms')).toBe(0)
  })
})

describe('what belongs to one person', () => {
  it('closes the chat drawer and forgets which chat it showed when the person signs out', async () => {
    serve()
    const wrapper = await start()
    const ui = useUiStore()
    ui.openDrawer(CHAT_ID)
    ui.newChatOpen = true

    wrapper.unmount()

    expect(ui.drawer).toEqual({ open: false, chatId: null })
    expect(JSON.parse(window.localStorage.getItem('kc.drawer') ?? '{}')).toEqual({ open: false, chatId: null })
    expect(ui.newChatOpen).toBe(false)
  })

  it('ends someone’s "is typing" as soon as their message arrives (the "stopped" whisper may have been lost)', async () => {
    serve()
    await start()
    const typing = useTypingStore()
    typing.receive(CHAT_ID, PAW, true)
    expect(typing.typingUserIds(CHAT_ID)).toEqual([PAW])

    lastEcho().get(`private-user.${ME}`)!.emit('.message.sent', { message: makeMessage({ sender_id: PAW, content: 'Here it is' }) })

    expect(typing.typingUserIds(CHAT_ID)).toEqual([])
  })
})
