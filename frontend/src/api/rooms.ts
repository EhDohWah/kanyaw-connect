import { http } from '@/api/http'
import type { Paginated, Single } from '@/types/api'
import type { JoinResult, MuteKind, NewRoom, Room, RoomFilter, RoomParticipant } from '@/types/room'

/** The limits of `POST /rooms` (docs/API.md, 3.7). */
export const ROOM_LIMITS = { name: 120, description: 1000, passwordMin: 4, passwordMax: 64, minPeople: 2, maxPeople: 100, defaultPeople: 50 } as const

/**
 * Rooms you host, were invited to or asked to join, that have not ended (newest first; `upcoming`: soonest first).
 * Pass `next` (a full URL from `links.next`) to load the following page.
 */
export async function listRooms(options: { filter?: RoomFilter; perPage?: number; next?: string } = {}): Promise<Paginated<Room>> {
  if (options.next) {
    const { data } = await http.get<Paginated<Room>>(options.next)
    return data
  }

  const { data } = await http.get<Paginated<Room>>('/rooms', {
    params: { ...(options.filter ? { filter: options.filter } : {}), ...(options.perPage ? { per_page: options.perPage } : {}) },
  })
  return data
}

export async function getRoom(roomId: string): Promise<Room> {
  const { data } = await http.get<Single<Room>>(`/rooms/${roomId}`)
  return data.data
}

/** Creates a room and makes you its host. Without `scheduled_at` it is an instant room. */
export async function createRoom(room: NewRoom): Promise<Room> {
  const { data } = await http.post<Single<Room>>('/rooms', room)
  return data.data
}

/**
 * Asks to join. Admitted: a LiveKit token (one hour). Waiting: the host has to let you in first. The password is only
 * needed the first time (the host, and people already admitted or waiting, are not asked again).
 */
export async function joinRoom(roomId: string, password?: string): Promise<JoinResult> {
  const { data } = await http.post<JoinResult>(`/rooms/${roomId}/join`, password ? { password } : {})
  return data
}

/* Host and co-host controls (docs/API.md, 3.8). */

/** docs/API.md shows these answers bare; the server wraps them in `data` like every other single object. Both work. */
function participantOf(body: RoomParticipant | Single<RoomParticipant>): RoomParticipant {
  return 'data' in body ? body.data : body
}

export async function admit(roomId: string, userId: string): Promise<RoomParticipant> {
  const { data } = await http.post<RoomParticipant | Single<RoomParticipant>>(`/rooms/${roomId}/admit/${userId}`)
  return participantOf(data)
}

export async function deny(roomId: string, userId: string): Promise<RoomParticipant> {
  const { data } = await http.post<RoomParticipant | Single<RoomParticipant>>(`/rooms/${roomId}/deny/${userId}`)
  return participantOf(data)
}

export async function removeParticipant(roomId: string, userId: string): Promise<void> {
  await http.post(`/rooms/${roomId}/participants/${userId}/remove`)
}

/** Returns how many tracks were muted (`0` when they were muted already). */
export async function muteParticipant(roomId: string, userId: string, kind: MuteKind): Promise<number> {
  const { data } = await http.post<Single<{ muted_tracks: number }>>(`/rooms/${roomId}/participants/${userId}/mute`, { kind })
  return data.data.muted_tracks
}

/** Host only. */
export async function makeCoHost(roomId: string, userId: string): Promise<RoomParticipant> {
  const { data } = await http.post<RoomParticipant | Single<RoomParticipant>>(`/rooms/${roomId}/co-hosts/${userId}`)
  return participantOf(data)
}

/** Host only: stop (`true`) or resume letting new people in. */
export async function setLocked(roomId: string, locked: boolean): Promise<Room> {
  const { data } = await http.post<Single<Room>>(`/rooms/${roomId}/${locked ? 'lock' : 'unlock'}`)
  return data.data
}

/** Host only: ends the meeting for everyone. */
export async function endRoom(roomId: string): Promise<Room> {
  const { data } = await http.post<Single<Room>>(`/rooms/${roomId}/end`)
  return data.data
}
