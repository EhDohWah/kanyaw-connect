<script setup lang="ts">
import { Download } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'

import Modal from '@/components/common/Modal.vue'
import { useFreshLink } from '@/composables/useFreshLink'
import type { Attachment } from '@/types/chat'

const props = defineProps<{ open: boolean; attachment: Attachment | null; caption?: string | null }>()
const emit = defineEmits<{ close: []; expired: [] }>()

const { t } = useI18n()

// The links last an hour: a picture that fails to load, or a download whose link ran out, asks for fresh ones.
const download = useFreshLink(
  () => props.attachment?.url ?? '',
  () => props.attachment?.original_name ?? '',
  () => emit('expired'),
)
</script>

<template>
  <Modal :open="open && attachment !== null" :title="t('chat.viewer.title')" @close="$emit('close')">
    <figure v-if="attachment" class="flex flex-col items-center gap-3">
      <!-- The full-size picture, not the thumbnail. -->
      <img
        :src="attachment.url"
        :alt="caption || attachment.original_name"
        class="max-h-[70dvh] w-auto max-w-full rounded-lg object-contain"
        @error="emit('expired')"
      />
      <figcaption v-if="caption" class="text-center text-text">{{ caption }}</figcaption>
      <a
        :href="attachment.url"
        :download="attachment.original_name"
        target="_blank"
        rel="noopener"
        :aria-busy="download.waiting.value || undefined"
        class="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 text-sm font-medium text-text transition-colors duration-150 hover:bg-surface"
        @click="download.onClick"
      >
        <Download class="size-4" aria-hidden="true" />{{ t('chat.viewer.download') }}
      </a>
    </figure>
  </Modal>
</template>
