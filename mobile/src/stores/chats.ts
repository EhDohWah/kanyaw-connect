// The chat list, as much of it as the foundation needs. 8C replaces this with a port of frontend/src/stores/chats.ts
// (events applied one by one, read positions, unread counts). Until then every chat event refetches the first page.
import { create } from 'zustand'

import * as chatsApi from '@/api/chats'
import { toApiError, type ApiError } from '@/api/errors'
import type { Chat } from '@/types/chat'

/** Events come in bursts (a message, then its read receipt): one refetch for the lot. */
export const REFRESH_DELAY_MS = 1000

interface ChatsState {
  chats: Chat[]
  /** The next page's URL, or null when everything is loaded. */
  next: string | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: ApiError | null
  loadingMore: boolean

  /** Loads the first page unless it is already there. */
  load(): Promise<void>
  /** Loads the first page again (pull to refresh, coming back to the app, a chat event). */
  refresh(): Promise<void>
  /** Refreshes a moment later, once for several calls. */
  refreshSoon(): void
  loadMore(): Promise<void>
  reset(): void
}

let refreshTimer: ReturnType<typeof setTimeout> | undefined
/** Each first-page request gets a number; an answer that is not the latest is dropped (sign-out, a newer refresh). */
let generation = 0

export const useChatsStore = create<ChatsState>()((set, get) => ({
  chats: [],
  next: null,
  status: 'idle',
  error: null,
  loadingMore: false,

  async load() {
    if (get().status === 'ready' || get().status === 'loading') return
    await get().refresh()
  },

  async refresh() {
    const mine = ++generation
    if (get().status !== 'ready') set({ status: 'loading', error: null })
    try {
      const page = await chatsApi.listChats()
      if (mine !== generation) return
      // The first page replaces what was there: later pages load again as the person scrolls.
      set({ chats: page.data, next: page.links.next, status: 'ready', error: null })
    } catch (error) {
      if (mine !== generation) return
      // A list already on screen stays; only an empty screen shows the error.
      set((state) => ({ status: state.status === 'ready' ? 'ready' : 'error', error: toApiError(error) }))
    }
  },

  refreshSoon() {
    if (refreshTimer !== undefined) return
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined
      if (get().status !== 'idle') void get().refresh()
    }, REFRESH_DELAY_MS)
  },

  async loadMore() {
    const { next, loadingMore } = get()
    if (!next || loadingMore) return
    const mine = generation
    set({ loadingMore: true })
    try {
      const page = await chatsApi.listChats(next)
      if (mine !== generation) return
      set((state) => {
        const known = new Set(state.chats.map((chat) => chat.id))
        return { chats: [...state.chats, ...page.data.filter((chat) => !known.has(chat.id))], next: page.links.next }
      })
    } catch (error) {
      if (mine === generation) set({ error: toApiError(error) })
    } finally {
      if (mine === generation) set({ loadingMore: false })
    }
  },

  reset() {
    generation += 1
    if (refreshTimer !== undefined) clearTimeout(refreshTimer)
    refreshTimer = undefined
    set({ chats: [], next: null, status: 'idle', error: null, loadingMore: false })
  },
}))
