import { afterEach, describe, expect, it, vi } from 'vitest'

import { useFakeLiveKit } from '@/__tests__/fakeLiveKit'
import { CHAT_ID, ME, PAW, fakeApi, makeRoom, mountApp, person, restoreApi, settle, signedInStores, type Call } from '@/__tests__/helpers'
import { tabLeader } from '@/realtime/tabLeader'
import { useDirectCallStore } from '@/stores/directCall'
import type { DirectCall } from '@/types/call'
import CallView from '@/views/CallView.vue'

useFakeLiveKit()

const CALL = '0195e2c4-0030-7a2f-812f-5f3a9c05ade1'

function incoming(over: Partial<DirectCall> = {}): DirectCall {
  return {
    id: CALL, chat_id: CHAT_ID, room_id: 'room', kind: 'voice', status: 'ringing', end_reason: null,
    caller: person(PAW, 'Naw Paw'), callee: person(ME, 'Saw Eh Doh'),
    created_at: new Date().toISOString(), ring_expires_at: new Date(Date.now() + 45_000).toISOString(),
    answered_at: null, ended_at: null, duration_seconds: null,
    ...over,
  }
}

function serve(call: DirectCall | null): { calls: Call[] } {
  return fakeApi((request) => {
    if (request.url === `/calls/${CALL}`) return call ? { data: { data: call } } : { status: 404, data: { message: 'Not found.' } }
    if (request.url.endsWith('/accept')) return { data: { data: incoming({ status: 'ongoing', answered_at: new Date().toISOString() }) } }
    if (request.url === '/rooms/room/join') return { data: { status: 'admitted', token: 't', livekit_url: 'ws://lk', room: makeRoom({ id: 'room' }) } }
    return { data: { data: [] , links: {}, meta: {} } }
  })
}

afterEach(() => {
  useDirectCallStore().reset()
  restoreApi()
})

const open = (path: string) => mountApp(CallView, { route: path, prepare: (pinia) => signedInStores(pinia) })

describe('/calls/:id', () => {
  it('hands a ringing call to the call screen', async () => {
    tabLeader.leader.value = true
    serve(incoming())
    await open(`/calls/${CALL}`)
    await settle()

    expect(useDirectCallStore().phase).toBe('incoming')
  })

  it('?answer=1 (the notification\'s Answer button) answers it', async () => {
    const { calls } = serve(incoming())
    await open(`/calls/${CALL}?answer=1`)
    await settle(10)

    expect(calls.map((c) => c.url)).toContain(`/calls/${CALL}/accept`)
    expect(useDirectCallStore().phase).toBe('active')
  })

  it('a call that is over goes on to its chat', async () => {
    serve(incoming({ status: 'missed', end_reason: 'cancelled' }))
    const { router } = await open(`/calls/${CALL}`)
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe(`/chats/${CHAT_ID}`))
  })

  it('an unknown call says so', async () => {
    serve(null)
    const { wrapper } = await open(`/calls/${CALL}`)
    await settle()
    expect(wrapper.text()).toContain('This call could not be found.')
  })

  it('once the call ends here, goes on to the chat', async () => {
    serve(incoming())
    const { router } = await open(`/calls/${CALL}`)
    await settle()

    useDirectCallStore().decline()
    useDirectCallStore().dismiss()
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe(`/chats/${CHAT_ID}`))
  })
})
