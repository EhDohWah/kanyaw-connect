import { createEcho } from '@/realtime/echo'
import { userChannelHandlers } from '@/realtime/handlers'
import { RealtimeLifecycle } from '@/realtime/lifecycle'
import { RealtimeManager } from '@/realtime/manager'
import { useRealtimeStore } from '@/stores/realtime'

/** The app's one connection. Tests create their own `RealtimeManager` with a fake Echo. */
export const realtime = new RealtimeManager(createEcho)

const resyncers = new Set<() => void>()

/**
 * Something to refetch when the socket comes back (after a drop, or when the app returns to the foreground): events
 * sent meanwhile are not replayed. Returns the function that stops.
 */
export function onResync(refetch: () => void): () => void {
  resyncers.add(refetch)
  return () => resyncers.delete(refetch)
}

function resyncAll(): void {
  for (const refetch of resyncers) refetch()
}

export const realtimeLifecycle = new RealtimeLifecycle({
  manager: realtime,
  userHandlers: userChannelHandlers,
  hooks: {
    status: (status) => useRealtimeStore.getState().setStatus(status),
    connected: resyncAll,
  },
  resync: resyncAll,
  // 8E sets this from the call store, and calls `realtimeLifecycle.callEnded()` when a call ends.
  isCallActive: () => false,
  paused: () => useRealtimeStore.getState().reset(),
})
