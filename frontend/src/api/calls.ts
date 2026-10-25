import { toApiError } from '@/api/errors'
import { http } from '@/api/http'
import type { Single } from '@/types/api'
import type { DirectCall, DirectCallKind } from '@/types/call'

/* One-to-one calls (docs/API.md, 3.9). Every function throws what axios throws; `toApiError` makes sense of it. */

/** Rings the other person of a direct chat. `409 already_in_call` / `callee_busy` when someone is busy. */
export async function startCall(chatId: string, kind: DirectCallKind): Promise<DirectCall> {
  const { data } = await http.post<Single<DirectCall>>(`/chats/${chatId}/calls`, { kind })
  return data.data
}

/** Your call that is ringing or going on, or `null`. Asked on start and after every reconnect. */
export async function currentCall(): Promise<DirectCall | null> {
  const { data } = await http.get<{ data: DirectCall | null }>('/calls/current')
  return data.data
}

export async function getCall(callId: string): Promise<DirectCall> {
  const { data } = await http.get<Single<DirectCall>>(`/calls/${callId}`)
  return data.data
}

async function act(callId: string, action: 'accept' | 'decline' | 'cancel' | 'end'): Promise<DirectCall> {
  const { data } = await http.post<Single<DirectCall>>(`/calls/${callId}/${action}`)
  return data.data
}

/** The callee answers. `409 call_not_ringing` (with the call) when it is too late. */
export const acceptCall = (callId: string): Promise<DirectCall> => act(callId, 'accept')
/** The callee says no. */
export const declineCall = (callId: string): Promise<DirectCall> => act(callId, 'decline')
/** The caller gives up before it is answered. */
export const cancelCall = (callId: string): Promise<DirectCall> => act(callId, 'cancel')
/** Either person hangs up an answered call. `409 call_not_ongoing` (with the call) while it still rings. */
export const endCall = (callId: string): Promise<DirectCall> => act(callId, 'end')

/** A `409 call_not_ringing` / `call_not_ongoing` answer carries the call as it is now: that call, else `null`. */
export function callInConflict(error: unknown): DirectCall | null {
  const body = toApiError(error).body
  if (body === null || typeof body !== 'object') return null
  const call = (body as { call?: unknown }).call
  return call !== null && typeof call === 'object' && typeof (call as DirectCall).id === 'string' ? (call as DirectCall) : null
}
