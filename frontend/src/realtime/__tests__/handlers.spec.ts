import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { person } from '@/__tests__/helpers'
import { userChannelHandlers } from '@/realtime/handlers'
import { useRoomsStore } from '@/stores/rooms'
import { useUiStore } from '@/stores/ui'

beforeEach(() => setActivePinia(createPinia()))

const summary = { id: 'r1', name: 'Committee', type: 'scheduled' as const, status: 'waiting' as const, host_id: 'h', chat_id: null, is_locked: false }

describe('room events on your own channel', () => {
  it('"let in" and "turned away" are passed on to the meeting screen', () => {
    const handlers = userChannelHandlers()

    handlers.roomAdmitted({ room: summary })
    expect(useRoomsStore().decision).toMatchObject({ roomId: 'r1', outcome: 'admitted' })

    handlers.roomDenied({ room: summary })
    expect(useRoomsStore().decision).toMatchObject({ roomId: 'r1', outcome: 'denied' })
  })

  it('someone waiting for a meeting you host: a toast when you are not in that meeting', () => {
    const handlers = userChannelHandlers()

    handlers.roomJoinRequested({ room_id: 'r1', user: person('p', 'Naw Paw Say') })

    expect(useRoomsStore().joinRequest?.event.user.name).toBe('Naw Paw Say')
    expect(useUiStore().toasts.at(-1)?.message).toBe('Naw Paw Say is waiting to be let in to your meeting.')
  })

  it('…and no toast inside that meeting (its Waiting list shows them)', () => {
    useRoomsStore().activeCallId = 'r1'
    const handlers = userChannelHandlers()

    handlers.roomJoinRequested({ room_id: 'r1', user: person('p', 'Naw Paw Say') })

    expect(useUiStore().toasts).toEqual([])
    expect(useRoomsStore().joinRequest).not.toBeNull()
  })
})
