import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'

import { fakeApi, makeUser, restoreApi, signIn } from '@/__tests__/helpers'
import { http } from '@/api/http'
import { installSessionSync, installUnauthorizedHandler } from '@/api/session'
import { createAppRouter } from '@/router'
import { useAuthStore } from '@/stores/auth'

/** What the browser does in this tab when another tab writes the token. */
function anotherTabWrites(value: string | null): void {
  if (value === null) window.localStorage.removeItem('kc.token')
  else window.localStorage.setItem('kc.token', value)
  window.dispatchEvent(new StorageEvent('storage', { key: 'kc.token', newValue: value }))
}

let stop: () => void = () => undefined

beforeEach(() => {
  setActivePinia(createPinia())
})
afterEach(() => {
  stop()
  restoreApi()
})

async function signedInTab(path = '/chats/abc') {
  signIn('1|mine')
  const auth = useAuthStore()
  auth.user = makeUser()
  const router = createAppRouter(createMemoryHistory())
  fakeApi(() => ({ data: { data: makeUser() } }))
  await router.push(path)
  const reload = vi.fn()
  stop = installSessionSync(router, reload)
  return { auth, router, reload }
}

describe('two tabs, one stored session', () => {
  it('signs this tab out too when another tab signs out, and says why on the login screen', async () => {
    const { auth, router } = await signedInTab()

    anotherTabWrites(null)
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('login'))

    expect(auth.isAuthenticated).toBe(false)
    expect(auth.user).toBeNull()
    expect(auth.endedReason).toBe('elsewhere')
    expect(router.currentRoute.value.query.redirect).toBe('/chats/abc')
  })

  it('starts over (reloads) when another tab signs in, possibly as someone else, instead of mixing two people', async () => {
    const { auth, reload } = await signedInTab()

    anotherTabWrites('2|someone-else')

    expect(reload).toHaveBeenCalledTimes(1)
    // nothing of the old session is used meanwhile
    expect(auth.token).toBe('1|mine')
  })

  it('a tab on the login screen follows a sign-in made in another tab', async () => {
    const router = createAppRouter(createMemoryHistory())
    await router.push('/login')
    const reload = vi.fn()
    stop = installSessionSync(router, reload)

    anotherTabWrites('2|new')

    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('ignores other keys, and a write that leaves this tab’s session as it is', async () => {
    const { auth, reload } = await signedInTab()

    window.localStorage.setItem('kc.locale', 'my')
    window.dispatchEvent(new StorageEvent('storage', { key: 'kc.locale', newValue: 'my' }))
    anotherTabWrites('1|mine')

    expect(reload).not.toHaveBeenCalled()
    expect(auth.isAuthenticated).toBe(true)
  })

  it('treats a cleared storage (key null) as a sign-out elsewhere', async () => {
    const { auth } = await signedInTab()

    window.localStorage.clear()
    window.dispatchEvent(new StorageEvent('storage', { key: null }))

    expect(auth.isAuthenticated).toBe(false)
  })

  it('stops listening when asked', async () => {
    const { auth, reload } = await signedInTab()
    stop()

    anotherTabWrites(null)

    expect(auth.isAuthenticated).toBe(true)
    expect(reload).not.toHaveBeenCalled()
  })
})

describe('requests carry this tab’s own session', () => {
  it('uses the token this tab signed in with, not one another tab stored since', async () => {
    signIn('1|mine')
    useAuthStore()
    const { calls } = fakeApi(() => ({ data: {} }))

    window.localStorage.setItem('kc.token', '2|someone-else')
    await http.get('/chats')

    expect(calls[0]?.headers.Authorization).toBe('Bearer 1|mine')
  })

  it('signs out when this tab’s token is refused, even though another tab already removed it from storage', async () => {
    signIn('1|mine')
    const auth = useAuthStore()
    auth.user = makeUser()
    const router = createAppRouter(createMemoryHistory())
    await router.push('/login')
    installUnauthorizedHandler(router)
    fakeApi(() => ({ status: 401, data: { message: 'Unauthenticated.' } }))

    window.localStorage.removeItem('kc.token')
    await http.get('/chats').catch(() => undefined)

    expect(auth.isAuthenticated).toBe(false)
    expect(auth.endedReason).toBe('expired')
  })

  it('ending this tab’s session does not wipe the newer session another tab stored', async () => {
    signIn('1|mine')
    const auth = useAuthStore()

    window.localStorage.setItem('kc.token', '2|other-tab')
    auth.clearSession('expired')

    expect(auth.isAuthenticated).toBe(false)
    expect(window.localStorage.getItem('kc.token')).toBe('2|other-tab')
  })

  it('ending this tab’s session removes it from storage when it is still the stored one', async () => {
    signIn('1|mine')
    const auth = useAuthStore()

    auth.clearSession()

    expect(window.localStorage.getItem('kc.token')).toBeNull()
    expect(window.localStorage.getItem('kc.tokenExpiresAt')).toBeNull()
  })
})
