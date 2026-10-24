<script setup lang="ts">
import { Ellipsis, MessageSquare, Mic, MicOff, MonitorUp, PhoneOff, Users, Video, VideoOff } from 'lucide-vue-next'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import CallSettingsDialog from '@/components/call/CallSettingsDialog.vue'
import LeaveDialog from '@/components/call/LeaveDialog.vue'
import MediaToggle from '@/components/call/MediaToggle.vue'
import ToolbarButton from '@/components/call/ToolbarButton.vue'
import { canShareScreen } from '@/realtime/localMedia'
import { useCallStore } from '@/stores/call'

const { t } = useI18n()
const call = useCallStore()
const sharing = canShareScreen()
const leaveOpen = ref(false)
const settingsOpen = ref(false)

/** Everyone else leaves at once; the host chooses between leaving and ending the meeting for everyone. */
function onLeave(): void {
  if (call.isHost) leaveOpen.value = true
  else call.leave()
}
</script>

<template>
  <div class="flex justify-center px-2 pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
    <!-- 44 px buttons on phones (the smallest comfortable target) so all seven fit a 360 px screen; 48 px from 640 px. -->
    <div role="toolbar" :aria-label="t('call.toolbar.label')" class="flex items-center gap-1.5 rounded-xl bg-call-surface/90 p-1.5 shadow-lg backdrop-blur-sm sm:gap-2 sm:p-2">
      <MediaToggle
        :on="call.local?.micOn ?? false"
        :label="t('call.toolbar.microphone')"
        :icon="Mic"
        :off-icon="MicOff"
        :busy="call.mediaBusy.microphone"
        @toggle="call.toggleMicrophone()"
      />
      <MediaToggle
        :on="call.local?.cameraOn ?? false"
        :label="t('call.toolbar.camera')"
        :icon="Video"
        :off-icon="VideoOff"
        :busy="call.mediaBusy.camera"
        @toggle="call.toggleCamera()"
      />
      <ToolbarButton
        v-if="sharing"
        :label="t('call.toolbar.screen')"
        :icon="MonitorUp"
        :pressed="call.local?.screenSharing ?? false"
        @click="call.toggleScreenShare()"
      />
      <ToolbarButton
        :label="call.unread > 0 ? t('call.toolbar.chatUnread', { count: call.unread }) : t('call.toolbar.chat')"
        :icon="MessageSquare"
        :pressed="call.panel === 'chat'"
        :badge="call.unread"
        @click="call.togglePanel('chat')"
      />
      <ToolbarButton
        :label="t('call.toolbar.participants')"
        :icon="Users"
        :pressed="call.panel === 'participants'"
        :badge="call.canModerate ? call.waiting.length : 0"
        @click="call.togglePanel('participants')"
      />
      <ToolbarButton :label="t('call.toolbar.more')" :icon="Ellipsis" @click="settingsOpen = true" />
      <ToolbarButton :label="t('call.toolbar.leave')" :icon="PhoneOff" danger @click="onLeave" />
    </div>

    <LeaveDialog :open="leaveOpen" @close="leaveOpen = false" />
    <CallSettingsDialog :open="settingsOpen" @close="settingsOpen = false" />
  </div>
</template>
