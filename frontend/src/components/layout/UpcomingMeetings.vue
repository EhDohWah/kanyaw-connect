<script setup lang="ts">
import { toRef } from 'vue'
import { useI18n } from 'vue-i18n'

import BaseButton from '@/components/common/BaseButton.vue'
import Skeleton from '@/components/common/Skeleton.vue'
import MeetingRow from '@/components/rooms/MeetingRow.vue'
import { useUpcomingMeetings } from '@/composables/useUpcomingMeetings'
import { useRoomsStore } from '@/stores/rooms'
import { errorMessage } from '@/utils/errorMessage'

const props = defineProps<{ active: boolean }>()

const { t } = useI18n()
const rooms = useRoomsStore()
useUpcomingMeetings(toRef(props, 'active'))
</script>

<template>
  <section aria-labelledby="meetings-title">
    <h2 id="meetings-title" class="mb-2 text-sm font-semibold text-text">{{ t('activity.meetings.title') }}</h2>

    <div v-if="rooms.status === 'idle' || rooms.status === 'loading'" class="flex flex-col gap-2" role="status">
      <span class="sr-only">{{ t('common.loading') }}</span>
      <div v-for="row in 2" :key="row" class="flex items-center gap-3 px-2 py-2" aria-hidden="true">
        <div class="flex flex-1 flex-col gap-2">
          <Skeleton class="h-4 w-36" />
          <Skeleton class="h-3.5 w-24" />
        </div>
        <Skeleton class="h-11 w-16" />
      </div>
    </div>

    <div v-else-if="rooms.status === 'error' && rooms.upcoming.length === 0" class="flex flex-col items-start gap-2" role="alert">
      <p class="text-sm text-text-muted">{{ rooms.error ? errorMessage(rooms.error, t) : t('activity.meetings.failed') }}</p>
      <BaseButton variant="secondary" @click="rooms.fetchUpcoming()">{{ t('common.retry') }}</BaseButton>
    </div>

    <div v-else-if="rooms.upcoming.length === 0" class="text-sm text-text-muted">
      <p>{{ t('activity.meetings.empty') }}</p>
      <p>{{ t('activity.meetings.emptyHint') }}</p>
    </div>

    <ul v-else>
      <MeetingRow v-for="room in rooms.upcoming" :key="room.id" :room="room" />
    </ul>
  </section>
</template>
