// An in-memory Keychain/Keystore for tests. `options` are recorded so a test can check how values were stored.

const store = new Map<string, string>()
export const calls: { method: string; key: string; options?: Record<string, unknown> }[] = []

export const AFTER_FIRST_UNLOCK = 'AFTER_FIRST_UNLOCK'
export const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY = 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY'
export const WHEN_UNLOCKED = 'WHEN_UNLOCKED'

export async function getItemAsync(key: string, options?: Record<string, unknown>): Promise<string | null> {
  calls.push({ method: 'get', key, options })
  return store.get(key) ?? null
}

export async function setItemAsync(key: string, value: string, options?: Record<string, unknown>): Promise<void> {
  calls.push({ method: 'set', key, options })
  store.set(key, value)
}

export async function deleteItemAsync(key: string, options?: Record<string, unknown>): Promise<void> {
  calls.push({ method: 'delete', key, options })
  store.delete(key)
}

/** For tests: what is stored, and a clean slate. */
export function __dump(): Record<string, string> {
  return Object.fromEntries(store)
}

export function __reset(): void {
  store.clear()
  calls.length = 0
}
