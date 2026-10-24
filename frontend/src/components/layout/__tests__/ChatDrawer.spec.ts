import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CHAT_ID, PAW, fakeApi, makeChat, makeMessage, mountApp, page, person, restoreApi, settle, signedInStores } from '@/__tests__/helpers'
import ChatDrawer from '@/components/layout/ChatDrawer.vue'
import { useChatsStore } from '@/stores/chats'
import { useUiStore } from '@/stores/ui'

function screenIs(wide: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: wide && query.includes('min-width: 1024px'),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia
}

beforeEach(() => screenIs(true))
afterEach(() => {
  restoreApi()
  // @ts-expect-error jsdom has no matchMedia: put things back the way they were
  delete window.matchMedia
})

function serve() {
  return fakeApi((call) => {
    if (call.url === `/chats/${CHAT_ID}`) return { data: { data: makeChat() } }
    if (call.url === `/chats/${CHAT_ID}/messages`) return { data: page([makeMessage({ content: 'Hello inside the drawer' })]) }
    return { status: 204 }
  })
}

const open = (route = '/', setup: (pinia: Parameters<NonNullable<Parameters<typeof mountApp>[1]>['prepare'] & object>[0]) => void = () => undefined) =>
  mountApp(ChatDrawer, {
    route,
    prepare: (pinia) => {
      signedInStores(pinia)
      const chats = useChatsStore(pinia)
      chats.status = 'ready'
      chats.put(makeChat({ unread_count: 3 }))
      setup(pinia)
    },
  })

describe('the chat drawer', () => {
  it('starts as a small tab that shows how many messages are unread', async () => {
    const { wrapper } = await open()

    const tab = wrapper.get('aside button')
    expect(tab.attributes('aria-expanded')).toBe('false')
    expect(tab.text()).toContain('Messages')
    expect(tab.text()).toContain('3')
    expect(tab.text()).toContain('3 unread')
  })

  it('opens into the list of chats, and remembers that it is open', async () => {
    const { wrapper, pinia } = await open()

    await wrapper.get('aside button').trigger('click')

    expect(wrapper.find('nav[aria-label="Your chats"]').exists()).toBe(true)
    expect(useUiStore(pinia).drawer.open).toBe(true)
    expect(JSON.parse(window.localStorage.getItem('kc.drawer') ?? '{}')).toMatchObject({ open: true })
  })

  it('shows the conversation inside the drawer when a chat is chosen, without leaving the page', async () => {
    serve()
    const { wrapper, router } = await open()
    await wrapper.get('aside button').trigger('click')

    await wrapper.get('nav[aria-label="Your chats"] li button').trigger('click')
    await settle(8)

    expect(wrapper.find('textarea').exists()).toBe(true)
    expect(wrapper.text()).toContain('Hello inside the drawer')
    expect(router.currentRoute.value.fullPath).toBe('/')
  })

  it('goes back from a conversation to the list', async () => {
    serve()
    const { wrapper, pinia } = await open('/', (p) => useUiStore(p).openDrawer(CHAT_ID))
    await settle(8)

    await wrapper.get('button[aria-label="Back to the list"]').trigger('click')

    expect(useUiStore(pinia).drawer.chatId).toBeNull()
    expect(wrapper.find('nav[aria-label="Your chats"]').exists()).toBe(true)
  })

  it('collapses back to a tab', async () => {
    const { wrapper, pinia } = await open('/', (p) => useUiStore(p).openDrawer())

    await wrapper.get('button[aria-label="Collapse messages"]').trigger('click')

    expect(useUiStore(pinia).drawer.open).toBe(false)
    expect(wrapper.get('aside button').attributes('aria-expanded')).toBe('false')
  })

  it('opens the same chat on its own page, and collapses', async () => {
    serve()
    const { wrapper, router, pinia } = await open('/', (p) => useUiStore(p).openDrawer(CHAT_ID))
    await settle(8)

    await wrapper.get('button[aria-label="Open in full page"]').trigger('click')

    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe(`/chats/${CHAT_ID}`))
    expect(useUiStore(pinia).drawer.open).toBe(false)
  })

  it('has buttons to start a new chat or a new group', async () => {
    const { wrapper, pinia } = await open('/', (p) => useUiStore(p).openDrawer())

    await wrapper.get('button[aria-label="New chat"]').trigger('click')
    await wrapper.get('button[aria-label="New group"]').trigger('click')

    expect(useUiStore(pinia).newChatOpen).toBe(true)
    expect(useUiStore(pinia).newGroupOpen).toBe(true)
  })

  it('is not there on a narrow screen (phones and tablets use the Messages pages)', async () => {
    screenIs(false)
    const { wrapper } = await open()

    expect(wrapper.find('aside').exists()).toBe(false)
  })

  it.each(['/chats', `/chats/${CHAT_ID}`])('is not there on %s, which already shows the messages', async (route) => {
    serve()
    const { wrapper } = await open(route)

    expect(wrapper.find('aside').exists()).toBe(false)
  })

  it('finds its way back to the list when the chat it showed is gone (removed from the group)', async () => {
    serve()
    const { wrapper, pinia } = await open('/', (p) => useUiStore(p).openDrawer(CHAT_ID))
    await settle(8)

    useChatsStore(pinia).drop(CHAT_ID)
    await settle(4)

    expect(useUiStore(pinia).drawer.chatId).toBeNull()
    expect(wrapper.find('nav[aria-label="Your chats"], [role=status], p').exists()).toBe(true)
  })

  it('starts the way it was left (from the browser’s storage)', async () => {
    window.localStorage.setItem('kc.drawer', JSON.stringify({ open: true, chatId: null }))
    const { wrapper } = await open()

    expect(wrapper.find('nav[aria-label="Your chats"]').exists()).toBe(true)
  })

  it('copes with nonsense in the storage', async () => {
    window.localStorage.setItem('kc.drawer', '{not json')
    const { wrapper } = await open()

    expect(wrapper.get('aside button').attributes('aria-expanded')).toBe('false')
  })
})

void PAW
void person
