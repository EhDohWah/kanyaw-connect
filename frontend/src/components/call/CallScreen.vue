<script setup lang="ts">
import { LoaderCircle, Lock, Users, Volume2 } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import CallPanel from '@/components/call/CallPanel.vue'
import CallToolbar from '@/components/call/CallToolbar.vue'
import VideoStage from '@/components/call/VideoStage.vue'
import { useMediaQuery } from '@/composables/useMediaQuery'
import { useCallStore } from '@/stores/call'
import { useRealtimeStore } from '@/stores/realtime'

/** The dark full-screen call: the people, the toolbar, and the Participants / Chat panel. */
const { t } = useI18n()
const call = useCallStore()
const connection = useRealtimeStore()
const wide = useMediaQuery('(min-width: 1024px)')
const heading = ref<HTMLElement | null>(null)

/** On a phone the panel covers everything: what is under it is out of reach until it closes. */
const covered = computed(() => call.panel !== null && !wide.value)
/** LiveKit getting a drop back, joining again, or the browser saying there is no network (LiveKit notices only later). */
const getting = computed(() => call.reconnecting || call.phase === 'rejoining' || !connection.browserOnline)

// From the pre-join screen straight into the call: tell screen reader users where they are.
onMounted(() => heading.value?.focus())
</script>

<template>
  <div class="call-screen fixed inset-0 z-40 flex flex-col bg-call-bg text-on-call">
    <header class="flex items-center gap-3 px-4 py-2" :inert="covered || undefined">
      <h1 ref="heading" tabindex="-1" class="min-w-0 flex-1 truncate font-semibold outline-none">{{ call.room?.name }}</h1>
      <span v-if="call.room?.is_locked" class="inline-flex items-center gap-1 text-sm text-on-call-muted">
        <Lock class="size-4" aria-hidden="true" />{{ t('activity.meetings.locked') }}
      </span>
      <span class="inline-flex items-center gap-1 text-sm text-on-call-muted">
        <Users class="size-4" aria-hidden="true" /><span class="sr-only">{{ t('call.participants.title') }}:</span>{{ call.participants.length }}
      </span>
    </header>

    <div class="relative flex min-h-0 flex-1">
      <div class="relative min-w-0 flex-1" :inert="covered || undefined">
        <VideoStage :people="call.participants" :speaker-id="call.speakerId" :role-of="call.roleOf" />

        <div v-if="getting" class="absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-lg bg-call-surface px-3 py-1.5 text-sm shadow-lg" role="status">
          <LoaderCircle class="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />{{ t('call.stage.reconnecting') }}
        </div>
        <div v-else-if="call.audioBlocked" class="absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-call-surface px-3 py-1.5 text-sm shadow-lg" role="alert">
          {{ t('call.stage.audioBlocked') }}
          <button type="button" class="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-3 font-medium text-on-primary hover:bg-primary-hover" @click="call.startAudio()">
            <Volume2 class="size-4" aria-hidden="true" />{{ t('call.stage.startAudio') }}
          </button>
        </div>
      </div>

      <CallPanel />
    </div>

    <div :inert="covered || undefined">
      <CallToolbar />
    </div>
  </div>
</template>
