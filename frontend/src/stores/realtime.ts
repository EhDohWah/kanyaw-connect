import type { ConnectionStatus } from 'laravel-echo'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

/** What the rest of the app knows about the WebSocket: used for the "You are offline" banner. */
export const useRealtimeStore = defineStore('realtime', () => {
  const status = ref<ConnectionStatus>('connecting')
  /** True once the socket has been up at least once in this session: a later "connecting" is a reconnect. */
  const everConnected = ref(false)
  const browserOnline = ref(typeof navigator === 'undefined' ? true : navigator.onLine)

  const connected = computed(() => status.value === 'connected')

  /**
   * Show the banner when the browser says it has no network, or the WebSocket is down. The very first
   * "connecting" is not a problem yet: it only counts as one if it fails.
   */
  const showOffline = computed(
    () =>
      !browserOnline.value ||
      status.value === 'disconnected' ||
      status.value === 'failed' ||
      status.value === 'reconnecting' ||
      (status.value === 'connecting' && everConnected.value),
  )

  function setStatus(next: ConnectionStatus): void {
    status.value = next
    if (next === 'connected') everConnected.value = true
  }

  function setBrowserOnline(online: boolean): void {
    browserOnline.value = online
  }

  function reset(): void {
    status.value = 'connecting'
    everConnected.value = false
  }

  return { status, everConnected, browserOnline, connected, showOffline, setStatus, setBrowserOnline, reset }
})
