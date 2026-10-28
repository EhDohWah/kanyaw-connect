import { create } from 'zustand'

/** How long a toast stays up. Long enough to read a short sentence, including with a screen reader. */
export const TOAST_MS = 3000

export interface ToastMessage {
  id: number
  text: string
  tone: 'info' | 'success' | 'error'
}

let timer: ReturnType<typeof setTimeout> | undefined
let next = 1

/** One short message at a time at the bottom of the screen ("Copied"). */
interface ToastState {
  current: ToastMessage | null
  show(text: string, tone?: ToastMessage['tone']): void
  hide(): void
}

export const useToastStore = create<ToastState>()((set) => ({
  current: null,
  show(text, tone = 'info') {
    if (timer !== undefined) clearTimeout(timer)
    set({ current: { id: next++, text, tone } })
    timer = setTimeout(() => set({ current: null }), TOAST_MS)
  },
  hide() {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    set({ current: null })
  },
}))
