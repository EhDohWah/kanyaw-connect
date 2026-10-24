import type { Router } from 'vue-router'

import { i18n } from '@/i18n'
import { browserPush } from '@/push/browser'
import { useAuthStore } from '@/stores/auth'
import { usePushStore } from '@/stores/push'
import { useUiStore } from '@/stores/ui'

/**
 * The route a notification may open, from the address the service worker sends: a chat, a meeting, or the start page,
 * on this site. Anything else is null.
 */
export function notificationRoute(
  url: unknown,
  origin: string = window.location.origin,
  base: string = import.meta.env.BASE_URL,
): string | null {
  if (typeof url !== 'string') return null

  let target: URL
  try {
    target = new URL(url, origin)
  } catch {
    return null
  }
  const root = base.endsWith('/') ? base : `${base}/`
  if (target.origin !== origin || !target.pathname.startsWith(root)) return null

  const path = `/${target.pathname.slice(root.length)}`
  return /^\/((chats|rooms)\/[A-Za-z0-9-]{1,64})?$/.test(path) ? path : null
}

/**
 * Listens to the service worker (public/sw.js): a tapped notification opens its chat or meeting in this window,
 * without reloading; a subscription the browser changed is registered again. Returns the function that stops listening.
 */
export function installServiceWorkerMessages(router: Router): () => void {
  return browserPush().listen((message) => {
    if (message === null || typeof message !== 'object') return
    const { type, url } = message as { type?: unknown; url?: unknown }

    if (type === 'kc:push-changed') {
      if (useAuthStore().user) void usePushStore().restore()
      return
    }
    if (type !== 'kc:open') return

    const path = notificationRoute(url)
    if (path === null || router.currentRoute.value.path === path) return

    const ui = useUiStore()
    // Opening another page would end the meeting: say so instead, and stay.
    if (ui.callOpen) {
      ui.toast(i18n.global.t('push.inMeeting'))
      return
    }
    void router.push(path)
  })
}
