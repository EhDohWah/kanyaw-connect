import { onBeforeUnmount, ref, type Ref } from 'vue'

/** Whether a CSS media query matches right now, kept up to date as the window changes (false where media queries do not exist). */
export function useMediaQuery(query: string): Ref<boolean> {
  const matches = ref(false)
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return matches

  const list = window.matchMedia(query)
  matches.value = list.matches

  const update = (event: MediaQueryListEvent): void => {
    matches.value = event.matches
  }
  list.addEventListener('change', update)
  onBeforeUnmount(() => list.removeEventListener('change', update))

  return matches
}
