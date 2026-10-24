<script setup lang="ts">
import { CalendarClock } from 'lucide-vue-next'
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

import BaseButton from '@/components/common/BaseButton.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import ErrorState from '@/components/common/ErrorState.vue'
import Skeleton from '@/components/common/Skeleton.vue'
import MeetingRow from '@/components/rooms/MeetingRow.vue'
import { useRoomsStore } from '@/stores/rooms'
import type { RoomFilter } from '@/types/room'
import { errorMessage } from '@/utils/errorMessage'

const props = defineProps<{ filter: RoomFilter }>()
defineEmits<{ new: [] }>()

const { t } = useI18n()
const rooms = useRoomsStore()
const list = computed(() => rooms.lists[props.filter])

onMounted(() => void rooms.ensureList(props.filter))
</script>

<template>
  <div>
    <div v-if="list.status === 'idle' || list.status === 'loading'" role="status">
      <span class="sr-only">{{ t('common.loading') }}</span>
      <div v-for="row in 3" :key="row" class="flex items-center gap-3 px-2 py-3" aria-hidden="true">
        <div class="flex flex-1 flex-col gap-2">
          <Skeleton class="h-4 w-48" />
          <Skeleton class="h-3.5 w-32" />
        </div>
        <Skeleton class="h-11 w-16" />
      </div>
    </div>

    <ErrorState
      v-else-if="list.status === 'error'"
      :message="list.error ? errorMessage(list.error, t) : t('meetings.failed')"
      @retry="rooms.fetchList(filter)"
    />

    <EmptyState
      v-else-if="list.items.length === 0"
      :icon="CalendarClock"
      :title="t(`meetings.empty.${filter}`)"
      :text="t(`meetings.emptyHint.${filter}`)"
    >
      <BaseButton @click="$emit('new')">{{ t('meetings.new') }}</BaseButton>
    </EmptyState>

    <template v-else>
      <ul class="divide-y divide-border">
        <MeetingRow v-for="room in list.items" :key="room.id" :room="room" />
      </ul>
      <div v-if="list.nextUrl" class="flex flex-col items-center gap-2 p-4">
        <p v-if="list.loadMoreError" class="text-sm text-danger" role="alert">{{ errorMessage(list.loadMoreError, t) }}</p>
        <BaseButton variant="secondary" :loading="list.loadingMore" @click="rooms.loadMoreList(filter)">
          {{ list.loadingMore ? t('meetings.loadingMore') : t('meetings.showMore') }}
        </BaseButton>
      </div>
    </template>
  </div>
</template>
