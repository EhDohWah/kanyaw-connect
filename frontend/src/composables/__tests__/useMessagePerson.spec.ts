import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'

import { ME, PAW, deferred, fakeApi, makeChat, mountApp, person, restoreApi, restoreMedia, screenIs, signedInStores } from '@/__tests__/helpers'
import { useMessagePerson } from '@/composables/useMessagePerson'
import { useChatsStore } from '@/stores/chats'
import { useUiStore } from '@/stores/ui'

afterEach(() => {
  restoreApi()
  restoreMedia()
})
beforeEach(() => screenIs(true))

const PAW_USER = person(PAW, 'Naw Paw Say')

async function host(route = '/') {
  let seen!: ReturnType<typeof useMessagePerson>
  const Host = defineComponent({
    setup() {
      seen = useMessagePerson()
      return () => h('div')
    },
  })
  const mounted = await mountApp(Host, { route, prepare: (pinia) => signedInStores(pinia) })
  return { ...mounted, seen: () => seen, ui: () => useUiStore(mounted.pinia), chats: () => useChatsStore(mounted.pinia) }
}

describe('messaging a person', () => {
  it('opens (or creates) the direct chat and shows it in the drawer on a wide screen, without leaving the page', async () => {
    const { calls } = fakeApi(() => ({ status: 201, data: { data: makeChat({ id: 'direct-1' }) } }))
    const { seen, ui, router } = await host('/')

    await seen().message(PAW_USER)

    expect(calls[0]).toMatchObject({ method: 'post', url: '/chats/direct', body: { user_id: PAW } })
    expect(ui().drawer).toEqual({ open: true, chatId: 'direct-1' })
    expect(router.currentRoute.value.fullPath).toBe('/')
  })

  it('goes to the chat page on a narrower screen', async () => {
    screenIs(false)
    fakeApi(() => ({ data: { data: makeChat({ id: 'direct-1' }) } }))
    const { seen, router, ui } = await host('/')

    await seen().message(PAW_USER)

    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/chats/direct-1'))
    expect(ui().drawer.open).toBe(false)
  })

  it('puts the chat in the list', async () => {
    fakeApi(() => ({ status: 201, data: { data: makeChat({ id: 'direct-1' }) } }))
    const { seen, chats } = await host()

    await seen().message(PAW_USER)

    expect(chats().get('direct-1')).toBeDefined()
  })

  it('says so, and stays where it is, when the chat cannot be opened', async () => {
    fakeApi(() => ({ network: true }))
    const { seen, ui } = await host()

    await seen().message(PAW_USER)

    expect(ui().toasts.map((toast) => toast.message)).toEqual(['The chat could not be opened.'])
    expect(ui().toasts[0]?.kind).toBe('error')
    expect(ui().drawer.open).toBe(false)
    expect(seen().busyId.value).toBeNull()
  })

  it('ignores a second tap while the first is still opening, and says who is being opened', async () => {
    const wait = deferred<void>()
    const { calls } = fakeApi(async () => {
      await wait.promise
      return { status: 201, data: { data: makeChat({ id: 'direct-1' }) } }
    })
    const { seen } = await host()

    const first = seen().message(PAW_USER)
    expect(seen().busyId.value).toBe(PAW)
    const second = seen().message(person(ME, 'Someone else'))
    wait.resolve()
    await Promise.all([first, second])

    expect(calls).toHaveLength(1)
    expect(seen().busyId.value).toBeNull()
  })
})
