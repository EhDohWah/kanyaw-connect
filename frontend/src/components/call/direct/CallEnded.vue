<script setup lang="ts">
import { Mic, Phone, PhoneOff, Video, X } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import UserAvatar from '@/components/common/UserAvatar.vue'
import { useDirectCallStore } from '@/stores/directCall'
import { useUiStore } from '@/stores/ui'
import { endingKey } from '@/utils/callOutcome'
import { formatDuration } from '@/utils/dates'

/**
 * Why the call is over: "Call ended · 3:12" for a moment, or (when they did not pick up) the choice to call again or
 * leave a voice message instead.
 */
const { t } = useI18n()
const call = useDirectCallStore()
const ui = useUiStore()
const router = useRouter()

const name = computed(() => call.peer?.name ?? t('directCall.someone'))
const message = computed(() => {
  const ending = call.ending
  if (!ending) return ''
  const key = endingKey(ending, call.direction)
  if (key === 'hungUp' && call.endedSeconds !== null) return t('directCall.ended.hungUpTime', { time: formatDuration(call.endedSeconds * 1000) })
  return t(`directCall.ended.${key}`, { name: name.value })
})
const offerMore = computed(() => call.closing?.callAgain === true)

/** Opens the chat with the recorder already started (6A). */
async function sendVoiceMessage(): Promise<void> {
  const chatId = call.chatId
  call.dismiss()
  if (!chatId) return
  ui.recordVoiceIn = chatId
  await router.push({ name: 'chat', params: { id: chatId } })
}

const first = ref<HTMLElement | null>(null)
onMounted(() => first.value?.querySelector('button')?.focus())
</script>

<template>
  <div class="flex h-full flex-col items-center justify-center gap-6 px-6 text-center">
    <UserAvatar :name="name" :src="call.peer?.avatar_thumb_url" :seed="call.peer?.id" size="xl" />
    <div class="flex flex-col items-center gap-2">
      <h2 class="text-2xl font-semibold">{{ name }}</h2>
      <p class="flex items-center gap-2 text-on-call-muted" role="status">
        <PhoneOff class="size-4" aria-hidden="true" />{{ message }}
      </p>
    </div>

    <div v-if="offerMore" ref="first" class="flex w-full max-w-xs flex-col gap-3">
      <button
        type="button"
        class="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-success px-4 font-medium text-on-primary hover:opacity-90"
        @click="call.callAgain()"
      >
        <component :is="call.kind === 'video' ? Video : Phone" class="size-5" aria-hidden="true" />{{ t('directCall.callAgain') }}
      </button>
      <button
        type="button"
        class="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-call-raised px-4 font-medium text-on-call hover:bg-call-surface"
        @click="sendVoiceMessage"
      >
        <Mic class="size-5" aria-hidden="true" />{{ t('directCall.sendVoiceMessage') }}
      </button>
      <button
        type="button"
        class="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg px-4 font-medium text-on-call hover:bg-call-raised"
        @click="call.dismiss()"
      >
        <X class="size-5" aria-hidden="true" />{{ t('directCall.close') }}
      </button>
    </div>
  </div>
</template>
