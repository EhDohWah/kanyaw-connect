import { defineStore } from 'pinia'
import { ref } from 'vue'

import * as roomsApi from '@/api/rooms'
import { toApiError, type ApiError } from '@/api/errors'
import type { NewRoom, Room } from '@/types/room'

/** How many upcoming meetings the sidebar shows. */
export const UPCOMING_LIMIT = 5

export const useRoomsStore = defineStore('rooms', () => {
  const upcoming = ref<Room[]>([])
  const status = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const error = ref<ApiError | null>(null)
  let inFlight: Promise<void> | null = null

  /**
   * (Re)loads the meetings still to come, soonest first. Safe to call again at any time: a call while one is on its
   * way joins it, and a failed refresh does not blank a list that is already on screen.
   */
  function fetchUpcoming(): Promise<void> {
    if (inFlight) return inFlight

    if (status.value !== 'ready') status.value = 'loading'
    inFlight = roomsApi
      .listRooms({ filter: 'upcoming', perPage: UPCOMING_LIMIT })
      .then((page) => {
        upcoming.value = page.data.slice(0, UPCOMING_LIMIT)
        error.value = null
        status.value = 'ready'
      })
      .catch((problem: unknown) => {
        error.value = toApiError(problem)
        if (status.value !== 'ready') status.value = 'error'
      })
      .finally(() => {
        inFlight = null
      })
    return inFlight
  }

  /** Called when something suggests the list changed (a meeting was announced in a chat): only matters if it was ever shown. */
  function refreshIfLoaded(): void {
    if (status.value !== 'idle') void fetchUpcoming()
  }

  /** Starts a meeting. Throws `ApiError` when the server refuses. */
  async function create(room: NewRoom): Promise<Room> {
    try {
      return await roomsApi.createRoom(room)
    } catch (problem) {
      throw toApiError(problem)
    }
  }

  function reset(): void {
    upcoming.value = []
    status.value = 'idle'
    error.value = null
    inFlight = null
  }

  return { upcoming, status, error, fetchUpcoming, refreshIfLoaded, create, reset }
})
