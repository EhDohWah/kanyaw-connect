import { http } from '@/api/http'
import type { Single } from '@/types/api'
import type { PresenceEntry } from '@/types/chat'

/** The API accepts at most 100 ids per request (docs/API.md, 8.1). */
const MAX_IDS = 100

/**
 * Who is online, among you and the people you share a chat with (others are silently left out).
 * Sent as `ids[]=…&ids[]=…`, in groups of 100.
 */
export async function getPresence(ids: string[]): Promise<PresenceEntry[]> {
  const unique = [...new Set(ids)]
  const results: PresenceEntry[] = []

  for (let start = 0; start < unique.length; start += MAX_IDS) {
    const { data } = await http.get<Single<PresenceEntry[]>>('/users/presence', {
      params: { ids: unique.slice(start, start + MAX_IDS) },
      paramsSerializer: { indexes: false },
    })
    results.push(...data.data)
  }

  return results
}
