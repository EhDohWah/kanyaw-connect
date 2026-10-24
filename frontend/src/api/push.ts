import { isApiError } from '@/api/errors'
import { http } from '@/api/http'
import type { Single } from '@/types/api'
import type { BrowserSubscription, PushPublicKey, PushSubscriptionRecord } from '@/types/push'

export async function getPublicKey(): Promise<PushPublicKey> {
  const { data } = await http.get<Single<PushPublicKey>>('/push/public-key')
  return data.data
}

/** One per browser, oldest first (at most 20). */
export async function listSubscriptions(): Promise<PushSubscriptionRecord[]> {
  const { data } = await http.get<{ data: PushSubscriptionRecord[] }>('/push/subscriptions')
  return data.data
}

/**
 * Registers this browser (`201`), or refreshes it when it is already known (`200`, and it moves to you if someone else
 * registered it). Tied to this sign-in: signing out ends it. 30 an hour.
 */
export async function addSubscription(subscription: BrowserSubscription): Promise<PushSubscriptionRecord> {
  const { data } = await http.post<Single<PushSubscriptionRecord>>('/push/subscriptions', subscription)
  return data.data
}

/** Stops notifications for one browser. One that is already gone (`404`) counts as stopped. */
export async function removeSubscription(id: string): Promise<void> {
  try {
    await http.delete(`/push/subscriptions/${id}`)
  } catch (error) {
    if (!(isApiError(error) && error.status === 404)) throw error
  }
}
