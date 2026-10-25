import { afterEach, describe, expect, it, vi } from 'vitest'

import { CHAT_ID, ME, PAW, makeChat, makeMember, makeMessage, mountApp, person, restoreApi, signedInStores } from '@/__tests__/helpers'
import { ApiError } from '@/api/errors'
import MessageRow from '@/components/chat/MessageRow.vue'
import SystemNotice from '@/components/chat/SystemNotice.vue'
import type { Chat, Message, TimelineMessage } from '@/types/chat'
import type { TimelineItem } from '@/utils/timeline'

afterEach(restoreApi)

type Item = Extract<TimelineItem, { kind: 'message' }>

function item(message: TimelineMessage, over: Partial<Item> = {}): Item {
  return { kind: 'message', key: message.id, message, own: message.sender_id === ME, firstInGroup: true, lastInGroup: true, ...over }
}

const group = (role: 'owner' | 'admin' | 'member' = 'member'): Chat =>
  makeChat({ type: 'group', name: 'Committee', other_user: undefined, my_membership: { ...makeChat().my_membership, role }, members: [makeMember(person(ME, 'Saw Eh Doh')), makeMember(person(PAW, 'Naw Paw Say'))] })

const mountRow = (message: TimelineMessage, chat = makeChat(), over: Partial<Item> = {}) =>
  mountApp(MessageRow, { props: { item: item(message, over), chat }, prepare: (pinia) => signedInStores(pinia) })

const failedMessage = (error: ApiError): TimelineMessage => ({
  ...makeMessage({ sender_id: ME, id: 'pending:c1', client_id: 'c1', content: 'Did not go' }),
  pending: { status: 'failed', clientId: 'c1', progress: null, error, draft: { type: 'text', content: 'Did not go', replyToId: null, file: null, attachmentId: null } },
})

describe('how a message looks', () => {
  it('shows your messages in the brand colour and other people’s in grey', async () => {
    const mine = await mountRow(makeMessage({ sender_id: ME }))
    const theirs = await mountRow(makeMessage())

    expect(mine.wrapper.find('.bg-primary').exists()).toBe(true)
    expect(theirs.wrapper.find('.bg-surface').exists()).toBe(true)
    expect(theirs.wrapper.find('.bg-primary').exists()).toBe(false)
  })

  it('shows the sender’s name above the first message of a run in a group, not in a direct chat', async () => {
    const inGroup = await mountRow(makeMessage(), group())
    const direct = await mountRow(makeMessage(), makeChat())

    expect(inGroup.wrapper.text()).toContain('Naw Paw Say')
    expect(direct.wrapper.text()).not.toContain('Naw Paw Say')
  })

  it('shows the person’s picture beside the last message of a run only', async () => {
    const last = await mountRow(makeMessage(), makeChat(), { lastInGroup: true })
    const middle = await mountRow(makeMessage(), makeChat(), { lastInGroup: false })

    expect(last.wrapper.text()).toContain('NS')
    expect(middle.wrapper.text()).not.toContain('NS')
  })

  it('shows the time under the last bubble of a run, and "edited" when it was', async () => {
    const edited = await mountRow(makeMessage({ is_edited: true, edited_at: '2026-03-14T10:00:00.000000Z' }))
    const notLast = await mountRow(makeMessage(), makeChat(), { lastInGroup: false })

    expect(edited.wrapper.text()).toContain('edited')
    expect(notLast.wrapper.text()).not.toMatch(/\d:\d\d/)
  })

  it('turns web addresses in the text into safe links', async () => {
    const { wrapper } = await mountRow(makeMessage({ content: 'Look: https://example.org/a.' }))

    const link = wrapper.get('a')
    expect(link.attributes('href')).toBe('https://example.org/a')
    expect(link.attributes('target')).toBe('_blank')
    expect(link.attributes('rel')).toContain('noopener')
    expect(wrapper.text()).toContain('Look:')
  })

  it('never turns text from a sender into markup', async () => {
    const { wrapper } = await mountRow(makeMessage({ content: '<img src=x onerror=alert(1)> <b>bold</b>' }))

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('b').exists()).toBe(false)
    expect(wrapper.text()).toContain('<b>bold</b>')
  })

  it('shows a quote of the message that was replied to, by name', async () => {
    const reply = makeMessage({ reply_to_id: 'x', reply_to: { id: 'x', sender_id: ME, type: 'text', content: 'Are you coming?', is_deleted: false } })
    const { wrapper } = await mountRow(reply, group())

    expect(wrapper.text()).toContain('You')
    expect(wrapper.text()).toContain('Are you coming?')
  })

  it('says so when the quoted message was deleted', async () => {
    const reply = makeMessage({ reply_to_id: 'x', reply_to: { id: 'x', sender_id: PAW, type: 'text', content: null, is_deleted: true } })
    const { wrapper } = await mountRow(reply)

    expect(wrapper.text()).toContain('This message was deleted')
  })
})

describe('pictures, voice and files', () => {
  const attachment = (over = {}) => ({ id: 'a1', original_name: 'agenda.png', mime_type: 'image/png', size: 2048, url: 'https://files/full.png', thumbnail_url: 'https://files/thumb.webp', created_at: 'x', ...over })

  it('shows the thumbnail in a fixed-shape button and tells the parent to open the viewer', async () => {
    const { wrapper } = await mountRow(makeMessage({ type: 'image', content: 'The agenda', attachment: attachment() }))

    const button = wrapper.get('button[aria-label="Open photo"]')
    expect(button.classes()).toContain('aspect-[4/3]')
    expect(button.get('img').attributes('src')).toBe('https://files/thumb.webp')
    expect(button.get('img').attributes('loading')).toBe('lazy')
    expect(wrapper.text()).toContain('The agenda')

    await button.trigger('click')
    expect(wrapper.emitted('openImage')).toBeTruthy()
  })

  it('uses the full picture while the thumbnail is not ready yet', async () => {
    const { wrapper } = await mountRow(makeMessage({ type: 'image', attachment: attachment({ thumbnail_url: null }) }))

    expect(wrapper.get('img').attributes('src')).toBe('https://files/full.png')
  })

  it('asks for fresh links when the picture cannot be loaded (they last an hour), and shows a fallback meanwhile', async () => {
    const { wrapper } = await mountRow(makeMessage({ type: 'image', attachment: attachment() }))

    await wrapper.get('img').trigger('error')

    expect(wrapper.emitted('expired')).toBeTruthy()
    expect(wrapper.text()).toContain('Photo unavailable')
  })

  it('shows its own voice player for a voice message: no browser controls, nothing downloaded until play', async () => {
    const expired = 'https://files/voice.webm?expires=1000&signature=abc'
    const { wrapper } = await mountRow(
      makeMessage({
        type: 'voice',
        content: null,
        metadata: { attachment_id: 'a1', duration_ms: 4200, waveform: new Array(48).fill(100) },
        attachment: attachment({ mime_type: 'audio/webm', original_name: 'voice.webm', thumbnail_url: null, url: expired }),
      }),
    )

    const audio = wrapper.get('audio')
    expect(audio.attributes('controls')).toBeUndefined()
    expect(audio.attributes('preload')).toBe('none')
    expect(audio.attributes('src')).toBe(expired)
    expect(wrapper.get('[role=group]').attributes('aria-label')).toBe('Voice message')
    expect(wrapper.findAll('[role=slider] span')).toHaveLength(48)
    expect(wrapper.text()).toContain('0:04')
    // The signed link has run out: the conversation is asked for a fresh one.
    await audio.trigger('error')
    expect(wrapper.emitted('expired')).toBeTruthy()
  })

  it('shows a file as a card with its name and size that downloads it', async () => {
    const { wrapper } = await mountRow(makeMessage({ type: 'file', content: null, attachment: attachment({ original_name: 'agenda.pdf', mime_type: 'application/pdf', size: 1536 * 1024, thumbnail_url: null }) }))

    const card = wrapper.get('a')
    expect(card.attributes('aria-label')).toBe('Download agenda.pdf')
    expect(card.attributes('download')).toBe('agenda.pdf')
    expect(card.attributes('href')).toBe('https://files/full.png')
    expect(card.text()).toContain('1.5 MB')
  })
})

describe('a message on its way, or that failed', () => {
  it('shows "Sending…" and dims the message', async () => {
    const sending: TimelineMessage = { ...failedMessage(new ApiError({ status: 0, message: 'x' })), pending: { status: 'sending', clientId: 'c1', progress: null, error: null, draft: { type: 'text', content: 'x', replyToId: null, file: null, attachmentId: null } } }
    const { wrapper } = await mountRow(sending)

    expect(wrapper.text()).toContain('Sending…')
    expect(wrapper.find('.opacity-70').exists()).toBe(true)
  })

  it('shows the upload percentage while a file goes up', async () => {
    const uploading: TimelineMessage = { ...makeMessage({ sender_id: ME }), pending: { status: 'sending', clientId: 'c1', progress: 42, error: null, draft: { type: 'file', content: '', replyToId: null, file: null, attachmentId: null } } }
    const { wrapper } = await mountRow(uploading)

    expect(wrapper.text()).toContain('Uploading 42%')
  })

  it('says why it failed, outlines the bubble, and offers "Tap to retry" and "Discard"', async () => {
    const { wrapper } = await mountRow(failedMessage(new ApiError({ status: 0, code: 'network', message: 'Network Error' })))

    expect(wrapper.get('[role=alert]').text()).toContain('Not sent')
    expect(wrapper.get('[role=alert]').text()).toContain("Can't reach the server")
    expect(wrapper.find('.ring-danger').exists()).toBe(true)

    await wrapper.findAll('button').find((b) => b.text() === 'Tap to retry')?.trigger('click')
    await wrapper.findAll('button').find((b) => b.text() === 'Discard')?.trigger('click')

    expect(wrapper.emitted('retry')?.[0]).toEqual(['c1'])
    expect(wrapper.emitted('discard')?.[0]).toEqual(['c1'])
  })

  it('shows the server’s own words when it refused the message', async () => {
    const { wrapper } = await mountRow(failedMessage(new ApiError({ status: 403, message: 'You are not a member of this chat.' })))

    expect(wrapper.get('[role=alert]').text()).toContain('You are not a member of this chat.')
  })

  it('offers only "Copy" on a message that has not been sent (you can get your text back, but not reply, edit or delete it)', async () => {
    const { wrapper } = await mountRow(failedMessage(new ApiError({ status: 0, message: 'x' })))

    expect(wrapper.findAll('[role=toolbar] button').map((b) => b.attributes('aria-label'))).toEqual(['Copy'])
  })
})

/** A finger touching an element. (jsdom has no PointerEvent: a mouse event with the one extra property the code reads.) */
function pointer(element: Element, type: string, x: number, y: number): void {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y })
  Object.defineProperty(event, 'pointerType', { value: 'touch' })
  element.dispatchEvent(event)
}

describe('actions on a message', () => {
  const labels = (wrapper: Awaited<ReturnType<typeof mountRow>>['wrapper']) =>
    wrapper.findAll('[role=toolbar] button').map((b) => b.attributes('aria-label'))

  it('offers reply, copy, edit and delete on your own recent message', async () => {
    const { wrapper } = await mountRow(makeMessage({ sender_id: ME, created_at: new Date().toISOString() }))

    expect(labels(wrapper)).toEqual(['Reply', 'Copy', 'Edit', 'Delete'])
  })

  it('offers only reply and copy on someone else’s message in a direct chat', async () => {
    const { wrapper } = await mountRow(makeMessage())

    expect(labels(wrapper)).toEqual(['Reply', 'Copy'])
  })

  it('also offers delete to a group admin, for anyone’s message', async () => {
    const { wrapper } = await mountRow(makeMessage(), group('admin'))

    expect(labels(wrapper)).toEqual(['Reply', 'Copy', 'Delete'])
  })

  it('tells the parent which action was chosen, for which message', async () => {
    const message = makeMessage()
    const { wrapper } = await mountRow(message)

    await wrapper.get('[role=toolbar] button[aria-label="Reply"]').trigger('click')

    expect(wrapper.emitted('action')?.[0]).toEqual(['reply', message.id])
  })

  it('has one button for keyboard and screen-reader users that opens the same list as a sheet', async () => {
    const message = makeMessage({ sender_id: ME, created_at: new Date().toISOString() })
    const { wrapper } = await mountRow(message)
    const button = wrapper.get('button[aria-label="Message actions"]')
    expect(button.classes()).toContain('sr-only') // visible only when it has the keyboard focus

    await button.trigger('click')
    const sheet = document.body.querySelector('[role=dialog]')
    expect(sheet).not.toBeNull()
    const items = [...(sheet?.querySelectorAll('ul button') ?? [])].map((b) => b.textContent?.trim())
    expect(items).toEqual(['Reply', 'Copy', 'Edit', 'Delete'])
  })

  it('opens the sheet after a long press with a finger, but not after a short tap', async () => {
    vi.useFakeTimers()
    try {
      const { wrapper } = await mountRow(makeMessage())
      const bubble = wrapper.get('.rounded-xl').element

      pointer(bubble, 'pointerdown', 10, 10)
      vi.advanceTimersByTime(200)
      pointer(bubble, 'pointerup', 10, 10)
      vi.advanceTimersByTime(1000)
      expect(document.body.querySelector('[role=dialog]')).toBeNull()

      pointer(bubble, 'pointerdown', 10, 10)
      vi.advanceTimersByTime(600)
      await wrapper.vm.$nextTick()
      expect(document.body.querySelector('[role=dialog]')).not.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not treat scrolling with a finger as a long press', async () => {
    vi.useFakeTimers()
    try {
      const { wrapper } = await mountRow(makeMessage())
      const bubble = wrapper.get('.rounded-xl').element

      pointer(bubble, 'pointerdown', 10, 10)
      pointer(bubble, 'pointermove', 10, 60)
      vi.advanceTimersByTime(1000)

      expect(document.body.querySelector('[role=dialog]')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('notices written by the server', () => {
  const notice = (over: Partial<Message> = {}) =>
    makeMessage({ type: 'system', sender_id: null, sender: null, content: 'Saw Eh Doh started a video room', metadata: { event: 'room_created', room_id: 'room-9', host_id: PAW }, ...over })

  it('says who started the meeting, and links to it', async () => {
    const { wrapper } = await mountApp(SystemNotice, { props: { message: notice(), chat: group() }, prepare: (p) => signedInStores(p) })

    expect(wrapper.text()).toContain('Naw Paw Say started a video meeting')
    const link = wrapper.get('a')
    expect(link.text()).toContain('Join meeting')
    expect(link.attributes('href')).toBe('/rooms/room-9')
  })

  it('says "You" when you are the host', async () => {
    const { wrapper } = await mountApp(SystemNotice, { props: { message: notice({ metadata: { event: 'room_created', room_id: 'r', host_id: ME } }), chat: group() }, prepare: (p) => signedInStores(p) })

    expect(wrapper.text()).toContain('You started a video meeting')
  })

  it('shows the server’s own text, with no button, for an event it does not know', async () => {
    const { wrapper } = await mountApp(SystemNotice, { props: { message: notice({ content: 'Something new happened', metadata: { event: 'new_thing' } }), chat: group() }, prepare: (p) => signedInStores(p) })

    expect(wrapper.text()).toContain('Something new happened')
    expect(wrapper.find('a').exists()).toBe(false)
  })
})

void CHAT_ID
