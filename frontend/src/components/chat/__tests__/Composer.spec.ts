import { flushPromises } from '@vue/test-utils'
import type { Pinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CHAT_ID, ME, PAW, fakeApi, makeChat, makeMessage, mountApp, restoreApi, settle, signedInStores, type Call } from '@/__tests__/helpers'
import Composer from '@/components/chat/Composer.vue'
import { realtime } from '@/realtime'
import { useDraftsStore } from '@/stores/drafts'
import { useMessagesStore } from '@/stores/messages'

const chat = makeChat()
const posts = (calls: Call[]) => calls.filter((c) => c.method === 'post' && c.url === `/chats/${CHAT_ID}/messages`)
const echo = (call: Call) => ({ status: 201, data: { data: makeMessage({ sender_id: ME, content: (call.body as { content?: string }).content ?? null, client_id: (call.body as { client_id?: string }).client_id }) } })

function mountComposer(setup: (pinia: Pinia) => void = () => undefined) {
  return mountApp(Composer, {
    props: { chat },
    prepare: (pinia) => {
      signedInStores(pinia)
      setup(pinia)
    },
  })
}

type Wrapper = Awaited<ReturnType<typeof mountComposer>>['wrapper']
const box = (wrapper: Wrapper) => wrapper.get('textarea')
const sendButton = (wrapper: Wrapper) => wrapper.get('button[type=submit]')

async function type(wrapper: Wrapper, text: string) {
  await box(wrapper).setValue(text)
}

/** A key pressed in the box, built by hand so that `isComposing` can be set. */
function press(wrapper: Wrapper, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  box(wrapper).element.dispatchEvent(event)
  return event
}

function pointerIs(kind: 'fine' | 'coarse') {
  window.matchMedia = vi.fn((query: string) => ({
    matches: kind === 'coarse' && query.includes('coarse'),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia
}

beforeEach(() => pointerIs('fine'))
afterEach(() => {
  restoreApi()
  vi.restoreAllMocks()
  // @ts-expect-error jsdom has no matchMedia: put things back the way they were
  delete window.matchMedia
})

describe('the box and the send button', () => {
  it('cannot send nothing: the button is off until there is text', async () => {
    const { wrapper } = await mountComposer()
    expect(sendButton(wrapper).attributes('disabled')).toBeDefined()

    await type(wrapper, '   ')
    expect(sendButton(wrapper).attributes('disabled')).toBeDefined()

    await type(wrapper, 'Hello')
    expect(sendButton(wrapper).attributes('disabled')).toBeUndefined()
  })

  it('has a label for the box and the buttons, and asks for at most 5000 characters', async () => {
    const { wrapper } = await mountComposer()

    expect(box(wrapper).attributes('aria-label')).toBe('Write a message')
    expect(box(wrapper).attributes('maxlength')).toBe('5000')
    expect(sendButton(wrapper).attributes('aria-label')).toBe('Send message')
    expect(wrapper.find('button[aria-label="Attach a file"]').exists()).toBe(true)
  })

  it('sends with the button, empties the box at once, and tells the conversation to scroll down', async () => {
    const { calls } = fakeApi(echo)
    const { wrapper } = await mountComposer()

    await type(wrapper, 'Hello there')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect((box(wrapper).element as HTMLTextAreaElement).value).toBe('')
    expect(posts(calls)[0]?.body).toMatchObject({ type: 'text', content: 'Hello there' })
    expect(wrapper.emitted('sent')).toHaveLength(1)
  })

  it('trims the text it sends', async () => {
    const { calls } = fakeApi(echo)
    const { wrapper } = await mountComposer()

    await type(wrapper, '  Hello  \n')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(posts(calls)[0]?.body).toMatchObject({ content: 'Hello' })
  })
})

describe('the Enter key', () => {
  it('sends with a keyboard and mouse', async () => {
    const { calls } = fakeApi(echo)
    const { wrapper } = await mountComposer()
    await type(wrapper, 'Via Enter')

    const event = press(wrapper, 'Enter')
    await flushPromises()

    expect(event.defaultPrevented).toBe(true)
    expect(posts(calls)).toHaveLength(1)
  })

  it('makes a new line with Shift+Enter', async () => {
    const { calls } = fakeApi(echo)
    const { wrapper } = await mountComposer()
    await type(wrapper, 'Line one')

    const event = press(wrapper, 'Enter', { shiftKey: true })
    await flushPromises()

    expect(event.defaultPrevented).toBe(false)
    expect(posts(calls)).toHaveLength(0)
  })

  it('does not send while an input method is choosing a word (Burmese and Karen keyboards use Enter for that)', async () => {
    const { calls } = fakeApi(echo)
    const { wrapper } = await mountComposer()
    await type(wrapper, 'မင်္ဂလာ')

    const event = press(wrapper, 'Enter', { isComposing: true })
    await flushPromises()

    expect(event.defaultPrevented).toBe(false)
    expect(posts(calls)).toHaveLength(0)
  })

  it('makes a new line on a touch screen, where the button sends', async () => {
    pointerIs('coarse')
    const { calls } = fakeApi(echo)
    const { wrapper } = await mountComposer()
    await type(wrapper, 'On my phone')

    const event = press(wrapper, 'Enter')
    await flushPromises()

    expect(event.defaultPrevented).toBe(false)
    expect(posts(calls)).toHaveLength(0)
  })

  it('does not send an empty box', async () => {
    const { calls } = fakeApi(echo)
    const { wrapper } = await mountComposer()

    press(wrapper, 'Enter')
    await flushPromises()

    expect(posts(calls)).toHaveLength(0)
  })
})

describe('files', () => {
  const pick = async (wrapper: Wrapper, file: File) => {
    const input = wrapper.get('input[type=file]')
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change')
  }

  it('shows the chosen file with its size and lets you take it back', async () => {
    const { wrapper } = await mountComposer()

    await pick(wrapper, new File(['hello'], 'agenda.txt', { type: 'text/plain' }))
    expect(wrapper.text()).toContain('agenda.txt')
    expect(wrapper.text()).toContain('5 B')
    expect(wrapper.get('textarea').attributes('placeholder')).toBe('Add a caption')

    await wrapper.get('button[aria-label="Remove attachment"]').trigger('click')
    expect(wrapper.text()).not.toContain('agenda.txt')
  })

  it('previews a picture', async () => {
    const { wrapper } = await mountComposer()

    await pick(wrapper, new File(['x'], 'p.png', { type: 'image/png' }))

    expect(wrapper.get('form img').attributes('src')).toBe('blob:preview')
  })

  it('refuses a file over 25 MB before anything goes up', async () => {
    const { calls } = fakeApi(echo)
    const { wrapper } = await mountComposer()
    const big = new File(['x'], 'big.mov', { type: 'video/quicktime' })
    Object.defineProperty(big, 'size', { value: 26 * 1024 * 1024 })

    await pick(wrapper, big)

    expect(wrapper.get('[role=alert]').text()).toBe('That file is larger than 25 MB.')
    expect(wrapper.text()).not.toContain('big.mov')
    expect(calls).toHaveLength(0)
  })

  it('can send a file with no caption, and uploads it as the right kind of message', async () => {
    const { calls } = fakeApi((call) =>
      call.url.endsWith('/attachments')
        ? { status: 201, data: { data: { id: 'att-1', original_name: 'p.png', mime_type: 'image/png', size: 1, url: 'u', thumbnail_url: null, created_at: 'x' } } }
        : echo(call),
    )
    const { wrapper } = await mountComposer()
    await pick(wrapper, new File(['x'], 'p.png', { type: 'image/png' }))
    expect(sendButton(wrapper).attributes('disabled')).toBeUndefined()

    await wrapper.get('form').trigger('submit')
    await settle()

    expect(calls[0]?.url).toBe(`/chats/${CHAT_ID}/attachments`)
    expect(posts(calls)[0]?.body).toMatchObject({ type: 'image', metadata: { attachment_id: 'att-1' } })
    expect(wrapper.text()).not.toContain('p.png') // the chip is gone once sent
  })
})

describe('replying', () => {
  const original = makeMessage({ content: 'Are you coming on Saturday?' })
  const withOriginal = (pinia: Pinia) => {
    useMessagesStore(pinia).ensureTimeline(CHAT_ID).messages = [original]
  }

  it('shows who is being answered and what they said, with a way out', async () => {
    const { wrapper, pinia } = await mountComposer(withOriginal)

    useDraftsStore(pinia).get(CHAT_ID).replyToId = original.id
    await settle(2)

    expect(wrapper.text()).toContain('Replying to Naw Paw Say')
    expect(wrapper.text()).toContain('Are you coming on Saturday?')

    await wrapper.get('button[aria-label="Cancel reply"]').trigger('click')
    expect(wrapper.text()).not.toContain('Replying to')
    expect(useDraftsStore(pinia).get(CHAT_ID).replyToId).toBeNull()
  })

  it('names you as "You" when answering your own message', async () => {
    const mine = makeMessage({ sender_id: ME, content: 'My note' })
    const { wrapper, pinia } = await mountComposer((p) => {
      useMessagesStore(p).ensureTimeline(CHAT_ID).messages = [mine]
    })

    useDraftsStore(pinia).get(CHAT_ID).replyToId = mine.id
    await settle(2)

    expect(wrapper.text()).toContain('Replying to You')
  })

  it('sends the reply with its target and clears the bar', async () => {
    const { calls } = fakeApi(echo)
    const { wrapper, pinia } = await mountComposer(withOriginal)
    useDraftsStore(pinia).get(CHAT_ID).replyToId = original.id
    await settle(2)

    await type(wrapper, 'Yes')
    press(wrapper, 'Enter')
    await settle()

    expect(posts(calls)[0]?.body).toMatchObject({ content: 'Yes', reply_to_id: original.id })
    expect(useDraftsStore(pinia).get(CHAT_ID).replyToId).toBeNull()
  })

  it('Escape cancels the reply', async () => {
    const { wrapper, pinia } = await mountComposer(withOriginal)
    useDraftsStore(pinia).get(CHAT_ID).replyToId = original.id
    await settle(2)

    press(wrapper, 'Escape')
    await settle(2)

    expect(useDraftsStore(pinia).get(CHAT_ID).replyToId).toBeNull()
  })
})

describe('editing', () => {
  const mine = makeMessage({ sender_id: ME, content: 'Before', created_at: new Date().toISOString() })
  const start = async (setup: (pinia: Pinia) => void = () => undefined) => {
    const mounted = await mountComposer((p) => {
      useMessagesStore(p).ensureTimeline(CHAT_ID).messages = [mine]
      setup(p)
    })
    useDraftsStore(mounted.pinia).get(CHAT_ID).editingId = mine.id
    await settle(2)
    return mounted
  }

  it('fills the box with the message text and says what is happening', async () => {
    const { wrapper } = await start()

    expect((box(wrapper).element as HTMLTextAreaElement).value).toBe('Before')
    expect(wrapper.text()).toContain('Editing message')
    expect(wrapper.find('button[aria-label="Attach a file"]').exists()).toBe(false)
    expect(sendButton(wrapper).attributes('aria-label')).toBe('Save changes')
  })

  it('cannot save until something changed', async () => {
    const { wrapper } = await start()
    expect(sendButton(wrapper).attributes('disabled')).toBeDefined()

    await type(wrapper, 'After')
    expect(sendButton(wrapper).attributes('disabled')).toBeUndefined()
  })

  it('saves with the API and leaves edit mode', async () => {
    const { calls } = fakeApi(() => ({ data: { data: { ...mine, content: 'After', is_edited: true, edited_at: '2026-03-14T10:00:00.000000Z' } } }))
    const { wrapper, pinia } = await start()
    await type(wrapper, 'After')

    press(wrapper, 'Enter')
    await settle()

    expect(calls[0]).toMatchObject({ method: 'patch', url: `/messages/${mine.id}`, body: { content: 'After' } })
    expect(useDraftsStore(pinia).get(CHAT_ID).editingId).toBeNull()
    expect((box(wrapper).element as HTMLTextAreaElement).value).toBe('')
    expect(useMessagesStore(pinia).timeline(CHAT_ID)?.messages[0]?.content).toBe('After')
  })

  it('stays in edit mode and says why when the server refuses (for example after 24 hours)', async () => {
    fakeApi(() => ({ status: 403, data: { message: 'You can only edit a message for 24 hours.' } }))
    const { wrapper, pinia } = await start()
    await type(wrapper, 'After')

    press(wrapper, 'Enter')
    await settle()

    expect(wrapper.get('[role=alert]').text()).toBe('You can only edit a message for 24 hours.')
    expect(useDraftsStore(pinia).get(CHAT_ID).editingId).toBe(mine.id)
  })

  it('Escape leaves edit mode and empties the box', async () => {
    const { wrapper, pinia } = await start()

    press(wrapper, 'Escape')
    await settle(2)

    expect(useDraftsStore(pinia).get(CHAT_ID).editingId).toBeNull()
    expect((box(wrapper).element as HTMLTextAreaElement).value).toBe('')
  })
})

describe('typing signals', () => {
  it('tells the others you are typing, and that you stopped when the box is emptied or the message sent', async () => {
    fakeApi(echo)
    const spy = vi.spyOn(realtime, 'sendTyping').mockImplementation(() => undefined)
    const { wrapper } = await mountComposer()

    await type(wrapper, 'Hel')
    await box(wrapper).trigger('input')
    expect(spy).toHaveBeenLastCalledWith(CHAT_ID, ME, true)

    await type(wrapper, '')
    await box(wrapper).trigger('input')
    expect(spy).toHaveBeenLastCalledWith(CHAT_ID, ME, false)

    await type(wrapper, 'Done')
    await box(wrapper).trigger('input')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(spy).toHaveBeenLastCalledWith(CHAT_ID, ME, false)
  })

  it('says nothing while editing an old message', async () => {
    const spy = vi.spyOn(realtime, 'sendTyping').mockImplementation(() => undefined)
    const message = makeMessage({ sender_id: ME, content: 'Before', created_at: new Date().toISOString() })
    const { wrapper, pinia } = await mountComposer((p) => {
      useMessagesStore(p).ensureTimeline(CHAT_ID).messages = [message]
    })
    useDraftsStore(pinia).get(CHAT_ID).editingId = message.id
    await settle(2)
    spy.mockClear()

    await type(wrapper, 'Changed')
    await box(wrapper).trigger('input')

    expect(spy).not.toHaveBeenCalled()
  })
})

void PAW
