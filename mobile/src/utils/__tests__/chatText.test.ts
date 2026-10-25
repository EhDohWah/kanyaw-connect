// Ported from frontend/src/utils/__tests__/chatText.spec.ts.
import { ME, PAW, makeChat, makeMember, makeMessage, person } from '@/testing/factories'
import { i18n } from '@/i18n'
import { callNotice, chatAvatar, chatTitle, messagePreview, personById, systemText } from '@/utils/chatText'

const t = (key: string, named?: Record<string, unknown>) => i18n.t(key, named ?? {})

describe('chatTitle and chatAvatar', () => {
  it('uses the other person for a direct chat and the name for a group', () => {
    expect(chatTitle(makeChat(), 'Chat')).toBe('Naw Paw Say')
    expect(chatTitle(makeChat({ type: 'group', name: '  Committee ', other_user: undefined }), 'Chat')).toBe(
      'Committee',
    )
  })

  it('falls back to a word when there is no name', () => {
    expect(chatTitle(makeChat({ type: 'group', name: null, other_user: undefined }), 'Chat')).toBe('Chat')
  })

  it('shows the other person’s picture for a direct chat, initials from the name for a group', () => {
    const direct = chatAvatar(
      makeChat({ other_user: { ...person(PAW, 'Naw Paw Say'), avatar_thumb_url: 'https://x/t.webp' } }),
      'Chat',
    )
    expect(direct).toMatchObject({ name: 'Naw Paw Say', src: 'https://x/t.webp', seed: PAW })

    const group = chatAvatar(makeChat({ type: 'group', name: 'Committee', other_user: undefined }), 'Chat')
    expect(group.src).toBeNull()
    expect(group.name).toBe('Committee')
  })
})

describe('messagePreview', () => {
  const chat = (message: ReturnType<typeof makeMessage> | null, over = {}) =>
    makeChat({ latest_message: message, ...over })

  it('shows the text', () => {
    expect(messagePreview(chat(makeMessage({ content: 'See you   soon\nthen' })), ME, t)).toBe('See you soon then')
  })

  it('says "You:" for your own messages', () => {
    expect(messagePreview(chat(makeMessage({ sender_id: ME, content: 'On my way' })), ME, t)).toBe('You: On my way')
  })

  it('names the sender in a group', () => {
    const group = chat(makeMessage({ content: 'Hello all' }), { type: 'group', name: 'G', other_user: undefined })
    expect(messagePreview(group, ME, t)).toBe('Naw: Hello all')
  })

  it('describes pictures, voice messages and files, using the caption when there is one', () => {
    expect(messagePreview(chat(makeMessage({ type: 'image', content: null })), ME, t)).toBe('Photo')
    expect(messagePreview(chat(makeMessage({ type: 'image', content: 'The agenda' })), ME, t)).toBe('The agenda')
    expect(messagePreview(chat(makeMessage({ type: 'voice', content: null })), ME, t)).toBe('Voice message')
    expect(messagePreview(chat(makeMessage({ type: 'file', content: null })), ME, t)).toBe('File')
    expect(messagePreview(chat(makeMessage({ type: 'image', content: null, sender_id: ME })), ME, t)).toBe('You: Photo')
  })

  it('says "Encrypted message" for an encrypted chat, whatever it holds', () => {
    expect(messagePreview(chat(makeMessage({ content: null }), { is_encrypted: true }), ME, t)).toBe(
      'Encrypted message',
    )
    expect(messagePreview(chat(null, { is_encrypted: true }), ME, t)).toBe('Encrypted message')
  })

  it('has a line for a chat with no messages yet', () => {
    expect(messagePreview(chat(null), ME, t)).toBe('No messages yet')
  })
})

describe('systemText', () => {
  const notice = makeMessage({
    type: 'system',
    sender_id: null,
    sender: null,
    content: 'Saw Eh Doh started a video room',
    metadata: { event: 'room_created', room_id: 'r1', host_id: ME },
  })

  it('builds the sentence from the host’s name, in the app’s language', () => {
    expect(systemText(notice, t, () => 'Saw Eh Doh')).toBe('Saw Eh Doh started a video meeting')
  })

  it('falls back to the server’s own sentence when the host’s name is not known here', () => {
    expect(systemText(notice, t, () => undefined)).toBe('Saw Eh Doh started a video room')
  })

  it('shows the server’s text for events it does not know', () => {
    expect(
      systemText(
        makeMessage({ type: 'system', content: 'Something happened', metadata: { event: 'new_thing' } }),
        t,
        () => undefined,
      ),
    ).toBe('Something happened')
  })
})

describe('personById', () => {
  it('finds someone among the members, or the other side of a direct chat', () => {
    const group = makeChat({
      type: 'group',
      other_user: undefined,
      members: [makeMember(person(ME, 'Saw Eh Doh')), makeMember(person(PAW, 'Naw Paw Say'))],
    })
    expect(personById(group, PAW)?.name).toBe('Naw Paw Say')
    expect(personById(makeChat(), PAW)?.name).toBe('Naw Paw Say')
    expect(personById(makeChat(), 'nobody')).toBeUndefined()
  })
})

describe('call notices, from your side of the call', () => {
  const call = (meta: Record<string, unknown>) =>
    makeMessage({
      type: 'system',
      sender: null,
      sender_id: null,
      content: 'English fallback',
      metadata: { event: 'call', call_id: 'c', duration_seconds: null, end_reason: null, ...meta },
    })
  const text = (meta: Record<string, unknown>) => systemText(call(meta), t, () => undefined, ME)

  it.each([
    // [status, end_reason, who called, kind, what you read]
    ['missed', 'no_answer', PAW, 'voice', 'Missed voice call'],
    ['missed', 'cancelled', PAW, 'video', 'Missed video call'],
    ['missed', 'no_answer', ME, 'voice', 'Voice call · No answer'],
    ['missed', 'cancelled', ME, 'voice', 'Voice call · Cancelled'],
    ['declined', null, PAW, 'voice', 'Declined voice call'],
    ['declined', null, ME, 'video', 'Video call · Declined'],
  ] as const)('%s (%s), called by %s, %s: "%s"', (status, reason, caller, kind, expected) => {
    expect(text({ status, end_reason: reason, caller_id: caller, kind })).toBe(expected)
  })

  it('an answered call gives its length, with an incoming or outgoing arrow', () => {
    expect(text({ status: 'ended', end_reason: 'hung_up', caller_id: PAW, kind: 'voice', duration_seconds: 192 })).toBe(
      'Voice call · 3:12',
    )
    expect(
      callNotice(call({ status: 'ended', caller_id: PAW, kind: 'voice', duration_seconds: 192 }), ME),
    ).toMatchObject({ incoming: true, missedByYou: false, time: '3:12' })
    expect(
      callNotice(call({ status: 'ended', caller_id: ME, kind: 'video', duration_seconds: 3723 }), ME),
    ).toMatchObject({ incoming: false, time: '1:02:03' })
  })

  it('only a call you missed is marked as missed (the danger colour)', () => {
    expect(callNotice(call({ status: 'missed', caller_id: PAW, kind: 'voice' }), ME)?.missedByYou).toBe(true)
    expect(callNotice(call({ status: 'missed', caller_id: ME, kind: 'voice' }), ME)?.missedByYou).toBe(false)
  })

  it("anything it does not understand falls back to the server's English sentence", () => {
    expect(callNotice(call({ status: 'ringing', caller_id: PAW, kind: 'voice' }), ME)).toBeNull()
    expect(callNotice(call({ status: 'ended', caller_id: PAW, kind: 'hologram' }), ME)).toBeNull()
    expect(text({ status: 'weird', caller_id: PAW, kind: 'voice' })).toBe('English fallback')
    expect(
      callNotice(makeMessage({ type: 'text', metadata: { event: 'call', kind: 'voice', status: 'ended' } }), ME),
    ).toBeNull()
  })

  it('the chat list shows the same short text as the preview', () => {
    const missed = call({ status: 'missed', end_reason: 'no_answer', caller_id: PAW, kind: 'video' })
    expect(messagePreview(makeChat({ latest_message: missed }), ME, t)).toBe('Missed video call')
    const mine = call({ status: 'ended', end_reason: 'hung_up', caller_id: ME, kind: 'voice', duration_seconds: 65 })
    expect(messagePreview(makeChat({ latest_message: mine }), ME, t)).toBe('Voice call · 1:05')
  })
})
