<script setup lang="ts">
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'

defineOptions({ inheritAttrs: false })

export interface SelectOption {
  value: string
  label: string
}

const props = withDefaults(
  defineProps<{
    label: string
    options: SelectOption[]
    error?: string | undefined
    hint?: string | undefined
    optional?: boolean
    /** For a dark surface (the call screen). */
    dark?: boolean
  }>(),
  { error: undefined, hint: undefined, optional: false, dark: false },
)

const model = defineModel<string>({ default: '' })

const { t } = useI18n()
const id = useId()

const describedBy = computed(() => {
  const ids = []
  if (props.hint) ids.push(`${id}-hint`)
  if (props.error) ids.push(`${id}-error`)
  return ids.length > 0 ? ids.join(' ') : undefined
})
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label :for="id" :class="['text-sm font-medium', dark ? 'text-on-call' : 'text-text']">
      {{ label }}
      <span v-if="optional" :class="['font-normal', dark ? 'text-on-call-muted' : 'text-text-muted']">({{ t('common.optional') }})</span>
    </label>
    <select
      :id="id"
      v-model="model"
      v-bind="$attrs"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="describedBy"
      :class="[
        'min-h-11 w-full rounded-lg border px-3 transition-colors duration-150',
        dark ? 'border-call-raised bg-call-surface text-on-call hover:border-on-call-muted' : 'bg-bg text-text',
        !dark && (error ? 'border-danger' : 'border-border hover:border-text-muted'),
      ]"
    >
      <option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option>
    </select>
    <p v-if="hint" :id="`${id}-hint`" :class="['text-sm', dark ? 'text-on-call-muted' : 'text-text-muted']">{{ hint }}</p>
    <p v-if="error" :id="`${id}-error`" class="text-sm text-danger">{{ error }}</p>
  </div>
</template>
