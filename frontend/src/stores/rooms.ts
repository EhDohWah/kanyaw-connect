import { defineStore } from 'pinia'
import { reactive, ref } from 'vue'

import * as roomsApi from '@/api/rooms'
import { toApiError, type ApiError } from '@/api/errors'
import type { NewRoom, Room, RoomFilter, RoomJoinRequestedEvent } from '@/types/room'

/** How many upcoming meetings the sidebar shows. */
export const UPCOMING_LIMIT = 5

/** The tabs of the Meetings page, in order. */
export const MEETING_TABS: readonly RoomFilter[] = ['upcoming', 'hosting', 'invited']

/** One tab of the Meetings page: a list loaded page by page. */
export interface MeetingList {
  items: Room[]
  nextUrl: string | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: ApiError | null
  loadingMore: boolean
  /** "Show more" failed: shown under the button, the meetings already listed stay. */
  loadMoreError: ApiError | null
  /** When the first page last arrived (ms), so going back to a tab does not ask again straight away. */
  fetchedAt: number
}

/** Going back to a tab asks the server again only after this long. */
export const LIST_STALE_MS = 60 * 1000

const emptyList = (): MeetingList => ({ items: [], nextUrl: null, status: 'idle', error: null, loadingMore: false, loadMoreError: null, fetchedAt: 0 })

/** Soonest first; a room without a time (it cannot be in "upcoming") goes last. */
const bySchedule = (a: Room, b: Room): number => (a.scheduled_at ?? '\uffff').localeCompare(b.scheduled_at ?? '\uffff')

export const useRoomsStore = defineStore('rooms', () => {
  const upcoming = ref<Room[]>([])
  const status = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const error = ref<ApiError | null>(null)
  let inFlight: Promise<void> | null = null

  /**
   * The last "let in" / "turned away" for you (`room.admitted` / `room.denied` on your own channel). The call screen,
   * loaded only when a meeting is opened, reacts to it.
   */
  const decision = ref<{ roomId: string; outcome: 'admitted' | 'denied'; at: number } | null>(null)
  /** The last "someone is waiting to be let in" for a room you host or co-host (on your own channel). */
  const joinRequest = ref<{ event: RoomJoinRequestedEvent; at: number } | null>(null)
  /** The meeting open on screen in this tab (pre-join or call), if any. */
  const activeCallId = ref<string | null>(null)

  const lists = reactive<Record<RoomFilter, MeetingList>>({ upcoming: emptyList(), hosting: emptyList(), invited: emptyList() })
  const listRequests = new Map<RoomFilter, Promise<void>>()
  /** Goes up on sign-out: an answer for the previous person must not land in the next person's lists. */
  let generation = 0

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

  /**
   * (Re)loads the first page of a Meetings tab. A call while one is on its way joins it; a failed refresh keeps a list
   * that is already on screen.
   */
  function fetchList(filter: RoomFilter): Promise<void> {
    const running = listRequests.get(filter)
    if (running) return running

    const list = lists[filter]
    const asked = generation
    if (list.status !== 'ready') list.status = 'loading'
    const request = roomsApi
      .listRooms({ filter })
      .then((page) => {
        if (asked !== generation) return
        list.items = page.data
        list.nextUrl = page.links.next
        list.error = null
        list.loadMoreError = null
        list.status = 'ready'
        list.fetchedAt = Date.now()
      })
      .catch((problem: unknown) => {
        if (asked !== generation) return
        list.error = toApiError(problem)
        if (list.status !== 'ready') list.status = 'error'
      })
      .finally(() => listRequests.delete(filter))
    listRequests.set(filter, request)
    return request
  }

  /** A tab came on screen: load it unless what is shown is recent. */
  function ensureList(filter: RoomFilter, now: number = Date.now()): Promise<void> {
    const list = lists[filter]
    if (list.status === 'ready' && now - list.fetchedAt < LIST_STALE_MS) return Promise.resolve()
    return fetchList(filter)
  }

  /** The next page of a tab ("Show more"), added below, each meeting once. */
  async function loadMoreList(filter: RoomFilter): Promise<void> {
    const list = lists[filter]
    if (!list.nextUrl || list.loadingMore) return

    const asked = generation
    list.loadingMore = true
    list.loadMoreError = null
    try {
      const page = await roomsApi.listRooms({ next: list.nextUrl })
      if (asked !== generation) return
      const known = new Set(list.items.map((room) => room.id))
      list.items = [...list.items, ...page.data.filter((room) => !known.has(room.id))]
      list.nextUrl = page.links.next
    } catch (problem) {
      if (asked === generation) list.loadMoreError = toApiError(problem)
    } finally {
      if (asked === generation) list.loadingMore = false
    }
  }

  /** A meeting you just made: shown at once in the tabs it belongs to (when they were loaded), and in the sidebar. */
  function addCreated(room: Room): void {
    const hosting = lists.hosting
    if (hosting.status === 'ready' && !hosting.items.some((item) => item.id === room.id)) hosting.items = [room, ...hosting.items]

    const upcomingTab = lists.upcoming
    if (room.scheduled_at && upcomingTab.status === 'ready' && !upcomingTab.items.some((item) => item.id === room.id)) {
      upcomingTab.items = [...upcomingTab.items, room].sort(bySchedule)
    }
    if (room.scheduled_at) refreshIfLoaded()
  }

  /** Starts a meeting. Throws `ApiError` when the server refuses. */
  async function create(room: NewRoom): Promise<Room> {
    try {
      return await roomsApi.createRoom(room)
    } catch (problem) {
      throw toApiError(problem)
    }
  }

  function noteDecision(roomId: string, outcome: 'admitted' | 'denied'): void {
    decision.value = { roomId, outcome, at: Date.now() }
  }

  function noteJoinRequest(event: RoomJoinRequestedEvent): void {
    joinRequest.value = { event, at: Date.now() }
  }

  function reset(): void {
    decision.value = null
    joinRequest.value = null
    activeCallId.value = null
    upcoming.value = []
    status.value = 'idle'
    error.value = null
    inFlight = null
    generation += 1
    for (const filter of MEETING_TABS) Object.assign(lists[filter], emptyList())
    listRequests.clear()
  }

  return {
    upcoming,
    status,
    error,
    lists,
    decision,
    joinRequest,
    activeCallId,
    noteDecision,
    noteJoinRequest,
    fetchUpcoming, refreshIfLoaded, fetchList, ensureList,
    loadMoreList,
    addCreated,
    create,
    reset,
  }
})
