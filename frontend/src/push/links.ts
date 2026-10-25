import type { Router } from 'vue-router'

import { i18n } from '@/i18n'
import { browserPush } from '@/push/browser'
import { useAuthStore } from '@/stores/auth'
import { useDirectCallStore } from '@/stores/directCall'
import { usePushStore } from '@/stores/push'
import { useUiStore } from '@/stores/ui'

/** A call page from a notification (`/calls/<id>`, `?answer=1` for its Answer button): the call, else null. */
export function callTarget(path: string): { callId: string; answer: boolean } | null {
  const match = /^\/calls\/([A-Za-z0-9-]{1,64})(\?answer=1)?$/.exec(path)
  return match?.[1] ? { callId: match[1], answer: match[2] !== undefined } : null
}

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
  if (/^\/calls\/[A-Za-z0-9-]{1,64}$/.test(path)) return target.search === '?answer=1' ? `${path}?answer=1` : path
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
    // A call came in while a window was open: this window rings (the service worker showed nothing).
    if (type === 'kc:call') {
      const callId = (message as { call_id?: unknown }).call_id
      if (useAuthStore().user && typeof callId === 'string') void useDirectCallStore().openCall(callId)
      return
    }
    if (type !== 'kc:open') return

    const path = notificationRoute(url)
    if (path === null || router.currentRoute.value.fullPath === path) return

    // A call notification: the call opens over whatever is on screen (a meeting is not left by it).
    const target = callTarget(path)
    if (target) {
      if (useAuthStore().user) void useDirectCallStore().openCall(target.callId, { answer: target.answer })
      return
    }

    const ui = useUiStore()
    // Opening another page would end the meeting: say so instead, and stay.
    if (ui.callOpen) {
      ui.toast(i18n.global.t('push.inMeeting'))
      return
    }
    void router.push(path)
  })
}
