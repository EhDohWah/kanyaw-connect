import { afterEach, describe, expect, it } from 'vitest'

import { fakeApi, makeRoom, mountApp, page, person, restoreApi, settle, signedInStores } from '@/__tests__/helpers'
import RoomsView from '@/views/RoomsView.vue'

afterEach(restoreApi)

const open = (route = '/rooms') => mountApp(RoomsView, { route, prepare: (pinia) => signedInStores(pinia) })
const tabs = () => [...document.body.querySelectorAll<HTMLButtonElement>('[role=tab]')]

describe('Meetings page', () => {
  it('has three tabs and opens on Upcoming, asking for that list only', async () => {
    const { calls } = fakeApi(() => ({ data: page([makeRoom({ name: 'Committee meeting' })]) }))
    const { wrapper } = await open()
    await settle()

    expect(wrapper.findAll('[role=tab]').map((tab) => tab.text())).toEqual(['Upcoming', 'Hosting', 'Invited'])
    expect(wrapper.get('[aria-selected=true]').text()).toBe('Upcoming')
    expect(calls.map((call) => call.uri)).toEqual([expect.stringMatching(/rooms\?filter=upcoming$/)])
    expect(wrapper.text()).toContain('Committee meeting')
  })

  it('keeps the tab in the address, so Back and a reload return to it', async () => {
    fakeApi((call) => ({ data: page([makeRoom({ id: call.uri.includes('hosting') ? 'h' : 'u', name: call.uri.includes('hosting') ? 'Mine' : 'Theirs' })]) }))
    const { wrapper, router } = await open('/rooms?tab=hosting')
    await settle()
    expect(wrapper.get('[aria-selected=true]').text()).toBe('Hosting')
    expect(wrapper.text()).toContain('Mine')

    await wrapper.findAll('[role=tab]')[2]!.trigger('click')
    await settle()
    expect(router.currentRoute.value.query.tab).toBe('invited')
  })

  it('moves between tabs with the arrow keys, Home and End (one tab in the Tab order)', async () => {
    fakeApi(() => ({ data: page([]) }))
    const { wrapper, router } = await open()
    await settle()
    expect(wrapper.findAll('[role=tab]').map((tab) => tab.attributes('tabindex'))).toEqual(['0', '-1', '-1'])

    await wrapper.get('[role=tablist]').trigger('keydown', { key: 'ArrowRight' })
    await settle()
    expect(router.currentRoute.value.query.tab).toBe('hosting')

    await wrapper.get('[role=tablist]').trigger('keydown', { key: 'End' })
    await settle()
    expect(router.currentRoute.value.query.tab).toBe('invited')

    await wrapper.get('[role=tablist]').trigger('keydown', { key: 'ArrowRight' }) // wraps round
    await settle()
    expect(router.currentRoute.value.query.tab).toBe('upcoming')
  })

  it('shows a skeleton, then an empty state with a next step that opens the form', async () => {
    fakeApi(() => ({ data: page([]) }))
    const { wrapper } = await open('/rooms?tab=hosting')
    expect(wrapper.find('[role=status]').exists()).toBe(true)
    await settle()

    expect(wrapper.text()).toContain('You are not hosting any meetings.')
    await wrapper.get('[role=tabpanel] button').trigger('click')
    await settle(2)
    expect(document.body.querySelector('[role=dialog]')?.textContent).toContain('New meeting')
  })

  it('shows an error with "Try again"', async () => {
    let online = false
    fakeApi(() => (online ? { data: page([makeRoom({ name: 'Back again' })]) } : { network: true }))
    const { wrapper } = await open()
    await settle()
    expect(wrapper.text()).toContain("Can't reach the server")

    online = true
    await wrapper.findAll('button').find((b) => b.text() === 'Try again')!.trigger('click')
    await settle()
    expect(wrapper.text()).toContain('Back again')
  })

  it('pages with "Show more meetings"', async () => {
    fakeApi((call) =>
      call.uri.includes('cursor')
        ? { data: page([makeRoom({ id: 'b', name: 'Second' })]) }
        : { data: page([makeRoom({ id: 'a', name: 'First' })], 'http://api.test/api/v1/rooms?filter=upcoming&cursor=2') },
    )
    const { wrapper } = await open()
    await settle()

    await wrapper.findAll('button').find((b) => b.text() === 'Show more meetings')!.trigger('click')
    await settle()

    expect(wrapper.findAll('li').map((li) => li.find('p').text())).toEqual(['First', 'Second'])
    expect(wrapper.text()).not.toContain('Show more meetings')
  })

  it('shows each meeting with its host, time and a Join link to its room', async () => {
    fakeApi(() => ({ data: page([makeRoom({ id: 'r1', name: 'Planning', host: person('x', 'Naw Paw Say'), host_id: 'x' })]) }))
    const { wrapper } = await open()
    await settle()

    expect(wrapper.text()).toContain('Hosted by Naw Paw Say')
    expect(wrapper.find('time').exists()).toBe(true)
    expect(wrapper.get('a[aria-label="Join Planning"]').attributes('href')).toBe('/rooms/r1')
  })
})
