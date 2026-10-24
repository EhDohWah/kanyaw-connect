import { describe, expect, it } from 'vitest'

import { ApiError } from '@/api/errors'
import { joinFailure, loadFailure } from '@/utils/joinOutcome'

const error = (status: number, extra: { code?: string; fieldErrors?: Record<string, string[]>; retryAfter?: number } = {}) =>
  new ApiError({ status, message: 'Server says no', ...extra })

describe('joinFailure: what a refused join means (docs/API.md, POST /rooms/{room}/join)', () => {
  it.each([
    ['422 without a password: one is needed', error(422, { fieldErrors: { password: ['Required.'] } }), false, { problem: { kind: 'password-required' } }],
    ['422 with a password: it was wrong', error(422, { fieldErrors: { password: ['Wrong.'] } }), true, { problem: { kind: 'password-wrong', message: 'Wrong.' } }],
    ['409 room_ended', error(409, { code: 'room_ended' }), false, { over: 'ended' }],
    ['409 room_locked', error(409, { code: 'room_locked' }), false, { problem: { kind: 'locked' } }],
    ['409 room_full', error(409, { code: 'room_full' }), false, { problem: { kind: 'full' } }],
    ['403 join_denied', error(403, { code: 'join_denied' }), false, { over: 'denied' }],
    ['403 without a code: not invited', error(403), false, { over: 'forbidden' }],
    ['404', error(404), false, { over: 'not-found' }],
    ['429', error(429, { retryAfter: 12 }), false, { problem: { kind: 'rate-limited', retryAfter: 12 } }],
    ['503', error(503), false, { problem: { kind: 'unavailable' } }],
    ['no network', error(0, { code: 'network' }), false, { problem: { kind: 'network' } }],
    ['anything else', error(500), false, { problem: { kind: 'unknown', message: 'Server says no' } }],
  ])('%s', (_name, apiError, sentPassword, expected) => {
    expect(joinFailure(apiError, sentPassword)).toEqual(expected)
  })
})

describe('loadFailure: a room that cannot be opened', () => {
  it('is over for 403 and 404, and worth trying again for anything else', () => {
    expect(loadFailure(error(403))).toBe('forbidden')
    expect(loadFailure(error(404))).toBe('not-found')
    expect(loadFailure(error(500))).toBeNull()
    expect(loadFailure(error(0, { code: 'network' }))).toBeNull()
  })
})
