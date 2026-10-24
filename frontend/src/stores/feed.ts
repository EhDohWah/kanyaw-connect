import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'

import { toApiError, type ApiError } from '@/api/errors'
import { feedService } from '@/services'
import type { FeedComment, FeedPost, LikeResult, NewPostInput } from '@/types/feed'

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

/** The comments under one post, loaded when its drawer is opened. */
export interface CommentThread {
  items: FeedComment[]
  status: LoadStatus
  error: ApiError | null
  nextCursor: string | null
  loadingMore: boolean
}

/** Likes sent for one post that have not all been answered yet. */
interface LikeBurst {
  pending: number
  /** What the server last said (or, before it has said anything, how the post looked before the first tap). */
  confirmed: LikeResult
  /** Requests for one post go one after the other, in the order of the taps, so the server ends up in the state shown. */
  chain: Promise<void>
}

const newThread = (): CommentThread => ({ items: [], status: 'idle', error: null, nextCursor: null, loadingMore: false })

export const useFeedStore = defineStore('feed', () => {
  const posts = ref<FeedPost[]>([])
  const status = ref<LoadStatus>('idle')
  const error = ref<ApiError | null>(null)
  const nextCursor = ref<string | null>(null)
  const loadingMore = ref(false)
  /** A failed "load more" is shown at the end of the list, without hiding the posts already on screen. */
  const loadMoreError = ref<ApiError | null>(null)
  /** The "preview" note at the top: gone when dismissed, back at the next visit (so sample posts are never taken as real). */
  const noteDismissed = ref(false)
  const threads = reactive<Record<string, CommentThread>>({})
  const bursts = new Map<string, LikeBurst>()

  const hasMore = computed(() => nextCursor.value !== null)

  function find(postId: string): FeedPost | undefined {
    return posts.value.find((post) => post.id === postId)
  }

  /* ----------------------------------------------------------------------------------------- loading --- */

  /** The first page. Does nothing while one is already on its way or already shown; `reload` forces a new one. */
  async function load(): Promise<void> {
    if (status.value === 'loading' || status.value === 'ready') return
    await fetchFirstPage()
  }

  async function reload(): Promise<void> {
    if (status.value === 'loading') return
    await fetchFirstPage()
  }

  async function fetchFirstPage(): Promise<void> {
    // A refresh must not blank a list that is already on screen.
    if (status.value !== 'ready') status.value = 'loading'
    try {
      const page = await feedService().listPosts()
      posts.value = page.data
      nextCursor.value = page.next_cursor
      loadMoreError.value = null
      error.value = null
      status.value = 'ready'
    } catch (problem) {
      error.value = toApiError(problem)
      if (status.value !== 'ready') status.value = 'error'
    }
  }

  async function loadMore(): Promise<void> {
    if (status.value !== 'ready' || loadingMore.value || !hasMore.value) return

    loadingMore.value = true
    loadMoreError.value = null
    try {
      const page = await feedService().listPosts(nextCursor.value)
      const known = new Set(posts.value.map((post) => post.id))
      posts.value = [...posts.value, ...page.data.filter((post) => !known.has(post.id))]
      nextCursor.value = page.next_cursor
    } catch (problem) {
      loadMoreError.value = toApiError(problem)
    } finally {
      loadingMore.value = false
    }
  }

  /* ------------------------------------------------------------------------------------------ posting --- */

  /** Writes a post. It goes to the top of the feed if the feed is on screen; otherwise it is there the next time it loads. */
  async function createPost(input: NewPostInput): Promise<FeedPost> {
    let post: FeedPost
    try {
      post = await feedService().createPost(input)
    } catch (problem) {
      throw toApiError(problem)
    }
    if (status.value === 'ready') posts.value = [post, ...posts.value.filter((candidate) => candidate.id !== post.id)]
    return post
  }

  /* ------------------------------------------------------------------------------------------- likes --- */

  /**
   * Likes or unlikes at once on screen, then tells the server. Fast repeated taps are sent one after the other, and
   * the screen takes the server's numbers when the last answer is in. If the server refuses, the post goes back to how the
   * server last said it was and the result is `false`, once for the whole run of taps, so the screen can say so.
   */
  async function toggleLike(postId: string): Promise<boolean> {
    const post = find(postId)
    if (!post) return true

    const wantLiked = !post.liked_by_me
    let burst = bursts.get(postId)
    if (!burst) {
      burst = { pending: 0, confirmed: { like_count: post.like_count, liked_by_me: post.liked_by_me }, chain: Promise.resolve() }
      bursts.set(postId, burst)
    }

    post.liked_by_me = wantLiked
    post.like_count = Math.max(0, post.like_count + (wantLiked ? 1 : -1))

    const run = burst
    run.pending += 1
    let failed = false
    let succeeded = true

    run.chain = run.chain.then(async () => {
      try {
        const service = feedService()
        run.confirmed = await (wantLiked ? service.likePost(postId) : service.unlikePost(postId))
      } catch {
        failed = true
      } finally {
        run.pending -= 1
        if (run.pending === 0) {
          bursts.delete(postId)
          // Show what the server says. The post may have been dropped from the list meanwhile.
          const current = find(postId)
          if (current) {
            current.liked_by_me = run.confirmed.liked_by_me
            current.like_count = run.confirmed.like_count
          }
          if (failed) succeeded = false
        }
      }
    })

    await run.chain
    return succeeded
  }

  /* --------------------------------------------------------------------------------------- comments --- */

  /** The thread for a post (made empty on first use). Read back through the reactive object, not the one just assigned. */
  function thread(postId: string): CommentThread {
    if (!threads[postId]) threads[postId] = newThread()
    return threads[postId] as CommentThread
  }

  /** Loads the first page of comments when the drawer opens (and again after a failure). */
  async function openComments(postId: string): Promise<void> {
    const current = thread(postId)
    if (current.status === 'loading' || current.status === 'ready') return

    current.status = 'loading'
    current.error = null
    try {
      const page = await feedService().listComments(postId)
      current.items = page.data
      current.nextCursor = page.next_cursor
      current.status = 'ready'
    } catch (problem) {
      current.error = toApiError(problem)
      current.status = 'error'
    }
  }

  async function loadMoreComments(postId: string): Promise<void> {
    const current = thread(postId)
    if (current.status !== 'ready' || current.loadingMore || current.nextCursor === null) return

    current.loadingMore = true
    try {
      const page = await feedService().listComments(postId, current.nextCursor)
      const known = new Set(current.items.map((comment) => comment.id))
      current.items = [...current.items, ...page.data.filter((comment) => !known.has(comment.id))]
      current.nextCursor = page.next_cursor
    } catch (problem) {
      current.error = toApiError(problem)
    } finally {
      current.loadingMore = false
    }
  }

  /** Adds a comment (it appears when the server has it) and counts it on the post. Throws `ApiError` when it fails. */
  async function addComment(postId: string, content: string): Promise<FeedComment> {
    let comment: FeedComment
    try {
      comment = await feedService().addComment(postId, content)
    } catch (problem) {
      throw toApiError(problem)
    }

    const current = thread(postId)
    if (!current.items.some((item) => item.id === comment.id)) current.items = [...current.items, comment]
    const post = find(postId)
    if (post) post.comment_count += 1
    return comment
  }

  function dismissNote(): void {
    noteDismissed.value = true
  }

  /** Signing out: the next person starts clean. */
  function reset(): void {
    posts.value = []
    status.value = 'idle'
    error.value = null
    nextCursor.value = null
    loadingMore.value = false
    loadMoreError.value = null
    noteDismissed.value = false
    for (const key of Object.keys(threads)) delete threads[key]
    bursts.clear()
  }

  return {
    posts,
    status,
    error,
    nextCursor,
    loadingMore,
    loadMoreError,
    noteDismissed,
    threads,
    hasMore,
    find,
    load,
    reload,
    loadMore,
    createPost,
    toggleLike,
    thread,
    openComments,
    loadMoreComments,
    addComment,
    dismissNote,
    reset,
  }
})
