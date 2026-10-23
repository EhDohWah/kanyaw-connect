import type { Router } from 'vue-router'

import { setUnauthorizedHandler } from '@/api/http'
import { useAuthStore } from '@/stores/auth'

/**
 * When the server refuses our token (expired after 30 days, or revoked from another device) the session ends
 * here: forget it, and go to the login screen, remembering where the person was so they can pick up again.
 */
export function installUnauthorizedHandler(router: Router): void {
  setUnauthorizedHandler(() => {
    const auth = useAuthStore()
    if (!auth.isAuthenticated) return

    auth.clearSession('expired')

    const here = router.currentRoute.value
    if (here.meta.requiresAuth) {
      void router.replace({ name: 'login', query: here.fullPath === '/' ? {} : { redirect: here.fullPath } })
    }
  })
}
