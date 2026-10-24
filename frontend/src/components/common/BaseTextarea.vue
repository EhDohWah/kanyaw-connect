<script setup lang="ts">
import { computed, useId } from 'vue'

defineOptions({ inheritAttrs: false })

const props = defineProps<{ label: string; error?: string | undefined; optional?: boolean; optionalLabel?: string }>()
const model = defineModel<string>({ default: '' })

const id = useId()
const describedBy = computed(() => (props.error ? `${id}-error` : undefined))
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label :for="id" class="text-sm font-medium text-text">
      {{ label }}
      <span v-if="optional" class="font-normal text-text-muted">({{ optionalLabel }})</span>
    </label>
    <textarea
      :id="id"
      v-model="model"
      v-bind="$attrs"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="describedBy"
      :class="[
        'min-h-24 w-full resize-y rounded-lg border bg-bg px-3 py-2.5 text-text transition-colors duration-150 placeholder:text-text-muted',
        error ? 'border-danger' : 'border-border hover:border-text-muted',
      ]"
    />
    <p v-if="error" :id="`${id}-error`" class="text-sm text-danger">{{ error }}</p>
  </div>
</template>
