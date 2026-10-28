// Ported from frontend/src/stores/drafts.ts (Pinia) to Zustand.
import { create } from 'zustand'

export interface Draft {
  text: string
  /** The message being answered (the reply bar above the box). */
  replyToId: string | null
  /** The message being edited, if the box is in edit mode. */
  editingId: string | null
}

export const EMPTY_DRAFT: Draft = Object.freeze({ text: '', replyToId: null, editingId: null }) as Draft

/** What was typed in each chat's box and what it is replying to or editing: kept while moving between chats. */
interface DraftsState {
  drafts: Record<string, Draft>
  get(chatId: string): Draft
  update(chatId: string, patch: Partial<Draft>): void
  clear(chatId: string): void
  reset(): void
}

export const useDraftsStore = create<DraftsState>()((set, get) => ({
  drafts: {},

  get: (chatId) => get().drafts[chatId] ?? EMPTY_DRAFT,

  update(chatId, patch) {
    set({ drafts: { ...get().drafts, [chatId]: { ...get().get(chatId), ...patch } } })
  },

  clear(chatId) {
    const { [chatId]: _gone, ...rest } = get().drafts
    set({ drafts: rest })
  },

  reset: () => set({ drafts: {} }),
}))
