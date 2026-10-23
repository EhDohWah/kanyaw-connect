import { readStorage, removeStorage, writeStorage } from '@/utils/storage'

/*
 * The API uses bearer tokens, not cookies, so the token lives in localStorage. It is only ever read here
 * and sent in the Authorization header: never logged, never put in a URL.
 */
const TOKEN_KEY = 'kc.token'
const EXPIRES_KEY = 'kc.tokenExpiresAt'

export function getToken(): string | null {
  return readStorage(TOKEN_KEY)
}

export function getTokenExpiry(): string | null {
  return readStorage(EXPIRES_KEY)
}

export function saveSession(token: string, expiresAt: string): void {
  writeStorage(TOKEN_KEY, token)
  writeStorage(EXPIRES_KEY, expiresAt)
}

export function clearStoredSession(): void {
  removeStorage(TOKEN_KEY)
  removeStorage(EXPIRES_KEY)
}
