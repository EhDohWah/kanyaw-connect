import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { lastEcho } from '@/__tests__/fakeEcho'
import { lastRoom, useFakeLiveKit } from '@/__tests__/fakeLiveKit'
import { CHAT_ID, ME, PAW, fakeApi, makeChat, makeRoom, mountApp, person, restoreApi, settle, signedInStores, type Call } from '@/__tests__/helpers'
import DirectCallOverlay from '@/components/call/direct/DirectCallOverlay.vue'
import { realtime } from '@/realtime'
import { userChannelHandlers } from '@/realtime/handlers'
import { ringer } from '@/realtime/ringer'
import { tabLeader } from '@/realtime/tabLeader'
import { useChatsStore } from '@/stores/chats'
import { useDirectCallStore } from '@/stores/directCall'
import { useRealtimeStore } from '@/stores/realtime'
import { useUiStore } from '@/stores/ui'
import type { DirectCall } from '@/types/call'

useFakeLiveKit()

const CALL = '0195e2c4-0030-7a2f-812f-5f3a9c05ade1'
const ROOM = '0195e2c4-0031-7a30-8130-5f3a9c05ccd0'

function makeCall(over: Partial<DirectCall> = {}): DirectCall {
  return {
    id: CALL,
    chat_id: CHAT_ID,
    room_id: ROOM,
    kind: 'video',
    status: 'ringing',
    end_reason: null,
    caller: person(ME, 'Saw Eh Doh'),
    callee: person(PAW, 'Naw Paw'),
    created_at: new Date().toISOString(),
    ring_expires_at: new Date(Date.now() + 45_000).toISOString(),
    answered_at: null,
    ended_at: null,
    duration_seconds: null,
    ...over,
  }
}
const incoming = (over: Partial<DirectCall> = {}) => makeCall({ caller: person(PAW, 'Naw Paw'), callee: person(ME, 'Saw Eh Doh'), ...over })

let calls: Call[] = []
let startReply: (call: Call) => { status: number; data: unknown } = (call) => ({ status: 201, data: { data: makeCall({ kind: (call.body as { kind: 'voice' | 'video' }).kind }) } })

async function mount(route = '/chats') {
  const mounted = await mountApp(DirectCallOverlay, {
    route,
    attachTo: document.body,
    prepare: (pinia) => signedInStores(pinia),
  })
  realtime.connect('t', ME, userChannelHandlers(), { status: (status) => useRealtimeStore().setStatus(status), connected: () => undefined })
  return mounted
}

function hear(event: string, call: DirectCall): void {
  lastEcho().get(`private-user.${ME}`)!.emit(`.call.${event}`, { call })
}

beforeEach(() => {
  tabLeader.leader.value = true
  startReply = (call) => ({ status: 201, data: { data: makeCall({ kind: (call.body as { kind: 'voice' | 'video' }).kind }) } })
  calls = fakeApi((call) => {
    if (call.url === `/chats/${CHAT_ID}/calls`) return startReply(call)
    if (call.url === `/rooms/${ROOM}/join`) return { data: { status: 'admitted', token: 't', livekit_url: 'ws://lk', room: makeRoom({ id: ROOM }) } }
    if (call.url.endsWith('/accept')) return { data: { data: incoming({ status: 'ongoing', answered_at: new Date().toISOString() }) } }
    if (call.url.endsWith('/end')) return { data: { data: makeCall({ status: 'ended', end_reason: 'hung_up', duration_seconds: 192 }) } }
    return { data: { data: makeCall({ status: 'missed', end_reason: 'cancelled' }) } }
  }).calls
})

afterEach(() => {
  useDirectCallStore().reset()
  realtime.disconnect()
  restoreApi()
})

/** A pointer event at a spot (jsdom cannot set the position through `trigger`). */
async function pointer(element: Element, type: string, x: number, y: number): Promise<void> {
  const event = new Event(type, { bubbles: true })
  Object.defineProperties(event, { clientX: { value: x }, clientY: { value: y }, pointerId: { value: 1 } })
  element.dispatchEvent(event)
  await settle(1)
}

const button = (wrapper: Awaited<ReturnType<typeof mount>>['wrapper'], name: string) =>
  wrapper.findAll('button').find((each) => each.text().trim() === name || each.attributes('aria-label') === name)

describe('an incoming call', () => {
  it('fills the screen: who, what kind, Accept, Decline and "Answer without video"', async () => {
    const { wrapper } = await mount()
    hear('incoming', incoming())
    await settle()

    const dialog = wrapper.find('[role="dialog"]')
    expect(dialog.attributes('aria-label')).toBe('Call with Naw Paw')
    expect(dialog.text()).toContain('Naw Paw')
    expect(dialog.text()).toContain('Incoming video call')
    expect(button(wrapper, 'Accept')).toBeDefined()
    expect(button(wrapper, 'Decline')).toBeDefined()
    expect(button(wrapper, 'Answer without video')).toBeDefined()
    // The obvious next step has the focus.
    expect(document.activeElement?.textContent?.trim()).toBe('Accept')
  })

  it('a voice call has no "Answer without video"', async () => {
    const { wrapper } = await mount()
    hear('incoming', incoming({ kind: 'voice' }))
    await settle()
    expect(wrapper.text()).toContain('Incoming voice call')
    expect(button(wrapper, 'Answer without video')).toBeUndefined()
  })

  it('Accept answers and the call screen takes over', async () => {
    const { wrapper } = await mount()
    hear('incoming', incoming())
    await settle()

    await button(wrapper, 'Accept')!.trigger('click')
    await settle()

    expect(calls.map((c) => c.url)).toContain(`/calls/${CALL}/accept`)
    expect(button(wrapper, 'End')).toBeDefined()
  })

  it('Decline says no', async () => {
    const { wrapper } = await mount()
    hear('incoming', incoming())
    await settle()

    await button(wrapper, 'Decline')!.trigger('click')
    await settle()

    expect(calls.map((c) => c.url)).toContain(`/calls/${CALL}/decline`)
    expect(wrapper.text()).toContain('Call declined')
  })

  it('before the first tap, offers "Tap to hear ringing"', async () => {
    const { wrapper } = await mount()
    ringer.blocked.value = true
    hear('incoming', incoming())
    await settle()
    ringer.blocked.value = true
    await settle()

    const unlock = vi.spyOn(ringer, 'unlock').mockResolvedValue()
    await button(wrapper, 'Tap to hear ringing')!.trigger('click')
    expect(unlock).toHaveBeenCalled()
    ringer.blocked.value = false
  })

  it('in a tab that is not the one ringing, it is a small banner that can still answer', async () => {
    tabLeader.leader.value = false
    const { wrapper } = await mount()
    hear('incoming', incoming())
    await settle()

    const banner = wrapper.find('[role="alertdialog"]')
    expect(banner.text()).toContain('Naw Paw is calling')
    expect(banner.text()).toContain('Ringing in another tab of this app')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })

  it('during a meeting: a banner with Decline and "Leave meeting and answer"', async () => {
    const { wrapper, router } = await mount(`/rooms/${makeRoom().id}`)
    useUiStore().callOpen = true
    hear('incoming', incoming())
    await settle()

    const banner = wrapper.find('[role="alertdialog"]')
    expect(banner.text()).toContain('You are in a meeting')
    // Leaving the meeting page ends the meeting (the meeting page clears this as it goes).
    router.afterEach(() => {
      useUiStore().callOpen = false
    })
    await button(wrapper, 'Leave meeting and answer')!.trigger('click')
    await settle()

    expect(router.currentRoute.value.path).toBe(`/chats/${CHAT_ID}`)
    expect(calls.map((c) => c.url)).toContain(`/calls/${CALL}/accept`)
  })
})

describe('your call', () => {
  it('rings with "Calling…", the controls labelled and pressed, and End cancels it', async () => {
    const { wrapper } = await mount()
    await useDirectCallStore().start(CHAT_ID, 'video')
    await settle()

    expect(wrapper.text()).toContain('Calling…')
    const mic = button(wrapper, 'Microphone')!
    expect(mic.attributes('aria-pressed')).toBe('true')
    expect(button(wrapper, 'Camera')!.attributes('aria-pressed')).toBe('true')

    await mic.trigger('click')
    await settle()
    expect(button(wrapper, 'Microphone')!.attributes('aria-pressed')).toBe('false')

    await button(wrapper, 'End')!.trigger('click')
    await settle()
    expect(calls.map((c) => c.url)).toContain(`/calls/${CALL}/cancel`)
  })

  it('a voice call has no camera button', async () => {
    const { wrapper } = await mount()
    await useDirectCallStore().start(CHAT_ID, 'voice')
    await settle()
    expect(button(wrapper, 'Camera')).toBeUndefined()
  })

  it('their video fills the screen; yours is a small picture you can swap with a tap', async () => {
    const { wrapper } = await mount()
    await useDirectCallStore().start(CHAT_ID, 'video')
    await settle()
    lastRoom().addPerson(PAW, 'Naw Paw')
    await settle()

    const pip = button(wrapper, 'Swap videos')!
    expect(pip).toBeDefined()
    expect(wrapper.findAll('video')).toHaveLength(2)
    const big = () => wrapper.findAll('video')[0]!.classes()
    expect(big()).not.toContain('-scale-x-100') // theirs, not mirrored

    await pointer(pip.element, 'pointerdown', 10, 10)
    await pointer(pip.element, 'pointerup', 11, 11)
    await settle()
    expect(big()).toContain('-scale-x-100') // yours now, mirrored

    // Enter swaps back (a keyboard works as well as a finger).
    await button(wrapper, 'Swap videos')!.trigger('keyup', { key: 'Enter' })
    expect(big()).not.toContain('-scale-x-100')
  })

  it('the small picture is dragged to the nearest corner', async () => {
    const { wrapper } = await mount()
    await useDirectCallStore().start(CHAT_ID, 'video')
    await settle()
    lastRoom().addPerson(PAW, 'Naw Paw')
    await settle()
    const pip = button(wrapper, 'Swap videos')!
    expect(pip.classes()).toEqual(expect.arrayContaining(['bottom-28', 'right-4']))

    await pointer(pip.element, 'pointerdown', window.innerWidth - 40, window.innerHeight - 40)
    await pointer(pip.element, 'pointermove', 30, 30)
    await pointer(pip.element, 'pointerup', 30, 30)
    await settle()

    expect(button(wrapper, 'Swap videos')!.classes()).toEqual(expect.arrayContaining(['top-20', 'left-4']))
    expect(wrapper.findAll('video')[0]!.classes()).not.toContain('-scale-x-100') // a drag is not a tap
  })

  it('with their camera off: their picture, and says so', async () => {
    const { wrapper } = await mount()
    await useDirectCallStore().start(CHAT_ID, 'video')
    await settle()
    lastRoom().addPerson(PAW, 'Naw Paw', { camera: false })
    await settle()

    expect(wrapper.text()).toContain("Naw Paw's camera is off")
    expect(button(wrapper, 'Swap videos')).toBeUndefined()
  })

  it('says "Weak connection" when theirs is poor', async () => {
    const { wrapper } = await mount()
    await useDirectCallStore().start(CHAT_ID, 'voice')
    await settle()
    const paw = lastRoom().addPerson(PAW, 'Naw Paw', { camera: false })
    paw.connectionQuality = 'poor' as never
    lastRoom().emit('connectionQualityChanged', 'poor', paw)
    await settle()

    expect(wrapper.text()).toContain('Weak connection')
  })

  it('moving to another page keeps the call as a bar; "Return to call" brings it back', async () => {
    const { wrapper, router } = await mount()
    await useDirectCallStore().start(CHAT_ID, 'voice')
    await settle()

    await router.push('/settings')
    await settle()
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Return to call')

    await button(wrapper, 'Return to call')!.trigger('click')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
  })

  it('when they are busy: says so, with Call again and Send a voice message (which opens the chat, recording)', async () => {
    startReply = () => ({ status: 409, data: { message: 'They are in another call.', code: 'callee_busy' } })
    const { wrapper, router } = await mount()
    useChatsStore().put(makeChat())
    await useDirectCallStore().start(CHAT_ID, 'video')
    await settle()

    // No call came back: the chat says who it was for.
    expect(wrapper.text()).toContain('Naw Paw Say is on another call')
    expect(button(wrapper, 'Call again')).toBeDefined()

    await button(wrapper, 'Send a voice message')!.trigger('click')
    await settle()
    expect(router.currentRoute.value.path).toBe(`/chats/${CHAT_ID}`)
    expect(useUiStore().recordVoiceIn).toBe(CHAT_ID)
    expect(useDirectCallStore().phase).toBe('idle')
  })

  it('"Call ended · 3:12" after hanging up', async () => {
    const { wrapper } = await mount()
    await useDirectCallStore().start(CHAT_ID, 'voice')
    await settle()
    hear('accepted', makeCall({ status: 'ongoing', answered_at: new Date().toISOString() }))
    await settle()

    await button(wrapper, 'End')!.trigger('click')
    await settle()

    expect(wrapper.text()).toContain('Call ended · 3:12')
  })
})
