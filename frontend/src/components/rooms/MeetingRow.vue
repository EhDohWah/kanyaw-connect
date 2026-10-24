<script setup lang="ts">
import { Lock } from 'lucide-vue-next'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

import { useNow } from '@/composables/useNow'
import { useAuthStore } from '@/stores/auth'
import type { Room } from '@/types/room'
import { formatMeetingTime } from '@/utils/dates'

const props = defineProps<{ room: Room }>()

const { t, locale } = useI18n()
const auth = useAuthStore()
const now = useNow()

const hostedByMe = computed(() => props.room.host_id === auth.user?.id)
const when = computed(() =>
  props.room.scheduled_at ? formatMeetingTime(props.room.scheduled_at, now.value, auth.user?.timezone ?? 'UTC', locale.value) : '',
)
</script>

<template>
  <li class="flex items-center gap-3 rounded-lg px-2 py-2">
    <div class="min-w-0 flex-1">
      <p class="truncate font-medium text-text">{{ room.name }}</p>
      <p v-if="when" class="truncate text-sm text-text-muted">
        <time :datetime="room.scheduled_at ?? undefined">{{ when }}</time>
      </p>
      <p v-else-if="room.status === 'waiting'" class="truncate text-sm text-text-muted">{{ t('activity.meetings.notStarted') }}</p>
      <p class="truncate text-sm text-text-muted">
        {{ hostedByMe ? t('activity.meetings.hostedByYou') : t('activity.meetings.hostedBy', { name: room.host.name }) }}
      </p>
      <p v-if="room.status === 'active' || room.is_locked" class="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
        <span v-if="room.status === 'active'" class="rounded-lg bg-primary-soft px-1.5 py-0.5 font-medium text-primary">
          {{ t('activity.meetings.live') }}<template v-if="room.present_count > 0"> · {{ t('activity.meetings.inCall', { count: room.present_count }) }}</template>
        </span>
        <span v-if="room.is_locked" class="inline-flex items-center gap-1 text-text-muted">
          <Lock class="size-3.5" aria-hidden="true" />{{ t('activity.meetings.locked') }}
        </span>
      </p>
    </div>
    <RouterLink
      :to="{ name: 'room', params: { id: room.id } }"
      class="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-on-primary transition-colors duration-150 hover:bg-primary-hover"
      :aria-label="t('activity.meetings.joinNamed', { name: room.name })"
    >
      {{ t('activity.meetings.join') }}
    </RouterLink>
  </li>
</template>
