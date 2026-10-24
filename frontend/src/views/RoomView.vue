<script setup lang="ts">
import { LoaderCircle } from 'lucide-vue-next'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import CallOver from '@/components/call/CallOver.vue'
import CallScreen from '@/components/call/CallScreen.vue'
import PreJoin from '@/components/call/PreJoin.vue'
import ErrorState from '@/components/common/ErrorState.vue'
import Skeleton from '@/components/common/Skeleton.vue'
import { useAuthStore } from '@/stores/auth'
import { useCallStore } from '@/stores/call'
import { useUiStore } from '@/stores/ui'
import { errorMessage } from '@/utils/errorMessage'

/** `/rooms/:id`: the pre-join screen, the waiting room, the call, or why it is over. */
const { t } = useI18n()
const route = useRoute()
const auth = useAuthStore()
const call = useCallStore()
const ui = useUiStore()

const roomId = computed(() => String(route.params.id ?? ''))
/** Joining again by itself after a reload (shown as "Joining the meeting again…" instead of the pre-join screen). */
const autoJoining = ref(false)

async function openRoom(id: string): Promise<void> {
  // Development builds only: `?demo=4` shows the call screen with sample people (not in production builds at all).
  if (import.meta.env.DEV && Number(route.query.demo) > 0 && auth.user) {
    const { startCallDemo } = await import('@/mocks/callDemo')
    await call.close()
    startCallDemo(call, Number(route.query.demo), auth.user)
    return
  }

  await call.open(id)
  // Reloaded during the call: join again straight away, with the microphone and camera as they were.
  const resume = call.resume
  if (call.phase !== 'prejoin' || !resume) return
  autoJoining.value = true
  try {
    await call.join({ micOn: resume.micOn, cameraOn: resume.cameraOn })
  } finally {
    autoJoining.value = false
  }
}

watch(roomId, (id) => void openRoom(id), { immediate: true })
watch(
  () => call.inCall,
  (inCall) => {
    ui.callOpen = inCall
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  ui.callOpen = false
  void call.close()
})

/**
 * A reload during the call: "Joining the meeting again…" from the very start (the note is there before the room has even
 * loaded), so the pre-join screen does not flash up and open the camera. Without the note (it is written only once in a
 * call), or once a problem is shown, the pre-join screen as usual.
 */
const rejoining = computed(() => (autoJoining.value || call.resume !== null) && call.problem === null && !call.inCall)
</script>

<template>
  <div v-if="call.phase === 'idle' || call.phase === 'loading'" class="mx-auto flex max-w-5xl flex-col gap-4 p-4 md:p-8" role="status">
    <span class="sr-only">{{ t('common.loading') }}</span>
    <Skeleton class="aspect-video w-full rounded-xl lg:w-2/3" />
    <Skeleton class="h-6 w-56" />
    <Skeleton class="h-4 w-40" />
  </div>

  <ErrorState v-else-if="call.phase === 'load-failed'" :message="call.loadError ? errorMessage(call.loadError, t) : t('call.loadFailed')" @retry="openRoom(roomId)" />

  <CallOver v-else-if="call.phase === 'over' && call.overReason" :reason="call.overReason" @rejoin="openRoom(roomId)" />

  <CallScreen v-else-if="call.inCall" />

  <div v-else-if="rejoining" class="flex flex-col items-center gap-3 px-6 py-16 text-center" role="status">
    <LoaderCircle class="size-7 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
    <p class="text-text">{{ t('call.prejoin.rejoining') }}</p>
  </div>

  <PreJoin v-else-if="call.room" :room="call.room" />
</template>
