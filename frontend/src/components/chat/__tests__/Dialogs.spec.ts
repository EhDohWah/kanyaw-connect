import type { Pinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CHAT_ID, ME, PAW, fakeApi, makeChat, makeMember, makeMessage, mountApp, page, person, restoreApi, settle, signedInStores, type Call } from '@/__tests__/helpers'
import GroupInfoDialog from '@/components/chat/GroupInfoDialog.vue'
import NewChatDialog from '@/components/chat/NewChatDialog.vue'
import NewGroupDialog from '@/components/chat/NewGroupDialog.vue'
import PeoplePicker from '@/components/chat/PeoplePicker.vue'
import { useChatsStore } from '@/stores/chats'
import { useUiStore } from '@/stores/ui'
import type { MemberRole } from '@/types/chat'

afterEach(restoreApi)

const HTOO = '0195e2c4-0005-7a04-8104-5f3a9c007bbc'
const MU = '0195e2c4-0006-7a05-8105-5f3a9c009aab'

/** The dialogs are drawn at the end of the page (outside the component's own element): look there. */
const dialog = () => document.body.querySelector<HTMLElement>('[role=dialog]')
const buttons = (root: ParentNode = document.body) => [...root.querySelectorAll<HTMLButtonElement>('button')]
const byText = (text: string | RegExp, root: ParentNode = document.body) =>
  buttons(root).find((b) => (typeof text === 'string' ? b.textContent?.trim() === text : text.test(b.textContent ?? '')))
const labelled = (label: string, root: ParentNode = document.body) => root.querySelector<HTMLElement>(`[aria-label="${label}"]`)

/** A group of four people: you, Paw, Htoo, Mu, with the given role for you and roles for the others. */
function groupChat(myRole: MemberRole, roles: Partial<Record<string, MemberRole>> = {}) {
  const people = [person(ME, 'Saw Eh Doh'), person(PAW, 'Naw Paw Say'), person(HTOO, 'Saw Htoo Lay'), person(MU, 'Naw Mu Moo')]
  return makeChat({
    type: 'group',
    name: 'Committee',
    description: 'Planning',
    other_user: undefined,
    member_count: 4,
    my_membership: { ...makeChat().my_membership, role: myRole },
    members: people.map((p) => makeMember(p, p.id === ME ? myRole : (roles[p.id] ?? 'member'))),
  })
}

function openGroupInfo(chat = groupChat('owner'), setup: (pinia: Pinia) => void = () => undefined) {
  return mountApp(GroupInfoDialog, {
    props: { open: true, chatId: chat.id },
    prepare: (pinia) => {
      signedInStores(pinia)
      useChatsStore(pinia).put(chat)
      setup(pinia)
    },
  })
}

describe('group info: who may do what', () => {
  it('shows the name, description, member count and everyone with their role', async () => {
    await openGroupInfo()

    const text = dialog()?.textContent ?? ''
    expect(text).toContain('Committee')
    expect(text).toContain('Planning')
    expect(text).toContain('4 members')
    expect(text).toContain('Saw Eh Doh')
    expect(text).toContain('(You)')
    expect(text).toContain('Owner')
  })

  it('lets the owner rename, add people, change roles and remove anyone, but not themselves', async () => {
    await openGroupInfo(groupChat('owner', { [PAW]: 'admin' }))

    expect(labelled('Edit name and description')).not.toBeNull()
    expect(byText(/Add people/)).toBeDefined()
    const rows = [...(dialog()?.querySelectorAll('ul li') ?? [])]
    const rowOf = (name: string) => rows.find((r) => r.textContent?.includes(name))!
    expect(byText('Remove admin', rowOf('Naw Paw Say'))).toBeDefined()
    expect(byText('Remove', rowOf('Naw Paw Say'))).toBeDefined()
    expect(byText('Make admin', rowOf('Saw Htoo Lay'))).toBeDefined()
    expect(byText('Remove', rowOf('Saw Htoo Lay'))).toBeDefined()
    expect(buttons(rowOf('Saw Eh Doh'))).toHaveLength(0)
  })

  it('lets an admin rename, add people and remove plain members, but not other admins, the owner or change roles', async () => {
    await openGroupInfo(groupChat('admin', { [PAW]: 'owner', [HTOO]: 'admin' }))

    expect(labelled('Edit name and description')).not.toBeNull()
    expect(byText(/Add people/)).toBeDefined()
    const rows = [...(dialog()?.querySelectorAll('ul li') ?? [])]
    const rowOf = (name: string) => rows.find((r) => r.textContent?.includes(name))!
    expect(buttons(rowOf('Naw Paw Say'))).toHaveLength(0) // the owner
    expect(buttons(rowOf('Saw Htoo Lay'))).toHaveLength(0) // another admin
    expect(byText('Remove', rowOf('Naw Mu Moo'))).toBeDefined() // a plain member
    expect(byText(/Make admin|Remove admin/)).toBeUndefined()
  })

  it('gives a plain member nothing to change, only a way to leave', async () => {
    await openGroupInfo(groupChat('member', { [PAW]: 'owner' }))

    expect(labelled('Edit name and description')).toBeNull()
    expect(byText(/Add people/)).toBeUndefined()
    expect(byText('Remove')).toBeUndefined()
    expect(byText(/Make admin/)).toBeUndefined()
    expect(byText('Leave group')).toBeDefined()
  })
})

describe('group info: actions', () => {
  it('removes a member only after confirming, then shows the updated list', async () => {
    const after = groupChat('owner')
    after.members = after.members?.filter((m) => m.user_id !== MU)
    after.member_count = 3
    const { calls } = fakeApi((call) => (call.method === 'get' ? { data: { data: after } } : { status: 204 }))
    await openGroupInfo()

    const row = [...(dialog()?.querySelectorAll('ul li') ?? [])].find((r) => r.textContent?.includes('Naw Mu Moo'))!
    byText('Remove', row)?.click()
    await settle(2)
    expect(document.body.textContent).toContain('Remove Naw Mu Moo?')
    expect(calls.some((c) => c.method === 'delete')).toBe(false)

    const confirm = [...document.body.querySelectorAll('[role=dialog]')].at(-1)!
    byText('Remove', confirm)?.click()
    await settle(4)

    expect(calls.find((c) => c.method === 'delete')?.url).toBe(`/chats/${CHAT_ID}/members/${MU}`)
    expect(document.body.textContent).not.toContain('Naw Mu Moo')
  })

  it('makes someone an admin', async () => {
    const { calls } = fakeApi(() => ({ data: { data: groupChat('owner', { [HTOO]: 'admin' }) } }))
    await openGroupInfo()
    const row = [...(dialog()?.querySelectorAll('ul li') ?? [])].find((r) => r.textContent?.includes('Saw Htoo Lay'))!

    byText('Make admin', row)?.click()
    await settle(3)

    expect(calls[0]).toMatchObject({ method: 'patch', url: `/chats/${CHAT_ID}/members/${HTOO}`, body: { role: 'admin' } })
    expect(document.body.textContent).toContain('Admin')
  })

  it('shows why a change failed, in the dialog', async () => {
    fakeApi(() => ({ status: 403, data: { message: 'Only the owner can change roles.' } }))
    await openGroupInfo()
    const row = [...(dialog()?.querySelectorAll('ul li') ?? [])].find((r) => r.textContent?.includes('Saw Htoo Lay'))!

    byText('Make admin', row)?.click()
    await settle(3)

    expect(dialog()?.querySelector('[role=alert]')?.textContent).toBe('Only the owner can change roles.')
  })

  it('renames the group, and clears the description when it is left empty', async () => {
    const { calls } = fakeApi(() => ({ data: { data: { ...groupChat('owner'), name: 'New name', description: null } } }))
    const { pinia } = await openGroupInfo()

    labelled('Edit name and description')?.click()
    await settle(2)
    const inputs = dialog()!.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')
    const [name, description] = [inputs[0]!, inputs[1]!]
    name.value = '  New name '
    name.dispatchEvent(new Event('input'))
    description.value = ''
    description.dispatchEvent(new Event('input'))
    await settle(1)
    byText('Save changes')?.click()
    await settle(3)

    expect(calls[0]).toMatchObject({ method: 'patch', url: `/chats/${CHAT_ID}`, body: { name: 'New name', description: null } })
    expect(useChatsStore(pinia).get(CHAT_ID)?.name).toBe('New name')
  })

  it('does not accept an empty name', async () => {
    const { calls } = fakeApi(() => ({ data: { data: groupChat('owner') } }))
    await openGroupInfo()

    labelled('Edit name and description')?.click()
    await settle(2)
    const name = dialog()!.querySelector<HTMLInputElement>('input')!
    name.value = '  '
    name.dispatchEvent(new Event('input'))
    await settle(1)
    byText('Save changes')?.click()
    await settle(2)

    expect(dialog()?.textContent).toContain('Enter a name for the group.')
    expect(calls.some((c) => c.method === 'patch')).toBe(false)
  })

  it('adds people who are not in the group yet, and only those', async () => {
    const outsider = person('0195e2c4-0007-7a06-8106-5f3a9c00aabb', 'Saw Kler Wah')
    const { calls } = fakeApi(() => ({ data: { data: groupChat('owner') } }))
    await openGroupInfo(groupChat('owner'), (pinia) => {
      useChatsStore(pinia).put(makeChat({ id: 'direct-kler', other_user: outsider }))
    })

    byText(/Add people/)?.click()
    await settle(3)
    const names = [...(dialog()?.querySelectorAll('button[aria-pressed]') ?? [])].map((b) => b.textContent?.trim() ?? '')
    expect(names.some((n) => n.includes('Saw Kler Wah'))).toBe(true)
    expect(names.some((n) => n.includes('Naw Paw Say'))).toBe(false) // already in
    expect(byText('Add')?.hasAttribute('disabled')).toBe(true)

    dialog()!.querySelector<HTMLButtonElement>('button[aria-pressed]')!.click()
    await settle(2)
    byText('Add')?.click()
    await settle(3)

    expect(calls[0]).toMatchObject({ method: 'post', url: `/chats/${CHAT_ID}/members`, body: { user_ids: [outsider.id] } })
  })

  it('leaves the group after confirming: the chat goes from the list, with a word of thanks', async () => {
    const { calls } = fakeApi(() => ({ status: 204 }))
    const { pinia } = await openGroupInfo()

    byText('Leave group')?.click()
    await settle(2)
    expect(document.body.textContent).toContain('Leave this group?')
    const confirm = [...document.body.querySelectorAll('[role=dialog]')].at(-1)!
    byText('Leave group', confirm)?.click()
    await settle(4)

    expect(calls[0]).toMatchObject({ method: 'delete', url: `/chats/${CHAT_ID}/leave` })
    expect(useChatsStore(pinia).get(CHAT_ID)).toBeUndefined()
    expect(useUiStore(pinia).toasts.map((t) => t.message)).toContain('You left the group')
  })

  it('stays in the group when leaving is cancelled', async () => {
    const { calls } = fakeApi(() => ({ status: 204 }))
    const { pinia } = await openGroupInfo()

    byText('Leave group')?.click()
    await settle(2)
    const confirm = [...document.body.querySelectorAll('[role=dialog]')].at(-1)!
    byText('Cancel', confirm)?.click()
    await settle(3)

    expect(calls).toHaveLength(0)
    expect(useChatsStore(pinia).get(CHAT_ID)).toBeDefined()
  })
})

describe('new group', () => {
  const known = (pinia: Pinia) => {
    const chats = useChatsStore(pinia)
    chats.status = 'ready'
    chats.put(makeChat({ id: 'd1', other_user: person(PAW, 'Naw Paw Say') }))
    chats.put(makeChat({ id: 'd2', other_user: person(HTOO, 'Saw Htoo Lay') }))
    useUiStore(pinia).newGroupOpen = true
  }
  const open = () => mountApp(NewGroupDialog, { prepare: (pinia) => { signedInStores(pinia); known(pinia) } })
  const setValue = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    el.value = value
    el.dispatchEvent(new Event('input'))
  }

  it('asks for a name and at least one person', async () => {
    await open()
    byText('Create group')?.click()
    await settle(2)

    expect(dialog()?.textContent).toContain('Enter a name for the group.')
    expect(dialog()?.textContent).toContain('Choose at least one person.')
  })

  it('creates the group with the chosen people (never you), and opens it', async () => {
    const { calls } = fakeApi(() => ({ status: 201, data: { data: groupChat('owner') } }))
    const { router, pinia } = await open()

    setValue(dialog()!.querySelector('input')!, '  Our group ')
    setValue(dialog()!.querySelector('textarea')!, '')
    for (const person of [...dialog()!.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')]) {
      person.click()
      await settle(1) // one tap at a time, as a person does
    }
    expect(dialog()?.textContent).toContain('2 selected')
    byText('Create group')?.click()
    await settle(4)

    const body = calls[0]?.body as { name: string; member_ids: string[]; description?: string }
    expect(calls[0]).toMatchObject({ method: 'post', url: '/chats/group' })
    expect(body.name).toBe('Our group')
    expect(body.description).toBeUndefined() // a blank description is not sent
    expect([...body.member_ids].sort()).toEqual([HTOO, PAW].sort())
    expect(body.member_ids).not.toContain(ME)
    expect(useUiStore(pinia).newGroupOpen).toBe(false)
    // Opening it goes through the router, which loads the chat page first: give that time on a busy machine.
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe(`/chats/${CHAT_ID}`))
  })

  it('shows the server’s complaint about the name under it', async () => {
    fakeApi(() => ({ status: 422, data: { message: 'The name field is too long.', errors: { name: ['The name field is too long.'] } } }))
    await open()

    setValue(dialog()!.querySelector('input')!, 'x')
    dialog()!.querySelector<HTMLButtonElement>('button[aria-pressed]')!.click()
    await settle(1)
    byText('Create group')?.click()
    await settle(4)

    expect(dialog()?.textContent).toContain('The name field is too long.')
    expect(dialog()?.querySelector('input')?.getAttribute('aria-invalid')).toBe('true')
  })
})

describe('new chat', () => {
  const open = (setup: (pinia: Pinia) => void = () => undefined) =>
    mountApp(NewChatDialog, {
      prepare: (pinia) => {
        signedInStores(pinia)
        const chats = useChatsStore(pinia)
        chats.status = 'ready'
        chats.put(makeChat({ id: 'd1', other_user: person(PAW, 'Naw Paw Say') }))
        useUiStore(pinia).newChatOpen = true
        setup(pinia)
      },
    })

  it('says how to reach someone new, and lists the people from the chats', async () => {
    await open()

    expect(dialog()?.textContent).toContain('To message someone new, add them to a group first.')
    expect(dialog()?.textContent).toContain('Naw Paw Say')
  })

  it('opens (or creates) the chat with the person chosen, and goes to it', async () => {
    const { calls } = fakeApi(() => ({ status: 200, data: { data: makeChat({ id: 'd1' }) } }))
    const { router, pinia } = await open()

    byText(/Naw Paw Say/)?.click()
    await settle(4)

    expect(calls[0]).toMatchObject({ method: 'post', url: '/chats/direct', body: { user_id: PAW } })
    expect(useUiStore(pinia).newChatOpen).toBe(false)
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/chats/d1'))
  })

  it('says so when the chat could not be opened, and stays', async () => {
    fakeApi(() => ({ network: true }))
    const { pinia } = await open()

    byText(/Naw Paw Say/)?.click()
    await settle(4)

    expect(useUiStore(pinia).toasts.map((t) => t.message)).toContain('The chat could not be opened.')
    expect(useUiStore(pinia).newChatOpen).toBe(true)
  })

  it('the chat list could not be loaded: says so (not "nobody yet"), and "Try again" asks for it again', async () => {
    const { calls } = fakeApi(() => ({ data: page([makeChat({ id: 'd1', other_user: person(PAW, 'Naw Paw Say') })]) }))
    const { pinia } = await open((p) => {
      useChatsStore(p).status = 'error'
      useChatsStore(p).byId = {}
    })

    expect(dialog()?.textContent).toContain("Couldn't load the people from your chats.")
    expect(dialog()?.textContent).not.toContain('You do not have anyone to message yet.')
    byText('Try again', dialog()!)?.click()
    await settle(4)

    expect(calls.filter((c) => c.method === 'get' && c.url === '/chats')).toHaveLength(1)
    expect(useChatsStore(pinia).status).toBe('ready')
    expect(dialog()?.textContent).toContain('Naw Paw Say')
  })

  it('a group that could not be opened: shows the others, says some are missing, and "Try again" opens it again', async () => {
    const group = groupChat('owner')
    let fail = true
    const { calls } = fakeApi((call) => (call.url === `/chats/${CHAT_ID}` ? (fail ? { network: true } : { data: { data: group } }) : { data: page([]) }))
    await open((p) => useChatsStore(p).put({ ...group, members: undefined }))
    await settle(4)

    expect(dialog()?.textContent).toContain('Naw Paw Say')
    expect(dialog()?.textContent).toContain('Some people from your groups could not be loaded.')
    fail = false
    byText('Try again', dialog()!)?.click()
    await settle(4)

    expect(calls.filter((c) => c.url === `/chats/${CHAT_ID}`)).toHaveLength(2)
    expect(dialog()?.textContent).toContain('Naw Mu Moo')
    expect(dialog()?.textContent).not.toContain('could not be loaded')
  })

  it('learns who is in your groups even when the dialog is opened before the chat list has arrived', async () => {
    const group = groupChat('owner')
    const { calls } = fakeApi((call) => (call.url === `/chats/${CHAT_ID}` ? { data: { data: group } } : { data: page([]) }))
    const { pinia } = await open((p) => {
      useChatsStore(p).status = 'loading' // the list has not arrived yet
      useChatsStore(p).byId = {}
    })
    expect(dialog()?.textContent).not.toContain('Naw Mu Moo')

    // the list arrives a moment later, with a group whose members are not known yet
    const chats = useChatsStore(pinia)
    chats.put({ ...group, members: undefined })
    chats.status = 'ready'
    await settle(4)

    expect(calls.some((c) => c.url === `/chats/${CHAT_ID}`)).toBe(true)
    expect(dialog()?.textContent).toContain('Naw Mu Moo')
  })
})

describe('people picker', () => {
  const people = [person('1', 'Amy Moe'), person('2', 'Ben Paw'), person('3', 'Cho Say')]
  const mountPicker = (props: Record<string, unknown> = {}) => mountApp(PeoplePicker, { props: { people, emptyText: 'Nobody here', ...props } })

  it('filters by what is typed, ignoring case', async () => {
    const { wrapper } = await mountPicker()

    await wrapper.get('input').setValue('PAW')

    expect(wrapper.findAll('li')).toHaveLength(1)
    expect(wrapper.text()).toContain('Ben Paw')
  })

  it('says when nobody matches, and when there is nobody at all', async () => {
    const { wrapper } = await mountPicker()
    await wrapper.get('input').setValue('zzz')
    expect(wrapper.text()).toContain('Nobody matches “zzz”.')

    const empty = await mountPicker({ people: [] })
    expect(empty.wrapper.text()).toContain('Nobody here')
  })

  it('could not load anybody: says so with "Try again" (an alert, not the "nobody" text)', async () => {
    const { wrapper } = await mountPicker({ people: [], failed: true })

    expect(wrapper.get('[role=alert]').text()).toContain("Couldn't load the people from your chats.")
    expect(wrapper.text()).not.toContain('Nobody here')
    await wrapper.get('[role=alert] button').trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })

  it('could load some: lists them, says some are missing, and offers "Try again" (not while loading)', async () => {
    const { wrapper } = await mountPicker({ failed: true })

    expect(wrapper.findAll('li')).toHaveLength(3)
    expect(wrapper.text()).toContain('Some people from your groups could not be loaded.')
    await wrapper.findAll('button').find((b) => b.text() === 'Try again')!.trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)

    await wrapper.setProps({ loading: true })
    expect(wrapper.text()).not.toContain('could not be loaded')
  })

  it('shows a placeholder while the people load', async () => {
    const { wrapper } = await mountPicker({ people: [], loading: true })

    expect(wrapper.find('[role=status]').exists()).toBe(true)
  })

  it('picks one person with one tap', async () => {
    const { wrapper } = await mountPicker()

    await wrapper.findAll('li button')[1]?.trigger('click')

    expect(wrapper.emitted('pick')?.[0]).toEqual([people[1]])
  })

  it('in multiple mode toggles people on and off, and tells which are on', async () => {
    const { wrapper } = await mountPicker({ multiple: true, modelValue: [] })
    const first = wrapper.findAll('li button')[0]!
    expect(first.attributes('aria-pressed')).toBe('false')

    await first.trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([['1']])

    await wrapper.setProps({ modelValue: ['1'] })
    expect(wrapper.findAll('li button')[0]?.attributes('aria-pressed')).toBe('true')
    await wrapper.findAll('li button')[0]?.trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[1]).toEqual([[]])
  })
})

void makeMessage
type _Call = Call
