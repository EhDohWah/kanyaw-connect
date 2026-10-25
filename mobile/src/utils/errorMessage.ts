// Ported from frontend/src/utils/errorMessage.ts.
import type { ApiError } from '@/api/errors'

type Translate = (key: string, named?: Record<string, unknown>) => string

/**
 * The sentence to show a person for a failed request. Our own wording (translated) for problems the server cannot
 * describe in the person's language; the server's message for everything it can explain itself.
 */
export function errorMessage(error: ApiError, t: Translate): string {
  if (error.isNetwork) return t('errors.network')
  if (error.status === 401) return t('errors.unauthorized')
  if (error.status === 429) {
    return error.retryAfter !== undefined
      ? t('errors.rateLimited', { seconds: error.retryAfter })
      : t('errors.rateLimitedNoWait')
  }
  if (error.status >= 500) return t('errors.server')
  return error.message || t('errors.unknown')
}
