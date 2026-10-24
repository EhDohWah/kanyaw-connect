import type { Pinia } from 'pinia'
import { afterEach, describe, expect, it } from 'vitest'

import { ME, PAW, fakeApi, makeChat, makeMessage, mountApp, page, person, restoreApi, settle, signedInStores } from '@/__tests__/helpers'
import { ApiError } from '@/api/errors'
import ChatList from '@/components/chat/ChatList.vue'
import ChatListRow from '@/components/chat/ChatListRow.vue'
import { useChatsStore } from '@/stores/chats'
import { usePresenceStore } from '@/stores/presence'
import { useUiStore } from '@/stores/ui'

afterEach(restoreApi)

const mountRow = (chat = makeChat(), props = {}) =>
  mountApp(ChatListRow, { props: { chat, ...props }, prepare: (pinia) => signedInStores(pinia) })

describe('ChatListRow', () => {
  it('shows the person’s name, the latest message and its time', async () => {
    const { wrapper } = await mountRow(makeChat({ latest_message: makeMessage({ content: 'See you Saturday', created_at: new Date().toISOString() }) }))

    expect(wrapper.text()).toContain('Naw Paw Say')
    expect(wrapper.text()).toContain('See you Saturday')
  })

  it('says "You:" in front of your own message', async () => {
    const { wrapper } = await mountRow(makeChat({ latest_message: makeMessage({ sender_id: ME, content: 'On my way' }) }))

    expect(wrapper.text()).toContain('You: On my way')
  })

  it('shows an unread badge that screen readers read as a sentence, and 99+ for many', async () => {
    const few = await mountRow(makeChat({ unread_count: 3 }))
    expect(few.wrapper.text()).toContain('3')
    expect(few.wrapper.find('.sr-only').text()).toBe('3 unread messages')

    const many = await mountRow(makeChat({ unread_count: 250 }))
    expect(many.wrapper.text()).toContain('99+')
  })

  it('has no badge when everything is read', async () => {
    const { wrapper } = await mountRow(makeChat({ unread_count: 0 }))
    expect(wrapper.text()).not.toContain('unread')
  })

  it('shows an online dot for a direct chat when the other person is online, and says so in words after the name', async () => {
    const { wrapper, pinia } = await mountRow()
    expect(wrapper.find('span.bg-success').exists()).toBe(false)

    usePresenceStore(pinia).byId = { [PAW]: { id: PAW, status: 'online', last_seen_at: null } }
    await settle(2)

    expect(wrapper.find('span.bg-success').exists()).toBe(true)
    const text = wrapper.get('button').text()
    expect(text.indexOf('Naw Paw Say')).toBeLessThan(text.indexOf('Online'))
  })

  it('shows no online dot for a group', async () => {
    const { wrapper, pinia } = await mountRow(makeChat({ type: 'group', name: 'Committee', other_user: undefined }))
    usePresenceStore(pinia).byId = { [PAW]: { id: PAW, status: 'online', last_seen_at: null } }
    await settle(2)

    expect(wrapper.find('span.bg-success').exists()).toBe(false)
  })

  it('shows a lock and "Encrypted message" for an encrypted chat', async () => {
    const { wrapper } = await mountRow(makeChat({ is_encrypted: true, latest_message: makeMessage({ content: null }) }))

    expect(wrapper.text()).toContain('Encrypted message')
    expect(wrapper.find('svg.lucide-lock').exists()).toBe(true)
  })

  it('shows when a chat is pinned or muted (there is no control to change it)', async () => {
    const { wrapper } = await mountRow(makeChat({ my_membership: { ...makeChat().my_membership, pin_position: 1, is_muted: true }, unread_count: 2 }))

    expect(wrapper.find('svg.lucide-pin').exists()).toBe(true)
    expect(wrapper.find('svg.lucide-bell-off').exists()).toBe(true)
    expect(wrapper.text()).toContain('Pinned')
    expect(wrapper.text()).toContain('Muted')
  })

  it('marks the selected row, and tells the parent when it is chosen', async () => {
    const { wrapper } = await mountRow(makeChat(), { active: true })
    expect(wrapper.get('button').attributes('aria-current')).toBe('true')

    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('select')?.[0]).toEqual([makeChat().id])
  })
})

describe('ChatList', () => {
  const open = (setup: (pinia: Pinia) => void = () => undefined) =>
    mountApp(ChatList, {
      prepare: (pinia) => {
        signedInStores(pinia)
        setup(pinia)
      },
    })

  it('shows a loading placeholder before the first answer', async () => {
    const { wrapper } = await open()

    expect(wrapper.find('[role=status]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Loading')
  })

  it('shows an error with "Try again" that loads the list again', async () => {
    const { calls } = fakeApi(() => ({ data: page([makeChat()]) }))
    const { wrapper, pinia } = await open((p) => {
      const chats = useChatsStore(p)
      chats.status = 'error'
      chats.error = new ApiError({ status: 0, code: 'network', message: 'Network Error' })
    })

    expect(wrapper.text()).toContain("Can't reach the server")
    await wrapper.get('button').trigger('click')
    await settle()

    expect(calls.some((c) => c.url === '/chats')).toBe(true)
    expect(useChatsStore(pinia).status).toBe('ready')
  })

  it('suggests a first step when there are no chats, and the buttons open the dialogs', async () => {
    const { wrapper, pinia } = await open((p) => {
      useChatsStore(p).status = 'ready'
    })

    expect(wrapper.text()).toContain('No chats yet')
    const buttons = wrapper.findAll('button')
    await buttons.find((b) => b.text().includes('New chat'))?.trigger('click')
    await buttons.find((b) => b.text().includes('New group'))?.trigger('click')

    expect(useUiStore(pinia).newChatOpen).toBe(true)
    expect(useUiStore(pinia).newGroupOpen).toBe(true)
  })

  it('lists the chats most recent first and tells the parent which one was chosen', async () => {
    const { wrapper } = await open((p) => {
      const chats = useChatsStore(p)
      chats.status = 'ready'
      chats.put(makeChat({ id: 'old', other_user: person('a', 'Amy'), last_message_at: '2026-03-01T09:00:00Z' }))
      chats.put(makeChat({ id: 'new', other_user: person('b', 'Ben'), last_message_at: '2026-03-14T09:00:00Z' }))
    })

    const rows = wrapper.findAll('li button')
    expect(rows[0]?.text()).toContain('Ben')
    await rows[1]?.trigger('click')
    expect(wrapper.emitted('select')?.[0]).toEqual(['old'])
  })

  it('offers "Show more chats" when there is another page, and adds it', async () => {
    fakeApi(() => ({ data: page([makeChat({ id: 'first' })], 'http://api.test/api/v1/chats?cursor=2') }))
    const { wrapper, pinia } = await open()
    await useChatsStore(pinia).fetchChats()
    await settle(2)

    const more = wrapper.findAll('button').find((b) => b.text().includes('Show more chats'))
    expect(more).toBeDefined()

    fakeApi(() => ({ data: page([makeChat({ id: 'second', other_user: person('x', 'Xi'), last_message_at: '2026-01-01T00:00:00Z' })]) }))
    await more?.trigger('click')
    await settle()

    expect(useChatsStore(pinia).get('second')).toBeDefined()
    expect(wrapper.text()).not.toContain('Show more chats')
  })
})
