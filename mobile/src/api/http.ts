// Ported from frontend/src/api/http.ts. Differences: the token comes from the auth store (read from the Keychain or
// Keystore at start), not from localStorage, and there are no other tabs to keep in step with.
import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios'

import { toApiError } from '@/api/errors'
import { config } from '@/config'

declare module 'axios' {
  interface AxiosRequestConfig {
    /** Do not send the bearer token (login, register and the other public routes). */
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
  baseURL: config.apiBaseUrl,
  headers: { Accept: 'application/json' },
  // Mobile data can be slow: generous, but not endless.
  timeout: 30_000,
})

/* ------------------------------------------------------------------ hooks set by the rest of the app ---- */

let socketIdResolver: () => string | undefined = () => undefined

/** Requests that change something carry the WebSocket id as `X-Socket-ID`, so the server does not echo the event back. */
export function setSocketIdResolver(resolver: () => string | undefined): void {
  socketIdResolver = resolver
}

let tokenProvider: () => string | null = () => null

/** Where the bearer token comes from: the auth store registers it once the token has been read from secure storage. */
export function setTokenProvider(provider: () => string | null): void {
  tokenProvider = provider
}

let unauthorizedHandler: () => void = () => undefined

/** Called when the server says the token is no longer valid; the auth store forgets the session. */
export function setUnauthorizedHandler(handler: () => void): void {
  unauthorizedHandler = handler
}

/* ---------------------------------------------------------------------------------------- interceptors --- */

function sentToken(requestConfig: InternalAxiosRequestConfig | undefined): string | null {
  const header = requestConfig?.headers?.get('Authorization')
  return typeof header === 'string' && header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null
}

http.interceptors.request.use((requestConfig) => {
  if (!requestConfig.skipAuth) {
    const token = tokenProvider()
    if (token) requestConfig.headers.set('Authorization', `Bearer ${token}`)
  }

  const method = (requestConfig.method ?? 'get').toLowerCase()
  if (method !== 'get' && method !== 'head') {
    const socketId = socketIdResolver()
    if (socketId) requestConfig.headers.set('X-Socket-ID', socketId)
  }

  return requestConfig
})

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

http.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    const axiosError = error as AxiosError
    const requestConfig = axiosError.config
    const status = axiosError.response?.status

    if (status === 429 && requestConfig && !requestConfig.rateLimitRetried) {
      const method = (requestConfig.method ?? 'get').toLowerCase()
      const repeatable = method === 'get' || method === 'head' || requestConfig.retryOn429 === true
      const seconds = toApiError(error).retryAfter

      if (repeatable && seconds !== undefined && seconds <= MAX_AUTO_RETRY_SECONDS) {
        requestConfig.rateLimitRetried = true
        await wait(seconds * 1000)
        return http.request(requestConfig)
      }
    }

    if (status === 401) {
      // Only react when the token that was refused is still the one we hold: a late 401 for an old token must not
      // sign out a session that has been renewed since.
      const refused = sentToken(requestConfig)
      if (refused !== null && refused === tokenProvider()) unauthorizedHandler()
    }

    throw toApiError(error)
  },
)
