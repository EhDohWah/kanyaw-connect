import Constants from 'expo-constants'
import * as Notifications from 'expo-notifications'
import { AndroidImportance } from 'expo-notifications'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'

import { removeNativePushToken, registerNativePushToken } from '@/api/push'
import { isApiError } from '@/api/errors'

/*
 * Push notifications on this phone: the switch in Settings. Turning it on asks for permission (only then, never at
 * launch), creates the Android channels the server sends on, gets the FCM or APNs token and registers it with the
 * server. The token is never logged or kept on the phone: only the registration's id is, with the person it belongs
 * to, so the next person to sign in on this phone does not inherit it.
 *
 * Later parts: the PushKit (VoIP) token arrives with 8E, tapping a notification and the explanation shown after
 * sign-in with 8F.
 */

const STORAGE_KEY = 'kc.phonePush'
const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK }

/** `blocked`: the person refused and the system no longer asks; only the phone's settings can turn it on. */
export type PhonePushState = 'off' | 'on' | 'blocked'

interface Stored {
  userId: string
  registrationId: string
}

async function readStored(): Promise<Stored | null> {
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEY, OPTIONS)
    const parsed = raw ? (JSON.parse(raw) as Partial<Stored>) : null
    return parsed?.userId && parsed.registrationId
      ? { userId: parsed.userId, registrationId: parsed.registrationId }
      : null
  } catch {
    return null
  }
}

async function writeStored(value: Stored | null): Promise<void> {
  if (value) await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(value), OPTIONS)
  else await SecureStore.deleteItemAsync(STORAGE_KEY, OPTIONS).catch(() => undefined)
}

/**
 * The channels the server names (Android 8 and later show notifications only on a channel, and Android 13 asks for
 * permission only once one exists). Names are in English for now; 8F localises them and adds `calls`.
 */
export async function createChannels(): Promise<void> {
  if (Platform.OS !== 'android') return
  await Notifications.setNotificationChannelAsync('messages', {
    name: 'Messages',
    importance: AndroidImportance.DEFAULT,
  })
  await Notifications.setNotificationChannelAsync('missed-calls', {
    name: 'Missed calls',
    importance: AndroidImportance.DEFAULT,
  })
}

function platform(): 'android' | 'ios' {
  return Platform.OS === 'ios' ? 'ios' : 'android'
}

async function register(userId: string): Promise<void> {
  const { data: token } = await Notifications.getDevicePushTokenAsync()
  const registration = await registerNativePushToken({
    platform: platform(),
    token: String(token),
    app_version: Constants.expoConfig?.version ?? null,
  })
  await writeStored({ userId, registrationId: registration.id })
}

/** What the switch shows for this person. */
export async function phonePushState(userId: string): Promise<PhonePushState> {
  const [stored, permission] = await Promise.all([readStored(), Notifications.getPermissionsAsync()])
  if (permission.granted) return stored?.userId === userId ? 'on' : 'off'
  return permission.canAskAgain ? 'off' : 'blocked'
}

/** Asks for permission if needed, then registers. Throws when the token or the server request fails. */
export async function enablePhonePush(userId: string): Promise<PhonePushState> {
  await createChannels()

  let permission = await Notifications.getPermissionsAsync()
  if (!permission.granted && permission.canAskAgain) permission = await Notifications.requestPermissionsAsync()
  if (!permission.granted) return permission.canAskAgain ? 'off' : 'blocked'

  await register(userId)
  return 'on'
}

/** Removes this phone's registration on the server (an already removed one is fine) and forgets it here. */
export async function disablePhonePush(): Promise<void> {
  const stored = await readStored()
  if (stored) {
    try {
      await removeNativePushToken(stored.registrationId)
    } catch (error) {
      if (!(isApiError(error) && error.status === 404)) throw error
    }
  }
  await writeStored(null)
}

/**
 * At every start while signed in, and whenever the system hands out a new token: registers again if this person
 * turned notifications on here and still allows them. Best effort; a failure leaves the switch as it was.
 */
export async function refreshPhonePush(userId: string): Promise<void> {
  const stored = await readStored()
  if (stored?.userId !== userId) return

  const permission = await Notifications.getPermissionsAsync()
  if (!permission.granted) {
    await writeStored(null)
    return
  }

  await createChannels()
  await register(userId)
}

/** Forget the registration on this phone without asking the server (it removes it when the login ends). */
export async function forgetPhonePush(): Promise<void> {
  await writeStored(null)
}
