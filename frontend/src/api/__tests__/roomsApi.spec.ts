import { afterEach, describe, expect, it } from 'vitest'

import { fakeApi, makeRoom, page, restoreApi } from '@/__tests__/helpers'
import { createRoom, getRoom, listRooms } from '@/api/rooms'

afterEach(restoreApi)

describe('rooms API', () => {
  it('asks for upcoming meetings with the filter and the page size', async () => {
    const { calls } = fakeApi(() => ({ data: page([makeRoom()]) }))

    const result = await listRooms({ filter: 'upcoming', perPage: 5 })

    expect(calls[0]?.method).toBe('get')
    expect(calls[0]?.uri).toMatch(/\/api\/v1\/rooms\?filter=upcoming&per_page=5$/)
    expect(result.data).toHaveLength(1)
  })

  it('asks for every room when no filter is given', async () => {
    const { calls } = fakeApi(() => ({ data: page([]) }))

    await listRooms()

    expect(calls[0]?.uri).toMatch(/\/api\/v1\/rooms$/)
  })

  it('follows the link to the next page as it is', async () => {
    const { calls } = fakeApi(() => ({ data: page([]) }))

    await listRooms({ next: 'http://localhost:8000/api/v1/rooms?cursor=abc' })

    expect(calls[0]?.uri).toBe('http://localhost:8000/api/v1/rooms?cursor=abc')
  })

  it('creates a room with the fields given, and returns the room', async () => {
    const { calls } = fakeApi(() => ({ status: 201, data: { data: makeRoom({ id: 'r1', type: 'instant' }) } }))

    const room = await createRoom({ name: 'Saw Eh Doh’s meeting' })

    expect(calls[0]).toMatchObject({ method: 'post', url: '/rooms', body: { name: 'Saw Eh Doh’s meeting' } })
    expect(room.id).toBe('r1')
  })

  it('reads one room', async () => {
    const { calls } = fakeApi(() => ({ data: { data: makeRoom({ id: 'r9' }) } }))

    expect((await getRoom('r9')).id).toBe('r9')
    expect(calls[0]?.url).toBe('/rooms/r9')
  })
})
