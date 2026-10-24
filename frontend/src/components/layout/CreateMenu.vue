<script setup lang="ts">
import { ImagePlus, Video } from 'lucide-vue-next'
import { nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import { isApiError } from '@/api/errors'
import Modal from '@/components/common/Modal.vue'
import PostForm from '@/components/feed/PostForm.vue'
import { useAuthStore } from '@/stores/auth'
import { useRoomsStore } from '@/stores/rooms'
import { useUiStore } from '@/stores/ui'
import { errorMessage } from '@/utils/errorMessage'

/** The longest a room name may be (docs/API.md, POST /rooms). */
const MAX_ROOM_NAME = 120

const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const auth = useAuthStore()
const rooms = useRoomsStore()
const ui = useUiStore()

const step = ref<'menu' | 'post'>('menu')
const starting = ref(false)
const meetingProblem = ref('')
const postButton = ref<HTMLButtonElement | null>(null)
const formHost = ref<HTMLElement | null>(null)

// Every time the dialog opens it starts from the two choices.
watch(
  () => ui.createMenuOpen,
  (open) => {
    if (!open) return
    step.value = 'menu'
    meetingProblem.value = ''
  },
)

// The control that had the focus is gone after a step change: move it to where the person goes next.
watch(step, async (next) => {
  await nextTick()
  if (next === 'post') formHost.value?.querySelector<HTMLElement>('[data-autofocus]')?.focus()
  else postButton.value?.focus()
})

async function startMeeting(): Promise<void> {
  if (starting.value) return

  starting.value = true
  meetingProblem.value = ''
  try {
    const name = t('create.defaultMeetingName', { name: auth.user?.name ?? '' }).slice(0, MAX_ROOM_NAME).trim()
    const room = await rooms.create({ name })
    ui.createMenuOpen = false
    await router.push({ name: 'room', params: { id: room.id } })
  } catch (error) {
    meetingProblem.value = isApiError(error) ? errorMessage(error, t) : t('create.meetingFailed')
  } finally {
    starting.value = false
  }
}

async function posted(): Promise<void> {
  ui.createMenuOpen = false
  ui.toast(t('create.posted'))
  // Where the new post can be seen.
  if (route.name !== 'home') await router.push({ name: 'home' })
}
</script>

<template>
  <Modal :open="ui.createMenuOpen" :title="step === 'post' ? t('create.postTitle') : t('create.title')" @close="ui.createMenuOpen = false">
    <div v-if="step === 'post'" ref="formHost">
      <PostForm @back="step = 'menu'" @posted="posted" />
    </div>

    <template v-else>
      <ul class="flex flex-col gap-2">
        <li>
          <button
            ref="postButton"
            type="button"
            class="flex min-h-14 w-full items-center gap-3 rounded-xl border border-border p-3 text-left transition-colors duration-150 hover:bg-surface"
            @click="step = 'post'"
          >
            <span class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
              <ImagePlus class="size-5" aria-hidden="true" />
            </span>
            <span class="flex-1">
              <span class="block font-medium text-text">{{ t('create.post') }}</span>
              <span class="block text-sm text-text-muted">{{ t('create.postHint') }}</span>
            </span>
          </button>
        </li>
        <li>
          <button
            type="button"
            class="flex min-h-14 w-full items-center gap-3 rounded-xl border border-border p-3 text-left transition-colors duration-150 hover:bg-surface disabled:opacity-60"
            :disabled="starting"
            :aria-busy="starting || undefined"
            @click="startMeeting"
          >
            <span class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
              <Video class="size-5" aria-hidden="true" />
            </span>
            <span class="flex-1">
              <span class="block font-medium text-text">{{ t('create.meeting') }}</span>
              <span class="block text-sm text-text-muted">{{ starting ? t('create.starting') : t('create.meetingHint') }}</span>
            </span>
          </button>
        </li>
      </ul>
      <p v-if="meetingProblem" class="mt-3 text-sm text-danger" role="alert">{{ meetingProblem }}</p>
    </template>
  </Modal>
</template>
