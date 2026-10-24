<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import type { MessageAction, MessageActionKey } from '@/utils/messageActions'

defineProps<{ actions: MessageAction[] }>()
defineEmits<{ run: [key: MessageActionKey] }>()

const { t } = useI18n()
</script>

<template>
  <!-- Shown beside a message when the mouse is over it or the keyboard is inside it. A floating element: it has a shadow. -->
  <div
    class="flex items-center rounded-lg border border-border bg-bg p-0.5 shadow-sm"
    role="toolbar"
    :aria-label="t('message.actions')"
  >
    <button
      v-for="action in actions"
      :key="action.key"
      type="button"
      :class="[
        'flex size-11 items-center justify-center rounded-lg transition-colors duration-150 hover:bg-surface',
        action.danger ? 'text-danger' : 'text-text',
      ]"
      :aria-label="t(action.label)"
      :title="t(action.label)"
      @click="$emit('run', action.key)"
    >
      <component :is="action.icon" class="size-4" aria-hidden="true" />
    </button>
  </div>
</template>
