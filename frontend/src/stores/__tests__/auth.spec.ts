import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setUnauthorizedHandler } from '@/api/http'
import { LOGIN_REPLY, fakeApi, makeUser, restoreApi, signIn } from '@/__tests__/helpers'
import { i18n } from '@/i18n'
import { useAuthStore } from '@/stores/auth'

beforeEach(() => {
  setActivePinia(createPinia())
})
afterEach(restoreApi)

describe('login', () => {
  it('stores the token and its expiry, keeps the user, and names the device', async () => {
    const { calls } = fakeApi(() => LOGIN_REPLY())
    const auth = useAuthStore()

    await auth.login('  eh@example.org ', 'password123')

    expect(auth.isAuthenticated).toBe(true)
    expect(auth.user?.name).toBe('Saw Eh Doh')
    expect(window.localStorage.getItem('kc.token')).toBe('1|secret-token')
    expect(window.localStorage.getItem('kc.tokenExpiresAt')).toBe('2099-01-01T00:00:00+00:00')
    expect(calls[0]?.url).toBe('/auth/login')
    expect(calls[0]?.body).toMatchObject({ email: 'eh@example.org', password: 'password123' })
    expect((calls[0]?.body as { device_name: string }).device_name).toMatch(/\S/)
  })

  it('switches the app to the language saved on the account', async () => {
    fakeApi(() => LOGIN_REPLY(makeUser({ locale: 'my' })))
    const auth = useAuthStore()

    await auth.login('eh@example.org', 'password123')

    expect(i18n.global.locale.value).toBe('my')
    expect(document.documentElement.lang).toBe('my')
  })

  it('leaves nothing behind when the credentials are wrong', async () => {
    fakeApi(() => ({ status: 422, data: { message: 'These credentials do not match our records.', errors: { email: ['These credentials do not match our records.'] } } }))
    const auth = useAuthStore()

    await expect(auth.login('eh@example.org', 'wrong')).rejects.toMatchObject({ status: 422 })

    expect(auth.isAuthenticated).toBe(false)
    expect(window.localStorage.getItem('kc.token')).toBeNull()
  })
})

describe('restoring a saved session', () => {
  it('uses the saved token', () => {
    signIn('1|saved')
    expect(useAuthStore().token).toBe('1|saved')
  })

  it('drops a token that is already past its expiry, without asking the server, and remembers why', () => {
    signIn('1|old', '2000-01-01T00:00:00+00:00')
    const { calls } = fakeApi(() => ({ data: {} }))

    const auth = useAuthStore()

    expect(auth.isAuthenticated).toBe(false)
    expect(auth.endedReason).toBe('expired')
    expect(window.localStorage.getItem('kc.token')).toBeNull()
    expect(calls).toHaveLength(0)
  })
})

describe('ensureUser', () => {
  it('loads the profile once, even when asked twice at the same time', async () => {
    signIn()
    const { calls } = fakeApi(() => ({ data: { data: makeUser({ name: 'Naw Paw Say' }) } }))
    const auth = useAuthStore()

    await Promise.all([auth.ensureUser(), auth.ensureUser()])
    await auth.ensureUser()

    expect(auth.user?.name).toBe('Naw Paw Say')
    expect(calls.filter((call) => call.url === '/me')).toHaveLength(1)
  })

  it('does nothing when nobody is signed in', async () => {
    const { calls } = fakeApi(() => ({ data: {} }))
    await useAuthStore().ensureUser()
    expect(calls).toHaveLength(0)
  })

  it('keeps the token and reports bootError when the server cannot be reached, and recovers on retry', async () => {
    signIn()
    let online = false
    fakeApi(() => (online ? { data: { data: makeUser() } } : { network: true }))
    const auth = useAuthStore()

    await auth.ensureUser()
    expect(auth.bootError?.isNetwork).toBe(true)
    expect(auth.isAuthenticated).toBe(true)
    expect(auth.user).toBeNull()

    online = true
    await auth.ensureUser()
    expect(auth.bootError).toBeNull()
    expect(auth.user?.email).toBe('eh@example.org')
  })
})

describe('a refused token', () => {
  it('ends the session and leaves no "server unreachable" error behind (it would show up after the next sign-in)', async () => {
    signIn('1|revoked')
    fakeApi(() => ({ status: 401, data: { message: 'Unauthenticated.' } }))
    // The app installs this hook (src/api/session.ts); here we do what it does to the store.
    setUnauthorizedHandler(() => useAuthStore().clearSession('expired'))
    const auth = useAuthStore()

    await auth.ensureUser()

    expect(auth.isAuthenticated).toBe(false)
    expect(auth.user).toBeNull()
    expect(auth.bootError).toBeNull()
    expect(auth.endedReason).toBe('expired')
    expect(window.localStorage.getItem('kc.token')).toBeNull()
  })
})

describe('register', () => {
  it('creates the account and then signs in with the same details', async () => {
    const { calls } = fakeApi((call) => (call.url === '/auth/register' ? { status: 201, data: { data: makeUser() } } : LOGIN_REPLY()))
    const auth = useAuthStore()

    const outcome = await auth.register({
      name: 'Saw Eh Doh',
      email: 'eh@example.org',
      password: 'password123',
      password_confirmation: 'password123',
    })

    expect(outcome).toBe('signed-in')
    expect(calls.map((call) => call.url)).toEqual(['/auth/register', '/auth/login'])
    expect(auth.isAuthenticated).toBe(true)
  })

  it('reports needs-login when the account exists but signing in failed', async () => {
    fakeApi((call) => (call.url === '/auth/register' ? { status: 201, data: { data: makeUser() } } : { status: 429, headers: { 'retry-after': '30' }, data: {} }))
    const auth = useAuthStore()

    const outcome = await auth.register({ name: 'A', email: 'a@b.org', password: 'password123', password_confirmation: 'password123' })

    expect(outcome).toBe('needs-login')
    expect(auth.isAuthenticated).toBe(false)
  })

  it('does not try to sign in when registering fails', async () => {
    const { calls } = fakeApi(() => ({ status: 422, data: { message: 'Invalid', errors: { email: ['The email has already been taken.'] } } }))

    await expect(
      useAuthStore().register({ name: 'A', email: 'a@b.org', password: 'password123', password_confirmation: 'password123' }),
    ).rejects.toMatchObject({ status: 422 })

    expect(calls).toHaveLength(1)
  })
})

describe('logout', () => {
  it('revokes the token on the server and forgets it here', async () => {
    signIn()
    const { calls } = fakeApi((call) => (call.url === '/me' ? { data: { data: makeUser() } } : { data: { message: 'Logged out.' } }))
    const auth = useAuthStore()
    await auth.ensureUser()

    await auth.logout()

    expect(calls.at(-1)).toMatchObject({ method: 'post', url: '/auth/logout' })
    expect(auth.isAuthenticated).toBe(false)
    expect(auth.user).toBeNull()
    expect(window.localStorage.getItem('kc.token')).toBeNull()
  })

  it('still signs this device out when the server cannot be reached', async () => {
    signIn()
    fakeApi(() => ({ network: true }))
    const auth = useAuthStore()

    await auth.logout()

    expect(auth.isAuthenticated).toBe(false)
    expect(window.localStorage.getItem('kc.token')).toBeNull()
  })
})

describe('profile', () => {
  it('sends only the given fields and keeps the answer', async () => {
    signIn()
    const { calls } = fakeApi((call) =>
      call.method === 'patch' ? { data: { data: makeUser({ name: 'New Name' }) } } : { data: { data: makeUser() } },
    )
    const auth = useAuthStore()
    await auth.ensureUser()

    await auth.updateProfile({ name: 'New Name' })

    expect(calls.at(-1)?.body).toEqual({ name: 'New Name' })
    expect(auth.user?.name).toBe('New Name')
  })

  it('saveSettings changes the setting at once, sends only that key, and keeps the server\'s answer', async () => {
    signIn()
    let release: () => void = () => undefined
    const { calls } = fakeApi(async (call) => {
      if (call.method !== 'patch') return { data: { data: makeUser({ settings: { theme: 'light' } }) } }
      await new Promise<void>((resolve) => (release = resolve))
      return { data: { data: makeUser({ settings: { theme: 'light', data_saver: true } }) } }
    })
    const auth = useAuthStore()
    await auth.ensureUser()

    const saving = auth.saveSettings({ data_saver: true })
    expect(auth.user?.settings).toEqual({ theme: 'light', data_saver: true })
    await vi.waitFor(() => expect(calls.at(-1)?.method).toBe('patch'))
    release()
    await saving

    expect(calls.at(-1)).toMatchObject({ method: 'patch', url: '/me', body: { settings: { data_saver: true } } })
    expect(auth.user?.settings).toEqual({ theme: 'light', data_saver: true })
  })

  it('saveSettings puts the setting back, keeping the others, when the server refuses', async () => {
    signIn()
    fakeApi((call) =>
      call.method === 'patch'
        ? { status: 422, data: { message: 'The settings field must be an array.' } }
        : { data: { data: makeUser({ settings: { theme: 'light', data_saver: false } }) } },
    )
    const auth = useAuthStore()
    await auth.ensureUser()

    await expect(auth.saveSettings({ data_saver: true })).rejects.toMatchObject({ status: 422 })
    expect(auth.user?.settings).toEqual({ theme: 'light', data_saver: false })
  })

  it('saveSettings does nothing when nobody is signed in', async () => {
    const { calls } = fakeApi(() => ({ data: {} }))
    await useAuthStore().saveSettings({ data_saver: true })
    expect(calls).toHaveLength(0)
  })

  it('changeLocale switches the language at once and saves it on the account', async () => {
    signIn()
    const { calls } = fakeApi((call) =>
      call.method === 'patch' ? { data: { data: makeUser({ locale: 'ksw' }) } } : { data: { data: makeUser() } },
    )
    const auth = useAuthStore()
    await auth.ensureUser()

    await auth.changeLocale('ksw')

    expect(i18n.global.locale.value).toBe('ksw')
    expect(calls.at(-1)).toMatchObject({ method: 'patch', url: '/me', body: { locale: 'ksw' } })
  })

  it('changeLocale still switches the language on the sign-in screen, where there is no account to save to', async () => {
    const { calls } = fakeApi(() => ({ data: {} }))

    await useAuthStore().changeLocale('my')

    expect(i18n.global.locale.value).toBe('my')
    expect(calls).toHaveLength(0)
  })
})
