<script setup lang="ts">
import { Video } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'

import EmptyState from '@/components/common/EmptyState.vue'

const { t } = useI18n()
</script>

<template>
  <div class="mx-auto max-w-2xl p-4 md:p-8">
    <h1 class="sr-only">{{ t('nav.meetings') }}</h1>
    <EmptyState :icon="Video" :title="t('placeholders.meetingsTitle')" :text="t('placeholders.meetingsText')" />
  </div>
</template>
