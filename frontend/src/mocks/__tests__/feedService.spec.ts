import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/errors'
import { buildMockContent, MOCK_PEOPLE } from '@/mocks/feedData'
import { createMockFeedService, MOCK_FEED_KEY, type MockFeedOptions } from '@/mocks/feedService'
import type { FeedService } from '@/services/feed'
import type { FeedComment, FeedPost } from '@/types/feed'
import type { PublicUser } from '@/types/user'

const NOW = Date.parse('2026-03-14T12:00:00Z')
const ME: PublicUser = { id: 'user-me', name: 'Saw Eh Doh', avatar_url: null, avatar_thumb_url: null }
const OTHER: PublicUser = { id: 'user-other', name: 'Naw Paw Say', avatar_url: null, avatar_thumb_url: null }

/** Browser storage as a plain object; `limit` makes it "full" for values longer than that. */
function memory(initial: string | null = null, limit = Number.POSITIVE_INFINITY) {
  const box = { value: initial, writes: 0 }
  return {
    box,
    read: () => box.value,
    write: (value: string) => {
      if (value.length > limit) return false
      box.value = value
      box.writes += 1
      return true
    },
  }
}

function make(options: Partial<MockFeedOptions> = {}, storage = memory()) {
  let user: PublicUser | null = ME
  const service = createMockFeedService({
    currentUser: () => user,
    delay: () => 0,
    now: () => NOW,
    storage,
    imageToDataUrl: async () => 'data:image/jpeg;base64,SMALL',
    origin: () => 'https://kanyaw.example',
    ...options,
  })
  return { service, storage, signInAs: (next: PublicUser | null) => (user = next) }
}

async function everyPost(service: FeedService, from: string | null = null): Promise<FeedPost[]> {
  const found: FeedPost[] = []
  let cursor = from
  do {
    const page = await service.listPosts(cursor)
    found.push(...page.data)
    cursor = page.next_cursor
  } while (cursor)
  return found
}

afterEach(() => {
  vi.useRealTimers()
})

describe('the sample content', () => {
  const content = buildMockContent(NOW)

  it('is written by Karen-named people, with everyday community captions', () => {
    expect(MOCK_PEOPLE.map((person) => person.name)).toEqual(['Saw Htoo', 'Naw Paw', 'Saw Kler', 'Naw Mu'])
    expect(content.posts.length).toBeGreaterThanOrEqual(24)
    expect(new Set(content.posts.map((post) => post.author.name))).toEqual(new Set(MOCK_PEOPLE.map((person) => person.name)))
    expect(content.posts.some((post) => /market|school|garden|meeting/i.test(post.caption))).toBe(true)
  })

  it('takes pictures from picsum by seed (no real person), and has some posts that are only text', () => {
    const withPicture = content.posts.filter((post) => post.image_url)
    expect(withPicture.length).toBeGreaterThan(10)
    for (const post of withPicture) expect(post.image_url).toMatch(/^https:\/\/picsum\.photos\/seed\/[\w-]+\/800\/800$/)
    expect(content.posts.some((post) => post.image_url === null)).toBe(true)
  })

  it('is dated relative to now: newest first, the newest minutes ago, ids unique', () => {
    const times = content.posts.map((post) => Date.parse(post.created_at))
    expect([...times].sort((a, b) => b - a)).toEqual(times)
    expect(NOW - (times[0] ?? 0)).toBeLessThan(60 * 60 * 1000)
    expect(new Set(content.posts.map((post) => post.id)).size).toBe(content.posts.length)
  })

  it('has comments that come after their post and never from the future, and counts that agree', () => {
    for (const post of content.posts) {
      const thread = content.comments[post.id] ?? []
      expect(post.comment_count).toBe(thread.length)
      for (const comment of thread) {
        expect(Date.parse(comment.created_at)).toBeGreaterThanOrEqual(Date.parse(post.created_at))
        expect(Date.parse(comment.created_at)).toBeLessThan(NOW)
      }
    }
  })

  it('gives the same posts for the same moment', () => {
    expect(buildMockContent(NOW)).toEqual(content)
  })
})

describe('listing posts', () => {
  it('serves them in pages, newest first, and walking the cursors shows each exactly once', async () => {
    const { service } = make({ pageSize: 6 })

    const first = await service.listPosts()
    expect(first.data).toHaveLength(6)
    expect(first.next_cursor).not.toBeNull()

    const all = await everyPost(service)
    expect(all.length).toBe(buildMockContent(NOW).posts.length)
    expect(new Set(all.map((post) => post.id)).size).toBe(all.length)
    const times = all.map((post) => Date.parse(post.created_at))
    expect([...times].sort((a, b) => b - a)).toEqual(times)
  })

  it('has no cursor on the last page', async () => {
    const { service } = make({ pageSize: 100 })

    const page = await service.listPosts()

    expect(page.next_cursor).toBeNull()
  })

  it('ends (an empty page) for a cursor it does not know, instead of starting over', async () => {
    const { service } = make()

    const page = await service.listPosts('2000-01-01T00:00:00.000Z|gone')

    expect(page).toEqual({ data: [], next_cursor: null })
  })

  it('keeps the next page right when a new post is added at the top meanwhile', async () => {
    const { service } = make({ pageSize: 6 })
    const first = await service.listPosts()

    await service.createPost({ caption: 'Fresh', image: null })
    const second = await service.listPosts(first.next_cursor)

    expect(second.data.some((post) => first.data.some((seen) => seen.id === post.id))).toBe(false)
    expect(second.data).toHaveLength(6)
  })

  it('answers after the pause it was given, and by default after 150 to 400 ms', async () => {
    vi.useFakeTimers()
    const slow = make({ delay: () => 300 })
    let done = false
    void slow.service.listPosts().then(() => (done = true))

    await vi.advanceTimersByTimeAsync(299)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(done).toBe(true)

    for (const [random, expected] of [[0, 150], [0.999, 400]] as const) {
      vi.spyOn(Math, 'random').mockReturnValue(random)
      const usual = createMockFeedService({ currentUser: () => ME, now: () => NOW, storage: memory() })
      let finished = false
      void usual.listPosts().then(() => (finished = true))
      await vi.advanceTimersByTimeAsync(expected - 1)
      expect(finished).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(finished).toBe(true)
    }
  })
})

describe('likes', () => {
  it('adds one like, and the same like twice is still one', async () => {
    const { service } = make()
    const before = (await service.listPosts()).data[0] as FeedPost

    const once = await service.likePost(before.id)
    const twice = await service.likePost(before.id)

    expect(once).toEqual({ like_count: before.like_count + 1, liked_by_me: true })
    expect(twice).toEqual(once)
  })

  it('takes it back, and taking back what was not given changes nothing', async () => {
    const { service } = make()
    const before = (await service.listPosts()).data[0] as FeedPost

    await service.likePost(before.id)
    expect(await service.unlikePost(before.id)).toEqual({ like_count: before.like_count, liked_by_me: false })
    expect(await service.unlikePost(before.id)).toEqual({ like_count: before.like_count, liked_by_me: false })
  })

  it('shows up in the list as "liked by me" with the count', async () => {
    const { service } = make()
    const target = (await service.listPosts()).data[1] as FeedPost
    await service.likePost(target.id)

    const again = (await service.listPosts()).data[1] as FeedPost

    expect(again.liked_by_me).toBe(true)
    expect(again.like_count).toBe(target.like_count + 1)
  })

  it('belongs to the person: someone else on the same browser has not liked it', async () => {
    const { service, signInAs } = make()
    const target = (await service.listPosts()).data[0] as FeedPost
    await service.likePost(target.id)

    signInAs(OTHER)
    const seen = (await service.listPosts()).data[0] as FeedPost

    expect(seen.liked_by_me).toBe(false)
    expect(seen.like_count).toBe(target.like_count)
  })

  it('is not for a post that does not exist (404)', async () => {
    const { service } = make()

    await expect(service.likePost('nope')).rejects.toMatchObject({ status: 404 })
  })
})

describe('writing a post', () => {
  it('puts it at the top, as the signed-in person, with the words trimmed', async () => {
    const { service } = make()

    const post = await service.createPost({ caption: '  Market day  ', image: null })
    const top = (await service.listPosts()).data[0] as FeedPost

    expect(top.id).toBe(post.id)
    expect(post).toMatchObject({ caption: 'Market day', author: { id: ME.id, name: ME.name }, like_count: 0, liked_by_me: false, comment_count: 0, image_url: null })
    expect(post.created_at).toBe(new Date(NOW).toISOString())
  })

  it('keeps a small copy of the picture, not the original', async () => {
    const { service } = make()
    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' })

    const post = await service.createPost({ caption: '', image: file })

    expect(post.image_url).toBe('data:image/jpeg;base64,SMALL')
  })

  it('needs words or a picture (422)', async () => {
    const { service } = make()

    await expect(service.createPost({ caption: '   ', image: null })).rejects.toMatchObject({ status: 422 })
  })

  it('refuses a caption over the limit, with the field named (422)', async () => {
    const { service } = make()

    const problem: unknown = await service.createPost({ caption: 'x'.repeat(2001), image: null }).catch((error: unknown) => error)

    expect(problem).toBeInstanceOf(ApiError)
    expect((problem as ApiError).fieldError('caption')).toBeTruthy()
  })

  it('refuses a file that is not a picture or is too big, and one that cannot be read (422, field "image")', async () => {
    const { service } = make({ imageToDataUrl: () => Promise.reject(new Error('cannot decode')) })

    for (const file of [new File(['x'], 'a.pdf', { type: 'application/pdf' }), new File(['x'], 'b.jpg', { type: 'image/jpeg' })]) {
      const problem: unknown = await service.createPost({ caption: 'hi', image: file }).catch((error: unknown) => error)
      expect((problem as ApiError).status).toBe(422)
      expect((problem as ApiError).fieldError('image')).toBeTruthy()
    }
    const big = new File(['x'], 'big.jpg', { type: 'image/jpeg' })
    Object.defineProperty(big, 'size', { value: 10 * 1024 * 1024 + 1 })
    await expect(service.createPost({ caption: 'hi', image: big })).rejects.toMatchObject({ status: 422 })
  })

  it('needs someone signed in (401)', async () => {
    const { service, signInAs } = make()
    signInAs(null)

    await expect(service.createPost({ caption: 'hi', image: null })).rejects.toMatchObject({ status: 401 })
  })

  it('starts a new post with no likes of its own, unlike the sample posts', async () => {
    const { service } = make()
    const post = await service.createPost({ caption: 'Mine', image: null })

    expect((await service.likePost(post.id)).like_count).toBe(1)
  })
})

describe('comments', () => {
  const firstWithComments = async (service: FeedService): Promise<FeedPost> =>
    (await everyPost(service)).find((post) => post.comment_count >= 2) as FeedPost

  it('lists what is already said, oldest first', async () => {
    const { service } = make()
    const post = await firstWithComments(service)

    const page = await service.listComments(post.id)

    expect(page.data).toHaveLength(post.comment_count)
    const times = page.data.map((comment) => Date.parse(comment.created_at))
    expect([...times].sort((a, b) => a - b)).toEqual(times)
  })

  it('adds a comment as the signed-in person, at the end, and the post counts it', async () => {
    const { service } = make()
    const post = await firstWithComments(service)

    const comment = await service.addComment(post.id, '  See you there  ')
    const thread = await service.listComments(post.id)
    const counted = (await everyPost(service)).find((candidate) => candidate.id === post.id) as FeedPost

    expect(comment).toMatchObject({ post_id: post.id, content: 'See you there', author: { id: ME.id } })
    expect(thread.data.at(-1)?.id).toBe(comment.id)
    expect(counted.comment_count).toBe(post.comment_count + 1)
  })

  it('pages through them, each exactly once', async () => {
    const { service } = make({ commentPageSize: 1 })
    const post = await firstWithComments(service)
    await service.addComment(post.id, 'one more')

    const seen: FeedComment[] = []
    let cursor: string | null = null
    do {
      const page = await service.listComments(post.id, cursor)
      expect(page.data.length).toBeLessThanOrEqual(1)
      seen.push(...page.data)
      cursor = page.next_cursor
    } while (cursor)

    expect(seen).toHaveLength(post.comment_count + 1)
    expect(new Set(seen.map((comment) => comment.id)).size).toBe(seen.length)
  })

  it('refuses an empty or over-long comment (422), and one for a post that is not there (404)', async () => {
    const { service } = make()
    const post = await firstWithComments(service)

    await expect(service.addComment(post.id, '   ')).rejects.toMatchObject({ status: 422 })
    await expect(service.addComment(post.id, 'x'.repeat(1001))).rejects.toMatchObject({ status: 422 })
    await expect(service.addComment('nope', 'hello')).rejects.toMatchObject({ status: 404 })
    await expect(service.listComments('nope')).rejects.toMatchObject({ status: 404 })
  })
})

describe('what survives a reload', () => {
  it('keeps new posts, likes and comments in the browser, and a second service starts from them', async () => {
    const storage = memory()
    const first = make({}, storage)
    const post = await first.service.createPost({ caption: 'Kept', image: null })
    const sample = (await first.service.listPosts()).data[1] as FeedPost
    await first.service.likePost(sample.id)
    await first.service.addComment(sample.id, 'Kept too')

    const reloaded = make({}, storage).service
    const posts = (await reloaded.listPosts()).data

    expect(posts[0]?.id).toBe(post.id)
    expect(posts.find((candidate) => candidate.id === sample.id)).toMatchObject({ liked_by_me: true, like_count: sample.like_count + 1, comment_count: sample.comment_count + 1 })
    expect((await reloaded.listComments(sample.id)).data.map((comment) => comment.content)).toContain('Kept too')
  })

  it('writes under one key, and never stores the sample posts themselves', async () => {
    const storage = memory()
    const { service } = make({}, storage)
    await service.createPost({ caption: 'Only me', image: null })

    const saved = JSON.parse(storage.box.value ?? '{}') as { v: number; posts: FeedPost[] }
    expect(saved.v).toBe(1)
    expect(saved.posts).toHaveLength(1)
    expect(MOCK_FEED_KEY).toBe('kc.mock.feed')
  })

  it.each([
    ['not JSON', '{oops'],
    ['another version', JSON.stringify({ v: 2, posts: [{ id: 'x' }] })],
    ['the wrong shape', JSON.stringify([1, 2, 3])],
    ['nothing', null],
  ])('starts clean from storage that is %s', async (_name, raw) => {
    const { service } = make({}, memory(raw))

    expect((await service.listPosts()).data.length).toBeGreaterThan(0)
  })

  it('ignores saved items that are not what it writes, keeping the good ones', async () => {
    const good: FeedPost = { id: 'p1', author: ME, caption: 'ok', image_url: null, created_at: new Date(NOW).toISOString(), like_count: 0, liked_by_me: false, comment_count: 0 }
    const raw = JSON.stringify({ v: 1, posts: [good, { id: 5 }, null, 'text'], comments: { p1: [{ nope: true }], other: 'text' }, likes: { 'user-me': ['p1', 7] } })
    const { service } = make({}, memory(raw))

    const posts = (await service.listPosts()).data

    expect(posts[0]?.id).toBe('p1')
    expect(posts[0]?.liked_by_me).toBe(true)
    expect(posts.filter((post) => post.id === 'p1')).toHaveLength(1)
  })

  it('when the browser has no room, drops the oldest pictures first, then the oldest posts, and keeps the newest', async () => {
    const big = 'data:image/jpeg;base64,' + 'A'.repeat(400)
    const storage = memory(null, 1700)
    const { service } = make({ imageToDataUrl: async () => big }, storage)
    const picture = new File(['x'], 'a.jpg', { type: 'image/jpeg' })

    const ids: string[] = []
    for (const caption of ['one', 'two', 'three', 'four']) ids.push((await service.createPost({ caption, image: picture })).id)

    const saved = JSON.parse(storage.box.value ?? '{}') as { posts: FeedPost[] }
    expect(storage.box.value?.length).toBeLessThanOrEqual(1700)
    // the newest still has its picture; the older ones lost theirs, and the words of all four are still there
    expect(saved.posts.map((post) => post.id)).toEqual([...ids].reverse())
    expect(saved.posts[0]?.image_url).toBe(big)
    expect(saved.posts.slice(1).every((post) => post.image_url === null)).toBe(true)
  })

  it('when even the words do not fit, the oldest posts go, and the newest stays', async () => {
    const storage = memory(null, 700)
    const { service } = make({}, storage)

    const ids: string[] = []
    for (const caption of ['one', 'two', 'three', 'four']) ids.push((await service.createPost({ caption, image: null })).id)

    const saved = JSON.parse(storage.box.value ?? '{}') as { posts: FeedPost[] }
    expect(storage.box.value?.length).toBeLessThanOrEqual(700)
    expect(saved.posts.length).toBeGreaterThan(0)
    expect(saved.posts.length).toBeLessThan(4)
    expect(saved.posts[0]?.id).toBe(ids[3])
  })
})

describe('sharing', () => {
  it('links to the feed with the post named, on this address', () => {
    const { service } = make()

    expect(service.postLink('mock-post-01')).toBe('https://kanyaw.example/?post=mock-post-01')
    expect(service.postLink('a b')).toBe('https://kanyaw.example/?post=a%20b')
  })
})
