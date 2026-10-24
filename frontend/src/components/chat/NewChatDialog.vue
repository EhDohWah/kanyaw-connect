<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import PeoplePicker from '@/components/chat/PeoplePicker.vue'
import Modal from '@/components/common/Modal.vue'
import { useOpenChat } from '@/composables/useOpenChat'
import { usePeople } from '@/composables/usePeople'
import { useChatsStore } from '@/stores/chats'
import { useUiStore } from '@/stores/ui'
import type { PublicUser } from '@/types/user'

const { t } = useI18n()
const ui = useUiStore()
const chats = useChatsStore()
const openChat = useOpenChat()
const { people, loading, failed: peopleFailed, retry: retryPeople } = usePeople(computed(() => ui.newChatOpen))

async function pick(person: PublicUser): Promise<void> {
  try {
    const chat = await chats.openDirect(person.id)
    ui.newChatOpen = false
    openChat(chat.id)
  } catch {
    ui.toast(t('people.openFailed'), 'error')
  }
}
</script>

<template>
  <Modal :open="ui.newChatOpen" :title="t('people.newChatTitle')" @close="ui.newChatOpen = false">
    <p class="mb-4 text-sm text-text-muted">{{ t('people.newChatNote') }}</p>
    <PeoplePicker :people="people" :loading="loading" :failed="peopleFailed" :empty-text="t('people.noPeople')" @pick="pick" @retry="retryPeople" />
  </Modal>
</template>
