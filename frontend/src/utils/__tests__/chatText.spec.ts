import { describe, expect, it } from 'vitest'

import { ME, PAW, makeChat, makeMember, makeMessage, person } from '@/__tests__/helpers'
import { i18n } from '@/i18n'
import { chatAvatar, chatTitle, messagePreview, personById, systemText } from '@/utils/chatText'

const t = (key: string, named?: Record<string, unknown>) => i18n.global.t(key, named ?? {})

describe('chatTitle and chatAvatar', () => {
  it('uses the other person for a direct chat and the name for a group', () => {
    expect(chatTitle(makeChat(), 'Chat')).toBe('Naw Paw Say')
    expect(chatTitle(makeChat({ type: 'group', name: '  Committee ', other_user: undefined }), 'Chat')).toBe('Committee')
  })

  it('falls back to a word when there is no name', () => {
    expect(chatTitle(makeChat({ type: 'group', name: null, other_user: undefined }), 'Chat')).toBe('Chat')
  })

  it('shows the other person’s picture for a direct chat, initials from the name for a group', () => {
    const direct = chatAvatar(makeChat({ other_user: { ...person(PAW, 'Naw Paw Say'), avatar_thumb_url: 'https://x/t.webp' } }), 'Chat')
    expect(direct).toMatchObject({ name: 'Naw Paw Say', src: 'https://x/t.webp', seed: PAW })

    const group = chatAvatar(makeChat({ type: 'group', name: 'Committee', other_user: undefined }), 'Chat')
    expect(group.src).toBeNull()
    expect(group.name).toBe('Committee')
  })
})

describe('messagePreview', () => {
  const chat = (message: ReturnType<typeof makeMessage> | null, over = {}) => makeChat({ latest_message: message, ...over })

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
    expect(messagePreview(chat(makeMessage({ content: null }), { is_encrypted: true }), ME, t)).toBe('Encrypted message')
    expect(messagePreview(chat(null, { is_encrypted: true }), ME, t)).toBe('Encrypted message')
  })

  it('has a line for a chat with no messages yet', () => {
    expect(messagePreview(chat(null), ME, t)).toBe('No messages yet')
  })
})

describe('systemText', () => {
  const notice = makeMessage({ type: 'system', sender_id: null, sender: null, content: 'Saw Eh Doh started a video room', metadata: { event: 'room_created', room_id: 'r1', host_id: ME } })

  it('builds the sentence from the host’s name, in the app’s language', () => {
    expect(systemText(notice, t, () => 'Saw Eh Doh')).toBe('Saw Eh Doh started a video meeting')
  })

  it('falls back to the server’s own sentence when the host’s name is not known here', () => {
    expect(systemText(notice, t, () => undefined)).toBe('Saw Eh Doh started a video room')
  })

  it('shows the server’s text for events it does not know', () => {
    expect(systemText(makeMessage({ type: 'system', content: 'Something happened', metadata: { event: 'new_thing' } }), t, () => undefined)).toBe('Something happened')
  })
})

describe('personById', () => {
  it('finds someone among the members, or the other side of a direct chat', () => {
    const group = makeChat({ type: 'group', other_user: undefined, members: [makeMember(person(ME, 'Saw Eh Doh')), makeMember(person(PAW, 'Naw Paw Say'))] })
    expect(personById(group, PAW)?.name).toBe('Naw Paw Say')
    expect(personById(makeChat(), PAW)?.name).toBe('Naw Paw Say')
    expect(personById(makeChat(), 'nobody')).toBeUndefined()
  })
})
