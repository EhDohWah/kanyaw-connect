import { afterEach, describe, expect, it, vi } from 'vitest'

import { LOGIN_REPLY, fakeApi, makeUser, mountApp, restoreApi, settle } from '@/__tests__/helpers'
import RegisterView from '@/views/RegisterView.vue'

afterEach(restoreApi)

async function open() {
  return mountApp(RegisterView, { route: '/register' })
}

type Wrapper = Awaited<ReturnType<typeof open>>['wrapper']

async function fill(wrapper: Wrapper, values: Partial<Record<'name' | 'email' | 'phone' | 'password' | 'password_confirmation', string>>) {
  for (const [field, value] of Object.entries(values)) {
    await wrapper.get(`input[name=${field}]`).setValue(value)
  }
}

const valid = {
  name: 'Saw Eh Doh',
  email: 'eh@example.org',
  password: 'password123',
  password_confirmation: 'password123',
}

describe('RegisterView', () => {
  it('checks the form before sending anything', async () => {
    const { calls } = fakeApi(() => ({ data: {} }))
    const { wrapper } = await open()

    await fill(wrapper, { email: 'eh@example.org', password: 'short', password_confirmation: 'different' })
    await wrapper.get('form').trigger('submit')
    await settle()

    expect(calls).toHaveLength(0)
    const text = wrapper.text()
    expect(text).toContain('Enter your name.')
    expect(text).toContain('Use at least 8 characters.')
    expect(text).toContain('The passwords do not match.')
  })

  it('creates the account, signs in and opens the home page', async () => {
    const { calls } = fakeApi((call) => {
      if (call.url === '/auth/register') return { status: 201, data: { data: makeUser() } }
      if (call.url === '/auth/login') return LOGIN_REPLY()
      return { data: { data: makeUser() } }
    })
    const { wrapper, router } = await open()

    await fill(wrapper, valid)
    await wrapper.get('form').trigger('submit')
    await settle()

    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('home'))
    expect(calls[0]).toMatchObject({ url: '/auth/register', body: valid })
    expect(calls[1]).toMatchObject({ url: '/auth/login' })
  })

  it('sends the phone number only when one was typed', async () => {
    const { calls } = fakeApi((call) => (call.url === '/auth/register' ? { status: 201, data: { data: makeUser() } } : LOGIN_REPLY()))
    const { wrapper } = await open()

    await fill(wrapper, { ...valid, phone: ' +66 81 234 5678 ' })
    await wrapper.get('form').trigger('submit')
    await settle()

    expect(calls[0]?.body).toMatchObject({ phone: '+66 81 234 5678' })
  })

  it('puts the server\'s complaints under the fields they belong to', async () => {
    fakeApi(() => ({
      status: 422,
      data: {
        message: 'The email has already been taken. (and 1 more error)',
        errors: { email: ['The email has already been taken.'], phone: ['The phone has already been taken.'] },
      },
    }))
    const { wrapper, router } = await open()

    await fill(wrapper, { ...valid, phone: '0812345678' })
    await wrapper.get('form').trigger('submit')
    await settle()

    expect(wrapper.get('input[name=email]').attributes('aria-invalid')).toBe('true')
    expect(wrapper.text()).toContain('The email has already been taken.')
    expect(wrapper.text()).toContain('The phone has already been taken.')
    expect(wrapper.find('[role=alert]').exists()).toBe(false)
    expect(router.currentRoute.value.name).toBe('register')
  })

  it('sends the person to the login screen, with an explanation, if the account was made but signing in failed', async () => {
    fakeApi((call) => (call.url === '/auth/register' ? { status: 201, data: { data: makeUser() } } : { status: 429, headers: { 'retry-after': '30' }, data: {} }))
    const { wrapper, router } = await open()

    await fill(wrapper, valid)
    await wrapper.get('form').trigger('submit')
    await settle()

    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('login'))
    expect(router.currentRoute.value.query.created).toBe('1')
  })

  it('shows a general problem (offline) above the form', async () => {
    fakeApi(() => ({ network: true }))
    const { wrapper } = await open()

    await fill(wrapper, valid)
    await wrapper.get('form').trigger('submit')
    await settle()

    expect(wrapper.get('[role=alert]').text()).toContain("Can't reach the server")
  })

  it('asks the browser to suggest a new password, not fill in an old one', async () => {
    const { wrapper } = await open()

    expect(wrapper.get('input[name=password]').attributes('autocomplete')).toBe('new-password')
    expect(wrapper.get('input[name=password_confirmation]').attributes('autocomplete')).toBe('new-password')
  })
})
