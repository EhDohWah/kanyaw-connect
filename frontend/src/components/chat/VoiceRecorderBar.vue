<script setup lang="ts">
import { SendHorizontal, Square, Trash2 } from 'lucide-vue-next'
import { nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import VoicePlayer from '@/components/chat/VoicePlayer.vue'
import type { RecorderNotice, RecorderState, Recording } from '@/composables/useVoiceRecorder'
import { formatDuration } from '@/utils/dates'

/** Bars in the live level meter. */
const METER_BARS = 8

const props = defineProps<{
  state: RecorderState
  elapsedMs: number
  /** The loudness right now, 0–1. */
  level: number
  recording: Recording | null
  notice: RecorderNotice | null
  /** Who the preview player is, for "one voice message plays at a time". */
  previewId: string
}>()
const emit = defineEmits<{ cancel: []; stop: []; send: [] }>()

const { t } = useI18n()
const stopButton = ref<HTMLButtonElement | null>(null)
const previewBox = ref<HTMLElement | null>(null)

// The microphone button that opened this bar has gone: the focus goes to the next thing to do.
function placeFocus(): void {
  void nextTick(() => {
    if (props.state === 'preview') previewBox.value?.querySelector<HTMLButtonElement>('button')?.focus()
    else stopButton.value?.focus()
  })
}
onMounted(placeFocus)
watch(() => props.state, placeFocus)

function lit(index: number): boolean {
  return props.level * METER_BARS > index
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <p v-if="notice" class="text-sm text-text" role="status">
      {{ notice === 'limit' ? t('voice.limitReached') : t('voice.interrupted') }}
    </p>
    <p class="sr-only" role="status">
      {{ state === 'starting' ? t('voice.starting') : state === 'recording' ? t('voice.recording') : '' }}
    </p>

    <div class="flex items-center gap-2" role="group" :aria-label="state === 'preview' ? t('voice.previewLabel') : t('voice.recordingLabel')">
      <button
        type="button"
        class="flex size-11 shrink-0 items-center justify-center rounded-lg text-danger transition-colors duration-150 hover:bg-danger-soft"
        :aria-label="t('voice.delete')"
        @click="emit('cancel')"
      >
        <Trash2 class="size-5" aria-hidden="true" />
      </button>

      <div v-if="state === 'preview' && recording" ref="previewBox" class="min-w-0 flex-1 rounded-lg bg-surface px-2 py-1">
        <VoicePlayer :id="previewId" :src="recording.url" :duration-ms="recording.durationMs" :waveform="recording.waveform" />
      </div>

      <template v-else>
        <div class="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg bg-surface px-3">
          <span class="size-2.5 shrink-0 animate-pulse rounded-full bg-danger motion-reduce:animate-none" aria-hidden="true" />
          <span role="timer" :aria-label="t('voice.recordingFor', { time: formatDuration(elapsedMs) })" class="text-sm font-medium tabular-nums">
            {{ formatDuration(elapsedMs) }}
          </span>
          <span class="flex h-5 flex-1 items-center gap-0.5" aria-hidden="true">
            <span
              v-for="index in METER_BARS"
              :key="index"
              :style="{ height: `${30 + (index * 70) / METER_BARS}%` }"
              :class="['w-1 rounded-full transition-colors duration-75', lit(index - 1) ? 'bg-primary' : 'bg-border']"
            />
          </span>
        </div>
        <button
          ref="stopButton"
          type="button"
          class="flex size-11 shrink-0 items-center justify-center rounded-lg border border-border text-text transition-colors duration-150 hover:bg-surface disabled:opacity-60"
          :aria-label="t('voice.stop')"
          :disabled="state === 'starting'"
          @click="emit('stop')"
        >
          <Square class="size-4 fill-current" aria-hidden="true" />
        </button>
      </template>

      <button
        type="button"
        class="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary text-on-primary transition-colors duration-150 hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
        :aria-label="t('voice.send')"
        :disabled="state === 'starting'"
        @click="emit('send')"
      >
        <SendHorizontal class="size-5" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>
