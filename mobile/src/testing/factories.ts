// Ported from frontend/src/__tests__/helpers.ts.
import type { Reply } from '@/testing/fakeApi'
import type { Chat, ChatMember, MemberRole, Message } from '@/types/chat'
import type { PublicUser, User } from '@/types/user'

export const ME = '0195e2c4-0001-7a00-8100-5f3a9c000000'
export const PAW = '0195e2c4-0003-7a02-8102-5f3a9c003dde'
export const CHAT_ID = '0195e2c4-0004-7a03-8103-5f3a9c005ccd'

export function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: ME,
    name: 'Saw Eh Doh',
    email: 'eh@example.org',
    phone: null,
    email_verified_at: '2026-03-14T09:00:00.000000Z',
    avatar_url: null,
    avatar_thumb_url: null,
    status: 'online',
    last_seen_at: null,
    timezone: 'Asia/Bangkok',
    locale: 'en',
    settings: {},
    created_at: '2026-03-14T09:00:00.000000Z',
    ...overrides,
  }
}

export const LOGIN_REPLY = (user: User = makeUser(), expiresAt = '2099-01-01T00:00:00+00:00'): Reply => ({
  data: { token: '1|secret-token', expires_at: expiresAt, user },
})

export function person(id: string, name: string): PublicUser {
  return { id, name, avatar_url: null, avatar_thumb_url: null }
}

let counter = 0

/** Messages made in a row get increasing ids and times, like real ones. */
export function makeMessage(overrides: Partial<Message> = {}): Message {
  counter += 1
  const n = String(counter).padStart(6, '0')
  const sender =
    overrides.sender_id === undefined || overrides.sender_id === PAW
      ? person(PAW, 'Naw Paw Say')
      : person(ME, 'Saw Eh Doh')
  return {
    id: `0195e2c4-${n}-7a00-8100-5f3a9c000000`,
    chat_id: CHAT_ID,
    sender,
    sender_id: sender.id,
    type: 'text',
    content: `Message ${counter}`,
    reply_to_id: null,
    reply_to: null,
    is_edited: false,
    edited_at: null,
    metadata: {},
    encrypted: false,
    attachment: null,
    created_at: `2026-03-14T09:${String(Math.floor(counter / 60)).padStart(2, '0')}:${String(counter % 60).padStart(2, '0')}.000000Z`,
    ...overrides,
  }
}

export function makeMember(user: PublicUser, role: MemberRole = 'member'): ChatMember {
  return { user, user_id: user.id, role, joined_at: '2026-03-14T09:00:00.000000Z' }
}

export function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: CHAT_ID,
    type: 'direct',
    name: null,
    description: null,
    avatar_url: null,
    is_encrypted: false,
    member_count: 2,
    last_message_at: '2026-03-14T09:00:46.209458Z',
    created_at: '2026-03-14T09:00:00.000000Z',
    unread_count: 0,
    my_membership: {
      role: 'member',
      joined_at: '2026-03-14T09:00:00.000000Z',
      last_read_message_id: null,
      last_read_at: null,
      is_muted: false,
      muted_until: null,
      is_archived: false,
      pin_position: null,
    },
    latest_message: null,
    other_user: person(PAW, 'Naw Paw Say'),
    ...overrides,
  }
}

/** One page of a cursor-paginated list, as the API sends it. */
export function page<T>(data: T[], next: string | null = null) {
  return {
    data,
    links: { first: null, last: null, prev: null, next },
    meta: { path: '', per_page: 30, next_cursor: null, prev_cursor: null },
  }
}
