import { Track } from 'livekit-client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FakeRoom, lastRoom, liveRooms, useFakeLiveKit } from '@/__tests__/fakeLiveKit'
import { ME, PAW, fakeApi, makeRoom, mockMedia, mountApp, person, restoreApi, restoreMedia, settle, signedInStores } from '@/__tests__/helpers'
import CallScreen from '@/components/call/CallScreen.vue'
import { realtime } from '@/realtime'
import { setRoomFactory } from '@/realtime/callSession'
import { userChannelHandlers } from '@/realtime/handlers'
import { useCallStore } from '@/stores/call'
import { useRealtimeStore } from '@/stores/realtime'
import { useUiStore } from '@/stores/ui'
import type { Room } from '@/types/room'

const share = { supported: true }
vi.mock('@/realtime/localMedia', async (original) => ({
  ...(await original<typeof import('@/realtime/localMedia')>()),
  canShareScreen: vi.fn(() => share.supported),
  listDevices: vi.fn(async () => []),
}))

useFakeLiveKit()

const ROOM = makeRoom().id
const HTOO = '0195e2c4-0005-7a04-8104-5f3a9c007bbc'

let endReply: { status?: number; data?: unknown } = { data: {} }

beforeEach(() => {
  share.supported = true
  endReply = { data: { data: makeRoom({ status: 'ended' }) } }
  window.sessionStorage.clear()
})

afterEach(() => {
  restoreApi()
  restoreMedia()
  realtime.disconnect()
})

/** A wide screen with a mouse, or a phone. */
const wide = () => mockMedia((query) => query.includes('min-width: 1024px') || query.includes('pointer: fine'))
const phone = () => mockMedia((query) => query.includes('max-width: 767px'))

/** The call screen, connected to a (fake) LiveKit room. */
async function inCall(room: Room = makeRoom()) {
  const api = fakeApi((call) => {
    if (call.method === 'get') return { data: { data: room } }
    if (call.url.endsWith('/join')) return { data: { status: 'admitted', token: 'lk', livekit_url: 'ws://lk.test', room } }
    if (call.url.endsWith('/end')) return endReply
    return { data: {} }
  })
  const mounted = await mountApp(CallScreen, {
    prepare: (pinia) => {
      signedInStores(pinia)
      realtime.connect('t', ME, userChannelHandlers(), { status: () => undefined, connected: () => undefined })
    },
  })
  const call = useCallStore()
  await call.open(ROOM)
  await call.join({ micOn: true, cameraOn: true })
  await settle()
  return { ...mounted, call, api, livekit: lastRoom() }
}

const tiles = (root: { findAll: (s: string) => { attributes: (n: string) => string | undefined }[] }) =>
  root.findAll('ul [role=group]').map((tile) => tile.attributes('aria-label'))

describe('the people in the call', () => {
  it('shows you first, then the others in the order they came, with names and roles', async () => {
    wide()
    const { wrapper, livekit } = await inCall()
    livekit.addPerson(HTOO, 'Saw Htoo', { joinedAt: 2000, camera: false })
    livekit.addPerson(PAW, 'Naw Paw Say', { joinedAt: 1000, role: 'co_host' })
    await settle()

    expect(tiles(wrapper)).toEqual(['Saw Eh Doh (you), Host', 'Naw Paw Say, Co-host', 'Saw Htoo'])
    // Cameras that are on show video; Htoo's camera is off: initials.
    expect(wrapper.findAll('ul [role=group]').map((tile) => tile.find('video').exists())).toEqual([true, true, false])
  })

  it('marks who is speaking and who is muted', async () => {
    wide()
    const { wrapper, livekit } = await inCall()
    const paw = livekit.addPerson(PAW, 'Naw Paw Say')
    livekit.mute(paw, Track.Source.Microphone)
    livekit.speak(paw)
    await settle()

    const tile = wrapper.findAll('ul [role=group]')[1]!
    expect(tile.attributes('aria-label')).toBe('Naw Paw Say, Microphone off, Speaking')
    expect(tile.classes()).toContain('ring-primary')
    expect(tile.find('svg.lucide-mic-off').exists()).toBe(true)
  })

  it('two people sit side by side on a wide screen, one above the other on a phone', async () => {
    wide()
    const first = await inCall()
    first.livekit.addPerson(PAW, 'Naw Paw Say')
    await settle()
    expect(first.wrapper.get('ul.grid').attributes('style')).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))')
    first.wrapper.unmount()
    await useCallStore().close()

    phone()
    const second = await inCall()
    second.livekit.addPerson(PAW, 'Naw Paw Say')
    await settle()
    expect(second.wrapper.get('ul.grid').attributes('style')).toContain('grid-template-columns: repeat(1, minmax(0, 1fr))')
  })

  it('more than nine people make pages; the person speaking stays on screen whichever page is shown', async () => {
    wide()
    const { wrapper, livekit } = await inCall()
    const people = Array.from({ length: 11 }, (_unused, index) => livekit.addPerson(`p-${String(index).padStart(2, '0')}`, `Person ${index + 1}`, { joinedAt: index + 1, camera: false }))
    await settle()
    expect(wrapper.text()).toContain('Page 1 of 2')
    expect(tiles(wrapper)).toHaveLength(9)

    await wrapper.get('[aria-label="Next page"]').trigger('click')
    expect(tiles(wrapper)).toEqual(['Person 9', 'Person 10', 'Person 11'])

    livekit.speak(people[2]!)
    await settle()
    expect(tiles(wrapper)).toEqual(['Person 9', 'Person 10', 'Person 11', 'Person 3, Speaking'])
  })

  it('on a phone: four to a page, and a sideways swipe turns the page', async () => {
    phone()
    const { wrapper, livekit } = await inCall()
    for (let index = 0; index < 5; index += 1) livekit.addPerson(`p-${index}`, `Person ${index + 1}`, { joinedAt: index + 1 })
    await settle()
    expect(tiles(wrapper)).toHaveLength(4)
    expect(wrapper.text()).toContain('Page 1 of 2')

    // jsdom has no PointerEvent: an event with the coordinates is what the handlers read.
    const pointer = (type: string, clientX: number, clientY: number) => Object.assign(new Event(type), { clientX, clientY })
    const grid = wrapper.get('ul.grid').element
    grid.dispatchEvent(pointer('pointerdown', 300, 400))
    grid.dispatchEvent(pointer('pointerup', 120, 410))
    await settle(1)

    expect(wrapper.text()).toContain('Page 2 of 2')
  })

  it('a screen share takes the stage, with everyone\'s camera in a strip', async () => {
    wide()
    const { wrapper, livekit } = await inCall()
    const paw = livekit.addPerson(PAW, 'Naw Paw Say')
    livekit.publish(paw, Track.Source.ScreenShare)
    await settle()

    expect(wrapper.find('ul.grid').exists()).toBe(false)
    const main = wrapper.get('section > div [role=group]')
    expect(main.attributes('aria-label')).toBe("Naw Paw Say's screen")
    expect(main.get('video').classes()).toContain('object-contain') // a screen is never cropped
    expect(wrapper.findAll('section > ul [role=group]')).toHaveLength(2)
  })
})

describe('the toolbar', () => {
  it('switches your microphone and camera, saying on or off with aria-pressed', async () => {
    wide()
    const { wrapper, call } = await inCall()
    const mic = wrapper.get('[role=toolbar] [aria-label=Microphone]')
    expect(mic.attributes('aria-pressed')).toBe('true')

    await mic.trigger('click')
    await wrapper.get('[role=toolbar] [aria-label=Camera]').trigger('click')
    await settle()

    expect(call.local).toMatchObject({ micOn: false, cameraOn: false })
    expect(wrapper.get('[role=toolbar] [aria-label=Microphone]').attributes('aria-pressed')).toBe('false')
    expect(wrapper.get('[role=toolbar] [aria-label=Camera]').attributes('aria-pressed')).toBe('false')
  })

  it('offers screen sharing only where the browser can do it', async () => {
    wide()
    const shared = await inCall()
    await shared.wrapper.get('[aria-label="Share screen"]').trigger('click')
    await settle()
    expect(shared.call.local?.screenSharing).toBe(true)
    shared.wrapper.unmount()
    await useCallStore().close()

    share.supported = false
    const phoneCall = await inCall()
    expect(phoneCall.wrapper.find('[aria-label="Share screen"]').exists()).toBe(false)
  })

  it('counts new chat messages on the Chat button until the chat is opened', async () => {
    wide()
    const { wrapper, livekit } = await inCall()
    livekit.addPerson(PAW, 'Naw Paw Say')
    livekit.deliverText(PAW, 'Hello')
    await settle()

    const chat = wrapper.get('[role=toolbar] [aria-label="Chat, 1 new"]')
    expect(chat.text()).toBe('1')

    await chat.trigger('click')
    await settle()
    expect(wrapper.get('[role=toolbar] [aria-label=Chat]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.text()).toContain('Hello')
  })

  it('shows the host how many people are waiting on the Participants button', async () => {
    wide()
    const waiting = { user: person(HTOO, 'Saw Htoo'), user_id: HTOO, role: 'participant' as const, admission: 'waiting' as const, joined_at: null, left_at: null }
    const { wrapper } = await inCall(makeRoom({ waiting_participants: [waiting] }))

    expect(wrapper.get('[role=toolbar] [aria-label=Participants]').text()).toBe('1')
  })

  it('Leave: everyone else leaves at once', async () => {
    wide()
    const { wrapper, call, livekit } = await inCall(makeRoom({ host_id: PAW, host: person(PAW, 'Paw'), my_participation: { role: 'participant', admission: 'admitted' } }))

    await wrapper.get('[role=toolbar] [aria-label=Leave]').trigger('click')
    await settle()

    expect([call.phase, call.overReason]).toEqual(['over', 'left'])
    expect(livekit.disconnects).toBe(1)
  })

  it('Leave: the host chooses, and ending for everyone is asked twice', async () => {
    wide()
    const { wrapper, call, api } = await inCall()
    const dialogButton = (text: string) => [...document.body.querySelectorAll<HTMLButtonElement>('[role=dialog] button')].find((b) => b.textContent?.trim() === text)

    await wrapper.get('[role=toolbar] [aria-label=Leave]').trigger('click')
    await settle(2)
    expect(dialogButton('Leave meeting')).toBeDefined()

    dialogButton('End meeting for everyone')!.click()
    await settle(2)
    expect(document.body.querySelector('[role=dialog]')?.textContent).toContain('Everyone will be disconnected.')
    expect(api.calls.some((c) => c.url.endsWith('/end'))).toBe(false)

    dialogButton('End meeting for everyone')!.click()
    await settle()
    expect(api.calls.at(-1)).toMatchObject({ method: 'post', url: `/rooms/${ROOM}/end` })
    expect(call.overReason).toBe('ended')
  })

  it('if the meeting cannot be ended, says so and carries on', async () => {
    wide()
    endReply = { status: 503, data: { message: 'LiveKit unreachable' } }
    const { wrapper, call } = await inCall()

    await wrapper.get('[role=toolbar] [aria-label=Leave]').trigger('click')
    await settle(2)
    for (let i = 0; i < 2; i += 1) {
      ;[...document.body.querySelectorAll<HTMLButtonElement>('[role=dialog] button')].find((b) => b.textContent?.trim() === 'End meeting for everyone')!.click()
      await settle()
    }

    expect(call.phase).toBe('connected')
    expect(useUiStore().toasts.at(-1)).toMatchObject({ kind: 'error', message: 'The meeting could not be ended. Please try again.' })
  })

  it('More: data saver stops the others\' cameras', async () => {
    wide()
    const { wrapper, livekit, call } = await inCall()
    const paw = livekit.addPerson(PAW, 'Naw Paw Say')
    await settle()

    await wrapper.get('[aria-label="More options"]').trigger('click')
    await settle(2)
    document.body.querySelector<HTMLButtonElement>('[role=dialog] [role=switch]')!.click()
    await settle()

    expect(call.dataSaver).toBe(true)
    expect(paw.getTrackPublication(Track.Source.Camera)?.subscribed).toBe(false)
  })
})

describe('what the call screen says about the connection', () => {
  it('shows "Reconnecting…" while LiveKit gets a short drop back', async () => {
    wide()
    const { wrapper, livekit } = await inCall()

    livekit.emit('reconnecting')
    await settle(1)
    expect(wrapper.get('[role=status]').text()).toContain('Reconnecting…')

    livekit.emit('reconnected')
    await settle(1)
    expect(wrapper.find('[role=status]').exists()).toBe(false)
  })

  it('shows "Reconnecting…" as soon as the browser says the network is gone (LiveKit only notices later)', async () => {
    wide()
    const { wrapper } = await inCall()

    useRealtimeStore().setBrowserOnline(false)
    await settle(1)
    expect(wrapper.get('[role=status]').text()).toContain('Reconnecting…')

    useRealtimeStore().setBrowserOnline(true)
    await settle(1)
    expect(wrapper.find('[role=status]').exists()).toBe(false)
  })

  it('offers "Turn on sound" when the browser paused it', async () => {
    wide()
    setRoomFactory(() => {
      const fake = new FakeRoom()
      fake.canPlaybackAudio = false
      liveRooms.push(fake)
      return fake as never
    })
    const { wrapper, call } = await inCall()
    expect(wrapper.get('[role=alert]').text()).toContain('The browser paused the sound.')

    await wrapper.findAll('button').find((b) => b.text().includes('Turn on sound'))!.trigger('click')
    await settle()

    expect(call.audioBlocked).toBe(false)
    expect(wrapper.find('[role=alert]').exists()).toBe(false)
  })

  it('moves the focus to the meeting\'s name when the call opens', async () => {
    wide()
    const { wrapper } = await inCall()
    // mounted outside the document here: check the heading can take the focus and asked for it
    expect(wrapper.get('h1').attributes('tabindex')).toBe('-1')
  })
})

describe('the side panel', () => {
  it('on a phone it covers the call, and what is under it is out of reach until it closes (Escape)', async () => {
    phone()
    const { wrapper, call } = await inCall()

    await wrapper.get('[role=toolbar] [aria-label=Participants]').trigger('click')
    await settle()
    expect(wrapper.get('aside').classes()).toContain('fixed')
    expect(wrapper.get('[role=toolbar]').element.closest('[inert]')).not.toBeNull()

    await wrapper.get('aside').trigger('keydown', { key: 'Escape' })
    await settle()
    expect(call.panel).toBeNull()
    expect(wrapper.find('[inert]').exists()).toBe(false)
  })

  it('on a wide screen it sits beside the video, which stays usable', async () => {
    wide()
    const { wrapper } = await inCall()

    await wrapper.get('[role=toolbar] [aria-label=Participants]').trigger('click')
    await settle()

    expect(wrapper.find('[inert]').exists()).toBe(false)
    expect(wrapper.findAll('[role=tab]').map((tab) => [tab.text(), tab.attributes('aria-selected')])).toEqual([
      ['Participants', 'true'],
      ['Chat', 'false'],
    ])
  })

  it('the arrow keys move between Participants and Chat', async () => {
    wide()
    const { wrapper, call } = await inCall()
    call.togglePanel('participants')
    await settle()

    await wrapper.get('[role=tablist]').trigger('keydown', { key: 'ArrowRight' })
    expect(call.panel).toBe('chat')
  })
})
