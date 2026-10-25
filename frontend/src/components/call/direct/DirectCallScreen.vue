<script setup lang="ts">
import { ChevronDown, Mic, MicOff, PhoneOff, SwitchCamera, Video, VideoOff, Volume2 } from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import MediaToggle from '@/components/call/MediaToggle.vue'
import TrackVideo from '@/components/call/TrackVideo.vue'
import RoundAction from '@/components/call/direct/RoundAction.vue'
import SelfPreview, { type Corner } from '@/components/call/direct/SelfPreview.vue'
import UserAvatar from '@/components/common/UserAvatar.vue'
import { useCallClock } from '@/composables/useCallClock'
import { useMediaQuery } from '@/composables/useMediaQuery'
import { useDirectCallStore } from '@/stores/directCall'

/**
 * Your call while it rings, connects and goes on. A video call fills the screen with their video and keeps yours in a
 * small picture you can move and swap; with their camera off (and for voice calls) it is their picture with a ring
 * that grows as they speak. The name and time fade away after a few seconds without a touch, and come back on one.
 */
const { t } = useI18n()
const call = useDirectCallStore()

/** The name and the controls hide after this long without a touch (video only). */
const CHROME_HIDE_MS = 3000

const name = computed(() => call.peer?.name ?? t('directCall.someone'))
const clock = useCallClock(computed(() => (call.phase === 'active' ? call.call?.answered_at : null)))
const portrait = useMediaQuery('(orientation: portrait)')
const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')

const theirVideo = computed(() => call.remote?.cameraTrack ?? null)
const myVideo = computed(() => call.local?.cameraTrack ?? null)
/** Their video fills the screen: a video call with their camera on. Otherwise their picture (the voice layout). */
const videoLayout = computed(() => call.kind === 'video' && theirVideo.value !== null)
/** Ringing a video call: your own camera behind their name, as a mirror. */
const previewBehind = computed(() => call.kind === 'video' && !videoLayout.value && myVideo.value !== null)

const swapped = ref(false)
const corner = ref<Corner>('bottom-right')
const big = computed(() => (swapped.value ? myVideo.value : theirVideo.value))
const small = computed(() => (swapped.value ? theirVideo.value : myVideo.value))

const status = computed(() => {
  if (call.reconnecting) return t('directCall.reconnecting')
  if (call.phase === 'starting' || call.phase === 'ringing') return t('directCall.calling')
  if (call.phase === 'connecting' || call.phase === 'accepting') return t('directCall.connecting')
  return clock.value ?? ''
})
const quality = computed(() => {
  const value = call.remote?.quality
  return value === 'poor' || value === 'lost' ? t(`directCall.quality.${value}`) : ''
})

/** The voice layout's ring: bigger as they speak (just brighter with reduced motion). */
const ringStyle = computed(() => {
  const level = call.remote?.speaking ? Math.max(call.remoteLevel, 0.15) : call.remoteLevel
  return reducedMotion.value ? { opacity: String(0.15 + level * 0.85) } : { transform: `scale(${1 + Math.min(1, level * 2) * 0.35})` }
})

/* ------------------------------------------------------------------------------------- fading chrome --- */

const chromeShown = ref(true)
let hideTimer: ReturnType<typeof setTimeout> | undefined

function showChrome(): void {
  chromeShown.value = true
  clearTimeout(hideTimer)
  if (videoLayout.value && call.phase === 'active') hideTimer = setTimeout(() => (chromeShown.value = false), CHROME_HIDE_MS)
}

watch([videoLayout, () => call.phase], showChrome)
onMounted(showChrome)
onBeforeUnmount(() => clearTimeout(hideTimer))

const endButton = ref<HTMLElement | null>(null)
onMounted(() => endButton.value?.querySelector('button')?.focus())

function onSpeakerChange(event: Event): void {
  void call.chooseSpeaker((event.target as HTMLSelectElement).value)
}
</script>

<template>
  <div class="relative h-full overflow-hidden" @pointerdown="showChrome" @keydown="showChrome">
    <!-- Video layout -->
    <template v-if="videoLayout && big">
      <div class="absolute inset-0 bg-call-bg">
        <TrackVideo :track="big" :fit="portrait ? 'cover' : 'contain'" :mirror="swapped" />
      </div>
      <SelfPreview
        v-if="small"
        v-model:corner="corner"
        :track="small"
        :mirror="!swapped"
        :label="t('directCall.swap')"
        @swap="swapped = !swapped"
      />
    </template>

    <!-- Ringing a video call: your own camera behind -->
    <div v-else-if="previewBehind && myVideo" class="absolute inset-0 opacity-60">
      <TrackVideo :track="myVideo" mirror />
    </div>

    <!-- Voice layout (also a video call with their camera off) -->
    <div v-if="!videoLayout" class="relative flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <span class="relative flex items-center justify-center">
        <span
          class="absolute inset-[-12px] rounded-full bg-success/40 transition-transform duration-100 motion-reduce:transition-opacity"
          :style="call.phase === 'active' ? ringStyle : { opacity: '0' }"
          aria-hidden="true"
        />
        <UserAvatar :name="name" :src="call.peer?.avatar_thumb_url" :seed="call.peer?.id" size="xl" />
      </span>
      <h2 class="text-2xl font-semibold">{{ name }}</h2>
      <p class="text-on-call-muted tabular-nums" role="status">{{ status }}</p>
      <p v-if="call.kind === 'video' && call.phase === 'active' && call.remote && !call.remote.cameraOn" class="text-sm text-on-call-muted">
        {{ t('directCall.cameraOff', { name }) }}
      </p>
      <p v-if="quality" class="text-sm text-on-call-danger">{{ quality }}</p>
    </div>

    <!-- Top: name and time (over the video), minimize -->
    <div
      :class="[
        'absolute inset-x-0 top-0 flex items-start gap-2 bg-gradient-to-b from-call-bg/80 to-transparent px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-8 transition-opacity duration-300 motion-reduce:transition-none',
        chromeShown ? 'opacity-100' : 'pointer-events-none opacity-0',
      ]"
    >
      <button
        type="button"
        class="flex size-11 shrink-0 items-center justify-center rounded-lg text-on-call hover:bg-call-raised"
        :aria-label="t('directCall.minimize')"
        @click="call.minimize()"
      >
        <ChevronDown class="size-6" aria-hidden="true" />
      </button>
      <div v-if="videoLayout" class="min-w-0 flex-1 pt-1">
        <p class="truncate font-semibold">{{ name }}</p>
        <p class="text-sm text-on-call-muted tabular-nums" role="status">{{ status }}<template v-if="quality"> · {{ quality }}</template></p>
      </div>
    </div>

    <!-- The other person's sound is held back until a tap (a reload with no click yet). -->
    <button
      v-if="call.audioBlocked"
      type="button"
      class="absolute left-1/2 top-24 z-20 inline-flex min-h-11 -translate-x-1/2 items-center gap-2 rounded-lg bg-call-raised px-4 text-sm font-medium text-on-call"
      @click="call.startAudio()"
    >
      <Volume2 class="size-4" aria-hidden="true" />{{ t('directCall.tapToHearThem', { name }) }}
    </button>

    <!-- Controls -->
    <div
      :class="[
        'absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-center gap-3 bg-gradient-to-t from-call-bg/90 to-transparent px-4 pt-10 pb-[max(1.5rem,env(safe-area-inset-bottom))] transition-opacity duration-300 motion-reduce:transition-none',
        chromeShown ? 'opacity-100' : 'pointer-events-none opacity-0',
      ]"
      role="group"
      :aria-label="t('directCall.screenLabel', { name })"
    >
      <MediaToggle
        :on="call.local?.micOn ?? true"
        :label="t('directCall.microphone')"
        :icon="Mic"
        :off-icon="MicOff"
        :busy="call.mediaBusy.microphone"
        :disabled="!call.local"
        @toggle="call.toggleMicrophone()"
      />
      <MediaToggle
        v-if="call.kind === 'video'"
        :on="call.local?.cameraOn ?? false"
        :label="t('directCall.camera')"
        :icon="Video"
        :off-icon="VideoOff"
        :busy="call.mediaBusy.camera"
        :disabled="!call.local"
        @toggle="call.toggleCamera()"
      />
      <button
        v-if="call.kind === 'video' && call.cameraCount > 1"
        type="button"
        class="flex size-11 items-center justify-center rounded-lg bg-call-raised text-on-call hover:bg-call-surface disabled:opacity-50 sm:size-12"
        :aria-label="t('directCall.flip')"
        :disabled="!call.local?.cameraOn || call.mediaBusy.camera"
        @click="call.flipCamera()"
      >
        <SwitchCamera class="size-5" aria-hidden="true" />
      </button>
      <label v-if="call.speakers.length > 0" class="flex h-11 items-center gap-2 rounded-lg bg-call-raised px-3 text-sm text-on-call sm:h-12">
        <Volume2 class="size-5 shrink-0" aria-hidden="true" />
        <span class="sr-only">{{ t('directCall.speaker') }}</span>
        <select class="max-w-40 truncate bg-transparent text-on-call outline-none" :value="call.speakerId ?? ''" @change="onSpeakerChange">
          <option v-if="!call.speakerId" value="" class="text-text">{{ t('directCall.speakerDefault') }}</option>
          <option v-for="speaker in call.speakers" :key="speaker.deviceId" :value="speaker.deviceId" class="text-text">
            {{ speaker.label || t('directCall.speakerDefault') }}
          </option>
        </select>
      </label>
      <div ref="endButton" class="ml-2">
        <RoundAction :label="t('directCall.end')" :icon="PhoneOff" tone="end" @click="call.hangUp()" />
      </div>
    </div>
  </div>
</template>
