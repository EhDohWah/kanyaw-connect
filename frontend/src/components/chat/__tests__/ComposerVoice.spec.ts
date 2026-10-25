import type { Pinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useFakeAudio } from '@/__tests__/fakeAudio'
import { useFakeMicrophone, type FakeMicrophone } from '@/__tests__/fakeRecorder'
import { CHAT_ID, ME, fakeApi, makeChat, makeMessage, mountApp, restoreApi, signedInStores, type Call, type Reply } from '@/__tests__/helpers'
import Composer from '@/components/chat/Composer.vue'
import { interruptRecording } from '@/composables/useVoiceRecorder'
import { useDraftsStore } from '@/stores/drafts'
import { useMessagesStore } from '@/stores/messages'

const chat = makeChat()
const ATTACHMENT = { id: 'att-1', original_name: 'voice.webm', mime_type: 'audio/webm', size: 9, url: 'https://files/voice', thumbnail_url: null, created_at: '' }

let clock = 0
let mic: FakeMicrophone

/** Lets pending promises and zero-delay timers run (the timers are fake here). */
async function settle(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) await vi.advanceTimersByTimeAsync(0)
}

/** Lets time pass for the recorder (its clock is performance.now). */
async function pass(ms: number): Promise<void> {
  clock += ms
  await vi.advanceTimersByTimeAsync(ms)
}

interface Server {
  failMessage?: Reply
}

function serve(server: Server = {}) {
  return fakeApi((call: Call): Reply => {
    if (call.url === `/chats/${CHAT_ID}/attachments`) return { status: 201, data: { data: ATTACHMENT } }
    if (call.url === `/chats/${CHAT_ID}/messages`) {
      if (server.failMessage) {
        const failure = server.failMessage
        delete server.failMessage
        return failure
      }
      const body = call.body as { client_id: string; metadata: Record<string, unknown> }
      return { status: 201, data: { data: makeMessage({ sender_id: ME, type: 'voice', content: null, client_id: body.client_id, metadata: body.metadata, attachment: ATTACHMENT }) } }
    }
    return { status: 204 }
  })
}

function mountComposer(setup: (pinia: Pinia) => void = () => undefined) {
  return mountApp(Composer, {
    props: { chat },
    attachTo: document.body,
    prepare: (pinia) => {
      signedInStores(pinia)
      setup(pinia)
    },
  })
}

type Wrapper = Awaited<ReturnType<typeof mountComposer>>['wrapper']
const button = (wrapper: Wrapper, label: string) => wrapper.find(`button[aria-label="${label}"]`)
const posts = (calls: Call[], url: string) => calls.filter((c) => c.method === 'post' && c.url === url)

async function record(wrapper: Wrapper, ms: number): Promise<void> {
  await button(wrapper, 'Record voice message').trigger('click')
  await settle()
  await pass(ms)
}

beforeEach(() => {
  clock = 1000
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] })
  mic = useFakeMicrophone()
  useFakeAudio()
})
afterEach(restoreApi)

describe('the microphone button', () => {
  it('takes the place of Send while the box is empty', async () => {
    const { wrapper } = await mountComposer()

    expect(button(wrapper, 'Record voice message').exists()).toBe(true)
    expect(wrapper.find('button[type=submit]').exists()).toBe(false)

    await wrapper.get('textarea').setValue('Hello')
    expect(button(wrapper, 'Record voice message').exists()).toBe(false)
    expect(wrapper.get('button[type=submit]').attributes('aria-label')).toBe('Send message')
  })

  it('is not there while editing a message, even with the box emptied', async () => {
    const mine = makeMessage({ sender_id: ME, content: 'Before', created_at: new Date().toISOString() })
    const { wrapper, pinia } = await mountComposer((p) => {
      useMessagesStore(p).ensureTimeline(CHAT_ID).messages = [mine]
    })
    useDraftsStore(pinia).get(CHAT_ID).editingId = mine.id
    await settle()
    expect(wrapper.text()).toContain('Editing message')

    await wrapper.get('textarea').setValue('')
    expect(button(wrapper, 'Record voice message').exists()).toBe(false)
    expect(wrapper.get('button[type=submit]').attributes('aria-label')).toBe('Save changes')
  })

  it('is not there where the browser cannot record (attaching files still works)', async () => {
    vi.stubGlobal('MediaRecorder', undefined)
    const { wrapper } = await mountComposer()

    expect(button(wrapper, 'Record voice message').exists()).toBe(false)
    expect(button(wrapper, 'Attach a file').exists()).toBe(true)
  })
})

describe('recording', () => {
  it('a tap starts it: the bar replaces the box, with a timer, and the focus goes to "Stop and listen"', async () => {
    const { wrapper } = await mountComposer()
    await record(wrapper, 3000)

    expect(mic.getUserMedia).toHaveBeenCalled()
    expect(wrapper.find('textarea').exists()).toBe(false)
    expect(wrapper.get('[role=timer]').text()).toBe('0:03')
    expect(wrapper.get('[role=group]').attributes('aria-label')).toBe('Recording a voice message')
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Stop and listen')
  })

  it('"Stop and listen" shows the recording to play before sending', async () => {
    const { wrapper } = await mountComposer()
    await record(wrapper, 4200)
    await button(wrapper, 'Stop and listen').trigger('click')
    await settle()

    expect(wrapper.get('[role=group]').attributes('aria-label')).toBe('Your voice message, before sending')
    expect(wrapper.get('audio').attributes('src')).toBe('blob:preview')
    expect(wrapper.text()).toContain('0:04')
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Play voice message')
  })

  it('Send uploads the recording as audio and sends a voice message with its length and waveform', async () => {
    const { calls } = serve()
    const { wrapper, pinia } = await mountComposer()
    await record(wrapper, 4200)
    await button(wrapper, 'Stop and listen').trigger('click')
    await settle()
    await button(wrapper, 'Send voice message').trigger('click')
    await settle()

    const form = posts(calls, `/chats/${CHAT_ID}/attachments`)[0]!.body as FormData
    const file = form.get('file') as File
    expect(file.type).toBe('audio/webm')
    expect(file.name).toMatch(/^voice-\d+\.webm$/)

    const sent = posts(calls, `/chats/${CHAT_ID}/messages`)[0]!.body as { type: string; metadata: { attachment_id: string; duration_ms: number; waveform: number[] } }
    expect(sent.type).toBe('voice')
    expect(sent.metadata.attachment_id).toBe('att-1')
    expect(sent.metadata.duration_ms).toBe(4200)
    expect(sent.metadata.waveform).toHaveLength(48)

    expect(useMessagesStore(pinia).timeline(CHAT_ID)?.messages.at(-1)).toMatchObject({ type: 'voice', metadata: { duration_ms: 4200 } })
    // The box is back, ready for the next one.
    expect(button(wrapper, 'Record voice message').exists()).toBe(true)
  })

  it('Send while still recording stops and sends straight away', async () => {
    const { calls } = serve()
    const { wrapper } = await mountComposer()
    await record(wrapper, 2000)
    await button(wrapper, 'Send voice message').trigger('click')
    await settle()

    expect((posts(calls, `/chats/${CHAT_ID}/messages`)[0]!.body as { metadata: { duration_ms: number } }).metadata.duration_ms).toBe(2000)
    expect(mic.streams[0]!.tracks[0]!.stop).toHaveBeenCalled()
  })

  it('the bubble shows at once and plays from the recording, before the server has answered', async () => {
    let release: () => void = () => undefined
    fakeApi(async (call) => {
      if (call.url.endsWith('/attachments')) {
        await new Promise<void>((resolve) => (release = resolve))
        return { status: 201, data: { data: ATTACHMENT } }
      }
      return { status: 204 }
    })
    const { wrapper, pinia } = await mountComposer()
    await record(wrapper, 2000)
    await button(wrapper, 'Send voice message').trigger('click')
    await settle()

    const pending = useMessagesStore(pinia).timeline(CHAT_ID)?.messages.at(-1)
    expect(pending?.pending?.status).toBe('sending')
    expect(pending?.attachment?.url).toBe('blob:preview')
    expect(pending?.metadata).toMatchObject({ duration_ms: 2000 })
    release()
  })

  it('"Tap to retry" sends again with the same client_id, without uploading again', async () => {
    const server: Server = { failMessage: { status: 403, data: { message: 'Forbidden' } } }
    const { calls } = serve(server)
    const { wrapper, pinia } = await mountComposer()
    await record(wrapper, 2000)
    await button(wrapper, 'Send voice message').trigger('click')
    await settle()

    const messages = useMessagesStore(pinia)
    const failed = messages.timeline(CHAT_ID)!.messages.at(-1)!
    expect(failed.pending?.status).toBe('failed')
    await messages.retry(CHAT_ID, failed.pending!.clientId)
    await settle()

    expect(posts(calls, `/chats/${CHAT_ID}/attachments`)).toHaveLength(1)
    const [first, second] = posts(calls, `/chats/${CHAT_ID}/messages`) as Call[]
    expect((second!.body as { client_id: string }).client_id).toBe((first!.body as { client_id: string }).client_id)
    expect(second!.body).toEqual(first!.body)
    expect(messages.timeline(CHAT_ID)!.messages.at(-1)?.pending).toBeUndefined()
  })

  it('keeps the reply it was answering', async () => {
    const { calls } = serve()
    const target = makeMessage({ content: 'Are you coming?' })
    const { wrapper } = await mountComposer((pinia) => {
      useMessagesStore(pinia).receive(target)
      useDraftsStore(pinia).get(CHAT_ID).replyToId = target.id
    })
    await record(wrapper, 2000)
    await button(wrapper, 'Send voice message').trigger('click')
    await settle()

    expect((posts(calls, `/chats/${CHAT_ID}/messages`)[0]!.body as { reply_to_id: string }).reply_to_id).toBe(target.id)
  })

  it('Delete throws it away, turns the microphone off and gives the box back', async () => {
    const { calls } = serve()
    const { wrapper } = await mountComposer()
    await record(wrapper, 2000)
    await button(wrapper, 'Delete recording').trigger('click')
    await settle()

    expect(mic.streams[0]!.tracks[0]!.stop).toHaveBeenCalled()
    expect(wrapper.find('textarea').exists()).toBe(true)
    expect(calls).toHaveLength(0)
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Record voice message')
  })

  it('under a second is not sent, and says so', async () => {
    const { calls } = serve()
    const { wrapper } = await mountComposer()
    await record(wrapper, 600)
    await button(wrapper, 'Send voice message').trigger('click')
    await settle()

    expect(calls).toHaveLength(0)
    expect(wrapper.get('[role=alert]').text()).toContain('That was under a second')
    expect(wrapper.find('textarea').exists()).toBe(true)
  })

  it('stopped by something else (a call coming in): keeps the recording to listen to, and says so', async () => {
    const { wrapper } = await mountComposer()
    await record(wrapper, 3000)
    interruptRecording()
    await settle()

    expect(wrapper.get('[role=group]').attributes('aria-label')).toBe('Your voice message, before sending')
    expect(wrapper.text()).toContain('Recording stopped. What was recorded is kept')
  })

  it('stops by itself at five minutes and says so', async () => {
    const { wrapper } = await mountComposer()
    await record(wrapper, 5 * 60_000 + 100)
    await settle()

    expect(wrapper.text()).toContain('Recording stopped at 5 minutes.')
    expect(wrapper.text()).toContain('5:00')
  })
})

describe('a microphone that cannot be used', () => {
  it('blocked: says how to allow it, in the words of the meeting screen', async () => {
    mic = useFakeMicrophone({ refuse: 'NotAllowedError' })
    const { wrapper } = await mountComposer()
    await button(wrapper, 'Record voice message').trigger('click')
    await settle()

    expect(wrapper.get('[role=alert]').text()).toBe("The browser is not allowing the microphone. Allow it in the browser's settings, then try again.")
    expect(wrapper.find('textarea').exists()).toBe(true)
  })

  it('missing: says so', async () => {
    mic = useFakeMicrophone({ refuse: 'NotFoundError' })
    const { wrapper } = await mountComposer()
    await button(wrapper, 'Record voice message').trigger('click')
    await settle()

    expect(wrapper.get('[role=alert]').text()).toBe('No microphone was found.')
  })
})
