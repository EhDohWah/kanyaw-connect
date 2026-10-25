import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { lastRoom, useFakeLiveKit } from '@/__tests__/fakeLiveKit'
import { CHAT_ID, ME, PAW, fakeApi, makeRoom, makeUser, person, restoreApi, settle, signIn } from '@/__tests__/helpers'
import { useAuthStore } from '@/stores/auth'
import { useDirectCallStore } from '@/stores/directCall'

const devices = vi.hoisted(() => ({ cameras: [] as { deviceId: string; label: string }[], speakers: [] as { deviceId: string; label: string }[], canPick: false }))
vi.mock('@/realtime/localMedia', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/realtime/localMedia')>()),
  listDevices: async (kind: string) => (kind === 'videoinput' ? devices.cameras : kind === 'audiooutput' ? devices.speakers : []),
  canPickSpeaker: () => devices.canPick,
}))

useFakeLiveKit()

beforeEach(() => {
  setActivePinia(createPinia())
  signIn()
  useAuthStore().user = makeUser({ id: ME })
  fakeApi((call) => {
    if (call.url.endsWith('/calls'))
      return { status: 201, data: { data: { id: 'c', chat_id: CHAT_ID, room_id: 'r', kind: 'video', status: 'ringing', end_reason: null, caller: person(ME, 'Me'), callee: person(PAW, 'Paw'), created_at: '', ring_expires_at: new Date(Date.now() + 45_000).toISOString(), answered_at: null, ended_at: null, duration_seconds: null } } }
    if (call.url === '/rooms/r/join') return { data: { status: 'admitted', token: 't', livekit_url: 'ws://lk', room: makeRoom({ id: 'r' }) } }
    return { data: {} }
  })
})

afterEach(() => {
  useDirectCallStore().reset()
  restoreApi()
})

describe('cameras and speakers', () => {
  it('Flip is offered with two cameras, and moves to the other one', async () => {
    devices.cameras = [{ deviceId: 'front', label: 'Front' }, { deviceId: 'back', label: 'Back' }]
    const call = useDirectCallStore()
    await call.start(CHAT_ID, 'video')
    await settle()
    expect(call.cameraCount).toBe(2)

    lastRoom().activeDevices.videoinput = 'front'
    await call.flipCamera()
    expect(lastRoom().activeDevices.videoinput).toBe('back')
    await call.flipCamera()
    expect(lastRoom().activeDevices.videoinput).toBe('front')
  })

  it('one camera: no Flip', async () => {
    devices.cameras = [{ deviceId: 'only', label: 'Only' }]
    const call = useDirectCallStore()
    await call.start(CHAT_ID, 'video')
    await settle()
    expect(call.cameraCount).toBe(1)
  })

  it('lists speakers only where the browser can switch them (setSinkId), and switches', async () => {
    devices.speakers = [{ deviceId: 'desk', label: 'Desk speakers' }, { deviceId: 'head', label: 'Headset' }]
    devices.canPick = false
    const call = useDirectCallStore()
    await call.start(CHAT_ID, 'video')
    await settle()
    expect(call.speakers).toEqual([])
    call.reset()

    devices.canPick = true
    await call.start(CHAT_ID, 'video')
    await settle()
    expect(call.speakers.map((speaker) => speaker.deviceId)).toEqual(['desk', 'head'])
    await call.chooseSpeaker('head')
    expect(lastRoom().activeDevices.audiooutput).toBe('head')
    expect(call.speakerId).toBe('head')
  })
})
