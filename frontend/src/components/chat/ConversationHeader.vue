<script setup lang="ts">
import { ArrowLeft, ChevronDown, Info, Maximize2 } from 'lucide-vue-next'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import UserAvatar from '@/components/common/UserAvatar.vue'
import { usePresenceStore } from '@/stores/presence'
import type { Chat } from '@/types/chat'
import { chatAvatar, chatTitle } from '@/utils/chatText'

const props = defineProps<{ chat: Chat; variant: 'page' | 'drawer' }>()
defineEmits<{ back: []; info: []; openFull: []; collapse: [] }>()

const { t } = useI18n()
const presence = usePresenceStore()

const title = computed(() => chatTitle(props.chat, t('chat.untitled')))
const avatar = computed(() => chatAvatar(props.chat, t('chat.untitled')))
const subtitle = computed(() => {
  if (props.chat.type === 'group') return t('chat.members', { count: props.chat.member_count })
  return presence.isOnline(props.chat.other_user?.id) ? t('chat.online') : ''
})

const buttonClass =
  'flex size-11 shrink-0 items-center justify-center rounded-lg text-text transition-colors duration-150 hover:bg-surface'
</script>

<template>
  <header class="flex items-center gap-1 border-b border-border px-2 py-1.5">
    <button
      type="button"
      :class="[buttonClass, variant === 'drawer' ? '' : '']"
      :aria-label="variant === 'drawer' ? t('chat.drawer.backToList') : t('chat.conversation.backToChats')"
      @click="$emit('back')"
    >
      <ArrowLeft class="size-5" aria-hidden="true" />
    </button>

    <UserAvatar :name="avatar.name" :seed="avatar.seed" :src="avatar.src" />
    <div class="min-w-0 flex-1 px-1">
      <h1 v-if="variant === 'page'" class="truncate font-semibold leading-tight">{{ title }}</h1>
      <h2 v-else class="truncate font-semibold leading-tight">{{ title }}</h2>
      <p v-if="subtitle" class="truncate text-xs text-text-muted">{{ subtitle }}</p>
    </div>

    <button v-if="variant === 'drawer'" type="button" :class="buttonClass" :aria-label="t('chat.conversation.openFullPage')" @click="$emit('openFull')">
      <Maximize2 class="size-5" aria-hidden="true" />
    </button>
    <button v-if="chat.type === 'group'" type="button" :class="buttonClass" :aria-label="t('chat.conversation.info')" @click="$emit('info')">
      <Info class="size-5" aria-hidden="true" />
    </button>
    <button v-if="variant === 'drawer'" type="button" :class="buttonClass" :aria-label="t('chat.drawer.collapse')" @click="$emit('collapse')">
      <ChevronDown class="size-5" aria-hidden="true" />
    </button>
  </header>
</template>
