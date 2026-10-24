import type { Router } from 'vue-router'

import { setUnauthorizedHandler } from '@/api/http'
import { getToken, TOKEN_KEY } from '@/api/tokenStorage'
import { useAuthStore } from '@/stores/auth'

/** Back to the login screen, remembering where the person was so they can pick up again. */
function toLogin(router: Router): void {
  const here = router.currentRoute.value
  if (here.meta.requiresAuth) {
    void router.replace({ name: 'login', query: here.fullPath === '/' ? {} : { redirect: here.fullPath } })
  }
}

/**
 * When the server refuses our token (expired after 30 days, or revoked from another device) the session ends
 * here: forget it, and go to the login screen, remembering where the person was so they can pick up again.
 */
export function installUnauthorizedHandler(router: Router): void {
  setUnauthorizedHandler(() => {
    const auth = useAuthStore()
    if (!auth.isAuthenticated) return

    auth.clearSession('expired')
    toLogin(router)
  })
}

/**
 * Every tab of the browser shares one stored session. When another tab signs out, this one signs out too (instead of
 * failing every request); when another tab signs in, possibly as someone else, this one starts over with that session
 * (instead of showing one person's chats while acting as another). Returns the function that stops listening.
 */
export function installSessionSync(router: Router, reload: () => void = () => window.location.reload()): () => void {
  const onStorage = (event: StorageEvent): void => {
    // `key` is null when the whole storage was cleared.
    if (event.key !== null && event.key !== TOKEN_KEY) return

    const auth = useAuthStore()
    const stored = getToken()
    if (stored === auth.token) return

    if (stored === null) {
      auth.clearSession('elsewhere')
      toLogin(router)
      return
    }
    reload()
  }

  window.addEventListener('storage', onStorage)
  return () => window.removeEventListener('storage', onStorage)
}
