import { onBeforeUnmount, ref, watch } from 'vue'

import { linkExpired, saveFile } from '@/utils/files'

/** How long to wait for a fresh link before letting the person try again. */
const FRESH_LINK_WAIT_MS = 10_000

/**
 * A download link that still works after its signature ran out: links last 60 minutes, and a chat can stay open
 * longer. A click on a good link goes through as usual. A click on an expired one asks for fresh links
 * (`requestFresh`) and saves the file from the fresh link as soon as it arrives. It is saved from this page rather than
 * opened: by then the click is over, a new tab would be blocked, and pictures (shown, not downloaded) would replace
 * the app if opened here.
 */
export function useFreshLink(url: () => string, name: () => string, requestFresh: () => void) {
  const waiting = ref(false)
  /** A click asked for fresh links, and the file is saved when they come. */
  let wanted = false
  let timer: ReturnType<typeof setTimeout> | undefined

  function onClick(event: MouseEvent): void {
    if (!linkExpired(url())) return
    event.preventDefault()
    if (waiting.value) return

    wanted = true
    waiting.value = true
    requestFresh()
    timer = setTimeout(() => {
      wanted = false
      waiting.value = false
    }, FRESH_LINK_WAIT_MS)
  }

  watch(url, async (next) => {
    if (!wanted) return
    wanted = false
    clearTimeout(timer)
    try {
      await saveFile(next, name())
    } catch {
      // The fresh link is on the link now: the next click opens it the usual way.
    } finally {
      waiting.value = false
    }
  })

  onBeforeUnmount(() => clearTimeout(timer))

  return { onClick, waiting }
}
