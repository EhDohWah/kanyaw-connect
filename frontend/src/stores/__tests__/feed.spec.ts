import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/errors'
import { deferred, fakeFeed, makeComment, makePost } from '@/__tests__/helpers'
import { setFeedService } from '@/services'
import { useFeedStore } from '@/stores/feed'
import type { FeedPost, LikeResult } from '@/types/feed'

beforeEach(() => {
  setActivePinia(createPinia())
})

const posts = (...ids: string[]): FeedPost[] => ids.map((id) => makePost({ id }))
const network = (): ApiError => new ApiError({ status: 0, code: 'network', message: 'offline' })

describe('loading the feed', () => {
  it('starts empty, then shows the first page and remembers where the next one starts', async () => {
    setFeedService(fakeFeed({ listPosts: async () => ({ data: posts('a', 'b'), next_cursor: 'c1' }) }))
    const feed = useFeedStore()
    expect(feed.status).toBe('idle')

    await feed.load()

    expect(feed.status).toBe('ready')
    expect(feed.posts.map((post) => post.id)).toEqual(['a', 'b'])
    expect(feed.hasMore).toBe(true)
  })

  it('shows "loading" while it waits', async () => {
    const wait = deferred<{ data: FeedPost[]; next_cursor: null }>()
    setFeedService(fakeFeed({ listPosts: () => wait.promise }))
    const feed = useFeedStore()

    const loading = feed.load()
    expect(feed.status).toBe('loading')
    wait.resolve({ data: [], next_cursor: null })
    await loading

    expect(feed.status).toBe('ready')
  })

  it('does not ask again while the posts are shown or already on their way', async () => {
    const listPosts = vi.fn(async () => ({ data: posts('a'), next_cursor: null }))
    setFeedService(fakeFeed({ listPosts }))
    const feed = useFeedStore()

    await Promise.all([feed.load(), feed.load()])
    await feed.load()

    expect(listPosts).toHaveBeenCalledTimes(1)
  })

  it('says it failed, as an ApiError, and tries again on request', async () => {
    let fail = true
    setFeedService(fakeFeed({ listPosts: async () => (fail ? Promise.reject(network()) : { data: posts('a'), next_cursor: null }) }))
    const feed = useFeedStore()

    await feed.load()
    expect(feed.status).toBe('error')
    expect(feed.error?.isNetwork).toBe(true)

    fail = false
    await feed.reload()
    expect(feed.status).toBe('ready')
    expect(feed.error).toBeNull()
    expect(feed.posts).toHaveLength(1)
  })

  it('turns any thrown thing into an ApiError', async () => {
    setFeedService(fakeFeed({ listPosts: () => Promise.reject(new Error('boom')) }))
    const feed = useFeedStore()

    await feed.load()

    expect(feed.error).toBeInstanceOf(ApiError)
  })

  it('keeps the posts on screen when a refresh fails', async () => {
    let fail = false
    setFeedService(fakeFeed({ listPosts: async () => (fail ? Promise.reject(network()) : { data: posts('a'), next_cursor: null }) }))
    const feed = useFeedStore()
    await feed.load()

    fail = true
    await feed.reload()

    expect(feed.status).toBe('ready')
    expect(feed.posts).toHaveLength(1)
  })
})

describe('more posts', () => {
  const pages: Record<string, { data: FeedPost[]; next_cursor: string | null }> = {
    first: { data: posts('a', 'b'), next_cursor: 'c1' },
    c1: { data: posts('b', 'c'), next_cursor: 'c2' },
    c2: { data: posts('d'), next_cursor: null },
  }
  const serve = () => vi.fn(async (cursor?: string | null) => pages[cursor ?? 'first'] as { data: FeedPost[]; next_cursor: string | null })

  it('adds the next page after the posts shown, without showing one twice', async () => {
    const listPosts = serve()
    setFeedService(fakeFeed({ listPosts }))
    const feed = useFeedStore()
    await feed.load()

    await feed.loadMore()

    expect(listPosts).toHaveBeenLastCalledWith('c1')
    expect(feed.posts.map((post) => post.id)).toEqual(['a', 'b', 'c'])
  })

  it('stops at the end', async () => {
    const listPosts = serve()
    setFeedService(fakeFeed({ listPosts }))
    const feed = useFeedStore()
    await feed.load()
    await feed.loadMore()
    await feed.loadMore()
    expect(feed.hasMore).toBe(false)

    await feed.loadMore()

    expect(listPosts).toHaveBeenCalledTimes(3)
    expect(feed.posts.map((post) => post.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('asks once when asked twice at the same moment (scrolling fires often)', async () => {
    const wait = deferred<{ data: FeedPost[]; next_cursor: string | null }>()
    const listPosts = vi.fn(async (cursor?: string | null) => (cursor ? wait.promise : pages['first']!))
    setFeedService(fakeFeed({ listPosts }))
    const feed = useFeedStore()
    await feed.load()

    const one = feed.loadMore()
    const two = feed.loadMore()
    expect(feed.loadingMore).toBe(true)
    wait.resolve(pages['c1']!)
    await Promise.all([one, two])

    expect(listPosts).toHaveBeenCalledTimes(2)
    expect(feed.loadingMore).toBe(false)
  })

  it('does nothing before the first page has arrived', async () => {
    const listPosts = serve()
    setFeedService(fakeFeed({ listPosts }))

    await useFeedStore().loadMore()

    expect(listPosts).not.toHaveBeenCalled()
  })

  it('reports a failure without hiding what is shown, and the next try goes on from the same place', async () => {
    let fail = true
    const listPosts = vi.fn(async (cursor?: string | null) => {
      if (cursor && fail) throw network()
      return pages[cursor ?? 'first'] as { data: FeedPost[]; next_cursor: string | null }
    })
    setFeedService(fakeFeed({ listPosts }))
    const feed = useFeedStore()
    await feed.load()

    await feed.loadMore()
    expect(feed.loadMoreError?.isNetwork).toBe(true)
    expect(feed.posts).toHaveLength(2)
    expect(feed.status).toBe('ready')

    fail = false
    await feed.loadMore()
    expect(feed.loadMoreError).toBeNull()
    expect(feed.posts.map((post) => post.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('writing a post', () => {
  it('puts it at the top of what is shown, once', async () => {
    setFeedService(fakeFeed({ listPosts: async () => ({ data: posts('a'), next_cursor: null }), createPost: async () => makePost({ id: 'new' }) }))
    const feed = useFeedStore()
    await feed.load()

    await feed.createPost({ caption: 'Hello', image: null })
    await feed.createPost({ caption: 'Hello', image: null })

    expect(feed.posts.map((post) => post.id)).toEqual(['new', 'a'])
  })

  it('is not added to a feed that has not been loaded (it comes with the first page later)', async () => {
    setFeedService(fakeFeed())
    const feed = useFeedStore()

    const post = await feed.createPost({ caption: 'Hello', image: null })

    expect(post.id).toBe('post-new')
    expect(feed.posts).toEqual([])
  })

  it('throws an ApiError and changes nothing when it fails', async () => {
    setFeedService(fakeFeed({ createPost: () => Promise.reject(new ApiError({ status: 422, message: 'No' })) }))
    const feed = useFeedStore()
    await feed.load()

    await expect(feed.createPost({ caption: '', image: null })).rejects.toMatchObject({ status: 422 })
    expect(feed.posts).toHaveLength(1)
  })
})

describe('liking', () => {
  const setup = (over: Parameters<typeof fakeFeed>[0] = {}, post = makePost()) => {
    setFeedService(fakeFeed({ listPosts: async () => ({ data: [post], next_cursor: null }), ...over }))
    return useFeedStore()
  }

  it('shows the like at once, before the server has answered, and then takes the server’s count', async () => {
    const wait = deferred<LikeResult>()
    const feed = setup({ likePost: () => wait.promise })
    await feed.load()

    const saved = feed.toggleLike('post-1')
    expect(feed.posts[0]).toMatchObject({ liked_by_me: true, like_count: 19 })

    wait.resolve({ like_count: 25, liked_by_me: true })
    expect(await saved).toBe(true)
    expect(feed.posts[0]).toMatchObject({ liked_by_me: true, like_count: 25 })
  })

  it('takes a like back the same way, and the count never goes below zero', async () => {
    const feed = setup({ unlikePost: async () => ({ like_count: 0, liked_by_me: false }) }, makePost({ liked_by_me: true, like_count: 0 }))
    await feed.load()

    const saved = feed.toggleLike('post-1')
    expect(feed.posts[0]).toMatchObject({ liked_by_me: false, like_count: 0 })
    await saved
    expect(feed.posts[0]).toMatchObject({ liked_by_me: false, like_count: 0 })
  })

  it('puts the post back as it was, and says so, when the server refuses', async () => {
    const feed = setup({ likePost: () => Promise.reject(network()) })
    await feed.load()

    const saved = feed.toggleLike('post-1')
    expect(feed.posts[0]?.liked_by_me).toBe(true)

    expect(await saved).toBe(false)
    expect(feed.posts[0]).toMatchObject({ liked_by_me: false, like_count: 18 })
  })

  it('sends quick repeated taps one after the other, in order, and the screen settles on the last answer', async () => {
    const first = deferred<LikeResult>()
    const second = deferred<LikeResult>()
    const order: string[] = []
    const feed = setup({
      likePost: () => {
        order.push('like')
        return first.promise
      },
      unlikePost: () => {
        order.push('unlike')
        return second.promise
      },
    })
    await feed.load()

    const one = feed.toggleLike('post-1')
    const two = feed.toggleLike('post-1')
    await Promise.resolve()
    // the second request waits for the first
    expect(order).toEqual(['like'])
    expect(feed.posts[0]).toMatchObject({ liked_by_me: false, like_count: 18 })

    first.resolve({ like_count: 19, liked_by_me: true })
    await vi.waitFor(() => expect(order).toEqual(['like', 'unlike']))
    // the answer to the first tap does not flash on screen while the second is still going
    expect(feed.posts[0]?.liked_by_me).toBe(false)

    second.resolve({ like_count: 18, liked_by_me: false })
    expect(await Promise.all([one, two])).toEqual([true, true])
    expect(feed.posts[0]).toMatchObject({ liked_by_me: false, like_count: 18 })
  })

  it('when the last of several taps fails, goes back to what the server last confirmed, and says so once', async () => {
    let calls = 0
    const feed = setup({
      likePost: async () => {
        calls += 1
        return { like_count: 19, liked_by_me: true }
      },
      unlikePost: () => Promise.reject(network()),
    })
    await feed.load()

    const results = await Promise.all([feed.toggleLike('post-1'), feed.toggleLike('post-1')])

    expect(calls).toBe(1)
    expect(results.filter((saved) => !saved)).toHaveLength(1)
    expect(feed.posts[0]).toMatchObject({ liked_by_me: true, like_count: 19 })
  })

  it('can be tapped again after it has settled', async () => {
    const likePost = vi.fn(async () => ({ like_count: 19, liked_by_me: true }))
    const unlikePost = vi.fn(async () => ({ like_count: 18, liked_by_me: false }))
    const feed = setup({ likePost, unlikePost })
    await feed.load()

    await feed.toggleLike('post-1')
    await feed.toggleLike('post-1')

    expect(likePost).toHaveBeenCalledTimes(1)
    expect(unlikePost).toHaveBeenCalledTimes(1)
    expect(feed.posts[0]).toMatchObject({ liked_by_me: false, like_count: 18 })
  })

  it('is harmless for a post that is not shown', async () => {
    const likePost = vi.fn()
    const feed = setup({ likePost })
    await feed.load()

    expect(await feed.toggleLike('nope')).toBe(true)
    expect(likePost).not.toHaveBeenCalled()
  })

  it('does not break when the list is replaced while the request is out', async () => {
    const wait = deferred<LikeResult>()
    const feed = setup({ likePost: () => wait.promise })
    await feed.load()

    const saved = feed.toggleLike('post-1')
    feed.reset()
    wait.resolve({ like_count: 19, liked_by_me: true })

    expect(await saved).toBe(true)
    expect(feed.posts).toEqual([])
  })
})

describe('comments', () => {
  it('loads the first page when opened, and shows it as ready', async () => {
    const listComments = vi.fn(async () => ({ data: [makeComment()], next_cursor: 'k1' }))
    setFeedService(fakeFeed({ listComments }))
    const feed = useFeedStore()

    const opening = feed.openComments('post-1')
    expect(feed.threads['post-1']?.status).toBe('loading')
    await opening

    expect(feed.threads['post-1']).toMatchObject({ status: 'ready', nextCursor: 'k1' })
    expect(feed.threads['post-1']?.items).toHaveLength(1)
  })

  it('does not load them again when opened again, but does after a failure', async () => {
    let fail = true
    const listComments = vi.fn(async () => (fail ? Promise.reject(network()) : { data: [makeComment()], next_cursor: null }))
    setFeedService(fakeFeed({ listComments }))
    const feed = useFeedStore()

    await feed.openComments('post-1')
    expect(feed.threads['post-1']).toMatchObject({ status: 'error' })
    expect(feed.threads['post-1']?.error?.isNetwork).toBe(true)

    fail = false
    await feed.openComments('post-1')
    await feed.openComments('post-1')

    expect(feed.threads['post-1']?.status).toBe('ready')
    expect(listComments).toHaveBeenCalledTimes(2)
  })

  it('keeps one thread per post', async () => {
    const listComments = vi.fn(async (postId: string) => ({ data: [makeComment({ id: `c-${postId}`, post_id: postId })], next_cursor: null }))
    setFeedService(fakeFeed({ listComments }))
    const feed = useFeedStore()

    await feed.openComments('p1')
    await feed.openComments('p2')

    expect(feed.threads['p1']?.items[0]?.id).toBe('c-p1')
    expect(feed.threads['p2']?.items[0]?.id).toBe('c-p2')
  })

  it('shows more when asked, without repeating one, and stops at the end', async () => {
    const listComments = vi.fn(async (_postId: string, cursor?: string | null) =>
      cursor
        ? { data: [makeComment({ id: 'c1' }), makeComment({ id: 'c2' })], next_cursor: null }
        : { data: [makeComment({ id: 'c1' })], next_cursor: 'k1' },
    )
    setFeedService(fakeFeed({ listComments }))
    const feed = useFeedStore()
    await feed.openComments('post-1')

    await feed.loadMoreComments('post-1')
    await feed.loadMoreComments('post-1')

    expect(feed.threads['post-1']?.items.map((comment) => comment.id)).toEqual(['c1', 'c2'])
    expect(feed.threads['post-1']?.nextCursor).toBeNull()
    expect(listComments).toHaveBeenCalledTimes(2)
  })

  it('adds a comment to the end and counts it on the post', async () => {
    setFeedService(fakeFeed({ listPosts: async () => ({ data: [makePost({ comment_count: 2 })], next_cursor: null }) }))
    const feed = useFeedStore()
    await feed.load()
    await feed.openComments('post-1')

    const comment = await feed.addComment('post-1', 'See you there')

    expect(comment.content).toBe('See you there')
    expect(feed.threads['post-1']?.items.at(-1)?.id).toBe('comment-new')
    expect(feed.posts[0]?.comment_count).toBe(3)
  })

  it('throws an ApiError and changes nothing when the comment is refused', async () => {
    setFeedService(fakeFeed({ addComment: () => Promise.reject(new ApiError({ status: 429, message: 'Slow down' })) }))
    const feed = useFeedStore()
    await feed.load()
    await feed.openComments('post-1')

    await expect(feed.addComment('post-1', 'hi')).rejects.toMatchObject({ status: 429 })
    expect(feed.threads['post-1']?.items).toHaveLength(0)
    expect(feed.posts[0]?.comment_count).toBe(2)
  })
})

describe('the preview note and signing out', () => {
  it('can be dismissed, and comes back for the next person', async () => {
    setFeedService(fakeFeed())
    const feed = useFeedStore()
    expect(feed.noteDismissed).toBe(false)

    feed.dismissNote()
    expect(feed.noteDismissed).toBe(true)

    feed.reset()
    expect(feed.noteDismissed).toBe(false)
  })

  it('forgets everything on reset', async () => {
    setFeedService(fakeFeed())
    const feed = useFeedStore()
    await feed.load()
    await feed.openComments('post-1')

    feed.reset()

    expect(feed.posts).toEqual([])
    expect(feed.status).toBe('idle')
    expect(feed.threads).toEqual({})
    expect(feed.hasMore).toBe(false)
  })
})
