import { afterEach, beforeEach, vi } from 'vitest'

import { setSocketIdResolver, setTokenProvider, setUnauthorizedHandler } from '@/api/http'
import { setLocale } from '@/i18n'
import { createMockFeedService } from '@/mocks/feedService'
import { setBrowserPush } from '@/push/browser'
import { setFeedService } from '@/services'
import { useAuthStore } from '@/stores/auth'
import { echoes, fakeEchoFactory } from '@/__tests__/fakeEcho'
import { unmountAll } from '@/__tests__/helpers'

// No test opens a real WebSocket: the app gets a fake Echo that a test can drive (src/__tests__/fakeEcho.ts).
vi.mock('@/realtime/echo', () => ({ createEcho: (token: string) => fakeEchoFactory(token) }))

beforeEach(() => {
  echoes.length = 0
  window.localStorage.clear()
  // The sample feed without its pause (150–400 ms a call), writing as whoever is signed in.
  setFeedService(
    createMockFeedService({
      delay: () => 0,
      currentUser: () => {
        const user = useAuthStore().user
        return user ? { id: user.id, name: user.name, avatar_url: user.avatar_url, avatar_thumb_url: user.avatar_thumb_url } : null
      },
    }),
  )
  setLocale('en')
  // jsdom has no scrolling; the router asks for it after every navigation.
  window.scrollTo = vi.fn() as typeof window.scrollTo
  // jsdom cannot make object URLs (picture previews).
  URL.createObjectURL = vi.fn(() => 'blob:preview') as typeof URL.createObjectURL
  URL.revokeObjectURL = vi.fn() as typeof URL.revokeObjectURL
})

afterEach(() => {
  unmountAll()
  setFeedService(null)
  setBrowserPush(null)
  vi.useRealTimers()
  vi.restoreAllMocks()
  // Fakes put in place of browser APIs jsdom lacks (MediaRecorder, AudioContext, the microphone).
  vi.unstubAllGlobals()
  Reflect.deleteProperty(navigator, 'mediaDevices')
  document.body.innerHTML = ''
  setUnauthorizedHandler(() => undefined)
  setSocketIdResolver(() => undefined)
  // Each test's auth store registers its own; without one, requests read the stored token.
  setTokenProvider(null)
})
