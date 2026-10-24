<script setup lang="ts">
import { ArrowLeft, Lock, LoaderCircle, Mic, MicOff, Users, Video, VideoOff } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

import BaseButton from '@/components/common/BaseButton.vue'
import BaseInput from '@/components/common/BaseInput.vue'
import BaseSelect, { type SelectOption } from '@/components/common/BaseSelect.vue'
import UserAvatar from '@/components/common/UserAvatar.vue'
import MediaToggle from '@/components/call/MediaToggle.vue'
import TrackVideo from '@/components/call/TrackVideo.vue'
import { useNow } from '@/composables/useNow'
import { usePreviewMedia } from '@/composables/usePreviewMedia'
import { useAuthStore } from '@/stores/auth'
import { useCallStore } from '@/stores/call'
import type { Room } from '@/types/room'
import { formatMeetingTime } from '@/utils/dates'

const props = defineProps<{ room: Room }>()

const { t, locale } = useI18n()
const auth = useAuthStore()
const call = useCallStore()
const now = useNow()
// The tracks go into the call once it is connected; until then they are this screen's to close.
const preview = usePreviewMedia(() => call.inCall)
const password = ref('')

const busy = computed(() => call.phase === 'joining' || call.phase === 'connecting')
const waiting = computed(() => call.phase === 'waiting')
const hostedByMe = computed(() => props.room.host_id === auth.user?.id)
const when = computed(() =>
  props.room.scheduled_at ? formatMeetingTime(props.room.scheduled_at, now.value, auth.user?.timezone ?? 'UTC', locale.value) : '',
)

/** The host, and people already let in or waiting, are not asked for the password again (docs/API.md). */
const askPassword = computed(() => {
  if (call.problem?.kind === 'password-required' || call.problem?.kind === 'password-wrong') return true
  const admission = props.room.my_participation?.admission
  return props.room.has_password && !hostedByMe.value && admission !== 'admitted' && admission !== 'waiting'
})

const problemText = computed(() => {
  const problem = call.problem
  if (!problem) return ''
  switch (problem.kind) {
    case 'password-required':
      return t('call.problem.passwordRequired')
    case 'password-wrong':
      return problem.message
    case 'locked':
      return t('call.problem.locked')
    case 'full':
      return t('call.problem.full')
    case 'unavailable':
      return t('call.problem.unavailable')
    case 'rate-limited':
      return problem.retryAfter !== undefined ? t('errors.rateLimited', { seconds: problem.retryAfter }) : t('errors.rateLimitedNoWait')
    case 'network':
      return t('errors.network')
    case 'connect-failed':
      return t('call.problem.connectFailed')
    default:
      return problem.message || t('errors.unknown')
  }
})

const deviceOptions = (devices: MediaDeviceInfo[]): SelectOption[] => [
  { value: '', label: t('call.prejoin.defaultDevice') },
  ...devices.map((device) => ({ value: device.deviceId, label: device.label })),
]

function submit(): void {
  if (busy.value || waiting.value) return
  void call.join(preview.media(), askPassword.value ? password.value : undefined)
}
</script>

<template>
  <div class="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-4 md:px-8 md:py-8 lg:flex-row lg:items-start">
    <div class="flex flex-col gap-3 lg:flex-1">
      <RouterLink to="/rooms" class="inline-flex min-h-11 items-center gap-2 self-start rounded-lg pr-3 text-sm font-medium text-text-muted hover:text-text">
        <ArrowLeft class="size-4" aria-hidden="true" />{{ t('call.prejoin.back') }}
      </RouterLink>

      <!-- The camera preview, with the two switches on it. -->
      <div class="call-screen relative aspect-video overflow-hidden rounded-xl bg-call-surface" :aria-label="t('call.prejoin.preview')" role="group">
        <TrackVideo v-if="preview.video.value" :track="preview.video.value" mirror />
        <div v-else class="flex size-full flex-col items-center justify-center gap-3 text-on-call">
          <LoaderCircle v-if="preview.starting.camera" class="size-6 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          <template v-else>
            <UserAvatar :name="auth.user?.name ?? ''" :src="auth.user?.avatar_thumb_url" :seed="auth.user?.id" size="xl" />
            <p class="text-sm text-on-call-muted">{{ t('call.prejoin.cameraOff') }}</p>
          </template>
        </div>
        <div class="absolute inset-x-0 bottom-3 flex justify-center gap-3">
          <MediaToggle
            :on="preview.micOn.value"
            :label="t('call.toolbar.microphone')"
            :icon="Mic"
            :off-icon="MicOff"
            :busy="preview.starting.microphone"
            @toggle="preview.setMicrophone(!preview.micOn.value)"
          />
          <MediaToggle
            :on="preview.cameraOn.value"
            :label="t('call.toolbar.camera')"
            :icon="Video"
            :off-icon="VideoOff"
            :busy="preview.starting.camera"
            @toggle="preview.setCamera(!preview.cameraOn.value)"
          />
        </div>
      </div>
      <p v-if="preview.problems.camera" class="text-sm text-danger" role="alert">{{ t(`call.media.camera.${preview.problems.camera}`) }}</p>
      <p v-if="preview.problems.microphone" class="text-sm text-danger" role="alert">{{ t(`call.media.microphone.${preview.problems.microphone}`) }}</p>

      <div v-if="preview.cameras.value.length > 0 || preview.microphones.value.length > 0" class="grid gap-3 sm:grid-cols-2">
        <BaseSelect
          v-if="preview.cameras.value.length > 0"
          :model-value="preview.cameraId.value"
          :label="t('call.prejoin.camera')"
          :options="deviceOptions(preview.cameras.value)"
          @update:model-value="preview.chooseCamera"
        />
        <BaseSelect
          v-if="preview.microphones.value.length > 0"
          :model-value="preview.microphoneId.value"
          :label="t('call.prejoin.microphone')"
          :options="deviceOptions(preview.microphones.value)"
          @update:model-value="preview.chooseMicrophone"
        />
      </div>
    </div>

    <section class="flex flex-col gap-4 lg:w-80 lg:pt-14" aria-labelledby="room-title">
      <div>
        <h1 id="room-title" class="text-xl font-semibold text-text">{{ room.name }}</h1>
        <p class="text-sm text-text-muted">{{ hostedByMe ? t('call.prejoin.hostedByYou') : t('call.prejoin.hostedBy', { name: room.host.name }) }}</p>
        <p v-if="when" class="text-sm text-text-muted"><time :datetime="room.scheduled_at ?? undefined">{{ t('call.prejoin.startsAt', { when }) }}</time></p>
        <p v-if="room.status === 'active'" class="mt-1 inline-flex items-center gap-1.5 text-sm text-primary">
          <Users class="size-4" aria-hidden="true" />{{ t('call.prejoin.live', { count: room.present_count }) }}
        </p>
        <p v-if="room.description" class="mt-2 whitespace-pre-line text-text">{{ room.description }}</p>
      </div>

      <p v-if="room.is_locked" class="flex gap-2 text-sm text-text-muted"><Lock class="mt-0.5 size-4 shrink-0" aria-hidden="true" />{{ t('call.prejoin.lockedNote') }}</p>
      <p v-else-if="room.waiting_room_enabled && !hostedByMe" class="text-sm text-text-muted">{{ t('call.prejoin.waitingRoomNote') }}</p>

      <!-- Waiting for the host: this replaces the form, and changes by itself when the host decides. -->
      <div v-if="waiting" class="flex flex-col gap-3 rounded-xl border border-border p-4" role="status">
        <LoaderCircle class="size-6 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
        <h2 class="font-semibold text-text">{{ t('call.waiting.title') }}</h2>
        <p class="text-sm text-text-muted">{{ t('call.waiting.text') }}</p>
        <RouterLink to="/rooms" class="inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium text-text hover:bg-surface">
          {{ t('call.waiting.leave') }}
        </RouterLink>
      </div>

      <form v-else class="flex flex-col gap-4" novalidate @submit.prevent="submit">
        <BaseInput v-if="askPassword" v-model="password" type="password" autocomplete="off" :label="t('call.prejoin.password')" />
        <p v-if="problemText" class="text-sm text-danger" role="alert">{{ problemText }}</p>
        <BaseButton type="submit" size="lg" block :loading="busy">
          {{ call.phase === 'connecting' ? t('call.prejoin.connecting') : busy ? t('call.prejoin.joining') : t('call.prejoin.join') }}
        </BaseButton>
      </form>
    </section>
  </div>
</template>
