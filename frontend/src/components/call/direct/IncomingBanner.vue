<script setup lang="ts">
import { Phone, PhoneOff } from 'lucide-vue-next'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import UserAvatar from '@/components/common/UserAvatar.vue'
import { useDirectCallStore } from '@/stores/directCall'

/**
 * A call coming in where a full screen would be wrong: during a group meeting (Decline, or leave the meeting and
 * answer), or in a tab that is not the one ringing (the call can still be answered here).
 */
const { t } = useI18n()
const call = useDirectCallStore()
const router = useRouter()

const name = computed(() => call.peer?.name ?? t('directCall.someone'))
const detail = computed(() => {
  if (call.inMeeting) return t('directCall.banner.inMeeting')
  if (!call.ringsHere) return t('directCall.banner.otherTab')
  return call.kind === 'video' ? t('directCall.incomingVideo') : t('directCall.incomingVoice')
})
const accepting = computed(() => call.phase === 'accepting')

/** Leaving the meeting page ends the meeting (as Leave does); then the call is answered over the caller's chat. */
async function leaveAndAnswer(): Promise<void> {
  const chatId = call.call?.chat_id
  if (chatId) await router.push({ name: 'chat', params: { id: chatId } })
  await call.accept()
}
</script>

<template>
  <div
    class="fixed inset-x-2 top-2 z-[60] mx-auto flex max-w-lg flex-wrap items-center gap-3 rounded-xl border border-border bg-bg p-3 text-text shadow-lg sm:flex-nowrap"
    role="alertdialog"
    :aria-label="t('directCall.banner.calling', { name })"
  >
    <UserAvatar :name="name" :src="call.peer?.avatar_thumb_url" :seed="call.peer?.id" />
    <div class="min-w-0 flex-1">
      <p class="truncate font-semibold">{{ t('directCall.banner.calling', { name }) }}</p>
      <p class="truncate text-sm text-text-muted">{{ detail }}</p>
    </div>
    <div class="flex shrink-0 gap-2">
      <button
        type="button"
        class="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-danger px-3 text-sm font-medium text-on-primary hover:opacity-90 disabled:opacity-60"
        :disabled="accepting"
        @click="call.decline()"
      >
        <PhoneOff class="size-4" aria-hidden="true" />{{ t('directCall.decline') }}
      </button>
      <button
        type="button"
        class="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-success px-3 text-sm font-medium text-on-primary hover:opacity-90 disabled:opacity-60"
        :disabled="accepting"
        @click="call.inMeeting ? leaveAndAnswer() : call.accept()"
      >
        <Phone class="size-4" aria-hidden="true" />{{ call.inMeeting ? t('directCall.banner.leaveAndAnswer') : t('directCall.accept') }}
      </button>
    </div>
  </div>
</template>
