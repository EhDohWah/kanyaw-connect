import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { deferred, fakeApi, PAW, restoreApi } from '@/__tests__/helpers'
import { usePresenceStore } from '@/stores/presence'

beforeEach(() => setActivePinia(createPinia()))
afterEach(restoreApi)

const online = (id: string) => ({ id, status: 'online', last_seen_at: '2026-03-14T09:00:00.000000Z' })

describe('who is online', () => {
  it('knows who the server said is online', async () => {
    fakeApi(() => ({ data: { data: [online(PAW)] } }))
    const presence = usePresenceStore()

    await presence.refresh([PAW, 'someone-else'])

    expect(presence.isOnline(PAW)).toBe(true)
    expect(presence.isOnline('someone-else')).toBe(false)
    expect(presence.isOnline(undefined)).toBe(false)
  })

  it('is "loading" until the first answer, then "ready"', async () => {
    const wait = deferred<void>()
    fakeApi(async () => {
      await wait.promise
      return { data: { data: [] } }
    })
    const presence = usePresenceStore()
    expect(presence.status).toBe('idle')

    const asking = presence.refresh([PAW])
    expect(presence.status).toBe('loading')
    wait.resolve()
    await asking

    expect(presence.status).toBe('ready')
  })

  it('is ready at once when there is nobody to ask about, without a request', async () => {
    const { calls } = fakeApi(() => ({ data: { data: [] } }))
    const presence = usePresenceStore()

    await presence.refresh([])

    expect(presence.status).toBe('ready')
    expect(calls).toHaveLength(0)
  })

  it('says "error" when the first answer cannot be had', async () => {
    fakeApi(() => ({ network: true }))
    const presence = usePresenceStore()

    await presence.refresh([PAW])

    expect(presence.status).toBe('error')
    expect(presence.isOnline(PAW)).toBe(false)
  })

  it('keeps showing what it knew when a later lookup fails', async () => {
    let up = true
    fakeApi(() => (up ? { data: { data: [online(PAW)] } } : { network: true }))
    const presence = usePresenceStore()
    await presence.refresh([PAW])

    up = false
    await presence.refresh([PAW])

    expect(presence.status).toBe('ready')
    expect(presence.isOnline(PAW)).toBe(true)
  })

  it('recovers from "error" on the next success', async () => {
    let up = false
    fakeApi(() => (up ? { data: { data: [online(PAW)] } } : { network: true }))
    const presence = usePresenceStore()
    await presence.refresh([PAW])

    up = true
    await presence.refresh([PAW])

    expect(presence.status).toBe('ready')
    expect(presence.isOnline(PAW)).toBe(true)
  })

  it('treats a person the server leaves out as not online, and forgets everything on reset', async () => {
    let answer: unknown[] = [online(PAW)]
    fakeApi(() => ({ data: { data: answer } }))
    const presence = usePresenceStore()
    await presence.refresh([PAW])

    answer = []
    await presence.refresh([PAW])
    expect(presence.isOnline(PAW)).toBe(false)

    answer = [online(PAW)]
    await presence.refresh([PAW])
    presence.reset()
    expect(presence.isOnline(PAW)).toBe(false)
    expect(presence.status).toBe('idle')
  })
})
