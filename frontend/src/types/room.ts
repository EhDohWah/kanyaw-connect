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

/** `POST /rooms/{room}/join` succeeded: connect to LiveKit with these, or wait for the host. */
export type JoinResult =
  | { status: 'admitted'; token: string; livekit_url: string; room: Room }
  | { status: 'waiting' }

/** What `POST /rooms/{room}/participants/{user}/mute` mutes. */
export type MuteKind = 'audio' | 'video'

/** The short room summary in `room.admitted` and `room.denied` (docs/API.md, 4.3). */
export interface RoomSummary {
  id: string
  name: string
  type: RoomType
  status: RoomStatus
  host_id: string
  chat_id: string | null
  is_locked: boolean
}

/** `room.admitted` / `room.denied` on your own user channel. */
export interface RoomDecisionEvent {
  room: RoomSummary
}

/** `room.join_requested`: someone is waiting to be let in (to hosts and co-hosts). */
export interface RoomJoinRequestedEvent {
  room_id: string
  user: PublicUser
}

/** `room.participant_joined` / `room.participant_left` on the room's presence channel. */
export interface RoomPresenceEvent {
  room_id: string
  user: PublicUser
  role: RoomRole
}

/** `room.role_changed`: `role` is the new role of `user_id`; `host_id` is the host now. */
export interface RoomRoleChangedEvent {
  room_id: string
  user_id: string
  role: RoomRole
  host_id: string
}

/** `room.ended`. */
export interface RoomEndedEvent {
  room_id: string
  ended_at: string
}
