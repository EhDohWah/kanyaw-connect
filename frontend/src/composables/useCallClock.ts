import { onBeforeUnmount, ref, watch, type Ref } from 'vue'

import { formatDuration } from '@/utils/dates'

/** "3:12" since a call was answered, ticking every second (`null` until then). */
export function useCallClock(since: Ref<string | null | undefined>): Ref<string | null> {
  const text = ref<string | null>(null)
  let timer: ReturnType<typeof setInterval> | undefined

  const tick = (): void => {
    const start = since.value ? Date.parse(since.value) : Number.NaN
    text.value = Number.isFinite(start) ? formatDuration(Date.now() - start) : null
  }

  watch(
    since,
    () => {
      clearInterval(timer)
      tick()
      if (since.value) timer = setInterval(tick, 1000)
    },
    { immediate: true },
  )
  onBeforeUnmount(() => clearInterval(timer))

  return text
}
