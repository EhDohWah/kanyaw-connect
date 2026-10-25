<script setup lang="ts">
import { WifiOff } from 'lucide-vue-next'
import { ref } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'

import ErrorState from '@/components/common/ErrorState.vue'
import ChatDialogs from '@/components/chat/ChatDialogs.vue'
import BottomBar from '@/components/layout/BottomBar.vue'
import ChatDrawer from '@/components/layout/ChatDrawer.vue'
import CreateMenu from '@/components/layout/CreateMenu.vue'
import RightSidebar from '@/components/layout/RightSidebar.vue'
import SideNav from '@/components/layout/SideNav.vue'
import VerifyEmailBanner from '@/components/layout/VerifyEmailBanner.vue'
import { useHeartbeat } from '@/composables/useHeartbeat'
import { useMediaQuery } from '@/composables/useMediaQuery'
import { useMessagingSession } from '@/composables/useMessagingSession'
import { useAuthStore } from '@/stores/auth'
import { useDirectCallStore } from '@/stores/directCall'
import { useRealtimeStore } from '@/stores/realtime'
import { useUiStore } from '@/stores/ui'
import { errorMessage } from '@/utils/errorMessage'

const { t } = useI18n()
const route = useRoute()
const auth = useAuthStore()
const connection = useRealtimeStore()
const ui = useUiStore()
const directCall = useDirectCallStore()
const wide = useMediaQuery('(min-width: 1024px)')

useHeartbeat()
useMessagingSession()

const retrying = ref(false)
async function retry(): Promise<void> {
  retrying.value = true
  try {
    await auth.ensureUser()
  } finally {
    retrying.value = false
  }
}
</script>

<template>
  <!-- Room at the top for the "Return to call" bar while a call goes on in the background. -->
  <div :class="['flex min-h-dvh bg-bg text-text', directCall.live && !directCall.expanded ? 'pt-11' : '']">
    <!-- Tablet and wide screens: navigation on the left (the navigation inside is already a landmark). -->
    <div v-if="!ui.callOpen" class="sticky top-0 hidden h-dvh w-[72px] shrink-0 border-r border-border md:block lg:w-64">
      <SideNav />
    </div>

    <main
      id="main"
      tabindex="-1"
      :class="[
        'min-w-0 flex-1 outline-none',
        // Room for the fixed bottom bar on phones; the bar is hidden inside a conversation or call.
        route.meta.immersive ? '' : 'pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0',
      ]"
    >
      <div
        v-if="connection.showOffline"
        class="flex items-center gap-2 border-b border-border bg-surface px-4 py-2 text-sm text-text"
        role="status"
      >
        <WifiOff class="size-4 shrink-0" aria-hidden="true" />
        {{ connection.browserOnline ? t('shell.reconnecting') : t('shell.offline') }}
      </div>

      <!-- Not inside a conversation or a call, where every line of the screen counts. -->
      <VerifyEmailBanner v-if="!route.meta.immersive" />

      <template v-if="auth.bootError">
        <h1 class="sr-only">{{ t('app.name') }}</h1>
        <ErrorState :message="errorMessage(auth.bootError, t)" :retrying="retrying" @retry="retry" />
      </template>
      <RouterView v-else />
    </main>

    <!-- Wide screens only: who is online and what is coming up. Not made at all on the others, so nothing is fetched
         for it; they reach the same content from a button on Home. -->
    <aside
      v-if="wide && !ui.callOpen"
      class="sticky top-0 h-dvh w-80 shrink-0 overflow-y-auto border-l border-border"
      :aria-label="t('shell.sidebarTitle')"
    >
      <RightSidebar />
    </aside>

    <BottomBar v-if="!route.meta.immersive" />
    <ChatDrawer v-if="!ui.callOpen" />
    <CreateMenu />
    <ChatDialogs />
  </div>
</template>
