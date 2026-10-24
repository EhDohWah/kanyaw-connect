import type { ApiError } from '@/api/errors'
import type { CallOverReason, JoinProblem } from '@/types/call'

/**
 * What a refused `POST /rooms/{room}/join` means for the screen: a problem the person can fix or wait out and try again
 * from the pre-join screen, or the end of the road (`over`). docs/API.md lists the answers.
 */
export type JoinFailure = { problem: JoinProblem } | { over: CallOverReason }

export function joinFailure(error: ApiError, sentPassword: boolean): JoinFailure {
  if (error.isNetwork) return { problem: { kind: 'network' } }

  const passwordError = error.status === 422 ? error.fieldError('password') : undefined
  if (passwordError) {
    // Without a password the room asks for one; with one, the one given was wrong.
    return sentPassword ? { problem: { kind: 'password-wrong', message: passwordError } } : { problem: { kind: 'password-required' } }
  }

  if (error.status === 409) {
    if (error.code === 'room_ended') return { over: 'ended' }
    if (error.code === 'room_locked') return { problem: { kind: 'locked' } }
    if (error.code === 'room_full') return { problem: { kind: 'full' } }
  }
  // `join_denied`: the host refused or removed you. Without a code: you are not invited.
  if (error.status === 403) return { over: error.code === 'join_denied' ? 'denied' : 'forbidden' }
  if (error.status === 404) return { over: 'not-found' }
  if (error.status === 429) return { problem: { kind: 'rate-limited', retryAfter: error.retryAfter } }
  if (error.status === 503) return { problem: { kind: 'unavailable' } }
  return { problem: { kind: 'unknown', message: error.message } }
}

/** A room that could not even be opened (`GET /rooms/{room}`): `null` means "try again" (no network, a server error). */
export function loadFailure(error: ApiError): CallOverReason | null {
  if (error.status === 403) return 'forbidden'
  if (error.status === 404) return 'not-found'
  return null
}
