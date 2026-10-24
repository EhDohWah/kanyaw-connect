import type { Router } from 'vue-router'

import { i18n } from '@/i18n'
import { useUiStore } from '@/stores/ui'
import { readSession, removeSession, writeSession } from '@/utils/storage'

/** The page we reloaded into once already: if it fails again, it is not a new version but the network. */
const RELOADED_KEY = 'kc.reloadedFor'

/**
 * A page's code could not be downloaded. Usually a new version of the app was put online while this tab was open: the
 * old file names are gone. (Chrome, Firefox, Safari and Vite each word it differently.)
 */
export function isPageLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(message)
}

/**
 * When moving to a page fails because its code cannot be downloaded, load that page afresh (which also fetches the new
 * version of the app). Once only: if it fails again, or the browser is offline, say so instead of reloading in a loop.
 */
export function installPageLoadRecovery(router: Router, load: (url: string) => void = (url) => window.location.assign(url)): void {
  router.onError((error, to) => {
    if (!isPageLoadError(error)) return

    const ui = useUiStore()
    if (!navigator.onLine) {
      ui.toast(i18n.global.t('errors.network'), 'error')
      return
    }
    if (readSession(RELOADED_KEY) === to.fullPath) {
      removeSession(RELOADED_KEY)
      ui.toast(i18n.global.t('errors.pageLoad'), 'error')
      return
    }
    writeSession(RELOADED_KEY, to.fullPath)
    load(router.resolve(to.fullPath).href)
  })

  // The page came: a later failure may reload again.
  router.afterEach((_to, _from, failure) => {
    if (!failure) removeSession(RELOADED_KEY)
  })
}
