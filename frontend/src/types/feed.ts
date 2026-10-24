import type { PublicUser } from '@/types/user'

/**
 * The shapes a feed endpoint would return. The backend has none yet (docs/API.md has no posts, likes or comments), so
 * these are ours: they follow the conventions of the real API (UUID-like ids, ISO times, cursor pages, `PublicUser`
 * for people) so that switching to real endpoints later does not change the components.
 */

export interface FeedPost {
  id: string
  author: PublicUser
  caption: string
  /** An address, or a `data:` address for a post written on this device; `null` for a post that is only text. */
  image_url: string | null
  created_at: string
  like_count: number
  liked_by_me: boolean
  comment_count: number
}

export interface FeedComment {
  id: string
  post_id: string
  author: PublicUser
  content: string
  created_at: string
}

/** A page of a list. `next_cursor` is opaque: pass it back as it is; `null` means there is no more. */
export interface CursorPage<T> {
  data: T[]
  next_cursor: string | null
}

export interface NewPostInput {
  caption: string
  image: File | null
}

/** What the server says about a post after a like or an unlike. */
export interface LikeResult {
  like_count: number
  liked_by_me: boolean
}
