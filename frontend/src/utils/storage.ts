/**
 * localStorage that never throws. In a private window, with site data blocked, or when the disk is full,
 * the browser can refuse: the app then simply forgets things between visits instead of breaking.
 */
export function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

/** Returns whether the browser kept it (it may be full or switched off); callers that can live without may ignore that. */
export function writeStorage(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function removeStorage(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // not available: nothing to do
  }
}
