<script setup lang="ts">
// Wide screens: icon and label. Tablets: icons only (the label stays for screen readers and as a tooltip).
import { Plus } from 'lucide-vue-next'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'

import { NAV_ENTRIES } from '@/components/layout/navigation'
import { useUiStore } from '@/stores/ui'

const { t } = useI18n()
const route = useRoute()
const ui = useUiStore()

function isActive(entry: (typeof NAV_ENTRIES)[number]): boolean {
  return entry.exact ? route.path === entry.to : route.path === entry.to || route.path.startsWith(`${entry.to}/`)
}
</script>

<template>
  <nav class="flex h-full flex-col gap-6 px-3 py-5" :aria-label="t('nav.main')">
    <!-- RouterLink would also mark this one as "current page" on Home; only the Home item should be. -->
    <RouterLink
      to="/"
      class="flex items-center gap-3 rounded-lg px-2 py-1 text-text"
      aria-current-value="false"
      :aria-label="t('shell.logo')"
    >
      <img src="/favicon.svg" alt="" class="size-9 shrink-0" />
      <span class="hidden text-lg font-semibold lg:inline">{{ t('app.name') }}</span>
    </RouterLink>

    <ul class="flex flex-col gap-1">
      <li v-for="entry in NAV_ENTRIES" :key="entry.name">
        <RouterLink
          :to="entry.to"
          :title="t(entry.label)"
          :aria-current="isActive(entry) ? 'page' : undefined"
          :class="[
            'flex min-h-11 items-center justify-center gap-3 rounded-lg px-3 font-medium transition-colors duration-150 lg:justify-start',
            isActive(entry) ? 'bg-primary-soft text-primary' : 'text-text hover:bg-surface',
          ]"
        >
          <component :is="entry.icon" class="size-5 shrink-0" aria-hidden="true" />
          <span class="sr-only lg:not-sr-only">{{ t(entry.label) }}</span>
        </RouterLink>
      </li>
    </ul>

    <button
      type="button"
      class="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-3 font-medium text-on-primary transition-colors duration-150 hover:bg-primary-hover"
      :title="t('nav.create')"
      @click="ui.createMenuOpen = true"
    >
      <Plus class="size-5 shrink-0" aria-hidden="true" />
      <span class="sr-only lg:not-sr-only">{{ t('nav.create') }}</span>
    </button>
  </nav>
</template>
