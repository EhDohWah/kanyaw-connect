<script setup lang="ts">
import { ImagePlus, X } from 'lucide-vue-next'
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { checkPostImage, PostImageError } from '@/utils/postImage'

/** One picture for a post: dropped onto the zone, or chosen with the file picker (on a phone that offers the camera too). */
const model = defineModel<File | null>({ default: null })
const problem = defineModel<string>('problem', { default: '' })

const { t } = useI18n()
const input = ref<HTMLInputElement | null>(null)
const dragging = ref(false)
const previewUrl = ref<string | null>(null)

watch(
  model,
  (file) => {
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
    previewUrl.value = file ? URL.createObjectURL(file) : null
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
})

// A file dropped a little beside the zone would make the browser leave the page to show it, and the post would be lost.
const keepPage = (event: DragEvent): void => {
  if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
}
onMounted(() => {
  window.addEventListener('dragover', keepPage)
  window.addEventListener('drop', keepPage)
})
onBeforeUnmount(() => {
  window.removeEventListener('dragover', keepPage)
  window.removeEventListener('drop', keepPage)
})

function choose(file: File | undefined): void {
  if (!file) return
  try {
    checkPostImage(file)
  } catch (error) {
    const kind = error instanceof PostImageError ? error.problem : 'unreadable'
    problem.value = kind === 'type' ? t('create.typeError') : kind === 'too-big' ? t('create.tooBig') : t('create.unreadable')
    return
  }
  problem.value = ''
  model.value = file
}

function onChange(event: Event): void {
  const target = event.target as HTMLInputElement
  choose(target.files?.[0])
  // The same file can be chosen again after it was removed.
  target.value = ''
}

function onDrop(event: DragEvent): void {
  dragging.value = false
  choose(event.dataTransfer?.files?.[0])
}

async function remove(): Promise<void> {
  model.value = null
  problem.value = ''
  // The zone comes back in place of the picture: the button that had the focus is gone, so the zone takes it.
  await nextTick()
  input.value?.focus()
}

/** Moving over the zone's own text and icon makes `dragleave` fire for them: only leaving the whole zone counts. */
function onDragLeave(event: DragEvent): void {
  const zone = event.currentTarget as HTMLElement
  if (!(event.relatedTarget instanceof Node) || !zone.contains(event.relatedTarget)) dragging.value = false
}

/** The browser could not draw the file (a picture type it does not know): say so and take it away. */
function onUnreadable(): void {
  model.value = null
  problem.value = t('create.unreadable')
}
</script>

<template>
  <div>
    <!-- The same square the feed will show (so the crop is no surprise), kept small so the Post button stays in view. -->
    <div v-if="model && previewUrl" class="relative mx-auto w-full max-w-64 overflow-hidden rounded-xl border border-border bg-surface">
      <img :src="previewUrl" :alt="t('create.previewAlt')" class="aspect-square w-full object-cover" @error="onUnreadable" />
      <button
        type="button"
        class="absolute right-2 top-2 flex size-11 items-center justify-center rounded-lg bg-text/70 text-on-primary transition-colors duration-150 hover:bg-text"
        :aria-label="t('create.remove')"
        @click="remove"
      >
        <X class="size-5" aria-hidden="true" />
      </button>
    </div>

    <!-- A label, so a tap or click opens the picker; the real input is inside it, so the keyboard works too. -->
    <label
      v-else
      :class="[
        'flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary',
        dragging ? 'border-primary bg-primary-soft' : 'border-border hover:bg-surface',
      ]"
      @dragenter.prevent="dragging = true"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="onDragLeave"
      @drop.prevent="onDrop"
    >
      <ImagePlus class="size-8 text-primary" aria-hidden="true" />
      <span class="font-medium text-text">{{ dragging ? t('create.dropActive') : t('create.dropTitle') }}</span>
      <span class="text-sm text-text-muted">{{ t('create.dropHint') }}</span>
      <input ref="input" type="file" accept="image/*" class="sr-only" :aria-label="t('create.picture')" @change="onChange" />
    </label>
  </div>
</template>
