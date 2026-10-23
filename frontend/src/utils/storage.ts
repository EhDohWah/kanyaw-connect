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

export function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // not available: nothing to do
  }
}

export function removeStorage(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // not available: nothing to do
  }
}
