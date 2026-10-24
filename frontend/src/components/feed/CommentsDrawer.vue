<script setup lang="ts">
import { SendHorizontal } from 'lucide-vue-next'
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import CommentItem from '@/components/feed/CommentItem.vue'
import ErrorState from '@/components/common/ErrorState.vue'
import Modal from '@/components/common/Modal.vue'
import Skeleton from '@/components/common/Skeleton.vue'
import BaseButton from '@/components/common/BaseButton.vue'
import { useAutoGrow } from '@/composables/useAutoGrow'
import { useMediaQuery } from '@/composables/useMediaQuery'
import { isApiError } from '@/api/errors'
import { MAX_COMMENT_LENGTH } from '@/services/feed'
import { useFeedStore } from '@/stores/feed'
import { errorMessage } from '@/utils/errorMessage'

/** Which post's comments are open: `null` means closed. A bottom sheet on phones, a side drawer from 768 px. */
const props = defineProps<{ postId: string | null }>()
const emit = defineEmits<{ close: [] }>()

const MAX_BOX_HEIGHT_PX = 128

const { t } = useI18n()
const feed = useFeedStore()
const finePointer = useMediaQuery('(pointer: fine)')

const text = ref('')
const sending = ref(false)
const problem = ref('')
const box = ref<HTMLTextAreaElement | null>(null)
const list = ref<HTMLElement | null>(null)
const grow = useAutoGrow(box, MAX_BOX_HEIGHT_PX)

// Read, never created here: the thread is made when the drawer opens (see the watcher below).
const thread = computed(() => (props.postId ? (feed.threads[props.postId] ?? null) : null))
const canSend = computed(() => text.value.trim() !== '' && !sending.value)

function toEnd(): void {
  void nextTick(() => {
    const body = list.value?.closest<HTMLElement>('.overflow-y-auto')
    if (body) body.scrollTop = body.scrollHeight
  })
}

watch(
  () => props.postId,
  (id) => {
    text.value = ''
    problem.value = ''
    void nextTick(grow)
    if (id) void feed.openComments(id)
  },
  { immediate: true },
)

async function send(): Promise<void> {
  const id = props.postId
  if (!id || !canSend.value) return

  sending.value = true
  problem.value = ''
  try {
    await feed.addComment(id, text.value)
    text.value = ''
    void nextTick(grow)
    toEnd()
  } catch (error) {
    // The words stay in the box: nothing typed is lost.
    problem.value = isApiError(error) ? errorMessage(error, t) : t('feed.comments.failed')
  } finally {
    sending.value = false
  }
}

function onKeydown(event: KeyboardEvent): void {
  // Input methods for Burmese and Karen use Enter to choose a word: never treat that as "send".
  if (event.isComposing || event.keyCode === 229) return
  if (event.key === 'Enter' && !event.shiftKey && finePointer.value) {
    event.preventDefault()
    void send()
  }
}
</script>

<template>
  <Modal :open="postId !== null" :title="t('feed.comments.title')" placement="side" @close="emit('close')">
    <div ref="list">
      <div v-if="!thread || thread.status === 'loading'" class="flex flex-col gap-4" role="status">
        <span class="sr-only">{{ t('feed.comments.loading') }}</span>
        <div v-for="row in 3" :key="row" class="flex gap-3" aria-hidden="true">
          <Skeleton rounded="full" class="size-8 shrink-0" />
          <div class="flex flex-1 flex-col gap-2">
            <Skeleton class="h-3.5 w-28" />
            <Skeleton class="h-4 w-full" />
          </div>
        </div>
      </div>

      <ErrorState
        v-else-if="thread.status === 'error' && thread.items.length === 0"
        :message="thread.error ? errorMessage(thread.error, t) : t('feed.comments.loadFailed')"
        @retry="postId && feed.openComments(postId)"
      />

      <p v-else-if="thread.items.length === 0" class="py-8 text-center text-text-muted">{{ t('feed.comments.empty') }}</p>

      <template v-else>
        <ul class="flex flex-col gap-4" :aria-label="t('feed.comments.title')">
          <CommentItem v-for="comment in thread.items" :key="comment.id" :comment="comment" />
        </ul>
        <div class="mt-4 flex justify-center">
          <BaseButton
            v-if="thread.nextCursor !== null"
            variant="secondary"
            :loading="thread.loadingMore"
            @click="postId && feed.loadMoreComments(postId)"
          >
            {{ thread.loadingMore ? t('feed.comments.loadingMore') : t('feed.comments.loadMore') }}
          </BaseButton>
        </div>
        <p v-if="thread.error" class="mt-3 text-center text-sm text-danger" role="alert">{{ errorMessage(thread.error, t) }}</p>
      </template>
    </div>

    <template #footer>
      <form class="flex flex-col gap-2" @submit.prevent="send">
        <p v-if="problem" class="text-sm text-danger" role="alert">{{ problem }}</p>
        <div class="flex items-end gap-2">
          <textarea
            ref="box"
            v-model="text"
            rows="1"
            :maxlength="MAX_COMMENT_LENGTH"
            :aria-label="t('feed.comments.label')"
            :placeholder="t('feed.comments.placeholder')"
            :data-autofocus="finePointer ? '' : undefined"
            class="max-h-32 min-h-11 flex-1 resize-none rounded-lg border border-border bg-bg px-3 py-2.5 text-text transition-colors duration-150 placeholder:text-text-muted hover:border-text-muted"
            @input="grow"
            @keydown="onKeydown"
          />
          <button
            type="submit"
            class="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary text-on-primary transition-colors duration-150 hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
            :disabled="!canSend"
            :aria-label="sending ? t('feed.comments.sending') : t('feed.comments.send')"
          >
            <SendHorizontal class="size-5" aria-hidden="true" />
          </button>
        </div>
      </form>
    </template>
  </Modal>
</template>
