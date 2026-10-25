<script setup lang="ts">
import { computed, ref } from 'vue'

import TrackVideo from '@/components/call/TrackVideo.vue'
import type { VideoTrackLike } from '@/types/call'

/**
 * The small picture-in-picture: drag it to any corner (it snaps to the nearest one), tap it to swap places with the big
 * video. Works with a finger, a mouse and the keyboard (Enter swaps, the arrow keys move it to another corner).
 */
export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

const props = defineProps<{ track: VideoTrackLike; mirror: boolean; label: string }>()
const emit = defineEmits<{ swap: [] }>()

const corner = defineModel<Corner>('corner', { default: 'bottom-right' })

/** A press that moves less than this is a tap. */
const TAP_SLOP_PX = 8

const offset = ref<{ x: number; y: number } | null>(null)
let start: { x: number; y: number } | null = null

const position = computed(() => {
  const [vertical, horizontal] = corner.value.split('-') as ['top' | 'bottom', 'left' | 'right']
  return [vertical === 'top' ? 'top-20' : 'bottom-28', horizontal === 'left' ? 'left-4' : 'right-4']
})

function onPointerDown(event: PointerEvent): void {
  start = { x: event.clientX, y: event.clientY }
  offset.value = { x: 0, y: 0 }
  ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
}

function onPointerMove(event: PointerEvent): void {
  if (!start) return
  offset.value = { x: event.clientX - start.x, y: event.clientY - start.y }
}

function onPointerUp(event: PointerEvent): void {
  if (!start) return
  const moved = offset.value ?? { x: 0, y: 0 }
  start = null
  offset.value = null
  if (Math.hypot(moved.x, moved.y) < TAP_SLOP_PX) {
    emit('swap')
    return
  }
  // Snap to the corner nearest to where it was let go.
  corner.value = `${event.clientY < window.innerHeight / 2 ? 'top' : 'bottom'}-${event.clientX < window.innerWidth / 2 ? 'left' : 'right'}`
}

function onKeydown(event: KeyboardEvent): void {
  const [vertical, horizontal] = corner.value.split('-') as ['top' | 'bottom', 'left' | 'right']
  const moves: Record<string, Corner> = {
    ArrowUp: `top-${horizontal}`,
    ArrowDown: `bottom-${horizontal}`,
    ArrowLeft: `${vertical}-left`,
    ArrowRight: `${vertical}-right`,
  }
  const next = moves[event.key]
  if (!next) return
  event.preventDefault()
  corner.value = next
}
</script>

<template>
  <button
    type="button"
    :aria-label="label"
    :class="[
      'absolute z-10 aspect-[3/4] w-28 touch-none overflow-hidden rounded-xl bg-call-surface shadow-lg ring-1 ring-on-call/20 sm:w-36',
      offset ? '' : 'transition-[top,bottom,left,right] duration-200 motion-reduce:transition-none',
      ...position,
    ]"
    :style="offset ? { transform: `translate(${offset.x}px, ${offset.y}px)` } : undefined"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @keydown="onKeydown"
    @click.prevent
    @keyup.enter="emit('swap')"
    @keyup.space="emit('swap')"
  >
    <TrackVideo :track="props.track" :mirror="mirror" />
  </button>
</template>
