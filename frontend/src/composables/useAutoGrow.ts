import type { Ref } from 'vue'

/** Makes a text box as tall as its text, up to `maxPx`, after which it scrolls. Call the result whenever the text changes. */
export function useAutoGrow(box: Ref<HTMLTextAreaElement | null>, maxPx: number): () => void {
  return () => {
    const el = box.value
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, maxPx)}px`
  }
}
