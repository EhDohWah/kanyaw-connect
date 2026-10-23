import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios'
import { describe, expect, it } from 'vitest'

import { ApiError, isApiError, toApiError } from '@/api/errors'

function failure(status: number, data: unknown, headers: Record<string, string> = {}): AxiosError {
  const config = { headers: new AxiosHeaders() }
  const response = { status, data, headers, config, statusText: '' } as AxiosResponse
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', config, {}, response)
}

describe('toApiError', () => {
  it('turns "no answer" into status 0 with code network', () => {
    const error = toApiError(new AxiosError('Network Error', 'ERR_NETWORK'))

    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(0)
    expect(error.code).toBe('network')
    expect(error.isNetwork).toBe(true)
  })

  it('reads message and field errors from a 422', () => {
    const error = toApiError(failure(422, { message: 'Invalid', errors: { email: ['Taken', 'Other'], name: ['Required'] } }))

    expect(error.status).toBe(422)
    expect(error.message).toBe('Invalid')
    expect(error.fieldError('email')).toBe('Taken')
    expect(error.fieldError('name')).toBe('Required')
    expect(error.fieldError('phone')).toBeUndefined()
    expect(error.isNetwork).toBe(false)
  })

  it('keeps the machine-readable code of a conflict', () => {
    const error = toApiError(failure(409, { message: 'The room is full.', code: 'room_full' }))

    expect(error.code).toBe('room_full')
    expect(error.status).toBe(409)
  })

  it('reads Retry-After on a 429 and rounds up', () => {
    const error = toApiError(failure(429, { message: 'Too Many Attempts.' }, { 'retry-after': '12.2' }))

    expect(error.status).toBe(429)
    expect(error.retryAfter).toBe(13)
  })

  it('ignores a missing or nonsense Retry-After', () => {
    expect(toApiError(failure(429, {}, {})).retryAfter).toBeUndefined()
    expect(toApiError(failure(429, {}, { 'retry-after': 'soon' })).retryAfter).toBeUndefined()
  })

  it('does not break when the body is not JSON (a proxy error page)', () => {
    const error = toApiError(failure(502, '<html>Bad gateway</html>'))

    expect(error.status).toBe(502)
    expect(error.fieldErrors).toEqual({})
    expect(error.message).toContain('502')
  })

  it('passes an ApiError through unchanged and wraps anything else', () => {
    const original = new ApiError({ status: 403, message: 'No' })

    expect(toApiError(original)).toBe(original)
    expect(toApiError(new Error('boom')).message).toBe('boom')
    expect(toApiError('weird').message).toBe('weird')
    expect(isApiError(original)).toBe(true)
    expect(isApiError(new Error('x'))).toBe(false)
  })
})
