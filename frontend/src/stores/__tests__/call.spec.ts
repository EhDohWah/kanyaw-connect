import { DisconnectReason, Track } from 'livekit-client'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { watch } from 'vue'

import { lastEcho } from '@/__tests__/fakeEcho'
import { FakeTrack, lastRoom, liveRooms, useFakeLiveKit } from '@/__tests__/fakeLiveKit'
import { ME, PAW, fakeApi, makeRoom, makeUser, person, restoreApi, settle, signIn, type Call } from '@/__tests__/helpers'
import { realtime } from '@/realtime'
import { userChannelHandlers } from '@/realtime/handlers'
import { REJOIN_ATTEMPTS, REJOIN_DELAY_MS, WAITING_CHECK_MS, useCallStore } from '@/stores/call'
import { useAuthStore } from '@/stores/auth'
import { useRealtimeStore } from '@/stores/realtime'
import { useRoomsStore } from '@/stores/rooms'
import { useUiStore } from '@/stores/ui'
import type { Room } from '@/types/room'

useFakeLiveKit()

const ROOM = makeRoom().id
const HTOO = '0195e2c4-0005-7a04-8104-5f3a9c007bbc'
const LIVEKIT = 'ws://livekit.test'

type Reply = { status?: number; data?: unknown; network?: boolean; headers?: Record<string, string> }

/** The API for one room: `GET /rooms/{id}` gives `room`, `POST …/join` answers with `join()`, other calls with `other()`. */
function serve(options: { room?: Room; join?: (call: Call) => Reply; other?: (call: Call) => Reply } = {}) {
  const room = options.room ?? makeRoom()
  return fakeApi((call) => {
    if (call.method === 'get' && call.url === `/rooms/${ROOM}`) return { data: { data: room } }
    if (call.url === `/rooms/${ROOM}/join`) return options.join?.(call) ?? admitted(room)
    return options.other?.(call) ?? { data: {} }
  })
}

const admitted = (room: Room = makeRoom(), token = 'lk-token'): Reply => ({ data: { status: 'admitted', token, livekit_url: LIVEKIT, room } })
const refused = (status: number, body: Record<string, unknown> = {}, headers: Record<string, string> = {}): Reply => ({ status, data: { message: 'No', ...body }, headers })

const preview = () => ({ micOn: true, cameraOn: true, audioTrack: new FakeTrack('audio', Track.Source.Microphone), videoTrack: new FakeTrack('video', Track.Source.Camera) })
const media = () => preview() as unknown as Parameters<ReturnType<typeof useCallStore>['join']>[0]

beforeEach(() => {
  setActivePinia(createPinia())
  signIn()
  useAuthStore().user = makeUser({ id: ME })
  realtime.connect('t', ME, userChannelHandlers(), { status: (status) => useRealtimeStore().setStatus(status), connected: () => undefined })
  window.sessionStorage.clear()
})

afterEach(async () => {
  await useCallStore().close()
  realtime.disconnect()
  restoreApi()
  vi.useRealTimers()
})

async function inCall(room: Room = makeRoom()) {
  serve({ room, join: () => admitted(room) })
  const call = useCallStore()
  await call.open(ROOM)
  await call.join(media())
  await settle()
  return call
}

describe('opening a meeting', () => {
  it('loads the room and shows the pre-join screen', async () => {
    serve()
    const call = useCallStore()

    const opening = call.open(ROOM)
    expect(call.phase).toBe('loading')
    await opening

    expect(call.phase).toBe('prejoin')
    expect(call.room?.name).toBe('Committee meeting')
    expect(useRoomsStore().activeCallId).toBe(ROOM)
  })

  it('says straight away when the meeting is over, you are not invited, or it does not exist', async () => {
    const call = useCallStore()

    serve({ room: makeRoom({ status: 'ended' }) })
    await call.open(ROOM)
    expect([call.phase, call.overReason]).toEqual(['over', 'ended'])

    fakeApi(() => refused(403))
    await call.open(ROOM)
    expect(call.overReason).toBe('forbidden')

    fakeApi(() => refused(404))
    await call.open(ROOM)
    expect(call.overReason).toBe('not-found')
  })

  it('offers "Try again" when the room could not be loaded', async () => {
    fakeApi(() => ({ network: true }))
    const call = useCallStore()

    await call.open(ROOM)

    expect(call.phase).toBe('load-failed')
    expect(call.loadError?.isNetwork).toBe(true)
  })
})

describe('joining', () => {
  it('admitted: connects to LiveKit with the address and token from the answer, sending the preview tracks as they are', async () => {
    const room = makeRoom()
    const { calls } = serve({ room })
    const call = useCallStore()
    await call.open(ROOM)
    const tracks = preview()

    await call.join(tracks as never)
    await settle()

    expect(calls.find((c) => c.url.endsWith('/join'))?.body).toEqual({})
    expect(lastRoom().connectedWith).toEqual({ url: LIVEKIT, token: 'lk-token' })
    expect(lastRoom().localParticipant.published.map((p) => p.track)).toEqual([tracks.videoTrack, tracks.audioTrack])
    expect(call.phase).toBe('connected')
    expect(call.local).toMatchObject({ id: ME, micOn: true, cameraOn: true, isLocal: true })
  })

  it('a camera switched off on the pre-join screen is closed, not sent', async () => {
    serve()
    const call = useCallStore()
    await call.open(ROOM)
    const tracks = { ...preview(), cameraOn: false }

    await call.join(tracks as never)

    expect(tracks.videoTrack.stopped).toBe(true)
    expect(lastRoom().localParticipant.published.map((p) => p.source)).toEqual([Track.Source.Microphone])
    expect(call.local?.cameraOn).toBe(false)
  })

  it('listens to the room\'s channel once in the call, and leaves it when the call ends', async () => {
    const call = await inCall()
    expect(lastEcho().channels.has(`presence-room.${ROOM}`)).toBe(true)

    call.leave()
    expect(lastEcho().left).toContain(`room.${ROOM}`)
  })

  it('sends the password, and only when there is one', async () => {
    const { calls } = serve()
    const call = useCallStore()
    await call.open(ROOM)

    await call.join(media(), 'open-sesame')

    expect(calls.find((c) => c.url.endsWith('/join'))?.body).toEqual({ password: 'open-sesame' })
  })

  it.each([
    ['a password is needed', refused(422, { errors: { password: ['The room password is required.'] } }), undefined, { kind: 'password-required' }],
    ['the password was wrong', refused(422, { errors: { password: ['The room password is incorrect.'] } }), 'guess', { kind: 'password-wrong', message: 'The room password is incorrect.' }],
    ['the room is locked', refused(409, { code: 'room_locked' }), undefined, { kind: 'locked' }],
    ['the room is full', refused(409, { code: 'room_full' }), undefined, { kind: 'full' }],
    ['the video service is down', refused(503), undefined, { kind: 'unavailable' }],
    ['too many tries', refused(429, {}, { 'retry-after': '40' }), undefined, { kind: 'rate-limited', retryAfter: 40 }],
  ])('stays on the pre-join screen with a reason when %s', async (_name, reply, password, expected) => {
    serve({ join: () => reply })
    const call = useCallStore()
    await call.open(ROOM)

    await call.join(media(), password)

    expect(call.phase).toBe('prejoin')
    expect(call.problem).toEqual(expected)
    expect(liveRooms).toHaveLength(0)
  })

  it('no network: stays on the pre-join screen to try again', async () => {
    serve({ join: () => ({ network: true }) })
    const call = useCallStore()
    await call.open(ROOM)

    await call.join(media())

    expect(call.problem).toEqual({ kind: 'network' })
  })

  it.each([
    ['the meeting is over', refused(409, { code: 'room_ended' }), 'ended'],
    ['the host turned you away', refused(403, { code: 'join_denied' }), 'denied'],
    ['you are not invited', refused(403), 'forbidden'],
  ])('ends with a reason when %s', async (_name, reply, reason) => {
    serve({ join: () => reply })
    const call = useCallStore()
    await call.open(ROOM)

    await call.join(media())

    expect([call.phase, call.overReason]).toEqual(['over', reason])
  })

  it('LiveKit refusing the connection: back to pre-join with a reason, and the next try works', async () => {
    serve()
    const call = useCallStore()
    await call.open(ROOM)
    let first = true
    const { setRoomFactory } = await import('@/realtime/callSession')
    const { FakeRoom } = await import('@/__tests__/fakeLiveKit')
    setRoomFactory(() => {
      const room = new FakeRoom()
      if (first) room.connectError = new Error('could not establish signal connection')
      first = false
      liveRooms.push(room)
      return room as never
    })

    await call.join(media())
    expect([call.phase, call.problem]).toEqual(['prejoin', { kind: 'connect-failed' }])

    await call.join(media())
    expect(call.phase).toBe('connected')
  })

  it('a late answer for a meeting that was left meanwhile is dropped', async () => {
    let answer: (reply: Reply) => void = () => undefined
    fakeApi((c) => (c.url.endsWith('/join') ? new Promise<Reply>((resolve) => (answer = resolve)) : { data: { data: makeRoom() } }))
    const call = useCallStore()
    await call.open(ROOM)

    const joining = call.join(media())
    await call.close()
    answer(admitted())
    await joining

    expect(call.phase).toBe('idle')
    expect(liveRooms).toHaveLength(0)
  })
})

describe('the waiting room', () => {
  async function waitingCall() {
    let joins = 0
    const api = serve({ join: () => (++joins === 1 ? { data: { status: 'waiting' } } : admitted()) })
    const call = useCallStore()
    await call.open(ROOM)
    const tracks = preview()
    await call.join(tracks as never, 'open-sesame')
    return { call, tracks, api }
  }

  it('waits for the host, then joins again by itself when let in (no password the second time)', async () => {
    const { call, tracks, api } = await waitingCall()
    expect(call.phase).toBe('waiting')

    lastEcho().channels.get(`private-user.${ME}`)!.emit('.room.admitted', { room: { id: ROOM } })
    await settle()

    const joins = api.calls.filter((c) => c.url.endsWith('/join'))
    expect(joins.map((c) => c.body)).toEqual([{ password: 'open-sesame' }, {}])
    expect(call.phase).toBe('connected')
    expect(lastRoom().localParticipant.published.map((p) => p.track)).toEqual([tracks.videoTrack, tracks.audioTrack])
  })

  it('turned away while waiting: says so', async () => {
    const { call } = await waitingCall()

    lastEcho().channels.get(`private-user.${ME}`)!.emit('.room.denied', { room: { id: ROOM } })
    await settle()

    expect([call.phase, call.overReason]).toEqual(['over', 'denied'])
  })

  it('a decision about another room changes nothing', async () => {
    const { call } = await waitingCall()

    useRoomsStore().noteDecision('another-room', 'admitted')
    await settle()

    expect(call.phase).toBe('waiting')
  })

  it('asks the room now and then in case the "let in" was missed', async () => {
    vi.useFakeTimers()
    let admission = 'waiting'
    serve({ join: () => (admission === 'waiting' ? { data: { status: 'waiting' } } : admitted()) })
    fakeApi((c) => {
      if (c.url.endsWith('/join')) return admission === 'waiting' ? { data: { status: 'waiting' } } : admitted()
      return { data: { data: makeRoom({ my_participation: { role: 'participant', admission: admission as never } }) } }
    })
    const call = useCallStore()
    await call.open(ROOM)
    await call.join(media())

    admission = 'admitted'
    await vi.advanceTimersByTimeAsync(WAITING_CHECK_MS)

    expect(call.phase).toBe('connected')
  })

  it('the check also notices a refusal or the end of the meeting', async () => {
    vi.useFakeTimers()
    let room = makeRoom({ my_participation: { role: 'participant', admission: 'waiting' } })
    fakeApi((c) => (c.url.endsWith('/join') ? { data: { status: 'waiting' } } : { data: { data: room } }))
    const call = useCallStore()
    await call.open(ROOM)
    await call.join(media())

    room = makeRoom({ status: 'ended' })
    await vi.advanceTimersByTimeAsync(WAITING_CHECK_MS)

    expect(call.overReason).toBe('ended')
  })

  it('when the socket comes back while waiting, asks at once', async () => {
    const { calls } = serve({ room: makeRoom({ my_participation: { role: 'participant', admission: 'waiting' } }), join: () => ({ data: { status: 'waiting' } }) })
    const call = useCallStore()
    await call.open(ROOM)
    await call.join(media())
    const before = calls.length

    lastEcho().setStatus('disconnected')
    lastEcho().setStatus('connected')
    await settle()

    // (The one-to-one call store also asks `GET /calls/current` after a reconnect; only the meeting's requests count here.)
    expect(calls.slice(before).filter((c) => c.url.startsWith('/rooms')).map((c) => `${c.method} ${c.url}`)).toEqual([`get /rooms/${ROOM}`])
  })
})

describe('staying in the call', () => {
  it('LiveKit dropping the call: joins again by itself and reconnects with the same microphone and camera', async () => {
    const call = await inCall()
    lastRoom().localParticipant.set(Track.Source.Camera, false)
    lastRoom().emit('trackMuted')
    await settle()
    const first = lastRoom()

    first.drop(DisconnectReason.SIGNAL_CLOSE)
    expect(call.phase).toBe('rejoining')
    await settle()

    expect(liveRooms).toHaveLength(2)
    expect(call.phase).toBe('connected')
    expect(call.local).toMatchObject({ micOn: true, cameraOn: false })
  })

  it('an expired token gets a fresh one from join (people already admitted always get back in)', async () => {
    let n = 0
    const room = makeRoom()
    serve({ room, join: () => admitted(room, `token-${++n}`) })
    const call = useCallStore()
    await call.open(ROOM)
    await call.join(media())

    lastRoom().drop(DisconnectReason.JOIN_FAILURE)
    await settle()

    expect(lastRoom().connectedWith?.token).toBe('token-2')
    expect(call.phase).toBe('connected')
  })

  it('keeps trying a few times without a network, then hands over to the pre-join screen', async () => {
    vi.useFakeTimers()
    let online = true
    const room = makeRoom()
    serve({ room, join: () => (online ? admitted(room) : { network: true }) })
    const call = useCallStore()
    await call.open(ROOM)
    await call.join(media())

    online = false
    lastRoom().drop(DisconnectReason.SIGNAL_CLOSE)
    await vi.advanceTimersByTimeAsync(REJOIN_DELAY_MS * REJOIN_ATTEMPTS * REJOIN_ATTEMPTS)

    expect(call.phase).toBe('prejoin')
    expect(call.problem).toEqual({ kind: 'connect-failed' })
    // No longer in the call: nothing to come back to after a reload, and the next Join is an ordinary one.
    expect(call.resume).toBeNull()
    expect(window.sessionStorage.getItem('kc.call')).toBeNull()
  })

  it.each([
    [DisconnectReason.PARTICIPANT_REMOVED, 'removed'],
    [DisconnectReason.ROOM_DELETED, 'ended'],
    [DisconnectReason.ROOM_CLOSED, 'ended'],
    [DisconnectReason.DUPLICATE_IDENTITY, 'elsewhere'],
  ])('LiveKit ending the call with reason %s does not join again: "%s"', async (reason, expected) => {
    const call = await inCall()

    lastRoom().drop(reason)
    await settle()

    expect([call.phase, call.overReason]).toEqual(['over', expected])
    expect(liveRooms).toHaveLength(1)
  })

  it('the meeting ended while getting back in: the room\'s channel still says so, and nothing reconnects after', async () => {
    let answer: (reply: Reply) => void = () => undefined
    let joins = 0
    const room = makeRoom()
    fakeApi((c) => {
      if (!c.url.endsWith('/join')) return { data: { data: room } }
      joins += 1
      return joins === 1 ? admitted(room) : new Promise<Reply>((resolve) => (answer = resolve))
    })
    const call = useCallStore()
    await call.open(ROOM)
    await call.join(media())

    lastRoom().drop(DisconnectReason.SIGNAL_CLOSE) // the host ended it; the reason got lost
    await settle()
    expect(call.phase).toBe('rejoining')
    lastEcho().channels.get(`presence-room.${ROOM}`)!.emit('.room.ended', { room_id: ROOM, ended_at: 'now' })
    await settle()
    expect(call.overReason).toBe('ended')

    answer(admitted(room)) // the join that was on its way: too late, ignored
    await settle()
    expect(call.phase).toBe('over')
    expect(liveRooms).toHaveLength(1)
  })

  it('LiveKit refusing us back: asks the room, and an ended meeting ends the call', async () => {
    let room = makeRoom()
    fakeApi((c) => (c.url.endsWith('/join') ? admitted(room) : { data: { data: room } }))
    const call = useCallStore()
    await call.open(ROOM)
    await call.join(media())
    const { setRoomFactory } = await import('@/realtime/callSession')
    const { FakeRoom } = await import('@/__tests__/fakeLiveKit')
    setRoomFactory(() => {
      const fake = new FakeRoom()
      fake.connectError = new Error('room deleted')
      liveRooms.push(fake)
      return fake as never
    })

    room = makeRoom({ status: 'ended' })
    lastRoom().drop(DisconnectReason.SIGNAL_CLOSE)
    await settle()

    expect(call.overReason).toBe('ended')
    expect(liveRooms).toHaveLength(2) // one try, then the room said it was over
  })

  it('turned away while getting back in means you were removed', async () => {
    let joins = 0
    serve({ join: () => (++joins === 1 ? admitted() : refused(403, { code: 'join_denied' })) })
    const call = useCallStore()
    await call.open(ROOM)
    await call.join(media())

    lastRoom().drop(DisconnectReason.SIGNAL_CLOSE)
    await settle()

    expect(call.overReason).toBe('removed')
  })

  it('shows LiveKit\'s own short reconnecting', async () => {
    const call = await inCall()

    lastRoom().emit('reconnecting')
    expect(call.reconnecting).toBe(true)
    lastRoom().emit('reconnected')
    expect(call.reconnecting).toBe(false)
  })

  it('says when the browser blocks the sound, until the person allows it', async () => {
    serve()
    const call = useCallStore()
    await call.open(ROOM)
    const { setRoomFactory } = await import('@/realtime/callSession')
    const { FakeRoom } = await import('@/__tests__/fakeLiveKit')
    setRoomFactory(() => {
      const room = new FakeRoom()
      room.canPlaybackAudio = false
      liveRooms.push(room)
      return room as never
    })
    await call.join(media())
    expect(call.audioBlocked).toBe(true)

    await call.startAudio()
    expect(call.audioBlocked).toBe(false)
  })
})

describe('room events', () => {
  it('"the meeting has ended" disconnects and says so', async () => {
    const call = await inCall()
    const room = lastRoom()

    lastEcho().channels.get(`presence-room.${ROOM}`)!.emit('.room.ended', { room_id: ROOM, ended_at: 'now' })
    await settle()

    expect([call.phase, call.overReason]).toEqual(['over', 'ended'])
    expect(room.disconnects).toBe(1)
  })

  it('"turned away" while in the call means you were removed', async () => {
    const call = await inCall()

    lastEcho().channels.get(`private-user.${ME}`)!.emit('.room.denied', { room: { id: ROOM } })
    await settle()

    expect(call.overReason).toBe('removed')
  })

  it('roles come from the tokens and follow role changes; there is only ever one host', async () => {
    const call = await inCall(makeRoom({ host_id: ME, my_participation: { role: 'host', admission: 'admitted' } }))
    const room = lastRoom()
    room.addPerson(PAW, 'Naw Paw Say', { role: 'participant' })
    room.addPerson(HTOO, 'Saw Htoo', { role: 'co_host' })
    await settle()
    expect([call.roleOf(ME), call.roleOf(PAW), call.roleOf(HTOO)]).toEqual(['host', 'participant', 'co_host'])

    const channel = lastEcho().channels.get(`presence-room.${ROOM}`)!
    channel.emit('.room.role_changed', { room_id: ROOM, user_id: PAW, role: 'co_host', host_id: ME })
    expect(call.roleOf(PAW)).toBe('co_host')

    // The host's connection dropped and the role moved on.
    channel.emit('.room.role_changed', { room_id: ROOM, user_id: HTOO, role: 'host', host_id: HTOO })
    expect([call.roleOf(ME), call.roleOf(HTOO)]).toEqual(['participant', 'host'])
    expect(call.isHost).toBe(false)
  })

  it('made a co-host: says so and shows who is already waiting', async () => {
    let room = makeRoom({ host_id: PAW, host: person(PAW, 'Naw Paw Say'), my_participation: { role: 'participant', admission: 'admitted' } })
    serve({ join: () => admitted(room) })
    fakeApi((c) => (c.url.endsWith('/join') ? admitted(room) : { data: { data: room } }))
    const call = useCallStore()
    await call.open(ROOM)
    await call.join(media())
    expect(call.canModerate).toBe(false)

    room = { ...room, waiting_participants: [{ user: person(HTOO, 'Saw Htoo'), user_id: HTOO, role: 'participant', admission: 'waiting', joined_at: null, left_at: null }] }
    lastEcho().channels.get(`presence-room.${ROOM}`)!.emit('.room.role_changed', { room_id: ROOM, user_id: ME, role: 'co_host', host_id: PAW })
    await settle()

    expect(call.canModerate).toBe(true)
    expect(call.waiting.map((entry) => entry.user.name)).toEqual(['Saw Htoo'])
    expect(useUiStore().toasts.at(-1)?.message).toBe('You are now a co-host.')
  })
})

describe('the waiting list (hosts and co-hosts)', () => {
  const asker = person(HTOO, 'Saw Htoo')
  const waitingEntry = { user: asker, user_id: HTOO, role: 'participant' as const, admission: 'waiting' as const, joined_at: null, left_at: null }

  it('starts with who was waiting, and adds people who ask (once, whichever channel it came on)', async () => {
    const call = await inCall(makeRoom({ waiting_participants: [waitingEntry] }))
    expect(call.waiting.map((entry) => entry.user_id)).toEqual([HTOO])

    const paw = person(PAW, 'Naw Paw Say')
    lastEcho().channels.get(`presence-room.${ROOM}`)!.emit('.room.join_requested', { room_id: ROOM, user: paw })
    lastEcho().channels.get(`private-user.${ME}`)!.emit('.room.join_requested', { room_id: ROOM, user: paw })
    await settle()

    expect(call.waiting.map((entry) => entry.user_id)).toEqual([HTOO, PAW])
  })

  it('someone who joins the call leaves the list', async () => {
    const call = await inCall(makeRoom({ waiting_participants: [waitingEntry] }))

    lastRoom().addPerson(HTOO, 'Saw Htoo')
    await settle()

    expect(call.waiting).toEqual([])
  })

  it('Admit and Deny call the API and take the person off the list', async () => {
    const room = makeRoom({ waiting_participants: [waitingEntry, { ...waitingEntry, user: person(PAW, 'Paw'), user_id: PAW }] })
    const { calls } = serve({ room, join: () => admitted(room), other: () => ({ data: { data: waitingEntry } }) })
    const call = useCallStore()
    await call.open(ROOM)
    await call.join(media())

    await call.admit(HTOO)
    await call.deny(PAW)

    expect(calls.filter((c) => c.method === 'post' && !c.url.endsWith('/join')).map((c) => c.url)).toEqual([`/rooms/${ROOM}/admit/${HTOO}`, `/rooms/${ROOM}/deny/${PAW}`])
    expect(call.waiting).toEqual([])
  })

  it('denying someone who is no longer waiting just takes them off the list', async () => {
    const room = makeRoom({ waiting_participants: [waitingEntry] })
    serve({ room, join: () => admitted(room), other: () => refused(409, { code: 'not_waiting' }) })
    const call = useCallStore()
    await call.open(ROOM)
    await call.join(media())

    await call.deny(HTOO)

    expect(call.waiting).toEqual([])
  })

  it('people who are not hosts never see anyone waiting', async () => {
    const room = makeRoom({ host_id: PAW, my_participation: { role: 'participant', admission: 'admitted' } })
    const call = await inCall(room)

    lastEcho().channels.get(`presence-room.${ROOM}`)!.emit('.room.join_requested', { room_id: ROOM, user: asker })

    expect(call.waiting).toEqual([])
  })

  it('who may act on whom: the host on everyone else, a co-host on participants only, nobody on themselves', async () => {
    const call = await inCall()
    const room = lastRoom()
    room.addPerson(PAW, 'Naw Paw Say', { role: 'participant' })
    room.addPerson(HTOO, 'Saw Htoo', { role: 'co_host' })
    await settle()

    expect([call.canActOn(ME), call.canActOn(PAW), call.canActOn(HTOO)]).toEqual([false, true, true])

    lastEcho().channels.get(`presence-room.${ROOM}`)!.emit('.room.role_changed', { room_id: ROOM, user_id: ME, role: 'co_host', host_id: 'someone-else' })
    expect([call.canActOn(PAW), call.canActOn(HTOO)]).toEqual([true, false])
  })
})

describe('chat', () => {
  it('shows messages from others once each, and counts them while the chat is closed', async () => {
    const call = await inCall()
    const room = lastRoom()

    room.deliverText(PAW, ' Hello everyone ', 'm1')
    room.deliverText(PAW, 'Hello everyone', 'm1')
    await settle()

    expect(call.messages).toMatchObject([{ id: 'm1', from: PAW, text: 'Hello everyone', mine: false }])
    expect(call.unread).toBe(1)

    call.togglePanel('chat')
    expect(call.unread).toBe(0)
    room.deliverText(PAW, 'Can you hear me?', 'm2')
    await settle()
    expect(call.unread).toBe(0)
  })

  it('sends on the "chat" topic and shows your message', async () => {
    const call = await inCall()

    expect(await call.sendChat('  See you all  ')).toBe(true)

    expect(lastRoom().localParticipant.sent).toEqual([{ text: 'See you all', topic: 'chat' }])
    expect(call.messages.at(-1)).toMatchObject({ text: 'See you all', mine: true, from: ME })
  })

  it('a message that could not be sent says so (the text stays with the person)', async () => {
    const call = await inCall()
    lastRoom().localParticipant.failures.set('text', new Error('data channel closed'))

    expect(await call.sendChat('Lost')).toBe(false)
    expect(await call.sendChat('   ')).toBe(false)
    expect(call.messages).toEqual([])
  })
})

describe('your own media and data saver', () => {
  it('toggles the microphone and camera', async () => {
    const call = await inCall()

    await call.toggleMicrophone()
    await call.toggleCamera()
    await settle()

    expect(call.local).toMatchObject({ micOn: false, cameraOn: false })
  })

  it('a camera that cannot be opened stays off and says why', async () => {
    const call = await inCall()
    await call.toggleCamera()
    await settle()
    lastRoom().localParticipant.failures.set('camera', Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }))

    await call.toggleCamera()
    await settle()

    expect(call.local?.cameraOn).toBe(false)
    expect(useUiStore().toasts.at(-1)).toMatchObject({ kind: 'error' })
  })

  it('closing the "choose what to share" window is not an error', async () => {
    const call = await inCall()
    lastRoom().localParticipant.failures.set('screen', Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }))

    await call.toggleScreenShare()

    expect(useUiStore().toasts).toEqual([])
    expect(call.local?.screenSharing).toBe(false)
  })

  it('data saver stops receiving cameras (also ones that start later) but keeps screen shares', async () => {
    const call = await inCall()
    const room = lastRoom()
    const paw = room.addPerson(PAW, 'Naw Paw Say')
    await settle()
    expect(call.participants.find((p) => p.id === PAW)?.cameraTrack).not.toBeNull()

    call.setDataSaver(true)
    const htoo = room.addPerson(HTOO, 'Saw Htoo')
    const screen = room.publish(paw, Track.Source.ScreenShare)
    await settle()

    expect(paw.getTrackPublication(Track.Source.Camera)?.subscribed).toBe(false)
    expect(htoo.getTrackPublication(Track.Source.Camera)?.subscribed).toBe(false)
    expect(screen.subscribed).toBe(true)
    expect(call.participants.find((p) => p.id === PAW)).toMatchObject({ cameraOn: true, cameraTrack: null })

    call.setDataSaver(false)
    expect(paw.getTrackPublication(Track.Source.Camera)?.subscribed).toBe(true)
  })

  it('plays the others\' voices through hidden audio elements, and stops when they leave', async () => {
    await inCall()
    const room = lastRoom()

    room.addPerson(PAW, 'Naw Paw Say')
    expect(document.querySelectorAll('div[hidden] audio')).toHaveLength(1)

    room.leaveRoom(PAW)
    expect(document.querySelectorAll('div[hidden] audio')).toHaveLength(0)
  })
})

describe('leaving, ending and coming back after a reload', () => {
  it('remembers in this tab that you are in the call (with your microphone and camera), and forgets when you leave', async () => {
    const call = await inCall()
    expect(JSON.parse(window.sessionStorage.getItem('kc.call')!)).toEqual({ roomId: ROOM, micOn: true, cameraOn: true })

    call.leave()

    expect(window.sessionStorage.getItem('kc.call')).toBeNull()
    expect([call.phase, call.overReason]).toEqual(['over', 'left'])
  })

  it('writes that note only once really in the call, not while still connecting (the screens rely on it)', async () => {
    serve()
    const call = useCallStore()
    await call.open(ROOM)
    const phasesWhenNoted: string[] = []
    watch(
      () => call.resume,
      (note) => note && phasesWhenNoted.push(call.phase),
      { flush: 'sync' },
    )

    await call.join(media()) // publishing the tracks happens while connecting, and triggers snapshots
    await settle()

    expect(phasesWhenNoted).toEqual(['connected'])
  })

  it('a reload during the call knows it can join again straight away', async () => {
    window.sessionStorage.setItem('kc.call', JSON.stringify({ roomId: ROOM, micOn: false, cameraOn: true }))
    serve()
    const call = useCallStore()

    await call.open(ROOM)

    expect(call.resume).toEqual({ roomId: ROOM, micOn: false, cameraOn: true })
  })

  it('a note about another room is ignored', async () => {
    window.sessionStorage.setItem('kc.call', JSON.stringify({ roomId: 'elsewhere', micOn: true, cameraOn: true }))
    serve()
    const call = useCallStore()

    await call.open(ROOM)

    expect(call.resume).toBeNull()
  })

  it('the host can end the meeting for everyone', async () => {
    const room = makeRoom()
    const { calls } = serve({ room, join: () => admitted(room), other: () => ({ data: { data: { ...room, status: 'ended' } } }) })
    const call = useCallStore()
    await call.open(ROOM)
    await call.join(media())

    await call.endForEveryone()

    expect(calls.at(-1)).toMatchObject({ method: 'post', url: `/rooms/${ROOM}/end` })
    expect(call.overReason).toBe('ended')
  })

  it('if ending fails, the meeting carries on', async () => {
    const room = makeRoom()
    serve({ room, join: () => admitted(room), other: () => refused(503) })
    const call = useCallStore()
    await call.open(ROOM)
    await call.join(media())

    await expect(call.endForEveryone()).rejects.toMatchObject({ status: 503 })
    expect(call.phase).toBe('connected')
  })

  it('going to another page disconnects quietly', async () => {
    const call = await inCall()
    const room = lastRoom()

    await call.close()

    expect(room.disconnects).toBe(1)
    expect(call.phase).toBe('idle')
    expect(useRoomsStore().activeCallId).toBeNull()
  })
})
