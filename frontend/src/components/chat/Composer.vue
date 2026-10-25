<script setup lang="ts">
import { FileText, Mic, Paperclip, SendHorizontal, X } from 'lucide-vue-next'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { isApiError } from '@/api/errors'
import { MAX_ATTACHMENT_BYTES } from '@/api/attachments'
import VoiceRecorderBar from '@/components/chat/VoiceRecorderBar.vue'
import { useMediaQuery } from '@/composables/useMediaQuery'
import { recordingSupported, useVoiceRecorder, type RecorderProblem } from '@/composables/useVoiceRecorder'
import { realtime } from '@/realtime'
import { useAuthStore } from '@/stores/auth'
import { useDraftsStore } from '@/stores/drafts'
import { useMessagesStore } from '@/stores/messages'
import type { Chat } from '@/types/chat'
import { personById } from '@/utils/chatText'
import { errorMessage } from '@/utils/errorMessage'
import { formatBytes, messageTypeForFile } from '@/utils/files'

/** The API's limit for a message's text (docs/API.md, 8.1). */
const MAX_LENGTH = 5000
const MAX_BOX_HEIGHT_PX = 160

const props = defineProps<{ chat: Chat }>()
const emit = defineEmits<{ sent: [] }>()

const { t } = useI18n()
const auth = useAuthStore()
const messages = useMessagesStore()
const drafts = useDraftsStore()

const draft = computed(() => drafts.get(props.chat.id))
const box = ref<HTMLTextAreaElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const file = ref<File | null>(null)
const previewUrl = ref<string | null>(null)
const problem = ref('')
const saving = ref(false)

// On a phone Enter is a new line (the send button sends); with a keyboard and mouse Enter sends.
const coarsePointer = useMediaQuery('(pointer: coarse)')

const editing = computed(() => {
  const id = draft.value.editingId
  return id ? messages.timeline(props.chat.id)?.messages.find((message) => message.id === id) : undefined
})
const replyingTo = computed(() => {
  const id = draft.value.replyToId
  return id ? messages.timeline(props.chat.id)?.messages.find((message) => message.id === id) : undefined
})
const replyName = computed(() => {
  const target = replyingTo.value
  if (!target) return ''
  if (target.sender_id === auth.user?.id) return t('common.you')
  return target.sender?.name ?? (target.sender_id ? personById(props.chat, target.sender_id)?.name : undefined) ?? t('chat.someone')
})
const replySnippet = computed(() => {
  const target = replyingTo.value
  if (!target) return ''
  return target.content ?? { image: t('chat.preview.photo'), voice: t('chat.preview.voice'), file: t('chat.preview.file') }[target.type as 'image' | 'voice' | 'file'] ?? ''
})

/* ------------------------------------------------------------------------------------ voice messages --- */

const recorder = useVoiceRecorder()
/** Where the browser cannot record (no MediaRecorder or microphone), there is no button; attaching files still works. */
const canRecord = recordingSupported()
const micButton = ref<HTMLButtonElement | null>(null)
/** With nothing typed or attached, the send button is the microphone. */
const showMic = computed(() => canRecord && !editing.value && draft.value.text.trim() === '' && file.value === null)
const recorderOpen = computed(() => recorder.state.value !== 'idle')

function recorderProblemText(kind: RecorderProblem): string {
  if (kind === 'too-short') return t('voice.tooShort')
  // The same words as the meeting's pre-join screen.
  if (kind === 'blocked') return t('voice.micBlocked')
  return t(`call.media.microphone.${kind}`)
}

watch(recorder.problem, (kind) => {
  if (!kind) return
  problem.value = recorderProblemText(kind)
  recorder.dismissProblem()
  void nextTick(() => micButton.value?.focus())
})

function startRecording(): void {
  problem.value = ''
  void recorder.start()
}

function cancelRecording(): void {
  recorder.cancel()
  void nextTick(() => micButton.value?.focus())
}

async function sendVoice(): Promise<void> {
  if (!auth.user) return
  const taken = await recorder.take()
  if (!taken) return

  const replyToId = draft.value.replyToId
  draft.value.replyToId = null
  emit('sent')
  void nextTick(() => micButton.value?.focus())

  // The same optimistic send as any message: it shows at once and plays from the recording, which stays in memory
  // until it is sent; a retry does not upload again once the upload has gone through.
  await messages.send(props.chat.id, {
    type: 'voice',
    content: '',
    replyToId,
    file: taken.file,
    voice: { durationMs: taken.durationMs, waveform: taken.waveform },
  })
}

const canSend = computed(() => {
  if (saving.value) return false
  if (editing.value) return draft.value.text.trim() !== '' && draft.value.text.trim() !== editing.value.content
  return draft.value.text.trim() !== '' || file.value !== null
})

/* ----------------------------------------------------------------------------------------- the box --- */

function grow(): void {
  const el = box.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, MAX_BOX_HEIGHT_PX)}px`
}

function onInput(): void {
  problem.value = ''
  grow()
  if (auth.user && !editing.value) realtime.sendTyping(props.chat.id, auth.user.id, draft.value.text.length > 0)
}

function focusBox(): void {
  void nextTick(() => {
    box.value?.focus()
    grow()
  })
}

// Starting a reply or an edit puts the cursor in the box (an edit also fills it with the text).
watch(
  () => draft.value.replyToId,
  (id) => id && focusBox(),
)
watch(
  () => draft.value.editingId,
  (id) => {
    if (!id) return
    const target = messages.timeline(props.chat.id)?.messages.find((message) => message.id === id)
    draft.value.text = target?.content ?? ''
    focusBox()
  },
)

function onKeydown(event: KeyboardEvent): void {
  // Input methods for Burmese and Karen use Enter to choose a word: never treat that as "send".
  if (event.isComposing || event.keyCode === 229) return

  if (event.key === 'Escape' && (draft.value.editingId || draft.value.replyToId)) {
    event.preventDefault()
    cancelBar()
    return
  }
  if (event.key === 'Enter' && !event.shiftKey && !coarsePointer.value) {
    event.preventDefault()
    void submit()
  }
}

function cancelBar(): void {
  if (draft.value.editingId) draft.value.text = ''
  draft.value.editingId = null
  draft.value.replyToId = null
  void nextTick(grow)
}

/* ------------------------------------------------------------------------------------- attachments --- */

function clearFile(): void {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = null
  file.value = null
}
onBeforeUnmount(clearFile)

function onFileChosen(event: Event): void {
  const input = event.target as HTMLInputElement
  const chosen = input.files?.[0]
  input.value = '' // so choosing the same file again still counts
  if (!chosen) return

  problem.value = ''
  if (chosen.size > MAX_ATTACHMENT_BYTES) {
    problem.value = t('chat.composer.tooLarge')
    return
  }
  clearFile()
  file.value = chosen
  if (chosen.type.startsWith('image/')) previewUrl.value = URL.createObjectURL(chosen)
}

/* --------------------------------------------------------------------------------------- sending --- */

async function submit(): Promise<void> {
  if (!canSend.value || !auth.user) return
  problem.value = ''

  const text = draft.value.text.trim()
  realtime.sendTyping(props.chat.id, auth.user.id, false)

  if (editing.value) {
    saving.value = true
    try {
      await messages.edit(editing.value, text)
      draft.value.editingId = null
      draft.value.text = ''
      void nextTick(grow)
    } catch (error) {
      problem.value = isApiError(error) ? errorMessage(error, t) : t('chat.composer.editFailed')
    } finally {
      saving.value = false
    }
    return
  }

  const chosen = file.value
  const replyToId = draft.value.replyToId
  // The box empties at once; the message shows up in the conversation as "sending" and the rest happens there.
  draft.value.text = ''
  draft.value.replyToId = null
  clearFile()
  void nextTick(grow)
  emit('sent')

  await messages.send(props.chat.id, {
    type: chosen ? messageTypeForFile(chosen) : 'text',
    content: text,
    replyToId,
    file: chosen,
  })
}

defineExpose({ focus: focusBox, startRecording })
</script>

<template>
  <form class="border-t border-border bg-bg px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2" @submit.prevent="submit">
    <!-- Replying or editing: what the message will be, with a way out. -->
    <div v-if="replyingTo || editing" class="mb-2 flex items-center gap-2 rounded-lg bg-primary-soft py-1 pl-3 pr-1">
      <div class="min-w-0 flex-1 border-l-4 border-primary pl-2">
        <p class="truncate text-xs font-semibold text-primary">
          {{ editing ? t('chat.composer.editing') : t('chat.composer.replyingTo', { name: replyName }) }}
        </p>
        <p v-if="replyingTo" class="truncate text-sm text-text">{{ replySnippet }}</p>
      </div>
      <button
        type="button"
        class="flex size-11 shrink-0 items-center justify-center rounded-lg text-text transition-colors duration-150 hover:bg-bg"
        :aria-label="editing ? t('chat.composer.cancelEdit') : t('chat.composer.cancelReply')"
        @click="cancelBar"
      >
        <X class="size-4" aria-hidden="true" />
      </button>
    </div>

    <!-- A chosen file, before it is sent. -->
    <div v-if="file" class="mb-2 flex items-center gap-3 rounded-lg border border-border p-2">
      <img v-if="previewUrl" :src="previewUrl" alt="" class="size-12 shrink-0 rounded-lg object-cover" />
      <FileText v-else class="size-8 shrink-0 text-text-muted" aria-hidden="true" />
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-medium">{{ file.name }}</p>
        <p class="text-xs text-text-muted">{{ formatBytes(file.size) }}</p>
      </div>
      <button
        type="button"
        class="flex size-11 shrink-0 items-center justify-center rounded-lg text-text transition-colors duration-150 hover:bg-surface"
        :aria-label="t('chat.composer.removeAttachment')"
        @click="clearFile"
      >
        <X class="size-4" aria-hidden="true" />
      </button>
    </div>

    <p v-if="problem" class="mb-2 text-sm text-danger" role="alert">{{ problem }}</p>

    <!-- Recording, or listening to the recording before sending: in place of the box. -->
    <VoiceRecorderBar
      v-if="recorderOpen"
      :state="recorder.state.value"
      :elapsed-ms="recorder.elapsedMs.value"
      :level="recorder.level.value"
      :recording="recorder.recording.value"
      :notice="recorder.notice.value"
      :preview-id="`preview:${chat.id}`"
      @cancel="cancelRecording"
      @stop="recorder.stop()"
      @send="sendVoice"
    />

    <div v-else class="flex items-end gap-2">
      <button
        v-if="!editing"
        type="button"
        class="flex size-11 shrink-0 items-center justify-center rounded-lg text-text transition-colors duration-150 hover:bg-surface"
        :aria-label="t('chat.composer.attach')"
        @click="fileInput?.click()"
      >
        <Paperclip class="size-5" aria-hidden="true" />
      </button>
      <input ref="fileInput" type="file" class="sr-only" tabindex="-1" aria-hidden="true" @change="onFileChosen" />

      <textarea
        ref="box"
        v-model="draft.text"
        rows="1"
        :maxlength="MAX_LENGTH"
        :placeholder="file ? t('chat.composer.captionPlaceholder') : t('chat.composer.placeholder')"
        :aria-label="t('chat.composer.placeholder')"
        class="max-h-40 min-h-11 flex-1 resize-none rounded-lg border border-border bg-bg px-3 py-2.5 text-text transition-colors duration-150 placeholder:text-text-muted hover:border-text-muted"
        @input="onInput"
        @keydown="onKeydown"
      />

      <button
        v-if="showMic"
        ref="micButton"
        type="button"
        class="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary text-on-primary transition-colors duration-150 hover:bg-primary-hover"
        :aria-label="t('voice.record')"
        @click="startRecording"
      >
        <Mic class="size-5" aria-hidden="true" />
      </button>
      <button
        v-else
        type="submit"
        class="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary text-on-primary transition-colors duration-150 hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
        :disabled="!canSend"
        :aria-label="editing ? t('chat.composer.saveEdit') : t('chat.composer.send')"
      >
        <SendHorizontal class="size-5" aria-hidden="true" />
      </button>
    </div>
  </form>
</template>
