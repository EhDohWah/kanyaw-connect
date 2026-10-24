import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SUBSCRIPTION, useFakePush } from '@/__tests__/fakePush'
import { ME, fakeApi, makeUser, restoreApi, settle, type Call, type Reply } from '@/__tests__/helpers'
import { ApiError } from '@/api/errors'
import { useAuthStore } from '@/stores/auth'
import { PUSH_OWNER_KEY, usePushStore } from '@/stores/push'

const KEY = 'BOkHTBX7c6Iy4iAw-ZX54HhOcQ2y-QwO9Nn-k8NXXNmKdRHB8Ljr0pYb_tfu5GdKp8hHMTDdjmwoGOe6B7u5TrQ'
const RECORD = { id: 'sub-1', endpoint: SUBSCRIPTION.endpoint, created_at: '2026-03-14T09:08:26.304038Z' }

interface Server {
  enabled: boolean
  /** Subscriptions the server has for this person. */
  known: (typeof RECORD)[]
  fail: Partial<Record<string, Reply>>
}

let server: Server

function serve() {
  return fakeApi((call: Call): Reply => {
    const failure = server.fail[`${call.method} ${call.url}`]
    if (failure) return failure
    if (call.url === '/push/public-key') return { data: { data: { enabled: server.enabled, public_key: server.enabled ? KEY : null } } }
    if (call.method === 'get' && call.url === '/push/subscriptions') return { data: { data: server.known } }
    if (call.method === 'post' && call.url === '/push/subscriptions') {
      server.known = [RECORD]
      return { status: 201, data: { data: RECORD } }
    }
    if (call.method === 'delete') {
      server.known = []
      return { status: 204 }
    }
    return { status: 404, data: { message: 'Not found.' } }
  })
}

const sent = (calls: Call[], method: string, url: string) => calls.filter((c) => c.method === method && c.url === url)

beforeEach(() => {
  setActivePinia(createPinia())
  const auth = useAuthStore()
  auth.token = '1|secret-token'
  auth.user = makeUser({ id: ME })
  server = { enabled: true, known: [], fail: {} }
})
afterEach(restoreApi)

describe('checking where notifications stand', () => {
  it('a browser that cannot show them: unsupported, and the server is not even asked', async () => {
    useFakePush({ supported: false })
    const { calls } = serve()
    const push = usePushStore()

    await push.check()
    expect(push.status).toBe('unsupported')
    expect(calls).toHaveLength(0)
  })

  it('the server has push switched off: unavailable (the option is hidden)', async () => {
    useFakePush()
    server.enabled = false
    serve()
    const push = usePushStore()

    await push.check()
    expect(push.status).toBe('unavailable')
  })

  it('notifications refused for this site: blocked', async () => {
    useFakePush({ permission: 'denied' })
    serve()
    const push = usePushStore()

    await push.check()
    expect(push.status).toBe('blocked')
  })

  it('no subscription in this browser: off, without listing the server\'s', async () => {
    useFakePush({ permission: 'granted' })
    const { calls } = serve()
    const push = usePushStore()

    await push.check()
    expect(push.status).toBe('off')
    expect(sent(calls, 'get', '/push/subscriptions')).toHaveLength(0)
  })

  it('a subscription the server knows: on, with its id, and remembered for the next sign-in', async () => {
    useFakePush({ permission: 'granted', subscription: SUBSCRIPTION })
    server.known = [{ ...RECORD, id: 'other', endpoint: 'https://fcm.googleapis.com/fcm/send/someone-elses' }, RECORD]
    serve()
    const push = usePushStore()

    await push.check()
    expect(push.status).toBe('on')
    expect(push.subscriptionId).toBe('sub-1')
    expect(window.localStorage.getItem(PUSH_OWNER_KEY)).toBe(ME)
  })

  it('a subscription the server does not know (signed out since, or dropped): off', async () => {
    useFakePush({ permission: 'granted', subscription: SUBSCRIPTION })
    serve()
    const push = usePushStore()

    await push.check()
    expect(push.status).toBe('off')
    expect(push.subscriptionId).toBeNull()
  })

  it('no network: failed, with the reason; trying again works', async () => {
    useFakePush({ permission: 'granted' })
    server.fail['get /push/public-key'] = { network: true }
    serve()
    const push = usePushStore()

    await push.check()
    expect(push.status).toBe('failed')
    expect(push.error).toBeInstanceOf(ApiError)

    delete server.fail['get /push/public-key']
    await push.check()
    expect(push.status).toBe('off')
    expect(push.error).toBeNull()
  })

  it('"checking" shows only while nothing is known; checking again keeps showing the known state', async () => {
    useFakePush({ permission: 'granted', subscription: SUBSCRIPTION })
    server.known = [RECORD]
    serve()
    const push = usePushStore()

    const first = push.check()
    expect(push.status).toBe('checking')
    await first

    const again = push.check()
    expect(push.status).toBe('on')
    await again
  })
})

describe('turning on', () => {
  async function ready(over: Parameters<typeof useFakePush>[0] = {}) {
    const fake = useFakePush(over)
    const api = serve()
    const push = usePushStore()
    await push.check()
    return { fake, push, calls: api.calls }
  }

  it('asks the person at once (still answering the tap), subscribes with the server key and registers the browser', async () => {
    const { fake, push, calls } = await ready()

    const turning = push.turnOn()
    // Nothing awaited before the question: Safari would not show it otherwise.
    expect(fake.requestPermission).toHaveBeenCalledTimes(1)
    expect(push.busy).toBe(true)
    await turning

    expect(fake.subscribe).toHaveBeenCalledWith(KEY)
    expect(sent(calls, 'post', '/push/subscriptions')[0]!.body).toEqual(SUBSCRIPTION)
    expect(push.status).toBe('on')
    expect(push.subscriptionId).toBe('sub-1')
    expect(push.busy).toBe(false)
    expect(window.localStorage.getItem(PUSH_OWNER_KEY)).toBe(ME)
  })

  it('already allowed: does not ask again', async () => {
    const { fake, push } = await ready({ permission: 'granted' })
    await push.turnOn()
    expect(fake.requestPermission).not.toHaveBeenCalled()
    expect(push.status).toBe('on')
  })

  it('the question closed without an answer: stays off, nothing sent, no error (they can try again)', async () => {
    const { push, calls } = await ready({ answer: 'default' })
    await push.turnOn()

    expect(push.status).toBe('off')
    expect(push.error).toBeNull()
    expect(sent(calls, 'post', '/push/subscriptions')).toHaveLength(0)
  })

  it('refused: blocked', async () => {
    const { push, calls } = await ready({ answer: 'denied' })
    await push.turnOn()

    expect(push.status).toBe('blocked')
    expect(sent(calls, 'post', '/push/subscriptions')).toHaveLength(0)
  })

  it('the browser cannot subscribe: stays off with the reason', async () => {
    const { push } = await ready({ permission: 'granted', failSubscribe: new Error('push service not available') })
    await push.turnOn()

    expect(push.status).toBe('off')
    expect(push.error).toBeInstanceOf(Error)
    expect(push.busy).toBe(false)
  })

  it('the server refuses the browser (422): stays off with the server\'s reason', async () => {
    server.fail['post /push/subscriptions'] = {
      status: 422,
      data: { message: 'You have too many push subscriptions.', errors: { endpoint: ['You have too many push subscriptions.'] } },
    }
    const { push } = await ready({ permission: 'granted' })
    await push.turnOn()

    expect(push.status).toBe('off')
    expect((push.error as ApiError).status).toBe(422)
  })

  it('a second tap while turning on does nothing', async () => {
    const { fake, push } = await ready({ permission: 'granted' })
    const first = push.turnOn()
    await push.turnOn()
    await first
    expect(fake.subscribe).toHaveBeenCalledTimes(1)
  })

  it('nothing happens before the server key is known', async () => {
    const fake = useFakePush()
    serve()
    await usePushStore().turnOn()
    expect(fake.requestPermission).not.toHaveBeenCalled()
  })
})

describe('turning off', () => {
  async function on() {
    const fake = useFakePush({ permission: 'granted', subscription: SUBSCRIPTION })
    server.known = [RECORD]
    const api = serve()
    const push = usePushStore()
    await push.check()
    expect(push.status).toBe('on')
    return { fake, push, calls: api.calls }
  }

  it('ends the browser\'s subscription first, then removes it on the server, and forgets who had it on', async () => {
    const { fake, push, calls } = await on()
    await push.turnOff()

    expect(fake.unsubscribe).toHaveBeenCalled()
    expect(sent(calls, 'delete', '/push/subscriptions/sub-1')).toHaveLength(1)
    expect(push.status).toBe('off')
    expect(push.subscriptionId).toBeNull()
    expect(window.localStorage.getItem(PUSH_OWNER_KEY)).toBeNull()
  })

  it('already gone on the server (404): off all the same', async () => {
    server.fail['delete /push/subscriptions/sub-1'] = { status: 404, data: { message: 'Not found.' } }
    const { push } = await on()
    await push.turnOff()
    expect(push.status).toBe('off')
    expect(push.error).toBeNull()
  })

  it('the server cannot be reached, but the browser\'s subscription is gone: off (nothing can arrive any more)', async () => {
    server.fail['delete /push/subscriptions/sub-1'] = { network: true }
    const { push } = await on()
    await push.turnOff()
    expect(push.status).toBe('off')
    expect(push.error).toBeNull()
  })

  it('neither the browser nor the server could stop it: stays on, with the reason', async () => {
    server.fail['delete /push/subscriptions/sub-1'] = { network: true }
    const { fake, push } = await on()
    fake.state.failUnsubscribe = new Error('no')
    await push.turnOff()

    expect(push.status).toBe('on')
    expect(push.error).toBeInstanceOf(ApiError)
    expect(push.busy).toBe(false)
  })
})

describe('after signing in again', () => {
  it('turns notifications back on for whoever had them on in this browser, without asking', async () => {
    window.localStorage.setItem(PUSH_OWNER_KEY, ME)
    const fake = useFakePush({ permission: 'granted' })
    const { calls } = serve()
    const push = usePushStore()

    await push.restore()

    expect(fake.requestPermission).not.toHaveBeenCalled()
    expect(sent(calls, 'post', '/push/subscriptions')[0]!.body).toEqual(SUBSCRIPTION)
    expect(push.status).toBe('on')
    expect(push.subscriptionId).toBe('sub-1')
  })

  it('a reload with the subscription still known: nothing is sent (the server allows 30 an hour)', async () => {
    window.localStorage.setItem(PUSH_OWNER_KEY, ME)
    useFakePush({ permission: 'granted', subscription: SUBSCRIPTION })
    server.known = [RECORD]
    const { calls } = serve()
    const push = usePushStore()

    await push.restore()
    expect(sent(calls, 'post', '/push/subscriptions')).toHaveLength(0)
    expect(push.status).toBe('on')
  })

  it('someone else turned them on in this browser: nothing happens', async () => {
    window.localStorage.setItem(PUSH_OWNER_KEY, 'someone-else')
    useFakePush({ permission: 'granted' })
    const { calls } = serve()

    await usePushStore().restore()
    expect(calls).toHaveLength(0)
  })

  it('the browser no longer allows notifications, or cannot show them: nothing happens, nobody is asked', async () => {
    window.localStorage.setItem(PUSH_OWNER_KEY, ME)
    const fake = useFakePush({ permission: 'default' })
    const { calls } = serve()

    await usePushStore().restore()
    fake.state.supported = false
    fake.state.permission = 'granted'
    await usePushStore().restore()

    expect(calls).toHaveLength(0)
    expect(fake.requestPermission).not.toHaveBeenCalled()
  })

  it('the server has push off, or cannot be reached: quietly nothing', async () => {
    window.localStorage.setItem(PUSH_OWNER_KEY, ME)
    const fake = useFakePush({ permission: 'granted' })
    server.enabled = false
    serve()
    const push = usePushStore()

    await expect(push.restore()).resolves.toBeUndefined()
    server.enabled = true
    server.fail['post /push/subscriptions'] = { network: true }
    await expect(push.restore()).resolves.toBeUndefined()
    expect(push.status).toBe('idle')
    expect(fake.subscribe).toHaveBeenCalledTimes(1)
  })
})

describe('signing out', () => {
  it('ends this browser\'s subscription and forgets the state, but remembers who had them on', async () => {
    window.localStorage.setItem(PUSH_OWNER_KEY, ME)
    const fake = useFakePush({ permission: 'granted', subscription: SUBSCRIPTION })
    server.known = [RECORD]
    serve()
    const push = usePushStore()
    await push.check()

    push.forget()
    await settle()

    expect(fake.unsubscribe).toHaveBeenCalled()
    expect(push.status).toBe('idle')
    expect(push.subscriptionId).toBeNull()
    expect(window.localStorage.getItem(PUSH_OWNER_KEY)).toBe(ME)
  })

  it('an answer that arrives after signing out changes nothing', async () => {
    useFakePush({ permission: 'granted', subscription: SUBSCRIPTION })
    server.known = [RECORD]
    serve()
    const push = usePushStore()

    const checking = push.check()
    push.forget()
    await checking
    await settle()

    expect(push.status).toBe('idle')
    expect(push.subscriptionId).toBeNull()
  })

  it('signing out while the server\'s list is on its way: the answer changes nothing', async () => {
    useFakePush({ permission: 'granted', subscription: SUBSCRIPTION })
    server.known = [RECORD]
    let release: () => void = () => undefined
    const { calls } = fakeApi(async (call) => {
      if (call.url === '/push/public-key') return { data: { data: { enabled: true, public_key: KEY } } }
      await new Promise<void>((resolve) => (release = resolve))
      return { data: { data: server.known } }
    })
    const push = usePushStore()

    const checking = push.check()
    await vi.waitFor(() => expect(calls.some((c) => c.url === '/push/subscriptions')).toBe(true))
    push.forget()
    release()
    await checking

    expect(push.status).toBe('idle')
    expect(push.subscriptionId).toBeNull()
    expect(window.localStorage.getItem(PUSH_OWNER_KEY)).toBeNull()
  })

  it('a browser that cannot do push has nothing to end', () => {
    const fake = useFakePush({ supported: false })
    usePushStore().forget()
    expect(fake.unsubscribe).not.toHaveBeenCalled()
  })
})

describe('one step at a time', () => {
  it('turning off waits for a check in progress, so they cannot cross', async () => {
    const fake = useFakePush({ permission: 'granted', subscription: SUBSCRIPTION })
    server.known = [RECORD]
    serve()
    const push = usePushStore()
    await push.check()

    const checking = push.check()
    const turningOff = push.turnOff()
    await Promise.all([checking, turningOff])

    expect(push.status).toBe('off')
    expect(fake.state.subscription).toBeNull()
  })
})
