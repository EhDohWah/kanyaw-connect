import { afterEach, describe, expect, it, vi } from 'vitest'

import { LOGIN_REPLY, fakeApi, makeUser, mountApp, restoreApi, settle, signIn } from '@/__tests__/helpers'
import LoginView from '@/views/LoginView.vue'

afterEach(restoreApi)

async function open(route = '/login') {
  return mountApp(LoginView, { route })
}

async function fillAndSubmit(wrapper: Awaited<ReturnType<typeof open>>['wrapper'], email: string, password: string) {
  await wrapper.get('input[name=email]').setValue(email)
  await wrapper.get('input[name=password]').setValue(password)
  await wrapper.get('form').trigger('submit')
  await settle()
}

describe('LoginView', () => {
  it('asks for email and password before sending anything', async () => {
    const { calls } = fakeApi(() => ({ data: {} }))
    const { wrapper } = await open()

    await wrapper.get('form').trigger('submit')
    await settle()

    expect(calls).toHaveLength(0)
    expect(wrapper.text()).toContain('Enter your email address.')
    expect(wrapper.text()).toContain('Enter your password.')
    expect(wrapper.get('input[name=email]').attributes('aria-invalid')).toBe('true')
  })

  it('signs in and goes to the home page', async () => {
    const { calls } = fakeApi((call) => (call.url === '/auth/login' ? LOGIN_REPLY() : { data: { data: makeUser() } }))
    const { wrapper, router } = await open()

    await fillAndSubmit(wrapper, 'eh@example.org', 'password123')

    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('home'))
    expect(calls[0]).toMatchObject({ method: 'post', url: '/auth/login' })
    expect(window.localStorage.getItem('kc.token')).toBe('1|secret-token')
  })

  it('goes back to the page the person wanted before they were asked to sign in', async () => {
    fakeApi((call) => (call.url === '/auth/login' ? LOGIN_REPLY() : { data: { data: makeUser() } }))
    const { wrapper, router } = await open('/login?redirect=/profile')

    await fillAndSubmit(wrapper, 'eh@example.org', 'password123')

    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('profile'))
  })

  it('never follows a redirect to another site', async () => {
    fakeApi((call) => (call.url === '/auth/login' ? LOGIN_REPLY() : { data: { data: makeUser() } }))
    const { wrapper, router } = await open('/login?redirect=//evil.example/steal')

    await fillAndSubmit(wrapper, 'eh@example.org', 'password123')

    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('home'))
    expect(router.currentRoute.value.fullPath).toBe('/')
  })

  it('shows the server message for wrong credentials, once, for the whole form, and lets the person try again', async () => {
    fakeApi(() => ({
      status: 422,
      data: { message: 'These credentials do not match our records.', errors: { email: ['These credentials do not match our records.'] } },
    }))
    const { wrapper, router } = await open()

    await fillAndSubmit(wrapper, 'eh@example.org', 'wrong-password')

    const alert = wrapper.get('[role=alert]')
    expect(alert.text()).toBe('These credentials do not match our records.')
    expect(router.currentRoute.value.name).toBe('login')
    expect((wrapper.get('input[name=password]').element as HTMLInputElement).value).toBe('wrong-password')
    expect(wrapper.get('button[type=submit]').attributes('disabled')).toBeUndefined()
  })

  it('tells how long to wait after too many attempts', async () => {
    fakeApi(() => ({ status: 429, headers: { 'retry-after': '40' }, data: { message: 'Too Many Attempts.' } }))
    const { wrapper } = await open()

    await fillAndSubmit(wrapper, 'eh@example.org', 'password123')

    expect(wrapper.get('[role=alert]').text()).toContain('40')
  })

  it('says so when the server cannot be reached', async () => {
    fakeApi(() => ({ network: true }))
    const { wrapper } = await open()

    await fillAndSubmit(wrapper, 'eh@example.org', 'password123')

    expect(wrapper.get('[role=alert]').text()).toContain("Can't reach the server")
  })

  it('disables the button and says "Signing in…" while the request is running', async () => {
    let release: () => void = () => undefined
    fakeApi(
      () =>
        new Promise((resolve) => {
          release = () => resolve(LOGIN_REPLY())
        }),
    )
    const { wrapper } = await open()

    await wrapper.get('input[name=email]').setValue('eh@example.org')
    await wrapper.get('input[name=password]').setValue('password123')
    await wrapper.get('form').trigger('submit')
    await settle(2)

    const button = wrapper.get('button[type=submit]')
    expect(button.attributes('disabled')).toBeDefined()
    expect(button.text()).toContain('Signing in…')

    release()
    await settle()
  })

  it('explains why the person is here after their session ended', async () => {
    signIn('1|old', '2000-01-01T00:00:00+00:00') // expired a long time ago
    const { wrapper } = await open()

    expect(wrapper.get('[role=status]').text()).toBe('Your session has ended. Please sign in again.')
  })

  it('says the person signed out in another tab when that is why they are here', async () => {
    const { useAuthStore } = await import('@/stores/auth')
    const mounted = await mountApp(LoginView, { route: '/login', prepare: (pinia) => (useAuthStore(pinia).endedReason = 'elsewhere') })

    expect(mounted.wrapper.get('[role=status]').text()).toBe('You signed out in another tab or window.')
  })

  it('uses the right autocomplete hints so password managers work, and links to registration', async () => {
    const { wrapper } = await open()

    expect(wrapper.get('input[name=email]').attributes('autocomplete')).toBe('username')
    expect(wrapper.get('input[name=password]').attributes('autocomplete')).toBe('current-password')
    expect(wrapper.find('a[href="/register"]').exists()).toBe(true)
  })
})

describe('LoginView: a forgotten password', () => {
  it('links to "Forgot your password?", carrying the address typed so far', async () => {
    fakeApi(() => ({ data: {} }))
    const { wrapper } = await open()
    const link = () => wrapper.findAll('a').find((a) => a.text() === 'Forgot your password?')!

    expect(link().attributes('href')).toBe('/forgot-password')
    await wrapper.get('input[name=email]').setValue(' eh@example.org ')
    expect(link().attributes('href')).toBe('/forgot-password?email=eh@example.org')
  })

  it('fills in the address when coming back from a reset', async () => {
    fakeApi(() => ({ data: {} }))
    const { wrapper } = await open('/login?email=paw%40example.com')
    expect((wrapper.get('input[name=email]').element as HTMLInputElement).value).toBe('paw@example.com')
  })
})
