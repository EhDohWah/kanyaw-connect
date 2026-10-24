import { afterEach, beforeEach, vi } from 'vitest'

import { setSocketIdResolver, setUnauthorizedHandler } from '@/api/http'
import { setLocale } from '@/i18n'
import { echoes, fakeEchoFactory } from '@/__tests__/fakeEcho'
import { unmountAll } from '@/__tests__/helpers'

// No test opens a real WebSocket: the app gets a fake Echo that a test can drive (src/__tests__/fakeEcho.ts).
vi.mock('@/realtime/echo', () => ({ createEcho: (token: string) => fakeEchoFactory(token) }))

beforeEach(() => {
  echoes.length = 0
  window.localStorage.clear()
  setLocale('en')
  // jsdom has no scrolling; the router asks for it after every navigation.
  window.scrollTo = vi.fn() as typeof window.scrollTo
  // jsdom cannot make object URLs (picture previews).
  URL.createObjectURL = vi.fn(() => 'blob:preview') as typeof URL.createObjectURL
  URL.revokeObjectURL = vi.fn() as typeof URL.revokeObjectURL
})

afterEach(() => {
  unmountAll()
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
  setUnauthorizedHandler(() => undefined)
  setSocketIdResolver(() => undefined)
})
