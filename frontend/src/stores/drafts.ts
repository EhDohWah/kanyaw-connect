import { defineStore } from 'pinia'
import { reactive } from 'vue'

export interface Draft {
  text: string
  /** The message being answered (the reply bar above the box). */
  replyToId: string | null
  /** The message being edited, if the box is in edit mode. */
  editingId: string | null
}

/** What was typed in each chat's box and what it is replying to or editing: kept while moving between chats, not between visits. */
export const useDraftsStore = defineStore('drafts', () => {
  const drafts = reactive<Record<string, Draft>>({})

  function get(chatId: string): Draft {
    // Read back after creating (the value of `a ??= b` is the plain object, not the reactive one that the screen watches).
    if (!drafts[chatId]) drafts[chatId] = { text: '', replyToId: null, editingId: null }
    return drafts[chatId] as Draft
  }

  function clear(chatId: string): void {
    delete drafts[chatId]
  }

  function reset(): void {
    for (const key of Object.keys(drafts)) delete drafts[key]
  }

  return { drafts, get, clear, reset }
})
