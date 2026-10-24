import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FakeObserver, installFakeObserver } from '@/__tests__/fakeObserver'
import { deferred, fakeApi, fakeFeed, makeChat, makePost, makeRoom, mountApp, page, restoreApi, restoreMedia, screenIs, settle, signedInStores } from '@/__tests__/helpers'
import { ApiError } from '@/api/errors'
import FeedView from '@/views/FeedView.vue'
import { setFeedService } from '@/services'
import { useFeedStore } from '@/stores/feed'
import { useUiStore } from '@/stores/ui'
import type { CursorPage, FeedPost } from '@/types/feed'

beforeEach(() => {
  installFakeObserver()
  screenIs(false)
  fakeApi((call) => {
    if (call.url === '/rooms') return { data: page([makeRoom()]) }
    if (call.url === '/chats') return { data: page([makeChat()]) }
    return { data: page([]) }
  })
})
afterEach(() => {
  restoreApi()
  restoreMedia()
  vi.unstubAllGlobals()
})

const posts = (...ids: string[]): FeedPost[] => ids.map((id) => makePost({ id, caption: `Caption ${id}` }))
const first = (data: FeedPost[], next_cursor: string | null = null): CursorPage<FeedPost> => ({ data, next_cursor })

async function open(service: Parameters<typeof fakeFeed>[0] = {}) {
  setFeedService(fakeFeed(service))
  const mounted = await mountApp(FeedView, { prepare: (pinia) => signedInStores(pinia) })
  await settle(4)
  return { ...mounted, feed: () => useFeedStore(mounted.pinia), ui: () => useUiStore(mounted.pinia) }
}

const cards = (wrapper: Awaited<ReturnType<typeof open>>['wrapper']) => wrapper.findAll('article')
const dialog = (): HTMLElement | null => document.body.querySelector('[role="dialog"]')

describe('the feed page', () => {
  it('has a heading for screen readers and shows the posts as a list of cards', async () => {
    const { wrapper } = await open({ listPosts: async () => first(posts('a', 'b', 'c')) })

    expect(wrapper.get('h1').text()).toBe('Home')
    expect(wrapper.get('h1').classes()).toContain('sr-only')
    expect(cards(wrapper)).toHaveLength(3)
    expect(wrapper.findAll('ul > li')).toHaveLength(3)
    expect(wrapper.text()).toContain('Caption a')
  })

  it('shows skeleton posts while the first page is on its way, and tells screen readers', async () => {
    const wait = deferred<CursorPage<FeedPost>>()
    const { wrapper } = await open({ listPosts: () => wait.promise })

    expect(wrapper.get('[role="status"]').text()).toContain('Loading posts…')
    expect(cards(wrapper)).toHaveLength(0)
    wait.resolve(first(posts('a')))
    await settle(3)

    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(cards(wrapper)).toHaveLength(1)
  })

  it('makes the first two pictures load at once and the rest when they come near', async () => {
    const { wrapper } = await open({ listPosts: async () => first(posts('a', 'b', 'c')) })

    expect(wrapper.findAll('img').map((img) => img.attributes('loading'))).toEqual(['eager', 'eager', 'lazy'])
  })

  it('says it failed, with "Try again", which asks again', async () => {
    let up = false
    const { wrapper } = await open({ listPosts: async () => (up ? first(posts('a')) : Promise.reject(new ApiError({ status: 0, code: 'network', message: 'x' }))) })
    expect(wrapper.get('[role="alert"]').text()).toContain("Can't reach the server")

    up = true
    await wrapper.get('[role="alert"] button').trigger('click')
    await settle(4)

    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(cards(wrapper)).toHaveLength(1)
  })

  it('suggests the first post when there are none, and the button opens the Create dialog', async () => {
    const { wrapper, ui } = await open({ listPosts: async () => first([]) })

    expect(wrapper.text()).toContain('No posts yet')
    await wrapper.findAll('button').find((button) => button.text() === 'Create a post')!.trigger('click')

    expect(ui().createMenuOpen).toBe(true)
  })

})

describe('the preview note', () => {
  it('says the posts are samples and that posting is not live', async () => {
    const { wrapper } = await open()

    expect(wrapper.get('[role="note"]').text()).toBe('Preview — sample posts. Posting is not live yet.')
  })

  it('goes away when dismissed (and the button is named)', async () => {
    const { wrapper, feed } = await open()

    await wrapper.get('[role="note"] button').trigger('click')

    expect(wrapper.find('h1').exists()).toBe(true)
    expect(wrapper.find('[role="note"]').exists()).toBe(false)
    expect(feed().noteDismissed).toBe(true)
  })

  it('has a dismiss button that can be found by name and tapped', async () => {
    const { wrapper } = await open()

    const dismiss = wrapper.get('[role="note"] button')
    expect(dismiss.attributes('aria-label')).toBe('Dismiss this note')
    expect(dismiss.classes()).toContain('size-11')
  })
})

describe('more posts as the page is scrolled', () => {
  const pages: Record<string, CursorPage<FeedPost>> = {
    start: first(posts('a', 'b'), 'c1'),
    c1: first(posts('c', 'd'), 'c2'),
    c2: first(posts('e'), null),
  }

  it('fetches the next page when the end of the list comes near, and shows a skeleton meanwhile', async () => {
    const wait = deferred<CursorPage<FeedPost>>()
    const listPosts = vi.fn(async (cursor?: string | null) => (cursor === 'c1' ? wait.promise : (pages[cursor ?? 'start'] as CursorPage<FeedPost>)))
    const { wrapper } = await open({ listPosts })
    expect(FakeObserver.latest().observed).toHaveLength(1)

    FakeObserver.latest().see(true)
    await settle(2)
    expect(wrapper.get('[role="status"]').text()).toContain('Loading more posts…')
    expect(cards(wrapper)).toHaveLength(2)

    wait.resolve(pages['c1'] as CursorPage<FeedPost>)
    await settle(3)
    expect(cards(wrapper)).toHaveLength(4)
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
  })

  it('looks for the end of the list again after a page has been added, so a tall screen keeps filling', async () => {
    const listPosts = vi.fn(async (cursor?: string | null) => pages[cursor ?? 'start'] as CursorPage<FeedPost>)
    await open({ listPosts })
    const observer = FakeObserver.latest()
    const disconnected = observer.disconnected

    observer.see(true)
    await settle(3)

    expect(observer.disconnected).toBeGreaterThan(disconnected)
    expect(observer.observed).toHaveLength(1)
  })

  it('does not fetch when the marker is not near', async () => {
    const listPosts = vi.fn(async (cursor?: string | null) => pages[cursor ?? 'start'] as CursorPage<FeedPost>)
    await open({ listPosts })

    FakeObserver.latest().see(false)
    await settle(2)

    expect(listPosts).toHaveBeenCalledTimes(1)
  })

  it('says "You have seen all the posts." at the end, with nothing more to watch', async () => {
    const listPosts = vi.fn(async (cursor?: string | null) => pages[cursor ?? 'start'] as CursorPage<FeedPost>)
    const { wrapper } = await open({ listPosts })
    FakeObserver.latest().see(true)
    await settle(3)
    FakeObserver.latest().see(true)
    await settle(3)

    expect(cards(wrapper)).toHaveLength(5)
    expect(wrapper.text()).toContain('You have seen all the posts.')
    expect(FakeObserver.latest().observed).toHaveLength(0)
  })

  it('keeps the posts, says it failed at the end, and "Try again" goes on from there', async () => {
    let up = false
    const listPosts = vi.fn(async (cursor?: string | null) => {
      if (cursor === 'c1' && !up) throw new ApiError({ status: 0, code: 'network', message: 'x' })
      return pages[cursor ?? 'start'] as CursorPage<FeedPost>
    })
    const { wrapper } = await open({ listPosts })

    FakeObserver.latest().see(true)
    await settle(3)
    expect(wrapper.get('[role="alert"]').text()).toContain('More posts could not be loaded.')
    expect(cards(wrapper)).toHaveLength(2)

    up = true
    await wrapper.get('[role="alert"] button').trigger('click')
    await settle(3)
    expect(cards(wrapper)).toHaveLength(4)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('offers a "Show more posts" button in a browser that cannot watch for the end of the list', async () => {
    vi.unstubAllGlobals()
    // @ts-expect-error jsdom has none
    delete window.IntersectionObserver
    const listPosts = vi.fn(async (cursor?: string | null) => pages[cursor ?? 'start'] as CursorPage<FeedPost>)
    const { wrapper } = await open({ listPosts })

    await wrapper.findAll('button').find((button) => button.text() === 'Show more posts')!.trigger('click')
    await settle(3)

    expect(cards(wrapper)).toHaveLength(4)
  })
})

describe('comments and the people & activity sheet', () => {
  it('opens the comments of the post that was chosen, and closes them', async () => {
    const { wrapper } = await open({ listPosts: async () => first(posts('a', 'b')) })
    expect(dialog()).toBeNull()

    await cards(wrapper)[1]!.get('button[aria-label^="Comments on"]').trigger('click')
    await settle(3)
    expect(dialog()?.textContent).toContain('Comments')

    dialog()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await vi.waitFor(() => expect(dialog()).toBeNull())
  })

  it('has a "People & activity" button for screens without the sidebar, which opens the same content in a sheet', async () => {
    const { wrapper } = await open()
    const button = wrapper.findAll('button').find((candidate) => candidate.text() === 'People & activity')!
    expect(button.classes()).toContain('lg:hidden')

    await button.trigger('click')
    await settle(5)

    expect(dialog()?.textContent).toContain('Online now')
    expect(dialog()?.textContent).toContain('Upcoming meetings')
    expect(dialog()?.textContent).toContain('People from your groups')
    expect(dialog()?.textContent).toContain('Committee meeting')
  })

  it('does not ask for the meetings until the sheet is opened (a phone should not pay for what it does not show)', async () => {
    const { calls } = fakeApi((call) => (call.url === '/rooms' ? { data: page([makeRoom()]) } : { data: page([]) }))
    const { wrapper } = await open()
    expect(calls.some((call) => call.url === '/rooms')).toBe(false)

    await wrapper.findAll('button').find((candidate) => candidate.text() === 'People & activity')!.trigger('click')
    await settle(4)

    expect(calls.some((call) => call.url === '/rooms')).toBe(true)
  })
})
