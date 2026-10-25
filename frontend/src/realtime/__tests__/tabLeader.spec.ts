import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FakeBroadcastChannel, fakeChannelFactory } from '@/__tests__/fakeBroadcastChannel'
import { HEARTBEAT_MS, OWNER_WAIT_MS, STALE_MS, TabLeader, pickLeader } from '@/realtime/tabLeader'

/** A tab: its own document state, so tests can hide, show and focus it. */
function tab(state: { visible?: boolean; focused?: boolean; now?: () => number } = {}) {
  const doc = {
    visibilityState: state.visible === false ? 'hidden' : 'visible',
    focused: state.focused ?? false,
    hasFocus() {
      return this.focused
    },
    listeners: new Map<string, () => void>(),
    addEventListener(type: string, listener: () => void) {
      this.listeners.set(type, listener)
    },
    removeEventListener(type: string) {
      this.listeners.delete(type)
    },
  }
  const win = {
    listeners: new Map<string, () => void>(),
    addEventListener(type: string, listener: () => void) {
      this.listeners.set(type, listener)
    },
    removeEventListener(type: string) {
      this.listeners.delete(type)
    },
  }
  const leader = new TabLeader(fakeChannelFactory, state.now ?? Date.now)
  const stop = leader.start(doc as unknown as Document, win as unknown as Window)
  return {
    leader,
    stop,
    hide() {
      doc.visibilityState = 'hidden'
      doc.focused = false
      doc.listeners.get('visibilitychange')?.()
    },
    show() {
      doc.visibilityState = 'visible'
      doc.listeners.get('visibilitychange')?.()
    },
    focus() {
      doc.focused = true
      win.listeners.get('focus')?.()
    },
    close() {
      win.listeners.get('pagehide')?.()
      stop()
    },
  }
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await Promise.resolve()
}

beforeEach(() => FakeBroadcastChannel.reset())
afterEach(() => vi.useRealTimers())

describe('pickLeader', () => {
  it('prefers a visible tab, then the one focused last, then the lowest id', () => {
    expect(pickLeader([])).toBeNull()
    expect(pickLeader([{ id: 'a', visible: false, focusedAt: 900 }, { id: 'b', visible: true, focusedAt: 100 }])).toBe('b')
    expect(pickLeader([{ id: 'a', visible: true, focusedAt: 100 }, { id: 'b', visible: true, focusedAt: 200 }])).toBe('b')
    expect(pickLeader([{ id: 'b', visible: true, focusedAt: 100 }, { id: 'a', visible: true, focusedAt: 100 }])).toBe('a')
    // None visible: the one focused last still rings.
    expect(pickLeader([{ id: 'a', visible: false, focusedAt: 100 }, { id: 'b', visible: false, focusedAt: 300 }])).toBe('b')
  })
})

describe('the tab election', () => {
  it('a tab on its own rings', () => {
    const only = tab({ focused: true })
    expect(only.leader.isLeader()).toBe(true)
    expect(only.leader.leader.value).toBe(true)
  })

  it('only the visible tab focused most recently rings; the others do not', async () => {
    let now = 1000
    const clock = () => now
    const first = tab({ focused: true, now: clock })
    now = 2000
    const second = tab({ focused: true, now: clock })
    await flush()

    expect(second.leader.leader.value).toBe(true)
    expect(first.leader.leader.value).toBe(false)

    // Focus moves back to the first tab: it rings now.
    now = 3000
    first.focus()
    await flush()
    expect(first.leader.leader.value).toBe(true)
    expect(second.leader.leader.value).toBe(false)
  })

  it('a hidden tab gives way to a visible one, even one focused earlier', async () => {
    let now = 1000
    const clock = () => now
    const visible = tab({ focused: true, now: clock })
    now = 2000
    const other = tab({ focused: true, now: clock })
    await flush()
    other.hide()
    await flush()

    expect(visible.leader.leader.value).toBe(true)
    expect(other.leader.leader.value).toBe(false)
  })

  it('takes over when the ringing tab is closed', async () => {
    let now = 1000
    const clock = () => now
    const first = tab({ focused: true, now: clock })
    now = 2000
    const second = tab({ focused: true, now: clock })
    await flush()
    expect(first.leader.leader.value).toBe(false)

    second.close()
    await flush()
    expect(first.leader.leader.value).toBe(true)
  })

  it('a new tab is told about the others once; a reply is not replied to', async () => {
    tab({ focused: true })
    tab()
    await flush()
    await flush()

    const states = FakeBroadcastChannel.open.flatMap((channel) => channel.posted).filter((message) => (message as { type: string }).type === 'state')
    // The first tab says hello, the second says hello, the first replies to the newcomer. Nothing more.
    expect(states).toHaveLength(3)
  })

  it('forgets a tab that stopped answering (it crashed without saying goodbye)', async () => {
    vi.useFakeTimers()
    let now = 1000
    const clock = () => now
    const first = tab({ focused: true, now: clock })
    now = 2000
    const crashed = tab({ focused: true, now: clock })
    await flush()
    expect(first.leader.leader.value).toBe(false)

    // The other tab goes silent (no heartbeat, no goodbye).
    crashed.leader['channel']?.close()
    now += STALE_MS + HEARTBEAT_MS
    vi.advanceTimersByTime(HEARTBEAT_MS * 4)
    await flush()
    expect(first.leader.leader.value).toBe(true)
  })

  it('tells the other tabs when a call was answered or declined here', async () => {
    const first = tab({ focused: true })
    const second = tab()
    await flush()
    const heard = vi.fn()
    second.leader.onHandled(heard)
    const ownEcho = vi.fn()
    first.leader.onHandled(ownEcho)

    first.leader.announceHandled('call-1', 'answered')
    await flush()

    expect(heard).toHaveBeenCalledWith(expect.objectContaining({ callId: 'call-1', how: 'answered', by: first.leader.id }))
    expect(ownEcho).not.toHaveBeenCalled()
  })

  it('knows whether another tab is already in a call (so a reload does not join twice)', async () => {
    const inCall = tab({ focused: true })
    const reloaded = tab()
    await flush()
    inCall.leader.own('call-1')
    // Its "I have it" went out before anyone asked: the answer must come from the question.
    await flush()

    await expect(reloaded.leader.otherTabOwns('call-1')).resolves.toBe(true)
    await expect(reloaded.leader.otherTabOwns('call-2', 20)).resolves.toBe(false)

    inCall.leader.own(null)
    await expect(reloaded.leader.otherTabOwns('call-1', 20)).resolves.toBe(false)
    expect(OWNER_WAIT_MS).toBeGreaterThan(0)
  })

  it('without BroadcastChannel (old browsers), every tab is on its own and rings', async () => {
    const lonely = new TabLeader(() => null)
    lonely.start(document, window)
    expect(lonely.isLeader()).toBe(true)
    await expect(lonely.otherTabOwns('call-1')).resolves.toBe(false)
    expect(() => lonely.announceHandled('call-1', 'declined')).not.toThrow()
  })
})
