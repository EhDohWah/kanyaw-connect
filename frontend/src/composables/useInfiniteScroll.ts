import { onBeforeUnmount, watch, type Ref, type WatchSource } from 'vue'

/** Whether this browser can tell us when an element comes close to the screen. When it cannot, the page offers a button. */
export const canObserve = (): boolean => typeof window !== 'undefined' && 'IntersectionObserver' in window

/**
 * Calls `onReach` whenever the marker element is within `rootMargin` of the screen. It looks again whenever the marker
 * element is replaced, and after every change in `rearm` (for a marker that stays in the page while more content arrives:
 * one that is still on screen does not announce itself a second time).
 */
export function useInfiniteScroll(
  marker: Ref<HTMLElement | null>,
  onReach: () => void,
  rearm: WatchSource[] = [],
  rootMargin = '600px 0px',
): void {
  if (!canObserve()) return

  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onReach()
    },
    { rootMargin },
  )

  watch(
    [marker, ...rearm],
    () => {
      observer.disconnect()
      if (marker.value) observer.observe(marker.value)
    },
    { flush: 'post', immediate: true },
  )

  onBeforeUnmount(() => observer.disconnect())
}
