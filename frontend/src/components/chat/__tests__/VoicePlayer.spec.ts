import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { settle } from '@/__tests__/helpers'
import VoicePlayer from '@/components/chat/VoicePlayer.vue'
import { i18n } from '@/i18n'
import { useVoicePlaybackStore } from '@/stores/voicePlayback'

const FRESH = 'https://api.test/attachments/a1/file?expires=9999999999&signature=x'
const EXPIRED = 'https://api.test/attachments/a1/file?expires=1000&signature=x'

/** jsdom's media elements cannot play: these stand in, firing the events a browser would. */
beforeEach(() => {
  setActivePinia(createPinia())
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
    Object.defineProperty(this, 'paused', { value: false, configurable: true })
    this.dispatchEvent(new Event('play'))
    return Promise.resolve()
  })
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
    Object.defineProperty(this, 'paused', { value: true, configurable: true })
    this.dispatchEvent(new Event('pause'))
  })
})

function player(props: Record<string, unknown> = {}): VueWrapper {
  return mount(VoicePlayer, {
    props: { id: 'm1', src: FRESH, durationMs: 30_000, waveform: new Array(48).fill(128), ...props },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
}

const audioOf = (wrapper: VueWrapper) => wrapper.get('audio').element as HTMLAudioElement
const slider = (wrapper: VueWrapper) => wrapper.get('[role=slider]')
const playButton = (wrapper: VueWrapper) => wrapper.get('button')

/** The file has arrived: the element knows its length and can be moved. */
async function loaded(wrapper: VueWrapper, duration = 30): Promise<void> {
  const el = audioOf(wrapper)
  Object.defineProperty(el, 'readyState', { value: 1, configurable: true })
  Object.defineProperty(el, 'duration', { value: duration, configurable: true })
  await wrapper.get('audio').trigger('loadedmetadata')
}

describe('VoicePlayer', () => {
  it('downloads nothing until play, and uses no browser controls', () => {
    const wrapper = player()
    const audio = wrapper.get('audio')

    expect(audio.attributes('preload')).toBe('none')
    expect(audio.attributes('controls')).toBeUndefined()
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
  })

  it('draws the waveform it was given, and plain bars when there is none', () => {
    expect(player({ waveform: [0, 255, ...new Array(14).fill(10)] }).findAll('[role=slider] span')).toHaveLength(16)
    const plain = player({ id: 'm2', waveform: null }).findAll('[role=slider] span')
    expect(plain).toHaveLength(32)
    expect(new Set(plain.map((bar) => bar.attributes('style'))).size).toBe(1)
  })

  it('shows the length from the message, then the position while playing', async () => {
    const wrapper = player({ durationMs: 150_000 })
    expect(wrapper.text()).toContain('2:30')

    await playButton(wrapper).trigger('click')
    expect(playButton(wrapper).attributes('aria-label')).toBe('Pause voice message')
    const el = audioOf(wrapper)
    Object.defineProperty(el, 'currentTime', { value: 65, configurable: true, writable: true })
    await wrapper.get('audio').trigger('timeupdate')

    expect(wrapper.text()).toContain('1:05')
    expect(slider(wrapper).attributes('aria-valuetext')).toBe('1:05 of 2:30')
    // 65 of 150 seconds is 21 of 48 bars filled.
    expect(wrapper.findAll('[role=slider] span.bg-primary')).toHaveLength(21)
  })

  it('without a length in the message, takes the file\'s once known; not Chrome\'s "Infinity"', async () => {
    const wrapper = player({ durationMs: null })
    expect(slider(wrapper).attributes('aria-disabled')).toBe('true')

    await loaded(wrapper, Number.POSITIVE_INFINITY)
    expect(slider(wrapper).attributes('aria-valuemax')).toBe('0')

    await loaded(wrapper, 12)
    expect(slider(wrapper).attributes('aria-valuemax')).toBe('12')
    expect(wrapper.text()).toContain('0:12')
  })

  it('seeks with the keyboard: arrows move 5 seconds, Home and End go to either end', async () => {
    const wrapper = player()
    await loaded(wrapper)
    const el = audioOf(wrapper)

    await slider(wrapper).trigger('keydown', { key: 'ArrowRight' })
    expect(el.currentTime).toBe(5)
    expect(slider(wrapper).attributes('aria-valuetext')).toBe('0:05 of 0:30')

    await slider(wrapper).trigger('keydown', { key: 'ArrowUp' })
    expect(el.currentTime).toBe(10)
    await slider(wrapper).trigger('keydown', { key: 'ArrowLeft' })
    expect(el.currentTime).toBe(5)
    await slider(wrapper).trigger('keydown', { key: 'End' })
    expect(el.currentTime).toBe(30)
    await slider(wrapper).trigger('keydown', { key: 'ArrowRight' })
    expect(el.currentTime).toBe(30)
    await slider(wrapper).trigger('keydown', { key: 'Home' })
    expect(el.currentTime).toBe(0)
    await slider(wrapper).trigger('keydown', { key: 'ArrowDown' })
    expect(el.currentTime).toBe(0)
  })

  it('a seek before anything was downloaded is kept for when the file arrives', async () => {
    const wrapper = player()
    await slider(wrapper).trigger('keydown', { key: 'ArrowRight' })
    expect(slider(wrapper).attributes('aria-valuenow')).toBe('5')

    await loaded(wrapper)
    expect(audioOf(wrapper).currentTime).toBe(5)
  })

  it('a tap or drag on the waveform seeks to that point', async () => {
    const wrapper = player()
    await loaded(wrapper)
    vi.spyOn(slider(wrapper).element, 'getBoundingClientRect').mockReturnValue({ left: 100, width: 200, top: 0, height: 32, right: 300, bottom: 32, x: 100, y: 0, toJSON: () => ({}) })

    slider(wrapper).element.dispatchEvent(Object.assign(new Event('pointerdown'), { clientX: 150, pointerId: 1 }))
    expect(audioOf(wrapper).currentTime).toBe(7.5)
    slider(wrapper).element.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: 250, pointerId: 1 }))
    expect(audioOf(wrapper).currentTime).toBe(22.5)
    slider(wrapper).element.dispatchEvent(Object.assign(new Event('pointerup'), { pointerId: 1 }))
    slider(wrapper).element.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: 120, pointerId: 1 }))
    expect(audioOf(wrapper).currentTime).toBe(22.5)
  })

  it('the speed button goes 1× → 1.5× → 2× → 1×', async () => {
    const wrapper = player()
    const speed = wrapper.findAll('button').at(-1)!
    expect(speed.text()).toBe('1×')

    await speed.trigger('click')
    expect(speed.text()).toBe('1.5×')
    expect(audioOf(wrapper).playbackRate).toBe(1.5)
    expect(speed.attributes('aria-label')).toBe('Playback speed: 1.5×')
    await speed.trigger('click')
    expect(audioOf(wrapper).playbackRate).toBe(2)
    await speed.trigger('click')
    expect(speed.text()).toBe('1×')

    await speed.trigger('click')
    await playButton(wrapper).trigger('click')
    expect(audioOf(wrapper).playbackRate).toBe(1.5)
  })

  it('only one plays at a time: starting one pauses the other', async () => {
    const first = player({ id: 'm1' })
    const second = player({ id: 'm2' })

    await playButton(first).trigger('click')
    expect(useVoicePlaybackStore().playing).toBe('m1')
    await playButton(second).trigger('click')

    expect(audioOf(first).paused).toBe(true)
    expect(playButton(first).attributes('aria-label')).toBe('Play voice message')
    expect(useVoicePlaybackStore().playing).toBe('m2')
  })

  it('back at the start when it ends', async () => {
    const wrapper = player()
    await playButton(wrapper).trigger('click')
    await wrapper.get('audio').trigger('ended')

    expect(playButton(wrapper).attributes('aria-label')).toBe('Play voice message')
    expect(useVoicePlaybackStore().playing).toBeNull()
    expect(wrapper.text()).toContain('0:30')
  })

  it('an expired link: asks for a fresh one first, then plays it when it comes', async () => {
    const wrapper = player({ src: EXPIRED })
    await playButton(wrapper).trigger('click')

    expect(wrapper.emitted('expired')).toHaveLength(1)
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()

    await wrapper.setProps({ src: FRESH })
    await settle()
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1)
  })

  it('a link that ran out while playing is refreshed once, and goes on from where it was', async () => {
    const wrapper = player({ src: EXPIRED.replace('expires=1000', `expires=${Math.floor(Date.now() / 1000) + 3600}`) })
    await loaded(wrapper)
    await slider(wrapper).trigger('keydown', { key: 'ArrowRight' })
    await playButton(wrapper).trigger('click')
    // An hour later the link has run out and the element fails.
    await wrapper.setProps({ src: EXPIRED })
    Object.defineProperty(audioOf(wrapper), 'error', { value: { code: 4 }, configurable: true })
    await wrapper.get('audio').trigger('error')

    expect(wrapper.emitted('expired')).toHaveLength(1)
    expect(wrapper.find('[role=alert]').exists()).toBe(false)
    await wrapper.setProps({ src: FRESH })
    await settle()
    await loaded(wrapper)
    expect(audioOf(wrapper).currentTime).toBe(5)
  })

  it('a file this device cannot play: says so, with a download link', async () => {
    const wrapper = player({ name: 'voice-1.webm' })
    await playButton(wrapper).trigger('click')
    Object.defineProperty(audioOf(wrapper), 'error', { value: { code: 4 }, configurable: true })
    await wrapper.get('audio').trigger('error')

    expect(wrapper.get('[role=alert]').text()).toContain("This voice message can't play on this device.")
    const link = wrapper.get('[role=alert] a')
    expect(link.attributes('href')).toBe(FRESH)
    expect(link.attributes('download')).toBe('voice-1.webm')
    expect(playButton(wrapper).attributes('disabled')).toBeDefined()
    expect(wrapper.emitted('expired')).toBeUndefined()
    expect(useVoicePlaybackStore().playing).toBeNull()
  })

  it('a network failure says so, and play can be tried again', async () => {
    const wrapper = player()
    await playButton(wrapper).trigger('click')
    Object.defineProperty(audioOf(wrapper), 'error', { value: { code: 2 }, configurable: true })
    await wrapper.get('audio').trigger('error')

    expect(wrapper.get('[role=alert]').text()).toContain('could not be loaded')
    await playButton(wrapper).trigger('click')
    expect(wrapper.find('[role=alert]').exists()).toBe(false)
  })

  it('a local recording (before it is sent) is never "refreshed"', async () => {
    const wrapper = player({ src: 'blob:preview' })
    Object.defineProperty(audioOf(wrapper), 'error', { value: { code: 4 }, configurable: true })
    await wrapper.get('audio').trigger('error')
    expect(wrapper.emitted('expired')).toBeUndefined()
  })

  it('stops when it goes away', async () => {
    const wrapper = player()
    await playButton(wrapper).trigger('click')
    wrapper.unmount()
    expect(useVoicePlaybackStore().playing).toBeNull()
  })
})

describe('voicePlayback', () => {
  it('stopAll pauses whatever is playing (a call coming in)', () => {
    const store = useVoicePlaybackStore()
    const pause = vi.fn()
    store.claim('m1', pause)
    store.stopAll()
    expect(pause).toHaveBeenCalled()
    expect(store.playing).toBeNull()
  })

  it('a player that is not the one playing cannot release it', () => {
    const store = useVoicePlaybackStore()
    store.claim('m1', vi.fn())
    store.release('m2')
    expect(store.playing).toBe('m1')
  })
})
