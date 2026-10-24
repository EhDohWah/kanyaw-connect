<script setup lang="ts">
import { Plus } from 'lucide-vue-next'
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import BaseButton from '@/components/common/BaseButton.vue'
import MeetingList from '@/components/rooms/MeetingList.vue'
import NewMeetingDialog from '@/components/rooms/NewMeetingDialog.vue'
import { MEETING_TABS } from '@/stores/rooms'
import type { RoomFilter } from '@/types/room'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

const formOpen = ref(false)
const tabButtons = ref<HTMLButtonElement[]>([])

/** The tab is in the address (`?tab=hosting`), so Back and a reload keep it. */
const current = computed<RoomFilter>(() => {
  const asked = route.query.tab
  return MEETING_TABS.find((tab) => tab === asked) ?? 'upcoming'
})

function choose(tab: RoomFilter): void {
  if (tab !== current.value) void router.replace({ query: { ...route.query, tab } })
}

/** Arrow keys move between tabs (the WAI-ARIA tabs pattern); the chosen tab gets the focus. */
async function onKey(event: KeyboardEvent): Promise<void> {
  const index = MEETING_TABS.indexOf(current.value)
  const next =
    event.key === 'ArrowRight' ? (index + 1) % MEETING_TABS.length
    : event.key === 'ArrowLeft' ? (index - 1 + MEETING_TABS.length) % MEETING_TABS.length
    : event.key === 'Home' ? 0
    : event.key === 'End' ? MEETING_TABS.length - 1
    : -1
  if (next < 0) return
  event.preventDefault()
  choose(MEETING_TABS[next] as RoomFilter)
  await nextTick()
  tabButtons.value[next]?.focus()
}

/** A scheduled meeting was made: show it where it now is. */
function created(): void {
  choose('hosting')
}
</script>

<template>
  <div class="mx-auto max-w-2xl px-4 py-4 md:px-8 md:py-8">
    <header class="mb-4 flex items-center justify-between gap-3">
      <h1 class="text-xl font-semibold text-text">{{ t('meetings.title') }}</h1>
      <BaseButton @click="formOpen = true"><Plus class="size-4" aria-hidden="true" />{{ t('meetings.new') }}</BaseButton>
    </header>

    <div role="tablist" :aria-label="t('meetings.tabsLabel')" class="mb-2 flex gap-1 border-b border-border" @keydown="onKey">
      <button
        v-for="tab in MEETING_TABS"
        :id="`meetings-tab-${tab}`"
        :key="tab"
        ref="tabButtons"
        type="button"
        role="tab"
        :aria-selected="tab === current"
        :aria-controls="tab === current ? `meetings-panel-${tab}` : undefined"
        :tabindex="tab === current ? 0 : -1"
        :class="[
          '-mb-px min-h-11 border-b-2 px-3 text-sm font-medium transition-colors duration-150',
          tab === current ? 'border-primary text-primary' : 'border-transparent text-text-muted hover:text-text',
        ]"
        @click="choose(tab)"
      >
        {{ t(`meetings.tabs.${tab}`) }}
      </button>
    </div>

    <div :id="`meetings-panel-${current}`" role="tabpanel" :aria-labelledby="`meetings-tab-${current}`" tabindex="0" class="outline-none">
      <MeetingList :key="current" :filter="current" @new="formOpen = true" />
    </div>

    <NewMeetingDialog :open="formOpen" @close="formOpen = false" @created="created" />
  </div>
</template>
