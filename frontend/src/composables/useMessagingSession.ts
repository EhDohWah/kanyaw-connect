import { onBeforeUnmount, onMounted, watch } from 'vue'

import { realtime } from '@/realtime'
import { userChannelHandlers } from '@/realtime/handlers'
import { useAuthStore } from '@/stores/auth'
import { useChatsStore } from '@/stores/chats'
import { useDraftsStore } from '@/stores/drafts'
import { useFeedStore } from '@/stores/feed'
import { useMessagesStore } from '@/stores/messages'
import { usePresenceStore } from '@/stores/presence'
import { useRealtimeStore } from '@/stores/realtime'
import { useRoomsStore } from '@/stores/rooms'
import { useTypingStore } from '@/stores/typing'
import { useUiStore } from '@/stores/ui'

/** How often "who is online" is asked again while the page is visible (a heartbeat lasts 90 seconds on the server). */
export const PRESENCE_REFRESH_MS = 60_000
/** New people often arrive together (several groups opened at once): one lookup for all of them, not one each. */
export const PRESENCE_DEBOUNCE_MS = 200

/**
 * Everything messaging needs while the signed-in app is on screen: the WebSocket, the chat list, the online dots, and
 * the repair work after a drop. Used once, by the app shell. Signing out (the shell going away) closes the connection
 * and forgets every cached chat, so the next person to sign in on this browser starts clean.
 */
export function useMessagingSession(): void {
  const auth = useAuthStore()
  const chats = useChatsStore()
  const messages = useMessagesStore()
  const presence = usePresenceStore()
  const status = useRealtimeStore()
  const typing = useTypingStore()
  const drafts = useDraftsStore()
  const feed = useFeedStore()
  const rooms = useRoomsStore()
  const ui = useUiStore()

  let startedFor: string | null = null
  let presenceTimer: ReturnType<typeof setInterval> | undefined
  let presenceSoon: ReturnType<typeof setTimeout> | undefined

  /** Everyone we can name from our chats: the other person of each direct chat, and members of groups opened so far. */
  const knownPeopleIds = (): string[] => chats.knownPeople(auth.user?.id ?? '').map((person) => person.id)

  const refreshPresence = (): Promise<void> => presence.refresh(knownPeopleIds())

  /** Events may have been missed while the socket was down (or not yet up): ask the API for the current state. */
  async function resync(): Promise<void> {
    await Promise.all([chats.fetchChats(), ...realtime.watchedChatIds().map((id) => messages.resync(id))])
    void refreshPresence()
  }

  function start(): void {
    const token = auth.token
    const user = auth.user
    if (!token || !user || startedFor === user.id) return
    startedFor = user.id

    realtime.connect(token, user.id, userChannelHandlers(), {
      status: (next) => status.setStatus(next),
      connected: () => void resync(),
    })

    void chats.fetchChats()
    presenceTimer = setInterval(() => {
      if (document.visibilityState === 'visible') void refreshPresence()
    }, PRESENCE_REFRESH_MS)
  }

  function stop(): void {
    if (presenceTimer !== undefined) clearInterval(presenceTimer)
    presenceTimer = undefined
    clearTimeout(presenceSoon)
    presenceSoon = undefined
    startedFor = null

    realtime.disconnect()
    chats.reset()
    messages.reset()
    presence.reset()
    typing.reset()
    drafts.reset()
    feed.reset()
    rooms.reset()
    status.reset()
    ui.resetForSignOut()
  }

  const onOnline = (): void => {
    status.setBrowserOnline(true)
    void resync()
  }
  const onOffline = (): void => status.setBrowserOnline(false)

  onMounted(() => {
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    start()
  })

  onBeforeUnmount(() => {
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
    stop()
  })

  // The profile can finish loading after the shell appeared (when the first attempt had no network).
  watch(
    () => auth.user?.id,
    () => start(),
  )

  // A new person in a chat list means a new dot to look up, whether from a direct chat or a group that was just opened.
  watch(
    () => knownPeopleIds().join(','),
    () => {
      clearTimeout(presenceSoon)
      presenceSoon = setTimeout(() => void refreshPresence(), PRESENCE_DEBOUNCE_MS)
    },
  )
}

