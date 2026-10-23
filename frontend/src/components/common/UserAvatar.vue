<script setup lang="ts">
// Decorative: the person's name is always written next to their picture, so screen readers skip it.
import { computed, ref, watch } from 'vue'

import { avatarColorIndex, initials } from '@/utils/initials'

const props = withDefaults(
  defineProps<{
    name: string
    /** Use the 256 px thumbnail (`avatar_thumb_url`) in lists. */
    src?: string | null
    /** Colour seed: the user's id keeps the colour stable if they rename themselves. */
    seed?: string
    size?: 'sm' | 'md' | 'lg' | 'xl'
  }>(),
  { src: null, seed: undefined, size: 'md' },
)

// Written out in full so Tailwind can see every class.
const COLORS = [
  'bg-avatar-1',
  'bg-avatar-2',
  'bg-avatar-3',
  'bg-avatar-4',
  'bg-avatar-5',
  'bg-avatar-6',
  'bg-avatar-7',
  'bg-avatar-8',
] as const

const SIZES = {
  sm: 'size-8 text-xs',
  md: 'size-10 text-sm',
  lg: 'size-16 text-xl',
  xl: 'size-28 text-3xl',
} as const

const failed = ref(false)
watch(
  () => props.src,
  () => {
    failed.value = false
  },
)

const color = computed(() => COLORS[avatarColorIndex(props.seed ?? props.name) - 1])
const showImage = computed(() => Boolean(props.src) && !failed.value)
</script>

<template>
  <span
    :class="[
      'inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-semibold text-on-primary',
      SIZES[size],
      showImage ? 'bg-surface' : color,
    ]"
    aria-hidden="true"
  >
    <img
      v-if="showImage"
      :src="src ?? undefined"
      alt=""
      class="size-full object-cover"
      loading="lazy"
      decoding="async"
      @error="failed = true"
    />
    <template v-else>{{ initials(name) }}</template>
  </span>
</template>
