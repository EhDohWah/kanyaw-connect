import { afterEach, describe, expect, it, vi } from 'vitest'

import { fakeApi, mountApp, restoreApi, settle, signIn } from '@/__tests__/helpers'
import { useAuthStore } from '@/stores/auth'
import ResetPasswordView from '@/views/ResetPasswordView.vue'

afterEach(restoreApi)

const TOKEN = 'a'.repeat(64)
const LINK = `/reset-password?token=${TOKEN}&email=paw%40example.com`

async function open(route = LINK) {
  const mounted = await mountApp(ResetPasswordView, { route })
  await settle()
  return mounted
}

async function choose(wrapper: Awaited<ReturnType<typeof open>>['wrapper'], password: string, confirmation = password) {
  await wrapper.get('input[name=password]').setValue(password)
  await wrapper.get('input[name=password_confirmation]').setValue(confirmation)
  await wrapper.get('form').trigger('submit')
  await settle()
}

describe('ResetPasswordView', () => {
  it('takes the token out of the address bar at once (no history, no referrer), and says whose account it is', async () => {
    fakeApi(() => ({ data: {} }))
    const { wrapper, router } = await open()

    expect(router.currentRoute.value.fullPath).toBe('/reset-password')
    expect(wrapper.text()).toContain('For the account paw@example.com.')
    expect((wrapper.get('input[autocomplete=username]').element as HTMLInputElement).value).toBe('paw@example.com')
  })

  it('sends the token, the address and the new password twice, then offers to sign in with that address', async () => {
    const { calls } = fakeApi(() => ({ data: { message: 'Your password has been reset. Sign in with the new one.' } }))
    const { wrapper } = await open()

    await choose(wrapper, 'brand-new-password')

    expect(calls[0]).toMatchObject({
      method: 'post',
      url: '/auth/reset-password',
      body: { token: TOKEN, email: 'paw@example.com', password: 'brand-new-password', password_confirmation: 'brand-new-password' },
    })
    expect(wrapper.find('[role=status]').text()).toContain('Every device has been signed out')
    expect(wrapper.get('a[href="/login?email=paw@example.com"]').text()).toBe('Sign in')
    expect(wrapper.findAll('a').map((a) => a.text())).toEqual(['Sign in']) // not also "Back to sign in"
  })

  it('signs this device out too when it was signed in (the server ended every session)', async () => {
    signIn()
    fakeApi(() => ({ data: { message: 'ok' } }))
    const { wrapper } = await open()
    expect(useAuthStore().isAuthenticated).toBe(true)

    await choose(wrapper, 'brand-new-password')

    expect(useAuthStore().isAuthenticated).toBe(false)
    expect(window.localStorage.getItem('kc.token')).toBeNull()
  })

  it('checks the new password before sending: 8 characters, typed twice the same', async () => {
    const { calls } = fakeApi(() => ({ data: {} }))
    const { wrapper } = await open()

    await choose(wrapper, 'short')
    expect(wrapper.text()).toContain('Use at least 8 characters.')
    await choose(wrapper, 'brand-new-password', 'something-else')
    expect(wrapper.text()).toContain('The passwords do not match.')
    expect(calls).toHaveLength(0)
  })

  it('a used or expired link: says so, and offers a new one for the same address', async () => {
    fakeApi(() => ({
      status: 422,
      data: { message: 'This password reset link is not valid or has expired. Ask for a new one.', errors: { token: ['This password reset link is not valid or has expired. Ask for a new one.'] } },
    }))
    const { wrapper } = await open()

    await choose(wrapper, 'brand-new-password')

    expect(wrapper.find('[role=alert]').text()).toBe('This link is not valid or has expired. Reset links work once, for 60 minutes.')
    expect(wrapper.get('a[href="/forgot-password?email=paw@example.com"]').text()).toBe('Ask for a new link')
    expect(wrapper.find('form').exists()).toBe(false)
  })

  it('shows the server\'s word on the password field, and other problems for the form', async () => {
    fakeApi(() => ({ status: 422, data: { message: 'The password field must be at least 8 characters.', errors: { password: ['The password field must be at least 8 characters.'] } } }))
    const { wrapper } = await open()
    await choose(wrapper, 'brand-new-password')
    expect(wrapper.text()).toContain('The password field must be at least 8 characters.')
    expect(wrapper.find('form').exists()).toBe(true)

    fakeApi(() => ({ network: true }))
    await choose(wrapper, 'brand-new-password')
    expect(wrapper.find('[role=alert]').text()).toBe("Can't reach the server. Check your connection and try again.")
  })

  it('a link without its token or address: says so, with the way to a new one', async () => {
    const { calls } = fakeApi(() => ({ data: {} }))
    const { wrapper } = await open('/reset-password?email=paw%40example.com')

    expect(wrapper.find('[role=alert]').text()).toBe('This link is incomplete. Open the link from the email again, or ask for a new one.')
    expect(wrapper.find('form').exists()).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('opens for a signed-in person too (the link may be opened anywhere)', async () => {
    signIn()
    fakeApi(() => ({ data: {} }))
    const { router } = await open()
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('reset-password'))
  })
})
