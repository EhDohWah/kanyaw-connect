import type { ApiError } from '@/api/errors'
import type { DirectCall } from '@/types/call'

/**
 * The rules of a one-to-one call, as pure functions (the `directCall` store does the talking to the API and LiveKit).
 *
 * Outgoing: `starting` → `ringing` → `connecting` → `active` → `ended`.
 * Incoming: `incoming` → `accepting` → `connecting` → `active` → `ended`.
 *
 * The caller connects to LiveKit while it rings, so an answer can go from `ringing` straight to `active`.
 */
export type DirectCallPhase = 'idle' | 'starting' | 'ringing' | 'incoming' | 'accepting' | 'connecting' | 'active' | 'ended'

/** Why it ended: decides the closing screen. */
export type CallEnding =
  /** Someone pressed End once it was answered (either side). */
  | 'hung-up'
  /** The callee said no. */
  | 'declined'
  /** Nobody answered in time (caller's side). */
  | 'no-answer'
  /** The caller gave up before it was answered (on this device: "Call ended"; elsewhere: "Call cancelled"). */
  | 'cancelled'
  /** You did not answer (callee's side). */
  | 'missed'
  /** They are in another call. */
  | 'busy'
  /** You are in a call already (perhaps on another device). */
  | 'already-in-call'
  /** You answered on another device. */
  | 'answered-elsewhere'
  /** Answering came too late: "This call has ended". */
  | 'gone'
  | 'connection-lost'
  /** It could not start or connect at all. */
  | 'failed'

export type CallDirection = 'outgoing' | 'incoming'

export interface CallMachine {
  phase: DirectCallPhase
  direction: CallDirection | null
  ending: CallEnding | null
  /** LiveKit is connected (for the caller this can happen while it still rings). */
  mediaReady: boolean
  /** The other side has answered (`call.accepted`, or they appeared in LiveKit). */
  answered: boolean
}

export type CallEvent =
  | { type: 'start' }
  | { type: 'started' }
  | { type: 'start-failed'; ending: CallEnding }
  | { type: 'incoming' }
  | { type: 'accept' }
  | { type: 'accepted' }
  | { type: 'accept-failed'; ending: CallEnding }
  /** The other person answered (caller), or appeared in LiveKit. */
  | { type: 'answered' }
  | { type: 'media-ready' }
  /** Answered by this person on another device (callee). */
  | { type: 'answered-elsewhere' }
  /** The server says the call reached its final state. */
  | { type: 'finished'; ending: CallEnding }
  /** `ring_expires_at` passed here before the server said so. */
  | { type: 'expired' }
  /** End / Decline / Cancel pressed here. */
  | { type: 'hang-up' }
  | { type: 'connection-lost' }
  | { type: 'failed' }
  /** After a reload or a reconnect: your own call is still ringing on their side. */
  | { type: 'resume-ringing' }
  /** After a reload or a reconnect: the call was answered; join it again without asking. */
  | { type: 'resume-ongoing'; direction: CallDirection }
  | { type: 'reset' }

export const IDLE: CallMachine = { phase: 'idle', direction: null, ending: null, mediaReady: false, answered: false }

const RINGING_PHASES: readonly DirectCallPhase[] = ['starting', 'ringing', 'incoming', 'accepting']
const LIVE_PHASES: readonly DirectCallPhase[] = ['connecting', 'active']

/** The call is on screen and not over yet. */
export function isLive(phase: DirectCallPhase): boolean {
  return phase !== 'idle' && phase !== 'ended'
}

function end(state: CallMachine, ending: CallEnding): CallMachine {
  return { ...state, phase: 'ended', ending }
}

/** What an event does to the call. Anything that does not apply to the current phase changes nothing. */
export function transition(state: CallMachine, event: CallEvent): CallMachine {
  const { phase } = state

  switch (event.type) {
    case 'reset':
      return IDLE

    case 'start':
      return isLive(phase) ? state : { ...IDLE, phase: 'starting', direction: 'outgoing' }

    case 'started':
      return phase === 'starting' ? { ...state, phase: 'ringing' } : state

    case 'start-failed':
      return phase === 'starting' ? end(state, event.ending) : state

    case 'incoming':
      return isLive(phase) ? state : { ...IDLE, phase: 'incoming', direction: 'incoming' }

    case 'resume-ringing':
      return isLive(phase) ? state : { ...IDLE, phase: 'ringing', direction: 'outgoing' }

    case 'resume-ongoing':
      return isLive(phase) ? state : { ...IDLE, phase: 'connecting', direction: event.direction, answered: true }

    case 'accept':
      return phase === 'incoming' ? { ...state, phase: 'accepting' } : state

    case 'accepted':
      return phase === 'accepting' ? { ...state, phase: state.mediaReady ? 'active' : 'connecting', answered: true } : state

    case 'accept-failed':
      return phase === 'accepting' ? end(state, event.ending) : state

    case 'answered':
      if (state.direction !== 'outgoing' || (phase !== 'ringing' && phase !== 'connecting')) return state
      return { ...state, answered: true, phase: state.mediaReady ? 'active' : 'connecting' }

    case 'media-ready':
      if (!isLive(phase)) return state
      // Connected while it rings (caller): stay ringing until they answer.
      return { ...state, mediaReady: true, phase: phase === 'connecting' ? 'active' : phase }

    case 'answered-elsewhere':
      return phase === 'incoming' || phase === 'accepting' ? end(state, 'answered-elsewhere') : state

    case 'finished':
      return isLive(phase) ? end(state, event.ending) : state

    case 'expired':
      if (phase === 'ringing') return end(state, 'no-answer')
      if (phase === 'incoming') return end(state, 'missed')
      return state

    case 'hang-up':
      if (phase === 'starting' || phase === 'ringing') return end(state, 'cancelled')
      if (phase === 'incoming') return end(state, 'declined')
      if (phase === 'accepting' || LIVE_PHASES.includes(phase)) return end(state, 'hung-up')
      return state

    case 'connection-lost':
      return LIVE_PHASES.includes(phase) || (phase === 'ringing' && state.mediaReady) ? end(state, 'connection-lost') : state

    case 'failed':
      return isLive(phase) ? end(state, 'failed') : state
  }
}

/** Still ringing on one side or the other (no media to show yet). */
export function isRinging(phase: DirectCallPhase): boolean {
  return RINGING_PHASES.includes(phase)
}

/** How a call the server says is over ended, from your side of it. */
export function endingOf(call: DirectCall, myId: string): CallEnding {
  const caller = call.caller?.id === myId
  if (call.status === 'declined') return 'declined'
  if (call.status === 'missed') {
    if (!caller) return 'missed'
    return call.end_reason === 'cancelled' ? 'cancelled' : 'no-answer'
  }
  return call.end_reason === 'connection_lost' ? 'connection-lost' : 'hung-up'
}

/** A refused `POST /chats/{chat}/calls`. */
export function startFailure(error: ApiError): CallEnding {
  if (error.status === 409 && error.code === 'callee_busy') return 'busy'
  if (error.status === 409 && error.code === 'already_in_call') return 'already-in-call'
  return 'failed'
}

/** A refused `POST /calls/{id}/accept`: too late (it ended, or you answered elsewhere), or it did not work. */
export function acceptFailure(error: ApiError, call: DirectCall | null): CallEnding {
  if (error.status === 409 || error.status === 404) return call?.status === 'ongoing' ? 'answered-elsewhere' : 'gone'
  return 'failed'
}

/** What the closing screen offers, and how long it stays by itself (`null`: until the person closes it). */
export function closingOf(ending: CallEnding, direction: CallDirection | null): { callAgain: boolean; closeAfterMs: number | null } {
  if (direction === 'outgoing' && (ending === 'declined' || ending === 'no-answer' || ending === 'busy' || ending === 'failed')) {
    return { callAgain: true, closeAfterMs: null }
  }
  return { callAgain: false, closeAfterMs: CLOSE_AFTER_MS }
}

/** "Call ended · 3:12" and the other short notes stay this long. */
export const CLOSE_AFTER_MS = 2000

/** Seconds left to ring (never below zero). */
export function secondsLeft(call: Pick<DirectCall, 'ring_expires_at'>, now: number): number {
  const at = Date.parse(call.ring_expires_at)
  return Number.isFinite(at) ? Math.max(0, Math.ceil((at - now) / 1000)) : 0
}

/** The closing screen's sentence (a key under `directCall.ended`), from your side of the call. */
export function endingKey(ending: CallEnding, direction: CallDirection | null): string {
  switch (ending) {
    case 'hung-up':
      return 'hungUp'
    case 'declined':
      return direction === 'outgoing' ? 'declined' : 'declinedByYou'
    case 'no-answer':
      return 'noAnswer'
    case 'cancelled':
      // Your own End while it rang: plainly "Call ended".
      return direction === 'outgoing' ? 'hungUp' : 'missed'
    case 'missed':
      return 'missed'
    case 'busy':
      return 'busy'
    case 'already-in-call':
      return 'alreadyInCall'
    case 'answered-elsewhere':
      return 'answeredElsewhere'
    case 'gone':
      return 'gone'
    case 'connection-lost':
      return 'connectionLost'
    case 'failed':
      return 'failed'
  }
}
