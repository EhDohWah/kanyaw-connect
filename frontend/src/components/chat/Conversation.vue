<script setup lang="ts">
import { Lock, MessageCircleOff } from 'lucide-vue-next'
import { computed, ref, toRef } from 'vue'
import { useI18n } from 'vue-i18n'

import Composer from '@/components/chat/Composer.vue'
import ConversationHeader from '@/components/chat/ConversationHeader.vue'
import GroupInfoDialog from '@/components/chat/GroupInfoDialog.vue'
import ImageViewer from '@/components/chat/ImageViewer.vue'
import MessageList from '@/components/chat/MessageList.vue'
import TypingIndicator from '@/components/chat/TypingIndicator.vue'
import BaseButton from '@/components/common/BaseButton.vue'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import ErrorState from '@/components/common/ErrorState.vue'
import Skeleton from '@/components/common/Skeleton.vue'
import { useConversation } from '@/composables/useConversation'
import { isApiError } from '@/api/errors'
import { useAuthStore } from '@/stores/auth'
import { useDraftsStore } from '@/stores/drafts'
import { useMessagesStore } from '@/stores/messages'
import { useTypingStore } from '@/stores/typing'
import { useUiStore } from '@/stores/ui'
import type { TimelineMessage } from '@/types/chat'
import { personById } from '@/utils/chatText'
import { errorMessage } from '@/utils/errorMessage'
import { copyText, type MessageActionKey } from '@/utils/messageActions'

const props = defineProps<{ chatId: string; variant: 'page' | 'drawer' }>()
const emit = defineEmits<{ back: []; gone: []; openFull: []; collapse: [] }>()

const { t } = useI18n()
const auth = useAuthStore()
const messages = useMessagesStore()
const drafts = useDraftsStore()
const typing = useTypingStore()
const ui = useUiStore()

const { chat, state, timeline, atBottom, reload } = useConversation(toRef(props, 'chatId'), { onGone: () => emit('gone') })

const list = ref<InstanceType<typeof MessageList> | null>(null)
const infoOpen = ref(false)
const viewerMessage = ref<TimelineMessage | null>(null)
const toDelete = ref<TimelineMessage | null>(null)
const deleting = ref(false)
const deleteError = ref('')

const typingNames = computed(() => {
  const current = chat.value
  if (!current) return []
  return typing
    .typingUserIds(current.id)
    .map((id) => personById(current, id)?.name)
    .filter((name): name is string => name !== undefined)
})

function find(messageId: string): TimelineMessage | undefined {
  return timeline.value?.messages.find((message) => message.id === messageId)
}

async function runAction(key: MessageActionKey, messageId: string): Promise<void> {
  const message = find(messageId)
  if (!message) return
  const draft = drafts.get(props.chatId)

  if (key === 'reply') {
    draft.editingId = null
    draft.replyToId = message.id
  } else if (key === 'edit') {
    draft.replyToId = null
    draft.editingId = message.id
  } else if (key === 'copy') {
    ui.toast((await copyText(message.content ?? '')) ? t('message.copied') : t('message.copyFailed'), 'success')
  } else {
    deleteError.value = ''
    toDelete.value = message
  }
}

async function confirmDelete(): Promise<void> {
  const message = toDelete.value
  if (!message) return

  deleting.value = true
  deleteError.value = ''
  try {
    await messages.remove(message)
    if (drafts.get(props.chatId).replyToId === message.id) drafts.get(props.chatId).replyToId = null
    toDelete.value = null
  } catch (error) {
    deleteError.value = isApiError(error) ? errorMessage(error, t) : t('chat.delete.failed')
  } finally {
    deleting.value = false
  }
}

const viewerAttachment = computed(() => viewerMessage.value?.attachment ?? null)
</script>

<template>
  <section class="flex h-full min-h-0 flex-col bg-bg">
    <ConversationHeader
      v-if="chat"
      :chat="chat"
      :variant="variant"
      @back="emit('back')"
      @info="infoOpen = true"
      @open-full="emit('openFull')"
      @collapse="emit('collapse')"
    />

    <!-- Finding the chat -->
    <div v-if="state === 'loading'" class="flex flex-1 flex-col justify-end gap-3 p-4" role="status">
      <span class="sr-only">{{ t('common.loading') }}</span>
      <Skeleton class="h-10 w-2/3" rounded="xl" />
      <Skeleton class="ml-auto h-10 w-1/2" rounded="xl" />
      <Skeleton class="h-10 w-3/5" rounded="xl" />
    </div>
    <EmptyState v-else-if="state === 'missing'" class="flex-1" :icon="MessageCircleOff" :title="t('chat.conversation.notFound')">
      <BaseButton variant="secondary" @click="emit('back')">{{ t('chat.conversation.backToChats') }}</BaseButton>
    </EmptyState>
    <ErrorState v-else-if="state === 'error'" class="flex-1" :message="t('chat.conversation.loadError')" @retry="reload" />

    <template v-else-if="chat">
      <!-- Encrypted chats are not supported by this app yet: say so calmly. -->
      <EmptyState
        v-if="chat.is_encrypted"
        class="flex-1"
        :icon="Lock"
        :title="t('chat.encrypted.title')"
        :text="t('chat.encrypted.notice')"
      />

      <template v-else>
        <div v-if="!timeline || timeline.status === 'loading'" class="flex flex-1 flex-col justify-end gap-3 p-4" role="status">
          <span class="sr-only">{{ t('common.loading') }}</span>
          <Skeleton class="h-10 w-2/3" rounded="xl" />
          <Skeleton class="ml-auto h-10 w-1/2" rounded="xl" />
          <Skeleton class="h-10 w-3/5" rounded="xl" />
        </div>
        <ErrorState
          v-else-if="timeline.status === 'error' && timeline.messages.length === 0"
          class="flex-1"
          :message="t('chat.conversation.loadError')"
          @retry="reload"
        />
        <MessageList
          v-else
          ref="list"
          :chat="chat"
          :messages="timeline.messages"
          :has-older="timeline.nextUrl !== null"
          :loading-older="timeline.loadingOlder"
          :older-error="timeline.olderError"
          @load-older="messages.loadOlder(chatId)"
          @at-bottom="atBottom = $event"
          @action="runAction"
          @retry="messages.retry(chatId, $event)"
          @discard="messages.discard(chatId, $event)"
          @open-image="viewerMessage = find($event) ?? null"
          @expired="(id) => { const message = find(id); if (message) void messages.refreshAttachment(message) }"
        />

        <TypingIndicator :names="typingNames" />
        <Composer :chat="chat" @sent="list?.scrollToBottom()" />
      </template>
    </template>

    <ImageViewer :open="viewerMessage !== null" :attachment="viewerAttachment" :caption="viewerMessage?.content" @close="viewerMessage = null" />
    <ConfirmDialog
      :open="toDelete !== null"
      :title="t('chat.delete.title')"
      :text="t('chat.delete.text')"
      :confirm-label="t('message.delete')"
      danger
      :busy="deleting"
      :error="deleteError"
      @cancel="toDelete = null"
      @confirm="confirmDelete"
    />
    <GroupInfoDialog v-if="chat?.type === 'group'" :open="infoOpen" :chat-id="chatId" @close="infoOpen = false" />
  </section>
</template>
