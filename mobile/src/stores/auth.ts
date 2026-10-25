// Ported from frontend/src/stores/auth.ts (Pinia) to Zustand. Differences: the token is read from secure storage once
// at start (asynchronously), there are no other tabs, and signing out first runs the "before sign-out" hooks (8B/8F
// register removing this phone's push registration there).
import { create } from 'zustand'

import * as authApi from '@/api/auth'
import { isApiError, type ApiError } from '@/api/errors'
import { setTokenProvider, setUnauthorizedHandler } from '@/api/http'
import * as meApi from '@/api/me'
import { clearStoredSession, readSession, saveSession } from '@/api/tokenStorage'
import { isAppLocale, setLocale, type AppLocale } from '@/i18n'
import type { ProfilePatch, RegisterInput, User } from '@/types/user'
import { describeDevice } from '@/utils/deviceName'

/** `restoring`: reading the saved token at start (the splash screen stays up). */
export type AuthStatus = 'restoring' | 'signedOut' | 'signedIn'

/** `expired`: the server refused the token, or it ran out. */
export type SignOutReason = 'expired'

/** True when the token has a known expiry that has already passed. */
export function isExpired(expiresAt: string | null, now: number = Date.now()): boolean {
  if (!expiresAt) return false
  const time = Date.parse(expiresAt)
  return Number.isFinite(time) && time <= now
}

/** Work to do while the token still works, just before signing out (best effort; a failure never blocks it). */
const beforeSignOut = new Set<() => Promise<void>>()

export function onBeforeSignOut(hook: () => Promise<void>): () => void {
  beforeSignOut.add(hook)
  return () => beforeSignOut.delete(hook)
}

interface AuthState {
  status: AuthStatus
  token: string | null
  user: User | null
  /** The saved session could not be checked because the server was unreachable (not because it was refused). */
  bootError: ApiError | null
  /** Why the person was signed out without asking to be: shown once on the sign-in screen. */
  endedReason: SignOutReason | null

  restore(): Promise<void>
  loadUser(): Promise<void>
  login(email: string, password: string): Promise<void>
  register(input: RegisterInput): Promise<'signed-in' | 'needs-login'>
  logout(): Promise<void>
  clearSession(reason?: SignOutReason | null): void
  updateProfile(patch: ProfilePatch): Promise<User>
  saveSettings(patch: Record<string, unknown>): Promise<void>
  uploadAvatar(file: meApi.AvatarFile, onProgress?: (percent: number) => void): Promise<User>
  changeLocale(locale: AppLocale): Promise<void>
  dismissEndedReason(): void
}

export const useAuthStore = create<AuthState>()((set, get) => {
  function applyUser(user: User): void {
    set({ user })
    if (isAppLocale(user.locale)) setLocale(user.locale)
  }

  return {
    status: 'restoring',
    token: null,
    user: null,
    bootError: null,
    endedReason: null,

    /** Reads the saved token. One already past its expiry is dropped without asking the server. */
    async restore() {
      const { token, expiresAt } = await readSession()
      if (token && isExpired(expiresAt)) {
        await clearStoredSession()
        set({ status: 'signedOut', token: null, endedReason: 'expired' })
        return
      }
      if (!token) {
        set({ status: 'signedOut', token: null })
        return
      }
      set({ status: 'signedIn', token })
      await get().loadUser()
    },

    /**
     * Loads the signed-in person. If the server refuses the token, the 401 hook has signed out already; if it cannot
     * be reached, the token is kept and `bootError` is set, so the app can offer "Try again".
     */
    async loadUser() {
      if (!get().token) return
      try {
        const me = await meApi.getMe()
        set({ bootError: null })
        applyUser(me)
      } catch (error) {
        if (isApiError(error) && error.status !== 401) set({ bootError: error })
      }
    },

    async login(email, password) {
      const result = await authApi.login(email.trim(), password, describeDevice())
      await saveSession(result.token, result.expires_at)
      set({ status: 'signedIn', token: result.token, endedReason: null, bootError: null })
      applyUser(result.user)
    },

    /** Creates the account, then signs in with the same details (the API's register does not sign anyone in). */
    async register(input) {
      await authApi.register(input)
      try {
        await get().login(input.email, input.password)
        return 'signed-in'
      } catch {
        return 'needs-login'
      }
    },

    /** Signs out on the server (best effort) and on this phone. The phone is signed out even if the server cannot be reached. */
    async logout() {
      for (const hook of beforeSignOut) await hook().catch(() => undefined)
      try {
        await authApi.logout()
      } catch {
        // The token may already be gone (401) or the server unreachable: either way this phone signs out.
      }
      get().clearSession()
    },

    /** Forgets the session on this phone. Does not call the server: use `logout` for that. */
    clearSession(reason = null) {
      void clearStoredSession()
      set({ status: 'signedOut', token: null, user: null, bootError: null, endedReason: reason })
    },

    async updateProfile(patch) {
      const updated = await meApi.updateMe(patch)
      applyUser(updated)
      return updated
    },

    /** Changes settings at once and saves them. If the server refuses, they go back to what they were. */
    async saveSettings(patch) {
      const current = get().user
      if (!current) return
      const before = Object.fromEntries(Object.keys(patch).map((key) => [key, current.settings[key]]))
      set({ user: { ...current, settings: { ...current.settings, ...patch } } })
      try {
        await get().updateProfile({ settings: patch })
      } catch (error) {
        const now = get().user
        if (now?.id === current.id) set({ user: { ...now, settings: { ...now.settings, ...before } } })
        throw error
      }
    },

    async uploadAvatar(file, onProgress) {
      const updated = await meApi.uploadAvatar(file, onProgress)
      set({ user: updated })
      return updated
    },

    /** Switches the language now and, when signed in, remembers it on the account. */
    async changeLocale(locale) {
      setLocale(locale)
      const user = get().user
      if (!user || user.locale === locale) return
      await get().updateProfile({ locale })
    },

    dismissEndedReason() {
      set({ endedReason: null })
    },
  }
})

// Requests carry the token this store holds; a refused token ends the session here.
setTokenProvider(() => useAuthStore.getState().token)
setUnauthorizedHandler(() => {
  if (useAuthStore.getState().token) useAuthStore.getState().clearSession('expired')
})
