<script setup lang="ts">
import { CircleSlash, LogOut, PhoneOff, Video } from 'lucide-vue-next'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

import BaseButton from '@/components/common/BaseButton.vue'
import type { CallOverReason } from '@/types/call'

const props = defineProps<{ reason: CallOverReason }>()
defineEmits<{ rejoin: [] }>()

const { t } = useI18n()

const TITLES: Record<CallOverReason, string> = {
  ended: 'call.over.ended',
  left: 'call.over.left',
  removed: 'call.over.removed',
  denied: 'call.over.denied',
  forbidden: 'call.over.forbidden',
  'not-found': 'call.over.notFound',
  elsewhere: 'call.over.elsewhere',
}

/** Only after leaving yourself (or from another tab) is there a way back in. */
const canRejoin = computed(() => props.reason === 'left' || props.reason === 'elsewhere')
const icon = computed(() => (props.reason === 'left' ? LogOut : props.reason === 'ended' ? PhoneOff : props.reason === 'elsewhere' ? Video : CircleSlash))
</script>

<template>
  <div class="flex flex-col items-center gap-3 px-6 py-16 text-center" role="status">
    <span class="flex size-14 items-center justify-center rounded-xl bg-primary-soft text-primary">
      <component :is="icon" class="size-7" aria-hidden="true" />
    </span>
    <h1 class="text-lg font-semibold text-text">{{ t(TITLES[reason]) }}</h1>
    <p v-if="reason === 'elsewhere'" class="max-w-sm text-text-muted">{{ t('call.over.elsewhereText') }}</p>
    <div class="mt-2 flex flex-wrap justify-center gap-2">
      <BaseButton v-if="canRejoin" @click="$emit('rejoin')">{{ t('call.over.rejoin') }}</BaseButton>
      <RouterLink
        to="/rooms"
        class="inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium text-text transition-colors duration-150 hover:bg-surface"
      >
        {{ t('call.over.back') }}
      </RouterLink>
    </div>
  </div>
</template>
