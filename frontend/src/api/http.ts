import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios'

import { toApiError } from '@/api/errors'
import { getToken } from '@/api/tokenStorage'

declare module 'axios' {
  interface AxiosRequestConfig {
    /** Do not send the bearer token (login and register). */
    skipAuth?: boolean
    /** Wait and send the request again once after a 429. Always on for GET and HEAD; opt in for anything else that is safe to repeat. */
    retryOn429?: boolean
    /** Internal: this request has already been repeated after a 429. */
    rateLimitRetried?: boolean
  }
}

/** The longest we will wait on our own after a 429. A longer `Retry-After` is shown to the person instead. */
export const MAX_AUTO_RETRY_SECONDS = 10

export const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  headers: { Accept: 'application/json' },
  timeout: 20_000,
})

/* ------------------------------------------------------------------ hooks set by the rest of the app ---- */

let socketIdResolver: () => string | undefined = () => undefined

/**
 * Tells the API client how to find the WebSocket connection id. Requests that change something carry it as
 * `X-Socket-ID`, so the server does not send the resulting event back to the tab that caused it.
 */
export function setSocketIdResolver(resolver: () => string | undefined): void {
  socketIdResolver = resolver
}

let tokenProvider: () => string | null = getToken

/**
 * Where the bearer token comes from: the session this tab holds (the auth store registers it). Not straight from
 * `localStorage`, which every tab shares: another tab signing in as someone else must not make this tab's screens send
 * requests as that person. Until a store registers (and in tests) it falls back to what is stored.
 */
export function setTokenProvider(provider: (() => string | null) | null): void {
  tokenProvider = provider ?? getToken
}

let unauthorizedHandler: () => void = () => undefined

/**
 * Called when the server says the token is no longer valid. The auth store registers a function that forgets
 * the session and goes to the login screen; keeping it a hook stops this file importing the store and router.
 */
export function setUnauthorizedHandler(handler: () => void): void {
  unauthorizedHandler = handler
}

/* ---------------------------------------------------------------------------------------- interceptors --- */

function sentToken(config: InternalAxiosRequestConfig | undefined): string | null {
  const header = config?.headers?.get('Authorization')
  return typeof header === 'string' && header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null
}

http.interceptors.request.use((config) => {
  if (!config.skipAuth) {
    const token = tokenProvider()
    if (token) config.headers.set('Authorization', `Bearer ${token}`)
  }

  const method = (config.method ?? 'get').toLowerCase()
  if (method !== 'get' && method !== 'head') {
    const socketId = socketIdResolver()
    if (socketId) config.headers.set('X-Socket-ID', socketId)
  }

  return config
})

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

http.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    const axiosError = error as AxiosError
    const config = axiosError.config
    const status = axiosError.response?.status

    if (status === 429 && config && !config.rateLimitRetried) {
      const method = (config.method ?? 'get').toLowerCase()
      const repeatable = method === 'get' || method === 'head' || config.retryOn429 === true
      const seconds = toApiError(error).retryAfter

      if (repeatable && seconds !== undefined && seconds <= MAX_AUTO_RETRY_SECONDS) {
        config.rateLimitRetried = true
        await wait(seconds * 1000)
        return http.request(config)
      }
    }

    if (status === 401) {
      // Only react when the token that was refused is still the one we hold: a late 401 for an old token must
      // not sign out a session that has been renewed since.
      const refused = sentToken(config)
      if (refused !== null && refused === tokenProvider()) unauthorizedHandler()
    }

    throw toApiError(error)
  },
)
