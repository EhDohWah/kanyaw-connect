import { Track } from 'livekit-client'
import type { VueWrapper } from '@vue/test-utils'
import type { Pinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { lastEcho } from '@/__tests__/fakeEcho'
import { FakeRoom, FakeTrack, lastRoom, liveRooms, useFakeLiveKit } from '@/__tests__/fakeLiveKit'
import { ME, PAW, deferred, fakeApi, makeRoom, mountApp, person, restoreApi, settle, signedInStores, type Call } from '@/__tests__/helpers'
import { realtime } from '@/realtime'
import { setRoomFactory } from '@/realtime/callSession'
import { userChannelHandlers } from '@/realtime/handlers'
import { useCallStore } from '@/stores/call'
import { useRealtimeStore } from '@/stores/realtime'
import { useUiStore } from '@/stores/ui'
import type { Room } from '@/types/room'
import RoomView from '@/views/RoomView.vue'

// The camera and microphone: tracks made up on the spot, or the browser refusing.
const opened: FakeTrack[] = []
const refusal: { camera: unknown; microphone: unknown } = { camera: null, microphone: null }
vi.mock('@/realtime/localMedia', async (original) => ({
  ...(await original<typeof import('@/realtime/localMedia')>()),
  openCamera: vi.fn(async () => {
    if (refusal.camera) throw refusal.camera
    const track = new FakeTrack('video', Track.Source.Camera)
    opened.push(track)
    return track
  }),
  openMicrophone: vi.fn(async () => {
    if (refusal.microphone) throw refusal.microphone
    const track = new FakeTrack('audio', Track.Source.Microphone)
    opened.push(track)
    return track
  }),
  listDevices: vi.fn(async (kind: string) => [{ deviceId: `${kind}-1`, label: kind === 'videoinput' ? 'Front camera' : 'Headset', kind, groupId: '' }]),
  canShareScreen: vi.fn(() => true),
}))

useFakeLiveKit()

const ROOM = makeRoom().id
const blocked = () => Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' })
type Reply = { status?: number; data?: unknown; network?: boolean; headers?: Record<string, string> }
const admitted = (room: Room): Reply => ({ data: { status: 'admitted', token: 'lk', livekit_url: 'ws://lk.test', room } })

beforeEach(() => {
  opened.length = 0
  refusal.camera = null
  refusal.microphone = null
  window.sessionStorage.clear()
})

afterEach(async () => {
  restoreApi()
  realtime.disconnect()
})

function serve(room: Room, join: (call: Call) => Reply = () => admitted(room)) {
  return fakeApi((call) => {
    if (call.method === 'get' && call.url === `/rooms/${ROOM}`) return { data: { data: room } }
    if (call.url.endsWith('/join')) return join(call)
    return { data: {} }
  })
}

async function open(room: Room = makeRoom(), join?: (call: Call) => Reply, prepare: (pinia: Pinia) => void = () => undefined) {
  const api = serve(room, join)
  const mounted = await mountApp(RoomView, {
    route: `/rooms/${ROOM}`,
    prepare: (pinia) => {
      signedInStores(pinia)
      realtime.connect('t', ME, userChannelHandlers(), { status: (status) => useRealtimeStore(pinia).setStatus(status), connected: () => undefined })
      prepare(pinia)
    },
  })
  await settle()
  return { ...mounted, api }
}

const buttonNamed = (wrapper: VueWrapper, name: string) =>
  wrapper.findAll('button').find((b) => b.text().trim() === name || b.attributes('aria-label') === name)

describe('the pre-join screen', () => {
  it('shows the room, its host and a live preview, with the microphone and camera on and the devices to choose from', async () => {
    const { wrapper } = await open(makeRoom({ name: 'Committee meeting', host: person(PAW, 'Naw Paw Say'), host_id: PAW, my_participation: null }))

    expect(wrapper.get('h1').text()).toBe('Committee meeting')
    expect(wrapper.text()).toContain('Hosted by Naw Paw Say')
    expect(wrapper.find('video').exists()).toBe(true)
    expect(opened.map((track) => track.kind).sort()).toEqual(['audio', 'video'])
    expect(wrapper.get('[aria-label=Microphone]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('[aria-label=Camera]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.findAll('select option').map((o) => o.text())).toEqual(['Default', 'Front camera', 'Default', 'Headset'])
  })

  it('switching the camera off closes it (the light goes off); on again opens it', async () => {
    const { wrapper } = await open()
    const camera = opened.find((track) => track.kind === 'video')!

    await wrapper.get('[aria-label=Camera]').trigger('click')
    await settle()
    expect(camera.stopped).toBe(true)
    expect(wrapper.text()).toContain('Your camera is off')

    await wrapper.get('[aria-label=Camera]').trigger('click')
    await settle()
    expect(opened.filter((track) => track.kind === 'video')).toHaveLength(2)
    expect(wrapper.find('video').exists()).toBe(true)
  })

  it('a blocked camera says how to fix it, and joining without it still works', async () => {
    refusal.camera = blocked()
    const { wrapper } = await open()

    expect(wrapper.text()).toContain("The browser is not allowing the camera. Allow it in the browser's settings, or join without it.")
    expect(wrapper.get('[aria-label=Camera]').attributes('aria-pressed')).toBe('false')

    await wrapper.get('form').trigger('submit') // Join
    await settle()
    expect(useCallStore().phase).toBe('connected')
    expect(useCallStore().local?.cameraOn).toBe(false)
  })

  it('asks for the password only when the room has one and you have not been let in yet', async () => {
    const guest = await open(makeRoom({ has_password: true, host_id: PAW, host: person(PAW, 'Paw'), my_participation: null }))
    expect(guest.wrapper.find('input[type=password]').exists()).toBe(true)
    guest.wrapper.unmount()

    const host = await open(makeRoom({ has_password: true }))
    expect(host.wrapper.find('input[type=password]').exists()).toBe(false)
    host.wrapper.unmount()

    const back = await open(makeRoom({ has_password: true, host_id: PAW, host: person(PAW, 'Paw'), my_participation: { role: 'participant', admission: 'admitted' } }))
    expect(back.wrapper.find('input[type=password]').exists()).toBe(false)
  })

  it('sends the password with Join, and says so when it was wrong', async () => {
    const room = makeRoom({ has_password: true, host_id: PAW, host: person(PAW, 'Paw'), my_participation: null })
    const { wrapper, api } = await open(room, () => ({ status: 422, data: { message: 'Invalid', errors: { password: ['The room password is incorrect.'] } } }))

    await wrapper.get('input[type=password]').setValue('guess')
    await wrapper.get('form').trigger('submit')
    await settle()

    expect(api.calls.find((c) => c.url.endsWith('/join'))?.body).toEqual({ password: 'guess' })
    expect(wrapper.get('[role=alert]').text()).toBe('The room password is incorrect.')
  })

  it.each([
    [{ status: 422, data: { message: 'x', errors: { password: ['required'] } } }, 'This meeting has a password. Enter it to join.'],
    [{ status: 409, data: { message: 'x', code: 'room_locked' } }, 'The host has locked this meeting. Only people already let in can join.'],
    [{ status: 409, data: { message: 'x', code: 'room_full' } }, 'This meeting is full. Try again when someone leaves.'],
    [{ status: 503, data: { message: 'x' } }, "The video service can't be reached right now. Try again in a moment."],
    [{ status: 429, data: { message: 'x' }, headers: { 'retry-after': '30' } }, 'Too many requests. Please wait 30 seconds and try again.'],
    [{ network: true }, "Can't reach the server. Check your connection and try again."],
  ])('a refused join gets its own message (%#)', async (reply, message) => {
    const { wrapper } = await open(makeRoom({ host_id: PAW, host: person(PAW, 'Paw'), my_participation: null }), () => reply as Reply)

    await wrapper.get('form').trigger('submit') // Join
    await settle()

    expect(wrapper.get('form [role=alert]').text()).toBe(message)
    expect(wrapper.find('video').exists()).toBe(true) // still on the pre-join screen
  })

  it('the pre-join screen stays while connecting, and the preview tracks go into the call alive (regression)', async () => {
    const gate = deferred<void>()
    setRoomFactory(() => {
      const fake = new FakeRoom()
      fake.connectGate = gate.promise
      liveRooms.push(fake)
      return fake as never
    })
    const { wrapper } = await open()
    const [camera, microphone] = [opened.find((t) => t.kind === 'video')!, opened.find((t) => t.kind === 'audio')!]

    await wrapper.get('form').trigger('submit') // Join
    await settle()
    expect(useCallStore().phase).toBe('connecting')
    expect(wrapper.text()).toContain('Connecting…')

    gate.resolve()
    await settle()

    expect(useCallStore().phase).toBe('connected')
    expect(lastRoom().localParticipant.published.map((p) => p.track)).toEqual([camera, microphone])
    expect([camera.stopped, microphone.stopped]).toEqual([false, false])
  })

  it('leaving the page before joining closes the preview', async () => {
    const { wrapper } = await open()

    wrapper.unmount()

    expect(opened.every((track) => track.stopped)).toBe(true)
  })
})

describe('waiting, and the end of the road', () => {
  it('waits for the host, then goes into the call by itself when let in', async () => {
    let joins = 0
    const room = makeRoom({ host_id: PAW, host: person(PAW, 'Paw'), my_participation: null })
    const { wrapper } = await open(room, () => (++joins === 1 ? { data: { status: 'waiting' } } : admitted(room)))

    await wrapper.get('form').trigger('submit') // Join
    await settle()
    expect(wrapper.text()).toContain('Waiting for the host to let you in')
    expect(wrapper.find('video').exists()).toBe(true) // the preview stays while waiting

    lastEcho().channels.get(`private-user.${ME}`)!.emit('.room.admitted', { room: { id: ROOM } })
    await settle()

    expect(wrapper.find('.call-screen').exists()).toBe(true)
    expect(useUiStore().callOpen).toBe(true)
  })

  it('turned away while waiting: says so, with a way back to the meetings', async () => {
    const room = makeRoom({ host_id: PAW, host: person(PAW, 'Paw'), my_participation: null })
    const { wrapper } = await open(room, () => ({ data: { status: 'waiting' } }))
    await wrapper.get('form').trigger('submit') // Join
    await settle()

    lastEcho().channels.get(`private-user.${ME}`)!.emit('.room.denied', { room: { id: ROOM } })
    await settle()

    expect(wrapper.get('h1').text()).toBe('The host did not let you in')
    expect(wrapper.get('a[href="/rooms"]').text()).toBe('Back to meetings')
    expect(opened.every((track) => track.stopped)).toBe(true)
  })

  it('a meeting that is over says so straight away, with no way to rejoin', async () => {
    const { wrapper } = await open(makeRoom({ status: 'ended' }))

    expect(wrapper.get('h1').text()).toBe('The meeting has ended')
    expect(buttonNamed(wrapper, 'Rejoin')).toBeUndefined()
  })

  it('after leaving, "Rejoin" goes back to the pre-join screen', async () => {
    const { wrapper } = await open()
    await wrapper.get('form').trigger('submit') // Join
    await settle()

    await buttonNamed(wrapper, 'Leave')!.trigger('click') // not the host? the host gets a choice: see CallScreen
    await settle()
    if (document.body.querySelector('[role=dialog]')) {
      ;[...document.body.querySelectorAll<HTMLButtonElement>('[role=dialog] button')].find((b) => b.textContent?.trim() === 'Leave meeting')!.click()
      await settle()
    }
    expect(wrapper.get('h1').text()).toBe('You left the meeting')
    expect(useUiStore().callOpen).toBe(false)

    await buttonNamed(wrapper, 'Rejoin')!.trigger('click')
    await settle()
    expect(wrapper.find('form').exists()).toBe(true)
  })

  it('a room that could not be loaded offers "Try again"', async () => {
    let online = false
    fakeApi((call) => (online ? { data: { data: makeRoom() } } : call.url ? { network: true } : { network: true }))
    const { wrapper } = await mountApp(RoomView, { route: `/rooms/${ROOM}`, prepare: (pinia) => signedInStores(pinia) })
    await settle()
    expect(wrapper.text()).toContain("Can't reach the server")

    online = true
    await buttonNamed(wrapper, 'Try again')!.trigger('click')
    await settle()
    expect(wrapper.find('form').exists()).toBe(true)
  })
})

describe('coming back after a reload', () => {
  it('joins again by itself, with the microphone and camera as they were, without the pre-join screen', async () => {
    window.sessionStorage.setItem('kc.call', JSON.stringify({ roomId: ROOM, micOn: false, cameraOn: true }))
    const gate = deferred<void>()
    setRoomFactory(() => {
      const fake = new FakeRoom()
      fake.connectGate = gate.promise
      liveRooms.push(fake)
      return fake as never
    })
    const { wrapper } = await open()

    expect(wrapper.text()).toContain('Joining the meeting again…')
    expect(wrapper.find('form').exists()).toBe(false)
    expect(opened).toEqual([]) // no preview opened

    gate.resolve()
    await settle()
    expect(wrapper.find('.call-screen').exists()).toBe(true)
    expect(useCallStore().local).toMatchObject({ micOn: false, cameraOn: true })
  })

  it('if that fails, the pre-join screen says why', async () => {
    window.sessionStorage.setItem('kc.call', JSON.stringify({ roomId: ROOM, micOn: true, cameraOn: true }))
    const { wrapper } = await open(makeRoom(), () => ({ status: 409, data: { message: 'x', code: 'room_full' } }))

    expect(wrapper.find('form').exists()).toBe(true)
    expect(wrapper.text()).toContain('This meeting is full.')
  })
})

describe('the layout preview (development builds)', () => {
  it('?demo=4 shows the call screen with four sample people, one speaking and one muted', async () => {
    fakeApi(() => ({ data: { data: makeRoom() } }))
    const { wrapper } = await mountApp(RoomView, { route: `/rooms/${ROOM}?demo=4`, prepare: (pinia) => signedInStores(pinia) })
    // The sample people are loaded on demand (that code is not in production builds).
    await vi.waitFor(() => expect(wrapper.findAll('.call-screen [role=group]')).toHaveLength(4))

    const tiles = wrapper.findAll('.call-screen [role=group]').map((tile) => tile.attributes('aria-label'))
    expect(tiles).toHaveLength(4)
    expect(tiles[0]).toBe('Saw Eh Doh (you), Host')
    expect(tiles.filter((label) => label?.includes('Speaking'))).toHaveLength(1)
    expect(tiles.filter((label) => label?.includes('Microphone off'))).toHaveLength(1)
  })
})
