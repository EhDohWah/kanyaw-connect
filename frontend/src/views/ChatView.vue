<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'

import Conversation from '@/components/chat/Conversation.vue'
import { useChatsStore } from '@/stores/chats'
import { useUiStore } from '@/stores/ui'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const ui = useUiStore()
const chats = useChatsStore()

const chatId = computed(() => String(route.params.id))

function back(): void {
  void router.push({ name: 'chats' })
}

// Removed from the group while it was open (or the chat was deleted): back to the list, with a word about why.
function gone(): void {
  if (chats.lastLeftId !== chatId.value) ui.toast(t('chat.conversation.gone'))
  back()
}
</script>

<template>
  <!-- The same conversation as in the drawer, at full width. The page is as tall as the screen; only the messages scroll. -->
  <div class="mx-auto h-dvh max-w-3xl md:border-x md:border-border">
    <Conversation :chat-id="chatId" variant="page" @back="back" @gone="gone" />
  </div>
</template>
