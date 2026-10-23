<script setup lang="ts">
import { Eye, EyeOff } from 'lucide-vue-next'
import { computed, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    label: string
    type?: string
    error?: string | undefined
    hint?: string | undefined
    optional?: boolean
  }>(),
  { type: 'text', error: undefined, hint: undefined, optional: false },
)

const model = defineModel<string>({ default: '' })

const { t } = useI18n()
const id = useId()
const revealed = ref(false)

const isPassword = computed(() => props.type === 'password')
const inputType = computed(() => (isPassword.value && revealed.value ? 'text' : props.type))
const describedBy = computed(() => {
  const ids = []
  if (props.hint) ids.push(`${id}-hint`)
  if (props.error) ids.push(`${id}-error`)
  return ids.length > 0 ? ids.join(' ') : undefined
})
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label :for="id" class="text-sm font-medium text-text">
      {{ label }}
      <span v-if="optional" class="font-normal text-text-muted">({{ t('common.optional') }})</span>
    </label>

    <div class="relative">
      <input
        :id="id"
        v-model="model"
        v-bind="$attrs"
        :type="inputType"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="describedBy"
        :class="[
          'min-h-11 w-full rounded-lg border bg-bg px-3 text-text transition-colors duration-150 placeholder:text-text-muted',
          error ? 'border-danger' : 'border-border hover:border-text-muted',
          isPassword ? 'pr-12' : '',
        ]"
      />
      <button
        v-if="isPassword"
        type="button"
        class="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-lg text-text-muted transition-colors duration-150 hover:text-text"
        :aria-label="revealed ? t('common.hidePassword') : t('common.showPassword')"
        :aria-pressed="revealed"
        @click="revealed = !revealed"
      >
        <EyeOff v-if="revealed" class="size-5" aria-hidden="true" />
        <Eye v-else class="size-5" aria-hidden="true" />
      </button>
    </div>

    <p v-if="hint" :id="`${id}-hint`" class="text-sm text-text-muted">{{ hint }}</p>
    <p v-if="error" :id="`${id}-error`" class="text-sm text-danger">{{ error }}</p>
  </div>
</template>
