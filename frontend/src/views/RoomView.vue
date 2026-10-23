<script setup lang="ts">
import { ArrowLeft, Video } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'

import EmptyState from '@/components/common/EmptyState.vue'

const { t } = useI18n()
</script>

<template>
  <div class="mx-auto max-w-2xl">
    <header class="flex items-center gap-2 border-b border-border px-2 py-2">
      <RouterLink
        to="/rooms"
        class="flex size-11 items-center justify-center rounded-lg text-text transition-colors duration-150 hover:bg-surface"
        :aria-label="t('common.back')"
      >
        <ArrowLeft class="size-5" aria-hidden="true" />
      </RouterLink>
      <h1 class="font-semibold">{{ t('placeholders.roomTitle') }}</h1>
    </header>
    <EmptyState :icon="Video" :title="t('placeholders.roomTitle')" :text="t('placeholders.roomText')" />
  </div>
</template>
