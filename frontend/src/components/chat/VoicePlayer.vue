<script setup lang="ts">
import { Pause, Play } from 'lucide-vue-next'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useVoicePlaybackStore } from '@/stores/voicePlayback'
import { formatDuration } from '@/utils/dates'
import { linkExpired } from '@/utils/files'

/** Bars drawn when the message did not say what it looks like (sent before voice notes had a waveform, or as a file). */
const PLAIN_BARS = 32
const SEEK_STEP_S = 5
const SPEEDS = [1, 1.5, 2] as const

const props = withDefaults(
  defineProps<{
    /** Unique among players: the message id, or the composer's preview. */
    id: string
    src: string
    durationMs?: number | null
    waveform?: readonly number[] | null
    /** In your own (blue) bubble. */
    own?: boolean
    /** The file name, for the download link when this device cannot play it. */
    name?: string
  }>(),
  { durationMs: null, waveform: null, own: false, name: 'voice-message' },
)
/** `expired`: the signed link ran out; the conversation asks the server for a fresh one. */
const emit = defineEmits<{ expired: [] }>()

const { t } = useI18n()
const playback = useVoicePlaybackStore()

const audio = ref<HTMLAudioElement | null>(null)
const playing = ref(false)
/** Where it is, in seconds (also where it will start, after a seek before anything was downloaded). */
const position = ref(0)
const elementDuration = ref<number | null>(null)
const speedIndex = ref(0)
const problem = ref<'unsupported' | 'network' | null>(null)
/** Start playing as soon as the fresh link arrives. */
let playWhenFresh = false
let refreshed = false
let pendingSeek: number | null = null

const local = computed(() => props.src.startsWith('blob:'))
const speed = computed(() => SPEEDS[speedIndex.value] ?? 1)

/** The length: as the sender measured it, else what the file says once loaded (Chrome's WebM says "Infinity"). */
const total = computed<number | null>(() => {
  if (props.durationMs && props.durationMs > 0) return props.durationMs / 1000
  return elementDuration.value
})

const bars = computed(() => {
  const values = props.waveform && props.waveform.length > 0 ? props.waveform : new Array<number>(PLAIN_BARS).fill(110)
  // At least a sliver for silence, so the shape of the message is still visible.
  return values.map((value) => Math.max(12, Math.round((Math.min(255, Math.max(0, value)) / 255) * 100)))
})
const filled = computed(() => {
  if (!total.value) return 0
  return Math.round((position.value / total.value) * bars.value.length)
})

const shownTime = computed(() =>
  playing.value || position.value > 0 ? formatDuration(position.value * 1000) : total.value ? formatDuration(total.value * 1000) : '0:00',
)
const valueText = computed(() =>
  total.value
    ? t('voice.positionOf', { position: formatDuration(position.value * 1000), total: formatDuration(total.value * 1000) })
    : formatDuration(position.value * 1000),
)

function pause(): void {
  audio.value?.pause()
}

function play(): void {
  const el = audio.value
  if (!el || problem.value === 'unsupported') return
  problem.value = null

  // The link lasts an hour: ask for a fresh one first, and play when it comes.
  if (!local.value && linkExpired(props.src) && !refreshed) {
    refreshed = true
    playWhenFresh = true
    emit('expired')
    return
  }

  playback.claim(props.id, pause)
  el.playbackRate = speed.value
  playing.value = true
  void el.play()?.catch(() => {
    playing.value = false
    playback.release(props.id)
  })
}

function toggle(): void {
  if (playing.value) pause()
  else play()
}

function seek(seconds: number): void {
  const length = total.value
  if (!length) return
  const target = Math.min(length, Math.max(0, seconds))
  position.value = target
  const el = audio.value
  // Nothing downloaded yet (preload="none"): remember it for when the file arrives.
  if (el && el.readyState >= 1) el.currentTime = target
  else pendingSeek = target
}

/* --------------------------------------------------------------------------------------- the slider --- */

const slider = ref<HTMLElement | null>(null)
let dragging = false

function seekToPointer(event: PointerEvent): void {
  const rect = slider.value?.getBoundingClientRect()
  if (!rect || rect.width === 0 || !total.value) return
  seek(((event.clientX - rect.left) / rect.width) * total.value)
}

function onPointerDown(event: PointerEvent): void {
  if (!total.value) return
  dragging = true
  slider.value?.setPointerCapture?.(event.pointerId)
  seekToPointer(event)
}

function onPointerMove(event: PointerEvent): void {
  if (dragging) seekToPointer(event)
}

function onPointerUp(event: PointerEvent): void {
  dragging = false
  slider.value?.releasePointerCapture?.(event.pointerId)
}

function onKeydown(event: KeyboardEvent): void {
  const length = total.value
  if (!length) return
  const moves: Record<string, number> = {
    ArrowRight: position.value + SEEK_STEP_S,
    ArrowUp: position.value + SEEK_STEP_S,
    ArrowLeft: position.value - SEEK_STEP_S,
    ArrowDown: position.value - SEEK_STEP_S,
    Home: 0,
    End: length,
  }
  const target = moves[event.key]
  if (target === undefined) return
  event.preventDefault()
  seek(target)
}

function cycleSpeed(): void {
  speedIndex.value = (speedIndex.value + 1) % SPEEDS.length
  if (audio.value) audio.value.playbackRate = speed.value
}

/* ------------------------------------------------------------------------------------ the element --- */

function onLoadedMetadata(): void {
  const el = audio.value
  if (!el) return
  elementDuration.value = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null
  if (pendingSeek !== null) {
    el.currentTime = pendingSeek
    pendingSeek = null
  }
}

function onTimeUpdate(): void {
  if (audio.value && !dragging) position.value = audio.value.currentTime
}

function onPause(): void {
  playing.value = false
  playback.release(props.id)
}

function onEnded(): void {
  playing.value = false
  position.value = 0
  playback.release(props.id)
}

function onError(): void {
  const el = audio.value
  playing.value = false
  playback.release(props.id)
  // The signed link ran out (an hour): fetch a fresh one, once, and carry on from where it was.
  if (!local.value && !refreshed && linkExpired(props.src)) {
    refreshed = true
    playWhenFresh = true
    pendingSeek = position.value || null
    emit('expired')
    return
  }
  problem.value = el?.error?.code === 4 /* MEDIA_ERR_SRC_NOT_SUPPORTED */ ? 'unsupported' : 'network'
}

// A fresh link arrived.
watch(
  () => props.src,
  async () => {
    if (problem.value === 'network') problem.value = null
    if (position.value > 0) pendingSeek = position.value
    if (!playWhenFresh) return
    playWhenFresh = false
    await nextTick()
    play()
  },
)

onBeforeUnmount(() => {
  audio.value?.pause()
  playback.release(props.id)
})
</script>

<template>
  <div class="flex w-64 max-w-full flex-col gap-1">
    <div class="flex items-center gap-1.5" role="group" :aria-label="t('message.voiceMessage')">
      <button
        type="button"
        :class="[
          'flex size-11 shrink-0 items-center justify-center rounded-full transition-colors duration-150 disabled:opacity-60',
          own ? 'bg-on-primary text-primary' : 'bg-primary text-on-primary hover:bg-primary-hover',
        ]"
        :aria-label="playing ? t('voice.pause') : t('voice.play')"
        :disabled="problem === 'unsupported'"
        @click="toggle"
      >
        <Pause v-if="playing" class="size-5" aria-hidden="true" />
        <Play v-else class="size-5 translate-x-px" aria-hidden="true" />
      </button>

      <div class="min-w-0 flex-1">
        <div
          ref="slider"
          role="slider"
          :tabindex="problem === 'unsupported' ? -1 : 0"
          :aria-label="t('voice.position')"
          :aria-valuemin="0"
          :aria-valuemax="Math.round(total ?? 0)"
          :aria-valuenow="Math.round(position)"
          :aria-valuetext="valueText"
          :aria-disabled="!total || undefined"
          class="flex h-8 cursor-pointer touch-none select-none items-center gap-px rounded-sm"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
          @keydown="onKeydown"
        >
          <span
            v-for="(height, index) in bars"
            :key="index"
            :style="{ height: `${height}%` }"
            :class="[
              'min-w-px flex-1 rounded-full transition-colors duration-150',
              index < filled ? (own ? 'bg-on-primary' : 'bg-primary') : own ? 'bg-on-primary/40' : 'bg-text-muted/40',
            ]"
            aria-hidden="true"
          />
        </div>
        <span :class="['block text-xs tabular-nums', own ? 'text-on-primary' : 'text-text-muted']">{{ shownTime }}</span>
      </div>

      <button
        type="button"
        :class="[
          'flex size-11 shrink-0 items-center justify-center rounded-lg text-xs font-semibold tabular-nums transition-colors duration-150',
          own ? 'text-on-primary hover:bg-primary-hover' : 'text-text hover:bg-bg',
        ]"
        :aria-label="t('voice.speed', { speed: `${speed}×` })"
        @click="cycleSpeed"
      >
        {{ speed }}×
      </button>

      <!-- preload before src: the element must know not to fetch anything before it is given an address. -->
      <audio
        ref="audio"
        preload="none"
        :src="src"
        class="hidden"
        @loadedmetadata="onLoadedMetadata"
        @durationchange="onLoadedMetadata"
        @timeupdate="onTimeUpdate"
        @play="playing = true"
        @pause="onPause"
        @ended="onEnded"
        @error="onError"
      />
    </div>

    <p v-if="problem === 'unsupported'" :class="['text-xs', own ? 'text-on-primary' : 'text-text']" role="alert">
      {{ t('voice.unsupported') }}
      <a :href="src" :download="name" :class="['font-medium underline', own ? 'text-on-primary' : 'text-primary']">{{ t('voice.download') }}</a>
    </p>
    <p v-else-if="problem === 'network'" :class="['text-xs', own ? 'text-on-primary' : 'text-text']" role="alert">
      {{ t('voice.loadFailed') }}
    </p>
  </div>
</template>
