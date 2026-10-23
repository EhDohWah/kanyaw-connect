import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeApi, makeUser, mountApp, restoreApi, settle, signIn } from '@/__tests__/helpers'
import SettingsView from '@/views/SettingsView.vue'

beforeEach(() => signIn())
afterEach(restoreApi)

describe('SettingsView', () => {
  it('shows who is signed in', async () => {
    fakeApi(() => ({ data: { data: makeUser({ name: 'Naw Paw Say', email: 'paw@example.org' }) } }))
    const { wrapper } = await mountApp(SettingsView, { route: '/settings' })
    await settle()

    expect(wrapper.text()).toContain('Signed in as Naw Paw Say')
    expect(wrapper.text()).toContain('paw@example.org')
  })

  it('signs out: revokes the token, forgets it, and shows the login screen', async () => {
    const { calls } = fakeApi((call) => (call.url === '/auth/logout' ? { data: { message: 'Logged out.' } } : { data: { data: makeUser() } }))
    const { wrapper, router } = await mountApp(SettingsView, { route: '/settings' })
    await settle()

    await wrapper.get('button').trigger('click')
    await settle()

    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('login'))
    expect(calls.at(-1)).toMatchObject({ method: 'post', url: '/auth/logout' })
    expect(window.localStorage.getItem('kc.token')).toBeNull()
  })

  it('signs out even when the server cannot be reached', async () => {
    fakeApi((call) => (call.url === '/auth/logout' ? { network: true } : { data: { data: makeUser() } }))
    const { wrapper, router } = await mountApp(SettingsView, { route: '/settings' })
    await settle()

    await wrapper.get('button').trigger('click')
    await settle()

    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('login'))
    expect(window.localStorage.getItem('kc.token')).toBeNull()
  })
})
