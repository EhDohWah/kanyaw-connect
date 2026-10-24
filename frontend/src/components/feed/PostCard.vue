<script setup lang="ts">
import { Heart, ImageOff, MessageCircle, Share2 } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import LinkifiedText from '@/components/chat/LinkifiedText.vue'
import UserAvatar from '@/components/common/UserAvatar.vue'
import { useNow } from '@/composables/useNow'
import { feedService } from '@/services'
import { useAuthStore } from '@/stores/auth'
import { useFeedStore } from '@/stores/feed'
import { useUiStore } from '@/stores/ui'
import type { FeedPost } from '@/types/feed'
import { formatFullTime, formatRelativeTime } from '@/utils/dates'
import { shareLink } from '@/utils/share'

const props = defineProps<{
  post: FeedPost
  /** The first pictures on the page load at once; the rest wait until they are close to the screen. */
  eager?: boolean
}>()
const emit = defineEmits<{ comments: [postId: string] }>()

/** A caption longer than this is cut short, with "more". */
const LONG_CAPTION = 220

const { t, locale } = useI18n()
const auth = useAuthStore()
const feed = useFeedStore()
const ui = useUiStore()
const now = useNow()

const timeZone = computed(() => auth.user?.timezone ?? 'UTC')
const ago = computed(() => formatRelativeTime(props.post.created_at, now.value, timeZone.value, locale.value))
const full = computed(() => formatFullTime(props.post.created_at, timeZone.value, locale.value))

const expanded = ref(false)
const long = computed(() => props.post.caption.length > LONG_CAPTION)

const imageBroken = ref(false)
const popping = ref(false)

async function like(): Promise<void> {
  const liking = !props.post.liked_by_me
  popping.value = liking
  const saved = await feed.toggleLike(props.post.id)
  if (!saved) ui.toast(t('feed.post.likeFailed'), 'error')
}

async function share(): Promise<void> {
  const outcome = await shareLink({
    title: t('feed.post.shareTitle', { name: props.post.author.name }),
    text: props.post.caption.slice(0, 140),
    url: feedService().postLink(props.post.id),
  })
  if (outcome === 'copied') ui.toast(t('feed.post.linkCopied'))
  else if (outcome === 'failed') ui.toast(t('feed.post.shareFailed'), 'error')
}
</script>

<template>
  <article class="rounded-xl border border-border bg-bg" :aria-label="t('feed.post.by', { name: post.author.name })">
    <header class="flex items-center gap-3 p-3">
      <UserAvatar :name="post.author.name" :seed="post.author.id" :src="post.author.avatar_thumb_url" />
      <div class="min-w-0 flex-1">
        <p class="truncate font-semibold text-text">{{ post.author.name }}</p>
        <time :datetime="post.created_at" :title="full" class="text-xs text-text-muted">{{ ago }}</time>
      </div>
    </header>

    <!-- A fixed square: the page does not jump when the picture arrives, and a picture that fails leaves a calm placeholder. -->
    <div v-if="post.image_url" class="aspect-square w-full overflow-hidden bg-surface">
      <img
        v-if="!imageBroken"
        :src="post.image_url"
        :alt="t('feed.post.imageAlt', { name: post.author.name })"
        :loading="eager ? 'eager' : 'lazy'"
        decoding="async"
        class="size-full object-cover"
        @error="imageBroken = true"
      />
      <div v-else class="flex size-full flex-col items-center justify-center gap-2 text-text-muted">
        <ImageOff class="size-8" aria-hidden="true" />
        <p class="text-sm">{{ t('feed.post.imageFailed') }}</p>
      </div>
    </div>

    <div class="flex items-center gap-1 px-1.5 pt-1.5">
      <button
        type="button"
        class="flex size-11 items-center justify-center rounded-lg text-text transition-colors duration-150 hover:bg-surface"
        :aria-label="t('feed.post.like')"
        :aria-pressed="post.liked_by_me"
        @click="like"
      >
        <Heart
          :class="['size-6 transition-colors duration-150', post.liked_by_me ? 'fill-primary text-primary' : '', popping && post.liked_by_me ? 'animate-like-pop' : '']"
          aria-hidden="true"
          @animationend="popping = false"
        />
      </button>
      <button
        type="button"
        class="flex size-11 items-center justify-center rounded-lg text-text transition-colors duration-150 hover:bg-surface"
        :aria-label="t('feed.post.commentsAction', { name: post.author.name })"
        @click="emit('comments', post.id)"
      >
        <MessageCircle class="size-6" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="flex size-11 items-center justify-center rounded-lg text-text transition-colors duration-150 hover:bg-surface"
        :aria-label="t('feed.post.share')"
        @click="share"
      >
        <Share2 class="size-6" aria-hidden="true" />
      </button>
    </div>

    <div class="flex flex-col gap-1 px-3 pb-3">
      <p class="font-semibold text-text" aria-live="polite">{{ t('feed.post.likes', { count: post.like_count }, post.like_count) }}</p>

      <p v-if="post.caption" :class="['text-text', long && !expanded ? 'line-clamp-3' : '']">
        <span class="font-semibold">{{ post.author.name }}</span>
        {{ ' ' }}
        <LinkifiedText :text="post.caption" />
      </p>
      <button
        v-if="long"
        type="button"
        class="min-h-11 self-start text-sm text-text-muted hover:text-text"
        :aria-expanded="expanded"
        @click="expanded = !expanded"
      >
        {{ expanded ? t('feed.post.less') : t('feed.post.more') }}
      </button>

      <button
        type="button"
        class="min-h-11 self-start text-sm text-text-muted transition-colors duration-150 hover:text-text"
        @click="emit('comments', post.id)"
      >
        {{ post.comment_count > 0 ? t('feed.post.comments', { count: post.comment_count }, post.comment_count) : t('feed.post.addComment') }}
      </button>
    </div>
  </article>
</template>
