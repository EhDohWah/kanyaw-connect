<script setup lang="ts">
import { Ellipsis, LoaderCircle, TriangleAlert } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import LinkifiedText from '@/components/chat/LinkifiedText.vue'
import MessageActionSheet from '@/components/chat/MessageActionSheet.vue'
import MessageMedia from '@/components/chat/MessageMedia.vue'
import MessageToolbar from '@/components/chat/MessageToolbar.vue'
import ReplyQuote from '@/components/chat/ReplyQuote.vue'
import UserAvatar from '@/components/common/UserAvatar.vue'
import { useLongPress } from '@/composables/useLongPress'
import { useAuthStore } from '@/stores/auth'
import type { Chat } from '@/types/chat'
import { personById } from '@/utils/chatText'
import { formatClock } from '@/utils/dates'
import { errorMessage } from '@/utils/errorMessage'
import { availableActions, type MessageActionKey } from '@/utils/messageActions'
import type { TimelineItem } from '@/utils/timeline'

type MessageItem = Extract<TimelineItem, { kind: 'message' }>

const props = defineProps<{ item: MessageItem; chat: Chat }>()
const emit = defineEmits<{
  action: [key: MessageActionKey, messageId: string]
  retry: [clientId: string]
  discard: [clientId: string]
  openImage: [messageId: string]
  expired: [messageId: string]
}>()

const { t, locale } = useI18n()
const auth = useAuthStore()

const message = computed(() => props.item.message)
const own = computed(() => props.item.own)
const showName = computed(() => !own.value && props.chat.type === 'group' && props.item.firstInGroup)
const senderName = computed(() => message.value.sender?.name ?? t('chat.someone'))
const time = computed(() => formatClock(message.value.created_at, auth.user?.timezone ?? 'UTC', locale.value))
const actions = computed(() => availableActions(message.value, props.chat, auth.user?.id ?? ''))
const pending = computed(() => message.value.pending)

const replyName = computed(() => {
  const reply = message.value.reply_to
  if (!reply) return ''
  if (reply.sender_id === auth.user?.id) return t('common.you')
  return (reply.sender_id ? personById(props.chat, reply.sender_id)?.name : undefined) ?? t('chat.someone')
})

const sheetOpen = ref(false)
const longPress = useLongPress(() => {
  if (actions.value.length > 0) sheetOpen.value = true
})

function run(key: MessageActionKey): void {
  sheetOpen.value = false
  emit('action', key, message.value.id)
}
</script>

<template>
  <li :class="['group flex gap-2', own ? 'flex-row-reverse' : '', item.lastInGroup ? 'mb-3' : 'mb-0.5']">
    <!-- The picture sits beside the last bubble of a run by someone else; the others keep the space. -->
    <span v-if="!own" class="w-8 shrink-0 self-end">
      <UserAvatar
        v-if="item.lastInGroup"
        :name="senderName"
        :seed="message.sender_id ?? senderName"
        :src="message.sender?.avatar_thumb_url ?? null"
        size="sm"
      />
    </span>

    <div :class="['flex min-w-0 max-w-[78%] flex-col', own ? 'items-end' : 'items-start']">
      <span v-if="showName" class="mb-0.5 px-1 text-xs font-medium text-text-muted">{{ senderName }}</span>

      <div class="relative flex items-center">
        <div
          :class="[
            'min-w-0 rounded-xl px-3 py-2 [@media(pointer:coarse)]:select-none',
            own ? 'bg-primary text-on-primary' : 'bg-surface text-text',
            pending?.status === 'sending' ? 'opacity-70' : '',
            pending?.status === 'failed' ? 'ring-2 ring-danger' : '',
          ]"
          v-bind="longPress"
        >
          <ReplyQuote v-if="message.reply_to" :reply="message.reply_to" :sender-name="replyName" :own="own" />
          <MessageMedia
            v-if="message.attachment"
            :type="message.type"
            :attachment="message.attachment"
            :message-id="message.id"
            :metadata="message.metadata"
            :own="own"
            :class="message.content ? 'mb-2' : ''"
            @open="emit('openImage', message.id)"
            @expired="emit('expired', message.id)"
          />
          <LinkifiedText v-if="message.content" :text="message.content" :own="own" />
        </div>

        <!-- Mouse: quick actions beside the bubble. Keyboard and screen reader: one button that opens the same list. -->
        <div
          v-if="actions.length > 0"
          :class="[
            'absolute top-1/2 hidden -translate-y-1/2 [@media(hover:hover)]:group-hover:block',
            own ? 'right-full mr-1' : 'left-full ml-1',
          ]"
        >
          <MessageToolbar :actions="actions" @run="run" />
        </div>
        <button
          v-if="actions.length > 0"
          type="button"
          :class="[
            'sr-only focus:not-sr-only focus:flex focus:size-11 focus:items-center focus:justify-center focus:rounded-lg focus:text-text',
            own ? 'order-first' : '',
          ]"
          :aria-label="t('message.actions')"
          @click="sheetOpen = true"
        >
          <Ellipsis class="size-5" aria-hidden="true" />
        </button>
      </div>

      <!-- Sending, failed, or the time under the last bubble of a run. -->
      <div v-if="pending || item.lastInGroup" class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-xs text-text-muted">
        <template v-if="pending?.status === 'sending'">
          <LoaderCircle class="size-3.5 animate-spin" aria-hidden="true" />
          {{ pending.progress !== null && pending.progress < 100 ? t('message.uploading', { percent: pending.progress }) : t('message.sending') }}
        </template>
        <div v-else-if="pending?.status === 'failed'" class="flex flex-col items-end">
          <p class="flex items-start gap-1.5 text-danger" role="alert">
            <TriangleAlert class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>{{ t('message.failed') }}<template v-if="pending.error">: {{ errorMessage(pending.error, t) }}</template></span>
          </p>
          <div class="flex gap-3">
            <button type="button" class="min-h-11 font-medium text-primary underline underline-offset-2" @click="emit('retry', pending.clientId)">
              {{ t('message.retry') }}
            </button>
            <button type="button" class="min-h-11 font-medium text-text underline underline-offset-2" @click="emit('discard', pending.clientId)">
              {{ t('message.discard') }}
            </button>
          </div>
        </div>
        <template v-else>
          {{ time }}<template v-if="message.is_edited"> · {{ t('message.edited') }}</template>
        </template>
      </div>
    </div>

    <MessageActionSheet :open="sheetOpen" :actions="actions" @close="sheetOpen = false" @run="run" />
  </li>
</template>
