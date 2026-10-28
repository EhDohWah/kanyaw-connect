import { act, fireEvent, screen, waitFor } from '@testing-library/react-native'
import * as SecureStore from 'expo-secure-store'
import { Alert } from 'react-native'

import { i18n } from '@/i18n'
import { useAuthStore } from '@/stores/auth'
import { useChatsStore } from '@/stores/chats'
import { useDraftsStore } from '@/stores/drafts'
import { useMessagesStore } from '@/stores/messages'
import { useTypingStore } from '@/stores/typing'
import type { Chat, Message } from '@/types/chat'
import { CHAT_ID, ME, PAW, makeChat, makeMessage, makeUser, page, person } from '@/testing/factories'
import { echoes, lastEcho } from '@/testing/fakeEcho'
import { fakeApi, restoreApi, type Call, type Reply } from '@/testing/fakeApi'
import { renderApp } from '@/testing/renderApp'

jest.mock('@/realtime/echo', () => ({
  createEcho: (token: string) => jest.requireActual('@/testing/fakeEcho').fakeEchoFactory(token),
}))
jest.mock('expo-device', () => ({ modelName: 'Pixel 7' }))
jest.setTimeout(20_000)

const store = SecureStore as unknown as { __reset(): void }
const initialAuth = useAuthStore.getState()

interface ServerOptions {
  chat?: Chat
  history?: Message[]
  /** Answers for sends; the default echoes the message back as saved. */
  send?: (call: Call) => Reply
  extra?: (call: Call) => Reply | undefined
}

/** The server for one chat with Naw Paw Say. Returns the recorded calls. */
function server(options: ServerOptions = {}) {
  const chat = options.chat ?? makeChat({ latest_message: options.history?.at(-1) ?? null })
  let saved = 0
  return fakeApi((call) => {
    const special = options.extra?.(call)
    if (special) return special
    if (call.url === '/me') return { data: { data: makeUser() } }
    if (call.url === '/chats') return { data: page([chat]) }
    if (call.url === `/chats/${CHAT_ID}` && call.method === 'get') return { data: { data: chat } }
    if (call.url === `/chats/${CHAT_ID}/messages` && call.method === 'get')
      return { data: page([...(options.history ?? [])].reverse()) }
    if (call.url === `/chats/${CHAT_ID}/messages` && call.method === 'post') {
      if (options.send) return options.send(call)
      const body = call.body as { client_id: string; content?: string; reply_to_id?: string }
      saved += 1
      return {
        status: 201,
        data: {
          data: makeMessage({
            id: `saved-${saved}`,
            sender_id: ME,
            content: body.content ?? null,
            client_id: body.client_id,
            reply_to_id: body.reply_to_id ?? null,
            created_at: '2026-03-14T10:00:00.000000Z',
          }),
        },
      }
    }
    if (call.url === `/chats/${CHAT_ID}/read`)
      return {
        data: {
          data: {
            chat_id: CHAT_ID,
            last_read_message_id: (call.body as { message_id: string }).message_id,
            last_read_at: 'x',
            unread_count: 0,
          },
        },
      }
    return { status: 204 }
  })
}

async function openChat(): Promise<void> {
  await SecureStore.setItemAsync('kc.token', '1|kept')
  await SecureStore.setItemAsync('kc.tokenExpiresAt', '2099-01-01T00:00:00+00:00')
  await renderApp(`/chats/${CHAT_ID}`)
  await waitFor(() => expect(useAuthStore.getState().status).toBe('signedIn'))
}

const sends = (calls: Call[]) => calls.filter((c) => c.method === 'post' && c.url === `/chats/${CHAT_ID}/messages`)

beforeEach(() => {
  store.__reset()
  useAuthStore.setState({
    ...initialAuth,
    status: 'restoring',
    token: null,
    user: null,
    bootError: null,
    endedReason: null,
  })
  useChatsStore.getState().reset()
  useMessagesStore.getState().reset()
  useDraftsStore.getState().reset()
  useTypingStore.getState().reset()
  void i18n.changeLanguage('en')
})
afterEach(() => {
  restoreApi()
  echoes.length = 0
  jest.restoreAllMocks()
})

describe('a conversation', () => {
  it('shows the history and the other person’s name', async () => {
    server({
      history: [
        makeMessage({ content: 'Are you coming on Saturday?' }),
        makeMessage({ sender_id: ME, content: 'Yes!' }),
      ],
    })
    await openChat()

    expect(await screen.findByText('Are you coming on Saturday?')).toBeOnTheScreen()
    expect(screen.getByText('Yes!')).toBeOnTheScreen()
    expect(screen.getAllByText('Naw Paw Say').length).toBeGreaterThan(0)
  })

  it('says hello when there are no messages yet', async () => {
    server({ history: [] })
    await openChat()
    expect(await screen.findByText('Say hello')).toBeOnTheScreen()
  })

  it('reports what was read when someone else wrote last', async () => {
    const last = makeMessage({ content: 'Hello' })
    const { calls } = server({ chat: makeChat({ unread_count: 1, latest_message: last }), history: [last] })
    await openChat()

    await waitFor(() => expect(calls.some((c) => c.url === `/chats/${CHAT_ID}/read`)).toBe(true))
    expect(calls.find((c) => c.url === `/chats/${CHAT_ID}/read`)?.body).toEqual({ message_id: last.id })
  })

  it('shows a notice instead of messages for an encrypted chat', async () => {
    server({ chat: makeChat({ is_encrypted: true }) })
    await openChat()
    expect(await screen.findByText('Encrypted chat')).toBeOnTheScreen()
  })
})

describe('sending', () => {
  it('sends the text with a client id and shows it, once', async () => {
    const { calls } = server({ history: [makeMessage({ content: 'Hi' })] })
    await openChat()
    await screen.findByText('Hi')

    await fireEvent.changeText(screen.getByLabelText('Write a message'), 'See you at 7')
    await fireEvent.press(screen.getByLabelText('Send message'))

    await waitFor(() => expect(sends(calls)).toHaveLength(1))
    expect(sends(calls)[0]?.body).toMatchObject({
      type: 'text',
      content: 'See you at 7',
      client_id: expect.any(String),
    })
    await waitFor(() => expect(screen.getAllByText('See you at 7')).toHaveLength(1))
    expect(screen.getByLabelText('Write a message').props.value).toBe('')
  })

  it('offers "Tap to retry" when a send fails, and the retry uses the same client id', async () => {
    let fail = true
    const { calls } = server({
      history: [makeMessage({ content: 'Hi' })],
      send: (call) => {
        const body = call.body as { client_id: string; content: string }
        return fail
          ? { status: 403, data: { message: 'You cannot post here.' } }
          : {
              status: 201,
              data: {
                data: makeMessage({ id: 'saved', sender_id: ME, content: body.content, client_id: body.client_id }),
              },
            }
      },
    })
    await openChat()
    await screen.findByText('Hi')

    await fireEvent.changeText(screen.getByLabelText('Write a message'), 'Hello again')
    await fireEvent.press(screen.getByLabelText('Send message'))
    expect(await screen.findByText('Tap to retry')).toBeOnTheScreen()
    expect(screen.getByText(/Not sent: You cannot post here\./)).toBeOnTheScreen()

    fail = false
    await fireEvent.press(screen.getByText('Tap to retry'))

    await waitFor(() => expect(screen.queryByText('Tap to retry')).toBeNull())
    const ids = sends(calls).map((c) => (c.body as { client_id: string }).client_id)
    expect(ids).toHaveLength(2)
    expect(ids[1]).toBe(ids[0])
    expect(screen.getAllByText('Hello again')).toHaveLength(1)
  })

  it('tells the others you are typing', async () => {
    server({ history: [makeMessage({ content: 'Hi' })] })
    await openChat()
    await screen.findByText('Hi')

    await fireEvent.changeText(screen.getByLabelText('Write a message'), 'H')

    const whispers = lastEcho().get(`presence-chat.${CHAT_ID}`)?.whispers ?? []
    expect(whispers).toContainEqual({ event: 'typing', data: { user_id: ME, typing: true } })
  })
})

describe('message actions', () => {
  it('replies to a message from the long-press menu', async () => {
    const original = makeMessage({ content: 'Who brings the food?' })
    const { calls } = server({ history: [original] })
    await openChat()

    await fireEvent(await screen.findByLabelText(/Who brings the food\?/), 'longPress')
    await fireEvent.press(await screen.findByText('Reply'))
    expect(await screen.findByText('Replying to Naw Paw Say')).toBeOnTheScreen()

    await fireEvent.changeText(screen.getByLabelText('Write a message'), 'I do')
    await fireEvent.press(screen.getByLabelText('Send message'))

    await waitFor(() => expect(sends(calls)[0]?.body).toMatchObject({ reply_to_id: original.id, content: 'I do' }))
  })

  it('edits your own message', async () => {
    const mine = makeMessage({ sender_id: ME, content: 'Meet at 6', created_at: new Date().toISOString() })
    const { calls } = server({
      history: [mine],
      extra: (call) =>
        call.method === 'patch' && call.url === `/messages/${mine.id}`
          ? { data: { data: { ...mine, content: 'Meet at 7', is_edited: true, edited_at: new Date().toISOString() } } }
          : undefined,
    })
    await openChat()

    await fireEvent(await screen.findByLabelText(/Meet at 6/), 'longPress')
    await fireEvent.press(await screen.findByText('Edit'))
    await waitFor(() => expect(screen.getByLabelText('Write a message').props.value).toBe('Meet at 6'))

    await fireEvent.changeText(screen.getByLabelText('Write a message'), 'Meet at 7')
    await fireEvent.press(screen.getByLabelText('Save changes'))

    await waitFor(() => expect(calls.find((c) => c.method === 'patch')?.body).toEqual({ content: 'Meet at 7' }))
    expect(await screen.findByText('Meet at 7')).toBeOnTheScreen()
    expect(sends(calls)).toHaveLength(0)
  })

  it('deletes a message after the phone asks to confirm', async () => {
    const mine = makeMessage({ sender_id: ME, content: 'Wrong chat, sorry' })
    const { calls } = server({ history: [makeMessage({ content: 'Hi' }), mine] })
    const confirm = jest.spyOn(Alert, 'alert').mockImplementation((_title, _text, buttons) => {
      buttons?.find((button) => button.style === 'destructive')?.onPress?.()
    })
    await openChat()

    await fireEvent(await screen.findByLabelText(/Wrong chat, sorry/), 'longPress')
    await fireEvent.press(await screen.findByText('Delete'))

    expect(confirm).toHaveBeenCalledWith('Delete this message?', expect.any(String), expect.any(Array))
    await waitFor(() => expect(calls.some((c) => c.method === 'delete' && c.url === `/messages/${mine.id}`)).toBe(true))
    await waitFor(() => expect(screen.queryByText('Wrong chat, sorry')).toBeNull())
  })
})

describe('live events', () => {
  it('shows a message that arrives on the chat’s channel, and who is typing', async () => {
    server({ chat: makeChat({ members: undefined }), history: [makeMessage({ content: 'Hi' })] })
    await openChat()
    await screen.findByText('Hi')
    const channel = await waitFor(() => {
      const found = lastEcho().get(`presence-chat.${CHAT_ID}`)
      if (!found) throw new Error('not subscribed yet')
      return found
    })

    await act(async () => channel.emitWhisper('typing', { user_id: PAW, typing: true }))
    expect(await screen.findByText('Naw Paw Say is typing…')).toBeOnTheScreen()

    await act(async () =>
      lastEcho()
        .get(`private-chat.${CHAT_ID}`)
        ?.emit('.message.sent', { message: makeMessage({ content: 'On my way', sender: person(PAW, 'Naw Paw Say') }) }),
    )
    expect(await screen.findByText('On my way')).toBeOnTheScreen()
    await waitFor(() => expect(screen.queryByText('Naw Paw Say is typing…')).toBeNull())
  })
})
