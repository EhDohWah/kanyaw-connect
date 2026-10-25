import { echoes, fakeEchoFactory, lastEcho } from '@/testing/fakeEcho'
import { RealtimeLifecycle } from '@/realtime/lifecycle'
import { RealtimeManager, type UserChannelHandlers } from '@/realtime/manager'

function make({ callActive = false } = {}) {
  const manager = new RealtimeManager(fakeEchoFactory)
  const state = { callActive }
  const resync = jest.fn()
  const paused = jest.fn()
  const connected = jest.fn()
  const lifecycle = new RealtimeLifecycle({
    manager,
    userHandlers: () => ({}) as UserChannelHandlers,
    hooks: { status: jest.fn(), connected: () => connected() },
    resync,
    paused,
    isCallActive: () => state.callActive,
  })
  // The `connected` hook resyncs in the app; here it is counted separately so each path is visible.
  return { manager, lifecycle, state, resync, paused, connected }
}

afterEach(() => {
  echoes.length = 0
})

describe('the WebSocket on a phone', () => {
  it('connects after sign-in, with the token', () => {
    const { lifecycle } = make()
    lifecycle.signIn('1|abc', 'u1')
    expect(echoes).toHaveLength(1)
    expect(lastEcho().token).toBe('1|abc')
  })

  it('does not reconnect when the same session signs in again (a re-render), but does for a new token', () => {
    const { lifecycle } = make()
    lifecycle.signIn('1|abc', 'u1')
    lifecycle.signIn('1|abc', 'u1')
    expect(echoes).toHaveLength(1)
    lifecycle.signIn('2|new', 'u1')
    expect(echoes).toHaveLength(2)
    expect(echoes[0]?.disconnected).toBe(true)
  })

  it('closes in the background and reconnects in the foreground, which resyncs once the socket is up', () => {
    const { lifecycle, manager, paused, resync, connected } = make()
    lifecycle.signIn('t', 'u1')
    lastEcho().setStatus('connected')
    connected.mockClear()

    lifecycle.appStateChanged('background')
    expect(lastEcho().disconnected).toBe(true)
    expect(manager.isOpen()).toBe(false)
    expect(paused).toHaveBeenCalledTimes(1)

    lifecycle.appStateChanged('active')
    expect(echoes).toHaveLength(2)
    lastEcho().setStatus('connected')
    expect(connected).toHaveBeenCalledTimes(1)
    expect(resync).not.toHaveBeenCalled()
  })

  it('ignores "inactive" (Control Centre, the app switcher): the socket stays open and nothing refetches', () => {
    const { lifecycle, resync } = make()
    lifecycle.signIn('t', 'u1')
    lifecycle.appStateChanged('inactive')
    lifecycle.appStateChanged('active')
    expect(echoes).toHaveLength(1)
    expect(lastEcho().disconnected).toBe(false)
    expect(resync).not.toHaveBeenCalled()
  })

  it('stays open in the background during a call, and resyncs on return (the OS may have suspended it)', () => {
    const { lifecycle, resync } = make({ callActive: true })
    lifecycle.signIn('t', 'u1')

    lifecycle.appStateChanged('background')
    expect(lastEcho().disconnected).toBe(false)

    lifecycle.appStateChanged('active')
    expect(echoes).toHaveLength(1)
    expect(resync).toHaveBeenCalledTimes(1)
  })

  it('closes when a call ends while the app is in the background', () => {
    const { lifecycle, state } = make({ callActive: true })
    lifecycle.signIn('t', 'u1')
    lifecycle.appStateChanged('background')

    state.callActive = false
    lifecycle.callEnded()
    expect(lastEcho().disconnected).toBe(true)

    lifecycle.appStateChanged('active')
    expect(echoes).toHaveLength(2)
  })

  it('a call ending in the foreground changes nothing', () => {
    const { lifecycle } = make()
    lifecycle.signIn('t', 'u1')
    lifecycle.callEnded()
    expect(lastEcho().disconnected).toBe(false)
  })

  it('signing in while in the background waits for the foreground', () => {
    const { lifecycle } = make()
    lifecycle.appStateChanged('background')
    lifecycle.signIn('t', 'u1')
    expect(echoes).toHaveLength(0)
    lifecycle.appStateChanged('active')
    expect(echoes).toHaveLength(1)
  })

  it('signing out closes the socket and the foreground does not reopen it', () => {
    const { lifecycle } = make()
    lifecycle.signIn('t', 'u1')
    lifecycle.signOut()
    expect(lastEcho().disconnected).toBe(true)
    lifecycle.appStateChanged('background')
    lifecycle.appStateChanged('active')
    expect(echoes).toHaveLength(1)
  })
})
