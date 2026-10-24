import type { Pinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { fakeApi, makeChat, makeRoom, mountApp, restoreApi, settle, signedInStores } from '@/__tests__/helpers'
import NewMeetingDialog from '@/components/rooms/NewMeetingDialog.vue'
import { useChatsStore } from '@/stores/chats'
import { useRoomsStore } from '@/stores/rooms'
import { useUiStore } from '@/stores/ui'
import { toZonedInput } from '@/utils/dates'

afterEach(() => {
  restoreApi()
  vi.useRealTimers()
})

const dialog = () => document.body.querySelector<HTMLElement>('[role=dialog]')!
const field = (label: string): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement => {
  const labelEl = [...dialog().querySelectorAll('label')].find((el) => el.textContent?.trim().startsWith(label))
  return dialog().querySelector(`#${CSS.escape(labelEl!.htmlFor)}`)!
}
const type = async (label: string, value: string) => {
  const el = field(label)
  el.value = value
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input'))
  await settle(1)
}
const submit = async () => {
  dialog().closest('body')!.querySelector<HTMLButtonElement>('button[form=new-meeting]')!.click()
  await settle()
}

async function open(setup: (pinia: Pinia) => void = () => undefined) {
  const mounted = await mountApp(NewMeetingDialog, {
    props: { open: false },
    prepare: (pinia) => {
      signedInStores(pinia) // time zone Asia/Bangkok (+07:00)
      setup(pinia)
    },
  })
  await mounted.wrapper.setProps({ open: true })
  await settle(2)
  return mounted
}

describe('New meeting', () => {
  it('needs a name, and checks the password length and the number of people before sending anything', async () => {
    const { calls } = fakeApi(() => ({ status: 201, data: { data: makeRoom() } }))
    await open()

    await type('Password', 'abc')
    await type('Most people at once', '101')
    await submit()

    expect(dialog().textContent).toContain('Enter a name for the meeting.')
    expect(dialog().textContent).toContain('Use 4 to 64 characters.')
    expect(dialog().textContent).toContain('Choose a number from 2 to 100.')
    expect(calls).toHaveLength(0)
  })

  it('refuses a start time in the past', async () => {
    const { calls } = fakeApi(() => ({ status: 201, data: { data: makeRoom() } }))
    await open()

    await type('Name', 'Committee')
    await type('Start time', toZonedInput(Date.now() - 3600_000, 'Asia/Bangkok'))
    await submit()

    expect(dialog().textContent).toContain('Choose a time in the future.')
    expect(calls).toHaveLength(0)
  })

  it('without a time: starts the meeting now and opens it', async () => {
    const { calls } = fakeApi(() => ({ status: 201, data: { data: makeRoom({ id: 'r9', type: 'instant', scheduled_at: null }) } }))
    const { router, wrapper } = await open()
    expect(dialog().querySelector('button[form=new-meeting]') ?? document.body.querySelector('button[form=new-meeting]')).toBeTruthy()
    expect(document.body.querySelector('button[form=new-meeting]')!.textContent).toContain('Start meeting')
    expect(dialog().textContent).not.toContain('How long') // a duration only makes sense with a start time

    await type('Name', '  Quick call ')
    await submit()

    expect(calls[0]).toMatchObject({ method: 'post', url: '/rooms', body: { name: 'Quick call', waiting_room_enabled: false, max_participants: 50 } })
    expect(calls[0]?.body).not.toHaveProperty('scheduled_at')
    expect(calls[0]?.body).not.toHaveProperty('password')
    expect(wrapper.emitted('close')).toHaveLength(1)
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/rooms/r9'))
  })

  it('with a time: schedules it in the person\'s own time zone, with everything chosen, and says when', async () => {
    const scheduled = makeRoom({ id: 's1', scheduled_at: '2099-03-14T09:30:00.000000Z' })
    const { calls } = fakeApi(() => ({ status: 201, data: { data: scheduled } }))
    const { wrapper, pinia } = await open((p) => {
      useChatsStore(p).put(makeChat({ id: 'g1', type: 'group', name: 'Committee', other_user: undefined }))
      useChatsStore(p).put(makeChat({ id: 'd1' })) // a direct chat is not offered
    })
    const created = vi.spyOn(useRoomsStore(pinia), 'addCreated')

    await type('Name', 'Planning')
    await type('Description', 'Monthly planning')
    await type('Start time', '2099-03-14T16:30') // 16:30 in Bangkok = 09:30 UTC
    expect(document.body.querySelector('button[form=new-meeting]')!.textContent).toContain('Schedule meeting')
    await type('How long', '90')
    await type('Password', 'open-sesame')
    dialog().querySelector<HTMLButtonElement>('[role=switch]')!.click()
    await type('Most people at once', '20')
    expect([...(field('Invite a group') as HTMLSelectElement).options].map((o) => o.text)).toEqual(['No group', 'Committee'])
    await type('Invite a group', 'g1')
    await submit()

    expect(calls[0]?.body).toEqual({
      name: 'Planning',
      description: 'Monthly planning',
      scheduled_at: '2099-03-14T09:30:00.000Z',
      duration_minutes: 90,
      password: 'open-sesame',
      waiting_room_enabled: true,
      max_participants: 20,
      chat_id: 'g1',
    })
    expect(created).toHaveBeenCalledWith(scheduled)
    expect(wrapper.emitted('created')?.[0]).toEqual([scheduled])
    expect(useUiStore(pinia).toasts.at(-1)?.message).toMatch(/^Meeting scheduled for .*Mar 14.*4:30/)
  })

  it('puts the server\'s complaints under the fields they are about', async () => {
    fakeApi(() => ({
      status: 422,
      data: { message: 'Invalid', errors: { scheduled_at: ['The start must be in the future.'], chat_id: ['You are not in that chat.'] } },
    }))
    const { wrapper } = await open((p) => useChatsStore(p).put(makeChat({ id: 'g1', type: 'group', name: 'Committee', other_user: undefined })))

    await type('Name', 'Planning')
    await type('Start time', '2099-03-14T16:30')
    await submit()

    expect(dialog().textContent).toContain('The start must be in the future.')
    expect(dialog().textContent).toContain('You are not in that chat.')
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('says so when the server cannot be reached, keeping what was typed', async () => {
    fakeApi(() => ({ network: true }))
    await open()

    await type('Name', 'Planning')
    await submit()

    expect(dialog().querySelector('[role=alert]')?.textContent).toContain("Can't reach the server")
    expect((field('Name') as HTMLInputElement).value).toBe('Planning')
  })

  it('starts empty every time it opens', async () => {
    fakeApi(() => ({ network: true }))
    const { wrapper } = await open()
    await type('Name', 'Draft')

    await wrapper.setProps({ open: false })
    await settle(2)
    await wrapper.setProps({ open: true })
    await settle(2)

    expect((field('Name') as HTMLInputElement).value).toBe('')
  })
})
