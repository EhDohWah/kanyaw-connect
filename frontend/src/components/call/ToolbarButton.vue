<script setup lang="ts">
import type { Component } from 'vue'

/** A button in the call toolbar. `pressed` (when given) marks an open panel; `badge` counts what is new. */
defineProps<{ label: string; icon: Component; pressed?: boolean | undefined; badge?: number; danger?: boolean }>()
defineEmits<{ click: [] }>()
</script>

<template>
  <button
    type="button"
    :aria-label="label"
    :aria-pressed="pressed"
    :class="[
      'relative flex size-11 items-center justify-center rounded-lg sm:size-12 transition-colors duration-150',
      danger ? 'bg-danger text-on-primary hover:opacity-90' : pressed ? 'bg-primary text-on-primary hover:bg-primary-hover' : 'bg-call-raised text-on-call hover:bg-call-surface',
    ]"
    @click="$emit('click')"
  >
    <component :is="icon" class="size-5" aria-hidden="true" />
    <span
      v-if="badge"
      class="absolute -top-1 -right-1 flex min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs font-semibold text-on-primary ring-2 ring-call-surface"
      aria-hidden="true"
    >
      {{ badge > 99 ? '99+' : badge }}
    </span>
  </button>
</template>
