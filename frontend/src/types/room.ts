import type { PublicUser } from '@/types/user'

/** Mirrors the Room object of docs/API.md (section 2). */

export type RoomType = 'instant' | 'scheduled'
/** `waiting`: nobody has joined yet. */
export type RoomStatus = 'waiting' | 'active' | 'ended'
export type RoomRole = 'host' | 'co_host' | 'participant'
export type RoomAdmission = 'waiting' | 'admitted' | 'denied'

export interface RoomParticipant {
  user: PublicUser
  user_id: string
  role: RoomRole
  admission: RoomAdmission
  joined_at: string | null
  left_at: string | null
}

export interface Room {
  id: string
  type: RoomType
  name: string
  description: string | null
  host: PublicUser
  host_id: string
  /** The chat whose members were invited, if the room is linked to one. */
  chat_id: string | null
  has_password: boolean
  waiting_room_enabled: boolean
  is_locked: boolean
  max_participants: number
  scheduled_at: string | null
  duration_minutes: number | null
  status: RoomStatus
  started_at: string | null
  ended_at: string | null
  recording_enabled: boolean
  created_at: string
  /** People connected right now, according to LiveKit. */
  present_count: number
  /** `null` if you never asked to join. */
  my_participation: { role: RoomRole; admission: RoomAdmission } | null
  /** Only for the host and co-hosts. */
  waiting_participants?: RoomParticipant[]
}

export type RoomFilter = 'hosting' | 'invited' | 'upcoming'

/** What `POST /rooms` accepts. Everything but `name` is optional. */
export interface NewRoom {
  name: string
  description?: string
  scheduled_at?: string
  duration_minutes?: number
  chat_id?: string
  password?: string
  waiting_room_enabled?: boolean
  max_participants?: number
}
