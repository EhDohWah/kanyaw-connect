<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { focusableElements, trapTab } from '@/utils/focus'

const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    /** `center`: a dialog (a sheet from the bottom on phones). `side`: a bottom sheet on phones, a drawer on the right from 768 px. */
    placement?: 'center' | 'side'
  }>(),
  { placement: 'center' },
)
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const titleId = useId()
const panel = ref<HTMLElement | null>(null)
const body = ref<HTMLElement | null>(null)

const side = computed(() => props.placement === 'side')

let opener: HTMLElement | null = null
let holdingBackground = false

/** While a dialog is open the rest of the page cannot be reached by keyboard or screen reader. */
function holdBackground(hold: boolean): void {
  const app = document.getElementById('app')
  if (!app || holdingBackground === hold) return
  holdingBackground = hold

  const current = Number(app.dataset.modals ?? '0') + (hold ? 1 : -1)
  app.dataset.modals = String(Math.max(0, current))
  if (current > 0) app.setAttribute('inert', '')
  else app.removeAttribute('inert')
}

async function onOpen(): Promise<void> {
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
  holdBackground(true)
  await nextTick()
  // A control that asks for it (`data-autofocus`, for a dialog that is about typing), else the first usable control in
  // the content; one marked unavailable should not get the focus ring. If there is none, the first control of the
  // dialog (its close button).
  const asked = panel.value?.querySelector<HTMLElement>('[data-autofocus]')
  const usable = body.value
    ? focusableElements(body.value).find((element) => element.getAttribute('aria-disabled') !== 'true')
    : undefined
  const fallback = panel.value ? focusableElements(panel.value)[0] : undefined
  ;(asked ?? usable ?? fallback ?? panel.value)?.focus()
}

function onClose(): void {
  holdBackground(false)
  opener?.focus()
  opener = null
}

watch(
  () => props.open,
  (isOpen, wasOpen) => {
    if (isOpen) void onOpen()
    else if (wasOpen) onClose()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  if (props.open) onClose()
})

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.stopPropagation()
    emit('close')
    return
  }
  if (panel.value) trapTab(event, panel.value)
}
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-200 ease-out"
      leave-active-class="transition-opacity duration-150 ease-in"
      :enter-from-class="side ? 'opacity-0 [&>div]:translate-y-6 md:[&>div]:translate-x-6 md:[&>div]:translate-y-0' : 'opacity-0'"
      :leave-to-class="side ? 'opacity-0 [&>div]:translate-y-6 md:[&>div]:translate-x-6 md:[&>div]:translate-y-0' : 'opacity-0'"
    >
      <div
        v-if="open"
        :class="[
          'fixed inset-0 z-50 flex items-end justify-center bg-text/40',
          side ? 'md:items-stretch md:justify-end' : 'sm:items-center sm:p-4',
        ]"
        @mousedown.self="emit('close')"
      >
        <div
          ref="panel"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="titleId"
          tabindex="-1"
          :class="[
            'flex w-full flex-col rounded-t-xl bg-bg shadow-xl',
            side
              ? 'max-h-[85dvh] transition-transform duration-200 ease-out md:h-dvh md:max-h-none md:w-[28rem] md:rounded-none md:border-l md:border-border'
              : 'max-h-[90dvh] max-w-md sm:rounded-xl',
          ]"
          @keydown="onKeydown"
        >
          <header class="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
            <h2 :id="titleId" class="text-lg font-semibold text-text">{{ title }}</h2>
            <button
              type="button"
              class="-mr-2 flex size-11 items-center justify-center rounded-lg text-text-muted transition-colors duration-150 hover:bg-surface hover:text-text"
              :aria-label="t('common.close')"
              @click="emit('close')"
            >
              <X class="size-5" aria-hidden="true" />
            </button>
          </header>
          <div
            ref="body"
            :class="[
              'min-h-0 flex-1 overflow-y-auto p-5',
              $slots.footer ? '' : 'pb-[max(1.25rem,env(safe-area-inset-bottom))]',
            ]"
          >
            <slot />
          </div>
          <!-- Pinned under the scrolling part: a comment box that stays where the thumb is. -->
          <div v-if="$slots.footer" class="border-t border-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <slot name="footer" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
