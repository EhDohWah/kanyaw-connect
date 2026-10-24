import { ref, type Ref } from 'vue'

const now = ref(Date.now())
let started = false

/**
 * The current time as a shared, reactive value, refreshed every 30 seconds, so "Today" and "Yesterday" labels
 * move on at midnight without every row running its own timer.
 */
export function useNow(): Ref<number> {
  if (!started && typeof window !== 'undefined') {
    started = true
    setInterval(() => {
      now.value = Date.now()
    }, 30_000)
  }
  return now
}
