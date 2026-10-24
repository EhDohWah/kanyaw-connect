import type { CursorPage, FeedComment, FeedPost, LikeResult, NewPostInput } from '@/types/feed'

/**
 * Everything the feed needs from a server. The components and the store talk to this and nothing else, so the sample
 * posts (`src/mocks/`) can be replaced by real endpoints without touching them.
 */
export interface FeedService {
  /** Newest first. Pass the previous page's `next_cursor` for the next one. */
  listPosts(cursor?: string | null): Promise<CursorPage<FeedPost>>
  createPost(input: NewPostInput): Promise<FeedPost>
  /** Both are safe to repeat: they say how things are now, whatever they were before. */
  likePost(postId: string): Promise<LikeResult>
  unlikePost(postId: string): Promise<LikeResult>
  /** Oldest first. */
  listComments(postId: string, cursor?: string | null): Promise<CursorPage<FeedComment>>
  addComment(postId: string, content: string): Promise<FeedComment>
  /** The address "Share" hands out. */
  postLink(postId: string): string
}

export type FeedSource = 'mock' | 'api'

/** The longest caption and comment we accept (a real API will have its own limits). */
export const MAX_CAPTION_LENGTH = 2000
export const MAX_COMMENT_LENGTH = 1000
