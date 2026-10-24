<script setup lang="ts">
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import VideoTile from '@/components/call/VideoTile.vue'
import { useMediaQuery } from '@/composables/useMediaQuery'
import type { CallParticipant } from '@/types/call'
import type { RoomRole } from '@/types/room'
import { TILES_PER_PAGE, callOrder, gridShape, pageCount, tilesOnPage } from '@/utils/callLayout'

const props = defineProps<{ people: CallParticipant[]; speakerId: string | null; roleOf: (id: string) => RoomRole }>()

const { t } = useI18n()
const phone = useMediaQuery('(max-width: 767px)')

const ordered = computed(() => callOrder(props.people))
/** The newest screen share takes the stage. */
const sharer = computed(() => [...ordered.value].reverse().find((person) => person.screenSharing) ?? null)

const perPage = computed(() => (phone.value ? TILES_PER_PAGE.phone : TILES_PER_PAGE.wide))
const pages = computed(() => pageCount(ordered.value.length, perPage.value))
const page = ref(0)
const tiles = computed(() => tilesOnPage(ordered.value, page.value, perPage.value, props.speakerId))
const shape = computed(() => gridShape(tiles.value.length, phone.value))

// People leave: never stay on a page that is gone.
watch(pages, (count) => {
  if (page.value > count - 1) page.value = count - 1
})

function go(step: number): void {
  page.value = Math.min(Math.max(page.value + step, 0), pages.value - 1)
}

/** A sideways swipe turns the page (phones); the buttons do the same for everyone else. */
let start: { x: number; y: number } | null = null
function onDown(event: PointerEvent): void {
  start = { x: event.clientX, y: event.clientY }
}
function onUp(event: PointerEvent): void {
  if (!start) return
  const dx = event.clientX - start.x
  const dy = event.clientY - start.y
  start = null
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1)
}
</script>

<template>
  <!-- Swiping with a mouse must not select the name tags. -->
  <section class="flex size-full min-h-0 flex-col select-none" :aria-label="t('call.stage.label')">
    <!-- A screen share: large in the middle, everyone's camera in a strip below. -->
    <template v-if="sharer">
      <div class="min-h-0 flex-1 p-2">
        <VideoTile :person="sharer" screen />
      </div>
      <ul class="flex shrink-0 gap-2 overflow-x-auto px-2 pb-2">
        <li v-for="person in ordered" :key="person.id" class="aspect-video h-24 shrink-0 md:h-28">
          <VideoTile :person="person" :role="roleOf(person.id)" small />
        </li>
      </ul>
    </template>

    <template v-else>
      <ul
        class="grid min-h-0 flex-1 touch-pan-y gap-2 p-2"
        :style="{ gridTemplateColumns: `repeat(${shape.columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${shape.rows}, minmax(0, 1fr))` }"
        @pointerdown="onDown"
        @pointerup="onUp"
        @pointercancel="start = null"
      >
        <li v-for="person in tiles" :key="person.id" class="min-h-0 min-w-0">
          <VideoTile :person="person" :role="roleOf(person.id)" />
        </li>
      </ul>

      <nav v-if="pages > 1" class="flex shrink-0 items-center justify-center gap-2 pb-1 text-sm text-on-call" :aria-label="t('call.stage.page', { page: page + 1, count: pages })">
        <button type="button" class="flex size-11 items-center justify-center rounded-lg hover:bg-call-raised disabled:opacity-40" :disabled="page === 0" :aria-label="t('call.stage.previousPage')" @click="go(-1)">
          <ChevronLeft class="size-5" aria-hidden="true" />
        </button>
        <span aria-live="polite">{{ t('call.stage.page', { page: page + 1, count: pages }) }}</span>
        <button type="button" class="flex size-11 items-center justify-center rounded-lg hover:bg-call-raised disabled:opacity-40" :disabled="page === pages - 1" :aria-label="t('call.stage.nextPage')" @click="go(1)">
          <ChevronRight class="size-5" aria-hidden="true" />
        </button>
      </nav>
    </template>
  </section>
</template>
