import { afterEach, describe, expect, it, vi } from 'vitest'

import { deferred, fakeFeed, makePost, mountApp, settle, signedInStores } from '@/__tests__/helpers'
import { ApiError } from '@/api/errors'
import PostForm from '@/components/feed/PostForm.vue'
import { setFeedService } from '@/services'
import { useFeedStore } from '@/stores/feed'
import type { FeedPost, NewPostInput } from '@/types/feed'

afterEach(() => vi.restoreAllMocks())

async function mountForm(over: Parameters<typeof fakeFeed>[0] = {}) {
  setFeedService(fakeFeed(over))
  const mounted = await mountApp(PostForm, { prepare: (pinia) => signedInStores(pinia) })
  const caption = () => mounted.wrapper.get('textarea')
  const submit = () => mounted.wrapper.get('button[type="submit"]')
  const fillIn = async (text: string) => {
    await caption().setValue(text)
  }
  const choose = async (file: File) => {
    const input = mounted.wrapper.get('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change')
  }
  return { ...mounted, caption, submit, fillIn, choose, feed: () => useFeedStore(mounted.pinia) }
}

describe('the form', () => {
  it('has a labelled caption box that the dialog can focus, a picture zone, and says the post stays on this device', async () => {
    const { wrapper, caption } = await mountForm()

    expect(wrapper.get('label').text()).toBe('Caption')
    expect(caption().attributes('data-autofocus')).toBeDefined()
    expect(caption().attributes('maxlength')).toBe('2000')
    expect(wrapper.find('input[type="file"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('This is a preview: your post stays on this device.')
  })

  it('asks for words or a picture when sent empty, and does not call anything', async () => {
    const createPost = vi.fn()
    const { wrapper, submit, fillIn } = await mountForm({ createPost })

    await submit().trigger('submit')
    expect(wrapper.get('[role="alert"]').text()).toBe('Write something or add a picture.')
    await fillIn('   ')
    await submit().trigger('submit')

    expect(createPost).not.toHaveBeenCalled()
  })

  it('refuses a caption over the limit with a message on the caption box', async () => {
    const createPost = vi.fn()
    const { wrapper, fillIn, submit } = await mountForm({ createPost })

    await fillIn('x'.repeat(2001))
    await submit().trigger('submit')

    expect(wrapper.text()).toContain('A caption can have at most 2000 characters.')
    expect(wrapper.get('textarea').attributes('aria-invalid')).toBe('true')
    expect(createPost).not.toHaveBeenCalled()
  })
})

describe('posting', () => {
  it('sends the words, and tells the dialog it is done, with the post at the top of the feed', async () => {
    const createPost = vi.fn(async (input: NewPostInput) => makePost({ id: 'mine', caption: input.caption }))
    const { wrapper, fillIn, submit, feed } = await mountForm({ createPost })
    feed().status = 'ready'

    await fillIn('Market day')
    await submit().trigger('submit')
    await settle(3)

    expect(createPost).toHaveBeenCalledWith({ caption: 'Market day', image: null })
    expect(wrapper.emitted('posted')).toHaveLength(1)
    expect(feed().posts[0]?.id).toBe('mine')
  })

  it('sends the picture with it', async () => {
    const createPost = vi.fn(async (input: NewPostInput) => makePost({ caption: input.caption }))
    const { wrapper, choose, submit } = await mountForm({ createPost })
    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' })

    await choose(file)
    await submit().trigger('submit')
    await settle(3)

    expect(createPost).toHaveBeenCalledWith({ caption: '', image: file })
    expect(wrapper.emitted('posted')).toHaveLength(1)
  })

  it('shows "Posting…", cannot be pressed again, and cannot go back, while it is on its way', async () => {
    const wait = deferred<FeedPost>()
    const createPost = vi.fn(() => wait.promise)
    const { wrapper, fillIn, submit } = await mountForm({ createPost })
    await fillIn('Once')

    await submit().trigger('submit')
    expect(submit().text()).toContain('Posting…')
    expect((submit().element as HTMLButtonElement).disabled).toBe(true)
    expect((wrapper.findAll('button').find((button) => button.text() === 'Back to the options')?.element as HTMLButtonElement).disabled).toBe(true)
    await wrapper.get('form').trigger('submit')
    wait.resolve(makePost())
    await settle(3)

    expect(createPost).toHaveBeenCalledTimes(1)
  })

  it('keeps the words and the picture, and says why, when it fails; a second try can work', async () => {
    const createPost = vi
      .fn()
      .mockRejectedValueOnce(new ApiError({ status: 0, code: 'network', message: 'x' }))
      .mockResolvedValueOnce(makePost())
    const { wrapper, fillIn, choose, submit, caption } = await mountForm({ createPost })
    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' })
    await fillIn('Keep me')
    await choose(file)

    await submit().trigger('submit')
    await settle(3)
    expect(wrapper.get('[role="alert"]').text()).toContain("Can't reach the server")
    expect((caption().element as HTMLTextAreaElement).value).toBe('Keep me')
    expect(wrapper.find('img').exists()).toBe(true)
    expect(wrapper.emitted('posted')).toBeUndefined()

    await submit().trigger('submit')
    await settle(3)
    expect(createPost).toHaveBeenLastCalledWith({ caption: 'Keep me', image: file })
    expect(wrapper.emitted('posted')).toHaveLength(1)
  })

  it('shows the server’s own words when it explains itself (a 422)', async () => {
    const { wrapper, fillIn, submit } = await mountForm({ createPost: () => Promise.reject(new ApiError({ status: 422, message: 'The caption is too long' })) })
    await fillIn('Hello')

    await submit().trigger('submit')
    await settle(3)

    expect(wrapper.get('[role="alert"]').text()).toBe('The caption is too long')
  })

  it('goes back to the options when asked', async () => {
    const { wrapper } = await mountForm()

    await wrapper.findAll('button').find((button) => button.text() === 'Back to the options')!.trigger('click')

    expect(wrapper.emitted('back')).toHaveLength(1)
  })
})
