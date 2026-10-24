<script setup lang="ts">
import { BellOff, Lock, Pin } from 'lucide-vue-next'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import UserAvatar from '@/components/common/UserAvatar.vue'
import { useNow } from '@/composables/useNow'
import { useAuthStore } from '@/stores/auth'
import { usePresenceStore } from '@/stores/presence'
import type { Chat } from '@/types/chat'
import { chatAvatar, chatTitle, messagePreview } from '@/utils/chatText'
import { formatListTime } from '@/utils/dates'

const props = defineProps<{ chat: Chat; active?: boolean }>()
defineEmits<{ select: [chatId: string] }>()

const { t, locale } = useI18n()
const auth = useAuthStore()
const presence = usePresenceStore()
const now = useNow()

const title = computed(() => chatTitle(props.chat, t('chat.untitled')))
const avatar = computed(() => chatAvatar(props.chat, t('chat.untitled')))
const preview = computed(() => messagePreview(props.chat, auth.user?.id ?? '', t))
const online = computed(() => props.chat.type === 'direct' && presence.isOnline(props.chat.other_user?.id))
const unread = computed(() => props.chat.unread_count)
const muted = computed(() => props.chat.my_membership.is_muted)
const pinned = computed(() => props.chat.my_membership.pin_position !== null)
const archived = computed(() => props.chat.my_membership.is_archived)

const time = computed(() => {
  const at = props.chat.latest_message?.created_at ?? props.chat.last_message_at
  if (!at) return ''
  return formatListTime(at, now.value, auth.user?.timezone ?? 'UTC', locale.value, {
    today: t('chat.conversation.today'),
    yesterday: t('chat.conversation.yesterday'),
  })
})
</script>

<template>
  <li>
    <button
      type="button"
      :class="[
        'flex min-h-[4.5rem] w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150',
        active ? 'bg-primary-soft' : 'hover:bg-surface',
      ]"
      :aria-current="active ? 'true' : undefined"
      @click="$emit('select', chat.id)"
    >
      <span class="relative shrink-0">
        <UserAvatar :name="avatar.name" :seed="avatar.seed" :src="avatar.src" size="md" />
        <span v-if="online" class="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full border-2 border-bg bg-success" aria-hidden="true" />
      </span>

      <span class="min-w-0 flex-1">
        <span class="flex items-baseline justify-between gap-2">
          <span :class="['truncate', unread > 0 ? 'font-semibold' : 'font-medium']">{{ title }}</span>
          <span v-if="online" class="sr-only">, {{ t('chat.online') }}</span>
          <span :class="['flex shrink-0 items-center gap-1 text-xs', active ? 'text-text' : 'text-text-muted']">
            <Pin v-if="pinned" class="size-3.5" aria-hidden="true" /><span v-if="pinned" class="sr-only">{{ t('chat.pinned') }}</span>
            <BellOff v-if="muted" class="size-3.5" aria-hidden="true" /><span v-if="muted" class="sr-only">{{ t('chat.muted') }}</span>
            <span v-if="archived" class="sr-only">{{ t('chat.archived') }}</span>
            {{ time }}
          </span>
        </span>

        <span class="mt-0.5 flex items-center gap-2">
          <Lock v-if="chat.is_encrypted" class="size-3.5 shrink-0 text-text-muted" aria-hidden="true" />
          <span :class="['min-w-0 flex-1 truncate text-sm', active || unread > 0 ? 'text-text' : 'text-text-muted']">
            {{ preview }}
          </span>
          <span
            v-if="unread > 0"
            :class="[
              'inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-xs font-semibold text-on-primary',
              muted ? 'bg-text-muted' : 'bg-primary',
            ]"
          >
            <span aria-hidden="true">{{ unread > 99 ? '99+' : unread }}</span>
            <span class="sr-only">{{ t('chat.unreadCount', { count: unread }) }}</span>
          </span>
        </span>
      </span>
    </button>
  </li>
</template>
