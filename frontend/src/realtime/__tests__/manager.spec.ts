import { afterEach, describe, expect, it, vi } from 'vitest'

import { echoes, fakeEchoFactory, lastEcho } from '@/__tests__/fakeEcho'
import { http, setSocketIdResolver } from '@/api/http'
import {
  RealtimeManager,
  TYPING_WHISPER_INTERVAL_MS,
  type ChatChannelHandlers,
  type MessagingHandlers,
  type RealtimeHooks,
  type RoomChannelHandlers,
  type UserChannelHandlers,
} from '@/realtime/manager'

const messagingHandlers = (): MessagingHandlers => ({
  messageSent: vi.fn(),
  messageRead: vi.fn(),
  chatUpdated: vi.fn(),
  chatMemberAdded: vi.fn(),
  chatMemberRemoved: vi.fn(),
})
const userHandlers = (): UserChannelHandlers => ({
  ...messagingHandlers(),
  roomAdmitted: vi.fn(),
  roomDenied: vi.fn(),
  roomJoinRequested: vi.fn(),
  callIncoming: vi.fn(),
  callChanged: vi.fn(),
})
const chatHandlers = (): ChatChannelHandlers => ({ ...messagingHandlers(), messageUpdated: vi.fn(), messageDeleted: vi.fn(), typing: vi.fn() })
const roomHandlers = (): RoomChannelHandlers => ({
  participantJoined: vi.fn(),
  participantLeft: vi.fn(),
  roleChanged: vi.fn(),
  joinRequested: vi.fn(),
  ended: vi.fn(),
})
const hooks = (): RealtimeHooks => ({ status: vi.fn(), connected: vi.fn() })

function make() {
  return { manager: new RealtimeManager(fakeEchoFactory), user: userHandlers(), h: hooks() }
}

afterEach(() => setSocketIdResolver(() => undefined))

describe('connecting', () => {
  it('opens one connection with the token and listens on the user’s private channel', () => {
    const { manager, user, h } = make()

    manager.connect('1|abc', 'u1', user, h)

    expect(echoes).toHaveLength(1)
    expect(lastEcho().token).toBe('1|abc')
    expect(lastEcho().get('private-user.u1')).toBeDefined()
  })

  it('passes each user event to its handler', () => {
    const { manager, user, h } = make()
    manager.connect('t', 'u1', user, h)
    const channel = lastEcho().get('private-user.u1')!

    channel.emit('.message.sent', { message: { id: 'm1' } })
    channel.emit('.message.read', { chat_id: 'c1' })
    channel.emit('.chat.updated', { chat: { id: 'c1' } })
    channel.emit('.chat.member_added', { chat: { id: 'c1' }, user: { id: 'u1' } })
    channel.emit('.chat.member_removed', { chat_id: 'c1', user_id: 'u1' })

    expect(user.messageSent).toHaveBeenCalledWith({ message: { id: 'm1' } })
    expect(user.messageRead).toHaveBeenCalledTimes(1)
    expect(user.chatUpdated).toHaveBeenCalledTimes(1)
    expect(user.chatMemberAdded).toHaveBeenCalledTimes(1)
    expect(user.chatMemberRemoved).toHaveBeenCalledWith({ chat_id: 'c1', user_id: 'u1' })
  })

  it('lets API requests carry the connection’s socket id (X-Socket-ID), and stops when disconnected', async () => {
    const { manager, user, h } = make()
    manager.connect('t', 'u1', user, h)
    lastEcho().setStatus('connected')

    let header: unknown
    const realAdapter = http.defaults.adapter
    http.defaults.adapter = async (config) => {
      header = config.headers.get('X-Socket-ID')
      return { data: {}, status: 200, statusText: '', headers: {}, config }
    }
    try {
      await http.post('/anything', {})
      expect(header).toBe('fake.socket')

      manager.disconnect()
      await http.post('/anything', {})
      expect(header).toBeUndefined()
    } finally {
      http.defaults.adapter = realAdapter
    }
  })

  it('reports the connection state, and says "connected" on the first connection and after each drop, not on every change', () => {
    const { manager, user, h } = make()
    manager.connect('t', 'u1', user, h)
    const echo = lastEcho()

    echo.setStatus('connected')
    echo.setStatus('connected') // a repeated notice is not a new connection
    expect(h.connected).toHaveBeenCalledTimes(1)

    echo.setStatus('disconnected')
    echo.setStatus('connecting')
    expect(h.connected).toHaveBeenCalledTimes(1)

    echo.setStatus('connected')
    expect(h.connected).toHaveBeenCalledTimes(2)
    expect(h.status).toHaveBeenCalledWith('disconnected')
  })

  it('closes the old connection and opens a new one when the token changes', () => {
    const { manager, user, h } = make()
    manager.connect('old-token', 'u1', user, h)
    const first = lastEcho()

    manager.connect('new-token', 'u1', user, h)

    expect(first.disconnected).toBe(true)
    expect(echoes).toHaveLength(2)
    expect(lastEcho().token).toBe('new-token')
  })

  it('stops listening to the old connection’s state once it is replaced', () => {
    const { manager, user, h } = make()
    manager.connect('a', 'u1', user, h)
    const first = lastEcho()
    manager.connect('b', 'u1', user, h)
    vi.mocked(h.connected).mockClear()

    first.setStatus('connected')

    expect(h.connected).not.toHaveBeenCalled()
  })

  it('disconnects on sign-out', () => {
    const { manager, user, h } = make()
    manager.connect('t', 'u1', user, h)

    manager.disconnect()

    expect(lastEcho().disconnected).toBe(true)
  })
})

describe('chats that are open', () => {
  it('listens on both the private and the presence channel of a chat', () => {
    const { manager, user, h } = make()
    manager.connect('t', 'u1', user, h)

    manager.watchChat('c1', chatHandlers())

    expect(lastEcho().get('private-chat.c1')).toBeDefined()
    expect(lastEcho().get('presence-chat.c1')).toBeDefined()
    expect(manager.watchedChatIds()).toEqual(['c1'])
  })

  it('passes chat events and typing whispers to the handlers', () => {
    const { manager, user, h } = make()
    manager.connect('t', 'u1', user, h)
    const handlers = chatHandlers()
    manager.watchChat('c1', handlers)
    const priv = lastEcho().get('private-chat.c1')!

    priv.emit('.message.sent', { message: { id: 'm1' } })
    priv.emit('.message.updated', { message: { id: 'm1' } })
    priv.emit('.message.deleted', { chat_id: 'c1', message_id: 'm1' })
    priv.emit('.message.read', { chat_id: 'c1' })
    priv.emit('.chat.updated', { chat: { id: 'c1' } })
    priv.emit('.chat.member_added', { chat: { id: 'c1' }, user: {} })
    priv.emit('.chat.member_removed', { chat_id: 'c1', user_id: 'x' })
    lastEcho().get('presence-chat.c1')!.emitWhisper('typing', { user_id: 'u2', typing: true })

    expect(handlers.messageSent).toHaveBeenCalledTimes(1)
    expect(handlers.messageUpdated).toHaveBeenCalledTimes(1)
    expect(handlers.messageDeleted).toHaveBeenCalledWith({ chat_id: 'c1', message_id: 'm1' })
    expect(handlers.messageRead).toHaveBeenCalledTimes(1)
    expect(handlers.chatUpdated).toHaveBeenCalledTimes(1)
    expect(handlers.chatMemberAdded).toHaveBeenCalledTimes(1)
    expect(handlers.chatMemberRemoved).toHaveBeenCalledTimes(1)
    expect(handlers.typing).toHaveBeenCalledWith({ user_id: 'u2', typing: true })
  })

  it('shares one subscription between several askers and leaves when the last lets go', () => {
    const { manager, user, h } = make()
    manager.connect('t', 'u1', user, h)
    const stopA = manager.watchChat('c1', chatHandlers())
    const stopB = manager.watchChat('c1', chatHandlers())

    stopA()
    expect(lastEcho().left).toEqual([])
    stopA() // letting go twice does nothing
    expect(lastEcho().left).toEqual([])

    stopB()
    expect(lastEcho().left).toEqual(['chat.c1'])
    expect(manager.watchedChatIds()).toEqual([])
  })

  it('never leaves the user channel when a chat is left', () => {
    const { manager, user, h } = make()
    manager.connect('t', 'u1', user, h)
    manager.watchChat('c1', chatHandlers())()

    expect(lastEcho().left).not.toContain('user.u1')
    expect(lastEcho().get('private-user.u1')).toBeDefined()
  })

  it('subscribes a chat asked for before the connection exists (screens appear before the shell connects)', () => {
    const { manager, user, h } = make()
    const handlers = chatHandlers()

    manager.watchChat('c1', handlers)
    expect(echoes).toHaveLength(0)

    manager.connect('t', 'u1', user, h)
    lastEcho().get('private-chat.c1')!.emit('.message.sent', { message: { id: 'm' } })

    expect(handlers.messageSent).toHaveBeenCalledTimes(1)
  })

  it('subscribes the open chats again on a new connection', () => {
    const { manager, user, h } = make()
    manager.connect('old', 'u1', user, h)
    const handlers = chatHandlers()
    manager.watchChat('c1', handlers)

    manager.connect('new', 'u1', user, h)

    lastEcho().get('private-chat.c1')!.emit('.message.sent', { message: { id: 'm' } })
    expect(handlers.messageSent).toHaveBeenCalledTimes(1)
  })

  it('forgets every watch on sign-out', () => {
    const { manager, user, h } = make()
    manager.connect('t', 'u1', user, h)
    manager.watchChat('c1', chatHandlers())

    manager.disconnect()

    expect(manager.watchedChatIds()).toEqual([])
  })
})

describe('typing whispers', () => {
  const ready = () => {
    const { manager, user, h } = make()
    manager.connect('t', 'u1', user, h)
    manager.watchChat('c1', chatHandlers())
    const whispers = () => lastEcho().get('presence-chat.c1')!.whispers
    return { manager, whispers }
  }

  it('sends at most one "typing" every 2 seconds', () => {
    const { manager, whispers } = ready()

    manager.sendTyping('c1', 'u1', true, 10_000)
    manager.sendTyping('c1', 'u1', true, 10_500)
    manager.sendTyping('c1', 'u1', true, 11_900)
    expect(whispers()).toHaveLength(1)

    manager.sendTyping('c1', 'u1', true, 10_000 + TYPING_WHISPER_INTERVAL_MS)
    expect(whispers()).toHaveLength(2)
    expect(whispers()[0]).toEqual({ event: 'typing', data: { user_id: 'u1', typing: true } })
  })

  it('always sends "stopped typing" at once, and then typing may start again immediately', () => {
    const { manager, whispers } = ready()

    manager.sendTyping('c1', 'u1', true, 10_000)
    manager.sendTyping('c1', 'u1', false, 10_100)
    manager.sendTyping('c1', 'u1', true, 10_200)

    expect(whispers().map((w) => w.data.typing)).toEqual([true, false, true])
  })

  it('sends nothing for a chat that is not open', () => {
    const { manager, whispers } = ready()

    manager.sendTyping('other', 'u1', true, 10_000)

    expect(whispers()).toHaveLength(0)
  })
})

describe('one-to-one calls', () => {
  it('hears call.incoming, and the four ways a call moves on, on the user channel', () => {
    const { manager, user, h } = make()
    manager.connect('t', 'u1', user, h)
    const channel = lastEcho().channels.get('private-user.u1')!
    const call = { id: 'c1', status: 'ringing' }

    channel.emit('.call.incoming', { call })
    for (const event of ['accepted', 'declined', 'missed', 'ended']) channel.emit(`.call.${event}`, { call: { ...call, status: event } })

    expect(user.callIncoming).toHaveBeenCalledWith({ call })
    expect(vi.mocked(user.callChanged).mock.calls.map(([event]) => event.call.status)).toEqual(['accepted', 'declined', 'missed', 'ended'])
  })
})

describe('video rooms', () => {
  it('hears "let in", "turned away" and "someone is waiting" on the user channel', () => {
    const { manager, user, h } = make()
    manager.connect('t', 'u1', user, h)
    const channel = lastEcho().channels.get('private-user.u1')!
    const room = { id: 'r1', name: 'Committee', type: 'scheduled', status: 'waiting', host_id: 'h', chat_id: null, is_locked: false }

    channel.emit('.room.admitted', { room })
    channel.emit('.room.denied', { room })
    channel.emit('.room.join_requested', { room_id: 'r1', user: { id: 'p', name: 'Paw' } })

    expect(user.roomAdmitted).toHaveBeenCalledWith({ room })
    expect(user.roomDenied).toHaveBeenCalledWith({ room })
    expect(user.roomJoinRequested).toHaveBeenCalledWith({ room_id: 'r1', user: { id: 'p', name: 'Paw' } })
  })

  it('joins the room\'s presence channel during a call and passes on its five events', () => {
    const { manager, user, h } = make()
    manager.connect('t', 'u1', user, h)
    const handlers = roomHandlers()

    manager.watchRoom('r1', handlers)
    const channel = lastEcho().channels.get('presence-room.r1')!
    channel.emit('.room.participant_joined', { room_id: 'r1', user: { id: 'p' }, role: 'participant' })
    channel.emit('.room.participant_left', { room_id: 'r1', user: { id: 'p' }, role: 'participant' })
    channel.emit('.room.role_changed', { room_id: 'r1', user_id: 'p', role: 'co_host', host_id: 'u1' })
    channel.emit('.room.join_requested', { room_id: 'r1', user: { id: 'q' } })
    channel.emit('.room.ended', { room_id: 'r1', ended_at: 'x' })

    expect(handlers.participantJoined).toHaveBeenCalledTimes(1)
    expect(handlers.participantLeft).toHaveBeenCalledTimes(1)
    expect(handlers.roleChanged).toHaveBeenCalledWith({ room_id: 'r1', user_id: 'p', role: 'co_host', host_id: 'u1' })
    expect(handlers.joinRequested).toHaveBeenCalledTimes(1)
    expect(handlers.ended).toHaveBeenCalledTimes(1)
  })

  it('leaves the room channel when the call ends, and only then', () => {
    const { manager, user, h } = make()
    manager.connect('t', 'u1', user, h)
    const stop = manager.watchRoom('r1', roomHandlers())

    stop()
    stop()

    expect(lastEcho().left).toEqual(['room.r1'])
  })

  it('a room asked for before the connection exists is joined when it connects, and again after a reconnect', () => {
    const { manager, user, h } = make()
    manager.watchRoom('r1', roomHandlers())

    manager.connect('t', 'u1', user, h)
    expect(lastEcho().channels.has('presence-room.r1')).toBe(true)

    manager.connect('t2', 'u1', user, h)
    expect(lastEcho().channels.has('presence-room.r1')).toBe(true)
  })

  it('a second room replaces the first; signing out forgets it', () => {
    const { manager, user, h } = make()
    manager.connect('t', 'u1', user, h)
    manager.watchRoom('r1', roomHandlers())

    manager.watchRoom('r2', roomHandlers())
    expect(lastEcho().left).toEqual(['room.r1'])

    manager.disconnect()
    manager.connect('t', 'u1', user, h)
    expect(lastEcho().channels.has('presence-room.r2')).toBe(false)
  })
})
