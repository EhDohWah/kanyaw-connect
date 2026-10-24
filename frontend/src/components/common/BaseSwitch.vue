<script setup lang="ts">
import { useId } from 'vue'

withDefaults(defineProps<{ label: string; hint?: string | undefined; disabled?: boolean; dark?: boolean }>(), {
  hint: undefined,
  disabled: false,
  dark: false,
})

const model = defineModel<boolean>({ default: false })
const id = useId()
</script>

<template>
  <div class="flex items-center justify-between gap-4">
    <div class="min-w-0">
      <span :id="`${id}-label`" :class="['block text-sm font-medium', dark ? 'text-on-call' : 'text-text']">{{ label }}</span>
      <span v-if="hint" :id="`${id}-hint`" :class="['block text-sm', dark ? 'text-on-call-muted' : 'text-text-muted']">{{ hint }}</span>
    </div>
    <!-- 44 px tall to tap; the track inside is the usual size. -->
    <button
      type="button"
      role="switch"
      :aria-checked="model"
      :aria-labelledby="`${id}-label`"
      :aria-describedby="hint ? `${id}-hint` : undefined"
      :disabled="disabled"
      class="group flex min-h-11 shrink-0 items-center rounded-lg px-1 disabled:opacity-50"
      @click="model = !model"
    >
      <span
        :class="[
          'relative h-6 w-11 rounded-full transition-colors duration-150',
          model ? 'bg-primary' : dark ? 'bg-call-raised' : 'bg-border',
        ]"
      >
        <span
          :class="[
            'absolute top-0.5 left-0.5 size-5 rounded-full bg-on-primary shadow-sm transition-transform duration-150 motion-reduce:transition-none',
            model ? 'translate-x-5' : '',
          ]"
        />
      </span>
    </button>
  </div>
</template>
