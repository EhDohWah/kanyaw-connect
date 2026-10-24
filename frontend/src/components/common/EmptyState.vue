<script setup lang="ts">
import type { Component } from 'vue'

/** `level`: 1 when the empty state is the whole page (it then gives the page its main heading). */
withDefaults(defineProps<{ icon: Component; title: string; text?: string; level?: 1 | 2 }>(), { text: undefined, level: 2 })
</script>

<template>
  <div class="flex flex-col items-center gap-3 px-6 py-16 text-center">
    <span class="flex size-14 items-center justify-center rounded-xl bg-primary-soft text-primary">
      <component :is="icon" class="size-7" aria-hidden="true" />
    </span>
    <component :is="`h${level}`" class="text-lg font-semibold text-text">{{ title }}</component>
    <p v-if="text" class="max-w-sm text-text-muted">{{ text }}</p>
    <div v-if="$slots.default" class="mt-2"><slot /></div>
  </div>
</template>
