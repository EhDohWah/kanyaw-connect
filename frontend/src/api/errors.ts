import { isAxiosError } from 'axios'

import type { ApiErrorBody } from '@/types/api'

/**
 * Every failed request ends as one of these, whatever went wrong. `status` 0 means the server never answered
 * (offline, timeout, blocked). Show `message` to people; branch on `code` and `status` in code.
 */
export class ApiError extends Error {
  readonly status: number
  /** `network` when there was no answer, else the server's machine-readable code (`room_full`, ...) if it sent one. */
  readonly code: string | undefined
  /** Field name -> messages (422). */
  readonly fieldErrors: Record<string, string[]>
  /** Seconds to wait before trying again (429). */
  readonly retryAfter: number | undefined

  constructor(init: {
    status: number
    message: string
    code?: string
    fieldErrors?: Record<string, string[]>
    retryAfter?: number
  }) {
    super(init.message)
    this.name = 'ApiError'
    this.status = init.status
    this.code = init.code
    this.fieldErrors = init.fieldErrors ?? {}
    this.retryAfter = init.retryAfter
  }

  get isNetwork(): boolean {
    return this.status === 0
  }

  /** The first message for a field, if the server complained about it. */
  fieldError(field: string): string | undefined {
    return this.fieldErrors[field]?.[0]
  }
}

function retryAfterSeconds(value: unknown): number | undefined {
  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds) : undefined
}

/** Turns whatever was thrown into an ApiError. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error

  if (isAxiosError<Partial<ApiErrorBody>>(error)) {
    const response = error.response

    if (!response) {
      return new ApiError({ status: 0, code: 'network', message: error.message })
    }

    const body = response.data && typeof response.data === 'object' ? response.data : {}
    const retryAfter = response.status === 429 ? retryAfterSeconds(response.headers?.['retry-after']) : undefined

    return new ApiError({
      status: response.status,
      message: typeof body.message === 'string' ? body.message : error.message,
      code: typeof body.code === 'string' ? body.code : undefined,
      fieldErrors: body.errors ?? {},
      ...(retryAfter !== undefined ? { retryAfter } : {}),
    })
  }

  return new ApiError({ status: 0, code: 'unknown', message: error instanceof Error ? error.message : String(error) })
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}
