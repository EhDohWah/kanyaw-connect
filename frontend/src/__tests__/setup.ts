import { afterEach, beforeEach, vi } from 'vitest'

import { setSocketIdResolver, setUnauthorizedHandler } from '@/api/http'
import { setLocale } from '@/i18n'
import { unmountAll } from '@/__tests__/helpers'

beforeEach(() => {
  window.localStorage.clear()
  setLocale('en')
  // jsdom has no scrolling; the router asks for it after every navigation.
  window.scrollTo = vi.fn() as typeof window.scrollTo
})

afterEach(() => {
  unmountAll()
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
  setUnauthorizedHandler(() => undefined)
  setSocketIdResolver(() => undefined)
})
