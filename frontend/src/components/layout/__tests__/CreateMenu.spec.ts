import { afterEach, describe, expect, it, vi } from 'vitest'

import { ME, deferred, fakeApi, fakeFeed, makePost, makeRoom, makeUser, mountApp, restoreApi, settle, signedInStores } from '@/__tests__/helpers'
import CreateMenu from '@/components/layout/CreateMenu.vue'
import { setFeedService } from '@/services'
import { useFeedStore } from '@/stores/feed'
import { useUiStore } from '@/stores/ui'
import type { Room } from '@/types/room'

afterEach(restoreApi)

const dialog = (): HTMLElement | null => document.body.querySelector('[role="dialog"]')
const buttons = (): HTMLButtonElement[] => [...(dialog()?.querySelectorAll('button') ?? [])]
const buttonWith = (text: string): HTMLButtonElement => buttons().find((button) => button.textContent?.includes(text)) as HTMLButtonElement

async function open(route = '/', user = makeUser({ id: ME })) {
  const mounted = await mountApp(CreateMenu, {
    route,
    prepare: (pinia) => {
      signedInStores(pinia, user)
      useUiStore(pinia).createMenuOpen = true
    },
  })
  await settle(3)
  return { ...mounted, ui: () => useUiStore(mounted.pinia), feed: () => useFeedStore(mounted.pinia) }
}

describe('the two choices', () => {
  it('opens as a dialog called "Create" with a Post and a Start a meeting choice, neither "coming soon"', async () => {
    await open()

    expect(dialog()?.getAttribute('aria-modal')).toBe('true')
    expect(dialog()?.querySelector('h2')?.textContent).toBe('Create')
    expect(buttonWith('Post')).toBeDefined()
    expect(buttonWith('Start a meeting')).toBeDefined()
    expect(dialog()?.textContent).not.toContain('Coming soon')
    expect(buttonWith('Post').disabled).toBe(false)
    expect(buttonWith('Start a meeting').disabled).toBe(false)
  })

  it('is closed until asked for', async () => {
    const { ui } = await open()
    ui().createMenuOpen = false
    await settle(3)

    expect(dialog()).toBeNull()
  })

  it('closes with Escape', async () => {
    const { ui } = await open()

    dialog()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    expect(ui().createMenuOpen).toBe(false)
  })
})

describe('writing a post', () => {
  it('goes to the form, with the cursor in the caption box, and back to the choices with the focus on "Post"', async () => {
    await open()

    buttonWith('Post').click()
    await settle(3)
    expect(dialog()?.querySelector('h2')?.textContent).toBe('New post')
    expect(document.activeElement).toBe(dialog()?.querySelector('textarea'))

    buttonWith('Back to the options').click()
    await settle(3)
    expect(dialog()?.querySelector('h2')?.textContent).toBe('Create')
    expect(document.activeElement).toBe(buttonWith('Post'))
  })

  it('starts from the choices every time it is opened', async () => {
    const { ui } = await open()
    buttonWith('Post').click()
    await settle(3)

    ui().createMenuOpen = false
    await settle(3)
    ui().createMenuOpen = true
    await settle(3)

    expect(dialog()?.querySelector('h2')?.textContent).toBe('Create')
  })

  it('on the feed: posts, closes, says so, and the post is at the top', async () => {
    setFeedService(fakeFeed({ createPost: async (input) => makePost({ id: 'mine', caption: input.caption }) }))
    const { ui, feed, router } = await open('/')
    feed().status = 'ready'
    buttonWith('Post').click()
    await settle(3)

    const caption = dialog()?.querySelector('textarea') as HTMLTextAreaElement
    caption.value = 'Hello community'
    caption.dispatchEvent(new Event('input', { bubbles: true }))
    ;(dialog()?.querySelector('button[type="submit"]') as HTMLButtonElement).click()
    await settle(5)

    expect(ui().createMenuOpen).toBe(false)
    expect(ui().toasts.map((toast) => toast.message)).toEqual(['Your post is on the feed.'])
    expect(feed().posts[0]?.id).toBe('mine')
    expect(router.currentRoute.value.name).toBe('home')
  })

  it('from another page: also takes the person to the feed, where it can be seen', async () => {
    setFeedService(fakeFeed())
    const { router } = await open('/profile')
    buttonWith('Post').click()
    await settle(3)

    const caption = dialog()?.querySelector('textarea') as HTMLTextAreaElement
    caption.value = 'From the profile page'
    caption.dispatchEvent(new Event('input', { bubbles: true }))
    ;(dialog()?.querySelector('button[type="submit"]') as HTMLButtonElement).click()

    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('home'))
  })
})

describe('starting a meeting', () => {
  const serveRoom = (reply: Parameters<typeof fakeApi>[0] = () => ({ status: 201, data: { data: makeRoom({ id: 'room-9', type: 'instant', scheduled_at: null }) } })) => fakeApi(reply)

  it('makes an instant room named after the person, closes the dialog, and opens the room', async () => {
    const { calls } = serveRoom()
    const { ui, router } = await open('/', makeUser({ id: ME, name: 'Saw Eh Doh' }))

    buttonWith('Start a meeting').click()
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/rooms/room-9'))

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ method: 'post', url: '/rooms', body: { name: "Saw Eh Doh's meeting" } })
    // an instant room: no start time (a start time would make it a scheduled one)
    expect(calls[0]?.body).not.toHaveProperty('scheduled_at')
    expect(ui().createMenuOpen).toBe(false)
  })

  it('keeps the name within what the server accepts (120 characters)', async () => {
    const { calls } = serveRoom()
    const { router } = await open('/', makeUser({ id: ME, name: 'N'.repeat(300) }))

    buttonWith('Start a meeting').click()
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('room'))

    expect((calls[0]?.body as { name: string }).name.length).toBeLessThanOrEqual(120)
  })

  it('says "Starting…" and ignores a second tap while the room is being made', async () => {
    const wait = deferred<void>()
    const { calls } = serveRoom(async () => {
      await wait.promise
      return { status: 201, data: { data: makeRoom({ id: 'room-9' }) } }
    })
    const { router } = await open()

    buttonWith('Start a meeting').click()
    await settle(2)
    expect(buttonWith('Start a meeting').disabled).toBe(true)
    expect(buttonWith('Start a meeting').getAttribute('aria-busy')).toBe('true')
    expect(dialog()?.textContent).toContain('Starting…')
    buttonWith('Start a meeting').click()
    wait.resolve()
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('room'))

    expect(calls).toHaveLength(1)
  })

  it('stays open and says what went wrong, so it can be tried again', async () => {
    let up = false
    const { calls } = serveRoom(() => (up ? { status: 201, data: { data: makeRoom({ id: 'room-9' }) } } : { status: 500, data: { message: 'x' } }))
    const { ui, router } = await open()

    buttonWith('Start a meeting').click()
    await settle(4)
    expect(dialog()?.querySelector('[role="alert"]')?.textContent).toBe('Something went wrong on our side. Please try again in a moment.')
    expect(ui().createMenuOpen).toBe(true)
    expect(router.currentRoute.value.name).toBe('home')

    up = true
    buttonWith('Start a meeting').click()
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('room'))
    expect(calls).toHaveLength(2)
  })

  it('explains a refusal in the server’s words, and being offline in ours', async () => {
    const replies: ReturnType<Parameters<typeof fakeApi>[0]>[] = [{ status: 422, data: { message: 'The name may not be greater than 120 characters.' } }, { network: true }]
    serveRoom(() => replies.shift() as never)
    await open()

    buttonWith('Start a meeting').click()
    await settle(4)
    expect(dialog()?.querySelector('[role="alert"]')?.textContent).toBe('The name may not be greater than 120 characters.')

    buttonWith('Start a meeting').click()
    await settle(4)
    expect(dialog()?.querySelector('[role="alert"]')?.textContent).toContain("Can't reach the server")
  })

  it('forgets an old complaint when it is opened again', async () => {
    serveRoom(() => ({ status: 500, data: { message: 'x' } }))
    const { ui } = await open()
    buttonWith('Start a meeting').click()
    await settle(4)
    expect(dialog()?.querySelector('[role="alert"]')).not.toBeNull()

    ui().createMenuOpen = false
    await settle(3)
    ui().createMenuOpen = true
    await settle(3)

    expect(dialog()?.querySelector('[role="alert"]')).toBeNull()
  })
})

export type { Room }
