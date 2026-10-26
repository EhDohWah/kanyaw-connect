import * as Notifications from 'expo-notifications'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'

import { disablePhonePush, enablePhonePush, forgetPhonePush, phonePushState, refreshPhonePush } from '@/push/phonePush'
import { fakeApi, restoreApi, type Call } from '@/testing/fakeApi'

jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '1.2.3' } } }))

const notifications = Notifications as unknown as typeof Notifications & {
  __state: {
    answer: string
    token: string
    tokenError: Error | null
    channels: Record<string, unknown>
    requests: number
  }
  __grant(): void
  __reset(): void
}
const store = SecureStore as unknown as typeof SecureStore & { __dump(): Record<string, string>; __reset(): void }

const REGISTRATION = {
  id: 'reg-1',
  platform: 'ios',
  has_voip_token: false,
  app_version: '0.1.0',
  last_seen_at: '2026-10-26T09:00:00.000000Z',
  created_at: '2026-10-26T09:00:00.000000Z',
}

let calls: Call[]

beforeEach(() => {
  notifications.__reset()
  store.__reset()
  calls = fakeApi(({ method }) =>
    method === 'post' ? { status: 201, data: { data: REGISTRATION } } : { status: 204 },
  ).calls
})

afterEach(() => restoreApi())

describe('turning it on', () => {
  it('asks for permission, registers the device token and remembers the registration for this person', async () => {
    expect(await enablePhonePush('user-1')).toBe('on')

    expect(notifications.__state.requests).toBe(1)
    expect(calls).toEqual([
      expect.objectContaining({
        method: 'post',
        url: '/push/native-tokens',
        body: { platform: 'ios', token: 'fake-device-token', app_version: '1.2.3' },
      }),
    ])
    expect(JSON.parse(store.__dump()['kc.phonePush'] ?? '{}')).toEqual({ userId: 'user-1', registrationId: 'reg-1' })
    expect(await phonePushState('user-1')).toBe('on')
  })

  it('keeps the token itself off the phone', async () => {
    await enablePhonePush('user-1')

    expect(JSON.stringify(store.__dump())).not.toContain('fake-device-token')
  })

  it('does not ask again when permission was already given', async () => {
    notifications.__grant()

    await enablePhonePush('user-1')

    expect(notifications.__state.requests).toBe(0)
  })

  it('stays off when the person says no, and says "blocked" when the system will not ask again', async () => {
    notifications.__state.answer = 'denied'
    expect(await enablePhonePush('user-1')).toBe('off')

    notifications.__reset()
    notifications.__state.answer = 'blocked'
    expect(await enablePhonePush('user-1')).toBe('blocked')
    expect(await phonePushState('user-1')).toBe('blocked')
    expect(calls).toEqual([])
  })

  it('throws, and remembers nothing, when the token cannot be had', async () => {
    notifications.__state.tokenError = new Error('no Firebase')

    await expect(enablePhonePush('user-1')).rejects.toThrow()
    expect(store.__dump()['kc.phonePush']).toBeUndefined()
  })
})

describe('turning it off', () => {
  it('removes the registration on the server and forgets it', async () => {
    await enablePhonePush('user-1')

    await disablePhonePush()

    expect(calls.at(-1)).toEqual(expect.objectContaining({ method: 'delete', url: '/push/native-tokens/reg-1' }))
    expect(store.__dump()['kc.phonePush']).toBeUndefined()
    expect(await phonePushState('user-1')).toBe('off')
  })

  it('accepts a registration the server already removed', async () => {
    await enablePhonePush('user-1')
    calls = fakeApi(() => ({ status: 404, data: { message: 'Not found.' } })).calls

    await expect(disablePhonePush()).resolves.toBeUndefined()
    expect(store.__dump()['kc.phonePush']).toBeUndefined()
  })
})

describe('at start', () => {
  it('registers again for the same person while permission lasts', async () => {
    await enablePhonePush('user-1')
    notifications.__state.token = 'new-token'

    await refreshPhonePush('user-1')

    expect(calls.at(-1)?.body).toEqual(expect.objectContaining({ token: 'new-token' }))
  })

  it('does nothing for someone else signed in on the same phone', async () => {
    await enablePhonePush('user-1')
    const before = calls.length

    await refreshPhonePush('user-2')

    expect(calls).toHaveLength(before)
    expect(await phonePushState('user-2')).toBe('off')
  })

  it("forgets the registration when permission was taken away in the phone's settings", async () => {
    await enablePhonePush('user-1')
    notifications.__reset()
    const before = calls.length

    await refreshPhonePush('user-1')

    expect(calls).toHaveLength(before)
    expect(store.__dump()['kc.phonePush']).toBeUndefined()
  })
})

describe('on Android', () => {
  beforeEach(() => jest.replaceProperty(Platform, 'OS', 'android'))
  afterEach(() => jest.restoreAllMocks())

  it('creates the channels the server sends on before asking, and registers as android', async () => {
    await enablePhonePush('user-1')

    expect(Object.keys(notifications.__state.channels)).toEqual(['messages', 'missed-calls'])
    expect(calls[0]?.body).toEqual(expect.objectContaining({ platform: 'android' }))
  })
})

it('forgets the registration on sign-out without asking the server', async () => {
  await enablePhonePush('user-1')
  const before = calls.length

  await forgetPhonePush()

  expect(calls).toHaveLength(before)
  expect(store.__dump()['kc.phonePush']).toBeUndefined()
})
