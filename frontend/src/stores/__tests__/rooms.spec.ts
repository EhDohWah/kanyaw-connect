import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { deferred, fakeApi, makeRoom, page, restoreApi, settle } from '@/__tests__/helpers'
import { ApiError } from '@/api/errors'
import { UPCOMING_LIMIT, useRoomsStore } from '@/stores/rooms'

beforeEach(() => setActivePinia(createPinia()))
afterEach(restoreApi)

describe('upcoming meetings', () => {
  it('asks for the five that are next, and shows them in the order the server gave', async () => {
    const { calls } = fakeApi(() => ({ data: page([makeRoom({ id: 'a' }), makeRoom({ id: 'b' })]) }))
    const rooms = useRoomsStore()
    expect(rooms.status).toBe('idle')

    await rooms.fetchUpcoming()

    expect(calls[0]?.uri).toMatch(new RegExp(`/api/v1/rooms\\?filter=upcoming&per_page=${UPCOMING_LIMIT}$`))
    expect(rooms.status).toBe('ready')
    expect(rooms.upcoming.map((room) => room.id)).toEqual(['a', 'b'])
  })

  it('shows only as many as the sidebar has room for, even if the server sends more', async () => {
    fakeApi(() => ({ data: page(Array.from({ length: 8 }, (_unused, index) => makeRoom({ id: `r${index}` }))) }))
    const rooms = useRoomsStore()

    await rooms.fetchUpcoming()

    expect(rooms.upcoming).toHaveLength(UPCOMING_LIMIT)
  })

  it('says "loading" until the first answer', async () => {
    const wait = deferred<void>()
    fakeApi(async () => {
      await wait.promise
      return { data: page([]) }
    })
    const rooms = useRoomsStore()

    const loading = rooms.fetchUpcoming()
    expect(rooms.status).toBe('loading')
    wait.resolve()
    await loading

    expect(rooms.status).toBe('ready')
  })

  it('asks once when several places ask at the same moment', async () => {
    const { calls } = fakeApi(() => ({ data: page([]) }))
    const rooms = useRoomsStore()

    await Promise.all([rooms.fetchUpcoming(), rooms.fetchUpcoming(), rooms.fetchUpcoming()])
    await rooms.fetchUpcoming()

    expect(calls).toHaveLength(2)
  })

  it('says it failed, and recovers on the next try', async () => {
    let online = false
    fakeApi(() => (online ? { data: page([makeRoom()]) } : { network: true }))
    const rooms = useRoomsStore()

    await rooms.fetchUpcoming()
    expect(rooms.status).toBe('error')
    expect(rooms.error?.isNetwork).toBe(true)

    online = true
    await rooms.fetchUpcoming()
    expect(rooms.status).toBe('ready')
    expect(rooms.error).toBeNull()
    expect(rooms.upcoming).toHaveLength(1)
  })

  it('keeps the list on screen when a refresh fails', async () => {
    let online = true
    fakeApi(() => (online ? { data: page([makeRoom()]) } : { status: 500, data: { message: 'x' } }))
    const rooms = useRoomsStore()
    await rooms.fetchUpcoming()

    online = false
    await rooms.fetchUpcoming()

    expect(rooms.status).toBe('ready')
    expect(rooms.upcoming).toHaveLength(1)
    expect(rooms.error?.status).toBe(500)
  })

  it('refreshes after a meeting was announced only if the list was ever shown', async () => {
    const { calls } = fakeApi(() => ({ data: page([]) }))
    const rooms = useRoomsStore()

    rooms.refreshIfLoaded()
    await settle(2)
    expect(calls).toHaveLength(0)

    await rooms.fetchUpcoming()
    rooms.refreshIfLoaded()
    await settle(2)
    expect(calls).toHaveLength(2)
  })

  it('forgets everything on reset', async () => {
    fakeApi(() => ({ data: page([makeRoom()]) }))
    const rooms = useRoomsStore()
    await rooms.fetchUpcoming()

    rooms.reset()

    expect(rooms.upcoming).toEqual([])
    expect(rooms.status).toBe('idle')
  })
})

describe('starting a meeting', () => {
  it('creates the room and returns it', async () => {
    const { calls } = fakeApi(() => ({ status: 201, data: { data: makeRoom({ id: 'new', type: 'instant', scheduled_at: null }) } }))

    const room = await useRoomsStore().create({ name: 'Saw Eh Doh’s meeting' })

    expect(room.id).toBe('new')
    expect(calls[0]?.body).toEqual({ name: 'Saw Eh Doh’s meeting' })
  })

  it('throws an ApiError with the server’s reason when it is refused', async () => {
    fakeApi(() => ({ status: 422, data: { message: 'The name field is required.', errors: { name: ['The name field is required.'] } } }))

    const problem: unknown = await useRoomsStore().create({ name: '' }).catch((error: unknown) => error)

    expect(problem).toBeInstanceOf(ApiError)
    expect((problem as ApiError).fieldError('name')).toBe('The name field is required.')
  })
})
