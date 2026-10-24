import { ApiError } from '@/api/errors'
import { buildMockContent, type MockContent } from '@/mocks/feedData'
import { MAX_CAPTION_LENGTH, MAX_COMMENT_LENGTH, type FeedService } from '@/services/feed'
import type { CursorPage, FeedComment, FeedPost, LikeResult, NewPostInput } from '@/types/feed'
import type { PublicUser } from '@/types/user'
import { checkPostImage, PostImageError, shrinkToDataUrl } from '@/utils/postImage'
import { readStorage, writeStorage } from '@/utils/storage'
import { uuid } from '@/utils/uuid'

export const MOCK_FEED_KEY = 'kc.mock.feed'

/** What is kept in the browser between visits: what the person added or changed, never the sample posts themselves. */
interface Saved {
  v: 1
  /** Posts written on this device, newest first. */
  posts: FeedPost[]
  /** Comments written on this device, by post. */
  comments: Record<string, FeedComment[]>
  /** The posts each person (by user id) has liked. */
  likes: Record<string, string[]>
}

export interface MockFeedOptions {
  /** Who is writing and liking. There is no server to say, so the app tells the service. */
  currentUser: () => PublicUser | null
  /** How long a call takes, in milliseconds. By default a random 150 to 400. */
  delay?: () => number
  /** Where things are kept between visits. By default `localStorage`. */
  storage?: { read: () => string | null; write: (value: string) => boolean }
  now?: () => number
  pageSize?: number
  commentPageSize?: number
  /** Makes the small stored copy of a chosen picture. */
  imageToDataUrl?: (file: File) => Promise<string>
  origin?: () => string
}

const emptySaved = (): Saved => ({ v: 1, posts: [], comments: {}, likes: {} })

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Reads what was saved. Anything that is not what we wrote (old, damaged, edited by hand) is ignored, not trusted. */
function parseSaved(raw: string | null): Saved {
  if (!raw) return emptySaved()
  try {
    const data: unknown = JSON.parse(raw)
    if (!isRecord(data) || data.v !== 1) return emptySaved()

    const saved = emptySaved()
    if (Array.isArray(data.posts)) {
      saved.posts = data.posts.filter((post): post is FeedPost => isRecord(post) && typeof post.id === 'string' && typeof post.created_at === 'string' && isRecord(post.author) && typeof post.caption === 'string')
    }
    if (isRecord(data.comments)) {
      for (const [postId, list] of Object.entries(data.comments)) {
        if (Array.isArray(list)) saved.comments[postId] = list.filter((item): item is FeedComment => isRecord(item) && typeof item.id === 'string' && typeof item.created_at === 'string' && isRecord(item.author) && typeof item.content === 'string')
      }
    }
    if (isRecord(data.likes)) {
      for (const [userId, list] of Object.entries(data.likes)) {
        if (Array.isArray(list)) saved.likes[userId] = list.filter((id): id is string => typeof id === 'string')
      }
    }
    return saved
  } catch {
    return emptySaved()
  }
}

/** Newest first; the id breaks ties so the order never changes between calls. */
const newerFirst = (a: FeedPost, b: FeedPost): number =>
  a.created_at === b.created_at ? (a.id < b.id ? 1 : -1) : a.created_at < b.created_at ? 1 : -1

const olderFirst = (a: FeedComment, b: FeedComment): number =>
  a.created_at === b.created_at ? (a.id < b.id ? -1 : 1) : a.created_at < b.created_at ? -1 : 1

const cursorOf = (item: { created_at: string; id: string }): string => `${item.created_at}|${item.id}`

/**
 * A feed that lives in the browser: sample posts plus whatever this person adds. It behaves like a server would (it
 * answers after a short delay, in pages, with counts that agree), so loading states and failures can be seen and tested.
 */
export function createMockFeedService(options: MockFeedOptions): FeedService {
  const now = options.now ?? Date.now
  const delay = options.delay ?? ((): number => 150 + Math.round(Math.random() * 250))
  const storage = options.storage ?? { read: () => readStorage(MOCK_FEED_KEY), write: (value: string) => writeStorage(MOCK_FEED_KEY, value) }
  const pageSize = options.pageSize ?? 6
  const commentPageSize = options.commentPageSize ?? 10
  const toDataUrl = options.imageToDataUrl ?? shrinkToDataUrl
  const origin = options.origin ?? ((): string => window.location.origin)

  const content: MockContent = buildMockContent(now())
  let saved = parseSaved(storage.read())

  const wait = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, delay()))
  const me = (): PublicUser => {
    const user = options.currentUser()
    if (!user) throw new ApiError({ status: 401, message: 'Not signed in' })
    return user
  }
  const userKey = (): string => options.currentUser()?.id ?? ''

  /** Keeps what fits: if the browser refuses (storage is small), the oldest pictures go first, then the oldest posts. */
  function persist(): void {
    const attempt = (): boolean => storage.write(JSON.stringify(saved))
    if (attempt()) return

    const trimmed: Saved = { ...saved, posts: saved.posts.map((post) => ({ ...post })) }
    for (let index = trimmed.posts.length - 1; index >= 0; index -= 1) {
      const post = trimmed.posts[index]
      if (post?.image_url?.startsWith('data:')) {
        post.image_url = null
        saved = trimmed
        if (attempt()) return
      }
    }
    while (trimmed.posts.length > 0) {
      trimmed.posts.pop()
      saved = trimmed
      if (attempt()) return
    }
  }

  const likedSet = (): Set<string> => new Set(saved.likes[userKey()] ?? [])

  function present(post: FeedPost): FeedPost {
    const liked = likedSet().has(post.id)
    const base = content.baseLikes[post.id] ?? 0
    const own = saved.posts.some((candidate) => candidate.id === post.id)
    return {
      ...post,
      // Sample posts have likes from other people already; a post written here only has what this device added.
      like_count: (own ? 0 : base) + (liked ? 1 : 0),
      liked_by_me: liked,
      comment_count: (content.comments[post.id]?.length ?? 0) + (saved.comments[post.id]?.length ?? 0),
    }
  }

  const everyPost = (): FeedPost[] => [...saved.posts, ...content.posts].sort(newerFirst)

  function find(postId: string): FeedPost {
    const post = everyPost().find((candidate) => candidate.id === postId)
    if (!post) throw new ApiError({ status: 404, message: 'Post not found' })
    return post
  }

  function setLike(postId: string, liked: boolean): LikeResult {
    const post = find(postId)
    const mine = likedSet()
    if (liked) mine.add(postId)
    else mine.delete(postId)
    saved = { ...saved, likes: { ...saved.likes, [userKey()]: [...mine] } }
    persist()
    const { like_count, liked_by_me } = present(post)
    return { like_count, liked_by_me }
  }

  return {
    async listPosts(cursor): Promise<CursorPage<FeedPost>> {
      await wait()
      const all = everyPost()
      const start = cursor ? all.findIndex((post) => cursorOf(post) === cursor) + 1 : 0
      // A cursor that is no longer in the list (it was removed) would otherwise start over; stop instead.
      const page = cursor && start === 0 ? [] : all.slice(start, start + pageSize)
      const last = page.at(-1)
      const more = last !== undefined && start + pageSize < all.length
      return { data: page.map(present), next_cursor: more && last ? cursorOf(last) : null }
    },

    async createPost(input: NewPostInput): Promise<FeedPost> {
      await wait()
      const author = me()
      const caption = input.caption.trim()
      if (caption === '' && !input.image) throw new ApiError({ status: 422, message: 'A post needs a caption or a picture', fieldErrors: { caption: ['A post needs a caption or a picture'] } })
      if (caption.length > MAX_CAPTION_LENGTH) throw new ApiError({ status: 422, message: 'The caption is too long', fieldErrors: { caption: ['The caption is too long'] } })

      let image: string | null = null
      if (input.image) {
        try {
          checkPostImage(input.image)
          image = await toDataUrl(input.image)
        } catch (problem) {
          const message = problem instanceof PostImageError ? `The picture cannot be used (${problem.problem})` : 'The picture cannot be used'
          throw new ApiError({ status: 422, message, fieldErrors: { image: [message] } })
        }
      }

      const post: FeedPost = {
        id: `mock-post-${uuid()}`,
        author,
        caption,
        image_url: image,
        created_at: new Date(now()).toISOString(),
        like_count: 0,
        liked_by_me: false,
        comment_count: 0,
      }
      saved = { ...saved, posts: [post, ...saved.posts] }
      persist()
      return present(post)
    },

    async likePost(postId) {
      await wait()
      return setLike(postId, true)
    },

    async unlikePost(postId) {
      await wait()
      return setLike(postId, false)
    },

    async listComments(postId, cursor): Promise<CursorPage<FeedComment>> {
      await wait()
      find(postId)
      const all = [...(content.comments[postId] ?? []), ...(saved.comments[postId] ?? [])].sort(olderFirst)
      const start = cursor ? all.findIndex((comment) => cursorOf(comment) === cursor) + 1 : 0
      const page = cursor && start === 0 ? [] : all.slice(start, start + commentPageSize)
      const last = page.at(-1)
      const more = last !== undefined && start + commentPageSize < all.length
      return { data: page, next_cursor: more && last ? cursorOf(last) : null }
    },

    async addComment(postId, text): Promise<FeedComment> {
      await wait()
      const author = me()
      find(postId)
      const contentText = text.trim()
      if (contentText === '') throw new ApiError({ status: 422, message: 'A comment cannot be empty', fieldErrors: { content: ['A comment cannot be empty'] } })
      if (contentText.length > MAX_COMMENT_LENGTH) throw new ApiError({ status: 422, message: 'The comment is too long', fieldErrors: { content: ['The comment is too long'] } })

      const comment: FeedComment = {
        id: `mock-comment-${uuid()}`,
        post_id: postId,
        author,
        content: contentText,
        created_at: new Date(now()).toISOString(),
      }
      saved = { ...saved, comments: { ...saved.comments, [postId]: [...(saved.comments[postId] ?? []), comment] } }
      persist()
      return comment
    },

    postLink: (postId) => `${origin()}/?post=${encodeURIComponent(postId)}`,
  }
}
