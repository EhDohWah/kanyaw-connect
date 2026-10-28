// Ported from frontend/src/stores/typing.ts (Pinia) to Zustand.
import { create } from 'zustand'

/** A typing indicator disappears this long after the last sign of typing (docs: hide it 4 seconds after the last whisper). */
export const TYPING_VISIBLE_MS = 4000

const timers = new Map<string, ReturnType<typeof setTimeout>>()
const NOBODY: string[] = []

/** Who is typing in which chat, from the whispers other people send on the chat's presence channel. */
interface TypingState {
  /** chatId -> the ids of the people typing there */
  byChat: Record<string, string[]>
  /** A whisper arrived. `typing: false` (they sent or cleared the text) hides it at once; otherwise for 4 more seconds. */
  receive(chatId: string, userId: string, typing: boolean): void
  clear(chatId: string, userId: string): void
  typingUserIds(chatId: string): string[]
  reset(): void
}

export const useTypingStore = create<TypingState>()((set, get) => ({
  byChat: {},

  clear(chatId, userId) {
    const key = `${chatId}:${userId}`
    const timer = timers.get(key)
    if (timer !== undefined) clearTimeout(timer)
    timers.delete(key)

    const people = get().byChat[chatId]
    if (!people?.includes(userId)) return
    const rest = people.filter((id) => id !== userId)
    const { [chatId]: _old, ...others } = get().byChat
    set({ byChat: rest.length > 0 ? { ...others, [chatId]: rest } : others })
  },

  receive(chatId, userId, typing) {
    if (!typing) {
      get().clear(chatId, userId)
      return
    }

    const key = `${chatId}:${userId}`
    const previous = timers.get(key)
    if (previous !== undefined) clearTimeout(previous)
    timers.set(
      key,
      setTimeout(() => get().clear(chatId, userId), TYPING_VISIBLE_MS),
    )

    const people = get().byChat[chatId] ?? []
    if (!people.includes(userId)) set({ byChat: { ...get().byChat, [chatId]: [...people, userId] } })
  },

  typingUserIds: (chatId) => get().byChat[chatId] ?? NOBODY,

  reset() {
    timers.forEach((timer) => clearTimeout(timer))
    timers.clear()
    set({ byChat: {} })
  },
}))
