<script setup lang="ts">
import { LoaderCircle } from 'lucide-vue-next'
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
    size?: 'md' | 'lg'
    type?: 'button' | 'submit' | 'reset'
    loading?: boolean
    block?: boolean
    disabled?: boolean
  }>(),
  { variant: 'primary', size: 'md', type: 'button', loading: false, block: false, disabled: false },
)

const variantClasses = {
  primary: 'bg-primary text-on-primary hover:bg-primary-hover',
  secondary: 'border border-border bg-bg text-text hover:bg-surface',
  ghost: 'text-text hover:bg-surface',
  danger: 'border border-border bg-bg text-danger hover:bg-danger-soft',
} as const

const classes = computed(() => [
  'inline-flex items-center justify-center gap-2 rounded-lg px-4 font-medium transition-colors duration-150',
  'disabled:cursor-not-allowed disabled:opacity-60',
  props.size === 'lg' ? 'min-h-12 text-base' : 'min-h-11 text-sm',
  props.block ? 'w-full' : '',
  variantClasses[props.variant],
])
</script>

<template>
  <button :type="type" :class="classes" :disabled="disabled || loading" :aria-busy="loading || undefined">
    <LoaderCircle v-if="loading" class="size-4 animate-spin" aria-hidden="true" />
    <slot />
  </button>
</template>
