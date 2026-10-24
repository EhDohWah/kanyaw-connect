<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import CallChat from '@/components/call/CallChat.vue'
import ParticipantsTab from '@/components/call/ParticipantsTab.vue'
import { useCallStore, type CallPanel } from '@/stores/call'

/** Participants and Chat: a column beside the video from 1024 px, a full-screen sheet below that. */
const { t } = useI18n()
const call = useCallStore()
const tabs: CallPanel[] = ['participants', 'chat']
const tabButtons = ref<HTMLButtonElement[]>([])
let opener: HTMLElement | null = null

// Opening moves the focus in; closing gives it back to the button that opened it.
watch(
  () => call.panel,
  async (panel, before) => {
    if (panel && !before) {
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
      await nextTick()
      tabButtons.value[tabs.indexOf(panel)]?.focus()
    } else if (!panel && before) {
      await nextTick()
      if (opener?.isConnected) opener.focus()
      opener = null
    }
  },
)

function choose(tab: CallPanel): void {
  if (call.panel !== tab) call.togglePanel(tab)
}

async function onKey(event: KeyboardEvent): Promise<void> {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  const next = call.panel === 'chat' ? 'participants' : 'chat'
  choose(next)
  await nextTick()
  tabButtons.value[tabs.indexOf(next)]?.focus()
}
</script>

<template>
  <aside
    v-if="call.panel"
    :aria-label="t('call.panel.label')"
    class="fixed inset-0 z-10 flex flex-col bg-call-bg lg:static lg:z-auto lg:w-80 lg:shrink-0 lg:border-l lg:border-call-raised"
    @keydown.esc="call.closePanel()"
  >
    <div class="flex items-center gap-1 border-b border-call-raised px-2">
      <div role="tablist" :aria-label="t('call.panel.label')" class="flex flex-1" @keydown="onKey">
        <button
          v-for="tab in tabs"
          :id="`call-tab-${tab}`"
          :key="tab"
          ref="tabButtons"
          type="button"
          role="tab"
          :aria-selected="call.panel === tab"
          :aria-controls="call.panel === tab ? 'call-panel-body' : undefined"
          :tabindex="call.panel === tab ? 0 : -1"
          :class="[
            '-mb-px min-h-12 border-b-2 px-3 text-sm font-medium transition-colors duration-150',
            call.panel === tab ? 'border-on-call text-on-call' : 'border-transparent text-on-call-muted hover:text-on-call',
          ]"
          @click="choose(tab)"
        >
          {{ tab === 'chat' ? t('call.chat.title') : t('call.participants.title') }}
        </button>
      </div>
      <button type="button" class="flex size-11 items-center justify-center rounded-lg text-on-call hover:bg-call-raised" :aria-label="t('call.panel.close')" @click="call.closePanel()">
        <X class="size-5" aria-hidden="true" />
      </button>
    </div>
    <div id="call-panel-body" role="tabpanel" :aria-labelledby="`call-tab-${call.panel}`" class="min-h-0 flex-1 overflow-y-auto">
      <CallChat v-if="call.panel === 'chat'" />
      <ParticipantsTab v-else />
    </div>
  </aside>
</template>
