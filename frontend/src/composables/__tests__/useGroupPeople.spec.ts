import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, ref, type Ref } from 'vue'

import { ME, PAW, fakeApi, makeChat, makeMember, mountApp, person, restoreApi, settle, signedInStores } from '@/__tests__/helpers'
import { GROUP_PEOPLE_GROUPS, useGroupPeople } from '@/composables/useGroupPeople'
import { useChatsStore } from '@/stores/chats'
import type { Chat } from '@/types/chat'

afterEach(() => {
  restoreApi()
  onServer.clear()
})

const NAMES = ['Zaw Zaw', 'Naw Mu Moo', 'Saw Kler Wah', 'Saw Htoo Lay', 'Naw Eh Paw', 'Saw Bee', 'Naw Ay']
const who = (index: number) => person(`person-${index}`, NAMES[index] ?? `Person ${index}`)

/** What the server knows about each group: always with its members (the list endpoint leaves them out). */
const onServer = new Map<string, Chat>()

const group = (id: string, members: number[], time: string, withMembers = false): Chat => {
  const full = makeChat({
    id,
    type: 'group',
    name: `Group ${id}`,
    other_user: undefined,
    last_message_at: time,
    created_at: time,
    members: [makeMember(person(ME, 'Saw Eh Doh')), ...members.map((n) => makeMember(who(n)))],
  })
  onServer.set(id, full)
  const { members: _members, ...listed } = full
  return withMembers ? full : (listed as Chat)
}

const direct = (user = person(PAW, 'Naw Paw Say')) => makeChat({ id: `direct-${user.id}`, other_user: user, last_message_at: '2026-03-20T09:00:00Z' })

/** What the server answers for `GET /chats/{id}`: the group with its members. */
function serveGroups(groups: Chat[], log: string[] = []) {
  return fakeApi((call) => {
    const found = groups.map((candidate) => onServer.get(candidate.id)).find((candidate) => candidate && call.url === `/chats/${candidate.id}`)
    if (found) log.push(found.id)
    return found ? { data: { data: found } } : { status: 404 }
  })
}

async function mountHost(chats: Chat[], active: Ref<boolean> = ref(true), status: 'ready' | 'loading' = 'ready') {
  let seen!: ReturnType<typeof useGroupPeople>
  const Host = defineComponent({
    setup() {
      seen = useGroupPeople(active)
      return () => h('div')
    },
  })
  const mounted = await mountApp(Host, {
    prepare: (pinia) => {
      signedInStores(pinia)
      const store = useChatsStore(pinia)
      for (const chat of chats) store.put(chat)
      store.status = status
    },
  })
  return { ...mounted, seen: () => seen, chats: () => useChatsStore(mounted.pinia) }
}

describe('people from your groups', () => {
  it('offers members of your groups, by name, but not you', async () => {
    const groups = [group('g1', [1, 2], '2026-03-14T09:00:00Z', true)]
    serveGroups(groups)
    const { seen } = await mountHost(groups)
    await settle(3)

    expect(seen().people.value.map((p) => p.name)).toEqual(['Naw Mu Moo', 'Saw Kler Wah'])
  })

  it('leaves out people you already have a direct chat with', async () => {
    const groups = [group('g1', [1, 2], '2026-03-14T09:00:00Z', true)]
    serveGroups(groups)
    const { seen } = await mountHost([...groups, direct(who(1))])
    await settle(3)

    expect(seen().people.value.map((p) => p.name)).toEqual(['Saw Kler Wah'])
  })

  it('lists a person once even when they are in several groups', async () => {
    const groups = [group('g1', [1], '2026-03-14T09:00:00Z', true), group('g2', [1, 2], '2026-03-13T09:00:00Z', true)]
    serveGroups(groups)
    const { seen } = await mountHost(groups)
    await settle(3)

    expect(seen().people.value.map((p) => p.name)).toEqual(['Naw Mu Moo', 'Saw Kler Wah'])
  })

  it('looks inside only your five most recently active groups', async () => {
    const groups = Array.from({ length: 7 }, (_unused, index) => group(`g${index}`, [index % 6], `2026-03-${20 - index}T09:00:00Z`))
    const asked: string[] = []
    serveGroups(groups, asked)
    await mountHost(groups)
    await settle(4)

    expect(GROUP_PEOPLE_GROUPS).toBe(5)
    expect(asked.sort()).toEqual(['g0', 'g1', 'g2', 'g3', 'g4'])
  })

  it('offers nobody from a group outside the five, even when its members happen to be known', async () => {
    const groups = Array.from({ length: 6 }, (_unused, index) => group(`g${index}`, [index], `2026-03-${20 - index}T09:00:00Z`, true))
    serveGroups(groups)
    const { seen } = await mountHost(groups)
    await settle(3)

    expect(seen().people.value.map((p) => p.id)).not.toContain('person-5')
    expect(seen().people.value).toHaveLength(5)
  })

  it('asks for the members of a group once for the whole session', async () => {
    const groups = [group('g1', [1], '2026-03-14T09:00:00Z')]
    const asked: string[] = []
    serveGroups(groups, asked)
    const { seen } = await mountHost(groups)
    await settle(4)

    await seen().retry()
    await settle(2)

    expect(asked).toEqual(['g1'])
    expect(seen().people.value).toHaveLength(1)
  })

  it('does not ask while it is not shown, and starts when it is', async () => {
    const groups = [group('g1', [1], '2026-03-14T09:00:00Z')]
    const asked: string[] = []
    serveGroups(groups, asked)
    const active = ref(false)
    await mountHost(groups, active)
    await settle(3)
    expect(asked).toEqual([])

    active.value = true
    await settle(4)

    expect(asked).toEqual(['g1'])
  })

  it('waits for the list of chats, then starts', async () => {
    const groups = [group('g1', [1], '2026-03-14T09:00:00Z')]
    const asked: string[] = []
    serveGroups(groups, asked)
    const { chats } = await mountHost(groups, ref(true), 'loading')
    await settle(3)
    expect(asked).toEqual([])

    chats().status = 'ready'
    await settle(4)

    expect(asked).toEqual(['g1'])
  })

  it('picks up a new group that arrives while it is shown', async () => {
    const groups = [group('g1', [1], '2026-03-14T09:00:00Z')]
    const asked: string[] = []
    const added = group('g2', [2], '2026-03-21T09:00:00Z')
    serveGroups([...groups, added], asked)
    const { chats } = await mountHost(groups)
    await settle(4)

    chats().put(added)
    await settle(4)

    expect(asked).toEqual(['g1', 'g2'])
  })

  it('says it failed when a group could not be opened, shows the others, and recovers on retry', async () => {
    const groups = [group('g1', [1], '2026-03-14T09:00:00Z'), group('g2', [2], '2026-03-13T09:00:00Z')]
    let g2Works = false
    fakeApi((call) => {
      if (call.url === '/chats/g1') return { data: { data: onServer.get('g1') } }
      if (call.url === '/chats/g2') return g2Works ? { data: { data: onServer.get('g2') } } : { network: true }
      return { status: 404 }
    })
    const { seen } = await mountHost(groups)
    await settle(4)

    expect(seen().failed.value).toBe(true)
    expect(seen().people.value.map((p) => p.name)).toEqual(['Naw Mu Moo'])

    g2Works = true
    await seen().retry()

    expect(seen().failed.value).toBe(false)
    expect(seen().people.value).toHaveLength(2)
  })

  it('is empty, and not loading, when you are in no groups', async () => {
    const { seen } = await mountHost([direct()])
    await settle(2)

    expect(seen().people.value).toEqual([])
    expect(seen().groups.value).toEqual([])
    expect(seen().loading.value).toBe(false)
  })
})
