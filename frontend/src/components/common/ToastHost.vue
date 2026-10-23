<script setup lang="ts">
// The live region is always in the page, so a message added later is announced.
import { CircleAlert, CircleCheck, X } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'

import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const { t } = useI18n()
</script>

<template>
  <div
    class="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6"
    aria-live="polite"
  >
    <TransitionGroup
      enter-active-class="transition duration-200 ease-out"
      leave-active-class="transition duration-150 ease-in"
      enter-from-class="translate-y-2 opacity-0"
      leave-to-class="opacity-0"
    >
      <div
        v-for="toast in ui.toasts"
        :key="toast.id"
        class="pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-xl border border-border bg-bg py-2 pl-4 pr-2 shadow-md"
        role="status"
      >
        <CircleAlert v-if="toast.kind === 'error'" class="size-5 shrink-0 text-danger" aria-hidden="true" />
        <CircleCheck v-else class="size-5 shrink-0 text-success" aria-hidden="true" />
        <p class="flex-1 text-sm text-text">{{ toast.message }}</p>
        <button
          type="button"
          class="flex size-11 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors duration-150 hover:bg-surface hover:text-text"
          :aria-label="t('common.dismiss')"
          @click="ui.dismissToast(toast.id)"
        >
          <X class="size-4" aria-hidden="true" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>
