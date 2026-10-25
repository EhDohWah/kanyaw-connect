import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * Only one voice message plays at a time, anywhere in the app: starting one pauses the one that was playing. A call
 * (Phase 6C) stops them all.
 */
export const useVoicePlaybackStore = defineStore('voicePlayback', () => {
  /** Which player is playing (a message id, or the composer's preview). */
  const playing = ref<string | null>(null)
  let pauseCurrent: (() => void) | null = null

  /** A player starts: the one playing before it is paused. */
  function claim(id: string, pause: () => void): void {
    if (playing.value !== null && playing.value !== id) pauseCurrent?.()
    playing.value = id
    pauseCurrent = pause
  }

  /** A player paused or finished by itself. */
  function release(id: string): void {
    if (playing.value !== id) return
    playing.value = null
    pauseCurrent = null
  }

  function stopAll(): void {
    pauseCurrent?.()
    playing.value = null
    pauseCurrent = null
  }

  return { playing, claim, release, stopAll }
})
