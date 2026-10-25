<script setup lang="ts">
import { ArrowDownLeft, ArrowUpRight, Phone, Video } from 'lucide-vue-next'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useAuthStore } from '@/stores/auth'
import { useDirectCallStore } from '@/stores/directCall'
import type { Chat, TimelineMessage } from '@/types/chat'
import { callNotice, personById, systemText } from '@/utils/chatText'

const props = defineProps<{ message: TimelineMessage; chat: Chat }>()

const { t } = useI18n()
const auth = useAuthStore()
const directCall = useDirectCallStore()

const me = computed(() => auth.user?.id ?? '')
const text = computed(() =>
  systemText(props.message, t, (userId) => (userId === me.value ? t('common.you') : personById(props.chat, userId)?.name), me.value),
)
const roomId = computed(() =>
  props.message.metadata.event === 'room_created' && typeof props.message.metadata.room_id === 'string'
    ? props.message.metadata.room_id
    : null,
)
/** A call's line ("Missed voice call", "Video call · 3:12"), from your side of it. */
const call = computed(() => callNotice(props.message, me.value))
const canCallBack = computed(() => call.value !== null && props.chat.type === 'direct' && !props.chat.is_encrypted && props.chat.other_user !== null)
</script>

<template>
  <!-- Written by the server ("Naw Paw started a video meeting", "Missed voice call"), shown as a centered notice, not a bubble. -->
  <li class="my-3 flex flex-col items-center gap-2 px-4 text-center">
    <p v-if="call" :class="['flex items-center gap-1.5 text-sm', call.missedByYou ? 'text-danger' : 'text-text-muted']">
      <component :is="call.kind === 'video' ? Video : Phone" class="size-4 shrink-0" aria-hidden="true" />
      <component :is="call.incoming ? ArrowDownLeft : ArrowUpRight" class="size-3.5 shrink-0" aria-hidden="true" />
      <span class="sr-only">{{ call.incoming ? t('chat.system.call.incoming') : t('chat.system.call.outgoing') }}:</span>
      {{ text }}
    </p>
    <p v-else class="text-sm text-text-muted">{{ text }}</p>

    <button
      v-if="call && canCallBack"
      type="button"
      class="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 text-sm font-medium text-primary transition-colors duration-150 hover:bg-primary-soft disabled:opacity-50"
      :aria-label="call.kind === 'video' ? t('chat.system.call.callBackVideo') : t('chat.system.call.callBackVoice')"
      :disabled="directCall.live"
      @click="directCall.start(chat.id, call.kind)"
    >
      <component :is="call.kind === 'video' ? Video : Phone" class="size-4" aria-hidden="true" />{{ t('chat.system.call.callBack') }}
    </button>
    <RouterLink
      v-else-if="roomId"
      :to="{ name: 'room', params: { id: roomId } }"
      class="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 text-sm font-medium text-primary transition-colors duration-150 hover:bg-primary-soft"
    >
      <Video class="size-4" aria-hidden="true" />{{ t('chat.system.joinMeeting') }}
    </RouterLink>
  </li>
</template>
