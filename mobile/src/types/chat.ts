// Ported from frontend/src/types/chat.ts. The send-draft and pending-message types come with the conversation (8C).
import type { PublicUser } from '@/types/user'

/** Mirrors the Chat, Message and Attachment objects of docs/API.md (section 2). */

export type ChatType = 'direct' | 'group'
export type MemberRole = 'owner' | 'admin' | 'member'
export type MessageType = 'text' | 'image' | 'file' | 'voice' | 'system'

export interface MyMembership {
  role: MemberRole
  joined_at: string
  last_read_message_id: string | null
  last_read_at: string | null
  is_muted: boolean
  muted_until: string | null
  is_archived: boolean
  pin_position: number | null
}

export interface ChatMember {
  user: PublicUser
  user_id: string
  role: MemberRole
  joined_at: string
}

export interface Attachment {
  id: string
  original_name: string
  mime_type: string
  size: number
  /** Signed, valid for 60 minutes. Fetch the message again for fresh ones. */
  url: string
  /** `null` for anything that is not a raster image, and for a moment after upload. */
  thumbnail_url: string | null
  created_at: string
}

/** A small preview of the message replied to. `content` is `null` when the original was deleted. */
export interface ReplyPreview {
  id: string
  sender_id: string | null
  type: MessageType
  content: string | null
  is_deleted: boolean
}

export interface Message {
  id: string
  chat_id: string
  /** `null` for system messages. */
  sender: PublicUser | null
  sender_id: string | null
  type: MessageType
  /** Text or caption. Always `null` in an encrypted chat. */
  content: string | null
  reply_to_id: string | null
  reply_to?: ReplyPreview | null
  /** Only on messages you sent (REST answers); real-time events never carry it. */
  client_id?: string
  is_edited: boolean
  edited_at: string | null
  metadata: Record<string, unknown>
  encrypted: boolean
  attachment: Attachment | null
  created_at: string
}

/** What a voice message says about itself, for the player to draw before anything is downloaded. */
export interface VoiceHints {
  durationMs: number
  /** 16–64 values of 0–255. */
  waveform: number[]
}

export interface Chat {
  id: string
  type: ChatType
  name: string | null
  description: string | null
  avatar_url: string | null
  is_encrypted: boolean
  member_count: number
  last_message_at: string | null
  created_at: string
  unread_count: number
  my_membership: MyMembership
  latest_message: Message | null
  /** Direct chats only. */
  other_user?: PublicUser
  /** Only on single-chat responses. */
  members?: ChatMember[]
}

/** The chat object inside `chat.updated` and `chat.member_added` events: nothing specific to one viewer. */
export interface ChatSummary {
  id: string
  type: ChatType
  name: string | null
  description: string | null
  avatar_url: string | null
  is_encrypted: boolean
  member_count: number
  last_message_at: string | null
}

export interface ReadReceipt {
  chat_id: string
  last_read_message_id: string
  last_read_at: string
  unread_count: number
}

/* ---------------------------------------------------------------------- real-time event payloads --- */

export interface MessageEvent {
  message: Message
}

export interface MessageDeletedEvent {
  chat_id: string
  message_id: string
}

export interface MessageReadEvent {
  chat_id: string
  user_id: string
  last_read_message_id: string
  last_read_at: string
}

export interface ChatUpdatedEvent {
  chat: ChatSummary
}

export interface ChatMemberAddedEvent {
  chat: ChatSummary
  user: PublicUser
}

export interface ChatMemberRemovedEvent {
  chat_id: string
  user_id: string
}

export interface TypingWhisper {
  user_id: string
  typing: boolean
}

/** Who is online: `GET /users/presence`. */
export interface PresenceEntry {
  id: string
  status: 'online' | 'away' | 'busy' | 'offline'
  last_seen_at: string | null
}
