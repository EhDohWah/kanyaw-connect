<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import LanguageSwitcher from '@/components/common/LanguageSwitcher.vue'

defineProps<{ title: string }>()

const { t } = useI18n()
</script>

<template>
  <div class="flex min-h-dvh flex-col bg-bg text-text">
    <header class="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
      <div class="flex items-center gap-2">
        <img src="/favicon.svg" alt="" class="size-8" />
        <span class="font-semibold">{{ t('app.name') }}</span>
      </div>
      <LanguageSwitcher compact />
    </header>

    <main id="main" tabindex="-1" class="flex flex-1 items-start justify-center px-4 pb-10 pt-6 outline-none sm:items-center sm:pt-0">
      <div class="w-full max-w-sm">
        <h1 class="text-2xl font-semibold">{{ title }}</h1>
        <p class="mt-1 text-text-muted">{{ t('app.tagline') }}</p>
        <div class="mt-6"><slot /></div>
      </div>
    </main>
  </div>
</template>
