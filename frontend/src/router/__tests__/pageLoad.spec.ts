import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installPageLoadRecovery, isPageLoadError } from '@/router/pageLoad'
import { useUiStore } from '@/stores/ui'

const Page = { template: '<p>page</p>' }

describe('isPageLoadError', () => {
  it('recognises a page file that could not be downloaded, however the browser words it', () => {
    expect(isPageLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/ProfileView-1a2b.js'))).toBe(true)
    expect(isPageLoadError(new TypeError('error loading dynamically imported module: https://x/assets/a.js'))).toBe(true)
    expect(isPageLoadError(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isPageLoadError(new Error('Unable to preload CSS for /assets/a.css'))).toBe(true)
  })

  it('anything else is not', () => {
    expect(isPageLoadError(new Error('Request failed with status code 500'))).toBe(false)
    expect(isPageLoadError('nope')).toBe(false)
  })
})

describe('installPageLoadRecovery', () => {
  let router: Router
  let load: ReturnType<typeof vi.fn<(url: string) => void>>
  let broken: boolean

  beforeEach(async () => {
    setActivePinia(createPinia())
    window.sessionStorage.clear()
    broken = true
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: Page },
        {
          path: '/profile',
          component: () => (broken ? Promise.reject(new TypeError('Failed to fetch dynamically imported module: /assets/ProfileView.js')) : Promise.resolve(Page)),
        },
        { path: '/fails', component: () => Promise.reject(new Error('Something else')) },
      ],
    })
    load = vi.fn<(url: string) => void>()
    installPageLoadRecovery(router, load)
    await router.push('/')
  })

  afterEach(() => vi.restoreAllMocks())

  it('loads the page afresh (getting the new version of the app) instead of doing nothing', async () => {
    await router.push('/profile').catch(() => undefined)
    expect(load).toHaveBeenCalledWith('/profile')
  })

  it('only once: failing again on the same page says so instead of reloading in a loop', async () => {
    await router.push('/profile').catch(() => undefined)
    await router.push('/profile').catch(() => undefined)

    expect(load).toHaveBeenCalledTimes(1)
    expect(useUiStore().toasts.map((t) => t.message)).toEqual(['This page could not be loaded. Check your connection and try again.'])
  })

  it('a page that loads (after the reload) lets a later failure reload again', async () => {
    await router.push('/profile').catch(() => undefined)
    expect(load).toHaveBeenCalledTimes(1)

    // The reloaded page: a new router (a new document) in the same tab, where the page now loads.
    const reloaded = createRouter({ history: createMemoryHistory(), routes: [{ path: '/profile', component: Page }] })
    installPageLoadRecovery(reloaded, load)
    await reloaded.push('/profile')

    // Much later, the next version of the app: the same page fails in yet another document. It reloads again.
    const later = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/profile', component: () => Promise.reject(new TypeError('Failed to fetch dynamically imported module: /x.js')) }],
    })
    installPageLoadRecovery(later, load)
    await later.push('/profile').catch(() => undefined)

    expect(load).toHaveBeenCalledTimes(2)
  })

  it("offline: says so, and does not reload into the browser's own \"no internet\" page", async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await router.push('/profile').catch(() => undefined)

    expect(load).not.toHaveBeenCalled()
    expect(useUiStore().toasts.map((t) => t.message)).toEqual(["Can't reach the server. Check your connection and try again."])
  })

  it('other errors are left alone', async () => {
    await router.push('/fails').catch(() => undefined)
    expect(load).not.toHaveBeenCalled()
    expect(useUiStore().toasts).toHaveLength(0)
  })
})
