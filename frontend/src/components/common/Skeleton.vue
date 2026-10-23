<script setup lang="ts">
/** A grey block that pulses while content loads. Hidden from screen readers; the loading text is announced by the parent. */
defineProps<{ rounded?: 'lg' | 'xl' | 'full' }>()
</script>

<template>
  <div
    :class="['animate-pulse bg-surface', rounded === 'full' ? 'rounded-full' : rounded === 'xl' ? 'rounded-xl' : 'rounded-lg']"
    aria-hidden="true"
  />
</template>
