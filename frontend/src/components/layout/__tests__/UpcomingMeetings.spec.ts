import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'

import { ME, deferred, fakeApi, makeRoom, makeUser, mountApp, page, person, restoreApi, settle, signedInStores } from '@/__tests__/helpers'
import UpcomingMeetings from '@/components/layout/UpcomingMeetings.vue'
import { useRoomsStore } from '@/stores/rooms'
import type { Room } from '@/types/room'

afterEach(restoreApi)

async function open(rooms: Room[] | 'fail' | Promise<unknown> = [makeRoom()], active = true) {
  const { calls } = fakeApi(() => (rooms === 'fail' ? { status: 500, data: { message: 'x' } } : { data: page(Array.isArray(rooms) ? rooms : []) }))
  const isActive = ref(active)
  const Host = defineComponent({ setup: () => () => h(UpcomingMeetings, { active: isActive.value }) })
  const mounted = await mountApp(Host, { prepare: (pinia) => signedInStores(pinia, makeUser({ id: ME, timezone: 'Asia/Bangkok' })) })
  await settle(4)
  return { ...mounted, calls, isActive, rooms: () => useRoomsStore(mounted.pinia) }
}

describe('upcoming meetings', () => {
  it('shows each meeting with its name, when it starts in the person’s own time, and who hosts it', async () => {
    const { wrapper } = await open([makeRoom({ name: 'Committee meeting', scheduled_at: '2026-03-16T19:00:00.000000Z', host_id: 'someone', host: person('someone', 'Naw Paw Say') })])

    expect(wrapper.get('h2').text()).toBe('Upcoming meetings')
    const row = wrapper.get('li')
    expect(row.text()).toContain('Committee meeting')
    expect(row.get('time').text()).toMatch(/^Tue, Mar 17, 2:00\s?AM$/)
    expect(row.get('time').attributes('datetime')).toBe('2026-03-16T19:00:00.000000Z')
    expect(row.text()).toContain('Hosted by Naw Paw Say')
  })

  it('says "You are the host" for a meeting of your own', async () => {
    const { wrapper } = await open([makeRoom({ host_id: ME, host: person(ME, 'Saw Eh Doh') })])

    expect(wrapper.get('li').text()).toContain('You are the host')
    expect(wrapper.get('li').text()).not.toContain('Hosted by')
  })

  it('marks a meeting that has already started', async () => {
    const { wrapper } = await open([makeRoom({ status: 'active' })])

    expect(wrapper.get('li').text()).toContain('In progress')
  })

  it('has a Join link to the room, named for the meeting, big enough to tap', async () => {
    const { wrapper } = await open([makeRoom({ id: 'room-7', name: 'Committee meeting' })])

    const join = wrapper.get('li a')
    expect(join.attributes('href')).toBe('/rooms/room-7')
    expect(join.attributes('aria-label')).toBe('Join Committee meeting')
    expect(join.text()).toBe('Join')
    expect(join.classes()).toContain('min-h-11')
  })

  it('lists them in the order the server gave (soonest first)', async () => {
    const { wrapper } = await open([makeRoom({ id: 'a', name: 'First' }), makeRoom({ id: 'b', name: 'Second' })])

    expect(wrapper.findAll('li').map((item) => item.get('p').text())).toEqual(['First', 'Second'])
  })

  it('shows a loading state, then the list', async () => {
    const wait = deferred<void>()
    fakeApi(async () => {
      await wait.promise
      return { data: page([makeRoom()]) }
    })
    const isActive = ref(true)
    const Host = defineComponent({ setup: () => () => h(UpcomingMeetings, { active: isActive.value }) })
    const { wrapper } = await mountApp(Host, { prepare: (pinia) => signedInStores(pinia) })
    await settle(2)

    expect(wrapper.get('[role="status"]').text()).toContain('Loading…')
    wait.resolve()
    await settle(3)

    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(wrapper.findAll('li')).toHaveLength(1)
  })

  it('says there is nothing coming up, and what to do about it', async () => {
    const { wrapper } = await open([])

    expect(wrapper.text()).toContain('No meetings coming up.')
    expect(wrapper.text()).toContain('Start one from Create, or ask a host to invite you.')
  })

  it('says it failed, with "Try again" that asks again', async () => {
    const { wrapper, calls, rooms } = await open('fail')
    expect(wrapper.get('[role="alert"]').text()).toContain('Something went wrong on our side')
    expect(rooms().status).toBe('error')

    await wrapper.get('[role="alert"] button').trigger('click')
    await settle(3)

    expect(calls.filter((call) => call.url === '/rooms')).toHaveLength(2)
  })

  it('does not ask while it is not on screen, and asks when it is', async () => {
    const { calls, isActive } = await open([makeRoom()], false)
    expect(calls.filter((call) => call.url === '/rooms')).toHaveLength(0)

    isActive.value = true
    await settle(3)

    expect(calls.filter((call) => call.url === '/rooms')).toHaveLength(1)
  })
})

void vi
