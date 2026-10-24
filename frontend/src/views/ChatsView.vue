<script setup lang="ts">
import { SquarePen, Users } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'

import ChatList from '@/components/chat/ChatList.vue'
import BaseButton from '@/components/common/BaseButton.vue'
import { useUiStore } from '@/stores/ui'

const { t } = useI18n()
const router = useRouter()
const ui = useUiStore()
</script>

<template>
  <div class="mx-auto max-w-2xl">
    <header class="flex items-center gap-2 px-4 py-3 md:px-6 md:py-5">
      <h1 class="flex-1 text-2xl font-semibold">{{ t('chat.title') }}</h1>
      <BaseButton variant="secondary" @click="ui.newChatOpen = true">
        <SquarePen class="size-4" aria-hidden="true" /><span class="hidden sm:inline">{{ t('chat.newChat') }}</span>
        <span class="sr-only sm:hidden">{{ t('chat.newChat') }}</span>
      </BaseButton>
      <BaseButton variant="secondary" @click="ui.newGroupOpen = true">
        <Users class="size-4" aria-hidden="true" /><span class="hidden sm:inline">{{ t('chat.newGroup') }}</span>
        <span class="sr-only sm:hidden">{{ t('chat.newGroup') }}</span>
      </BaseButton>
    </header>
    <ChatList @select="(id) => router.push({ name: 'chat', params: { id } })" />
  </div>
</template>
