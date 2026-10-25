import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { useFakeLiveKit } from '@/__tests__/fakeLiveKit'
import { CHAT_ID, ME, PAW, fakeApi, makeChat, makeMessage, makeRoom, mountApp, person, restoreApi, settle, signedInStores, type Call } from '@/__tests__/helpers'
import ConversationHeader from '@/components/chat/ConversationHeader.vue'
import SystemNotice from '@/components/chat/SystemNotice.vue'
import { useDirectCallStore } from '@/stores/directCall'
import type { DirectCall } from '@/types/call'

useFakeLiveKit()

const CALL = '0195e2c4-0030-7a2f-812f-5f3a9c05ade1'
let calls: Call[] = []

beforeEach(() => {
  calls = fakeApi((call) => {
    if (call.url === `/chats/${CHAT_ID}/calls`) {
      const kind = (call.body as { kind: DirectCall['kind'] }).kind
      return {
        status: 201,
        data: {
          data: {
            id: CALL, chat_id: CHAT_ID, room_id: 'room', kind, status: 'ringing', end_reason: null,
            caller: person(ME, 'Saw Eh Doh'), callee: person(PAW, 'Naw Paw Say'),
            created_at: new Date().toISOString(), ring_expires_at: new Date(Date.now() + 45_000).toISOString(),
            answered_at: null, ended_at: null, duration_seconds: null,
          },
        },
      }
    }
    if (call.url === '/rooms/room/join') return { data: { status: 'admitted', token: 't', livekit_url: 'ws://lk', room: makeRoom({ id: 'room' }) } }
    return { data: {} }
  }).calls
})

afterEach(() => {
  useDirectCallStore().reset()
  restoreApi()
})

const mountHeader = (chat = makeChat()) =>
  mountApp(ConversationHeader, { route: `/chats/${chat.id}`, props: { chat, variant: 'page' }, prepare: (pinia) => signedInStores(pinia) })

describe('the call buttons in a conversation', () => {
  it('a direct chat has Voice call and Video call, which ring the other person', async () => {
    const { wrapper } = await mountHeader()

    await wrapper.get('button[aria-label="Video call"]').trigger('click')
    await settle()

    expect(wrapper.find('button[aria-label="Voice call"]').exists()).toBe(true)
    expect(calls[0]).toMatchObject({ method: 'post', url: `/chats/${CHAT_ID}/calls`, body: { kind: 'video' } })
    // While that call is on, no second one can be started from here.
    expect(wrapper.get('button[aria-label="Voice call"]').attributes('disabled')).toBeDefined()
  })

  it('a group chat has none (meetings are for groups)', async () => {
    const { wrapper } = await mountHeader(makeChat({ type: 'group', name: 'Committee', other_user: undefined }))
    expect(wrapper.find('button[aria-label="Voice call"]').exists()).toBe(false)
    expect(wrapper.find('button[aria-label="Video call"]').exists()).toBe(false)
  })

  it('an encrypted chat has none (it is still only a notice in this app)', async () => {
    const { wrapper } = await mountHeader(makeChat({ is_encrypted: true }))
    expect(wrapper.find('button[aria-label="Voice call"]').exists()).toBe(false)
  })
})

describe('a call notice in the chat', () => {
  const notice = (meta: Record<string, unknown>) =>
    makeMessage({ type: 'system', sender: null, sender_id: null, content: 'Missed voice call', metadata: { event: 'call', call_id: CALL, end_reason: null, duration_seconds: null, ...meta } })

  async function mountNotice(meta: Record<string, unknown>) {
    return mountApp(
      { components: { SystemNotice }, props: ['message', 'chat'], template: '<ul><SystemNotice :message="message" :chat="chat" /></ul>' },
      { route: `/chats/${CHAT_ID}`, props: { message: notice(meta), chat: makeChat() }, prepare: (pinia) => signedInStores(pinia) },
    )
  }

  it('a call you missed is in the danger colour, with an incoming arrow for screen readers', async () => {
    const { wrapper } = await mountNotice({ status: 'missed', end_reason: 'no_answer', caller_id: PAW, kind: 'voice' })

    const line = wrapper.get('p')
    expect(line.text()).toContain('Missed voice call')
    expect(line.text()).toContain('Incoming:')
    expect(line.classes()).toContain('text-danger')
  })

  it('your own unanswered call reads "Voice call · No answer", outgoing, not in danger', async () => {
    const { wrapper } = await mountNotice({ status: 'missed', end_reason: 'no_answer', caller_id: ME, kind: 'voice' })
    expect(wrapper.get('p').text()).toContain('Voice call · No answer')
    expect(wrapper.get('p').text()).toContain('Outgoing:')
    expect(wrapper.get('p').classes()).not.toContain('text-danger')
  })

  it('Call back rings them again with the same kind of call', async () => {
    const { wrapper } = await mountNotice({ status: 'ended', end_reason: 'hung_up', caller_id: PAW, kind: 'video', duration_seconds: 192 })

    expect(wrapper.text()).toContain('Video call · 3:12')
    await wrapper.get('button[aria-label="Call back (video call)"]').trigger('click')
    await settle()

    expect(calls[0]).toMatchObject({ url: `/chats/${CHAT_ID}/calls`, body: { kind: 'video' } })
  })
})
