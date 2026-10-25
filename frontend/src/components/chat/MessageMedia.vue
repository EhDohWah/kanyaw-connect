<script setup lang="ts">
import { FileText, ImageOff } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import VoicePlayer from '@/components/chat/VoicePlayer.vue'
import { useFreshLink } from '@/composables/useFreshLink'
import type { Attachment, MessageType } from '@/types/chat'
import { formatBytes } from '@/utils/files'

const props = defineProps<{
  type: MessageType
  attachment: Attachment
  own?: boolean
  /** The message's id and metadata: a voice message's length and waveform are there. */
  messageId?: string
  metadata?: Record<string, unknown>
}>()
const emit = defineEmits<{ open: []; expired: [] }>()

const { t } = useI18n()
const broken = ref(false)

// Fresh links arrived (after an expired one failed): draw the picture again with them.
watch(
  () => [props.attachment.url, props.attachment.thumbnail_url],
  () => {
    broken.value = false
  },
)

/** The voice message's length and waveform, as its sender measured them; ignored when they are not what they should be. */
const durationMs = computed(() => {
  const value = props.metadata?.duration_ms
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
})
const waveform = computed(() => {
  const value = props.metadata?.waveform
  return Array.isArray(value) && value.length > 0 && value.every((bar) => typeof bar === 'number') ? (value as number[]) : null
})

const download = useFreshLink(
  () => props.attachment.url,
  () => props.attachment.original_name,
  () => emit('expired'),
)

function onError(): void {
  broken.value = true
  // The signed links last an hour: ask the server for fresh ones (at most every few minutes per message).
  emit('expired')
}
</script>

<template>
  <!-- A picture: a fixed shape, so the conversation does not jump while it loads. -->
  <button
    v-if="type === 'image'"
    type="button"
    class="block aspect-[4/3] w-64 max-w-full overflow-hidden rounded-lg bg-surface"
    :aria-label="t('message.openPhoto')"
    @click="emit('open')"
  >
    <img
      v-if="!broken"
      :src="attachment.thumbnail_url ?? attachment.url"
      :alt="attachment.original_name"
      loading="lazy"
      decoding="async"
      class="size-full object-cover"
      @error="onError"
      @load="broken = false"
    />
    <span v-else class="flex size-full flex-col items-center justify-center gap-1 text-sm text-text">
      <ImageOff class="size-6" aria-hidden="true" />{{ t('message.photoUnavailable') }}
    </span>
  </button>

  <!-- A voice message or any audio file: nothing is downloaded until play is pressed. -->
  <VoicePlayer
    v-else-if="type === 'voice'"
    :id="messageId ?? attachment.id"
    :src="attachment.url"
    :duration-ms="durationMs"
    :waveform="waveform"
    :own="own"
    :name="attachment.original_name"
    @expired="emit('expired')"
  />

  <!-- Any other file: a card that downloads it. -->
  <a
    v-else
    :href="attachment.url"
    :download="attachment.original_name"
    target="_blank"
    rel="noopener"
    :aria-label="t('message.download', { name: attachment.original_name })"
    :aria-busy="download.waiting.value || undefined"
    :class="[
      'flex min-h-11 w-64 max-w-full items-center gap-3 rounded-lg px-3 py-2',
      own ? 'bg-primary-hover text-on-primary' : 'bg-bg text-text',
    ]"
    @click="download.onClick"
  >
    <FileText class="size-6 shrink-0" aria-hidden="true" />
    <span class="min-w-0">
      <span class="block truncate text-sm font-medium">{{ attachment.original_name }}</span>
      <span class="block text-xs">{{ formatBytes(attachment.size) }}</span>
    </span>
  </a>
</template>
