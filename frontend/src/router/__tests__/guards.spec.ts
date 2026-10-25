import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { fakeApi, makeUser, restoreApi, signIn } from '@/__tests__/helpers'
import { createAppRouter } from '@/router'
import { useAuthStore } from '@/stores/auth'

beforeEach(() => {
  setActivePinia(createPinia())
})
afterEach(restoreApi)

function router() {
  return createAppRouter(createMemoryHistory())
}

describe('private pages', () => {
  it('send a signed-out visitor to the login screen and remember where they wanted to go', async () => {
    const r = router()
    await r.push('/chats')

    expect(r.currentRoute.value.name).toBe('login')
    expect(r.currentRoute.value.query.redirect).toBe('/chats')
  })

  it('do not add a redirect for the home page', async () => {
    const r = router()
    await r.push('/')

    expect(r.currentRoute.value.name).toBe('login')
    expect(r.currentRoute.value.query.redirect).toBeUndefined()
  })

  it('check the saved token once, then let a signed-in user through', async () => {
    signIn()
    const { calls } = fakeApi(() => ({ data: { data: makeUser() } }))
    const r = router()

    await r.push('/profile')
    await r.push('/settings')

    expect(r.currentRoute.value.name).toBe('settings')
    expect(calls.filter((call) => call.url === '/me')).toHaveLength(1)
  })

  it('send the visitor to login when the server refuses the saved token', async () => {
    signIn('1|revoked')
    fakeApi(() => ({ status: 401, data: { message: 'Unauthenticated.' } }))
    // The app installs this hook (src/api/session.ts); here we mimic what it does to the store.
    const { setUnauthorizedHandler } = await import('@/api/http')
    setUnauthorizedHandler(() => useAuthStore().clearSession('expired'))
    const r = router()

    await r.push('/chats')

    expect(r.currentRoute.value.name).toBe('login')
    expect(r.currentRoute.value.query.redirect).toBe('/chats')
    expect(useAuthStore().isAuthenticated).toBe(false)
  })

  it('still show the page (with its own "Try again") when the server cannot be reached', async () => {
    signIn()
    fakeApi(() => ({ network: true }))
    const r = router()

    await r.push('/profile')

    expect(r.currentRoute.value.name).toBe('profile')
    expect(useAuthStore().bootError?.isNetwork).toBe(true)
  })

  it('show the not-found page inside the app for a signed-in user, and login for a stranger', async () => {
    signIn()
    fakeApi(() => ({ data: { data: makeUser() } }))
    const signedIn = router()
    await signedIn.push('/nothing/here')
    expect(signedIn.currentRoute.value.name).toBe('not-found')

    window.localStorage.clear()
    setActivePinia(createPinia())
    const stranger = router()
    await stranger.push('/nothing/here')
    expect(stranger.currentRoute.value.name).toBe('login')
  })

  it('hide the bottom bar inside a conversation and a call', () => {
    const r = router()
    expect(r.resolve('/chats/abc').meta.immersive).toBe(true)
    expect(r.resolve('/rooms/abc').meta.immersive).toBe(true)
    expect(r.resolve('/chats').meta.immersive).toBeUndefined()
  })
})

describe('login and register', () => {
  it('are open to visitors', async () => {
    const r = router()
    await r.push('/register')
    expect(r.currentRoute.value.name).toBe('register')
  })

  it('send a signed-in user to the home page instead', async () => {
    signIn()
    fakeApi(() => ({ data: { data: makeUser() } }))
    const r = router()

    await r.push('/login')

    expect(r.currentRoute.value.name).toBe('home')
  })

  it('send a signed-in user on to the page the sign-in screen was keeping (signed in again in another tab)', async () => {
    signIn()
    fakeApi(() => ({ data: { data: makeUser() } }))
    const r = router()

    await r.push('/login?redirect=/chats/c1')

    expect(r.currentRoute.value.fullPath).toBe('/chats/c1')
  })

  it('never follow a redirect off the site, or back to a sign-in screen', async () => {
    signIn()
    fakeApi(() => ({ data: { data: makeUser() } }))
    const r = router()

    await r.push('/login?redirect=//evil.example')
    expect(r.currentRoute.value.name).toBe('home')

    await r.push('/register?redirect=/login')
    expect(r.currentRoute.value.name).toBe('home')
  })
})

describe('the pages the account emails link to', () => {
  it.each(['/forgot-password', '/reset-password?token=t&email=e%40x.org', '/verify-email?id=1&hash=h&expires=1&signature=s'])(
    'open signed out (%s)',
    async (path) => {
      const r = router()
      await r.push(path)
      expect(r.currentRoute.value.path).toBe(path.split('?')[0])
    },
  )

  it.each(['/forgot-password', '/reset-password?token=t&email=e%40x.org', '/verify-email?id=1&hash=h&expires=1&signature=s'])(
    'open signed in too, without asking the server first (%s)',
    async (path) => {
      signIn()
      const { calls } = fakeApi(() => ({ data: { data: makeUser() } }))
      const r = router()
      await r.push(path)
      expect(r.currentRoute.value.path).toBe(path.split('?')[0])
      expect(calls).toHaveLength(0)
    },
  )
})
