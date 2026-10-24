<script setup lang="ts">
import type { Component } from 'vue'

/**
 * A microphone or camera switch on a dark surface. On: dark with the plain icon. Off: light with the crossed-out icon,
 * so the state is clear at a glance, not only by colour. The label stays the same; `aria-pressed` says on or off.
 */
defineProps<{ on: boolean; label: string; icon: Component; offIcon: Component; busy?: boolean; disabled?: boolean }>()
defineEmits<{ toggle: [] }>()
</script>

<template>
  <button
    type="button"
    :aria-label="label"
    :aria-pressed="on"
    :aria-busy="busy || undefined"
    :disabled="disabled"
    :class="[
      'flex size-11 items-center justify-center rounded-lg sm:size-12 transition-colors duration-150 disabled:opacity-50',
      on ? 'bg-call-raised text-on-call hover:bg-call-surface' : 'bg-on-call text-call-bg hover:bg-on-call-muted',
    ]"
    @click="$emit('toggle')"
  >
    <component :is="on ? icon : offIcon" class="size-5" aria-hidden="true" />
  </button>
</template>
