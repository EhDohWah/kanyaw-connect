import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeApi, makeUser, mountApp, restoreApi, settle, signIn, signedInStores, type Call, type Reply } from '@/__tests__/helpers'
import VerifyEmailBanner, { HIDE_KEY, RECHECK_MS } from '@/components/layout/VerifyEmailBanner.vue'
import { useAuthStore } from '@/stores/auth'
import type { User } from '@/types/user'

const UNVERIFIED = makeUser({ id: 'eh', email: 'eh@example.org', email_verified_at: null })

beforeEach(() => {
  signIn()
  window.sessionStorage.clear()
})
afterEach(() => {
  restoreApi()
  vi.useRealTimers()
})

function serve(respond: (call: Call) => Reply | undefined = () => undefined) {
  return fakeApi((call) => respond(call) ?? { data: { message: 'We have emailed you a new verification link.', verified: false } })
}

async function open(user: User = UNVERIFIED) {
  const mounted = await mountApp(VerifyEmailBanner, { route: '/', prepare: (pinia) => signedInStores(pinia, user) })
  await settle()
  return mounted
}

const button = (wrapper: Awaited<ReturnType<typeof open>>['wrapper'], name: string) =>
  wrapper.findAll('button').find((b) => b.text() === name || b.attributes('aria-label') === name)

function visible(): void {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('VerifyEmailBanner', () => {
  it('reminds an unverified person, with the address', async () => {
    serve()
    const { wrapper } = await open()
    expect(wrapper.text()).toContain('Please verify your email address: we sent a link to eh@example.org.')
    expect(wrapper.get('[role=region]').attributes('aria-label')).toBe('Verify your email')
  })

  it('is not there once the address is verified', async () => {
    serve()
    const { wrapper } = await open(makeUser({ email_verified_at: '2026-03-14T09:00:00.000000Z' }))
    expect(wrapper.find('[role=region]').exists()).toBe(false)
  })

  it('"Send again" sends a new link and says so', async () => {
    const { calls } = serve()
    const { wrapper } = await open()

    await button(wrapper, 'Send again')!.trigger('click')
    await settle()

    expect(calls.filter((c) => c.method === 'post' && c.url === '/auth/email/verification-notification')).toHaveLength(1)
    expect(wrapper.find('[role=status]').text()).toBe('Sent. Check your inbox.')
    expect(button(wrapper, 'Send again')).toBeUndefined()
  })

  it('verified meanwhile (on another device): the profile is loaded again and the reminder goes', async () => {
    serve((call) =>
      call.url === '/auth/email/verification-notification'
        ? { data: { message: 'Your email address is already verified.', verified: true } }
        : call.url === '/me'
          ? { data: { data: { ...UNVERIFIED, email_verified_at: '2026-03-14T09:00:00.000000Z' } } }
          : undefined,
    )
    const { wrapper } = await open()

    await button(wrapper, 'Send again')!.trigger('click')
    await settle()

    expect(useAuthStore().user?.email_verified_at).not.toBeNull()
    expect(wrapper.find('[role=region]').exists()).toBe(false)
  })

  it('too many requests: says how long to wait', async () => {
    serve(() => ({ status: 429, headers: { 'retry-after': '120' }, data: { message: 'Too Many Attempts.' } }))
    const { wrapper } = await open()
    await button(wrapper, 'Send again')!.trigger('click')
    await settle()
    expect(wrapper.find('[role=alert]').text()).toBe('Too many requests. Please wait 120 seconds and try again.')
  })

  it('can be hidden for the rest of the session, for this person only', async () => {
    serve()
    const first = await open()
    await button(first.wrapper, 'Hide this reminder')!.trigger('click')
    expect(first.wrapper.find('[role=region]').exists()).toBe(false)
    expect(window.sessionStorage.getItem(HIDE_KEY)).toBe('eh')

    // Reloaded: still hidden. Someone else signs in on this browser: they see theirs.
    expect((await open()).wrapper.find('[role=region]').exists()).toBe(false)
    expect((await open(makeUser({ id: 'paw', email_verified_at: null }))).wrapper.find('[role=region]').exists()).toBe(true)
  })

  it('looks again when the person comes back to the tab, at most every 30 seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { calls } = serve((call) => (call.url === '/me' ? { data: { data: UNVERIFIED } } : undefined))
    await open()
    const reloads = () => calls.filter((c) => c.url === '/me').length

    visible()
    await settle()
    expect(reloads()).toBe(0) // just opened

    vi.advanceTimersByTime(RECHECK_MS)
    visible()
    await settle()
    expect(reloads()).toBe(1)

    visible()
    await settle()
    expect(reloads()).toBe(1)
  })
})
