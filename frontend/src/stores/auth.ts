import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import * as authApi from '@/api/auth'
import { isApiError } from '@/api/errors'
import { setTokenProvider } from '@/api/http'
import * as meApi from '@/api/me'
import { clearStoredSession, getToken, getTokenExpiry, saveSession } from '@/api/tokenStorage'
import { isAppLocale, setLocale, type AppLocale } from '@/i18n'
import type { ApiError } from '@/api/errors'
import type { ProfilePatch, RegisterInput, User } from '@/types/user'
import { describeDevice } from '@/utils/deviceName'

/** `expired`: the server refused the token (or it ran out). `elsewhere`: signed out in another tab or window. */
export type SignOutReason = 'expired' | 'elsewhere'

/** True when the stored token has a known expiry that has already passed. */
function expired(expiresAt: string | null, now: number = Date.now()): boolean {
  if (!expiresAt) return false
  const time = Date.parse(expiresAt)
  return Number.isFinite(time) && time <= now
}

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(null)
  const user = ref<User | null>(null)
  /** Set when the stored session could not be checked because the server was unreachable (not because it was refused). */
  const bootError = ref<ApiError | null>(null)
  /** Why the person was signed out without asking to be (here, or in another tab): shown once on the login screen. */
  const endedReason = ref<SignOutReason | null>(null)

  const isAuthenticated = computed(() => token.value !== null)

  let bootPromise: Promise<void> | null = null

  /** Reads the saved token. A token that is already past its expiry is dropped without asking the server. */
  function restoreSession(): void {
    const stored = getToken()
    if (stored && expired(getTokenExpiry())) {
      clearStoredSession()
      token.value = null
      endedReason.value = 'expired'
      return
    }
    token.value = stored
  }

  function applyUser(next: User): void {
    user.value = next
    if (isAppLocale(next.locale)) setLocale(next.locale)
  }

  /**
   * Forgets the session on this device. Does not call the server: use `logout` for that. What is stored is only removed
   * when it is still this tab's session: another tab may have signed in since, and its session is not ours to end.
   */
  function clearSession(reason: SignOutReason | null = null): void {
    const stored = getToken()
    if (stored === null || stored === token.value) clearStoredSession()
    token.value = null
    user.value = null
    bootError.value = null
    bootPromise = null
    endedReason.value = reason
  }

  /**
   * Loads the signed-in user once (the router waits for this before showing a private page).
   * If the server refuses the token the session is cleared; if it cannot be reached the token is kept
   * and `bootError` is set, so the shell can offer "Try again" instead of throwing the person out.
   */
  function ensureUser(): Promise<void> {
    if (!token.value || user.value) return Promise.resolve()

    bootPromise ??= meApi
      .getMe()
      .then((me) => {
        bootError.value = null
        applyUser(me)
      })
      .catch((error: unknown) => {
        // A 401 has already been handled by the API client (it calls clearSession through the hook).
        if (isApiError(error) && error.status !== 401) bootError.value = error
      })
      .finally(() => {
        bootPromise = null
      })

    return bootPromise
  }

  /** Loads the profile again (after verifying the email address, say). A failure keeps the one we have. */
  async function refreshUser(): Promise<void> {
    if (!token.value) return
    try {
      const me = await meApi.getMe()
      if (token.value) applyUser(me)
    } catch {
      // a 401 has signed the session out already; anything else: try again later
    }
  }

  async function login(email: string, password: string): Promise<void> {
    const result = await authApi.login(email.trim(), password, describeDevice())
    saveSession(result.token, result.expires_at)
    token.value = result.token
    endedReason.value = null
    bootError.value = null
    applyUser(result.user)
  }

  /**
   * Creates the account, then signs in with the same details (the API's register does not sign anyone in).
   * Returns `needs-login` when the account exists but the automatic sign-in failed.
   */
  async function register(input: RegisterInput): Promise<'signed-in' | 'needs-login'> {
    await authApi.register(input)

    try {
      await login(input.email, input.password)
      return 'signed-in'
    } catch {
      return 'needs-login'
    }
  }

  /** Signs out on the server (best effort) and on this device. The device is signed out even if the server cannot be reached. */
  async function logout(): Promise<void> {
    try {
      await authApi.logout()
    } catch {
      // The token may already be gone (401) or the server unreachable: either way this device must sign out.
    }
    clearSession()
  }

  async function updateProfile(patch: ProfilePatch): Promise<User> {
    const updated = await meApi.updateMe(patch)
    user.value = updated
    return updated
  }

  /**
   * Changes settings at once and saves them (the server merges them key by key). If the server refuses, they go back
   * to what they were and the error is thrown.
   */
  async function saveSettings(patch: Record<string, unknown>): Promise<void> {
    const current = user.value
    if (!current) return
    const before = Object.fromEntries(Object.keys(patch).map((key) => [key, current.settings[key]]))
    user.value = { ...current, settings: { ...current.settings, ...patch } }

    try {
      await updateProfile({ settings: patch })
    } catch (error) {
      if (user.value?.id === current.id) user.value = { ...user.value, settings: { ...user.value.settings, ...before } }
      throw error
    }
  }

  async function uploadAvatar(file: Blob, onProgress?: (percent: number) => void): Promise<User> {
    const updated = await meApi.uploadAvatar(file, onProgress)
    user.value = updated
    return updated
  }

  /** Switches the language now and, when signed in, remembers it on the account. */
  async function changeLocale(locale: AppLocale): Promise<void> {
    setLocale(locale)
    if (!user.value || user.value.locale === locale) return
    await updateProfile({ locale })
  }

  restoreSession()
  // Requests carry the session this tab holds, whatever another tab writes to storage meanwhile.
  setTokenProvider(() => token.value)

  return {
    token,
    user,
    bootError,
    endedReason,
    isAuthenticated,
    restoreSession,
    clearSession,
    ensureUser,
    refreshUser,
    login,
    register,
    logout,
    updateProfile,
    saveSettings,
    uploadAvatar,
    changeLocale,
  }
})
