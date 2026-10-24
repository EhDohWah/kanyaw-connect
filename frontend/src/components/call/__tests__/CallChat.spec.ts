import { afterEach, describe, expect, it } from 'vitest'

import { lastRoom, useFakeLiveKit } from '@/__tests__/fakeLiveKit'
import { ME, PAW, fakeApi, makeRoom, mountApp, restoreApi, restoreMedia, screenIs, settle, signedInStores } from '@/__tests__/helpers'
import CallChat from '@/components/call/CallChat.vue'
import { useCallStore } from '@/stores/call'

useFakeLiveKit()
afterEach(() => {
  restoreApi()
  restoreMedia()
})

async function chat() {
  const room = makeRoom()
  fakeApi((call) => (call.url.endsWith('/join') ? { data: { status: 'admitted', token: 'lk', livekit_url: 'ws://lk', room } } : { data: { data: room } }))
  const mounted = await mountApp(CallChat, { prepare: (pinia) => signedInStores(pinia) })
  const call = useCallStore()
  await call.open(room.id)
  await call.join({ micOn: false, cameraOn: false })
  lastRoom().addPerson(PAW, 'Naw Paw Say')
  await settle()
  return { ...mounted, call, livekit: lastRoom() }
}

describe('the chat in a call', () => {
  it('says the messages are not kept, and that there are none yet', async () => {
    const { wrapper } = await chat()

    expect(wrapper.text()).toContain('Messages disappear when the meeting ends.')
    expect(wrapper.text()).toContain('No messages yet.')
  })

  it('shows who wrote each message and when, with links that work and no markup', async () => {
    const { wrapper, livekit } = await chat()

    livekit.deliverText(PAW, 'Agenda: https://example.org/agenda <b>now</b>')
    await settle()

    const message = wrapper.findAll('ol li').at(-1)!
    expect(message.text()).toContain('Naw Paw Say')
    expect(message.find('time').exists()).toBe(true)
    expect(message.get('a').attributes('href')).toBe('https://example.org/agenda')
    expect(message.find('b').exists()).toBe(false)
  })

  it('keeps the name of someone who has left', async () => {
    const { wrapper, livekit } = await chat()
    livekit.deliverText(PAW, 'Bye')
    await settle()

    livekit.leaveRoom(PAW)
    await settle()

    expect(wrapper.findAll('ol li').at(-1)!.text()).toContain('Naw Paw Say')
  })

  it('sends with the button, and with Enter when there is a keyboard and mouse', async () => {
    screenIs(true, true)
    const { wrapper, livekit } = await chat()

    await wrapper.get('textarea').setValue('First')
    await wrapper.get('form').trigger('submit')
    await settle()
    await wrapper.get('textarea').setValue('Second')
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter' })
    await settle()

    expect(livekit.localParticipant.sent.map((m) => m.text)).toEqual(['First', 'Second'])
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('')
    expect(wrapper.findAll('ol li').map((li) => li.text())).toEqual([expect.stringContaining('First'), expect.stringContaining('Second')])
    expect(wrapper.findAll('ol li')[0]!.text()).toContain('You')
  })

  it('on a phone Enter is a new line (the button sends)', async () => {
    screenIs(false, false)
    const { wrapper, livekit } = await chat()

    await wrapper.get('textarea').setValue('Line one')
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter' })
    await settle()

    expect(livekit.localParticipant.sent).toEqual([])
  })

  it('a message that could not be sent keeps its words and says so', async () => {
    const { wrapper, livekit } = await chat()
    livekit.localParticipant.failures.set('text', new Error('closed'))

    await wrapper.get('textarea').setValue('Important')
    await wrapper.get('form').trigger('submit')
    await settle()

    expect(wrapper.get('[role=alert]').text()).toBe('Your message could not be sent.')
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('Important')
  })

  it('limits a message to 1000 characters', async () => {
    const { wrapper } = await chat()
    expect(wrapper.get('textarea').attributes('maxlength')).toBe('1000')
    expect(ME).toBeTruthy()
  })
})
