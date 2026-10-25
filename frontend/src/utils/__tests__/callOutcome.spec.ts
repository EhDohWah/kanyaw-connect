import { describe, expect, it } from 'vitest'

import { ApiError } from '@/api/errors'
import type { DirectCall } from '@/types/call'
import {
  CLOSE_AFTER_MS,
  IDLE,
  acceptFailure,
  closingOf,
  endingKey,
  endingOf,
  isLive,
  secondsLeft,
  startFailure,
  transition,
  type CallEvent,
  type CallMachine,
} from '@/utils/callOutcome'

const ME = 'me'
const PAW = 'paw'

function run(...events: CallEvent[]): CallMachine {
  return events.reduce(transition, IDLE)
}

function makeCall(over: Partial<DirectCall> = {}): DirectCall {
  return {
    id: 'call',
    chat_id: 'chat',
    room_id: 'room',
    kind: 'voice',
    status: 'ringing',
    end_reason: null,
    caller: { id: ME, name: 'Me', avatar_url: null, avatar_thumb_url: null },
    callee: { id: PAW, name: 'Naw Paw', avatar_url: null, avatar_thumb_url: null },
    created_at: '2026-03-14T09:15:00.000000Z',
    ring_expires_at: '2026-03-14T09:15:45.000000Z',
    answered_at: null,
    ended_at: null,
    duration_seconds: null,
    ...over,
  }
}

describe('an outgoing call', () => {
  it('starts, rings, and is live the moment it is answered when the media is already connected', () => {
    expect(run({ type: 'start' })).toMatchObject({ phase: 'starting', direction: 'outgoing' })
    expect(run({ type: 'start' }, { type: 'started' }).phase).toBe('ringing')
    // Connected while it rings: still ringing.
    expect(run({ type: 'start' }, { type: 'started' }, { type: 'media-ready' })).toMatchObject({ phase: 'ringing', mediaReady: true })
    expect(run({ type: 'start' }, { type: 'started' }, { type: 'media-ready' }, { type: 'answered' })).toMatchObject({ phase: 'active', answered: true })
  })

  it('goes through connecting when it is answered before the media is ready', () => {
    const answered = run({ type: 'start' }, { type: 'started' }, { type: 'answered' })
    expect(answered.phase).toBe('connecting')
    expect(transition(answered, { type: 'media-ready' }).phase).toBe('active')
  })

  it('ends as busy, or already in a call, when the start is refused', () => {
    expect(run({ type: 'start' }, { type: 'start-failed', ending: 'busy' })).toMatchObject({ phase: 'ended', ending: 'busy' })
    expect(run({ type: 'start' }, { type: 'start-failed', ending: 'already-in-call' }).ending).toBe('already-in-call')
  })

  it('ends as declined, or no answer, when the server says so', () => {
    const ringing = run({ type: 'start' }, { type: 'started' })
    expect(transition(ringing, { type: 'finished', ending: 'declined' })).toMatchObject({ phase: 'ended', ending: 'declined' })
    expect(transition(ringing, { type: 'finished', ending: 'no-answer' }).ending).toBe('no-answer')
  })

  it('ends as no answer when the ringing runs out here first', () => {
    expect(transition(run({ type: 'start' }, { type: 'started' }), { type: 'expired' }).ending).toBe('no-answer')
  })

  it('is cancelled by End while it rings (or is still starting), and hung up once it is answered', () => {
    expect(transition(run({ type: 'start' }), { type: 'hang-up' }).ending).toBe('cancelled')
    expect(transition(run({ type: 'start' }, { type: 'started' }), { type: 'hang-up' }).ending).toBe('cancelled')
    const live = run({ type: 'start' }, { type: 'started' }, { type: 'media-ready' }, { type: 'answered' })
    expect(transition(live, { type: 'hang-up' }).ending).toBe('hung-up')
  })

  it('ends when the other side hangs up, or the connection is lost', () => {
    const live = run({ type: 'start' }, { type: 'started' }, { type: 'media-ready' }, { type: 'answered' })
    expect(transition(live, { type: 'finished', ending: 'hung-up' }).ending).toBe('hung-up')
    expect(transition(live, { type: 'connection-lost' }).ending).toBe('connection-lost')
    expect(transition(run({ type: 'start' }, { type: 'started' }, { type: 'answered' }), { type: 'connection-lost' }).ending).toBe('connection-lost')
  })

  it('cannot lose a connection it never had: ringing without the media ignores a drop', () => {
    const ringing = run({ type: 'start' }, { type: 'started' })
    expect(transition(ringing, { type: 'connection-lost' })).toBe(ringing)
    expect(transition(transition(ringing, { type: 'media-ready' }), { type: 'connection-lost' }).ending).toBe('connection-lost')
  })

  it('fails when it cannot connect', () => {
    expect(transition(run({ type: 'start' }, { type: 'started' }), { type: 'failed' }).ending).toBe('failed')
  })

  it('cannot start a second call while one is on', () => {
    const ringing = run({ type: 'start' }, { type: 'started' })
    expect(transition(ringing, { type: 'start' })).toBe(ringing)
    expect(transition(ringing, { type: 'incoming' })).toBe(ringing)
  })
})

describe('an incoming call', () => {
  it('rings, is accepted, connects and goes live', () => {
    expect(run({ type: 'incoming' })).toMatchObject({ phase: 'incoming', direction: 'incoming' })
    expect(run({ type: 'incoming' }, { type: 'accept' }).phase).toBe('accepting')
    expect(run({ type: 'incoming' }, { type: 'accept' }, { type: 'accepted' })).toMatchObject({ phase: 'connecting', answered: true })
    expect(run({ type: 'incoming' }, { type: 'accept' }, { type: 'accepted' }, { type: 'media-ready' }).phase).toBe('active')
  })

  it('is declined by Decline', () => {
    expect(transition(run({ type: 'incoming' }), { type: 'hang-up' })).toMatchObject({ phase: 'ended', ending: 'declined' })
  })

  it('closes as answered on another device', () => {
    expect(transition(run({ type: 'incoming' }), { type: 'answered-elsewhere' }).ending).toBe('answered-elsewhere')
    expect(transition(run({ type: 'incoming' }, { type: 'accept' }), { type: 'answered-elsewhere' }).ending).toBe('answered-elsewhere')
  })

  it('closes as missed when the caller gives up or it rings out', () => {
    expect(transition(run({ type: 'incoming' }), { type: 'finished', ending: 'missed' }).ending).toBe('missed')
    expect(transition(run({ type: 'incoming' }), { type: 'expired' }).ending).toBe('missed')
  })

  it('ends as "this call has ended" when accepting came too late', () => {
    expect(transition(run({ type: 'incoming' }, { type: 'accept' }), { type: 'accept-failed', ending: 'gone' }).ending).toBe('gone')
  })

  it('can be hung up from this side, or from theirs, once live', () => {
    const live = run({ type: 'incoming' }, { type: 'accept' }, { type: 'accepted' }, { type: 'media-ready' })
    expect(transition(live, { type: 'hang-up' }).ending).toBe('hung-up')
    expect(transition(live, { type: 'finished', ending: 'hung-up' }).ending).toBe('hung-up')
  })

  it('is never "answered" by the other person appearing (that is for the caller)', () => {
    const incoming = run({ type: 'incoming' })
    expect(transition(incoming, { type: 'answered' })).toBe(incoming)
    const connecting = run({ type: 'incoming' }, { type: 'accept' }, { type: 'accepted' })
    expect(transition(connecting, { type: 'answered' })).toBe(connecting)
  })

  it('once answered here, news that it was answered (here) does not close it', () => {
    const connecting = run({ type: 'incoming' }, { type: 'accept' }, { type: 'accepted' })
    expect(transition(connecting, { type: 'answered-elsewhere' })).toBe(connecting)
    const live = transition(connecting, { type: 'media-ready' })
    expect(transition(live, { type: 'answered-elsewhere' })).toBe(live)
  })
})

describe('after a reload or a reconnect', () => {
  it('rings again for your own call that still rings, and joins an answered one without asking', () => {
    expect(run({ type: 'resume-ringing' })).toMatchObject({ phase: 'ringing', direction: 'outgoing' })
    expect(run({ type: 'resume-ongoing', direction: 'incoming' })).toMatchObject({ phase: 'connecting', direction: 'incoming', answered: true })
    expect(run({ type: 'resume-ongoing', direction: 'outgoing' }, { type: 'media-ready' }).phase).toBe('active')
  })
})

describe('events that do not apply', () => {
  it('change nothing', () => {
    expect(transition(IDLE, { type: 'answered' })).toBe(IDLE)
    expect(transition(IDLE, { type: 'expired' })).toBe(IDLE)
    expect(transition(IDLE, { type: 'hang-up' })).toBe(IDLE)
    const ended = run({ type: 'incoming' }, { type: 'hang-up' })
    expect(transition(ended, { type: 'finished', ending: 'missed' })).toBe(ended)
    expect(transition(ended, { type: 'connection-lost' })).toBe(ended)
    // An expiry once it is answered is old news.
    const live = run({ type: 'start' }, { type: 'started' }, { type: 'media-ready' }, { type: 'answered' })
    expect(transition(live, { type: 'expired' })).toBe(live)
  })

  it('reset returns to idle', () => {
    expect(transition(run({ type: 'incoming' }, { type: 'hang-up' }), { type: 'reset' })).toBe(IDLE)
    expect(isLive('idle')).toBe(false)
    expect(isLive('ended')).toBe(false)
    expect(isLive('ringing')).toBe(true)
  })
})

describe('endingOf: a finished call from your side', () => {
  it.each([
    [{ status: 'declined' }, ME, 'declined'],
    [{ status: 'declined' }, PAW, 'declined'],
    [{ status: 'missed', end_reason: 'cancelled' }, ME, 'cancelled'],
    [{ status: 'missed', end_reason: 'no_answer' }, ME, 'no-answer'],
    [{ status: 'missed', end_reason: 'cancelled' }, PAW, 'missed'],
    [{ status: 'missed', end_reason: 'no_answer' }, PAW, 'missed'],
    [{ status: 'ended', end_reason: 'hung_up' }, PAW, 'hung-up'],
    [{ status: 'ended', end_reason: 'connection_lost' }, ME, 'connection-lost'],
  ] as const)('%o seen by %s is %s', (over, viewer, expected) => {
    expect(endingOf(makeCall(over), viewer)).toBe(expected)
  })
})

describe('refusals', () => {
  it('maps a refused start', () => {
    expect(startFailure(new ApiError({ status: 409, code: 'callee_busy', message: '' }))).toBe('busy')
    expect(startFailure(new ApiError({ status: 409, code: 'already_in_call', message: '' }))).toBe('already-in-call')
    expect(startFailure(new ApiError({ status: 0, code: 'network', message: '' }))).toBe('failed')
    expect(startFailure(new ApiError({ status: 403, message: '' }))).toBe('failed')
  })

  it('maps a refused accept: answered elsewhere, ended, or a failure', () => {
    const conflict = new ApiError({ status: 409, code: 'call_not_ringing', message: '' })
    expect(acceptFailure(conflict, makeCall({ status: 'ongoing' }))).toBe('answered-elsewhere')
    expect(acceptFailure(conflict, makeCall({ status: 'missed' }))).toBe('gone')
    expect(acceptFailure(conflict, null)).toBe('gone')
    expect(acceptFailure(new ApiError({ status: 500, message: '' }), null)).toBe('failed')
  })
})

describe('the closing screen', () => {
  it('offers Call again (and stays) when they did not pick up', () => {
    for (const ending of ['declined', 'no-answer', 'busy', 'failed'] as const) {
      expect(closingOf(ending, 'outgoing')).toEqual({ callAgain: true, closeAfterMs: null })
    }
  })

  it('closes by itself after 2 seconds otherwise', () => {
    expect(CLOSE_AFTER_MS).toBe(2000)
    expect(closingOf('hung-up', 'outgoing')).toEqual({ callAgain: false, closeAfterMs: 2000 })
    expect(closingOf('missed', 'incoming').closeAfterMs).toBe(2000)
    expect(closingOf('declined', 'incoming').callAgain).toBe(false)
  })

  it.each([
    ['hung-up', 'outgoing', 'hungUp'],
    ['cancelled', 'outgoing', 'hungUp'],
    ['cancelled', 'incoming', 'missed'],
    ['declined', 'outgoing', 'declined'],
    ['declined', 'incoming', 'declinedByYou'],
    ['no-answer', 'outgoing', 'noAnswer'],
    ['busy', 'outgoing', 'busy'],
    ['already-in-call', 'outgoing', 'alreadyInCall'],
    ['answered-elsewhere', 'incoming', 'answeredElsewhere'],
    ['gone', 'incoming', 'gone'],
    ['connection-lost', 'incoming', 'connectionLost'],
    ['failed', 'outgoing', 'failed'],
    ['missed', 'incoming', 'missed'],
  ] as const)('says %s (%s) with directCall.ended.%s', (ending, direction, key) => {
    expect(endingKey(ending, direction)).toBe(key)
  })

  it('counts the seconds left to ring, never below zero', () => {
    const now = Date.parse('2026-03-14T09:15:30.000000Z')
    expect(secondsLeft(makeCall(), now)).toBe(15)
    expect(secondsLeft(makeCall(), now + 60_000)).toBe(0)
    expect(secondsLeft(makeCall({ ring_expires_at: 'nonsense' }), now)).toBe(0)
  })
})
