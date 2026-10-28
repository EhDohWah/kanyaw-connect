import { chatChannelHandlers, userChannelHandlers } from '@/realtime/handlers'
import { useAuthStore } from '@/stores/auth'
import { useChatsStore } from '@/stores/chats'
import { useMessagesStore } from '@/stores/messages'
import { TYPING_VISIBLE_MS, useTypingStore } from '@/stores/typing'
import { CHAT_ID, ME, PAW, makeChat, makeMessage, makeUser, person } from '@/testing/factories'
import { fakeApi, restoreApi } from '@/testing/fakeApi'

beforeEach(() => {
  useChatsStore.getState().reset()
  useMessagesStore.getState().reset()
  useTypingStore.getState().reset()
  useAuthStore.setState({ status: 'signedIn', token: '1|t', user: makeUser({ id: ME }) })
  useChatsStore.getState().put(makeChat())
})
afterEach(() => {
  restoreApi()
  jest.useRealTimers()
})

describe('events on the user channel', () => {
  it('a new message updates the list once, even when it arrives on two channels', async () => {
    await useMessagesStore
      .getState()
      .loadInitial(CHAT_ID)
      .catch(() => undefined)
    const message = makeMessage({ content: 'Hi' })

    userChannelHandlers().messageSent({ message })
    chatChannelHandlers(CHAT_ID).messageSent({ message })

    expect(useChatsStore.getState().get(CHAT_ID)).toMatchObject({ unread_count: 1, latest_message: { content: 'Hi' } })
  })

  it('a message ends the sender’s typing indicator', () => {
    useTypingStore.getState().receive(CHAT_ID, PAW, true)

    userChannelHandlers().messageSent({ message: makeMessage({ sender_id: PAW }) })

    expect(useTypingStore.getState().typingUserIds(CHAT_ID)).toEqual([])
  })

  it('reading on another of your devices clears the badge; someone else reading does not', () => {
    const latest = makeMessage()
    useChatsStore.getState().put(makeChat({ unread_count: 3, latest_message: latest }))
    const read = { chat_id: CHAT_ID, last_read_message_id: latest.id, last_read_at: '2026-03-14T10:00:00Z' }

    userChannelHandlers().messageRead({ ...read, user_id: PAW })
    expect(useChatsStore.getState().get(CHAT_ID)?.unread_count).toBe(3)

    userChannelHandlers().messageRead({ ...read, user_id: ME })
    expect(useChatsStore.getState().get(CHAT_ID)?.unread_count).toBe(0)
  })

  it('being removed from a chat takes it off the list and forgets its messages', () => {
    fakeApi(() => ({ data: { data: [], links: { next: null } } }))
    void useMessagesStore.getState().loadInitial(CHAT_ID)

    userChannelHandlers().chatMemberRemoved({ chat_id: CHAT_ID, user_id: ME })

    expect(useChatsStore.getState().get(CHAT_ID)).toBeUndefined()
    expect(useMessagesStore.getState().timeline(CHAT_ID)).toBeUndefined()
  })

  it('being added to a chat fetches it', async () => {
    const { calls } = fakeApi(() => ({ data: { data: makeChat({ id: 'new-chat' }) } }))

    userChannelHandlers().chatMemberAdded({ chat: { ...makeChat({ id: 'new-chat' }) }, user: person(ME, 'Saw Eh Doh') })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(calls[0]?.url).toBe('/chats/new-chat')
    expect(useChatsStore.getState().get('new-chat')).toBeDefined()
  })
})

describe('typing whispers', () => {
  it('shows someone typing for 4 seconds after their last whisper, and never yourself', () => {
    jest.useFakeTimers()
    const handlers = chatChannelHandlers(CHAT_ID)

    handlers.typing({ user_id: ME, typing: true })
    handlers.typing({ user_id: PAW, typing: true })
    expect(useTypingStore.getState().typingUserIds(CHAT_ID)).toEqual([PAW])

    jest.advanceTimersByTime(TYPING_VISIBLE_MS - 1)
    handlers.typing({ user_id: PAW, typing: true })
    jest.advanceTimersByTime(TYPING_VISIBLE_MS - 1)
    expect(useTypingStore.getState().typingUserIds(CHAT_ID)).toEqual([PAW])

    jest.advanceTimersByTime(1)
    expect(useTypingStore.getState().typingUserIds(CHAT_ID)).toEqual([])
  })

  it('"stopped typing" hides it at once', () => {
    const handlers = chatChannelHandlers(CHAT_ID)
    handlers.typing({ user_id: PAW, typing: true })
    handlers.typing({ user_id: PAW, typing: false })
    expect(useTypingStore.getState().typingUserIds(CHAT_ID)).toEqual([])
  })
})
