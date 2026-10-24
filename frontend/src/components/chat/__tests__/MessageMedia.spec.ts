import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import MessageMedia from '@/components/chat/MessageMedia.vue'
import { i18n } from '@/i18n'
import type { Attachment } from '@/types/chat'

vi.mock('@/utils/files', async (original) => ({ ...(await original<typeof import('@/utils/files')>()), saveFile: vi.fn(async () => undefined) }))
const { saveFile } = await import('@/utils/files')

beforeEach(() => {
  vi.mocked(saveFile).mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

const inSeconds = (seconds: number) => Math.floor(Date.now() / 1000) + seconds
const attachment = (over: Partial<Attachment> = {}): Attachment => ({
  id: 'a1',
  original_name: 'agenda.pdf',
  mime_type: 'application/pdf',
  size: 2048,
  url: `https://api.example.org/api/v1/attachments/a1/file?expires=${inSeconds(3600)}&signature=one`,
  thumbnail_url: `https://api.example.org/api/v1/attachments/a1/thumbnail?expires=${inSeconds(3600)}&signature=one`,
  created_at: '2026-03-14T09:00:00Z',
  ...over,
})

const expired = () => attachment({ url: `https://api.example.org/api/v1/attachments/a1/file?expires=${inSeconds(-60)}&signature=old` })
const fresh = () => `https://api.example.org/api/v1/attachments/a1/file?expires=${inSeconds(3600)}&signature=new`
const click = () => new MouseEvent('click', { bubbles: true, cancelable: true })

const mountMedia = (type: 'image' | 'file' | 'voice', file: Attachment) =>
  mount(MessageMedia, { props: { type, attachment: file }, global: { plugins: [i18n] }, attachTo: document.body })

describe('a picture whose link ran out', () => {
  it('asks for fresh links, and shows the picture again when they arrive', async () => {
    const wrapper = mountMedia('image', attachment())

    await wrapper.get('img').trigger('error')
    expect(wrapper.emitted('expired')).toHaveLength(1)
    expect(wrapper.text()).toContain('Photo unavailable')

    await wrapper.setProps({ attachment: attachment({ thumbnail_url: 'https://api.example.org/api/v1/attachments/a1/thumbnail?expires=9999999999&signature=two' }) })

    expect(wrapper.find('img').exists()).toBe(true)
    expect(wrapper.get('img').attributes('src')).toContain('signature=two')
    wrapper.unmount()
  })
})

describe('a file card', () => {
  it('downloads straight away while its link is good', async () => {
    const wrapper = mountMedia('file', attachment())
    const event = click()

    wrapper.get('a').element.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    expect(wrapper.emitted('expired')).toBeUndefined()
    expect(saveFile).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('with an expired link: asks for a fresh one and saves the file from it, instead of opening an error page', async () => {
    const wrapper = mountMedia('file', expired())
    const event = click()

    wrapper.get('a').element.dispatchEvent(event)
    await wrapper.vm.$nextTick()

    expect(event.defaultPrevented).toBe(true)
    expect(wrapper.emitted('expired')).toHaveLength(1)
    expect(wrapper.get('a').attributes('aria-busy')).toBe('true')

    await wrapper.setProps({ attachment: attachment({ url: fresh() }) })
    await flushPromises()

    // Saved from this page under its own name: never followed here, where a picture would replace the app.
    expect(saveFile).toHaveBeenCalledWith(fresh(), 'agenda.pdf')
    expect(wrapper.get('a').attributes('aria-busy')).toBeUndefined()
    wrapper.unmount()
  })

  it('asks only once while it waits, and lets the person try again if nothing comes', async () => {
    vi.useFakeTimers()
    const wrapper = mountMedia('file', expired())
    const clickOnce = () => wrapper.get('a').element.dispatchEvent(click())

    clickOnce()
    clickOnce()
    expect(wrapper.emitted('expired')).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(10_000)
    clickOnce()
    expect(wrapper.emitted('expired')).toHaveLength(2)
    expect(saveFile).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('stays busy until the file is saved, and if saving fails the fresh link works on the next click', async () => {
    let fail = () => undefined as void
    vi.mocked(saveFile).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = () => reject(new Error('offline'))
        }),
    )
    const wrapper = mountMedia('file', expired())

    wrapper.get('a').element.dispatchEvent(click())
    await wrapper.setProps({ attachment: attachment({ url: fresh() }) })
    expect(wrapper.get('a').attributes('aria-busy')).toBe('true')

    fail()
    await flushPromises()
    expect(wrapper.get('a').attributes('aria-busy')).toBeUndefined()

    const next = click()
    wrapper.get('a').element.dispatchEvent(next)
    expect(next.defaultPrevented).toBe(false)
    expect(wrapper.get('a').attributes('href')).toBe(fresh())
    wrapper.unmount()
  })

  it('saves nothing when links are refreshed for another reason', async () => {
    const wrapper = mountMedia('file', attachment())

    await wrapper.setProps({ attachment: attachment({ url: 'https://api.example.org/api/v1/attachments/a1/file?expires=9999999999&signature=other' }) })
    await flushPromises()

    expect(saveFile).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
