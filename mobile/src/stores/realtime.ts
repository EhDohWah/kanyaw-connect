// Ported from frontend/src/stores/realtime.ts. The phone's network state comes from NetInfo instead of
// `navigator.onLine`, and the app going to the background resets it (the socket is closed on purpose then).
import type { ConnectionStatus } from 'laravel-echo'
import { create } from 'zustand'

interface RealtimeState {
  status: ConnectionStatus
  /** True once the socket has been up in this connection: a later "connecting" is a reconnect. */
  everConnected: boolean
  /** False when NetInfo says the phone has no network (or no route to the internet). */
  networkOnline: boolean

  setStatus(status: ConnectionStatus): void
  setNetworkOnline(online: boolean): void
  reset(): void
}

export const useRealtimeStore = create<RealtimeState>()((set) => ({
  status: 'connecting',
  everConnected: false,
  networkOnline: true,

  setStatus(status) {
    set((state) => ({ status, everConnected: state.everConnected || status === 'connected' }))
  },
  setNetworkOnline(networkOnline) {
    set({ networkOnline })
  },
  reset() {
    set({ status: 'connecting', everConnected: false })
  },
}))

/**
 * Show "You are offline" when the phone has no network, or the WebSocket is down. The very first "connecting" is not a
 * problem yet: it only counts once it fails.
 */
export function isOfflineShown(state: Pick<RealtimeState, 'status' | 'everConnected' | 'networkOnline'>): boolean {
  return (
    !state.networkOnline ||
    state.status === 'disconnected' ||
    state.status === 'failed' ||
    state.status === 'reconnecting' ||
    (state.status === 'connecting' && state.everConnected)
  )
}
