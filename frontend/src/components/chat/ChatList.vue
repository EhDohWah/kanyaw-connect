<script setup lang="ts">
import { MessageCircle, Plus, Users } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'

import BaseButton from '@/components/common/BaseButton.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import ErrorState from '@/components/common/ErrorState.vue'
import Skeleton from '@/components/common/Skeleton.vue'
import ChatListRow from '@/components/chat/ChatListRow.vue'
import { errorMessage } from '@/utils/errorMessage'
import { useChatsStore } from '@/stores/chats'
import { useUiStore } from '@/stores/ui'

defineProps<{ activeId?: string | null }>()
defineEmits<{ select: [chatId: string] }>()

const { t } = useI18n()
const chats = useChatsStore()
const ui = useUiStore()
</script>

<template>
  <div v-if="chats.status === 'idle' || chats.status === 'loading'" class="flex flex-col gap-1 p-4" role="status">
    <span class="sr-only">{{ t('common.loading') }}</span>
    <div v-for="row in 6" :key="row" class="flex items-center gap-3 py-2">
      <Skeleton rounded="full" class="size-10 shrink-0" />
      <div class="flex flex-1 flex-col gap-2">
        <Skeleton class="h-4 w-1/2" />
        <Skeleton class="h-3 w-3/4" />
      </div>
    </div>
  </div>

  <ErrorState
    v-else-if="chats.status === 'error' && chats.error"
    :message="errorMessage(chats.error, t)"
    @retry="chats.fetchChats()"
  />

  <EmptyState
    v-else-if="chats.chats.length === 0"
    :icon="MessageCircle"
    :title="t('chat.list.emptyTitle')"
    :text="t('chat.list.emptyText')"
  >
    <div class="flex flex-wrap justify-center gap-2">
      <BaseButton @click="ui.newChatOpen = true"><Plus class="size-4" aria-hidden="true" />{{ t('chat.newChat') }}</BaseButton>
      <BaseButton variant="secondary" @click="ui.newGroupOpen = true">
        <Users class="size-4" aria-hidden="true" />{{ t('chat.newGroup') }}
      </BaseButton>
    </div>
  </EmptyState>

  <nav v-else :aria-label="t('chat.list.label')">
    <ul>
      <ChatListRow
        v-for="chat in chats.chats"
        :key="chat.id"
        :chat="chat"
        :active="chat.id === activeId"
        @select="$emit('select', $event)"
      />
    </ul>
    <div v-if="chats.hasMore" class="flex flex-col items-center gap-2 p-4 text-center">
      <p v-if="chats.loadMoreError" class="text-sm text-danger" role="alert">{{ errorMessage(chats.loadMoreError, t) }}</p>
      <BaseButton variant="secondary" :loading="chats.loadingMore" @click="chats.loadMore()">
        {{ chats.loadingMore ? t('chat.list.loadingMore') : t('chat.list.showMore') }}
      </BaseButton>
    </div>
  </nav>
</template>
