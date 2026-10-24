<script setup lang="ts">
import { ChevronRight, Info, Newspaper, Users, X } from 'lucide-vue-next'
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import ActivityPanel from '@/components/layout/ActivityPanel.vue'
import BaseButton from '@/components/common/BaseButton.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import ErrorState from '@/components/common/ErrorState.vue'
import Modal from '@/components/common/Modal.vue'
import CommentsDrawer from '@/components/feed/CommentsDrawer.vue'
import PostCard from '@/components/feed/PostCard.vue'
import PostSkeleton from '@/components/feed/PostSkeleton.vue'
import { canObserve, useInfiniteScroll } from '@/composables/useInfiniteScroll'
import { useFeedStore } from '@/stores/feed'
import { useUiStore } from '@/stores/ui'
import { errorMessage } from '@/utils/errorMessage'

const { t } = useI18n()
const feed = useFeedStore()
const ui = useUiStore()

/** The post whose comments are open (the drawer), and whether the "People & activity" sheet is (screens without the sidebar). */
const commentsFor = ref<string | null>(null)
const activityOpen = ref(false)

const marker = ref<HTMLElement | null>(null)
const observed = canObserve()

onMounted(() => void feed.load())

// The marker is taken out of the page while a page loads and put back after, which makes the observer look again: a
// tall screen keeps filling until the marker is out of reach.
useInfiniteScroll(marker, () => void feed.loadMore())
</script>

<template>
  <div class="mx-auto flex max-w-xl flex-col gap-4 p-4 md:py-8">
    <h1 class="sr-only">{{ t('nav.home') }}</h1>

    <!-- Narrower than the screens that have the sidebar: the same content, one tap away. -->
    <button
      type="button"
      class="flex min-h-11 items-center gap-3 rounded-xl border border-border px-3 text-left transition-colors duration-150 hover:bg-surface lg:hidden"
      @click="activityOpen = true"
    >
      <span class="flex size-8 items-center justify-center rounded-lg bg-primary-soft text-primary">
        <Users class="size-4" aria-hidden="true" />
      </span>
      <span class="flex-1 font-medium">{{ t('feed.activity') }}</span>
      <ChevronRight class="size-5 text-text-muted" aria-hidden="true" />
    </button>

    <div v-if="!feed.noteDismissed" class="flex items-start gap-2 rounded-xl border border-border bg-primary-soft py-1 pl-3 pr-1 text-sm text-text" role="note">
      <Info class="mt-3 size-4 shrink-0 text-primary" aria-hidden="true" />
      <p class="flex-1 py-2.5">{{ t('feed.note') }}</p>
      <button
        type="button"
        class="flex size-11 shrink-0 items-center justify-center rounded-lg text-text transition-colors duration-150 hover:bg-bg"
        :aria-label="t('feed.dismissNote')"
        @click="feed.dismissNote()"
      >
        <X class="size-4" aria-hidden="true" />
      </button>
    </div>

    <div v-if="feed.status === 'loading' || feed.status === 'idle'" class="flex flex-col gap-4" role="status">
      <span class="sr-only">{{ t('feed.loading') }}</span>
      <PostSkeleton v-for="row in 2" :key="row" />
    </div>

    <ErrorState
      v-else-if="feed.status === 'error'"
      :message="feed.error ? errorMessage(feed.error, t) : t('feed.loadFailed')"
      @retry="feed.reload()"
    />

    <EmptyState v-else-if="feed.posts.length === 0" :icon="Newspaper" :title="t('feed.emptyTitle')" :text="t('feed.emptyText')">
      <BaseButton @click="ui.createMenuOpen = true">{{ t('feed.emptyAction') }}</BaseButton>
    </EmptyState>

    <template v-else>
      <ul class="flex flex-col gap-4">
        <li v-for="(post, index) in feed.posts" :key="post.id">
          <PostCard :post="post" :eager="index < 2" @comments="commentsFor = $event" />
        </li>
      </ul>

      <div v-if="feed.loadingMore" class="flex flex-col gap-4" role="status">
        <span class="sr-only">{{ t('feed.loadingMore') }}</span>
        <PostSkeleton />
      </div>

      <div v-else-if="feed.loadMoreError" class="flex flex-col items-center gap-3 py-4 text-center" role="alert">
        <p class="text-text">{{ t('feed.moreFailed') }}</p>
        <BaseButton variant="secondary" @click="feed.loadMore()">{{ t('common.retry') }}</BaseButton>
      </div>

      <template v-else-if="feed.hasMore">
        <!-- Comes into view: the next page is fetched. Without that browser feature, a button does the same. -->
        <div v-if="observed" ref="marker" class="h-px" aria-hidden="true" />
        <div v-else class="flex justify-center py-2">
          <BaseButton variant="secondary" @click="feed.loadMore()">{{ t('feed.loadMore') }}</BaseButton>
        </div>
      </template>

      <p v-else class="py-4 text-center text-sm text-text-muted">{{ t('feed.end') }}</p>
    </template>

    <CommentsDrawer :post-id="commentsFor" @close="commentsFor = null" />

    <Modal :open="activityOpen" :title="t('feed.activity')" @close="activityOpen = false">
      <ActivityPanel :active="activityOpen" />
    </Modal>
  </div>
</template>
