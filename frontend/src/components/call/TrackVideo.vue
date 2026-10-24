<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

import type { VideoTrackLike } from '@/types/call'

/** A camera or screen, drawn in a `<video>`. Sound never comes from here: voices play through the call's audio. */
const props = withDefaults(defineProps<{ track: VideoTrackLike; mirror?: boolean; fit?: 'cover' | 'contain' }>(), { mirror: false, fit: 'cover' })

const element = ref<HTMLVideoElement | null>(null)
let attached: VideoTrackLike | null = null

function attach(): void {
  const target = element.value
  if (!target || attached === props.track) return
  attached?.detach(target)
  props.track.attach(target)
  attached = props.track
}

onMounted(attach)
watch(() => props.track, attach)
onBeforeUnmount(() => {
  if (element.value) attached?.detach(element.value)
  attached = null
})
</script>

<template>
  <!-- Your own camera is shown mirrored, as people expect from a mirror; a screen never is. -->
  <video
    ref="element"
    autoplay
    playsinline
    muted
    disablepictureinpicture
    :class="['size-full', fit === 'cover' ? 'object-cover' : 'object-contain', mirror ? '-scale-x-100' : '']"
  />
</template>
