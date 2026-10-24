import { describe, expect, it } from 'vitest'

import { makeRoom, mountApp, person, signedInStores } from '@/__tests__/helpers'
import MeetingRow from '@/components/rooms/MeetingRow.vue'
import type { Room } from '@/types/room'

const row = (room: Room) => mountApp(MeetingRow, { props: { room }, prepare: (pinia) => signedInStores(pinia) })

describe('MeetingRow', () => {
  it('a scheduled meeting shows when it starts and who hosts it', async () => {
    const { wrapper } = await row(makeRoom({ host: person('x', 'Naw Paw Say'), host_id: 'x' }))

    expect(wrapper.get('time').attributes('datetime')).toBe(makeRoom().scheduled_at)
    expect(wrapper.text()).toContain('Hosted by Naw Paw Say')
    expect(wrapper.text()).not.toContain('Not started yet')
  })

  it('says "You are the host" for your own', async () => {
    const { wrapper } = await row(makeRoom())
    expect(wrapper.text()).toContain('You are the host')
  })

  it('an instant meeting nobody has joined says it has not started', async () => {
    const { wrapper } = await row(makeRoom({ type: 'instant', scheduled_at: null, status: 'waiting' }))
    expect(wrapper.text()).toContain('Not started yet')
  })

  it('a live meeting says so, with how many are in the call', async () => {
    const live = await row(makeRoom({ type: 'instant', scheduled_at: null, status: 'active', present_count: 3 }))
    expect(live.wrapper.text()).toContain('In progress · 3 in the call')

    const empty = await row(makeRoom({ status: 'active', present_count: 0 }))
    expect(empty.wrapper.text()).toContain('In progress')
    expect(empty.wrapper.text()).not.toContain('in the call')
  })

  it('shows a locked meeting as locked', async () => {
    const { wrapper } = await row(makeRoom({ is_locked: true }))
    expect(wrapper.text()).toContain('Locked')
    expect(wrapper.find('svg.lucide-lock').exists()).toBe(true)
  })
})
