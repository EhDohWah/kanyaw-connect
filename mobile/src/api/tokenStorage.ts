// Replaces frontend/src/api/tokenStorage.ts (localStorage) with the iOS Keychain and Android Keystore.
import * as SecureStore from 'expo-secure-store'

/*
 * The bearer token is kept in secure storage only, never in AsyncStorage, and is never logged or put in a URL.
 * `AFTER_FIRST_UNLOCK` on iOS: the VoIP push handler (8E) can run while the phone is locked, after its first unlock.
 */
const TOKEN_KEY = 'kc.token'
const EXPIRES_KEY = 'kc.tokenExpiresAt'

const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK }

export interface StoredSession {
  token: string | null
  expiresAt: string | null
}

export async function readSession(): Promise<StoredSession> {
  try {
    const [token, expiresAt] = await Promise.all([
      SecureStore.getItemAsync(TOKEN_KEY, OPTIONS),
      SecureStore.getItemAsync(EXPIRES_KEY, OPTIONS),
    ])
    return { token, expiresAt }
  } catch {
    // Unreadable (a restored backup on another device, say): start signed out.
    return { token: null, expiresAt: null }
  }
}

export async function saveSession(token: string, expiresAt: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token, OPTIONS)
  await SecureStore.setItemAsync(EXPIRES_KEY, expiresAt, OPTIONS)
}

export async function clearStoredSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(TOKEN_KEY, OPTIONS).catch(() => undefined),
    SecureStore.deleteItemAsync(EXPIRES_KEY, OPTIONS).catch(() => undefined),
  ])
}
