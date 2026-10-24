import { afterEach, describe, expect, it } from 'vitest'

import { ME, makeChat, makeMessage, mountApp, restoreApi, settle, signedInStores } from '@/__tests__/helpers'
import { ApiError } from '@/api/errors'
import MessageList from '@/components/chat/MessageList.vue'
import type { TimelineMessage } from '@/types/chat'

afterEach(restoreApi)

const today = () => new Date().toISOString()
const fresh = (over = {}): TimelineMessage => makeMessage({ created_at: today(), ...over })

const mountList = (messages: TimelineMessage[], props: Record<string, unknown> = {}) =>
  mountApp(MessageList, {
    props: { chat: makeChat(), messages, hasOlder: false, loadingOlder: false, olderError: null, ...props },
    prepare: (pinia) => signedInStores(pinia),
  })

/** jsdom has no layout: give the scrolling area a size, as a browser would. */
function size(wrapper: Awaited<ReturnType<typeof mountList>>['wrapper'], dimensions: { scrollHeight: number; clientHeight: number; scrollTop: number }) {
  const scroller = wrapper.get('.overflow-y-auto').element as HTMLElement
  for (const [key, value] of Object.entries(dimensions)) Object.defineProperty(scroller, key, { value, configurable: true, writable: true })
  return scroller
}

describe('what the list shows', () => {
  it('draws the messages as a list, with a "Today" line before the first', async () => {
    const { wrapper } = await mountList([fresh({ content: 'One' }), fresh({ content: 'Two' })])

    const items = wrapper.findAll('ol > li')
    expect(items[0]?.text()).toBe('Today')
    expect(wrapper.get('ol').attributes('aria-label')).toBe('Messages')
    expect(wrapper.text()).toContain('One')
    expect(wrapper.text()).toContain('Two')
  })

  it('invites the first message in an empty chat', async () => {
    const { wrapper } = await mountList([])

    expect(wrapper.text()).toContain('Say hello')
    expect(wrapper.find('ol').exists()).toBe(false)
  })

  it('does not call a chat empty while older messages are still to be loaded', async () => {
    const { wrapper } = await mountList([], { hasOlder: true })

    expect(wrapper.text()).not.toContain('Say hello')
  })

  it('shows a notice written by the server as a notice, not a bubble', async () => {
    const notice = fresh({ type: 'system', sender_id: null, sender: null, content: 'Naw Paw started a video room', metadata: { event: 'room_created', room_id: 'r1', host_id: null } })
    const { wrapper } = await mountList([notice])

    expect(wrapper.find('.bg-surface').exists()).toBe(false)
    expect(wrapper.text()).toContain('Naw Paw started a video room')
    expect(wrapper.text()).toContain('Join meeting')
  })

  it('groups consecutive messages: the time shows once, under the last one', async () => {
    const { wrapper } = await mountList([fresh({ content: 'a' }), fresh({ content: 'b' }), fresh({ content: 'c' })])

    expect(wrapper.text().match(/\d{1,2}:\d{2}/g)).toHaveLength(1)
  })
})

describe('older messages', () => {
  it('offers to load them, and asks the parent when pressed', async () => {
    const { wrapper } = await mountList([fresh()], { hasOlder: true })

    await wrapper.findAll('button').find((b) => b.text() === 'Load older messages')?.trigger('click')

    expect(wrapper.emitted('loadOlder')).toHaveLength(1)
  })

  it('shows progress while loading, and does not ask again meanwhile', async () => {
    const { wrapper } = await mountList([fresh()], { hasOlder: true, loadingOlder: true })

    expect(wrapper.text()).toContain('Loading older messages…')
    await wrapper.findAll('button').find((b) => b.text().includes('Loading older'))?.trigger('click')
    expect(wrapper.emitted('loadOlder')).toBeUndefined()
  })

  it('says when it failed, and keeps the button for another try', async () => {
    const { wrapper } = await mountList([fresh()], { hasOlder: true, olderError: new ApiError({ status: 0, message: 'x' }) })

    expect(wrapper.get('[role=alert]').text()).toBe('Older messages could not be loaded.')
    expect(wrapper.findAll('button').some((b) => b.text() === 'Load older messages')).toBe(true)
  })

  it('has no button when everything is loaded', async () => {
    const { wrapper } = await mountList([fresh()], { hasOlder: false })

    expect(wrapper.text()).not.toContain('Load older messages')
  })
})

describe('scrolling', () => {
  it('shows "Jump to latest" once scrolled away from the end, and reports it', async () => {
    const { wrapper } = await mountList([fresh()])
    expect(wrapper.text()).not.toContain('Jump to latest')

    const scroller = size(wrapper, { scrollHeight: 2000, clientHeight: 500, scrollTop: 0 })
    scroller.dispatchEvent(new Event('scroll'))
    await settle(2)

    expect(wrapper.emitted('atBottom')?.at(-1)).toEqual([false])
    expect(wrapper.text()).toContain('Jump to latest')
  })

  it('counts messages that arrive while scrolled up, and goes back to the end on request', async () => {
    const first = fresh({ content: 'first' })
    const { wrapper } = await mountList([first])
    const scroller = size(wrapper, { scrollHeight: 2000, clientHeight: 500, scrollTop: 0 })
    scroller.dispatchEvent(new Event('scroll'))
    await settle(2)

    await wrapper.setProps({ messages: [first, fresh({ content: 'second' })] })
    await settle(3)
    expect(wrapper.text()).toContain('1 new messages')

    await wrapper.get('button.absolute').trigger('click')
    expect(scroller.scrollTop).toBe(2000)
    scroller.dispatchEvent(new Event('scroll'))
    await settle(2)
    expect(wrapper.emitted('atBottom')?.at(-1)).toEqual([true])
    expect(wrapper.text()).not.toContain('Jump to latest')
  })

  it('stays at the end when a message arrives while you are at the end', async () => {
    const first = fresh()
    const { wrapper } = await mountList([first])
    const scroller = size(wrapper, { scrollHeight: 600, clientHeight: 500, scrollTop: 100 })
    scroller.dispatchEvent(new Event('scroll'))

    await wrapper.setProps({ messages: [first, fresh()] })
    await settle(3)

    expect(scroller.scrollTop).toBe(600)
    expect(wrapper.text()).not.toContain('new messages')
  })

  it('goes to the end when you write something yourself, even from higher up', async () => {
    const first = fresh()
    const { wrapper } = await mountList([first])
    const scroller = size(wrapper, { scrollHeight: 2000, clientHeight: 500, scrollTop: 0 })
    scroller.dispatchEvent(new Event('scroll'))
    await settle(2)

    await wrapper.setProps({ messages: [first, fresh({ sender_id: ME })] })
    await settle(3)

    expect(scroller.scrollTop).toBe(2000)
  })

  it('keeps what you were reading in place when older messages are added above it', async () => {
    const newer = [fresh({ content: 'newer' })]
    const { wrapper } = await mountList(newer, { hasOlder: true })
    const scroller = size(wrapper, { scrollHeight: 1000, clientHeight: 500, scrollTop: 0 })

    await wrapper.findAll('button').find((b) => b.text() === 'Load older messages')?.trigger('click')
    // the older page arrives: the content grows by 700px above what was on screen
    Object.defineProperty(scroller, 'scrollHeight', { value: 1700, configurable: true })
    await wrapper.setProps({ messages: [makeMessage({ created_at: '2020-01-01T00:00:00.000000Z', content: 'older' }), ...newer] })
    await settle(3)

    expect(scroller.scrollTop).toBe(700)
  })
})
