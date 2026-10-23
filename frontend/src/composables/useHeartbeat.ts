import { onBeforeUnmount, onMounted } from 'vue'

import { sendHeartbeat } from '@/api/me'
import { createHeartbeat } from '@/composables/heartbeat'

/** Marks the signed-in user online while this component is mounted (the app shell) and the page is visible. */
export function useHeartbeat(): void {
  const heartbeat = createHeartbeat({ send: () => sendHeartbeat() })

  onMounted(() => heartbeat.start())
  onBeforeUnmount(() => heartbeat.stop())
}
