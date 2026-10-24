<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import BaseButton from '@/components/common/BaseButton.vue'
import Modal from '@/components/common/Modal.vue'
import { useCallStore } from '@/stores/call'
import { useUiStore } from '@/stores/ui'

/** For the host: leave (the meeting carries on), or end it for everyone (asked twice: it cannot be undone). */
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const call = useCallStore()
const ui = useUiStore()
const confirming = ref(false)
const ending = ref(false)

watch(
  () => props.open,
  (open) => {
    if (open) confirming.value = false
  },
)

function leave(): void {
  emit('close')
  call.leave()
}

async function end(): Promise<void> {
  if (ending.value) return
  ending.value = true
  try {
    await call.endForEveryone()
    emit('close')
  } catch {
    ui.toast(t('call.toolbar.endFailed'), 'error')
  } finally {
    ending.value = false
  }
}
</script>

<template>
  <Modal :open="open" :title="confirming ? t('call.toolbar.endTitle') : t('call.toolbar.leave')" @close="$emit('close')">
    <div v-if="confirming" class="flex flex-col gap-3">
      <p class="text-text">{{ t('call.toolbar.endText') }}</p>
      <BaseButton variant="danger" block :loading="ending" @click="end">{{ ending ? t('call.toolbar.ending') : t('call.toolbar.endForAll') }}</BaseButton>
      <BaseButton variant="secondary" block @click="confirming = false">{{ t('common.cancel') }}</BaseButton>
    </div>
    <div v-else class="flex flex-col gap-3">
      <BaseButton variant="secondary" block @click="leave">{{ t('call.toolbar.leaveMeeting') }}</BaseButton>
      <BaseButton variant="danger" block @click="confirming = true">{{ t('call.toolbar.endForAll') }}</BaseButton>
    </div>
  </Modal>
</template>
