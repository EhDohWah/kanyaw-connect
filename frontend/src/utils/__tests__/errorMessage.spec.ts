import { describe, expect, it } from 'vitest'

import { ApiError } from '@/api/errors'
import { i18n } from '@/i18n'
import { errorMessage } from '@/utils/errorMessage'

const t = (key: string, named?: Record<string, unknown>) => i18n.global.t(key, named ?? {})

describe('errorMessage', () => {
  it('uses our own words for network, auth, rate-limit and server problems', () => {
    expect(errorMessage(new ApiError({ status: 0, code: 'network', message: 'Network Error' }), t)).toBe(i18n.global.t('errors.network'))
    expect(errorMessage(new ApiError({ status: 401, message: 'Unauthenticated.' }), t)).toBe(i18n.global.t('errors.unauthorized'))
    expect(errorMessage(new ApiError({ status: 500, message: 'Server Error' }), t)).toBe(i18n.global.t('errors.server'))
    expect(errorMessage(new ApiError({ status: 503, message: 'x' }), t)).toBe(i18n.global.t('errors.server'))
  })

  it('tells how long to wait on a 429, with the number in the sentence', () => {
    const message = errorMessage(new ApiError({ status: 429, message: 'Too many', retryAfter: 42 }), t)
    expect(message).toContain('42')
  })

  it('has a sentence for a 429 without Retry-After', () => {
    const message = errorMessage(new ApiError({ status: 429, message: 'Too many' }), t)
    expect(message).toBe(i18n.global.t('errors.rateLimitedNoWait'))
  })

  it('shows the server message for everything it can explain itself', () => {
    expect(errorMessage(new ApiError({ status: 403, message: 'You are not a member of this chat.' }), t)).toBe('You are not a member of this chat.')
    expect(errorMessage(new ApiError({ status: 409, code: 'room_full', message: 'The room is full.' }), t)).toBe('The room is full.')
  })
})
