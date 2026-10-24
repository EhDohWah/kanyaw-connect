import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ME, deferred, fakeApi, makeChat, makeMember, mountApp, page, person, restoreApi, restoreMedia, screenIs, settle, signedInStores } from '@/__tests__/helpers'
import OnlineNow from '@/components/layout/OnlineNow.vue'
import { useChatsStore } from '@/stores/chats'
import { usePresenceStore } from '@/stores/presence'
import { useUiStore } from '@/stores/ui'
import type { PublicUser } from '@/types/user'

beforeEach(() => screenIs(true))
afterEach(() => {
  restoreApi()
  restoreMedia()
})

const PEOPLE: PublicUser[] = ['Naw Paw Say', 'Saw Htoo Lay', 'Naw Mu Moo', 'Saw Kler Wah', 'Naw Eh Paw', 'Saw Bee', 'Naw Ay', 'Saw Doh', 'Naw Say', 'Saw Lay'].map((name, index) => person(`p${index}`, name))

/** Two direct chats and a group: the people the app can name. `onlineIds` are the ones the server says are online. */
async function open(options: { direct?: PublicUser[]; group?: PublicUser[]; online?: string[]; chats?: 'ready' | 'loading'; presence?: 'ready' | 'loading' | 'error' } = {}) {
  const { direct = PEOPLE.slice(0, 2), group = [], online = [], chats: chatsStatus = 'ready', presence: presenceStatus = 'ready' } = options
  const mounted = await mountApp(OnlineNow, {
    prepare: (pinia) => {
      signedInStores(pinia)
      const chats = useChatsStore(pinia)
      for (const user of direct) chats.put(makeChat({ id: `direct-${user.id}`, other_user: user }))
      if (group.length > 0) {
        chats.put(makeChat({ id: 'g1', type: 'group', name: 'Committee', other_user: undefined, members: [makeMember(person(ME, 'Saw Eh Doh')), ...group.map((user) => makeMember(user))] }))
      }
      chats.status = chatsStatus
      const presence = usePresenceStore(pinia)
      presence.byId = Object.fromEntries(online.map((id) => [id, { id, status: 'online' as const, last_seen_at: null }]))
      presence.status = presenceStatus
    },
  })
  await settle(2)
  return { ...mounted, presence: () => usePresenceStore(mounted.pinia), ui: () => useUiStore(mounted.pinia), chats: () => useChatsStore(mounted.pinia) }
}

const rows = (wrapper: Awaited<ReturnType<typeof open>>['wrapper']) => wrapper.findAll('li button')
const names = (wrapper: Awaited<ReturnType<typeof open>>['wrapper']) => rows(wrapper).map((row) => row.get('.truncate').text())

describe('who is online', () => {
  it('lists the people from your chats who are online, by name, with a count', async () => {
    const { wrapper } = await open({ online: ['p0'] })

    expect(wrapper.get('h2').text()).toContain('Online now')
    expect(wrapper.get('h2').text()).toContain('1')
    expect(names(wrapper)).toEqual(['Naw Paw Say'])
  })

  it('leaves out people who are not online', async () => {
    const { wrapper } = await open({ online: ['p1'] })

    expect(names(wrapper)).toEqual(['Saw Htoo Lay'])
  })

  it('includes people known only from a group, in name order', async () => {
    const { wrapper } = await open({ direct: [PEOPLE[0]!], group: [PEOPLE[3]!, PEOPLE[2]!], online: ['p0', 'p2', 'p3'] })

    expect(names(wrapper)).toEqual(['Naw Mu Moo', 'Naw Paw Say', 'Saw Kler Wah'])
  })

  it('has a button per person, named for what it does, and a green dot that is for the eyes only', async () => {
    const { wrapper } = await open({ online: ['p0'] })

    const row = rows(wrapper)[0]!
    expect(row.attributes('aria-label')).toBe('Message Naw Paw Say')
    expect(row.classes()).toContain('min-h-11')
    expect(row.find('.bg-success').attributes('aria-hidden')).toBe('true')
  })

  it('says nobody is online, and says what it shows when there is nobody to ask about', async () => {
    const nobody = await open({ online: [] })
    expect(nobody.wrapper.text()).toContain('Nobody is online right now.')

    const alone = await open({ direct: [], online: [] })
    expect(alone.wrapper.text()).toContain('The people you chat with will show here when they are online.')
  })

  it('shows a loading state until the chats and the first answer are in', async () => {
    const chats = await open({ chats: 'loading' })
    expect(chats.wrapper.get('[role="status"]').text()).toContain('Loading…')
    expect(chats.wrapper.findAll('li')).toHaveLength(0)

    const presence = await open({ presence: 'loading' })
    expect(presence.wrapper.find('[role="status"]').exists()).toBe(true)
  })

  it('does not wait for an answer when there is nobody to ask about', async () => {
    const { wrapper } = await open({ direct: [], presence: 'loading' })

    expect(wrapper.find('[role="status"]').exists()).toBe(false)
  })

  it('says it could not check, with "Try again", which asks about everyone it knows', async () => {
    const { calls } = fakeApi(() => ({ data: { data: [{ id: 'p0', status: 'online', last_seen_at: null }] } }))
    const { wrapper, presence } = await open({ presence: 'error' })
    expect(wrapper.get('[role="alert"]').text()).toContain('We could not check who is online.')

    await wrapper.get('[role="alert"] button').trigger('click')
    await settle(3)

    const asked = decodeURIComponent(calls[0]?.uri ?? '')
    expect(asked).toContain('ids[]=p0')
    expect(asked).toContain('ids[]=p1')
    expect(presence().status).toBe('ready')
    expect(names(wrapper)).toEqual(['Naw Paw Say'])
  })

  it('keeps showing who it knew about when a later check fails', async () => {
    const { wrapper, presence } = await open({ online: ['p0'] })

    presence().status = 'ready'
    await settle(1)

    expect(rows(wrapper)).toHaveLength(1)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })
})

describe('a long list', () => {
  const everyone = PEOPLE.map((user) => user.id)

  it('shows eight, and "Show 2 more" for the rest, which opens and closes the rest', async () => {
    const { wrapper } = await open({ direct: PEOPLE, online: everyone })

    expect(rows(wrapper).filter((row) => row.attributes('aria-label')?.startsWith('Message'))).toHaveLength(8)
    const more = wrapper.findAll('button').find((button) => button.text() === 'Show 2 more')!
    expect(more.attributes('aria-expanded')).toBe('false')

    await more.trigger('click')
    expect(wrapper.findAll('li')).toHaveLength(10)
    const less = wrapper.findAll('button').find((button) => button.text() === 'Show fewer')!
    expect(less.attributes('aria-expanded')).toBe('true')

    await less.trigger('click')
    expect(wrapper.findAll('li')).toHaveLength(8)
  })

  it('has no "Show more" for eight or fewer', async () => {
    const { wrapper } = await open({ direct: PEOPLE.slice(0, 8), online: everyone.slice(0, 8) })

    expect(wrapper.findAll('button').some((button) => button.text().startsWith('Show'))).toBe(false)
  })
})

describe('starting a chat with someone online', () => {
  it('opens (or creates) the direct chat and shows it in the chat drawer', async () => {
    const { calls } = fakeApi(() => ({ status: 200, data: { data: makeChat({ id: 'direct-p0' }) } }))
    const { wrapper, ui } = await open({ online: ['p0'] })

    await rows(wrapper)[0]!.trigger('click')
    await settle(3)

    expect(calls[0]).toMatchObject({ method: 'post', url: '/chats/direct', body: { user_id: 'p0' } })
    expect(ui().drawer).toEqual({ open: true, chatId: 'direct-p0' })
  })

  it('can only be pressed once while the chat is opening', async () => {
    const wait = deferred<void>()
    const { calls } = fakeApi(async () => {
      await wait.promise
      return { data: { data: makeChat({ id: 'direct-p0' }) } }
    })
    const { wrapper } = await open({ online: ['p0', 'p1'] })

    await rows(wrapper)[0]!.trigger('click')
    expect((rows(wrapper)[0]!.element as HTMLButtonElement).disabled).toBe(true)
    await rows(wrapper)[1]!.trigger('click')
    wait.resolve()
    await settle(3)

    expect(calls).toHaveLength(1)
  })

  it('says so when the chat cannot be opened', async () => {
    fakeApi(() => ({ network: true }))
    const { wrapper, ui } = await open({ online: ['p0'] })

    await rows(wrapper)[0]!.trigger('click')
    await settle(3)

    expect(ui().toasts[0]).toMatchObject({ kind: 'error', message: 'The chat could not be opened.' })
  })
})

void page
