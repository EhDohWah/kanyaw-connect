<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import Modal from '@/components/common/Modal.vue'
import type { MessageAction, MessageActionKey } from '@/utils/messageActions'

defineProps<{ open: boolean; actions: MessageAction[] }>()
defineEmits<{ close: []; run: [key: MessageActionKey] }>()

const { t } = useI18n()
</script>

<template>
  <!-- What a long press on a message opens, on a phone: the same actions as the hover toolbar, as a list. -->
  <Modal :open="open" :title="t('message.actions')" @close="$emit('close')">
    <ul class="flex flex-col gap-1">
      <li v-for="action in actions" :key="action.key">
        <button
          type="button"
          :class="[
            'flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left font-medium transition-colors duration-150 hover:bg-surface',
            action.danger ? 'text-danger' : 'text-text',
          ]"
          @click="$emit('run', action.key)"
        >
          <component :is="action.icon" class="size-5" aria-hidden="true" />{{ t(action.label) }}
        </button>
      </li>
    </ul>
  </Modal>
</template>
