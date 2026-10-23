<script setup lang="ts">
import { ImagePlus, Video } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'

import Modal from '@/components/common/Modal.vue'
import { useUiStore } from '@/stores/ui'

const { t } = useI18n()
const ui = useUiStore()

// Both actions arrive with the feed and the meeting screens; until then they say so instead of doing nothing.
const items = [
  { key: 'post', icon: ImagePlus, title: 'create.post', hint: 'create.postHint' },
  { key: 'meeting', icon: Video, title: 'create.meeting', hint: 'create.meetingHint' },
] as const
</script>

<template>
  <Modal :open="ui.createMenuOpen" :title="t('create.title')" @close="ui.createMenuOpen = false">
    <ul class="flex flex-col gap-2">
      <li v-for="item in items" :key="item.key">
        <button
          type="button"
          class="flex min-h-14 w-full items-center gap-3 rounded-xl border border-border p-3 text-left opacity-60"
          aria-disabled="true"
        >
          <span class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
            <component :is="item.icon" class="size-5" aria-hidden="true" />
          </span>
          <span class="flex-1">
            <span class="block font-medium text-text">{{ t(item.title) }}</span>
            <span class="block text-sm text-text-muted">{{ t(item.hint) }}</span>
          </span>
          <span class="shrink-0 rounded-lg bg-surface px-2 py-1 text-xs font-medium text-text">
            {{ t('common.comingSoon') }}
          </span>
        </button>
      </li>
    </ul>
  </Modal>
</template>
