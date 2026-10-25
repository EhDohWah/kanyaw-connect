import * as SecureStore from 'expo-secure-store'

import { setUnauthorizedHandler } from '@/api/http'
import { i18n } from '@/i18n'
import { isExpired, onBeforeSignOut, useAuthStore } from '@/stores/auth'
import { LOGIN_REPLY, makeUser } from '@/testing/factories'
import { fakeApi, restoreApi } from '@/testing/fakeApi'

// The in-memory stand-in from __mocks__/expo-secure-store.ts.
const store = SecureStore as unknown as typeof SecureStore & {
  __dump(): Record<string, string>
  __reset(): void
  calls: { method: string; key: string; options?: Record<string, unknown> }[]
}

jest.mock('expo-device', () => ({ modelName: 'Pixel 7' }))

const initial = useAuthStore.getState()

beforeEach(() => {
  store.__reset()
  useAuthStore.setState({
    ...initial,
    status: 'restoring',
    token: null,
    user: null,
    bootError: null,
    endedReason: null,
  })
  void i18n.changeLanguage('en')
})
afterEach(restoreApi)

describe('signing in', () => {
  it("logs in with the phone's name, keeps the token in secure storage (after first unlock), and loads the person", async () => {
    const { calls } = fakeApi(() => LOGIN_REPLY(makeUser({ locale: 'my' })))

    await useAuthStore.getState().login('  eh@example.org ', 'password123')

    expect(calls[0]).toMatchObject({
      method: 'post',
      url: '/auth/login',
      body: { email: 'eh@example.org', password: 'password123', device_name: 'Pixel 7 (iOS)' }, // jest-expo runs as iOS; Android is in deviceName.test.ts
    })
    expect(calls[0]?.headers.Authorization).toBeUndefined()
    expect(store.__dump()).toEqual({ 'kc.token': '1|secret-token', 'kc.tokenExpiresAt': '2099-01-01T00:00:00+00:00' })
    expect(
      store.calls
        .filter((c) => c.method === 'set')
        .every((c) => c.options?.keychainAccessible === 'AFTER_FIRST_UNLOCK'),
    ).toBe(true)
    expect(useAuthStore.getState()).toMatchObject({ status: 'signedIn', token: '1|secret-token' })
    expect(useAuthStore.getState().user?.name).toBe('Saw Eh Doh')
    // The account's language becomes the app's.
    expect(i18n.language).toBe('my')
  })

  it('register creates the account and signs straight in', async () => {
    const { calls } = fakeApi((call) =>
      call.url === '/auth/register' ? { status: 201, data: { data: makeUser() } } : LOGIN_REPLY(),
    )

    const outcome = await useAuthStore.getState().register({
      name: 'Naw Paw',
      email: 'paw@example.org',
      password: 'secret-password',
      password_confirmation: 'secret-password',
    })

    expect(outcome).toBe('signed-in')
    expect(calls.map((c) => c.url)).toEqual(['/auth/register', '/auth/login'])
    expect(useAuthStore.getState().status).toBe('signedIn')
  })

  it('register says so when the account exists but signing in failed', async () => {
    fakeApi((call) => (call.url === '/auth/register' ? { status: 201, data: { data: makeUser() } } : { network: true }))
    const outcome = await useAuthStore
      .getState()
      .register({ name: 'N', email: 'n@x.org', password: 'p', password_confirmation: 'p' })
    expect(outcome).toBe('needs-login')
    expect(useAuthStore.getState().token).toBeNull()
  })
})

describe('at start', () => {
  it('keeps the token after the app is killed and opened again, and checks it with the server', async () => {
    await SecureStore.setItemAsync('kc.token', '1|kept')
    await SecureStore.setItemAsync('kc.tokenExpiresAt', '2099-01-01T00:00:00+00:00')
    const { calls } = fakeApi(() => ({ data: { data: makeUser() } }))

    await useAuthStore.getState().restore()

    expect(useAuthStore.getState()).toMatchObject({ status: 'signedIn', token: '1|kept' })
    expect(calls[0]).toMatchObject({ method: 'get', url: '/me' })
    expect(calls[0]?.headers.Authorization).toBe('Bearer 1|kept')
    expect(useAuthStore.getState().user?.id).toBeDefined()
  })

  it('drops a token past its expiry without asking the server, and says why', async () => {
    await SecureStore.setItemAsync('kc.token', '1|old')
    await SecureStore.setItemAsync('kc.tokenExpiresAt', '2020-01-01T00:00:00+00:00')
    const { calls } = fakeApi(() => ({ data: {} }))

    await useAuthStore.getState().restore()

    expect(calls).toHaveLength(0)
    expect(useAuthStore.getState()).toMatchObject({ status: 'signedOut', token: null, endedReason: 'expired' })
    expect(store.__dump()).toEqual({})
  })

  it('nothing saved: signed out, with nothing to say', async () => {
    await useAuthStore.getState().restore()
    expect(useAuthStore.getState()).toMatchObject({ status: 'signedOut', endedReason: null })
  })

  it('a refused token (401) signs out', async () => {
    await SecureStore.setItemAsync('kc.token', '1|revoked')
    fakeApi(() => ({ status: 401, data: { message: 'Unauthenticated.' } }))

    await useAuthStore.getState().restore()

    expect(useAuthStore.getState()).toMatchObject({ status: 'signedOut', token: null, endedReason: 'expired' })
    expect(store.__dump()).toEqual({})
  })

  it('no connection: keeps the token and offers to try again (does not sign the person out)', async () => {
    await SecureStore.setItemAsync('kc.token', '1|kept')
    fakeApi(() => ({ network: true }))

    await useAuthStore.getState().restore()

    expect(useAuthStore.getState()).toMatchObject({ status: 'signedIn', token: '1|kept' })
    expect(useAuthStore.getState().bootError?.isNetwork).toBe(true)
  })

  it('isExpired reads the stored expiry', () => {
    expect(isExpired(null)).toBe(false)
    expect(isExpired('not a date')).toBe(false)
    expect(isExpired('2026-01-01T00:00:00Z', Date.parse('2026-01-02T00:00:00Z'))).toBe(true)
    expect(isExpired('2026-01-03T00:00:00Z', Date.parse('2026-01-02T00:00:00Z'))).toBe(false)
  })
})

describe('signing out', () => {
  it('runs the before-sign-out hooks while the token still works, revokes it, and forgets it', async () => {
    useAuthStore.setState({ status: 'signedIn', token: '1|abc', user: makeUser() })
    await SecureStore.setItemAsync('kc.token', '1|abc')
    const order: string[] = []
    const { calls } = fakeApi((call) => {
      order.push(`${call.method} ${call.url} (${String(call.headers.Authorization)})`)
      return { data: { message: 'Logged out.' } }
    })
    const stop = onBeforeSignOut(async () => {
      order.push(`hook (token ${useAuthStore.getState().token})`)
    })

    await useAuthStore.getState().logout()
    stop()

    expect(order).toEqual(['hook (token 1|abc)', 'post /auth/logout (Bearer 1|abc)'])
    expect(calls).toHaveLength(1)
    expect(useAuthStore.getState()).toMatchObject({ status: 'signedOut', token: null, user: null, endedReason: null })
    expect(store.__dump()).toEqual({})
  })

  it('signs out on the phone even if the server cannot be reached, or a hook fails', async () => {
    useAuthStore.setState({ status: 'signedIn', token: '1|abc' })
    fakeApi(() => ({ network: true }))
    const stop = onBeforeSignOut(async () => {
      throw new Error('push registration could not be removed')
    })

    await useAuthStore.getState().logout()
    stop()

    expect(useAuthStore.getState().status).toBe('signedOut')
  })
})

describe('the profile', () => {
  it('saves settings at once, and puts them back when the server refuses', async () => {
    useAuthStore.setState({ status: 'signedIn', token: '1|abc', user: makeUser({ settings: { data_saver: false } }) })
    fakeApi(() => ({ status: 500, data: {} }))

    await expect(useAuthStore.getState().saveSettings({ data_saver: true })).rejects.toBeDefined()

    expect(useAuthStore.getState().user?.settings).toEqual({ data_saver: false })
  })

  it('changing the language switches the app and saves it on the account', async () => {
    useAuthStore.setState({ status: 'signedIn', token: '1|abc', user: makeUser({ locale: 'en' }) })
    const { calls } = fakeApi((call) => ({
      data: { data: makeUser({ locale: (call.body as { locale: 'ksw' }).locale }) },
    }))

    await useAuthStore.getState().changeLocale('ksw')

    expect(i18n.language).toBe('ksw')
    expect(calls[0]).toMatchObject({ method: 'patch', url: '/me', body: { locale: 'ksw' } })
  })
})

// Other tests in this file replace the 401 hook; keep the store's own one for the rest of the run.
afterAll(() => setUnauthorizedHandler(() => useAuthStore.getState().clearSession('expired')))
