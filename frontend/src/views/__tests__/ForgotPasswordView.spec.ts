import { afterEach, describe, expect, it } from 'vitest'

import { fakeApi, mountApp, restoreApi, settle } from '@/__tests__/helpers'
import ForgotPasswordView from '@/views/ForgotPasswordView.vue'

afterEach(restoreApi)

const SERVER_ANSWER = { data: { message: 'If an account uses that address, we have emailed it a link to reset the password.' } }

async function open(route = '/forgot-password') {
  return mountApp(ForgotPasswordView, { route })
}

describe('ForgotPasswordView', () => {
  it('asks for the address and sends it', async () => {
    const { calls } = fakeApi(() => SERVER_ANSWER)
    const { wrapper } = await open()

    await wrapper.get('input[name=email]').setValue('  paw@example.com ')
    await wrapper.get('form').trigger('submit')
    await settle()

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ method: 'post', url: '/auth/forgot-password', body: { email: 'paw@example.com' } })
    expect(wrapper.find('[role=status]').text()).toBe('If an account uses paw@example.com, a link to reset its password is on its way. It works for 60 minutes.')
    expect(wrapper.find('form').exists()).toBe(false)
  })

  it('says the same whatever the server knows (it answers the same too)', async () => {
    fakeApi(() => SERVER_ANSWER)
    const { wrapper } = await open()
    await wrapper.get('input[name=email]').setValue('nobody@example.com')
    await wrapper.get('form').trigger('submit')
    await settle()

    expect(wrapper.find('[role=status]').text()).toContain('If an account uses nobody@example.com')
  })

  it('fills in the address typed on the sign-in page', async () => {
    fakeApi(() => SERVER_ANSWER)
    const { wrapper } = await open('/forgot-password?email=eh%40example.org')
    expect((wrapper.get('input[name=email]').element as HTMLInputElement).value).toBe('eh@example.org')
  })

  it('needs an address before sending anything', async () => {
    const { calls } = fakeApi(() => SERVER_ANSWER)
    const { wrapper } = await open()
    await wrapper.get('form').trigger('submit')
    await settle()

    expect(calls).toHaveLength(0)
    expect(wrapper.text()).toContain('Enter your email address.')
  })

  it('shows the server\'s word on a malformed address, and the wait after too many tries', async () => {
    fakeApi(() => ({ status: 422, data: { message: 'The email field must be a valid email address.', errors: { email: ['The email field must be a valid email address.'] } } }))
    const { wrapper } = await open()
    await wrapper.get('input[name=email]').setValue('paw@')
    await wrapper.get('form').trigger('submit')
    await settle()
    expect(wrapper.text()).toContain('The email field must be a valid email address.')
    expect(wrapper.get('input[name=email]').attributes('aria-invalid')).toBe('true') // on the field, not the form
    expect(wrapper.find('[role=alert]').exists()).toBe(false)

    fakeApi(() => ({ status: 429, headers: { 'retry-after': '42' }, data: { message: 'Too Many Attempts.' } }))
    await wrapper.get('input[name=email]').setValue('paw@example.com')
    await wrapper.get('form').trigger('submit')
    await settle()
    expect(wrapper.find('[role=alert]').text()).toBe('Too many requests. Please wait 42 seconds and try again.')
  })

  it('can ask again, and goes back to sign in', async () => {
    fakeApi(() => SERVER_ANSWER)
    const { wrapper } = await open()
    await wrapper.get('input[name=email]').setValue('paw@example.com')
    await wrapper.get('form').trigger('submit')
    await settle()

    await wrapper.get('button').trigger('click')
    expect(wrapper.find('form').exists()).toBe(true)
    expect((wrapper.get('input[name=email]').element as HTMLInputElement).value).toBe('paw@example.com')
    expect(wrapper.get('a[href="/login"]').text()).toBe('Back to sign in')
  })
})
