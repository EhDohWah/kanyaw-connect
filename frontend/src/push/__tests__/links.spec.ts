import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useFakePush } from '@/__tests__/fakePush'
import { ME, fakeApi, makeUser, restoreApi, settle, signIn } from '@/__tests__/helpers'
import { callTarget, installServiceWorkerMessages, notificationRoute } from '@/push/links'
import { createAppRouter } from '@/router'
import { useAuthStore } from '@/stores/auth'
import { PUSH_OWNER_KEY, usePushStore } from '@/stores/push'
import { useUiStore } from '@/stores/ui'

const CHAT = '0195e2c4-0004-7a03-8103-5f3a9c005ccd'
const ROOM = '0195e2c4-001a-7a19-8119-5f3a9c030557'
const ORIGIN = 'https://kanyaw.example'

describe('notificationRoute', () => {
  it('a chat, a meeting, or the start page of this site', () => {
    expect(notificationRoute(`${ORIGIN}/chats/${CHAT}`, ORIGIN, '/')).toBe(`/chats/${CHAT}`)
    expect(notificationRoute(`${ORIGIN}/rooms/${ROOM}`, ORIGIN, '/')).toBe(`/rooms/${ROOM}`)
    expect(notificationRoute(`${ORIGIN}/`, ORIGIN, '/')).toBe('/')
  })

  it('inside a sub-folder, the route without the folder', () => {
    expect(notificationRoute(`${ORIGIN}/app/chats/${CHAT}`, ORIGIN, '/app/')).toBe(`/chats/${CHAT}`)
    expect(notificationRoute(`${ORIGIN}/chats/${CHAT}`, ORIGIN, '/app/')).toBeNull()
  })

  it('never another site, another page of this one, or something that is not an address', () => {
    expect(notificationRoute(`https://evil.example/chats/${CHAT}`, ORIGIN, '/')).toBeNull()
    expect(notificationRoute(`${ORIGIN}/settings`, ORIGIN, '/')).toBeNull()
    expect(notificationRoute(`${ORIGIN}/chats/${CHAT}/../../settings`, ORIGIN, '/')).toBeNull()
    expect(notificationRoute(`${ORIGIN}/chats/a/b`, ORIGIN, '/')).toBeNull()
    expect(notificationRoute('javascript:alert(1)', ORIGIN, '/')).toBeNull()
    expect(notificationRoute(42, ORIGIN, '/')).toBeNull()
    expect(notificationRoute(undefined, ORIGIN, '/')).toBeNull()
  })

  it('reads a path on its own as this site', () => {
    expect(notificationRoute(`/chats/${CHAT}`, ORIGIN, '/')).toBe(`/chats/${CHAT}`)
  })
})

describe('messages from the service worker', () => {
  const here = window.location.origin

  async function setUp({ signedIn = true } = {}) {
    setActivePinia(createPinia())
    if (signedIn) {
      signIn()
      useAuthStore().restoreSession()
    }
    fakeApi(() => ({ data: { data: makeUser({ id: ME }) } }))
    const fake = useFakePush()
    const router = createAppRouter(createMemoryHistory())
    await router.push(signedIn ? '/' : '/login')
    const stop = installServiceWorkerMessages(router)
    return { fake, router, stop }
  }

  afterEach(restoreApi)

  it('a tapped notification opens its chat in this window', async () => {
    const { fake, router } = await setUp()

    fake.send({ type: 'kc:open', url: `${here}/chats/${CHAT}` })
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe(`/chats/${CHAT}`))
  })

  it('…or its meeting', async () => {
    const { fake, router } = await setUp()

    fake.send({ type: 'kc:open', url: `${here}/rooms/${ROOM}` })
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe(`/rooms/${ROOM}`))
  })

  it('signed out: the sign-in page, which goes on to the chat afterwards', async () => {
    const { fake, router } = await setUp({ signedIn: false })

    fake.send({ type: 'kc:open', url: `${here}/chats/${CHAT}` })
    await vi.waitFor(() => expect(router.currentRoute.value.query.redirect).toBe(`/chats/${CHAT}`))
    expect(router.currentRoute.value.name).toBe('login')
  })

  it('in a meeting: stays (leaving would end it) and says so', async () => {
    const { fake, router } = await setUp()
    await router.push(`/rooms/${ROOM}`)
    useUiStore().callOpen = true

    fake.send({ type: 'kc:open', url: `${here}/chats/${CHAT}` })
    await settle()

    expect(router.currentRoute.value.path).toBe(`/rooms/${ROOM}`)
    expect(useUiStore().toasts.map((toast) => toast.message)).toEqual([
      "You're in a meeting, so the notification you tapped was not opened. Leave the meeting first.",
    ])
  })

  it('a call while a window is open: this window asks for the call and rings', async () => {
    const CALL = '0195e2c4-0030-7a2f-812f-5f3a9c05ade1'
    const { fake } = await setUp()
    const api = fakeApi(() => ({ data: { data: null } }))

    fake.send({ type: 'kc:call', call_id: CALL })
    await vi.waitFor(() => expect(api.calls.map((c) => c.url)).toContain(`/calls/${CALL}`))
  })

  it('a call notification opens the call over the meeting, without leaving it', async () => {
    const CALL = '0195e2c4-0030-7a2f-812f-5f3a9c05ade1'
    const { fake, router } = await setUp()
    await router.push(`/rooms/${ROOM}`)
    useUiStore().callOpen = true
    const api = fakeApi(() => ({ data: { data: null } }))

    fake.send({ type: 'kc:open', url: `${here}/calls/${CALL}?answer=1` })
    await vi.waitFor(() => expect(api.calls.map((c) => c.url)).toContain(`/calls/${CALL}`))
    expect(router.currentRoute.value.path).toBe(`/rooms/${ROOM}`)
    expect(useUiStore().toasts).toHaveLength(0)
  })

  it('already on that page: nothing happens (and no toast during the meeting it announces)', async () => {
    const { fake, router } = await setUp()
    await router.push(`/rooms/${ROOM}`)
    useUiStore().callOpen = true
    const push = vi.spyOn(router, 'push')

    fake.send({ type: 'kc:open', url: `${here}/rooms/${ROOM}` })
    await settle()

    expect(push).not.toHaveBeenCalled()
    expect(useUiStore().toasts).toHaveLength(0)
  })

  it('anything else is ignored', async () => {
    const { fake, router } = await setUp()
    const push = vi.spyOn(router, 'push')

    for (const junk of [null, 'kc:open', { type: 'kc:open', url: 'https://evil.example/chats/x' }, { type: 'other' }]) fake.send(junk)
    await settle()
    expect(push).not.toHaveBeenCalled()
  })

  it('the browser changed the subscription: registered again when signed in', async () => {
    const { fake } = await setUp()
    useAuthStore().user = makeUser({ id: ME })
    const restore = vi.spyOn(usePushStore(), 'restore')

    fake.send({ type: 'kc:push-changed' })
    expect(restore).toHaveBeenCalledTimes(1)
  })

  it('the browser changed the subscription while signed out: nothing to do', async () => {
    window.localStorage.setItem(PUSH_OWNER_KEY, ME)
    const { fake } = await setUp({ signedIn: false })
    const restore = vi.spyOn(usePushStore(), 'restore')

    fake.send({ type: 'kc:push-changed' })
    expect(restore).not.toHaveBeenCalled()
  })

  it('stops listening when asked', async () => {
    const { fake, router, stop } = await setUp()
    const push = vi.spyOn(router, 'push')
    stop()

    fake.send({ type: 'kc:open', url: `${here}/chats/${CHAT}` })
    await settle()
    expect(push).not.toHaveBeenCalled()
  })
})

beforeEach(() => window.localStorage.clear())

describe('call notifications', () => {
  const CALL = '0195e2c4-0030-7a2f-812f-5f3a9c05ade1'

  it('opens a call page, keeping only ?answer=1', () => {
    expect(notificationRoute(`${ORIGIN}/calls/${CALL}`, ORIGIN, '/')).toBe(`/calls/${CALL}`)
    expect(notificationRoute(`${ORIGIN}/calls/${CALL}?answer=1`, ORIGIN, '/')).toBe(`/calls/${CALL}?answer=1`)
    expect(notificationRoute(`${ORIGIN}/calls/${CALL}?answer=1&x=2`, ORIGIN, '/')).toBe(`/calls/${CALL}`)
    expect(notificationRoute(`${ORIGIN}/calls/../settings`, ORIGIN, '/')).toBeNull()
  })

  it('reads the call and whether to answer it', () => {
    expect(callTarget(`/calls/${CALL}`)).toEqual({ callId: CALL, answer: false })
    expect(callTarget(`/calls/${CALL}?answer=1`)).toEqual({ callId: CALL, answer: true })
    expect(callTarget(`/chats/${CALL}`)).toBeNull()
  })
})
