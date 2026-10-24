import { computed, ref, watch, type Ref } from 'vue'

import { useAuthStore } from '@/stores/auth'
import { useChatsStore } from '@/stores/chats'

/** How many groups are opened to learn who is in them, and how many at once. */
const MAX_GROUPS = 20
const PARALLEL = 4

/**
 * The people you can start a chat with or add to a group: the ones you already know from your chats. The API has no
 * "find a person" search, so the list is built from the other side of direct chats and from the members of your groups.
 */
export function usePeople(active: Ref<boolean>) {
  const auth = useAuthStore()
  const chats = useChatsStore()
  const loading = ref(false)

  const people = computed(() => chats.knownPeople(auth.user?.id ?? ''))

  /** Opens up to 20 groups whose members are not known yet (cached in the chat list for the rest of the session). */
  async function loadGroupMembers(): Promise<void> {
    const todo = chats.chats.filter((chat) => chat.type === 'group' && !chat.members).slice(0, MAX_GROUPS)
    if (todo.length === 0) return

    loading.value = true
    try {
      for (let start = 0; start < todo.length; start += PARALLEL) {
        await Promise.all(todo.slice(start, start + PARALLEL).map((chat) => chats.loadDetails(chat.id).catch(() => undefined)))
      }
    } finally {
      loading.value = false
    }
  }

  // Whenever the list is on screen, learn who is in the groups. It also runs when the chat list arrives *after* the
  // list was opened (a quick tap on a fresh page), and when a new group appears while it is open.
  watch(
    [active, () => chats.status, () => chats.chats.length],
    ([isActive, status]) => {
      if (isActive && status === 'ready') void loadGroupMembers()
    },
    { immediate: true },
  )

  return { people, loading }
}
