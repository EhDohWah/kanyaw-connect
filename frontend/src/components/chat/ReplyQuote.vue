<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { ReplyPreview } from '@/types/chat'

const props = defineProps<{ reply: ReplyPreview; senderName: string; own?: boolean }>()

const { t } = useI18n()

const text = computed(() => {
  if (props.reply.is_deleted) return t('message.deletedOriginal')
  if (props.reply.content) return props.reply.content
  return { image: t('chat.preview.photo'), voice: t('chat.preview.voice'), file: t('chat.preview.file') }[
    props.reply.type as 'image' | 'voice' | 'file'
  ] ?? ''
})
</script>

<template>
  <div :class="['mb-1.5 rounded-lg border-l-4 px-2 py-1 text-sm', own ? 'border-on-primary bg-primary-hover' : 'border-primary bg-bg']">
    <p :class="['truncate text-xs font-semibold', own ? 'text-on-primary' : 'text-primary']">{{ senderName }}</p>
    <p :class="['line-clamp-2 break-words', reply.is_deleted ? 'italic' : '', own ? 'text-on-primary' : 'text-text']">{{ text }}</p>
  </div>
</template>
