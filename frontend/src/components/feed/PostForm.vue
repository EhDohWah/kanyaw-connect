<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { isApiError } from '@/api/errors'
import BaseButton from '@/components/common/BaseButton.vue'
import BaseTextarea from '@/components/common/BaseTextarea.vue'
import ImageDropZone from '@/components/feed/ImageDropZone.vue'
import { MAX_CAPTION_LENGTH } from '@/services/feed'
import { useFeedStore } from '@/stores/feed'
import { errorMessage } from '@/utils/errorMessage'

const emit = defineEmits<{ back: []; posted: [] }>()

const { t } = useI18n()
const feed = useFeedStore()

const caption = ref('')
const image = ref<File | null>(null)
const imageProblem = ref('')
const problem = ref('')
const captionProblem = ref('')
const posting = ref(false)

async function submit(): Promise<void> {
  if (posting.value) return

  problem.value = ''
  captionProblem.value = ''
  if (caption.value.trim() === '' && !image.value) {
    problem.value = t('create.needSomething')
    return
  }
  if (caption.value.length > MAX_CAPTION_LENGTH) {
    captionProblem.value = t('create.tooLong', { max: MAX_CAPTION_LENGTH })
    return
  }

  posting.value = true
  try {
    await feed.createPost({ caption: caption.value, image: image.value })
    emit('posted')
  } catch (error) {
    // Nothing is lost: the words and the picture stay for another try.
    problem.value = isApiError(error) ? errorMessage(error, t) : t('create.failed')
  } finally {
    posting.value = false
  }
}
</script>

<template>
  <form class="flex flex-col gap-4" novalidate @submit.prevent="submit">
    <BaseTextarea
      v-model="caption"
      :label="t('create.caption')"
      :placeholder="t('create.captionPlaceholder')"
      :error="captionProblem || undefined"
      :maxlength="MAX_CAPTION_LENGTH"
      rows="3"
      data-autofocus
    />

    <ImageDropZone v-model="image" v-model:problem="imageProblem" />
    <p v-if="imageProblem" class="-mt-2 text-sm text-danger" role="alert">{{ imageProblem }}</p>

    <p v-if="problem" class="text-sm text-danger" role="alert">{{ problem }}</p>
    <p class="text-sm text-text-muted">{{ t('create.sampleNote') }}</p>

    <div class="flex gap-2">
      <BaseButton variant="secondary" :disabled="posting" @click="emit('back')">{{ t('create.back') }}</BaseButton>
      <BaseButton type="submit" class="flex-1" :loading="posting">{{ posting ? t('create.posting') : t('create.submit') }}</BaseButton>
    </div>
  </form>
</template>
