import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { deferred, fakeApi, makeRoom, page, restoreApi, settle } from '@/__tests__/helpers'
import { ApiError } from '@/api/errors'
import { LIST_STALE_MS, UPCOMING_LIMIT, useRoomsStore } from '@/stores/rooms'

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

describe('the Meetings tabs', () => {
  it('loads a tab with its filter and keeps the next page address', async () => {
    const { calls } = fakeApi(() => ({ data: page([makeRoom({ id: 'a' })], 'http://api.test/api/v1/rooms?filter=hosting&cursor=2') }))
    const rooms = useRoomsStore()

    await rooms.fetchList('hosting')

    expect(calls[0]?.uri).toMatch(/\/api\/v1\/rooms\?filter=hosting$/)
    expect(rooms.lists.hosting).toMatchObject({ status: 'ready', nextUrl: 'http://api.test/api/v1/rooms?filter=hosting&cursor=2' })
    expect(rooms.lists.hosting.items.map((room) => room.id)).toEqual(['a'])
    expect(rooms.lists.invited.status).toBe('idle') // each tab on its own
  })

  it('"Show more" asks for the address the server gave and adds each meeting once', async () => {
    let call = 0
    const { calls } = fakeApi(() => {
      call += 1
      return call === 1
        ? { data: page([makeRoom({ id: 'a' }), makeRoom({ id: 'b' })], 'http://api.test/api/v1/rooms?filter=invited&cursor=2') }
        : { data: page([makeRoom({ id: 'b' }), makeRoom({ id: 'c' })]) } // b was created meanwhile and moved
    })
    const rooms = useRoomsStore()
    await rooms.fetchList('invited')

    await rooms.loadMoreList('invited')

    expect(calls[1]?.uri).toBe('http://api.test/api/v1/rooms?filter=invited&cursor=2')
    expect(rooms.lists.invited.items.map((room) => room.id)).toEqual(['a', 'b', 'c'])
    expect(rooms.lists.invited.nextUrl).toBeNull()
  })

  it('a failed "Show more" keeps the meetings and says so separately', async () => {
    let call = 0
    fakeApi(() => {
      call += 1
      return call === 1 ? { data: page([makeRoom({ id: 'a' })], 'http://api.test/next') } : { network: true }
    })
    const rooms = useRoomsStore()
    await rooms.fetchList('hosting')

    await rooms.loadMoreList('hosting')

    expect(rooms.lists.hosting.status).toBe('ready')
    expect(rooms.lists.hosting.items).toHaveLength(1)
    expect(rooms.lists.hosting.loadMoreError?.isNetwork).toBe(true)
    expect(rooms.lists.hosting.loadingMore).toBe(false)
  })

  it('a failed first load is an error; a failed refresh keeps what is on screen', async () => {
    let online = false
    fakeApi(() => (online ? { data: page([makeRoom({ id: 'a' })]) } : { status: 500, data: {} }))
    const rooms = useRoomsStore()

    await rooms.fetchList('upcoming')
    expect(rooms.lists.upcoming.status).toBe('error')

    online = true
    await rooms.fetchList('upcoming')
    online = false
    await rooms.fetchList('upcoming')

    expect(rooms.lists.upcoming.status).toBe('ready')
    expect(rooms.lists.upcoming.items).toHaveLength(1)
  })

  it('going back to a tab does not ask again within a minute', async () => {
    const { calls } = fakeApi(() => ({ data: page([makeRoom()]) }))
    const rooms = useRoomsStore()

    await rooms.ensureList('hosting')
    await rooms.ensureList('hosting', Date.now() + LIST_STALE_MS - 1000)
    expect(calls).toHaveLength(1)

    await rooms.ensureList('hosting', Date.now() + LIST_STALE_MS + 1)
    expect(calls).toHaveLength(2)
  })

  it('asking twice at once sends one request', async () => {
    const wait = deferred<void>()
    const { calls } = fakeApi(async () => {
      await wait.promise
      return { data: page([]) }
    })
    const rooms = useRoomsStore()

    const both = Promise.all([rooms.fetchList('hosting'), rooms.fetchList('hosting')])
    wait.resolve()
    await both

    expect(calls).toHaveLength(1)
  })

  it('a meeting you just made shows at once in Hosting and, when it has a time, in Upcoming in order', async () => {
    fakeApi((call) =>
      call.uri.includes('upcoming')
        ? { data: page([makeRoom({ id: 'soon', scheduled_at: '2026-03-15T09:00:00Z' }), makeRoom({ id: 'later', scheduled_at: '2026-03-20T09:00:00Z' })]) }
        : { data: page([makeRoom({ id: 'old' })]) },
    )
    const rooms = useRoomsStore()
    await Promise.all([rooms.fetchList('hosting'), rooms.fetchList('upcoming')])

    rooms.addCreated(makeRoom({ id: 'new', scheduled_at: '2026-03-17T09:00:00Z' }))
    rooms.addCreated(makeRoom({ id: 'new', scheduled_at: '2026-03-17T09:00:00Z' })) // twice: still once

    expect(rooms.lists.hosting.items.map((room) => room.id)).toEqual(['new', 'old'])
    expect(rooms.lists.upcoming.items.map((room) => room.id)).toEqual(['soon', 'new', 'later'])
  })

  it('an instant meeting goes in Hosting only (it has no time to be "upcoming")', async () => {
    fakeApi(() => ({ data: page([makeRoom({ id: 'old' })]) }))
    const rooms = useRoomsStore()
    await Promise.all([rooms.fetchList('hosting'), rooms.fetchList('upcoming')])

    rooms.addCreated(makeRoom({ id: 'now', type: 'instant', scheduled_at: null }))

    expect(rooms.lists.hosting.items.map((room) => room.id)).toEqual(['now', 'old'])
    expect(rooms.lists.upcoming.items.map((room) => room.id)).toEqual(['old'])
  })

  it('tabs never loaded stay unloaded (they will ask the server when shown)', () => {
    const rooms = useRoomsStore()

    rooms.addCreated(makeRoom({ id: 'soon' }))

    expect(rooms.lists.hosting).toMatchObject({ status: 'idle', items: [] })
    expect(rooms.lists.upcoming).toMatchObject({ status: 'idle', items: [] })
  })

  it('signing out empties every tab, and an answer still on its way for the previous person is dropped', async () => {
    const wait = deferred<void>()
    fakeApi(async () => {
      await wait.promise
      return { data: page([makeRoom({ id: 'theirs' })]) }
    })
    const rooms = useRoomsStore()

    const pending = rooms.fetchList('hosting')
    rooms.reset()
    wait.resolve()
    await pending
    await settle()

    expect(rooms.lists.hosting).toMatchObject({ status: 'idle', items: [] })
  })
})
