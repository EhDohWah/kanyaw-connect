import { computed, ref, watch, type Ref } from 'vue'

import { useAuthStore } from '@/stores/auth'
import { useChatsStore } from '@/stores/chats'
import type { PublicUser } from '@/types/user'

/** Members of this many of your most recently active groups are offered. */
export const GROUP_PEOPLE_GROUPS = 5

/**
 * People from your groups that you have no direct chat with yet: the "People from your groups" part of the sidebar.
 * The members of each group are asked for once and kept for the session (they live with the chat in the chat store).
 */
export function useGroupPeople(active: Ref<boolean>) {
  const auth = useAuthStore()
  const chats = useChatsStore()
  const loading = ref(false)
  const failed = ref(false)

  const groups = computed(() => chats.chats.filter((chat) => chat.type === 'group').slice(0, GROUP_PEOPLE_GROUPS))

  const people = computed<PublicUser[]>(() => {
    const me = auth.user?.id
    const hasDirect = new Set(chats.chats.flatMap((chat) => (chat.other_user ? [chat.other_user.id] : [])))
    const found = new Map<string, PublicUser>()

    for (const group of groups.value) {
      for (const member of group.members ?? []) {
        if (member.user_id !== me && !hasDirect.has(member.user_id)) found.set(member.user_id, member.user)
      }
    }
    return [...found.values()].sort((a, b) => a.name.localeCompare(b.name))
  })

  async function load(): Promise<void> {
    const todo = groups.value.filter((group) => !group.members)
    if (todo.length === 0) return

    loading.value = true
    failed.value = false
    try {
      // Five at most, so all at once.
      const results = await Promise.allSettled(todo.map((group) => chats.ensureMembers(group.id)))
      failed.value = results.some((result) => result.status === 'rejected')
    } finally {
      loading.value = false
    }
  }

  // When the sidebar is shown (also when the chat list arrives after it, or a new group takes a place in the top five).
  watch(
    [active, () => chats.status, () => groups.value.map((group) => group.id).join(',')],
    ([isActive, status]) => {
      if (isActive && status === 'ready') void load()
    },
    { immediate: true },
  )

  return { people, groups, loading, failed, retry: load }
}
