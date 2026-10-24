import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { CHAT_ID, ME, PAW, deferred, fakeApi, makeChat, makeMember, makeMessage, page, person, restoreApi, signIn } from '@/__tests__/helpers'
import { useChatsStore } from '@/stores/chats'

beforeEach(() => {
  setActivePinia(createPinia())
  signIn()
})
afterEach(restoreApi)

const chatAt = (id: string, time: string, over = {}) => makeChat({ id, last_message_at: time, created_at: time, ...over })
const pin = (position: number | null) => ({ ...makeChat().my_membership, pin_position: position })

describe('the list', () => {
  it('shows the most recently active chat first', async () => {
    fakeApi(() => ({ data: page([chatAt('old', '2026-03-01T09:00:00Z'), chatAt('new', '2026-03-14T09:00:00Z'), chatAt('mid', '2026-03-10T09:00:00Z')]) }))
    const chats = useChatsStore()

    await chats.fetchChats()

    expect(chats.chats.map((c) => c.id)).toEqual(['new', 'mid', 'old'])
    expect(chats.status).toBe('ready')
  })

  it('puts pinned chats first, in their pin order', async () => {
    fakeApi(() =>
      ({ data: page([
        chatAt('recent', '2026-03-14T09:00:00Z'),
        chatAt('pin-2', '2026-03-01T09:00:00Z', { my_membership: pin(2) }),
        chatAt('pin-1', '2026-02-01T09:00:00Z', { my_membership: pin(1) }),
      ]) }),
    )
    const chats = useChatsStore()
    await chats.fetchChats()

    expect(chats.chats.map((c) => c.id)).toEqual(['pin-1', 'pin-2', 'recent'])
  })

  it('does not count muted chats in the total on the Messages badge', async () => {
    fakeApi(() =>
      ({ data: page([
        chatAt('a', '2026-03-14T09:00:00Z', { unread_count: 3 }),
        chatAt('b', '2026-03-13T09:00:00Z', { unread_count: 5, my_membership: { ...makeChat().my_membership, is_muted: true } }),
      ]) }),
    )
    const chats = useChatsStore()
    await chats.fetchChats()

    expect(chats.totalUnread).toBe(3)
  })

  it('keeps the members it knew when the list is loaded again (list rows carry none)', async () => {
    const members = [makeMember(person(ME, 'Saw Eh Doh')), makeMember(person(PAW, 'Naw Paw Say'))]
    fakeApi(() => ({ data: page([makeChat()]) }))
    const chats = useChatsStore()
    chats.put(makeChat({ members }))

    await chats.fetchChats()

    expect(chats.get(CHAT_ID)?.members).toHaveLength(2)
  })

  it('drops a chat that is no longer on the server when the first page is the whole list', async () => {
    const chats = useChatsStore()
    chats.put(makeChat({ id: 'gone' }))
    fakeApi(() => ({ data: page([makeChat({ id: 'stays' })]) }))

    await chats.fetchChats()

    expect(chats.chats.map((c) => c.id)).toEqual(['stays'])
  })

  it('keeps older chats it has loaded when the list has more pages, and only drops those the page should have shown', async () => {
    const chats = useChatsStore()
    chats.put(chatAt('older-loaded', '2026-01-01T09:00:00Z'))
    chats.put(chatAt('recent-gone', '2026-03-13T09:00:00Z'))
    fakeApi(() => ({ data: page([chatAt('newest', '2026-03-14T09:00:00Z'), chatAt('edge', '2026-03-12T09:00:00Z')], 'http://api.test/api/v1/chats?cursor=2') }))

    await chats.fetchChats()

    const ids = chats.chats.map((c) => c.id)
    expect(ids).toContain('older-loaded') // older than the page: cannot tell, so it stays
    expect(ids).not.toContain('recent-gone') // inside the page's range but missing: it was removed
    expect(chats.hasMore).toBe(true)
  })

  it('loads more with the next address and adds them', async () => {
    let call = 0
    fakeApi(() => {
      call += 1
      return call === 1 ? { data: page([chatAt('a', '2026-03-14T09:00:00Z')], 'http://api.test/api/v1/chats?cursor=2') } : { data: page([chatAt('b', '2026-03-01T09:00:00Z')]) }
    })
    const chats = useChatsStore()

    await chats.fetchChats()
    await chats.loadMore()

    expect(chats.chats.map((c) => c.id)).toEqual(['a', 'b'])
    expect(chats.hasMore).toBe(false)
  })

  it('shows an error state when the first load fails, and keeps the list on screen when a refresh fails', async () => {
    let fail = true
    fakeApi(() => (fail ? { network: true } : { data: page([makeChat()]) }))
    const chats = useChatsStore()

    await chats.fetchChats()
    expect(chats.status).toBe('error')
    expect(chats.error?.isNetwork).toBe(true)

    fail = false
    await chats.fetchChats()
    expect(chats.status).toBe('ready')

    fail = true
    await chats.fetchChats()
    expect(chats.status).toBe('ready') // not blanked
    expect(chats.chats).toHaveLength(1)
  })
})

describe('unread counts', () => {
  const setup = () => {
    const chats = useChatsStore()
    chats.put(makeChat({ latest_message: makeMessage({ sender_id: ME }) }))
    return chats
  }

  it('counts a new message from someone else, and moves the preview', () => {
    const chats = setup()
    const message = makeMessage({ content: 'New one' })

    chats.receiveMessage(message, ME)

    expect(chats.get(CHAT_ID)?.unread_count).toBe(1)
    expect(chats.get(CHAT_ID)?.latest_message?.content).toBe('New one')
    expect(chats.get(CHAT_ID)?.last_message_at).toBe(message.created_at)
  })

  it('counts a message once even though it arrives on two channels', () => {
    const chats = setup()
    const message = makeMessage()

    chats.receiveMessage(message, ME)
    chats.receiveMessage({ ...message }, ME)

    expect(chats.get(CHAT_ID)?.unread_count).toBe(1)
  })

  it('does not count your own messages, system notices, or messages the list already shows', () => {
    const chats = setup()
    const latest = chats.get(CHAT_ID)!.latest_message!

    chats.receiveMessage(makeMessage({ sender_id: ME }), ME)
    chats.receiveMessage(makeMessage({ type: 'system', sender_id: null, sender: null }), ME)
    chats.receiveMessage(latest, ME)

    expect(chats.get(CHAT_ID)?.unread_count).toBe(0)
  })

  it('does not count a message in the chat that is open and in view', () => {
    const chats = setup()
    chats.viewingId = CHAT_ID

    chats.receiveMessage(makeMessage(), ME)

    expect(chats.get(CHAT_ID)?.unread_count).toBe(0)
    expect(chats.get(CHAT_ID)?.latest_message?.content).toMatch(/Message/)
  })

  it('clears the badge when you read up to the end, here or on another device', () => {
    const chats = setup()
    const message = makeMessage()
    chats.receiveMessage(message, ME)

    chats.applyRead({ chat_id: CHAT_ID, last_read_message_id: message.id, last_read_at: 'x' })

    expect(chats.get(CHAT_ID)?.unread_count).toBe(0)
    expect(chats.get(CHAT_ID)?.my_membership.last_read_message_id).toBe(message.id)
  })

  it('takes the server’s count when it gives one (after POST /read)', () => {
    const chats = setup()
    chats.applyRead({ chat_id: CHAT_ID, last_read_message_id: 'x', last_read_at: 'x', unread_count: 2 })

    expect(chats.get(CHAT_ID)?.unread_count).toBe(2)
  })

  it('leaves the count alone when another device read an older message than the newest', () => {
    const chats = setup()
    chats.receiveMessage(makeMessage(), ME)
    chats.receiveMessage(makeMessage(), ME)

    chats.applyRead({ chat_id: CHAT_ID, last_read_message_id: 'an-older-one', last_read_at: 'x' })

    expect(chats.get(CHAT_ID)?.unread_count).toBe(2)
  })

  it('fetches a chat it does not know when a message arrives for it', async () => {
    const { calls } = fakeApi(() => ({ data: { data: makeChat({ id: 'brand-new' }) } }))
    const chats = useChatsStore()

    chats.receiveMessage(makeMessage({ chat_id: 'brand-new' }), ME)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(calls[0]?.url).toBe('/chats/brand-new')
    expect(chats.get('brand-new')).toBeDefined()
  })
})

describe('changes from events', () => {
  it('updates name, description and member count, and never moves "last activity" back', () => {
    const chats = useChatsStore()
    chats.put(makeChat({ type: 'group', name: 'Old', last_message_at: '2026-03-14T10:00:00Z' }))

    chats.applySummary({ id: CHAT_ID, type: 'group', name: 'Renamed', description: 'New text', avatar_url: null, is_encrypted: false, member_count: 4, last_message_at: '2026-03-14T09:00:00Z' })

    const chat = chats.get(CHAT_ID)
    expect(chat).toMatchObject({ name: 'Renamed', description: 'New text', member_count: 4 })
    expect(chat?.last_message_at).toBe('2026-03-14T10:00:00Z')
  })

  it('reloads the members only for a chat whose members are on screen', async () => {
    const { calls } = fakeApi(() => ({ data: { data: makeChat({ members: [] }) } }))
    const chats = useChatsStore()
    chats.put(makeChat())

    chats.membersChanged(CHAT_ID)
    expect(calls).toHaveLength(0)

    chats.put(makeChat({ members: [] }))
    chats.membersChanged(CHAT_ID)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls).toHaveLength(1)
  })
})

describe('actions', () => {
  it('opens a direct chat and puts it in the list', async () => {
    fakeApi(() => ({ status: 201, data: { data: makeChat({ id: 'direct-1' }) } }))
    const chats = useChatsStore()

    const chat = await chats.openDirect(PAW)

    expect(chat.id).toBe('direct-1')
    expect(chats.get('direct-1')).toBeDefined()
  })

  it('leaving a group removes it from the list and remembers that you chose to', async () => {
    fakeApi(() => ({ status: 204 }))
    const chats = useChatsStore()
    chats.put(makeChat({ type: 'group', name: 'G' }))

    await chats.leave(CHAT_ID)

    expect(chats.get(CHAT_ID)).toBeUndefined()
    expect(chats.lastLeftId).toBe(CHAT_ID)
  })

  it('lists the people it knows from direct chats and group members, without you, sorted by name', () => {
    const chats = useChatsStore()
    chats.put(makeChat({ id: 'd', other_user: person('zed', 'Zed') }))
    chats.put(makeChat({ id: 'g', type: 'group', other_user: undefined, members: [makeMember(person(ME, 'Me')), makeMember(person('amy', 'Amy'))] }))

    expect(chats.knownPeople(ME).map((p) => p.name)).toEqual(['Amy', 'Zed'])
  })

  it('forgets everything on reset (signing out)', () => {
    const chats = useChatsStore()
    chats.put(makeChat())
    chats.viewingId = CHAT_ID

    chats.reset()

    expect(chats.chats).toEqual([])
    expect(chats.viewingId).toBeNull()
    expect(chats.status).toBe('idle')
  })
})

describe('knowing who is in a group', () => {
  const group = (members = true) =>
    makeChat({ id: 'g1', type: 'group', name: 'Committee', other_user: undefined, ...(members ? { members: [makeMember(person(ME, 'Eh Doh')), makeMember(person(PAW, 'Naw Paw Say'))] } : {}) })

  it('asks the server for the members once, and remembers them', async () => {
    const { calls } = fakeApi(() => ({ data: { data: group() } }))
    const chats = useChatsStore()
    chats.put(group(false))

    const first = await chats.ensureMembers('g1')
    const second = await chats.ensureMembers('g1')

    expect(first.members).toHaveLength(2)
    expect(second.members).toHaveLength(2)
    expect(calls.filter((call) => call.url === '/chats/g1')).toHaveLength(1)
  })

  it('asks once when several screens ask at the same moment', async () => {
    const wait = deferred<void>()
    const { calls } = fakeApi(async () => {
      await wait.promise
      return { data: { data: group() } }
    })
    const chats = useChatsStore()
    chats.put(group(false))

    const all = Promise.all([chats.ensureMembers('g1'), chats.ensureMembers('g1'), chats.ensureMembers('g1')])
    wait.resolve()
    await all

    expect(calls).toHaveLength(1)
  })

  it('asks again after a failure', async () => {
    let up = false
    const { calls } = fakeApi(() => (up ? { data: { data: group() } } : { network: true }))
    const chats = useChatsStore()
    chats.put(group(false))

    await expect(chats.ensureMembers('g1')).rejects.toBeTruthy()
    up = true
    await chats.ensureMembers('g1')

    expect(calls).toHaveLength(2)
    expect(chats.get('g1')?.members).toHaveLength(2)
  })

  it('does not ask at all when the members are already known', async () => {
    const { calls } = fakeApi(() => ({ data: { data: group() } }))
    const chats = useChatsStore()
    chats.put(group(true))

    await chats.ensureMembers('g1')

    expect(calls).toHaveLength(0)
  })
})

describe('adding many people', () => {
  it('adds them 50 at a time (the API’s limit per request), and shows the group as it ends up', async () => {
    const ids = Array.from({ length: 120 }, (_unused, index) => `u${index}`)
    const sizes: number[] = []
    let call = 0
    const { calls } = fakeApi((request) => {
      sizes.push((request.body as { user_ids: string[] }).user_ids.length)
      call += 1
      return { data: { data: makeChat({ id: 'g1', type: 'group', name: `after ${call}`, other_user: undefined }) } }
    })
    const chats = useChatsStore()

    const chat = await chats.addMembers('g1', ids)

    expect(sizes).toEqual([50, 50, 20])
    expect(calls.every((c) => c.url === '/chats/g1/members')).toBe(true)
    expect(chat.name).toBe('after 3')
  })

  it('stops at the first refusal, keeping what was added before', async () => {
    let call = 0
    fakeApi(() => {
      call += 1
      return call === 2 ? { status: 422, data: { message: 'No' } } : { data: { data: makeChat({ id: 'g1', type: 'group', name: 'G', other_user: undefined, member_count: 52 }) } }
    })
    const chats = useChatsStore()

    await expect(chats.addMembers('g1', Array.from({ length: 80 }, (_unused, index) => `u${index}`))).rejects.toMatchObject({ status: 422 })
    expect(chats.get('g1')?.member_count).toBe(52)
  })
})

describe('"Show more chats" failing', () => {
  it('keeps the error for the button, apart from the list’s own error, and clears it on the next success', async () => {
    let online = true
    fakeApi((call) => {
      if (call.uri.includes('cursor')) return online ? { data: page([chatAt('older', '2026-01-01T09:00:00Z')]) } : { network: true }
      return { data: page([chatAt('new', '2026-03-14T09:00:00Z')], 'http://api.test/api/v1/chats?cursor=next') }
    })
    const chats = useChatsStore()
    await chats.fetchChats()

    online = false
    await chats.loadMore()
    expect(chats.loadMoreError?.isNetwork).toBe(true)
    expect(chats.error).toBeNull()
    expect(chats.status).toBe('ready')

    online = true
    await chats.loadMore()
    expect(chats.loadMoreError).toBeNull()
    expect(chats.chats.map((c) => c.id)).toEqual(['new', 'older'])
  })
})
