import { http } from '@/api/http'
import type { Paginated, Single } from '@/types/api'
import type { NewRoom, Room, RoomFilter } from '@/types/room'

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
