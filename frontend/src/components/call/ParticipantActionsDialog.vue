<script setup lang="ts">
import { MicOff, ShieldCheck, UserX, VideoOff } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import BaseButton from '@/components/common/BaseButton.vue'
import Modal from '@/components/common/Modal.vue'
import { useCallStore } from '@/stores/call'
import { useUiStore } from '@/stores/ui'
import type { CallParticipant } from '@/types/call'
import type { MuteKind } from '@/types/room'
import { errorMessage } from '@/utils/errorMessage'
import type { ApiError } from '@/api/errors'

/** What a host or co-host can do to one person: mute, turn off their camera, make co-host (host only), remove. */
const props = defineProps<{ person: CallParticipant | null }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const call = useCallStore()
const ui = useUiStore()
const confirmingRemove = ref(false)
const working = ref(false)

watch(
  () => props.person?.id,
  () => {
    confirmingRemove.value = false
  },
)

const canPromote = computed(() => props.person !== null && call.isHost && call.roleOf(props.person.id) === 'participant')

async function act(run: () => Promise<unknown>, success: (result: unknown) => string): Promise<void> {
  if (working.value || !props.person) return
  working.value = true
  try {
    const result = await run()
    ui.toast(success(result))
    emit('close')
  } catch (error) {
    ui.toast((error as ApiError).status ? errorMessage(error as ApiError, t) : t('call.participants.failed'), 'error')
  } finally {
    working.value = false
  }
}

function mute(kind: MuteKind): void {
  const person = props.person!
  void act(
    () => call.muteParticipant(person.id, kind),
    (muted) => (muted === 0 ? t('call.participants.alreadyMuted') : kind === 'audio' ? t('call.participants.muted', { name: person.name }) : t('call.participants.cameraStopped', { name: person.name })),
  )
}

function promote(): void {
  const person = props.person!
  void act(() => call.makeCoHost(person.id), () => t('call.participants.nowCoHost', { name: person.name }))
}

function remove(): void {
  const person = props.person!
  void act(() => call.removeParticipant(person.id), () => t('call.participants.removed', { name: person.name }))
}
</script>

<template>
  <Modal
    :open="person !== null"
    :title="person ? (confirmingRemove ? t('call.participants.removeTitle', { name: person.name }) : t('call.participants.actions', { name: person.name })) : ''"
    @close="$emit('close')"
  >
    <div v-if="person && confirmingRemove" class="flex flex-col gap-3">
      <p class="text-text">{{ t('call.participants.removeText') }}</p>
      <BaseButton variant="danger" block :loading="working" @click="remove">{{ t('call.participants.remove') }}</BaseButton>
      <BaseButton variant="secondary" block @click="confirmingRemove = false">{{ t('common.cancel') }}</BaseButton>
    </div>
    <ul v-else-if="person" class="flex flex-col gap-1">
      <li v-if="person.micOn">
        <button type="button" class="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left font-medium transition-colors duration-150 disabled:opacity-60 text-text hover:bg-surface" :disabled="working" @click="mute('audio')">
          <MicOff class="size-5" aria-hidden="true" />{{ t('call.participants.muteMicrophone') }}
        </button>
      </li>
      <li v-if="person.cameraOn">
        <button type="button" class="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left font-medium transition-colors duration-150 disabled:opacity-60 text-text hover:bg-surface" :disabled="working" @click="mute('video')">
          <VideoOff class="size-5" aria-hidden="true" />{{ t('call.participants.muteCamera') }}
        </button>
      </li>
      <li v-if="canPromote">
        <button type="button" class="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left font-medium transition-colors duration-150 disabled:opacity-60 text-text hover:bg-surface" :disabled="working" @click="promote">
          <ShieldCheck class="size-5" aria-hidden="true" />{{ t('call.participants.makeCoHost') }}
        </button>
      </li>
      <li>
        <button type="button" class="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left font-medium transition-colors duration-150 disabled:opacity-60 text-danger hover:bg-danger-soft" :disabled="working" @click="confirmingRemove = true">
          <UserX class="size-5" aria-hidden="true" />{{ t('call.participants.remove') }}
        </button>
      </li>
      <li class="pt-2 text-sm text-text-muted">{{ t('call.participants.unmuteNote') }}</li>
    </ul>
  </Modal>
</template>
