<script setup lang="ts">
import { SendHorizontal } from 'lucide-vue-next'
import { nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import LinkifiedText from '@/components/chat/LinkifiedText.vue'
import { useMediaQuery } from '@/composables/useMediaQuery'
import { CHAT_MAX_LENGTH } from '@/realtime/callSession'
import { useAuthStore } from '@/stores/auth'
import { useCallStore } from '@/stores/call'
import { formatClock } from '@/utils/dates'

const { t, locale } = useI18n()
const auth = useAuthStore()
const call = useCallStore()
const finePointer = useMediaQuery('(pointer: fine)')

const text = ref('')
const sending = ref(false)
const failed = ref(false)
const list = ref<HTMLElement | null>(null)

// New messages: keep the newest in view.
watch(
  () => call.messages.length,
  async () => {
    await nextTick()
    if (list.value) list.value.scrollTop = list.value.scrollHeight
  },
  { immediate: true },
)

async function send(): Promise<void> {
  if (sending.value || !text.value.trim()) return
  sending.value = true
  failed.value = false
  const ok = await call.sendChat(text.value)
  sending.value = false
  if (ok) text.value = ''
  else failed.value = true
}

/** Enter sends with a keyboard and mouse (never while a word is being composed); on a phone the button sends. */
function onKey(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing || !finePointer.value) return
  event.preventDefault()
  void send()
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <p class="px-4 pt-3 text-sm text-on-call-muted">{{ t('call.chat.note') }}</p>
    <ol ref="list" class="min-h-0 flex-1 overflow-y-auto px-4 py-3" aria-live="polite">
      <li v-if="call.messages.length === 0" class="py-6 text-center text-sm text-on-call-muted">{{ t('call.chat.empty') }}</li>
      <li v-for="message in call.messages" :key="message.id" class="mb-3">
        <p class="text-xs text-on-call-muted">
          <span class="font-semibold text-on-call">{{ message.mine ? t('call.participants.you') : message.name }}</span>
          · <time :datetime="new Date(message.at).toISOString()">{{ formatClock(new Date(message.at).toISOString(), auth.user?.timezone ?? 'UTC', locale) }}</time>
        </p>
        <p class="break-words whitespace-pre-line text-on-call"><LinkifiedText :text="message.text" own /></p>
      </li>
    </ol>
    <form class="flex items-end gap-2 border-t border-call-raised p-3" @submit.prevent="send">
      <label for="call-chat-box" class="sr-only">{{ t('call.chat.label') }}</label>
      <textarea
        id="call-chat-box"
        v-model="text"
        rows="1"
        :maxlength="CHAT_MAX_LENGTH"
        :placeholder="t('call.chat.label')"
        class="max-h-32 min-h-11 flex-1 resize-none rounded-lg border border-call-raised bg-call-surface px-3 py-2.5 text-on-call placeholder:text-on-call-muted"
        @keydown="onKey"
      />
      <button
        type="submit"
        class="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary text-on-primary hover:bg-primary-hover disabled:opacity-50"
        :disabled="sending || !text.trim()"
        :aria-label="t('call.chat.send')"
      >
        <SendHorizontal class="size-5" aria-hidden="true" />
      </button>
    </form>
    <p v-if="failed" class="px-3 pb-3 text-sm text-on-call-danger" role="alert">{{ t('call.chat.failed') }}</p>
  </div>
</template>
