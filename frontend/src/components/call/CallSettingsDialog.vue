<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import BaseSelect, { type SelectOption } from '@/components/common/BaseSelect.vue'
import BaseSwitch from '@/components/common/BaseSwitch.vue'
import Modal from '@/components/common/Modal.vue'
import { listDevices } from '@/realtime/localMedia'
import { useCallStore } from '@/stores/call'

/** During the call: data saver, and which camera and microphone to use. */
const props = defineProps<{ open: boolean }>()
defineEmits<{ close: [] }>()

const { t } = useI18n()
const call = useCallStore()
const cameras = ref<SelectOption[]>([])
const microphones = ref<SelectOption[]>([])
const cameraId = ref('')
const microphoneId = ref('')

const options = (devices: MediaDeviceInfo[]): SelectOption[] => devices.filter((device) => device.label).map((device) => ({ value: device.deviceId, label: device.label }))

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    cameraId.value = call.activeDevice('videoinput') ?? ''
    microphoneId.value = call.activeDevice('audioinput') ?? ''
    try {
      const [videoInputs, audioInputs] = await Promise.all([listDevices('videoinput'), listDevices('audioinput')])
      cameras.value = options(videoInputs)
      microphones.value = options(audioInputs)
    } catch {
      // no lists: the switches still work
    }
  },
)

async function choose(kind: 'videoinput' | 'audioinput', deviceId: string): Promise<void> {
  if (kind === 'videoinput') cameraId.value = deviceId
  else microphoneId.value = deviceId
  await call.switchDevice(kind, deviceId).catch(() => undefined)
}
</script>

<template>
  <Modal :open="open" :title="t('call.toolbar.settingsTitle')" @close="$emit('close')">
    <div class="flex flex-col gap-4">
      <BaseSwitch :model-value="call.dataSaver" :label="t('call.toolbar.dataSaver')" :hint="t('call.toolbar.dataSaverHint')" @update:model-value="call.setDataSaver" />
      <BaseSelect v-if="cameras.length > 1" :model-value="cameraId" :label="t('call.prejoin.camera')" :options="cameras" @update:model-value="choose('videoinput', $event)" />
      <BaseSelect
        v-if="microphones.length > 1"
        :model-value="microphoneId"
        :label="t('call.prejoin.microphone')"
        :options="microphones"
        @update:model-value="choose('audioinput', $event)"
      />
    </div>
  </Modal>
</template>
