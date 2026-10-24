import { onBeforeUnmount, watch, type Ref } from 'vue'

import { useRoomsStore } from '@/stores/rooms'

/** How often the list is asked again while it is on screen and the page is visible. */
export const UPCOMING_REFRESH_MS = 5 * 60 * 1000
/** Coming back to the page after at least this long asks at once. */
const STALE_MS = 60 * 1000

/**
 * Keeps the "Upcoming meetings" list fresh while it is shown: when it first appears, every five minutes, and when the
 * person comes back to the page after a while. (A meeting announced in one of your chats refreshes it too: see the
 * real-time handlers.)
 */
export function useUpcomingMeetings(active: Ref<boolean>): void {
  const rooms = useRoomsStore()
  let timer: ReturnType<typeof setInterval> | undefined
  let lastAsked = 0

  function ask(): void {
    lastAsked = Date.now()
    void rooms.fetchUpcoming()
  }

  const onVisible = (): void => {
    if (document.visibilityState === 'visible' && Date.now() - lastAsked >= STALE_MS) ask()
  }

  function stop(): void {
    if (timer !== undefined) clearInterval(timer)
    timer = undefined
    document.removeEventListener('visibilitychange', onVisible)
  }

  watch(
    active,
    (isActive) => {
      stop()
      if (!isActive) return
      ask()
      timer = setInterval(() => {
        if (document.visibilityState === 'visible') ask()
      }, UPCOMING_REFRESH_MS)
      document.addEventListener('visibilitychange', onVisible)
    },
    { immediate: true },
  )

  onBeforeUnmount(stop)
}
