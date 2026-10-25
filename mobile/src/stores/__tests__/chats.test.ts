import { REFRESH_DELAY_MS, useChatsStore } from '@/stores/chats'
import { makeChat } from '@/testing/factories'
import { fakeApi, restoreApi } from '@/testing/fakeApi'

const page = (ids: string[], next: string | null = null) => ({
  data: { data: ids.map((id) => makeChat({ id })), links: { first: null, last: null, prev: null, next }, meta: {} },
})

beforeEach(() => useChatsStore.getState().reset())
afterEach(() => {
  restoreApi()
  jest.useRealTimers()
})

describe('the chat list', () => {
  it('loads the first page of 30, and the next pages without repeating a chat', async () => {
    const { calls } = fakeApi((call) =>
      call.url === '/chats' ? page(['a', 'b'], 'http://api/chats?cursor=x') : page(['b', 'c']),
    )

    await useChatsStore.getState().load()
    expect(calls[0]?.url).toBe('/chats')
    expect(useChatsStore.getState()).toMatchObject({ status: 'ready', next: 'http://api/chats?cursor=x' })

    await useChatsStore.getState().loadMore()
    expect(calls[1]?.url).toBe('http://api/chats?cursor=x')
    expect(useChatsStore.getState().chats.map((chat) => chat.id)).toEqual(['a', 'b', 'c'])
    expect(useChatsStore.getState().next).toBeNull()
  })

  it('an empty list is ready, not an error', async () => {
    fakeApi(() => page([]))
    await useChatsStore.getState().load()
    expect(useChatsStore.getState()).toMatchObject({ status: 'ready', chats: [] })
  })

  it('shows the error only when there is no list on screen yet', async () => {
    let fail = true
    fakeApi(() => (fail ? { network: true } : page(['a'])))

    await useChatsStore.getState().load()
    expect(useChatsStore.getState().status).toBe('error')
    expect(useChatsStore.getState().error?.isNetwork).toBe(true)

    fail = false
    await useChatsStore.getState().refresh()
    fail = true
    await useChatsStore.getState().refresh()
    expect(useChatsStore.getState()).toMatchObject({ status: 'ready' })
    expect(useChatsStore.getState().chats).toHaveLength(1)
  })

  it('a burst of chat events refetches once', async () => {
    jest.useFakeTimers()
    const { calls } = fakeApi(() => page(['a']))
    await useChatsStore.getState().load()

    useChatsStore.getState().refreshSoon()
    useChatsStore.getState().refreshSoon()
    useChatsStore.getState().refreshSoon()
    await jest.advanceTimersByTimeAsync(REFRESH_DELAY_MS)

    expect(calls).toHaveLength(2)
  })

  it('drops an answer that arrives after sign-out', async () => {
    let answer: (value: ReturnType<typeof page>) => void = () => undefined
    const { calls } = fakeApi(() => new Promise((resolve) => (answer = resolve)))

    const pending = useChatsStore.getState().refresh()
    while (calls.length === 0) await Promise.resolve()
    useChatsStore.getState().reset()
    answer(page(['a']))
    await pending

    expect(useChatsStore.getState()).toMatchObject({ status: 'idle', chats: [] })
  })
})
