<script setup lang="ts">
import type { Component } from 'vue'

/**
 * The round 64 px buttons of a call (Accept, Decline, End), with the word underneath so the meaning never rests on colour
 * alone. `accept` is green; `end` uses the light red that reads on the dark call screen.
 */
defineProps<{ label: string; icon: Component; tone: 'accept' | 'end'; disabled?: boolean }>()
defineEmits<{ click: [] }>()
</script>

<template>
  <button
    type="button"
    class="group flex min-w-20 flex-col items-center gap-2 rounded-xl p-1 text-sm font-medium text-on-call disabled:opacity-60"
    :disabled="disabled"
    @click="$emit('click')"
  >
    <span
      :class="[
        'flex size-16 items-center justify-center rounded-full transition-transform duration-150 group-active:scale-95 motion-reduce:transition-none',
        tone === 'accept' ? 'bg-success text-on-primary' : 'bg-on-call-danger text-call-bg',
      ]"
      aria-hidden="true"
    >
      <component :is="icon" class="size-7" />
    </span>
    {{ label }}
  </button>
</template>
