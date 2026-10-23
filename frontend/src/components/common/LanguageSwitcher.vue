<script setup lang="ts">
import { Globe } from 'lucide-vue-next'
import { useId } from 'vue'
import { useI18n } from 'vue-i18n'

import { isApiError } from '@/api/errors'
import { LOCALES, isAppLocale } from '@/i18n'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { errorMessage } from '@/utils/errorMessage'

/** `compact` is the small picker on the sign-in screens; otherwise it is a labelled form field. */
const props = defineProps<{ compact?: boolean }>()

const { t, locale } = useI18n()
const auth = useAuthStore()
const ui = useUiStore()
const id = useId()

async function onChange(event: Event): Promise<void> {
  const value = (event.target as HTMLSelectElement).value
  if (!isAppLocale(value)) return

  try {
    await auth.changeLocale(value)
  } catch (error) {
    // The language already changed on this device; only remembering it on the account failed.
    if (isApiError(error)) ui.toast(errorMessage(error, t), 'error')
  }
}
</script>

<template>
  <div :class="props.compact ? 'relative inline-flex items-center' : 'flex flex-col gap-1.5'">
    <label :for="id" :class="props.compact ? 'sr-only' : 'text-sm font-medium text-text'">
      {{ t('common.language') }}
    </label>
    <Globe
      v-if="props.compact"
      class="pointer-events-none absolute left-3 size-4 text-text-muted"
      aria-hidden="true"
    />
    <select
      :id="id"
      :value="locale"
      :class="[
        'min-h-11 rounded-lg border border-border bg-bg text-text transition-colors duration-150 hover:border-text-muted',
        props.compact ? 'pl-9 pr-3 text-sm' : 'w-full px-3',
      ]"
      @change="onChange"
    >
      <option v-for="code in LOCALES" :key="code" :value="code">{{ t(`languages.${code}`) }}</option>
    </select>
  </div>
</template>
