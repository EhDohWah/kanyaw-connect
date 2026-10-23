<script setup lang="ts">
import { SearchX } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'

import EmptyState from '@/components/common/EmptyState.vue'

const { t } = useI18n()
</script>

<template>
  <div class="mx-auto max-w-2xl p-4 md:p-8">
    <EmptyState :icon="SearchX" :title="t('notFound.title')" :text="t('notFound.text')">
      <RouterLink
        to="/"
        class="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-on-primary transition-colors duration-150 hover:bg-primary-hover"
      >
        {{ t('notFound.home') }}
      </RouterLink>
    </EmptyState>
  </div>
</template>
