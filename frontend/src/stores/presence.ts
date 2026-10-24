import { defineStore } from 'pinia'
import { ref } from 'vue'

import { getPresence } from '@/api/presence'
import type { PresenceEntry } from '@/types/chat'

/** Who is online, among the people you share a chat with (`GET /users/presence`). */
export const usePresenceStore = defineStore('presence', () => {
  const byId = ref<Record<string, PresenceEntry>>({})

  function isOnline(userId: string | undefined): boolean {
    return userId !== undefined && byId.value[userId]?.status === 'online'
  }

  /** Looks the given people up and remembers the answer. A failed lookup keeps what was known: a dot may be stale, never wrong-blank. */
  async function refresh(ids: string[]): Promise<void> {
    if (ids.length === 0) return

    try {
      const entries = await getPresence(ids)
      const next = { ...byId.value }
      // People the server leaves out (no longer share a chat) are not online as far as we can tell.
      for (const id of ids) delete next[id]
      for (const entry of entries) next[entry.id] = entry
      byId.value = next
    } catch {
      // Offline or rate limited: try again at the next round.
    }
  }

  function reset(): void {
    byId.value = {}
  }

  return { byId, isOnline, refresh, reset }
})
