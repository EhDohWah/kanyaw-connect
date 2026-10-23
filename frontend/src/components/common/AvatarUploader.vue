<script setup lang="ts">
import { Camera } from 'lucide-vue-next'
import { onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { isApiError } from '@/api/errors'
import BaseButton from '@/components/common/BaseButton.vue'
import UserAvatar from '@/components/common/UserAvatar.vue'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { errorMessage } from '@/utils/errorMessage'
import { AVATAR_TYPES, AvatarError, prepareAvatar } from '@/utils/image'

const { t } = useI18n()
const auth = useAuthStore()
const ui = useUiStore()

const fileInput = ref<HTMLInputElement | null>(null)
const pending = ref<File | null>(null)
const previewUrl = ref<string | null>(null)
const error = ref('')
const progress = ref<number | null>(null)

function forgetPreview(): void {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = null
  pending.value = null
}
onBeforeUnmount(forgetPreview)

async function onFileChosen(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // so choosing the same file again still counts as a change
  if (!file) return

  error.value = ''
  try {
    const ready = await prepareAvatar(file)
    forgetPreview()
    pending.value = ready
    previewUrl.value = URL.createObjectURL(ready)
  } catch (problem) {
    if (!(problem instanceof AvatarError)) throw problem
    error.value = {
      type: t('profile.photoType'),
      'too-big': t('profile.photoTooBig'),
      unreadable: t('profile.photoUnreadable'),
    }[problem.problem]
  }
}

async function upload(): Promise<void> {
  if (!pending.value) return

  error.value = ''
  progress.value = 0
  try {
    await auth.uploadAvatar(pending.value, (percent) => {
      progress.value = percent
    })
    forgetPreview()
    ui.toast(t('profile.photoUpdated'))
  } catch (problem) {
    if (!isApiError(problem)) throw problem
    error.value = problem.status === 422 ? (problem.fieldError('avatar') ?? problem.message) : errorMessage(problem, t)
  } finally {
    progress.value = null
  }
}
</script>

<template>
  <section v-if="auth.user" class="flex flex-col items-start gap-4" :aria-label="t('profile.photo')">
    <div class="flex items-center gap-5">
      <UserAvatar :name="auth.user.name" :seed="auth.user.id" :src="previewUrl ?? auth.user.avatar_thumb_url" size="xl" />
      <div class="flex flex-col items-start gap-2">
        <template v-if="pending">
          <div class="flex flex-wrap gap-2">
            <BaseButton :loading="progress !== null" @click="upload">{{ t('profile.savePhoto') }}</BaseButton>
            <BaseButton variant="ghost" :disabled="progress !== null" @click="forgetPreview">
              {{ t('common.cancel') }}
            </BaseButton>
          </div>
          <div v-if="progress !== null" class="w-48" role="status">
            <div class="h-1.5 overflow-hidden rounded-lg bg-surface">
              <div class="h-full bg-primary transition-[width] duration-200" :style="{ width: `${progress}%` }" />
            </div>
            <p class="mt-1 text-sm text-text-muted">{{ t('profile.uploading', { percent: progress }) }}</p>
          </div>
        </template>
        <BaseButton v-else variant="secondary" @click="fileInput?.click()">
          <Camera class="size-4" aria-hidden="true" />
          {{ t('profile.changePhoto') }}
        </BaseButton>
      </div>
    </div>
    <input
      ref="fileInput"
      type="file"
      class="sr-only"
      tabindex="-1"
      :accept="AVATAR_TYPES.join(',')"
      :aria-label="t('profile.changePhoto')"
      @change="onFileChosen"
    />
    <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>
  </section>
</template>
