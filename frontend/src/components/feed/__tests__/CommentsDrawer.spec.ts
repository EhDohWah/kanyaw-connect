import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { deferred, fakeFeed, makeComment, makePost, mountApp, restoreMedia, screenIs, settle, signedInStores } from '@/__tests__/helpers'
import { ApiError } from '@/api/errors'
import CommentsDrawer from '@/components/feed/CommentsDrawer.vue'
import { setFeedService } from '@/services'
import { useFeedStore } from '@/stores/feed'
import type { CursorPage, FeedComment } from '@/types/feed'

beforeEach(() => screenIs(false, true))
afterEach(restoreMedia)

const dialog = (): HTMLElement | null => document.body.querySelector('[role="dialog"]')
const box = (): HTMLTextAreaElement => document.body.querySelector('textarea') as HTMLTextAreaElement
const sendButton = (): HTMLButtonElement => document.body.querySelector('button[type="submit"]') as HTMLButtonElement

async function open(comments: Partial<Parameters<typeof fakeFeed>[0]> = {}, postId: string | null = 'post-1') {
  setFeedService(fakeFeed(comments))
  const mounted = await mountApp(CommentsDrawer, {
    props: { postId },
    prepare: (pinia) => {
      signedInStores(pinia)
      const feed = useFeedStore(pinia)
      feed.posts = [makePost({ comment_count: 1 })]
      feed.status = 'ready'
    },
  })
  await settle(3)
  return { ...mounted, feed: () => useFeedStore(mounted.pinia) }
}

const type = async (text: string): Promise<void> => {
  box().value = text
  box().dispatchEvent(new Event('input', { bubbles: true }))
  await settle(1)
}

const key = (init: KeyboardEventInit): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  box().dispatchEvent(event)
  return event
}

describe('opening and closing', () => {
  it('is not there while no post is chosen', async () => {
    await open({}, null)

    expect(dialog()).toBeNull()
  })

  it('opens as a dialog named "Comments", when a post is chosen', async () => {
    const { wrapper } = await open()

    expect(dialog()).not.toBeNull()
    expect(dialog()?.getAttribute('aria-modal')).toBe('true')
    expect(dialog()?.textContent).toContain('Comments')
    await wrapper.setProps({ postId: null })
    await vi.waitFor(() => expect(dialog()).toBeNull())
  })

  it('asks to be closed with Escape and with the close button', async () => {
    const { wrapper } = await open()

    dialog()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    ;(document.body.querySelector('button[aria-label="Close"]') as HTMLButtonElement).click()

    expect(wrapper.emitted('close')).toHaveLength(2)
  })

  it('is a side panel on wide screens and a bottom sheet on phones (the dialog is the "side" kind)', async () => {
    await open()

    expect(dialog()?.className).toContain('md:w-[28rem]')
    expect(dialog()?.className).toContain('max-h-[85dvh]')
  })
})

describe('the comments', () => {
  it('shows a loading state, then the comments with who wrote them and when', async () => {
    const wait = deferred<CursorPage<FeedComment>>()
    const { wrapper } = await open({ listComments: () => wait.promise })
    expect(dialog()?.querySelector('[role="status"]')?.textContent).toContain('Loading comments')

    wait.resolve({ data: [makeComment({ author: { id: 'u', name: 'Naw Mu', avatar_url: null, avatar_thumb_url: null }, content: 'Save me some mangoes!' })], next_cursor: null })
    await settle(3)

    expect(dialog()?.querySelector('[role="status"]')).toBeNull()
    expect(dialog()?.textContent).toContain('Naw Mu')
    expect(dialog()?.textContent).toContain('Save me some mangoes!')
    expect(dialog()?.querySelector('time')?.textContent).toMatch(/min\. ago|now|hr\. ago/)
    expect(wrapper.exists()).toBe(true)
  })

  it('invites the first comment when there are none', async () => {
    await open()

    expect(dialog()?.textContent).toContain('No comments yet. Start the conversation.')
  })

  it('says it failed, and tries again when asked', async () => {
    let up = false
    await open({ listComments: async () => (up ? { data: [makeComment({ content: 'Back again' })], next_cursor: null } : Promise.reject(new ApiError({ status: 0, code: 'network', message: 'x' }))) })
    expect(dialog()?.querySelector('[role="alert"]')?.textContent).toContain("Can't reach the server")

    up = true
    ;(dialog()?.querySelector('[role="alert"] button') as HTMLButtonElement).click()
    await settle(4)

    expect(dialog()?.textContent).toContain('Back again')
    expect(dialog()?.querySelector('[role="alert"]')).toBeNull()
  })

  it('offers "Show more comments" while there are more, and adds them to the end', async () => {
    const listComments = vi.fn(async (_id: string, cursor?: string | null) =>
      cursor ? { data: [makeComment({ id: 'c2', content: 'Second' })], next_cursor: null } : { data: [makeComment({ id: 'c1', content: 'First' })], next_cursor: 'k1' },
    )
    await open({ listComments })
    const more = [...document.body.querySelectorAll('button')].find((button) => button.textContent?.includes('Show more comments')) as HTMLButtonElement

    more.click()
    await settle(4)

    const text = dialog()?.textContent ?? ''
    expect(text.indexOf('First')).toBeLessThan(text.indexOf('Second'))
    expect([...document.body.querySelectorAll('button')].some((button) => button.textContent?.includes('Show more comments'))).toBe(false)
  })

  it('shows the comments of whichever post is chosen, never the previous one’s', async () => {
    const listComments = vi.fn(async (postId: string) => ({ data: [makeComment({ id: `c-${postId}`, post_id: postId, content: `About ${postId}` })], next_cursor: null }))
    const { wrapper } = await open({ listComments })
    expect(dialog()?.textContent).toContain('About post-1')

    await wrapper.setProps({ postId: 'post-2' })
    await settle(4)

    expect(dialog()?.textContent).toContain('About post-2')
    expect(dialog()?.textContent).not.toContain('About post-1')
  })
})

describe('writing a comment', () => {
  it('has a labelled box and a send button that cannot be used while the box is empty or only spaces', async () => {
    await open()

    expect(box().getAttribute('aria-label')).toBe('Write a comment')
    expect(box().getAttribute('maxlength')).toBe('1000')
    expect(sendButton().getAttribute('aria-label')).toBe('Post comment')
    expect(sendButton().disabled).toBe(true)
    await type('   ')
    expect(sendButton().disabled).toBe(true)
    await type('Hello')
    expect(sendButton().disabled).toBe(false)
  })

  it('sends the comment, shows it at the end, empties the box and counts it on the post', async () => {
    const addComment = vi.fn(async (postId: string, content: string) => makeComment({ id: 'new', post_id: postId, content }))
    const { feed } = await open({ addComment })

    await type('See you there')
    sendButton().click()
    await settle(4)

    expect(addComment).toHaveBeenCalledWith('post-1', 'See you there')
    expect(dialog()?.textContent).toContain('See you there')
    expect(box().value).toBe('')
    expect(feed().posts[0]?.comment_count).toBe(2)
  })

  it('cannot be sent twice while it is on its way', async () => {
    const wait = deferred<FeedComment>()
    const addComment = vi.fn(() => wait.promise)
    await open({ addComment })
    await type('Once')

    sendButton().click()
    await settle(1)
    expect(sendButton().disabled).toBe(true)
    expect(sendButton().getAttribute('aria-label')).toBe('Posting…')
    sendButton().click()
    wait.resolve(makeComment({ content: 'Once' }))
    await settle(3)

    expect(addComment).toHaveBeenCalledTimes(1)
  })

  it('keeps the words and says why when the comment is refused, with the server’s reason or our own', async () => {
    const addComment = vi.fn().mockRejectedValueOnce(new ApiError({ status: 429, message: 'Too many', retryAfter: 12 })).mockRejectedValueOnce(new ApiError({ status: 422, message: 'The comment is too long' }))
    await open({ addComment })
    await type('Keep me')

    sendButton().click()
    await settle(4)
    expect(box().value).toBe('Keep me')
    expect(dialog()?.querySelector('[role="alert"]')?.textContent).toContain('Too many requests. Please wait 12 seconds')

    sendButton().click()
    await settle(4)
    expect(box().value).toBe('Keep me')
    expect(dialog()?.querySelector('[role="alert"]')?.textContent).toBe('The comment is too long')
  })

  it('sends with Enter where there is a mouse, and starts a new line with Shift+Enter', async () => {
    const addComment = vi.fn(async (postId: string, content: string) => makeComment({ post_id: postId, content }))
    await open({ addComment })
    await type('Enter sends')

    const shifted = key({ key: 'Enter', shiftKey: true })
    await settle(2)
    expect(shifted.defaultPrevented).toBe(false)
    expect(addComment).not.toHaveBeenCalled()

    const plain = key({ key: 'Enter' })
    await settle(3)
    expect(plain.defaultPrevented).toBe(true)
    expect(addComment).toHaveBeenCalledWith('post-1', 'Enter sends')
  })

  it('does not send on Enter while a word is being composed (Burmese and Karen keyboards use Enter to choose a word)', async () => {
    const addComment = vi.fn(async () => makeComment())
    await open({ addComment })
    await type('စာ')

    key({ key: 'Enter', isComposing: true })
    key({ key: 'Enter', keyCode: 229 })
    await settle(2)

    expect(addComment).not.toHaveBeenCalled()
  })

  it('does not send on Enter on a phone: Enter is a new line there, and the button sends', async () => {
    screenIs(false, false)
    const addComment = vi.fn(async () => makeComment())
    await open({ addComment })
    await type('Phone')

    const event = key({ key: 'Enter' })
    await settle(2)

    expect(event.defaultPrevented).toBe(false)
    expect(addComment).not.toHaveBeenCalled()
  })

  it('starts with an empty box for each post', async () => {
    const { wrapper } = await open()
    await type('A draft')

    await wrapper.setProps({ postId: 'post-2' })
    await settle(3)

    expect(box().value).toBe('')
  })
})

describe('focus', () => {
  it('goes to the comment box on a screen with a mouse', async () => {
    await open()
    await settle(2)

    expect(document.activeElement).toBe(box())
  })

  it('does not pop the on-screen keyboard open on a phone: it goes to the first control instead', async () => {
    screenIs(false, false)
    await open()
    await settle(2)

    expect(document.activeElement).not.toBe(box())
    expect(dialog()?.contains(document.activeElement)).toBe(true)
  })
})
