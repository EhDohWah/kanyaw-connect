<script setup lang="ts">
import { LoaderCircle, Phone, PhoneOff, Volume2 } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import RoundAction from '@/components/call/direct/RoundAction.vue'
import UserAvatar from '@/components/common/UserAvatar.vue'
import { ringer } from '@/realtime/ringer'
import { useDirectCallStore } from '@/stores/directCall'

/** Someone is calling: who, what kind of call, Accept and Decline (and "Answer without video" for a video call). */
const { t } = useI18n()
const call = useDirectCallStore()

const name = computed(() => call.peer?.name ?? t('directCall.someone'))
const accepting = computed(() => call.phase === 'accepting')
const acceptButton = ref<HTMLElement | null>(null)

onMounted(() => acceptButton.value?.querySelector('button')?.focus())
</script>

<template>
  <div class="flex h-full flex-col items-center justify-between px-6 pt-[max(4rem,env(safe-area-inset-top))] pb-[max(3rem,env(safe-area-inset-bottom))] text-center">
    <div class="flex flex-col items-center gap-4">
      <span class="relative flex items-center justify-center">
        <span class="absolute inset-0 animate-ping rounded-full bg-on-call/10 motion-reduce:hidden" aria-hidden="true" />
        <UserAvatar :name="name" :src="call.peer?.avatar_thumb_url" :seed="call.peer?.id" size="xl" />
      </span>
      <h2 class="text-2xl font-semibold">{{ name }}</h2>
      <p class="text-on-call-muted" role="status">
        {{ accepting ? t('directCall.connecting') : call.kind === 'video' ? t('directCall.incomingVideo') : t('directCall.incomingVoice') }}
      </p>
      <!-- The browser will not play sound before a tap: the call still shows, and one tap brings the ringtone. -->
      <button
        v-if="ringer.blocked.value"
        type="button"
        class="inline-flex min-h-11 items-center gap-2 rounded-lg bg-call-raised px-4 text-sm font-medium text-on-call hover:bg-call-surface"
        @click="ringer.unlock()"
      >
        <Volume2 class="size-4" aria-hidden="true" />{{ t('directCall.tapToHear') }}
      </button>
    </div>

    <div class="flex flex-col items-center gap-6">
      <div class="flex items-start justify-center gap-16">
        <RoundAction :label="t('directCall.decline')" :icon="PhoneOff" tone="end" :disabled="accepting" @click="call.decline()" />
        <div ref="acceptButton">
          <RoundAction :label="t('directCall.accept')" :icon="accepting ? LoaderCircle : Phone" tone="accept" :disabled="accepting" @click="call.accept()" />
        </div>
      </div>
      <button
        v-if="call.kind === 'video'"
        type="button"
        class="min-h-11 rounded-lg px-4 text-sm font-medium text-on-call underline-offset-4 hover:underline disabled:opacity-60"
        :disabled="accepting"
        @click="call.accept(false)"
      >
        {{ t('directCall.answerWithoutVideo') }}
      </button>
    </div>
  </div>
</template>
