<script setup lang="ts">
import { Plus } from 'lucide-vue-next'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'

import { BOTTOM_BAR_ENTRIES, type NavEntry } from '@/components/layout/navigation'
import { useUiStore } from '@/stores/ui'

const { t } = useI18n()
const route = useRoute()
const ui = useUiStore()

// The Create button sits in the middle: two places on each side.
const left = BOTTOM_BAR_ENTRIES.slice(0, 2)
const right = BOTTOM_BAR_ENTRIES.slice(2)

function isActive(entry: NavEntry): boolean {
  return entry.exact ? route.path === entry.to : route.path === entry.to || route.path.startsWith(`${entry.to}/`)
}
</script>

<template>
  <nav
    class="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-bg pb-[env(safe-area-inset-bottom)] md:hidden"
    :aria-label="t('nav.main')"
  >
    <ul class="mx-auto flex h-16 max-w-md items-stretch justify-around">
      <li v-for="entry in left" :key="entry.name" class="flex flex-1">
        <RouterLink
          :to="entry.to"
          :aria-current="isActive(entry) ? 'page' : undefined"
          :class="[
            'flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium transition-colors duration-150',
            isActive(entry) ? 'text-primary' : 'text-text-muted',
          ]"
        >
          <component :is="entry.icon" class="size-6" aria-hidden="true" />
          {{ t(entry.label) }}
        </RouterLink>
      </li>

      <li class="flex flex-1 items-center justify-center">
        <button
          type="button"
          class="flex size-12 items-center justify-center rounded-xl bg-primary text-on-primary transition-colors duration-150 hover:bg-primary-hover"
          :aria-label="t('nav.create')"
          @click="ui.createMenuOpen = true"
        >
          <Plus class="size-6" aria-hidden="true" />
        </button>
      </li>

      <li v-for="entry in right" :key="entry.name" class="flex flex-1">
        <RouterLink
          :to="entry.to"
          :aria-current="isActive(entry) ? 'page' : undefined"
          :class="[
            'flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium transition-colors duration-150',
            isActive(entry) ? 'text-primary' : 'text-text-muted',
          ]"
        >
          <component :is="entry.icon" class="size-6" aria-hidden="true" />
          {{ t(entry.label) }}
        </RouterLink>
      </li>
    </ul>
  </nav>
</template>
