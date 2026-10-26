import { fireEvent, render, screen } from '@testing-library/react-native'
import * as Notifications from 'expo-notifications'
import * as SecureStore from 'expo-secure-store'
import { Linking } from 'react-native'

import { PhonePushSetting } from '@/components/settings/PhonePushSetting'
import { i18n } from '@/i18n'
import { fakeApi, restoreApi, type Call } from '@/testing/fakeApi'

const notifications = Notifications as unknown as typeof Notifications & {
  __state: { answer: string; tokenError: Error | null }
  __reset(): void
}
const store = SecureStore as unknown as typeof SecureStore & { __reset(): void }

let calls: Call[]

beforeEach(() => {
  notifications.__reset()
  store.__reset()
  void i18n.changeLanguage('en')
  calls = fakeApi(({ method }) =>
    method === 'post'
      ? {
          status: 201,
          data: {
            data: {
              id: 'reg-1',
              platform: 'ios',
              has_voip_token: false,
              app_version: null,
              last_seen_at: '2026-10-26T09:00:00Z',
              created_at: '2026-10-26T09:00:00Z',
            },
          },
        }
      : { status: 204 },
  ).calls
})

afterEach(() => restoreApi())

async function showSetting() {
  await render(<PhonePushSetting userId="user-1" />)
  await screen.findByText('New messages and missed calls, even when Kanyaw Connect is closed.')
  return screen.getByLabelText('Notifications on this phone')
}

it('starts off, and turning it on registers this phone', async () => {
  const toggle = await showSetting()
  expect(toggle).toHaveProp('value', false)

  await fireEvent(toggle, 'valueChange', true)

  expect(await screen.findByLabelText('Notifications on this phone')).toHaveProp('value', true)
  expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual(['post /push/native-tokens'])
})

it('turning it off removes the registration', async () => {
  await fireEvent(await showSetting(), 'valueChange', true)
  await screen.findByText('New messages and missed calls, even when Kanyaw Connect is closed.')

  await fireEvent(screen.getByLabelText('Notifications on this phone'), 'valueChange', false)

  await screen.findByText('New messages and missed calls, even when Kanyaw Connect is closed.')
  expect(screen.getByLabelText('Notifications on this phone')).toHaveProp('value', false)
  expect(calls.at(-1)).toEqual(expect.objectContaining({ method: 'delete', url: '/push/native-tokens/reg-1' }))
})

it('explains a refusal the system will not ask about again, and opens the phone settings', async () => {
  notifications.__state.answer = 'blocked'
  const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined)

  await fireEvent(await showSetting(), 'valueChange', true)

  expect(await screen.findByText(/turned off for Kanyaw Connect in your phone's settings/)).toBeOnTheScreen()
  expect(screen.getByLabelText('Notifications on this phone')).toBeDisabled()
  await fireEvent.press(screen.getByText('Open phone settings'))
  expect(openSettings).toHaveBeenCalled()
})

it('says so when this phone could not turn notifications on', async () => {
  notifications.__state.tokenError = new Error('no Firebase')

  await fireEvent(await showSetting(), 'valueChange', true)

  expect(
    await screen.findByText('This phone could not turn on notifications. Please try again later.'),
  ).toBeOnTheScreen()
  expect(screen.getByLabelText('Notifications on this phone')).toHaveProp('value', false)
})
