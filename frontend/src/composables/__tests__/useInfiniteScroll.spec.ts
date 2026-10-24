import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'

import { FakeObserver, installFakeObserver } from '@/__tests__/fakeObserver'
import { canObserve, useInfiniteScroll } from '@/composables/useInfiniteScroll'

beforeEach(installFakeObserver)
afterEach(() => vi.unstubAllGlobals())

function host(onReach: () => void, rearm = ref(0)) {
  const Host = defineComponent({
    setup() {
      const marker = ref<HTMLElement | null>(null)
      useInfiniteScroll(marker, onReach, [rearm])
      return () => h('div', [h('div', { ref: marker, class: 'marker' })])
    },
  })
  return mount(Host, { attachTo: document.body })
}

describe('infinite scroll', () => {
  it('watches the marker, starting a little before it is on screen', async () => {
    const wrapper = host(() => undefined)
    await nextTick()

    const observer = FakeObserver.all[0] as FakeObserver
    expect(observer.observed).toEqual([wrapper.get('.marker').element])
    expect(observer.options?.rootMargin).toBe('600px 0px')
    wrapper.unmount()
  })

  it('asks for more when the marker comes into view, and not when it leaves', async () => {
    const onReach = vi.fn()
    const wrapper = host(onReach)
    await nextTick()
    const observer = FakeObserver.all[0] as FakeObserver

    observer.see(false)
    expect(onReach).not.toHaveBeenCalled()
    observer.see(true)
    expect(onReach).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('looks again after what it watches changes (a marker that stays on screen does not announce itself twice)', async () => {
    const rearm = ref(0)
    const wrapper = host(() => undefined, rearm)
    await nextTick()
    const observer = FakeObserver.all[0] as FakeObserver
    const disconnectsBefore = observer.disconnected

    rearm.value += 1
    await nextTick()

    expect(observer.disconnected).toBe(disconnectsBefore + 1)
    expect(observer.observed).toHaveLength(1)
    wrapper.unmount()
  })

  it('stops watching when the page goes away', async () => {
    const wrapper = host(() => undefined)
    await nextTick()
    const observer = FakeObserver.all[0] as FakeObserver

    wrapper.unmount()

    expect(observer.observed).toEqual([])
  })

  it('does nothing, and does not break, in a browser that cannot observe', async () => {
    vi.unstubAllGlobals()
    // @ts-expect-error jsdom has none: keep it that way for this test
    delete window.IntersectionObserver

    expect(canObserve()).toBe(false)
    const wrapper = host(() => undefined)
    await nextTick()
    expect(wrapper.exists()).toBe(true)
    wrapper.unmount()
  })
})
