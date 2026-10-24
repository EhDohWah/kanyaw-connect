import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref, type Ref } from 'vue'

import { fakeApi, makeRoom, mountApp, page, restoreApi, signedInStores } from '@/__tests__/helpers'
import { UPCOMING_REFRESH_MS, useUpcomingMeetings } from '@/composables/useUpcomingMeetings'

let visibility: DocumentVisibilityState = 'visible'

beforeEach(() => {
  visibility = 'visible'
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
})
afterEach(restoreApi)

async function host(active: Ref<boolean>) {
  const Host = defineComponent({
    setup() {
      useUpcomingMeetings(active)
      return () => h('div')
    },
  })
  return mountApp(Host, { prepare: (pinia) => signedInStores(pinia) })
}

const serve = () => fakeApi(() => ({ data: page([makeRoom()]) }))
const asked = (calls: { url: string }[]) => calls.filter((call) => call.url === '/rooms').length

describe('keeping the upcoming meetings fresh', () => {
  it('asks when it first appears', async () => {
    vi.useFakeTimers()
    const { calls } = serve()
    await host(ref(true))
    await vi.advanceTimersByTimeAsync(0)

    expect(asked(calls)).toBe(1)
  })

  it('does not ask while it is not shown, and asks when it is', async () => {
    vi.useFakeTimers()
    const { calls } = serve()
    const active = ref(false)
    await host(active)
    await vi.advanceTimersByTimeAsync(UPCOMING_REFRESH_MS * 2)
    expect(asked(calls)).toBe(0)

    active.value = true
    await vi.advanceTimersByTimeAsync(0)
    expect(asked(calls)).toBe(1)
  })

  it('asks again every five minutes, but not when the page is hidden', async () => {
    vi.useFakeTimers()
    const { calls } = serve()
    await host(ref(true))
    await vi.advanceTimersByTimeAsync(UPCOMING_REFRESH_MS)
    expect(asked(calls)).toBe(2)

    visibility = 'hidden'
    await vi.advanceTimersByTimeAsync(UPCOMING_REFRESH_MS * 3)
    expect(asked(calls)).toBe(2)

    visibility = 'visible'
    await vi.advanceTimersByTimeAsync(UPCOMING_REFRESH_MS)
    expect(asked(calls)).toBe(3)
  })

  it('asks at once when the person comes back after a while, but not after a few seconds', async () => {
    vi.useFakeTimers()
    const { calls } = serve()
    await host(ref(true))
    await vi.advanceTimersByTimeAsync(0)
    expect(asked(calls)).toBe(1)

    visibility = 'hidden'
    await vi.advanceTimersByTimeAsync(10_000)
    visibility = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(asked(calls)).toBe(1)

    visibility = 'hidden'
    await vi.advanceTimersByTimeAsync(90_000)
    visibility = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(asked(calls)).toBe(2)
  })

  it('stops when it is hidden or removed', async () => {
    vi.useFakeTimers()
    const { calls } = serve()
    const active = ref(true)
    const { wrapper } = await host(active)
    await vi.advanceTimersByTimeAsync(0)

    active.value = false
    await vi.advanceTimersByTimeAsync(UPCOMING_REFRESH_MS * 2)
    expect(asked(calls)).toBe(1)

    active.value = true
    await vi.advanceTimersByTimeAsync(0)
    expect(asked(calls)).toBe(2)

    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(UPCOMING_REFRESH_MS * 2)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(asked(calls)).toBe(2)
  })
})
