<script setup lang="ts">
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import CallEnded from '@/components/call/direct/CallEnded.vue'
import DirectCallScreen from '@/components/call/direct/DirectCallScreen.vue'
import IncomingBanner from '@/components/call/direct/IncomingBanner.vue'
import IncomingScreen from '@/components/call/direct/IncomingScreen.vue'
import OngoingCallBar from '@/components/call/direct/OngoingCallBar.vue'
import { useDirectCallStore } from '@/stores/directCall'

/**
 * The one-to-one call, above every page (so moving around never hangs up): full screen, a small banner for a call
 * coming in during a meeting or in another tab, or the slim bar while you look at something else.
 */
const { t } = useI18n()
const call = useDirectCallStore()
const route = useRoute()

const name = computed(() => call.peer?.name ?? t('directCall.someone'))
const banner = computed(() => (call.phase === 'incoming' || call.phase === 'accepting') && (call.inMeeting || !call.ringsHere))
const fullScreen = computed(() => call.visible && call.expanded && !banner.value)
const incoming = computed(() => call.phase === 'incoming' || call.phase === 'accepting')

// Going somewhere else in the app (a link, the back button) keeps the call and shrinks it to the bar.
watch(
  () => route.fullPath,
  (to, from) => {
    if (to !== from && route.name !== 'call') call.minimize()
  },
)
</script>

<template>
  <IncomingBanner v-if="banner" />
  <div
    v-else-if="fullScreen"
    class="fixed inset-0 z-[60] bg-call-bg text-on-call"
    role="dialog"
    aria-modal="true"
    :aria-label="t('directCall.screenLabel', { name })"
  >
    <IncomingScreen v-if="incoming" />
    <CallEnded v-else-if="call.phase === 'ended'" />
    <DirectCallScreen v-else />
  </div>
  <OngoingCallBar v-else-if="call.live" />
</template>
