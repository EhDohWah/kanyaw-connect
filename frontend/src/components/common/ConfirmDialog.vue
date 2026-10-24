<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import BaseButton from '@/components/common/BaseButton.vue'
import Modal from '@/components/common/Modal.vue'

defineProps<{
  open: boolean
  title: string
  text?: string
  confirmLabel: string
  /** The confirm button is red: for things that cannot be undone. */
  danger?: boolean
  busy?: boolean
  error?: string
}>()
const emit = defineEmits<{ confirm: []; cancel: [] }>()

const { t } = useI18n()
</script>

<template>
  <Modal :open="open" :title="title" @close="emit('cancel')">
    <p v-if="text" class="text-text">{{ text }}</p>
    <p v-if="error" class="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{{ error }}</p>
    <div class="mt-5 flex flex-wrap justify-end gap-2">
      <BaseButton variant="ghost" :disabled="busy" @click="emit('cancel')">{{ t('common.cancel') }}</BaseButton>
      <BaseButton :variant="danger ? 'danger' : 'primary'" :loading="busy" @click="emit('confirm')">{{ confirmLabel }}</BaseButton>
    </div>
  </Modal>
</template>
