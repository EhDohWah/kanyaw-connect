import { afterEach, describe, expect, it } from 'vitest'

import { fakeApi, makeUser, mountApp, restoreApi, settle, signIn, signedInStores, type Call, type Reply } from '@/__tests__/helpers'
import { useAuthStore } from '@/stores/auth'
import VerifyEmailView from '@/views/VerifyEmailView.vue'

afterEach(restoreApi)

const ID = '0195e2c4-0001-7a00-8100-5f3a9c000000'
const HASH = '7c4a8d09ca3762af61e59520943dc26494f8941b'
const LINK = `/verify-email?id=${ID}&hash=${HASH}&expires=1773565200&signature=e3b0c442`

function serve(verify: Reply, extra: (call: Call) => Reply | undefined = () => undefined) {
  return fakeApi((call) => {
    if (call.url.startsWith('/auth/email/verify/')) return verify
    return extra(call) ?? { data: { data: makeUser({ email: 'eh@example.org', email_verified_at: '2026-03-14T09:00:00.000000Z' }) } }
  })
}

async function open(route = LINK) {
  const mounted = await mountApp(VerifyEmailView, { route })
  await settle()
  return mounted
}

describe('VerifyEmailView', () => {
  it('sends the link\'s four values at once, exactly as they came, and clears them from the address bar', async () => {
    const { calls } = serve({ data: { message: 'Your email address is verified.', verified: true } })
    const { wrapper, router } = await open()

    const verify = calls.find((c) => c.url.startsWith('/auth/email/verify/'))!
    expect(verify.method).toBe('post')
    expect(verify.uri.endsWith(`/auth/email/verify/${ID}/${HASH}?expires=1773565200&signature=e3b0c442`)).toBe(true)
    expect(router.currentRoute.value.fullPath).toBe('/verify-email')
    expect(wrapper.find('[role=status]').text()).toBe('Your email address is verified. Thank you!')
  })

  it('signed out: verified, then "Sign in"', async () => {
    serve({ data: { verified: true } })
    const { wrapper } = await open()
    expect(wrapper.get('a[href="/login"]').text()).toBe('Sign in')
  })

  it('signed in: the profile is loaded again (the reminder goes), then "Continue"', async () => {
    const { calls } = serve({ data: { verified: true } })
    // Signed in with the profile already loaded (and unverified): only the reload after verifying asks for it.
    const { wrapper } = await mountApp(VerifyEmailView, {
      route: LINK,
      prepare: (pinia) => signedInStores(pinia, makeUser({ email: 'eh@example.org', email_verified_at: null })),
    })
    await settle()

    expect(calls.filter((c) => c.url === '/me')).toHaveLength(1)
    expect(calls.findIndex((c) => c.url === '/me')).toBeGreaterThan(calls.findIndex((c) => c.url.startsWith('/auth/email/verify/')))
    expect(useAuthStore().user?.email_verified_at).toBe('2026-03-14T09:00:00.000000Z')
    expect(wrapper.get('a[href="/"]').text()).toBe('Continue to Kanyaw Connect')
  })

  it('an expired or changed link (403): signed in, a new one can be sent from here', async () => {
    signIn()
    const { calls } = serve({ status: 403, data: { message: 'Invalid signature.' } }, (call) =>
      call.url === '/auth/email/verification-notification'
        ? { data: { message: 'We have emailed you a new verification link.', verified: false } }
        : call.url === '/me'
          ? { data: { data: makeUser({ email: 'eh@example.org', email_verified_at: null }) } }
          : undefined,
    )
    const { wrapper } = await open()

    expect(wrapper.find('[role=alert]').text()).toBe('This verification link has expired or is not valid. Links work for a day.')
    await wrapper.findAll('button').find((b) => b.text() === 'Send a new link')!.trigger('click')
    await settle()

    expect(calls.some((c) => c.method === 'post' && c.url === '/auth/email/verification-notification')).toBe(true)
    expect(wrapper.find('[role=status]').text()).toBe('A new link is on its way to eh@example.org.')
  })

  it('an expired link, signed out: sign in to get a new one', async () => {
    serve({ status: 403, data: { message: 'Invalid signature.' } })
    const { wrapper } = await open()
    expect(wrapper.get('a[href="/login?redirect=/settings"]').text()).toBe('Sign in to get a new link')
  })

  it('the account is gone (404): says so, and offers nothing', async () => {
    serve({ status: 404, data: { message: 'Not found.' } })
    const { wrapper } = await open()
    expect(wrapper.find('[role=alert]').text()).toBe('This account no longer exists.')
    expect(wrapper.findAll('button')).toHaveLength(0)
  })

  it('no connection: says so, and tries again on request', async () => {
    let online = false
    const { calls } = fakeApi(() => (online ? { data: { verified: true } } : { network: true }))
    const { wrapper } = await open()
    expect(wrapper.find('[role=alert]').text()).toBe("Can't reach the server. Check your connection and try again.")

    online = true
    await wrapper.findAll('button').find((b) => b.text() === 'Try again')!.trigger('click')
    await settle()
    expect(wrapper.find('[role=status]').text()).toBe('Your email address is verified. Thank you!')
    expect(calls).toHaveLength(2)
  })

  it('a link with a value missing: says so without asking the server', async () => {
    const { calls } = serve({ data: { verified: true } })
    const { wrapper } = await open(`/verify-email?id=${ID}&hash=${HASH}&expires=1773565200`)
    expect(wrapper.find('[role=alert]').text()).toBe('This link is incomplete. Open the link from the email again.')
    expect(calls.filter((c) => c.url.startsWith('/auth/email/verify/'))).toHaveLength(0)
  })
})
