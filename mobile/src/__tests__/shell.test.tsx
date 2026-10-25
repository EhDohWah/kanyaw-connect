import * as SecureStore from 'expo-secure-store'
import { fireEvent, screen, waitFor } from '@testing-library/react-native'

import { useAuthStore } from '@/stores/auth'
import { useChatsStore } from '@/stores/chats'
import { makeChat, makeUser } from '@/testing/factories'
import { echoes } from '@/testing/fakeEcho'
import { fakeApi, restoreApi, type Call, type Reply } from '@/testing/fakeApi'
import { currentPath, renderApp } from '@/testing/renderApp'
import { i18n } from '@/i18n'

// No real WebSocket in tests: the app's connection uses the fake Echo.
jest.mock('@/realtime/echo', () => ({
  createEcho: (token: string) => jest.requireActual('@/testing/fakeEcho').fakeEchoFactory(token),
}))
jest.mock('expo-device', () => ({ modelName: 'Pixel 7' }))

// Rendering the whole router takes a few seconds per test.
jest.setTimeout(20_000)

const store = SecureStore as unknown as { __reset(): void; __dump(): Record<string, string> }
const initialAuth = useAuthStore.getState()

/** The server: `/me` answers with the person, `/chats` with these chats, everything else with "OK". */
function server(
  chats = [makeChat({ name: 'Choir', type: 'group', other_user: undefined })],
  extra?: (call: Call) => Reply | undefined,
) {
  return fakeApi((call) => {
    const special = extra?.(call)
    if (special) return special
    if (call.url === '/me') return { data: { data: makeUser() } }
    if (call.url === '/chats') return { data: { data: chats, links: { next: null }, meta: {} } }
    return { status: 204 }
  })
}

async function signedIn(): Promise<void> {
  await SecureStore.setItemAsync('kc.token', '1|kept')
  await SecureStore.setItemAsync('kc.tokenExpiresAt', '2099-01-01T00:00:00+00:00')
}

async function open(initialUrl = '/') {
  await renderApp(initialUrl)
  // The splash screen waits for the saved token; then the right group appears.
  await waitFor(() => expect(useAuthStore.getState().status).not.toBe('restoring'))
}

beforeEach(() => {
  store.__reset()
  useAuthStore.setState({
    ...initialAuth,
    status: 'restoring',
    token: null,
    user: null,
    bootError: null,
    endedReason: null,
  })
  useChatsStore.getState().reset()
  void i18n.changeLanguage('en')
})
afterEach(() => {
  restoreApi()
  echoes.length = 0
})

describe('signed out', () => {
  it('opens on the sign-in screen', async () => {
    server()
    await open()
    await waitFor(() => expect(currentPath()).toBe('/login'))
    expect(await screen.findByText('Sign in to Kanyaw Connect')).toBeOnTheScreen()
  })

  it('a link into the app (kanyawconnect://chats/:id) leads to sign-in, not into the chat', async () => {
    server()
    await open('/chats/c1')
    await waitFor(() => expect(currentPath()).toBe('/login'))
  })

  it('moves between sign-in and create-account', async () => {
    server()
    await open()
    await fireEvent.press(await screen.findByText('Create account'))
    expect(await screen.findByText('Create your account')).toBeOnTheScreen()
    await waitFor(() => expect(currentPath()).toBe('/register'))

    await fireEvent.press(screen.getByText('Sign in'))
    expect(await screen.findByText('Sign in to Kanyaw Connect')).toBeOnTheScreen()
    await waitFor(() => expect(currentPath()).toBe('/login'))
  })

  it('says why when the saved session had run out', async () => {
    await SecureStore.setItemAsync('kc.token', '1|old')
    await SecureStore.setItemAsync('kc.tokenExpiresAt', '2020-01-01T00:00:00+00:00')
    const { calls } = server()
    await open()
    expect(await screen.findByText('Your session has ended. Please sign in again.')).toBeOnTheScreen()
    expect(calls).toHaveLength(0)
  })

  it('signing in shows the tabs and keeps the token', async () => {
    const { calls } = server(undefined, (call) =>
      call.url === '/auth/login'
        ? { data: { token: '1|new', expires_at: '2099-01-01T00:00:00+00:00', user: makeUser() } }
        : undefined,
    )
    await open()
    await fireEvent.changeText(await screen.findByLabelText('Email'), 'eh@example.org')
    await fireEvent.changeText(screen.getByLabelText('Password'), 'password123')
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(currentPath()).toBe('/'))
    expect(calls.find((call) => call.url === '/auth/login')?.body).toMatchObject({ device_name: 'Pixel 7 (iOS)' })
    expect(store.__dump()['kc.token']).toBe('1|new')
  })
})

describe('signed in', () => {
  it('opens on Home, with the five tabs', async () => {
    await signedIn()
    server()
    await open()
    await waitFor(() => expect(currentPath()).toBe('/'))
    for (const tab of ['Home', 'Messages', 'Create', 'Meetings', 'Profile']) {
      expect(screen.getAllByRole('button', { name: new RegExp(`^${tab}`) }).length).toBeGreaterThan(0)
    }
  })

  it('connects the WebSocket with the saved token, and sends a heartbeat', async () => {
    await signedIn()
    const { calls } = server()
    await open()
    await waitFor(() => expect(echoes).toHaveLength(1))
    expect(echoes[0]?.token).toBe('1|kept')
    await waitFor(() => expect(calls.some((call) => call.url === '/me/heartbeat')).toBe(true))
  })

  it('Messages shows the chat list, and a chat opens over the tabs', async () => {
    await signedIn()
    server()
    await open()
    await fireEvent.press(screen.getAllByRole('button', { name: /^Messages/ })[0]!)
    await waitFor(() => expect(currentPath()).toBe('/chats'))
    await fireEvent.press(await screen.findByRole('button', { name: /^Choir/ }))
    await waitFor(() => expect(currentPath()).toBe('/chats/0195e2c4-0004-7a03-8103-5f3a9c005ccd'))
    expect(screen.getAllByText('Choir').length).toBeGreaterThan(0)
  })

  it('an empty chat list is fine', async () => {
    await signedIn()
    server([])
    await open('/chats')
    expect(await screen.findByText('No chats yet')).toBeOnTheScreen()
  })

  it.each([
    ['/chats/c1', 'Coming soon'],
    ['/rooms/r1', 'The meeting room will open here.'],
    ['/calls/k1', 'Call'],
  ])('the link %s opens its screen', async (url, text) => {
    await signedIn()
    server()
    await open(url)
    await waitFor(() => expect(currentPath()).toBe(url))
    expect((await screen.findAllByText(text)).length).toBeGreaterThan(0)
  })

  it('Create opens a sheet and stays where you were', async () => {
    await signedIn()
    server()
    await open()
    await fireEvent.press(screen.getAllByRole('button', { name: /^Create/ })[0]!)
    expect(await screen.findByText('Start a meeting')).toBeOnTheScreen()
    await waitFor(() => expect(currentPath()).toBe('/'))
  })

  it('signs out from Settings: the token is revoked and forgotten, and sign-in shows', async () => {
    await signedIn()
    const { calls } = server()
    await open('/settings')
    await fireEvent.press(await screen.findByRole('button', { name: 'Sign out' }))

    await waitFor(() => expect(currentPath()).toBe('/login'))
    expect(calls.find((call) => call.url === '/auth/logout')?.headers.Authorization).toBe('Bearer 1|kept')
    expect(store.__dump()).toEqual({})
    expect(echoes[0]?.disconnected).toBe(true)
  })

  it('a token the server refuses ends at sign-in with the reason', async () => {
    await signedIn()
    server(undefined, (call) =>
      call.url === '/me' ? { status: 401, data: { message: 'Unauthenticated.' } } : undefined,
    )
    await open()
    await waitFor(() => expect(currentPath()).toBe('/login'))
    expect(await screen.findByText('Your session has ended. Please sign in again.')).toBeOnTheScreen()
  })

  it('no connection at start: keeps the token and offers to try again', async () => {
    await signedIn()
    let offline = true
    server(undefined, (call) => (call.url === '/me' && offline ? { network: true } : undefined))
    await open()
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeOnTheScreen()
    expect(store.__dump()['kc.token']).toBe('1|kept')

    offline = false
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull())
  })
})
