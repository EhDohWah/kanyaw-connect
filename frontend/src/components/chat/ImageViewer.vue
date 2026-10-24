<script setup lang="ts">
import { Download } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'

import Modal from '@/components/common/Modal.vue'
import type { Attachment } from '@/types/chat'

defineProps<{ open: boolean; attachment: Attachment | null; caption?: string | null }>()
defineEmits<{ close: [] }>()

const { t } = useI18n()
</script>

<template>
  <Modal :open="open && attachment !== null" :title="t('chat.viewer.title')" @close="$emit('close')">
    <figure v-if="attachment" class="flex flex-col items-center gap-3">
      <!-- The full-size picture, not the thumbnail. -->
      <img :src="attachment.url" :alt="caption || attachment.original_name" class="max-h-[70dvh] w-auto max-w-full rounded-lg object-contain" />
      <figcaption v-if="caption" class="text-center text-text">{{ caption }}</figcaption>
      <a
        :href="attachment.url"
        :download="attachment.original_name"
        target="_blank"
        rel="noopener"
        class="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 text-sm font-medium text-text transition-colors duration-150 hover:bg-surface"
      >
        <Download class="size-4" aria-hidden="true" />{{ t('chat.viewer.download') }}
      </a>
    </figure>
  </Modal>
</template>
