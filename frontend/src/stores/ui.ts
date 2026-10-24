import { defineStore } from 'pinia'
import { ref } from 'vue'

import { readStorage, writeStorage } from '@/utils/storage'

export type ToastKind = 'success' | 'error'

export interface Toast {
  id: number
  kind: ToastKind
  message: string
}

const TOAST_MS = 4000
const DRAWER_KEY = 'kc.drawer'

interface DrawerState {
  open: boolean
  chatId: string | null
}

function readDrawer(): DrawerState {
  try {
    const parsed = JSON.parse(readStorage(DRAWER_KEY) ?? 'null') as Partial<DrawerState> | null
    return { open: parsed?.open === true, chatId: typeof parsed?.chatId === 'string' ? parsed.chatId : null }
  } catch {
    return { open: false, chatId: null }
  }
}

export const useUiStore = defineStore('ui', () => {
  const toasts = ref<Toast[]>([])
  const createMenuOpen = ref(false)
  const newChatOpen = ref(false)
  const newGroupOpen = ref(false)
  /** The chat drawer on wide screens: open or collapsed to a tab, and which chat it shows (none = the list). */
  const drawer = ref<DrawerState>(readDrawer())
  let nextId = 1

  function setDrawer(next: DrawerState): void {
    drawer.value = next
    writeStorage(DRAWER_KEY, JSON.stringify(next))
  }

  function openDrawer(chatId: string | null = drawer.value.chatId): void {
    setDrawer({ open: true, chatId })
  }

  function collapseDrawer(): void {
    setDrawer({ ...drawer.value, open: false })
  }

  function dismissToast(id: number): void {
    toasts.value = toasts.value.filter((toast) => toast.id !== id)
  }

  /** A short message that goes away by itself. Errors stay a little longer. */
  function toast(message: string, kind: ToastKind = 'success'): void {
    const id = nextId++
    toasts.value = [...toasts.value, { id, kind, message }]
    setTimeout(() => dismissToast(id), kind === 'error' ? TOAST_MS * 2 : TOAST_MS)
  }

  return {
    toasts,
    createMenuOpen,
    newChatOpen,
    newGroupOpen,
    drawer,
    openDrawer,
    collapseDrawer,
    toast,
    dismissToast,
  }
})
