import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, ref } from 'vue'

import { ME, deferred, fakeApi, makeChat, makeMember, mountApp, person, restoreApi, restoreMedia, screenIs, settle, signedInStores } from '@/__tests__/helpers'
import GroupPeople from '@/components/layout/GroupPeople.vue'
import { useChatsStore } from '@/stores/chats'
import { useUiStore } from '@/stores/ui'
import type { Chat } from '@/types/chat'
import type { PublicUser } from '@/types/user'

afterEach(() => {
  restoreApi()
  restoreMedia()
})

const NAMES = ['Naw Mu Moo', 'Saw Kler Wah', 'Saw Htoo Lay', 'Naw Eh Paw', 'Saw Bee', 'Naw Ay', 'Saw Doh']
const PEOPLE: PublicUser[] = NAMES.map((name, index) => person(`p${index}`, name))

const server = new Map<string, Chat>()
function group(id: string, members: PublicUser[], minute = 0): Chat {
  const full = makeChat({
    id,
    type: 'group',
    name: `Group ${id}`,
    other_user: undefined,
    last_message_at: `2026-03-14T09:${String(59 - minute).padStart(2, '0')}:00Z`,
    members: [makeMember(person(ME, 'Saw Eh Doh')), ...members.map((user) => makeMember(user))],
  })
  server.set(id, full)
  const { members: _members, ...listed } = full
  return listed as Chat
}

async function open(chats: Chat[], options: { active?: boolean; status?: 'ready' | 'loading'; serve?: Parameters<typeof fakeApi>[0] } = {}) {
  screenIs(true)
  const log = fakeApi(options.serve ?? ((call) => (server.has(call.url.replace('/chats/', '')) ? { data: { data: server.get(call.url.replace('/chats/', '')) } } : { status: 404 })))
  const active = ref(options.active ?? true)
  const Host = defineComponent({ setup: () => () => h(GroupPeople, { active: active.value }) })
  const mounted = await mountApp(Host, {
    prepare: (pinia) => {
      signedInStores(pinia)
      const store = useChatsStore(pinia)
      for (const chat of chats) store.put(chat)
      store.status = options.status ?? 'ready'
    },
  })
  await settle(5)
  server.clear()
  return { ...mounted, ...log, active, chats: () => useChatsStore(mounted.pinia), ui: () => useUiStore(mounted.pinia) }
}

const people = (wrapper: Awaited<ReturnType<typeof open>>['wrapper']) => wrapper.findAll('li')

describe('people from your groups', () => {
  it('shows members of your groups that you have no chat with yet, by name, each with a Message button', async () => {
    const { wrapper } = await open([group('g1', [PEOPLE[0]!, PEOPLE[1]!])])

    expect(wrapper.get('h2').text()).toBe('People from your groups')
    expect(people(wrapper).map((row) => row.get('.truncate').text())).toEqual(['Naw Mu Moo', 'Saw Kler Wah'])
    const button = people(wrapper)[0]!.get('button')
    expect(button.text()).toBe('Message')
    expect(button.attributes('aria-label')).toBe('Message Naw Mu Moo')
    expect(button.classes()).toContain('min-h-11')
  })

  it('leaves out people you already chat with, and you', async () => {
    const chats = [group('g1', [PEOPLE[0]!, PEOPLE[1]!]), makeChat({ id: 'd1', other_user: PEOPLE[0]! })]
    const { wrapper } = await open(chats)

    expect(people(wrapper).map((row) => row.get('.truncate').text())).toEqual(['Saw Kler Wah'])
    expect(wrapper.text()).not.toContain('Saw Eh Doh')
  })

  it('asks for the members of five groups at most, the most recently active ones', async () => {
    const groups = Array.from({ length: 7 }, (_unused, index) => group(`g${index}`, [PEOPLE[index]!], index))
    const { calls } = await open(groups)

    expect(calls.filter((call) => call.url.startsWith('/chats/g')).map((call) => call.url).sort()).toEqual(['/chats/g0', '/chats/g1', '/chats/g2', '/chats/g3', '/chats/g4'])
  })

  it('shows five people, and "Show 2 more" for the rest', async () => {
    const { wrapper } = await open([group('g1', PEOPLE)])

    expect(people(wrapper)).toHaveLength(5)
    const more = wrapper.findAll('button').find((button) => button.text() === 'Show 2 more')!
    expect(more.attributes('aria-expanded')).toBe('false')

    await more.trigger('click')
    expect(people(wrapper)).toHaveLength(7)
    await wrapper.findAll('button').find((button) => button.text() === 'Show fewer')!.trigger('click')
    expect(people(wrapper)).toHaveLength(5)
  })

  it('says what it is for when you are in no groups, and when there is nobody new', async () => {
    const none = await open([makeChat({ id: 'd1', other_user: PEOPLE[0]! })])
    expect(none.wrapper.text()).toContain('People from the groups you are in will show here.')

    const everyone = await open([group('g1', [PEOPLE[0]!]), makeChat({ id: 'd1', other_user: PEOPLE[0]! })])
    expect(everyone.wrapper.text()).toContain('Nobody new to message right now.')
  })

  it('shows a loading state until the chat list and the members are in', async () => {
    const wait = deferred<void>()
    const slow = await open([group('g1', [PEOPLE[0]!])], {
      serve: async () => {
        await wait.promise
        return { data: { data: makeChat({ id: 'g1', type: 'group', other_user: undefined, members: [makeMember(person(ME, 'Eh Doh')), makeMember(PEOPLE[0]!)] }) } }
      },
    })
    expect(slow.wrapper.get('[role="status"]').text()).toContain('Loading…')
    wait.resolve()
    await settle(4)
    expect(slow.wrapper.find('[role="status"]').exists()).toBe(false)

    const early = await open([], { status: 'loading' })
    expect(early.wrapper.find('[role="status"]').exists()).toBe(true)
  })

  it('says some groups could not be opened, with "Try again", when it has nobody to show', async () => {
    let up = false
    const chats = [group('g1', [PEOPLE[0]!])]
    const full = server.get('g1')
    const { wrapper } = await open(chats, { serve: () => (up ? { data: { data: full } } : { network: true }) })
    expect(wrapper.get('[role="alert"]').text()).toContain('Some groups could not be opened.')

    up = true
    await wrapper.get('[role="alert"] button').trigger('click')
    await settle(4)

    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(people(wrapper)).toHaveLength(1)
  })

  it('does not ask while it is not on screen', async () => {
    const { calls } = await open([group('g1', [PEOPLE[0]!])], { active: false })

    expect(calls.filter((call) => call.url.startsWith('/chats/g'))).toHaveLength(0)
  })
})

describe('Message', () => {
  const directReply = (id: string) => ({ status: 201, data: { data: makeChat({ id, other_user: PEOPLE[0]! }) } })

  it('opens (or creates) the direct chat with that person and shows it in the drawer', async () => {
    const chats = [group('g1', [PEOPLE[0]!])]
    const full = server.get('g1')
    const { wrapper, calls, ui } = await open(chats, { serve: (call) => (call.method === 'post' ? directReply('direct-new') : { data: { data: full } }) })

    await people(wrapper)[0]!.get('button').trigger('click')
    await settle(4)

    const post = calls.find((call) => call.method === 'post')
    expect(post).toMatchObject({ url: '/chats/direct', body: { user_id: 'p0' } })
    expect(ui().drawer).toEqual({ open: true, chatId: 'direct-new' })
  })

  it('takes that person off the list once the chat exists, since there is now a chat with them', async () => {
    const chats = [group('g1', [PEOPLE[0]!, PEOPLE[1]!])]
    const full = server.get('g1')
    const { wrapper } = await open(chats, { serve: (call) => (call.method === 'post' ? directReply('direct-new') : { data: { data: full } }) })

    await people(wrapper)[0]!.get('button').trigger('click')
    await settle(4)

    expect(people(wrapper).map((row) => row.get('.truncate').text())).toEqual(['Saw Kler Wah'])
  })

  it('disables the other buttons while one chat is being opened, so only one request goes out', async () => {
    const chats = [group('g1', [PEOPLE[0]!, PEOPLE[1]!])]
    const full = server.get('g1')
    const wait = deferred<void>()
    const { wrapper, calls } = await open(chats, {
      serve: async (call) => {
        if (call.method === 'post') {
          await wait.promise
          return directReply('direct-new')
        }
        return { data: { data: full } }
      },
    })

    await people(wrapper)[0]!.get('button').trigger('click')
    expect(people(wrapper).every((row) => (row.get('button').element as HTMLButtonElement).disabled)).toBe(true)
    expect(people(wrapper)[0]!.get('button').attributes('aria-busy')).toBe('true')
    await people(wrapper)[1]!.get('button').trigger('click')
    wait.resolve()
    await settle(4)

    expect(calls.filter((call) => call.method === 'post')).toHaveLength(1)
  })

  it('says so when the chat cannot be opened, and leaves the person in the list', async () => {
    const chats = [group('g1', [PEOPLE[0]!])]
    const full = server.get('g1')
    const { wrapper, ui } = await open(chats, { serve: (call) => (call.method === 'post' ? { network: true } : { data: { data: full } }) })

    await people(wrapper)[0]!.get('button').trigger('click')
    await settle(4)

    expect(ui().toasts[0]).toMatchObject({ kind: 'error', message: 'The chat could not be opened.' })
    expect(people(wrapper)).toHaveLength(1)
  })
})
