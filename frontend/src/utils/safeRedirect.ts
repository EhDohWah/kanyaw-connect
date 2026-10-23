const BLOCKED_TARGETS = ['/login', '/register']

/**
 * Where to go after signing in. The target comes from the address bar (`?redirect=`), so it is only used when
 * it is a path inside this app: never another site, never a `//host` or `/\host` trick, never back to the login form.
 */
export function safeRedirect(target: unknown, fallback = '/'): string {
  if (typeof target !== 'string' || !target.startsWith('/')) return fallback
  if (target.startsWith('//') || target.startsWith('/\\') || /[\u0000-\u001f]/.test(target)) return fallback

  let url: URL
  try {
    url = new URL(target, 'http://internal.invalid')
  } catch {
    return fallback
  }

  if (url.origin !== 'http://internal.invalid') return fallback
  if (BLOCKED_TARGETS.includes(url.pathname)) return fallback

  return url.pathname + url.search + url.hash
}
