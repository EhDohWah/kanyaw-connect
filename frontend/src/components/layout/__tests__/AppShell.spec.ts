import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeApi, makeUser, mountApp, page, restoreApi, settle, signIn } from '@/__tests__/helpers'
import App from '@/App.vue'

beforeEach(() => signIn())
afterEach(restoreApi)

function serve(extra: Parameters<typeof fakeApi>[0] = () => ({ status: 204 })) {
  return fakeApi((call) => {
    if (call.url === '/me' && call.method === 'get') return { data: { data: makeUser() } }
    if (call.url === '/chats' && call.method === 'get') return { data: page([]) }
    return extra(call)
  })
}

/** `attached` puts the app in the real page: needed when the test looks at focus, which detached elements cannot have. */
async function open(route: string, attached = false) {
  let attachTo: HTMLElement | undefined
  if (attached) {
    attachTo = document.createElement('div')
    attachTo.id = 'app'
    document.body.append(attachTo)
  }
  const mounted = await mountApp(App, { route, ...(attachTo ? { attachTo } : {}) })
  await vi.waitFor(() => expect(mounted.wrapper.find('main#main').exists()).toBe(true))
  await settle()
  return mounted
}

describe('AppShell', () => {
  it('shows the navigation, with Home marked as the current page', async () => {
    serve()
    const { wrapper } = await open('/')

    const navs = wrapper.findAll('nav')
    expect(navs.length).toBeGreaterThanOrEqual(2) // side navigation and bottom bar (CSS decides which one is visible)

    const side = wrapper.get('nav')
    const current = side.findAll('[aria-current="page"]')
    expect(current).toHaveLength(1)
    expect(current[0]?.text()).toBe('Home')
    expect(side.findAll('ul a').map((a) => a.text())).toEqual(['Home', 'Messages', 'Meetings', 'Profile', 'Settings'])
  })

  it('marks Messages as current inside a list of chats, not Home', async () => {
    serve()
    const { wrapper } = await open('/chats')

    const current = wrapper.get('nav').findAll('[aria-current="page"]')
    expect(current.map((a) => a.text())).toEqual(['Messages'])
  })

  it('shows the bottom bar on normal pages, with a labelled Create button, and not inside a conversation', async () => {
    serve()
    const normal = await open('/chats')
    expect(normal.wrapper.find('nav.fixed').exists()).toBe(true)
    expect(normal.wrapper.get('nav.fixed button').attributes('aria-label')).toBe('Create')
    normal.wrapper.unmount()

    const conversation = await open('/chats/0195e2c4-0001-7a00-8100-5f3a9c000000')
    expect(conversation.wrapper.find('nav.fixed').exists()).toBe(false)
  })

  it('has no Settings link in the bottom bar (it is reached from Profile), but the other four places', async () => {
    serve()
    const { wrapper } = await open('/')

    const labels = wrapper.get('nav.fixed').findAll('a').map((a) => a.text())
    expect(labels).toEqual(['Home', 'Messages', 'Meetings', 'Profile'])
  })

  it('starts the heartbeat once the app is shown', async () => {
    const { calls } = serve()
    await open('/')

    await vi.waitFor(() => expect(calls.some((call) => call.url === '/me/heartbeat' && call.method === 'post')).toBe(true))
  })

  it('stops the heartbeat when the shell goes away (signing out)', async () => {
    const { calls } = serve()
    const { wrapper } = await open('/')
    await vi.waitFor(() => expect(calls.filter((call) => call.url === '/me/heartbeat')).toHaveLength(1))

    wrapper.unmount()
    document.dispatchEvent(new Event('visibilitychange'))
    await settle()

    expect(calls.filter((call) => call.url === '/me/heartbeat')).toHaveLength(1)
  })

  it('shows the right sidebar placeholder for wide screens', async () => {
    serve()
    const { wrapper } = await open('/')

    const sidebar = wrapper.get('aside')
    expect(sidebar.attributes('aria-label')).toBe('People & activity')
    expect(sidebar.text()).toContain('Who is online')
  })

  it('offers "Try again" instead of throwing the person out when the server cannot be reached at start', async () => {
    let online = false
    fakeApi((call) => {
      if (call.url === '/me' && call.method === 'get') return online ? { data: { data: makeUser() } } : { network: true }
      return { status: 204 }
    })
    const { wrapper } = await open('/profile')

    expect(wrapper.get('[role=alert]').text()).toContain("Can't reach the server")
    expect(window.localStorage.getItem('kc.token')).toBe('1|secret-token')

    online = true
    await wrapper.get('[role=alert] button').trigger('click')
    await vi.waitFor(() => expect(wrapper.find('[role=alert]').exists()).toBe(false))
    expect(wrapper.text()).toContain('Profile')
  })

  it('shows a banner while the browser is offline', async () => {
    serve()
    const { wrapper } = await open('/')
    expect(wrapper.text()).not.toContain('You are offline')

    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    window.dispatchEvent(new Event('offline'))
    await settle(2)

    expect(wrapper.get('[role=status]').text()).toContain('You are offline')
  })

  it('opens the Create menu as a dialog and closes it with Escape', async () => {
    serve()
    const { wrapper } = await open('/')

    await wrapper.get('nav button').trigger('click')
    const dialog = document.body.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog?.textContent).toContain('Start a meeting')
    expect(dialog?.textContent).toContain('Coming soon')

    dialog?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await vi.waitFor(() => expect(document.body.querySelector('[role="dialog"]')).toBeNull())
  })

  it('shows the not-found page inside the app for an unknown address', async () => {
    serve()
    const { wrapper } = await open('/no/such/page')

    expect(wrapper.text()).toContain('Page not found')
    expect(wrapper.get('main a[href="/"]').text()).toBe('Go to home')
  })
})

describe('App', () => {
  it('sets the page title from the page and the language', async () => {
    serve()
    await open('/chats')
    expect(document.title).toBe('Messages · Kanyaw Connect')
  })

  it('moves focus to the main content after going to another page, so a screen reader hears the change', async () => {
    serve()
    const { wrapper, router } = await open('/', true)

    await router.push('/profile')
    await vi.waitFor(() => expect(document.activeElement?.id).toBe('main'))
    expect(wrapper.find('main#main').exists()).toBe(true)
  })

  it('has a skip link as the very first focusable element', async () => {
    serve()
    const { wrapper } = await open('/')

    const first = wrapper.get('a')
    expect(first.attributes('href')).toBe('#main')
    expect(first.text()).toBe('Skip to main content')
  })
})
