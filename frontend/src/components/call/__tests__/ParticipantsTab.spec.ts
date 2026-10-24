import { Track } from 'livekit-client'
import { afterEach, describe, expect, it } from 'vitest'

import { lastRoom, useFakeLiveKit } from '@/__tests__/fakeLiveKit'
import { ME, PAW, fakeApi, makeRoom, mountApp, person, restoreApi, settle, signedInStores, type Call } from '@/__tests__/helpers'
import ParticipantsTab from '@/components/call/ParticipantsTab.vue'
import { realtime } from '@/realtime'
import { userChannelHandlers } from '@/realtime/handlers'
import { useCallStore } from '@/stores/call'
import { useUiStore } from '@/stores/ui'
import type { Room } from '@/types/room'

useFakeLiveKit()
afterEach(() => {
  restoreApi()
  realtime.disconnect()
})

const ROOM = makeRoom().id
const HTOO = '0195e2c4-0005-7a04-8104-5f3a9c007bbc'
const MU = '0195e2c4-0006-7a05-8105-5f3a9c009aab'
const waitingEntry = (id: string, name: string) => ({ user: person(id, name), user_id: id, role: 'participant' as const, admission: 'waiting' as const, joined_at: null, left_at: null })
type Reply = { status?: number; data?: unknown }

async function tab(room: Room = makeRoom(), control: (call: Call) => Reply = () => ({ data: {} })) {
  const api = fakeApi((call) => {
    if (call.method === 'get') return { data: { data: room } }
    if (call.url.endsWith('/join')) return { data: { status: 'admitted', token: 'lk', livekit_url: 'ws://lk', room } }
    return control(call)
  })
  const mounted = await mountApp(ParticipantsTab, {
    prepare: (pinia) => {
      signedInStores(pinia)
      realtime.connect('t', ME, userChannelHandlers(), { status: () => undefined, connected: () => undefined })
    },
  })
  const call = useCallStore()
  await call.open(ROOM)
  await call.join({ micOn: true, cameraOn: false })
  const livekit = lastRoom()
  livekit.addPerson(PAW, 'Naw Paw Say', { role: 'participant', joinedAt: 1 })
  const htoo = livekit.addPerson(HTOO, 'Saw Htoo', { role: 'co_host', joinedAt: 2 })
  livekit.mute(htoo, Track.Source.Microphone)
  await settle()
  return { ...mounted, call, api, livekit }
}

const dialog = () => document.body.querySelector<HTMLElement>('[role=dialog]')
const dialogButton = (text: string) => [...document.body.querySelectorAll<HTMLButtonElement>('[role=dialog] button')].find((b) => b.textContent?.trim() === text)
const controls = (api: { calls: Call[] }) => api.calls.filter((c) => c.method === 'post' && !c.url.endsWith('/join')).map((c) => [c.url, c.body])

describe('Participants', () => {
  it('lists everyone with their role and whether their microphone and camera are on', async () => {
    const { wrapper } = await tab()
    const rows = wrapper.findAll('#in-call-title + ul li')

    expect(wrapper.get('#in-call-title').text()).toBe('In the call (3)')
    expect(rows.map((row) => row.find('span.min-w-0').text())).toEqual(['Saw Eh Doh (you)Host', 'Naw Paw Say', 'Saw HtooCo-host'])
    expect(rows[2]!.find('[aria-label="Microphone off"]').exists()).toBe(true)
    expect(rows[0]!.find('[aria-label="Camera off"]').exists()).toBe(true)
  })

  it('the host gets an actions button for everyone but themselves', async () => {
    const { wrapper } = await tab()

    expect(wrapper.findAll('button[aria-label^="Actions for"]').map((b) => b.attributes('aria-label'))).toEqual(['Actions for Naw Paw Say', 'Actions for Saw Htoo'])
  })

  it('a co-host may act on participants only; a participant on nobody', async () => {
    const coHost = await tab(makeRoom({ host_id: MU, host: person(MU, 'Naw Mu'), my_participation: { role: 'co_host', admission: 'admitted' } }))
    expect(coHost.wrapper.findAll('button[aria-label^="Actions for"]').map((b) => b.attributes('aria-label'))).toEqual(['Actions for Naw Paw Say'])
    coHost.wrapper.unmount()
    await useCallStore().close()

    const guest = await tab(makeRoom({ host_id: MU, host: person(MU, 'Naw Mu'), my_participation: { role: 'participant', admission: 'admitted' } }))
    expect(guest.wrapper.findAll('button[aria-label^="Actions for"]')).toHaveLength(0)
    expect(guest.wrapper.find('[role=switch]').exists()).toBe(false) // no Lock
  })

  it('mutes a microphone, turns off a camera, says when it was already off', async () => {
    let muted = 1
    const { wrapper, api } = await tab(makeRoom(), () => ({ data: { data: { muted_tracks: muted } } }))

    await wrapper.get('[aria-label="Actions for Naw Paw Say"]').trigger('click')
    await settle(2)
    expect(dialog()?.querySelector('h2')?.textContent).toBe('Actions for Naw Paw Say')
    dialogButton('Mute microphone')!.click()
    await settle()
    expect(useUiStore().toasts.at(-1)?.message).toBe("Naw Paw Say's microphone is muted.")

    muted = 0
    await wrapper.get('[aria-label="Actions for Naw Paw Say"]').trigger('click')
    await settle(2)
    dialogButton('Turn off camera')!.click()
    await settle()
    expect(useUiStore().toasts.at(-1)?.message).toBe('That was already off.')

    expect(controls(api)).toEqual([
      [`/rooms/${ROOM}/participants/${PAW}/mute`, { kind: 'audio' }],
      [`/rooms/${ROOM}/participants/${PAW}/mute`, { kind: 'video' }],
    ])
  })

  it('only offers to mute what is on, "Make co-host" only to the host and only for participants', async () => {
    const { wrapper } = await tab()

    await wrapper.get('[aria-label="Actions for Saw Htoo"]').trigger('click') // a co-host, microphone already off
    await settle(2)
    expect(dialogButton('Mute microphone')).toBeUndefined()
    expect(dialogButton('Make co-host')).toBeUndefined()

    document.body.querySelector<HTMLButtonElement>('[role=dialog] [aria-label=Close]')?.click()
    await settle(2)
    await wrapper.get('[aria-label="Actions for Naw Paw Say"]').trigger('click')
    await settle(2)
    expect(dialogButton('Make co-host')).toBeDefined()
  })

  it('makes someone a co-host', async () => {
    const { wrapper, api, call } = await tab(makeRoom(), () => ({ data: { data: { ...waitingEntry(PAW, 'Naw Paw Say'), role: 'co_host', admission: 'admitted' } } }))

    await wrapper.get('[aria-label="Actions for Naw Paw Say"]').trigger('click')
    await settle(2)
    dialogButton('Make co-host')!.click()
    await settle()

    expect(controls(api)).toEqual([[`/rooms/${ROOM}/co-hosts/${PAW}`, undefined]])
    expect(call.roleOf(PAW)).toBe('co_host')
    expect(useUiStore().toasts.at(-1)?.message).toBe('Naw Paw Say is now a co-host.')
  })

  it('removing someone is asked twice', async () => {
    const { wrapper, api } = await tab(makeRoom(), () => ({ status: 204 }))

    await wrapper.get('[aria-label="Actions for Naw Paw Say"]').trigger('click')
    await settle(2)
    dialogButton('Remove from meeting')!.click()
    await settle(2)
    expect(dialog()?.textContent).toContain('Remove Naw Paw Say?')
    expect(controls(api)).toEqual([])

    dialogButton('Remove from meeting')!.click()
    await settle()
    expect(controls(api)).toEqual([[`/rooms/${ROOM}/participants/${PAW}/remove`, undefined]])
    expect(useUiStore().toasts.at(-1)?.message).toBe('Naw Paw Say was removed.')
  })

  it('a refused action says so', async () => {
    const { wrapper } = await tab(makeRoom(), () => ({ status: 409, data: { message: 'They are not in the call.', code: 'participant_not_connected' } }))

    await wrapper.get('[aria-label="Actions for Naw Paw Say"]').trigger('click')
    await settle(2)
    dialogButton('Mute microphone')!.click()
    await settle()

    expect(useUiStore().toasts.at(-1)).toMatchObject({ kind: 'error', message: 'They are not in the call.' })
  })
})

describe('Waiting to join, and Lock (host)', () => {
  it('lists who is waiting, and Admit / Deny let them in or turn them away', async () => {
    const room = makeRoom({ waiting_participants: [waitingEntry(MU, 'Naw Mu'), waitingEntry('w2', 'Saw Kler')] })
    const { wrapper, api } = await tab(room, (c) => ({ data: { data: waitingEntry(c.url.includes(MU) ? MU : 'w2', 'x') } }))
    expect(wrapper.get('#waiting-title').text()).toBe('Waiting to join (2)')

    await wrapper.get('[aria-label="Admit Naw Mu"]').trigger('click')
    await settle()
    await wrapper.get('[aria-label="Deny Saw Kler"]').trigger('click')
    await settle()

    expect(controls(api)).toEqual([
      [`/rooms/${ROOM}/admit/${MU}`, undefined],
      [`/rooms/${ROOM}/deny/w2`, undefined],
    ])
    expect(wrapper.find('#waiting-title').exists()).toBe(false)
    expect(useUiStore().toasts.at(-1)?.message).toBe('Naw Mu was let in.')
  })

  it('the host can lock the meeting', async () => {
    const { wrapper, api, call } = await tab(makeRoom(), () => ({ data: { data: makeRoom({ is_locked: true }) } }))
    const lock = wrapper.get('[role=switch]')
    expect(lock.attributes('aria-checked')).toBe('false')

    await lock.trigger('click')
    await settle()

    expect(controls(api)).toEqual([[`/rooms/${ROOM}/lock`, undefined]])
    expect(call.room?.is_locked).toBe(true)
    expect(wrapper.get('[role=switch]').attributes('aria-checked')).toBe('true')
  })
})
