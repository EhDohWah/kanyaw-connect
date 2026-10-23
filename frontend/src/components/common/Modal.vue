<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { focusableElements, trapTab } from '@/utils/focus'

const props = defineProps<{ open: boolean; title: string }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const titleId = useId()
const panel = ref<HTMLElement | null>(null)
const body = ref<HTMLElement | null>(null)

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
  // First usable control in the content; one marked unavailable should not get the focus ring. If there is
  // none, the first control of the dialog (its close button).
  const usable = body.value
    ? focusableElements(body.value).find((element) => element.getAttribute('aria-disabled') !== 'true')
    : undefined
  const fallback = panel.value ? focusableElements(panel.value)[0] : undefined
  ;(usable ?? fallback ?? panel.value)?.focus()
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
      enter-active-class="transition-opacity duration-150 ease-out"
      leave-active-class="transition-opacity duration-150 ease-in"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-end justify-center bg-text/40 sm:items-center sm:p-4"
        @mousedown.self="emit('close')"
      >
        <div
          ref="panel"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="titleId"
          tabindex="-1"
          class="flex max-h-[90dvh] w-full max-w-md flex-col rounded-t-xl bg-bg shadow-xl sm:rounded-xl"
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
          <div ref="body" class="overflow-y-auto p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            <slot />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
