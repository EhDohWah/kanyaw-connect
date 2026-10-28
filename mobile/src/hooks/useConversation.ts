// Ported from frontend/src/composables/useConversation.ts. "Visible" on the phone means the app is in the foreground
// (AppState), where the web used the page's visibility.
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'

import { markRead } from '@/api/chats'
import { isApiError } from '@/api/errors'
import { realtime } from '@/realtime'
import { chatChannelHandlers } from '@/realtime/handlers'
import { useAuthStore } from '@/stores/auth'
import { useChatsStore } from '@/stores/chats'
import { useMessagesStore } from '@/stores/messages'
import { hasUnreadFromOthers, newestConfirmed } from '@/utils/messageMerge'

export type ConversationState = 'loading' | 'ready' | 'missing' | 'error'

/** A short pause before reporting "read", so a burst of arriving messages is one request. */
export const MARK_READ_DELAY_MS = 300

/**
 * Everything one open conversation needs: find the chat, load its history, listen to its channels while it is on
 * screen, and tell the server how far the person has read.
 */
export function useConversation(chatId: string, options: { onGone?: () => void } = {}) {
  const chat = useChatsStore((state) => state.byId[chatId])
  const timeline = useMessagesStore((state) => state.timelines[chatId])
  const meId = useAuthStore((state) => state.user?.id ?? '')

  const [state, setState] = useState<ConversationState>('loading')
  const [atBottom, setAtBottom] = useState(true)
  const [appActive, setAppActive] = useState(AppState.currentState === 'active')
  const [openCount, setOpenCount] = useState(0)

  const markedUpTo = useRef<string | null>(null)
  /** A "read" report that is waiting out the short pause: leaving the chat sends it at once instead of losing it. */
  const waitingReport = useRef<string | null>(null)
  const hadChat = useRef(false)
  const onGone = useRef(options.onGone)
  useEffect(() => {
    onGone.current = options.onGone
  })

  // Opening another chat (or reloading) starts from "loading" at the bottom. Adjusted while rendering, React's pattern
  // for state that follows a prop.
  const openKey = `${chatId}:${openCount}`
  const [openedKey, setOpenedKey] = useState(openKey)
  if (openedKey !== openKey) {
    setOpenedKey(openKey)
    setState('loading')
    setAtBottom(true)
  }

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => setAppActive(next === 'active'))
    return () => subscription.remove()
  }, [])

  /** Tells the server how far the person has read, if they are looking at the end of the chat and there is news. */
  const reportRead = useCallback(
    async (id: string, looking: boolean): Promise<void> => {
      const current = useChatsStore.getState().get(id)
      const loaded = useMessagesStore.getState().timeline(id)?.messages ?? []
      const newest = newestConfirmed(loaded)
      if (!current || !newest || !looking) return
      // The server counts unread messages itself: report whenever someone else's message sits after the read position.
      if (
        newest.id === markedUpTo.current ||
        !hasUnreadFromOthers(loaded, current.my_membership.last_read_message_id, meId)
      )
        return

      markedUpTo.current = newest.id
      try {
        useChatsStore.getState().applyRead(await markRead(current.id, newest.id))
      } catch {
        markedUpTo.current = null // try again on the next change
      }
    },
    [meId],
  )

  // Opening: find the chat, listen to it, load (or quietly repair) its history.
  useEffect(() => {
    let cancelled = false
    let stopWatching: (() => void) | null = null
    markedUpTo.current = null

    void (async () => {
      const chats = useChatsStore.getState()
      const messages = useMessagesStore.getState()
      try {
        await chats.ensure(chatId)
      } catch (problem) {
        if (!cancelled)
          setState(isApiError(problem) && (problem.status === 404 || problem.status === 403) ? 'missing' : 'error')
        return
      }
      if (cancelled) return

      setState('ready')
      if (chats.get(chatId)?.is_encrypted) return // nothing to load or listen to: a notice replaces the conversation

      stopWatching = realtime.watchChat(chatId, chatChannelHandlers(chatId))
      // The list has no member names; groups need them (who is typing, replies, group info).
      if (!chats.get(chatId)?.members) void chats.loadDetails(chatId).catch(() => undefined)

      // Already seen before: show it at once and repair quietly (edits and deletions are not sent for chats not open).
      if (messages.timeline(chatId)?.status === 'ready') void messages.resync(chatId)
      else await messages.loadInitial(chatId)
    })()

    return () => {
      cancelled = true
      if (waitingReport.current === chatId) {
        waitingReport.current = null
        void reportRead(chatId, true)
      }
      stopWatching?.()
      if (useChatsStore.getState().viewingId === chatId) useChatsStore.getState().setViewing(null)
    }
    // reportRead only changes with the signed-in person, who does not change while a chat is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, openCount])

  const looking = state === 'ready' && appActive && atBottom && !chat?.is_encrypted

  // The chat counts as "on screen" (its new messages are not unread) only while the app is open on its newest messages.
  useEffect(() => {
    const chats = useChatsStore.getState()
    if (looking) chats.setViewing(chatId)
    else if (chats.viewingId === chatId) chats.setViewing(null)
  }, [looking, chatId])

  // New messages, and what other devices read, may change what has to be reported.
  const newestId = newestConfirmed(timeline?.messages ?? [])?.id
  const unread = chat?.unread_count
  useEffect(() => {
    if (!looking) return
    waitingReport.current = chatId
    const timer = setTimeout(() => {
      waitingReport.current = null
      void reportRead(chatId, true)
    }, MARK_READ_DELAY_MS)
    return () => clearTimeout(timer)
  }, [looking, newestId, unread, chatId, reportRead])

  // The chat left the list while it was open: removed from the group, or it was deleted.
  useEffect(() => {
    if (chat) hadChat.current = true
    else if (hadChat.current && state === 'ready') {
      hadChat.current = false
      setState('missing')
      onGone.current?.()
    }
  }, [chat, state])

  const reload = useCallback(() => setOpenCount((count) => count + 1), [])

  return { chat, timeline, state, atBottom, setAtBottom, reload, meId }
}
