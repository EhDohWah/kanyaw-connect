import { defineStore } from 'pinia'
import { ref } from 'vue'

export type ToastKind = 'success' | 'error'

export interface Toast {
  id: number
  kind: ToastKind
  message: string
}

const TOAST_MS = 4000

export const useUiStore = defineStore('ui', () => {
  const toasts = ref<Toast[]>([])
  const createMenuOpen = ref(false)
  let nextId = 1

  function dismissToast(id: number): void {
    toasts.value = toasts.value.filter((toast) => toast.id !== id)
  }

  /** A short message that goes away by itself. Errors stay a little longer. */
  function toast(message: string, kind: ToastKind = 'success'): void {
    const id = nextId++
    toasts.value = [...toasts.value, { id, kind, message }]
    setTimeout(() => dismissToast(id), kind === 'error' ? TOAST_MS * 2 : TOAST_MS)
  }

  return { toasts, createMenuOpen, toast, dismissToast }
})
