import { defineStore } from 'pinia'
import { ref } from 'vue'

/** A typing indicator disappears this long after the last sign of typing (docs: hide it 4 seconds after the last whisper). */
export const TYPING_VISIBLE_MS = 4000

/** Who is typing in which chat, from the whispers other people send on the chat's presence channel. */
export const useTypingStore = defineStore('typing', () => {
  /** chatId -> userId -> the time at which that person stops counting as typing */
  const expires = ref<Record<string, Record<string, number>>>({})
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  function clear(chatId: string, userId: string): void {
    const key = `${chatId}:${userId}`
    const timer = timers.get(key)
    if (timer !== undefined) clearTimeout(timer)
    timers.delete(key)

    const chat = expires.value[chatId]
    if (!chat || !(userId in chat)) return

    const { [userId]: _gone, ...rest } = chat
    expires.value = { ...expires.value, [chatId]: rest }
  }

  /** A whisper arrived. `typing: false` (they sent or cleared the text) hides it at once; otherwise it is shown for 4 more seconds. */
  function receive(chatId: string, userId: string, typing: boolean): void {
    if (!typing) {
      clear(chatId, userId)
      return
    }

    const key = `${chatId}:${userId}`
    const previous = timers.get(key)
    if (previous !== undefined) clearTimeout(previous)

    expires.value = {
      ...expires.value,
      [chatId]: { ...expires.value[chatId], [userId]: Date.now() + TYPING_VISIBLE_MS },
    }
    timers.set(key, setTimeout(() => clear(chatId, userId), TYPING_VISIBLE_MS))
  }

  function typingUserIds(chatId: string): string[] {
    return Object.keys(expires.value[chatId] ?? {})
  }

  function reset(): void {
    timers.forEach((timer) => clearTimeout(timer))
    timers.clear()
    expires.value = {}
  }

  return { expires, receive, clear, typingUserIds, reset }
})
