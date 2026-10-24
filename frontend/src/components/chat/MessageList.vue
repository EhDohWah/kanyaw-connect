<script setup lang="ts">
import { ArrowDown, MessageCircle } from 'lucide-vue-next'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import MessageRow from '@/components/chat/MessageRow.vue'
import SystemNotice from '@/components/chat/SystemNotice.vue'
import BaseButton from '@/components/common/BaseButton.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import { useNow } from '@/composables/useNow'
import { useAuthStore } from '@/stores/auth'
import type { ApiError } from '@/api/errors'
import type { Chat, TimelineMessage } from '@/types/chat'
import { formatDayLabel } from '@/utils/dates'
import { errorMessage } from '@/utils/errorMessage'
import type { MessageActionKey } from '@/utils/messageActions'
import { buildTimeline } from '@/utils/timeline'

const props = defineProps<{
  chat: Chat
  messages: TimelineMessage[]
  hasOlder: boolean
  loadingOlder: boolean
  olderError: ApiError | null
}>()
const emit = defineEmits<{
  loadOlder: []
  atBottom: [value: boolean]
  action: [key: MessageActionKey, messageId: string]
  retry: [clientId: string]
  discard: [clientId: string]
  openImage: [messageId: string]
  expired: [messageId: string]
}>()

const { t, locale } = useI18n()
const auth = useAuthStore()
const now = useNow()

const scroller = ref<HTMLElement | null>(null)
const topSentinel = ref<HTMLElement | null>(null)
const atBottom = ref(true)
const unseen = ref(0)
/** Where the view was before older messages were added on top, so it can be put back and not jump. */
let anchor: { height: number; top: number } | null = null
let observer: IntersectionObserver | null = null

const NEAR_BOTTOM_PX = 80

const items = computed(() =>
  buildTimeline(props.messages, { meId: auth.user?.id ?? '', timeZone: auth.user?.timezone ?? 'UTC' }),
)

function dayLabel(iso: string): string {
  return formatDayLabel(iso, now.value, auth.user?.timezone ?? 'UTC', locale.value, {
    today: t('chat.conversation.today'),
    yesterday: t('chat.conversation.yesterday'),
  })
}

function scrollToBottom(): void {
  const el = scroller.value
  if (!el) return
  el.scrollTop = el.scrollHeight
  unseen.value = 0
}

function onScroll(): void {
  const el = scroller.value
  if (!el) return
  const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
  if (near !== atBottom.value) {
    atBottom.value = near
    emit('atBottom', near)
  }
  if (near) unseen.value = 0
}

function requestOlder(): void {
  const el = scroller.value
  if (!props.hasOlder || props.loadingOlder || !el) return
  anchor = { height: el.scrollHeight, top: el.scrollTop }
  emit('loadOlder')
}

// What changed at the ends of the list decides how to scroll: older messages added on top keep the view where it
// was; a new message at the end scrolls down if the person is at the end (or wrote it) and otherwise counts as unseen.
watch(
  () => [props.messages[0]?.id, props.messages[props.messages.length - 1]?.id, props.messages.length] as const,
  async ([firstId, lastId, length], [prevFirst, prevLast, prevLength]) => {
    const wasAtBottom = atBottom.value
    await nextTick()
    const el = scroller.value
    if (!el) return

    if (prevLength === 0 || prevLength === undefined) {
      scrollToBottom()
      return
    }

    if (anchor && firstId !== prevFirst) {
      el.scrollTop = el.scrollHeight - anchor.height + anchor.top
      anchor = null
      return
    }

    if (lastId !== prevLast && length > prevLength) {
      const newest = props.messages[props.messages.length - 1]
      if (wasAtBottom || newest?.sender_id === auth.user?.id) scrollToBottom()
      else unseen.value += length - prevLength
    }
  },
)

onMounted(() => {
  void nextTick(scrollToBottom)

  if (typeof IntersectionObserver === 'undefined' || !topSentinel.value) return
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting) && !props.olderError) requestOlder()
    },
    { root: scroller.value, rootMargin: '120px 0px 0px 0px' },
  )
  observer.observe(topSentinel.value)
})
onBeforeUnmount(() => observer?.disconnect())

defineExpose({ scrollToBottom })
</script>

<template>
  <div class="relative min-h-0 flex-1">
    <div ref="scroller" class="flex h-full flex-col overflow-y-auto overscroll-contain px-3 py-3" @scroll.passive="onScroll">
      <div ref="topSentinel" class="shrink-0" />

      <div v-if="hasOlder || olderError" class="mb-3 flex flex-col items-center gap-2 text-center">
        <p v-if="olderError" class="text-sm text-danger" role="alert">{{ t('chat.conversation.olderError') }}</p>
        <BaseButton variant="secondary" :loading="loadingOlder" @click="requestOlder">
          {{ loadingOlder ? t('chat.conversation.loadingOlder') : t('chat.conversation.loadOlder') }}
        </BaseButton>
      </div>

      <EmptyState
        v-if="messages.length === 0 && !hasOlder"
        class="my-auto"
        :icon="MessageCircle"
        :title="t('chat.conversation.emptyTitle')"
        :text="t('chat.conversation.emptyText')"
      />

      <ol v-else class="mt-auto" :aria-label="t('chat.conversation.messages')">
        <template v-for="item in items" :key="item.key">
          <li v-if="item.kind === 'day'" class="my-3 text-center text-xs font-medium text-text-muted">
            {{ dayLabel(item.iso) }}
          </li>
          <SystemNotice v-else-if="item.kind === 'system'" :message="item.message" :chat="chat" />
          <MessageRow
            v-else
            :item="item"
            :chat="chat"
            @action="(key, id) => emit('action', key, id)"
            @retry="emit('retry', $event)"
            @discard="emit('discard', $event)"
            @open-image="emit('openImage', $event)"
            @expired="emit('expired', $event)"
          />
        </template>
      </ol>
    </div>

    <!-- Scrolled up while something new arrived (or just scrolled up): one tap back to the end. A floating element. -->
    <button
      v-if="!atBottom"
      type="button"
      class="absolute bottom-3 right-3 flex min-h-11 items-center gap-2 rounded-lg border border-border bg-bg px-3 text-sm font-medium text-text shadow-md transition-colors duration-150 hover:bg-surface"
      @click="scrollToBottom"
    >
      <ArrowDown class="size-4" aria-hidden="true" />
      {{ unseen > 0 ? t('chat.conversation.newMessages', { count: unseen }) : t('chat.conversation.jumpToLatest') }}
    </button>
  </div>
</template>
