import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'

import { isApiError } from '@/api/errors'
import { markRead } from '@/api/chats'
import { realtime } from '@/realtime'
import { chatChannelHandlers } from '@/realtime/handlers'
import { useAuthStore } from '@/stores/auth'
import { useChatsStore } from '@/stores/chats'
import { useMessagesStore } from '@/stores/messages'
import { hasUnreadFromOthers, newestConfirmed } from '@/utils/messageMerge'

export type ConversationState = 'loading' | 'ready' | 'missing' | 'error'

/** A short pause before reporting "read", so a burst of arriving messages is one request. */
const MARK_READ_DELAY_MS = 300

/**
 * Everything one open conversation needs, shared by the drawer and the full page: find the chat, load its history,
 * listen to its channels while it is on screen, and tell the server how far the person has read.
 */
export function useConversation(chatId: Ref<string>, options: { onGone?: () => void } = {}) {
  const auth = useAuthStore()
  const chats = useChatsStore()
  const messages = useMessagesStore()

  const state = ref<ConversationState>('loading')
  const atBottom = ref(true)
  const pageVisible = ref(typeof document === 'undefined' ? true : document.visibilityState === 'visible')

  const chat = computed(() => chats.get(chatId.value))
  const timeline = computed(() => messages.timeline(chatId.value))

  let stopWatching: (() => void) | null = null
  let markTimer: ReturnType<typeof setTimeout> | undefined
  let markTimerChat: string | null = null
  let markedUpTo: string | null = null
  let openToken = 0

  /** The chat counts as "on screen" (so new messages are not unread) only while the page is visible and scrolled to the end. */
  function syncViewing(): void {
    const viewing = state.value === 'ready' && pageVisible.value && atBottom.value && !chat.value?.is_encrypted
    if (viewing) chats.viewingId = chatId.value
    else if (chats.viewingId === chatId.value) chats.viewingId = null
  }

  /** Tells the server how far the person has read, if they are looking at the end of the chat and there is news. */
  async function reportRead(id: string): Promise<void> {
    markTimer = undefined
    // For the chat the report was armed for, even if the screen has moved on to another one since.
    const current = chats.get(id)
    const loaded = messages.timeline(id)?.messages ?? []
    const newest = newestConfirmed(loaded)
    if (!current || !newest || !pageVisible.value || !atBottom.value) return
    // The server counts unread messages on its own, whatever our screen shows: report whenever someone else's
    // message sits after the read position (the local badge is not a reliable sign, it is held at 0 while viewing).
    if (newest.id === markedUpTo || !hasUnreadFromOthers(loaded, current.my_membership.last_read_message_id, auth.user?.id ?? '')) return

    markedUpTo = newest.id
    try {
      chats.applyRead(await markRead(current.id, newest.id))
    } catch {
      markedUpTo = null // try again on the next change
    }
  }

  function markReadSoon(): void {
    clearTimeout(markTimer)
    const id = chatId.value
    markTimerChat = id
    markTimer = setTimeout(() => void reportRead(id), MARK_READ_DELAY_MS)
  }

  function stop(): void {
    openToken += 1
    // Leaving within the short pause must not lose the report: send it now.
    if (markTimer !== undefined && markTimerChat) {
      clearTimeout(markTimer)
      void reportRead(markTimerChat)
    }
    stopWatching?.()
    stopWatching = null
    if (chats.viewingId === chatId.value) chats.viewingId = null
    markedUpTo = null
  }

  async function open(id: string): Promise<void> {
    const token = ++openToken
    state.value = 'loading'
    atBottom.value = true

    try {
      await chats.ensure(id)
    } catch (problem) {
      if (token !== openToken) return
      state.value = isApiError(problem) && (problem.status === 404 || problem.status === 403) ? 'missing' : 'error'
      return
    }
    if (token !== openToken) return

    state.value = 'ready'
    if (chats.get(id)?.is_encrypted) return // nothing to load or listen to: the notice replaces the conversation

    stopWatching = realtime.watchChat(id, chatChannelHandlers(id))
    // The list has no member names; groups need them (who is typing, who started a meeting, group info).
    if (!chats.get(id)?.members) void chats.loadDetails(id).catch(() => undefined)

    // Already seen before: show it at once and repair quietly (edits and deletions are not sent for chats not open).
    if (messages.timeline(id)?.status === 'ready') void messages.resync(id)
    else await messages.loadInitial(id)
    if (token !== openToken) return

    syncViewing()
    markReadSoon()
  }

  function reload(): void {
    stop()
    void open(chatId.value)
  }

  watch(
    chatId,
    (id, previous) => {
      if (previous !== undefined) stop()
      void open(id)
    },
    { immediate: true },
  )

  // The chat left the list while it was open: removed from the group, or it was deleted.
  watch(chat, (now, before) => {
    if (before && !now && state.value === 'ready') {
      state.value = 'missing'
      options.onGone?.()
    }
  })

  watch([atBottom, pageVisible], () => {
    syncViewing()
    markReadSoon()
  })

  // New messages, and what other devices read, may change what has to be reported.
  watch(
    () => [newestConfirmed(timeline.value?.messages ?? [])?.id, chat.value?.unread_count],
    () => markReadSoon(),
  )

  const onVisibility = (): void => {
    pageVisible.value = document.visibilityState === 'visible'
  }
  document.addEventListener('visibilitychange', onVisibility)

  onBeforeUnmount(() => {
    document.removeEventListener('visibilitychange', onVisibility)
    stop()
  })

  return { chat, state, timeline, atBottom, reload, me: computed(() => auth.user) }
}
