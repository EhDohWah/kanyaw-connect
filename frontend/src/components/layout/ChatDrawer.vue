<script setup lang="ts">
import { ChevronDown, MessageCircle, SquarePen, Users } from 'lucide-vue-next'
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'

import ChatList from '@/components/chat/ChatList.vue'
import Conversation from '@/components/chat/Conversation.vue'
import { useMediaQuery } from '@/composables/useMediaQuery'
import { useChatsStore } from '@/stores/chats'
import { useUiStore } from '@/stores/ui'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const ui = useUiStore()
const chats = useChatsStore()

const wide = useMediaQuery('(min-width: 1024px)')
// The Messages pages already show everything the drawer would; a meeting has no room for it.
const hiddenOn = ['chats', 'chat', 'room']
const visible = computed(() => wide.value && !hiddenOn.includes(String(route.name)))

const unread = computed(() => chats.totalUnread)
const iconButton =
  'flex size-11 shrink-0 items-center justify-center rounded-lg text-text transition-colors duration-150 hover:bg-surface'

function openFull(): void {
  const id = ui.drawer.chatId
  ui.collapseDrawer()
  if (id) void router.push({ name: 'chat', params: { id } })
}
</script>

<template>
  <!-- Docked to the bottom right of wide screens: a small tab, or a panel with the list and the open conversation. A floating element. -->
  <aside v-if="visible" class="fixed bottom-0 right-4 z-30" :aria-label="t('chat.drawer.label')">
    <button
      v-if="!ui.drawer.open"
      type="button"
      class="flex min-h-12 items-center gap-2 rounded-t-xl border border-b-0 border-border bg-bg px-4 font-medium shadow-md transition-colors duration-150 hover:bg-surface"
      :aria-label="t('chat.drawer.expand')"
      aria-expanded="false"
      @click="ui.openDrawer()"
    >
      <MessageCircle class="size-5 text-primary" aria-hidden="true" />
      {{ t('chat.title') }}
      <span v-if="unread > 0" class="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-on-primary">
        <span aria-hidden="true">{{ unread > 99 ? '99+' : unread }}</span>
        <span class="sr-only">{{ t('nav.unread', { count: unread }) }}</span>
      </span>
    </button>

    <div
      v-else
      class="flex h-[min(36rem,calc(100dvh-5rem))] w-[22.5rem] flex-col overflow-hidden rounded-t-xl border border-b-0 border-border bg-bg shadow-lg"
    >
      <Conversation
        v-if="ui.drawer.chatId"
        :key="ui.drawer.chatId"
        :chat-id="ui.drawer.chatId"
        variant="drawer"
        @back="ui.openDrawer(null)"
        @gone="ui.openDrawer(null)"
        @open-full="openFull"
        @collapse="ui.collapseDrawer()"
      />
      <template v-else>
        <header class="flex items-center gap-1 border-b border-border py-1.5 pl-4 pr-2">
          <h2 class="flex-1 font-semibold">{{ t('chat.title') }}</h2>
          <button type="button" :class="iconButton" :aria-label="t('chat.newChat')" :title="t('chat.newChat')" @click="ui.newChatOpen = true">
            <SquarePen class="size-5" aria-hidden="true" />
          </button>
          <button type="button" :class="iconButton" :aria-label="t('chat.newGroup')" :title="t('chat.newGroup')" @click="ui.newGroupOpen = true">
            <Users class="size-5" aria-hidden="true" />
          </button>
          <button type="button" :class="iconButton" :aria-label="t('chat.drawer.collapse')" aria-expanded="true" @click="ui.collapseDrawer()">
            <ChevronDown class="size-5" aria-hidden="true" />
          </button>
        </header>
        <div class="min-h-0 flex-1 overflow-y-auto">
          <ChatList @select="ui.openDrawer($event)" />
        </div>
      </template>
    </div>
  </aside>
</template>
