import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'

import { deferred, fakeFeed, makePost, mountApp, signedInStores } from '@/__tests__/helpers'
import { ApiError } from '@/api/errors'
import PostCard from '@/components/feed/PostCard.vue'
import { setFeedService } from '@/services'
import { useFeedStore } from '@/stores/feed'
import { useUiStore } from '@/stores/ui'
import type { FeedPost, LikeResult } from '@/types/feed'

afterEach(() => {
  // @ts-expect-error put the browser back the way jsdom has it
  delete navigator.share
  // @ts-expect-error same
  delete navigator.clipboard
})

/** The card shows the post that is in the store, as the feed page does, so a like shows up on it. */
async function mountCard(overrides: Partial<FeedPost> = {}, props: Record<string, unknown> = {}) {
  const Host = defineComponent({
    setup() {
      const feed = useFeedStore()
      return () => (feed.posts[0] ? h(PostCard, { post: feed.posts[0], ...props }) : null)
    },
  })
  const mounted = await mountApp(Host, {
    prepare: (pinia) => {
      signedInStores(pinia)
      const feed = useFeedStore(pinia)
      feed.posts = [makePost(overrides)]
      feed.status = 'ready'
    },
  })
  return {
    ...mounted,
    card: () => mounted.wrapper.findComponent(PostCard),
    like: () => mounted.wrapper.get('button[aria-label="Like"]'),
    ui: () => useUiStore(mounted.pinia),
    feed: () => useFeedStore(mounted.pinia),
  }
}

describe('what a post shows', () => {
  it('has the author, how long ago, the picture, the likes, the caption and the comments', async () => {
    const { wrapper } = await mountCard()

    const article = wrapper.get('article')
    expect(article.attributes('aria-label')).toBe('Post by Naw Paw')
    expect(article.text()).toContain('Naw Paw')
    expect(wrapper.get('time').text()).toMatch(/^\d+ min\. ago$/)
    expect(wrapper.get('time').attributes('title')).toMatch(/\d{4}/)
    expect(wrapper.get('img').attributes('src')).toBe('https://picsum.photos/seed/kc-market/800/800')
    expect(wrapper.get('img').attributes('alt')).toBe('Picture from Naw Paw')
    expect(article.text()).toContain('18 likes')
    expect(article.text()).toContain('Market day was busy this morning.')
    expect(article.text()).toContain('2 comments')
  })

  it('says "1 like", "No likes", "1 comment" and "Add a comment" the way people say them', async () => {
    const one = await mountCard({ like_count: 1, comment_count: 1 })
    expect(one.wrapper.text()).toContain('1 like')
    expect(one.wrapper.text()).not.toContain('1 likes')
    expect(one.wrapper.text()).toContain('1 comment')

    const none = await mountCard({ like_count: 0, comment_count: 0 })
    expect(none.wrapper.text()).toContain('No likes')
    expect(none.wrapper.text()).toContain('Add a comment')
  })

  it('keeps the picture in a square box that is there before the picture arrives, so the page does not jump', async () => {
    const { wrapper } = await mountCard()

    expect(wrapper.get('img').element.parentElement?.className).toContain('aspect-square')
  })

  it('loads pictures lazily, except the first ones on the page', async () => {
    const lazy = await mountCard()
    expect(lazy.wrapper.get('img').attributes('loading')).toBe('lazy')

    const eager = await mountCard({}, { eager: true })
    expect(eager.wrapper.get('img').attributes('loading')).toBe('eager')
  })

  it('shows a calm placeholder, in the same box, when the picture cannot be loaded', async () => {
    const { wrapper } = await mountCard()

    await wrapper.get('img').trigger('error')

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toContain('Picture not available')
    expect(wrapper.find('.aspect-square').exists()).toBe(true)
  })

  it('has no picture box for a post that is only words', async () => {
    const { wrapper } = await mountCard({ image_url: null })

    expect(wrapper.find('.aspect-square').exists()).toBe(false)
    expect(wrapper.find('img').exists()).toBe(false)
  })

  it('turns a link in the caption into a link, and never lets markup through', async () => {
    const { wrapper } = await mountCard({ caption: 'Details at https://kanyaw.example/meeting <b>bold</b>' })

    const link = wrapper.get('a')
    expect(link.attributes('href')).toBe('https://kanyaw.example/meeting')
    expect(link.attributes('rel')).toContain('noopener')
    expect(wrapper.find('b').exists()).toBe(false)
    expect(wrapper.text()).toContain('<b>bold</b>')
  })

  it('uses a person’s picture for their avatar only through the avatar component (initials otherwise)', async () => {
    const { wrapper } = await mountCard()

    expect(wrapper.get('header').text()).toContain('NP')
  })
})

describe('a long caption', () => {
  const long = 'Word '.repeat(80)

  it('is cut short with "more", and opens in full', async () => {
    const { wrapper } = await mountCard({ caption: long })
    const more = wrapper.findAll('button').find((button) => button.text() === 'more')!

    expect(more.attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('p.line-clamp-3').exists()).toBe(true)

    await more.trigger('click')
    expect(wrapper.find('p.line-clamp-3').exists()).toBe(false)
    const less = wrapper.findAll('button').find((button) => button.text() === 'less')!
    expect(less.attributes('aria-expanded')).toBe('true')
  })

  it('has no "more" for a short caption', async () => {
    const { wrapper } = await mountCard()

    expect(wrapper.findAll('button').some((button) => button.text() === 'more')).toBe(false)
  })
})

describe('liking', () => {
  it('shows it at once: pressed, filled, one more like, with the small animation', async () => {
    const wait = deferred<LikeResult>()
    setFeedService(fakeFeed({ likePost: () => wait.promise }))
    const { wrapper, like } = await mountCard()
    expect(like().attributes('aria-pressed')).toBe('false')

    await like().trigger('click')

    expect(like().attributes('aria-pressed')).toBe('true')
    expect(wrapper.text()).toContain('19 likes')
    expect(like().get('svg').classes()).toContain('fill-primary')
    expect(like().get('svg').classes()).toContain('animate-like-pop')
    wait.resolve({ like_count: 19, liked_by_me: true })
  })

  it('stops the animation when it has played, and does not play it for an unlike', async () => {
    setFeedService(fakeFeed({ unlikePost: async () => ({ like_count: 17, liked_by_me: false }) }))
    const { like } = await mountCard({ liked_by_me: true })
    expect(like().attributes('aria-pressed')).toBe('true')

    await like().trigger('click')

    expect(like().attributes('aria-pressed')).toBe('false')
    expect(like().get('svg').classes()).not.toContain('animate-like-pop')
    expect(like().get('svg').classes()).not.toContain('fill-primary')
  })

  it('ends the animation when the browser says it has finished', async () => {
    setFeedService(fakeFeed({ likePost: async () => ({ like_count: 19, liked_by_me: true }) }))
    const { like } = await mountCard()
    await like().trigger('click')
    expect(like().get('svg').classes()).toContain('animate-like-pop')

    await like().get('svg').trigger('animationend')

    expect(like().get('svg').classes()).not.toContain('animate-like-pop')
  })

  it('goes back and says so when the like could not be saved', async () => {
    setFeedService(fakeFeed({ likePost: () => Promise.reject(new ApiError({ status: 0, code: 'network', message: 'x' })) }))
    const { wrapper, like, ui } = await mountCard()

    await like().trigger('click')
    await vi.waitFor(() => expect(ui().toasts).toHaveLength(1))

    expect(ui().toasts[0]).toMatchObject({ kind: 'error', message: 'Your like could not be saved.' })
    expect(like().attributes('aria-pressed')).toBe('false')
    expect(wrapper.text()).toContain('18 likes')
  })

  it('has a button big enough to tap and named for people who cannot see the heart', async () => {
    const { like, wrapper } = await mountCard()

    expect(like().classes()).toContain('size-11')
    for (const button of wrapper.findAll('button')) {
      expect(button.text() !== '' || button.attributes('aria-label')).toBeTruthy()
    }
  })
})

describe('comments and sharing', () => {
  it('opens the comments from the icon, and from the line under the caption', async () => {
    const { card, wrapper } = await mountCard({ id: 'p7' })

    await wrapper.get('button[aria-label="Comments on the post by Naw Paw"]').trigger('click')
    await wrapper.findAll('button').find((button) => button.text() === '2 comments')!.trigger('click')

    expect(card().emitted('comments')).toEqual([['p7'], ['p7']])
  })

  it('shares through the phone’s share sheet where there is one, with a link to the post', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { share })
    const { wrapper, ui } = await mountCard({ id: 'p7', caption: 'Hello all' })

    await wrapper.get('button[aria-label="Share"]').trigger('click')
    await vi.waitFor(() => expect(share).toHaveBeenCalled())

    expect(share).toHaveBeenCalledWith({ title: 'Post by Naw Paw', text: 'Hello all', url: `${window.location.origin}/?post=p7` })
    expect(ui().toasts).toEqual([])
  })

  it('copies the link and says so when there is no share sheet', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    const { wrapper, ui } = await mountCard({ id: 'p7' })

    await wrapper.get('button[aria-label="Share"]').trigger('click')
    await vi.waitFor(() => expect(ui().toasts).toHaveLength(1))

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/?post=p7`)
    expect(ui().toasts[0]).toMatchObject({ kind: 'success', message: 'Link copied' })
  })

  it('says so when the link cannot be copied either', async () => {
    document.execCommand = vi.fn(() => false)
    const { wrapper, ui } = await mountCard()

    await wrapper.get('button[aria-label="Share"]').trigger('click')
    await vi.waitFor(() => expect(ui().toasts).toHaveLength(1))

    expect(ui().toasts[0]).toMatchObject({ kind: 'error', message: 'The link could not be shared.' })
  })

  it('says nothing when the person closes the share sheet', async () => {
    Object.assign(navigator, { share: vi.fn().mockRejectedValue(new DOMException('closed', 'AbortError')) })
    const { wrapper, ui } = await mountCard()

    await wrapper.get('button[aria-label="Share"]').trigger('click')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(ui().toasts).toEqual([])
  })
})
