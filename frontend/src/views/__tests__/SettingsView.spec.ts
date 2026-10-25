import type { DOMWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SUBSCRIPTION, useFakePush } from '@/__tests__/fakePush'
import { fakeApi, makeUser, mountApp, restoreApi, settle, signIn, type Call, type Reply } from '@/__tests__/helpers'
import { useAuthStore } from '@/stores/auth'
import { PUSH_OWNER_KEY } from '@/stores/push'
import type { User } from '@/types/user'
import SettingsView from '@/views/SettingsView.vue'

const KEY = 'BOkHTBX7c6Iy4iAw-ZX54HhOcQ2y-QwO9Nn-k8NXXNmKdRHB8Ljr0pYb_tfu5GdKp8hHMTDdjmwoGOe6B7u5TrQ'
const RECORD = { id: 'sub-1', endpoint: SUBSCRIPTION.endpoint, created_at: '2026-03-14T09:08:26.304038Z' }

beforeEach(() => signIn())
afterEach(restoreApi)

interface Server {
  user: User
  pushEnabled: boolean
  known: (typeof RECORD)[]
  fail: Partial<Record<string, Reply>>
}

let server: Server

function serve() {
  return fakeApi((call: Call): Reply => {
    const failure = server.fail[`${call.method} ${call.url}`]
    if (failure) return failure
    if (call.url === '/me' && call.method === 'patch') {
      const patch = call.body as { settings?: Record<string, unknown> }
      server.user = { ...server.user, settings: { ...server.user.settings, ...patch.settings } }
      return { data: { data: server.user } }
    }
    if (call.url === '/me') return { data: { data: server.user } }
    if (call.url === '/auth/logout') return { data: { message: 'Logged out.' } }
    if (call.url === '/push/public-key') return { data: { data: { enabled: server.pushEnabled, public_key: server.pushEnabled ? KEY : null } } }
    if (call.url === '/push/subscriptions' && call.method === 'get') return { data: { data: server.known } }
    if (call.url === '/push/subscriptions' && call.method === 'post') {
      server.known = [RECORD]
      return { status: 201, data: { data: RECORD } }
    }
    if (call.method === 'delete') return { status: 204 }
    return { status: 404, data: { message: 'Not found.' } }
  })
}

beforeEach(() => {
  server = { user: makeUser(), pushEnabled: true, known: [], fail: {} }
})

async function open() {
  const api = serve()
  const mounted = await mountApp(SettingsView, { route: '/settings' })
  await settle()
  return { ...mounted, calls: api.calls }
}

const section = (wrapper: Awaited<ReturnType<typeof open>>['wrapper'], name: string) =>
  wrapper.findAll('section').find((each) => each.find('h2').text() === name)

const switchIn = (scope: DOMWrapper<Element> | undefined) => scope!.get('[role=switch]')

describe('SettingsView: account', () => {
  it('shows who is signed in', async () => {
    server.user = makeUser({ name: 'Naw Paw Say', email: 'paw@example.org' })
    const { wrapper } = await open()

    expect(wrapper.text()).toContain('Signed in as Naw Paw Say')
    expect(wrapper.text()).toContain('paw@example.org')
  })

  it('signs out: revokes the token, forgets it, and shows the login screen', async () => {
    const { wrapper, router, calls } = await open()

    await wrapper.findAll('button').find((button) => button.text() === 'Sign out')!.trigger('click')
    await settle()

    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('login'))
    expect(calls.at(-1)).toMatchObject({ method: 'post', url: '/auth/logout' })
    expect(window.localStorage.getItem('kc.token')).toBeNull()
  })

  it('signs out even when the server cannot be reached', async () => {
    server.fail['post /auth/logout'] = { network: true }
    const { wrapper, router } = await open()

    await wrapper.findAll('button').find((button) => button.text() === 'Sign out')!.trigger('click')
    await settle()

    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('login'))
    expect(window.localStorage.getItem('kc.token')).toBeNull()
  })

  it('the sections are named by their headings, in this order', async () => {
    useFakePush()
    const { wrapper } = await open()

    expect(wrapper.findAll('h2').map((h) => h.text())).toEqual(['Notifications', 'Calls', 'Meetings', 'Account'])
    for (const each of wrapper.findAll('section')) {
      expect(each.attributes('aria-labelledby')).toBe(each.get('h2').attributes('id'))
    }
  })
})

describe('SettingsView: notifications', () => {
  it('off: a switch that says what it does; turning it on asks, subscribes and registers this browser', async () => {
    const fake = useFakePush()
    const { wrapper, calls } = await open()
    const notifications = section(wrapper, 'Notifications')
    const toggle = switchIn(notifications)

    expect(notifications!.text()).toContain('Notifications on this browser')
    expect(notifications!.text()).toContain('New messages and meeting invitations, even when Kanyaw Connect is closed.')
    expect(toggle.attributes('aria-checked')).toBe('false')

    await toggle.trigger('click')
    expect(fake.requestPermission).toHaveBeenCalledTimes(1)
    await settle()

    expect(calls.filter((c) => c.method === 'post' && c.url === '/push/subscriptions')).toHaveLength(1)
    expect(switchIn(section(wrapper, 'Notifications')).attributes('aria-checked')).toBe('true')
  })

  it('says it is working while turning on, and the switch cannot be tapped again meanwhile', async () => {
    const fake = useFakePush()
    let answer: (value: NotificationPermission) => void = () => undefined
    fake.requestPermission.mockImplementation(() => new Promise((resolve) => (answer = resolve)))
    const { wrapper } = await open()

    await switchIn(section(wrapper, 'Notifications')).trigger('click')
    await settle()
    expect(wrapper.get('[role=status]').text()).toBe('Turning on notifications…')
    expect(switchIn(section(wrapper, 'Notifications')).attributes('disabled')).toBeDefined()

    answer('granted')
    await settle()
    expect(wrapper.find('[role=status]').exists()).toBe(false)
  })

  it('on: turning it off ends the subscription here and on the server', async () => {
    const fake = useFakePush({ permission: 'granted', subscription: SUBSCRIPTION })
    server.known = [RECORD]
    const { wrapper, calls } = await open()
    const toggle = switchIn(section(wrapper, 'Notifications'))
    expect(toggle.attributes('aria-checked')).toBe('true')

    await toggle.trigger('click')
    await settle()

    expect(fake.unsubscribe).toHaveBeenCalled()
    expect(calls.some((c) => c.method === 'delete' && c.url === '/push/subscriptions/sub-1')).toBe(true)
    expect(switchIn(section(wrapper, 'Notifications')).attributes('aria-checked')).toBe('false')
    expect(window.localStorage.getItem(PUSH_OWNER_KEY)).toBeNull()
  })

  it('refused when asked: the switch is off and disabled, and the page says how to allow them', async () => {
    useFakePush({ answer: 'denied' })
    const { wrapper } = await open()

    await switchIn(section(wrapper, 'Notifications')).trigger('click')
    await settle()

    const notifications = section(wrapper, 'Notifications')!
    expect(switchIn(notifications).attributes('disabled')).toBeDefined()
    expect(notifications.text()).toContain('Notifications are blocked for this site.')
    expect(notifications.text()).toContain("allow notifications for this site in your browser's settings")
  })

  it('allowed again in the browser\'s settings while the page is open: the switch comes back', async () => {
    const fake = useFakePush({ permission: 'denied' })
    const { wrapper } = await open()
    expect(switchIn(section(wrapper, 'Notifications')).attributes('disabled')).toBeDefined()

    fake.changePermission('granted')
    await settle()
    expect(switchIn(section(wrapper, 'Notifications')).attributes('disabled')).toBeUndefined()
  })

  it('looks again when the person comes back to the page', async () => {
    useFakePush()
    const { calls } = await open()
    const before = calls.filter((c) => c.url === '/push/public-key').length

    document.dispatchEvent(new Event('visibilitychange'))
    await settle()
    expect(calls.filter((c) => c.url === '/push/public-key').length).toBe(before + 1)
  })

  it('stops looking once the page is left', async () => {
    const fake = useFakePush()
    const { wrapper, calls } = await open()
    wrapper.unmount()
    const before = calls.length

    document.dispatchEvent(new Event('visibilitychange'))
    fake.changePermission('granted')
    await settle()
    expect(calls.length).toBe(before)
  })

  it('the browser cannot subscribe: says so under the switch, which stays off', async () => {
    useFakePush({ permission: 'granted', failSubscribe: new Error('AbortError') })
    const { wrapper } = await open()

    await switchIn(section(wrapper, 'Notifications')).trigger('click')
    await settle()

    expect(wrapper.get('[role=alert]').text()).toBe('This browser could not turn on notifications. Please try again later.')
    expect(switchIn(section(wrapper, 'Notifications')).attributes('aria-checked')).toBe('false')
  })

  it('the server refuses: its reason, translated where it can be (here: too many tries)', async () => {
    useFakePush({ permission: 'granted' })
    server.fail['post /push/subscriptions'] = { status: 429, headers: { 'retry-after': '120' }, data: { message: 'Too Many Attempts.' } }
    const { wrapper } = await open()

    await switchIn(section(wrapper, 'Notifications')).trigger('click')
    await settle()
    expect(wrapper.get('[role=alert]').text()).toBe('Too many requests. Please wait 120 seconds and try again.')
  })

  it('while checking: a placeholder, with words for screen readers', async () => {
    useFakePush()
    serve()
    const { wrapper } = await mountApp(SettingsView, { route: '/settings' })

    expect(wrapper.get('[role=status]').text()).toBe('Checking notifications…')
    await settle()
  })

  it('could not check: says why, and tries again', async () => {
    useFakePush()
    server.fail['get /push/public-key'] = { network: true }
    const { wrapper } = await open()

    expect(wrapper.get('[role=alert]').text()).toBe("Can't reach the server. Check your connection and try again.")
    delete server.fail['get /push/public-key']
    await wrapper.findAll('button').find((button) => button.text() === 'Try again')!.trigger('click')
    await settle()

    expect(switchIn(section(wrapper, 'Notifications')).attributes('aria-checked')).toBe('false')
  })

  it('a browser that cannot show notifications says so', async () => {
    useFakePush({ supported: false })
    const { wrapper } = await open()

    expect(section(wrapper, 'Notifications')!.text()).toContain("This browser can't show notifications from Kanyaw Connect.")
    expect(section(wrapper, 'Notifications')!.find('[role=switch]').exists()).toBe(false)
  })

  it('an iPhone not opened from the Home Screen: how to add it there', async () => {
    useFakePush({ supported: false, needsHomeScreen: true })
    const { wrapper } = await open()

    expect(section(wrapper, 'Notifications')!.text()).toContain('notifications work once Kanyaw Connect is on your Home Screen')
  })

  it('the server has push switched off: no Notifications section at all', async () => {
    useFakePush()
    server.pushEnabled = false
    const { wrapper } = await open()

    expect(section(wrapper, 'Notifications')).toBeUndefined()
    expect(wrapper.findAll('h2').map((h) => h.text())).toEqual(['Calls', 'Meetings', 'Account'])
  })
})

describe('SettingsView: data saver', () => {
  it('shows the saved setting', async () => {
    server.user = makeUser({ settings: { data_saver: true } })
    const { wrapper } = await open()

    const toggle = switchIn(section(wrapper, 'Meetings'))
    expect(toggle.attributes('aria-checked')).toBe('true')
    expect(section(wrapper, 'Meetings')!.text()).toContain('Data saver: turn off incoming video')
    expect(section(wrapper, 'Meetings')!.text()).toContain('Screen shares still show.')
  })

  it('is saved in the account\'s settings (PATCH /me), only that key, and the next meeting starts with it', async () => {
    server.user = makeUser({ settings: { theme: 'light' } })
    const { wrapper, calls } = await open()

    await switchIn(section(wrapper, 'Meetings')).trigger('click')
    await settle()

    expect(calls.find((c) => c.method === 'patch' && c.url === '/me')!.body).toEqual({ settings: { data_saver: true } })
    expect(useAuthStore().user!.settings).toEqual({ theme: 'light', data_saver: true })
    expect(switchIn(section(wrapper, 'Meetings')).attributes('aria-checked')).toBe('true')
  })

  it('changes at once, cannot be tapped again until saved, and goes back with the reason if the server refuses', async () => {
    server.fail['patch /me'] = { status: 500, data: { message: 'Server Error' } }
    const { wrapper } = await open()

    await switchIn(section(wrapper, 'Meetings')).trigger('click')
    expect(switchIn(section(wrapper, 'Meetings')).attributes('aria-checked')).toBe('true')
    expect(switchIn(section(wrapper, 'Meetings')).attributes('disabled')).toBeDefined()
    await settle()

    expect(switchIn(section(wrapper, 'Meetings')).attributes('aria-checked')).toBe('false')
    expect(switchIn(section(wrapper, 'Meetings')).attributes('disabled')).toBeUndefined()
    expect(section(wrapper, 'Meetings')!.get('[role=alert]').text()).toBe('Something went wrong on our side. Please try again in a moment.')
  })
})

describe('SettingsView: calls', () => {
  it('Ringtone and Vibration are on until switched off', async () => {
    const { wrapper } = await open()
    const switches = section(wrapper, 'Calls')!.findAll('[role=switch]')

    expect(section(wrapper, 'Calls')!.text()).toContain('Ringtone')
    expect(section(wrapper, 'Calls')!.text()).toContain('Vibration')
    expect(switches.map((each) => each.attributes('aria-checked'))).toEqual(['true', 'true'])
  })

  it('saves each switch in settings with PATCH /me', async () => {
    const { wrapper, calls } = await open()
    const [ringtone, vibration] = section(wrapper, 'Calls')!.findAll('[role=switch]')

    await ringtone!.trigger('click')
    await settle()
    await vibration!.trigger('click')
    await settle()

    const patches = calls.filter((call) => call.method === 'patch').map((call) => call.body)
    expect(patches).toEqual([{ settings: { call_ringtone: false } }, { settings: { call_vibrate: false } }])
    expect(useAuthStore().user?.settings).toMatchObject({ call_ringtone: false, call_vibrate: false })
  })

  it('shows what was saved before', async () => {
    server.user = makeUser({ settings: { call_ringtone: false } })
    const { wrapper } = await open()
    expect(section(wrapper, 'Calls')!.findAll('[role=switch]').map((each) => each.attributes('aria-checked'))).toEqual(['false', 'true'])
  })

  it('puts the switch back and says so when saving fails', async () => {
    server.fail['patch /me'] = { status: 500, data: { message: 'Server Error' } }
    const { wrapper } = await open()

    await section(wrapper, 'Calls')!.findAll('[role=switch]')[0]!.trigger('click')
    await settle()

    expect(section(wrapper, 'Calls')!.findAll('[role=switch]')[0]!.attributes('aria-checked')).toBe('true')
    expect(section(wrapper, 'Calls')!.find('[role=alert]').exists()).toBe(true)
  })
})
