<script setup lang="ts">
import { TriangleAlert } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'

import BaseButton from '@/components/common/BaseButton.vue'

defineProps<{ message: string; retrying?: boolean }>()
defineEmits<{ retry: [] }>()

const { t } = useI18n()
</script>

<template>
  <div class="flex flex-col items-center gap-3 px-6 py-16 text-center" role="alert">
    <span class="flex size-14 items-center justify-center rounded-xl bg-danger-soft text-danger">
      <TriangleAlert class="size-7" aria-hidden="true" />
    </span>
    <p class="max-w-sm text-text">{{ message }}</p>
    <BaseButton variant="secondary" :loading="retrying" @click="$emit('retry')">{{ t('common.retry') }}</BaseButton>
  </div>
</template>
