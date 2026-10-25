import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FakeBroadcastChannel, fakeChannelFactory } from '@/__tests__/fakeBroadcastChannel'
import { lastEcho } from '@/__tests__/fakeEcho'
import { lastRoom, liveRooms, useFakeLiveKit } from '@/__tests__/fakeLiveKit'
import { CHAT_ID, ME, PAW, fakeApi, makeRoom, makeUser, person, restoreApi, settle, signIn, type Call } from '@/__tests__/helpers'
import { realtime } from '@/realtime'
import { userChannelHandlers } from '@/realtime/handlers'
import { ringer } from '@/realtime/ringer'
import { TabLeader, tabLeader } from '@/realtime/tabLeader'
import { useAuthStore } from '@/stores/auth'
import { EXPIRY_GRACE_MS, REJOIN_ATTEMPTS, REJOIN_DELAY_MS, useDirectCallStore } from '@/stores/directCall'
import { useRealtimeStore } from '@/stores/realtime'
import { useUiStore } from '@/stores/ui'
import type { DirectCall } from '@/types/call'
import { CLOSE_AFTER_MS } from '@/utils/callOutcome'

const interrupt = vi.hoisted(() => vi.fn())
vi.mock('@/composables/useVoiceRecorder', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/composables/useVoiceRecorder')>()),
  interruptRecording: interrupt,
}))

useFakeLiveKit()

const CALL = '0195e2c4-0030-7a2f-812f-5f3a9c05ade1'
const ROOM = '0195e2c4-0031-7a30-8130-5f3a9c05ccd0'
const LIVEKIT = 'ws://livekit.test'

type Reply = { status?: number; data?: unknown; network?: boolean }

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

/** A call made by Naw Paw to me. */
const incomingCall = (over: Partial<DirectCall> = {}): DirectCall => makeCall({ caller: person(PAW, 'Naw Paw'), callee: person(ME, 'Saw Eh Doh'), ...over })

const answered = (over: Partial<DirectCall> = {}): DirectCall => makeCall({ status: 'ongoing', answered_at: new Date().toISOString(), ...over })

/**
 * The API for one call: each endpoint answers with what the test chooses, or with sensible defaults (the call moves on
 * as asked; joining the room is admitted).
 */
function serve(replies: Partial<Record<'start' | 'current' | 'show' | 'accept' | 'decline' | 'cancel' | 'end' | 'join', (call: Call) => Reply>> = {}) {
  return fakeApi((call) => {
    const route = (name: keyof typeof replies, fallback: () => Reply): Reply => replies[name]?.(call) ?? fallback()
    if (call.method === 'post' && call.url === `/chats/${CHAT_ID}/calls`) return route('start', () => ({ status: 201, data: { data: makeCall({ kind: (call.body as { kind: 'voice' | 'video' }).kind }) } }))
    if (call.url === '/calls/current') return route('current', () => ({ data: { data: null } }))
    if (call.method === 'get' && call.url === `/calls/${CALL}`) return route('show', () => ({ data: { data: makeCall() } }))
    if (call.url === `/calls/${CALL}/accept`) return route('accept', () => ({ data: { data: answered({ caller: person(PAW, 'Naw Paw'), callee: person(ME, 'Saw Eh Doh') }) } }))
    if (call.url === `/calls/${CALL}/decline`) return route('decline', () => ({ data: { data: incomingCall({ status: 'declined' }) } }))
    if (call.url === `/calls/${CALL}/cancel`) return route('cancel', () => ({ data: { data: makeCall({ status: 'missed', end_reason: 'cancelled' }) } }))
    if (call.url === `/calls/${CALL}/end`) return route('end', () => ({ data: { data: makeCall({ status: 'ended', end_reason: 'hung_up', duration_seconds: 192 }) } }))
    if (call.url === `/rooms/${ROOM}/join`) return route('join', () => ({ data: { status: 'admitted', token: 'lk-token', livekit_url: LIVEKIT, room: makeRoom({ id: ROOM }) } }))
    return { data: {} }
  })
}

const sent = (calls: Call[]) => calls.map((c) => `${c.method} ${c.url}`)

/** An event on my user channel, as the server broadcasts it. */
function hear(event: 'incoming' | 'accepted' | 'declined' | 'missed' | 'ended', call: DirectCall): void {
  lastEcho().get(`private-user.${ME}`)!.emit(`.call.${event}`, { call })
}

let stopTabs: (() => void) | null = null

beforeEach(() => {
  setActivePinia(createPinia())
  signIn()
  useAuthStore().user = makeUser({ id: ME })
  realtime.connect('t', ME, userChannelHandlers(), { status: (status) => useRealtimeStore().setStatus(status), connected: () => undefined })
  interrupt.mockClear()
  tabLeader.leader.value = true
})

afterEach(async () => {
  useDirectCallStore().reset()
  stopTabs?.()
  stopTabs = null
  realtime.disconnect()
  restoreApi()
  vi.useRealTimers()
  FakeBroadcastChannel.reset()
  await settle()
})

describe('calling someone', () => {
  it('rings them, connects while it rings (camera on for video), and is live when they answer', async () => {
    const { calls } = serve()
    const ringback = vi.spyOn(ringer, 'ringback')
    const call = useDirectCallStore()

    await call.start(CHAT_ID, 'video')
    await settle()

    expect(sent(calls)).toEqual([`post /chats/${CHAT_ID}/calls`, `post /rooms/${ROOM}/join`])
    expect(calls[0]!.body).toEqual({ kind: 'video' })
    expect(call.phase).toBe('ringing')
    expect(call.direction).toBe('outgoing')
    expect(ringback).toHaveBeenCalled()
    expect(lastRoom().connectedWith).toEqual({ url: LIVEKIT, token: 'lk-token' })
    expect(call.local?.cameraOn).toBe(true)
    expect(call.local?.micOn).toBe(true)

    hear('accepted', answered())
    expect(call.phase).toBe('active')
    expect(ringer.current()).toBeNull()
  })

  it('is live as soon as they appear in the room, even before call.accepted arrives', async () => {
    serve()
    const call = useDirectCallStore()
    await call.start(CHAT_ID, 'voice')
    await settle()

    lastRoom().addPerson(PAW, 'Naw Paw', { camera: false })
    await settle()

    expect(call.phase).toBe('active')
  })

  it('a voice call starts without the camera', async () => {
    serve()
    const call = useDirectCallStore()
    await call.start(CHAT_ID, 'voice')
    await settle()

    expect(call.local?.cameraOn).toBe(false)
    expect(call.local?.micOn).toBe(true)
  })

  it('says they are on another call (busy), and can call again', async () => {
    let busy = true
    const { calls } = serve({ start: () => (busy ? { status: 409, data: { message: 'They are in another call.', code: 'callee_busy' } } : { status: 201, data: { data: makeCall() } }) })
    const call = useDirectCallStore()

    await call.start(CHAT_ID, 'video')
    expect(call.phase).toBe('ended')
    expect(call.ending).toBe('busy')
    expect(call.closing).toEqual({ callAgain: true, closeAfterMs: null })

    busy = false
    await call.callAgain()
    expect(call.phase).toBe('ringing')
    expect(sent(calls).filter((line) => line.endsWith('/calls'))).toHaveLength(2)
  })

  it('says you are already in a call when the server says so', async () => {
    serve({ start: () => ({ status: 409, data: { message: 'You are already in a call.', code: 'already_in_call' } }) })
    const call = useDirectCallStore()
    await call.start(CHAT_ID, 'voice')
    expect(call.ending).toBe('already-in-call')
  })

  it('shows "declined" (and stays, offering Call again) when they say no; the media is let go', async () => {
    serve()
    const call = useDirectCallStore()
    await call.start(CHAT_ID, 'video')
    await settle()
    const room = lastRoom()

    hear('declined', makeCall({ status: 'declined' }))
    await settle()

    expect(call.phase).toBe('ended')
    expect(call.ending).toBe('declined')
    expect(room.disconnects).toBe(1)
    vi.useFakeTimers()
    vi.advanceTimersByTime(CLOSE_AFTER_MS * 5)
    expect(call.phase).toBe('ended') // waits for Call again, Send a voice message or Close
    call.dismiss()
    expect(call.phase).toBe('idle')
  })

  it('ends as no answer when the ringing runs out', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    serve()
    const call = useDirectCallStore()
    await call.start(CHAT_ID, 'voice')
    await vi.advanceTimersByTimeAsync(10)

    await vi.advanceTimersByTimeAsync(45_000 + EXPIRY_GRACE_MS)

    expect(call.ending).toBe('no-answer')
  })

  it('ends as no answer when call.missed (no_answer) arrives', async () => {
    serve()
    const call = useDirectCallStore()
    await call.start(CHAT_ID, 'voice')
    hear('missed', makeCall({ status: 'missed', end_reason: 'no_answer' }))
    expect(call.ending).toBe('no-answer')
  })

  it('End while it rings cancels the call', async () => {
    const { calls } = serve()
    const call = useDirectCallStore()
    await call.start(CHAT_ID, 'video')
    await settle()
    const room = lastRoom()

    call.hangUp()
    await settle()

    expect(sent(calls)).toContain(`post /calls/${CALL}/cancel`)
    expect(call.ending).toBe('cancelled')
    expect(room.disconnects).toBe(1)
  })

  it('End pressed before the call even exists cancels it as soon as it does', async () => {
    let release: (() => void) | null = null
    const { calls } = serve({
      start: () => {
        return new Promise<Reply>((resolve) => {
          release = () => resolve({ status: 201, data: { data: makeCall() } })
        }) as unknown as Reply
      },
    })
    const call = useDirectCallStore()
    const starting = call.start(CHAT_ID, 'voice')
    await settle()
    expect(call.phase).toBe('starting')

    call.hangUp()
    expect(call.phase).toBe('ended')
    release!()
    await starting
    await settle()

    expect(sent(calls)).toContain(`post /calls/${CALL}/cancel`)
    expect(sent(calls)).not.toContain(`post /rooms/${ROOM}/join`)
  })

  it('End once answered ends it, and shows the length the server measured, then closes after 2 seconds', async () => {
    const { calls } = serve()
    const call = useDirectCallStore()
    await call.start(CHAT_ID, 'video')
    await settle()
    hear('accepted', answered())

    vi.useFakeTimers({ shouldAdvanceTime: true })
    call.hangUp()
    await vi.advanceTimersByTimeAsync(10)

    expect(sent(calls)).toContain(`post /calls/${CALL}/end`)
    expect(call.ending).toBe('hung-up')
    expect(call.endedSeconds).toBe(192)
    await vi.advanceTimersByTimeAsync(CLOSE_AFTER_MS)
    expect(call.phase).toBe('idle')
  })

  it('ends when they hang up (call.ended), with the length', async () => {
    serve()
    const call = useDirectCallStore()
    await call.start(CHAT_ID, 'video')
    await settle()
    hear('accepted', answered())

    hear('ended', makeCall({ status: 'ended', end_reason: 'hung_up', duration_seconds: 75 }))

    expect(call.ending).toBe('hung-up')
    expect(call.endedSeconds).toBe(75)
  })

  it('cannot start a second call while one is on', async () => {
    const { calls } = serve()
    const call = useDirectCallStore()
    await call.start(CHAT_ID, 'video')
    await call.start(CHAT_ID, 'voice')
    expect(sent(calls).filter((line) => line.endsWith('/calls'))).toHaveLength(1)
    expect(useUiStore().toasts.at(-1)?.message).toBe('You are already in a call.')
  })
})

describe('being called', () => {
  it('rings (with the settings), stops a recording, and shows who is calling', async () => {
    serve()
    const ring = vi.spyOn(ringer, 'ring')
    useAuthStore().user = makeUser({ id: ME, settings: { call_ringtone: false } })
    const call = useDirectCallStore()

    hear('incoming', incomingCall())

    expect(call.phase).toBe('incoming')
    expect(call.peer?.name).toBe('Naw Paw')
    expect(ring).toHaveBeenCalledWith({ sound: false, vibrate: true })
    expect(interrupt).toHaveBeenCalled()
  })

  it('Accept answers, joins and connects with the camera on; "without video" keeps it off', async () => {
    const { calls } = serve()
    const call = useDirectCallStore()
    hear('incoming', incomingCall())

    await call.accept()
    await settle()

    expect(sent(calls)).toEqual([`post /calls/${CALL}/accept`, `post /rooms/${ROOM}/join`])
    expect(call.phase).toBe('active')
    expect(call.local?.cameraOn).toBe(true)
    call.reset()

    hear('incoming', incomingCall())
    await call.accept(false)
    await settle()
    expect(call.local?.cameraOn).toBe(false)
  })

  it('says "this call has ended" when answering came too late', async () => {
    serve({ accept: () => ({ status: 409, data: { message: 'This call is no longer ringing.', code: 'call_not_ringing', call: incomingCall({ status: 'missed', end_reason: 'cancelled' }) } }) })
    const call = useDirectCallStore()
    hear('incoming', incomingCall())

    await call.accept()

    expect(call.ending).toBe('gone')
    expect(call.call?.status).toBe('missed')
  })

  it('closes as answered on another device when the 409 says it is going on, or call.accepted arrives', async () => {
    serve({ accept: () => ({ status: 409, data: { message: 'No', code: 'call_not_ringing', call: answered() } }) })
    const call = useDirectCallStore()
    hear('incoming', incomingCall())
    await call.accept()
    expect(call.ending).toBe('answered-elsewhere')

    call.reset()
    hear('incoming', incomingCall())
    hear('accepted', answered({ caller: person(PAW, 'Naw Paw'), callee: person(ME, 'Saw Eh Doh') }))
    expect(call.ending).toBe('answered-elsewhere')
  })

  it('Decline says no', async () => {
    const { calls } = serve()
    const call = useDirectCallStore()
    hear('incoming', incomingCall())

    call.decline()
    await settle()

    expect(sent(calls)).toEqual([`post /calls/${CALL}/decline`])
    expect(call.ending).toBe('declined')
    expect(ringer.current()).toBeNull()
  })

  it('closes by itself as missed when the caller gives up', async () => {
    vi.useFakeTimers()
    serve()
    const call = useDirectCallStore()
    hear('incoming', incomingCall())

    hear('missed', incomingCall({ status: 'missed', end_reason: 'cancelled' }))
    expect(call.ending).toBe('missed')
    vi.advanceTimersByTime(CLOSE_AFTER_MS)
    expect(call.phase).toBe('idle')
  })

  it('closes by itself at ring_expires_at', async () => {
    vi.useFakeTimers()
    serve()
    const call = useDirectCallStore()
    hear('incoming', incomingCall())

    vi.advanceTimersByTime(45_000 + EXPIRY_GRACE_MS)
    expect(call.ending).toBe('missed')
  })

  it('ignores a call that has already rung out, and a second call while one is on', () => {
    serve()
    const call = useDirectCallStore()
    hear('incoming', incomingCall({ ring_expires_at: new Date(Date.now() - 1000).toISOString() }))
    expect(call.phase).toBe('idle')

    hear('incoming', incomingCall())
    hear('incoming', incomingCall({ id: 'another' }))
    expect(call.call?.id).toBe(CALL)
  })

  it('only the tab that leads rings; the others stay quiet (and show a banner)', () => {
    serve()
    const ring = vi.spyOn(ringer, 'ring')
    tabLeader.leader.value = false
    const call = useDirectCallStore()

    hear('incoming', incomingCall())

    expect(call.phase).toBe('incoming')
    expect(call.ringsHere).toBe(false)
    expect(ring).not.toHaveBeenCalled()
  })

  it('in a meeting it vibrates but does not ring over the meeting', () => {
    serve()
    const ring = vi.spyOn(ringer, 'ring')
    useUiStore().callOpen = true
    const call = useDirectCallStore()

    hear('incoming', incomingCall())

    expect(call.inMeeting).toBe(true)
    expect(ring).toHaveBeenCalledWith({ sound: false, vibrate: true })
  })

  it('closes quietly when another tab of this browser answered or declined', async () => {
    serve()
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
    stopTabs = tabLeader.start()
    const otherTab = new TabLeader(fakeChannelFactory)
    const stopOther = otherTab.start()
    const call = useDirectCallStore()
    hear('incoming', incomingCall())

    otherTab.announceHandled(CALL, 'answered')
    await settle()

    expect(call.phase).toBe('idle')
    // And it does not come back from a late event.
    hear('incoming', incomingCall())
    expect(call.phase).toBe('idle')
    stopOther()
  })
})

describe('during the call', () => {
  async function liveCall(kind: 'voice' | 'video' = 'video') {
    const api = serve()
    const call = useDirectCallStore()
    await call.start(CHAT_ID, kind)
    await settle()
    lastRoom().addPerson(PAW, 'Naw Paw', { camera: kind === 'video' })
    await settle()
    return { call, api }
  }

  it('toggles the microphone and the camera (video only)', async () => {
    const { call } = await liveCall('video')

    await call.toggleMicrophone()
    await settle()
    expect(call.local?.micOn).toBe(false)
    await call.toggleCamera()
    await settle()
    expect(call.local?.cameraOn).toBe(false)
  })

  it('never turns a camera on in a voice call', async () => {
    const { call } = await liveCall('voice')
    await call.toggleCamera()
    await settle()
    expect(call.local?.cameraOn).toBe(false)
  })

  it('reconnects by itself after a drop LiveKit could not recover', async () => {
    const { call, api } = await liveCall()
    const before = liveRooms.length

    lastRoom().drop()
    await settle(10)

    expect(liveRooms.length).toBe(before + 1)
    expect(sent(api.calls).filter((line) => line.endsWith('/join'))).toHaveLength(2)
    expect(call.phase).toBe('active')
  })

  it('ends as connection lost when the room has closed (409 room_ended) and the server says it is over', async () => {
    let roomOpen = true
    serve({
      join: () => (roomOpen ? { data: { status: 'admitted', token: 't', livekit_url: LIVEKIT, room: makeRoom({ id: ROOM }) } } : { status: 409, data: { message: 'This room has ended.', code: 'room_ended' } }),
      show: () => ({ data: { data: makeCall({ status: 'ended', end_reason: 'connection_lost' }) } }),
    })
    const call = useDirectCallStore()
    await call.start(CHAT_ID, 'voice')
    await settle()
    hear('accepted', answered())

    roomOpen = false
    lastRoom().drop()
    await settle(10)

    expect(call.ending).toBe('connection-lost')
  })

  it('gives up after a few tries, and tells the server', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let online = true
    const api = serve({ join: () => (online ? { data: { status: 'admitted', token: 't', livekit_url: LIVEKIT, room: makeRoom({ id: ROOM }) } } : { network: true }) })
    const call = useDirectCallStore()
    await call.start(CHAT_ID, 'voice')
    await vi.advanceTimersByTimeAsync(10)
    hear('accepted', answered())
    call.call!.status = 'ongoing'

    online = false
    lastRoom().drop()
    // One try at once, then one after each pause (2 s, then 4 s).
    for (let i = 1; i < REJOIN_ATTEMPTS; i++) await vi.advanceTimersByTimeAsync(REJOIN_DELAY_MS * i + 10)

    expect(sent(api.calls).filter((line) => line.endsWith('/join'))).toHaveLength(1 + REJOIN_ATTEMPTS)

    expect(call.ending).toBe('connection-lost')
    expect(sent(api.calls)).toContain(`post /calls/${CALL}/end`)
  })

  it('minimizes to the bar and comes back', async () => {
    const { call } = await liveCall()
    call.minimize()
    expect(call.expanded).toBe(false)
    call.expand()
    expect(call.expanded).toBe(true)
  })
})

describe('staying in step', () => {
  it('after a reload, an answered call joins again without asking', async () => {
    const { calls } = serve({ current: () => ({ data: { data: answered({ caller: person(PAW, 'Naw Paw'), callee: person(ME, 'Saw Eh Doh') }) } }) })
    const call = useDirectCallStore()

    await call.resync()
    await settle(10)

    expect(sent(calls)).toEqual(['get /calls/current', `post /rooms/${ROOM}/join`])
    expect(call.phase).toBe('active')
    expect(call.direction).toBe('incoming')
  })

  it('after a reload, a call ringing for you shows the incoming screen', async () => {
    serve({ current: () => ({ data: { data: incomingCall() } }) })
    const call = useDirectCallStore()
    await call.resync()
    expect(call.phase).toBe('incoming')
  })

  it('after a reload, your own call that still rings rings on and gets the media ready again', async () => {
    const { calls } = serve({ current: () => ({ data: { data: makeCall() } }) })
    const call = useDirectCallStore()
    await call.resync()
    await settle()
    expect(call.phase).toBe('ringing')
    expect(sent(calls)).toContain(`post /rooms/${ROOM}/join`)
  })

  it('does not join a call another tab of this browser is already in', async () => {
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
    stopTabs = tabLeader.start()
    const otherTab = new TabLeader(fakeChannelFactory)
    const stopOther = otherTab.start()
    otherTab.own(CALL)
    const { calls } = serve({ current: () => ({ data: { data: answered() } }) })
    const call = useDirectCallStore()

    await call.resync()
    await settle(10)

    expect(sent(calls)).toEqual(['get /calls/current'])
    expect(call.phase).toBe('idle')
    stopOther()
  })

  it('after a WebSocket reconnect, asks again; a call the server has finished ends here too', async () => {
    let current: DirectCall | null = null
    const { calls } = serve({
      current: () => ({ data: { data: current } }),
      show: () => ({ data: { data: makeCall({ status: 'ended', end_reason: 'hung_up', duration_seconds: 30 }) } }),
    })
    const call = useDirectCallStore()
    await call.start(CHAT_ID, 'voice')
    await settle()
    hear('accepted', answered())
    current = null

    lastEcho().setStatus('disconnected')
    lastEcho().setStatus('connected')
    await settle(10)

    expect(sent(calls)).toContain('get /calls/current')
    expect(call.ending).toBe('hung-up')
    expect(call.endedSeconds).toBe(30)
  })

  it('a push opens the call; its Answer button answers it if it still rings', async () => {
    const { calls } = serve({ show: () => ({ data: { data: incomingCall() } }) })
    const call = useDirectCallStore()

    await call.openCall(CALL, { answer: true })
    await settle()

    expect(sent(calls)).toEqual([`get /calls/${CALL}`, `post /calls/${CALL}/accept`, `post /rooms/${ROOM}/join`])
    expect(call.phase).toBe('active')
  })

  it('a push for a call that is over shows nothing', async () => {
    serve({ show: () => ({ data: { data: incomingCall({ status: 'missed', end_reason: 'cancelled' }) } }) })
    const call = useDirectCallStore()
    await call.openCall(CALL, { answer: true })
    expect(call.phase).toBe('idle')
  })

  it('signing out hangs up and forgets the call', async () => {
    const { calls } = serve()
    const call = useDirectCallStore()
    await call.start(CHAT_ID, 'voice')
    await settle()

    call.reset()
    await settle()

    expect(call.phase).toBe('idle')
    expect(call.call).toBeNull()
    expect(sent(calls)).toContain(`post /calls/${CALL}/cancel`)
  })
})
