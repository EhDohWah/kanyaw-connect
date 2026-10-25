<script setup lang="ts">
import { LoaderCircle, PhoneOff } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import BaseButton from '@/components/common/BaseButton.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import { useDirectCallStore } from '@/stores/directCall'

/**
 * `/calls/:id`: where a call notification lands, and where a reload during a call comes back to. It hands the call to
 * the call overlay (which draws it), then goes on to the chat once the call is over. `?answer=1` (the notification's
 * Answer button) answers it straight away if it is still ringing.
 */
const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const call = useDirectCallStore()

const callId = computed(() => String(route.params.id ?? ''))
const missing = ref(false)
let chatId: string | null = null

async function open(id: string): Promise<void> {
  missing.value = false
  const found = await call.openCall(id, { answer: route.query.answer === '1' })
  if (!found) {
    missing.value = true
    return
  }
  chatId = found.chat_id
  // Nothing to show (it is over, or another tab of this browser has it): go on to the chat.
  if (!call.visible) await leave()
}

async function leave(): Promise<void> {
  if (route.name !== 'call') return
  await router.replace(chatId ? { name: 'chat', params: { id: chatId } } : { name: 'chats' })
}

watch(callId, (id) => void open(id), { immediate: true })
// The call is over and its closing screen is gone: the chat is where it happened.
watch(
  () => call.visible,
  (visible) => {
    if (!visible && chatId) void leave()
  },
)
</script>

<template>
  <h1 class="sr-only">{{ t('directCall.page.title') }}</h1>
  <EmptyState v-if="missing" :icon="PhoneOff" :title="t('directCall.page.notFound')">
    <BaseButton variant="secondary" @click="router.replace({ name: 'chats' })">{{ t('chat.conversation.backToChats') }}</BaseButton>
  </EmptyState>
  <div v-else class="flex flex-col items-center gap-3 px-6 py-16 text-center" role="status">
    <LoaderCircle class="size-7 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
    <p class="text-text">{{ t('directCall.page.loading') }}</p>
  </div>
</template>
