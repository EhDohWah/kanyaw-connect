<script setup lang="ts">
import { MicOff, SignalLow } from 'lucide-vue-next'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import TrackVideo from '@/components/call/TrackVideo.vue'
import UserAvatar from '@/components/common/UserAvatar.vue'
import type { CallParticipant } from '@/types/call'
import type { RoomRole } from '@/types/room'

/** One person (or their shared screen) in the call. */
const props = withDefaults(defineProps<{ person: CallParticipant; role?: RoomRole; screen?: boolean; small?: boolean }>(), {
  role: 'participant',
  screen: false,
  small: false,
})

const { t } = useI18n()

const track = computed(() => (props.screen ? props.person.screenTrack : props.person.cameraTrack))
const name = computed(() => {
  if (props.screen) return props.person.isLocal ? t('call.stage.yourScreen') : t('call.stage.screenOf', { name: props.person.name })
  return props.person.isLocal ? t('call.stage.you', { name: props.person.name }) : props.person.name
})
const roleLabel = computed(() => (props.role === 'host' ? t('call.participants.host') : props.role === 'co_host' ? t('call.participants.coHost') : ''))
const weak = computed(() => props.person.quality === 'poor' || props.person.quality === 'lost')

/** What a screen reader hears for the tile: who, and what is going on with them. */
const description = computed(() =>
  [name.value, roleLabel.value, !props.screen && !props.person.micOn ? t('call.stage.micOff') : '', !props.screen && props.person.speaking ? t('call.stage.speaking') : '']
    .filter(Boolean)
    .join(', '),
)
</script>

<template>
  <div
    role="group"
    :aria-label="description"
    :class="[
      'relative size-full overflow-hidden rounded-xl bg-call-surface transition-shadow duration-150',
      !screen && person.speaking ? 'ring-[3px] ring-primary' : '',
    ]"
  >
    <TrackVideo v-if="track" :track="track" :mirror="person.isLocal && !screen" :fit="screen ? 'contain' : 'cover'" />
    <div v-else class="flex size-full items-center justify-center">
      <UserAvatar :name="person.name" :src="person.avatarUrl" :seed="person.id" :size="small ? 'md' : 'xl'" />
    </div>

    <div
      :class="[
        'absolute bottom-1.5 left-1.5 flex max-w-[calc(100%-0.75rem)] items-center gap-1 rounded-lg bg-call-bg/75 px-2 py-0.5 text-on-call',
        small ? 'text-xs' : 'text-sm',
      ]"
      aria-hidden="true"
    >
      <MicOff v-if="!screen && !person.micOn" class="size-3.5 shrink-0" />
      <span class="truncate">{{ name }}</span>
      <span v-if="roleLabel && !small" class="shrink-0 text-on-call-muted">· {{ roleLabel }}</span>
    </div>
    <SignalLow v-if="weak" class="absolute top-2 right-2 size-4 text-on-call" :aria-label="t('call.stage.weakConnection')" role="img" />
  </div>
</template>
