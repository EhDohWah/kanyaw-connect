<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import LinkifiedText from '@/components/chat/LinkifiedText.vue'
import UserAvatar from '@/components/common/UserAvatar.vue'
import { useNow } from '@/composables/useNow'
import { useAuthStore } from '@/stores/auth'
import type { FeedComment } from '@/types/feed'
import { formatFullTime, formatRelativeTime } from '@/utils/dates'

const props = defineProps<{ comment: FeedComment }>()

const { locale } = useI18n()
const auth = useAuthStore()
const now = useNow()

const timeZone = computed(() => auth.user?.timezone ?? 'UTC')
const ago = computed(() => formatRelativeTime(props.comment.created_at, now.value, timeZone.value, locale.value))
const full = computed(() => formatFullTime(props.comment.created_at, timeZone.value, locale.value))
</script>

<template>
  <li class="flex gap-3">
    <UserAvatar :name="comment.author.name" :seed="comment.author.id" :src="comment.author.avatar_thumb_url" size="sm" />
    <div class="min-w-0 flex-1">
      <p class="flex items-baseline gap-2">
        <span class="truncate font-semibold text-text">{{ comment.author.name }}</span>
        <time :datetime="comment.created_at" :title="full" class="shrink-0 text-xs text-text-muted">{{ ago }}</time>
      </p>
      <p class="text-text"><LinkifiedText :text="comment.content" /></p>
    </div>
  </li>
</template>
