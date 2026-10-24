<script setup lang="ts">
import { Video } from 'lucide-vue-next'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useAuthStore } from '@/stores/auth'
import type { Chat, TimelineMessage } from '@/types/chat'
import { personById, systemText } from '@/utils/chatText'

const props = defineProps<{ message: TimelineMessage; chat: Chat }>()

const { t } = useI18n()
const auth = useAuthStore()

const text = computed(() =>
  systemText(props.message, t, (userId) => (userId === auth.user?.id ? t('common.you') : personById(props.chat, userId)?.name)),
)
const roomId = computed(() =>
  props.message.metadata.event === 'room_created' && typeof props.message.metadata.room_id === 'string'
    ? props.message.metadata.room_id
    : null,
)
</script>

<template>
  <!-- Written by the server ("Naw Paw started a video meeting"), shown as a centered notice, not a bubble. -->
  <li class="my-3 flex flex-col items-center gap-2 px-4 text-center">
    <p class="text-sm text-text-muted">{{ text }}</p>
    <RouterLink
      v-if="roomId"
      :to="{ name: 'room', params: { id: roomId } }"
      class="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 text-sm font-medium text-primary transition-colors duration-150 hover:bg-primary-soft"
    >
      <Video class="size-4" aria-hidden="true" />{{ t('chat.system.joinMeeting') }}
    </RouterLink>
  </li>
</template>
