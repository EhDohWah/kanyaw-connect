<script setup lang="ts">
import { Phone } from 'lucide-vue-next'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useCallClock } from '@/composables/useCallClock'
import { useDirectCallStore } from '@/stores/directCall'

/** While you move around the app during a call: who, how long, and the way back. */
const { t } = useI18n()
const call = useDirectCallStore()

const name = computed(() => call.peer?.name ?? t('directCall.someone'))
const clock = useCallClock(computed(() => (call.phase === 'active' ? call.call?.answered_at : null)))
const status = computed(() => {
  if (call.reconnecting) return t('directCall.reconnecting')
  if (call.phase === 'ringing' || call.phase === 'starting') return t('directCall.calling')
  if (call.phase === 'connecting' || call.phase === 'accepting') return t('directCall.connecting')
  return clock.value ?? ''
})
</script>

<template>
  <div class="fixed inset-x-0 top-0 z-50 flex h-11 items-center gap-2 bg-success px-3 pt-[env(safe-area-inset-top)] text-sm text-on-primary shadow-md" role="region" :aria-label="t('directCall.ongoingBar', { name })">
    <Phone class="size-4 shrink-0" aria-hidden="true" />
    <p class="min-w-0 flex-1 truncate">
      <span class="font-semibold">{{ name }}</span>
      <span class="tabular-nums" role="status"> · {{ status }}</span>
    </p>
    <button type="button" class="min-h-9 shrink-0 rounded-md bg-on-primary/15 px-3 font-medium hover:bg-on-primary/25" @click="call.expand()">
      {{ t('directCall.returnToCall') }}
    </button>
  </div>
</template>
