<script setup lang="ts">
import { nextTick, watch } from 'vue'
import { RouterView, START_LOCATION, useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'

import ToastHost from '@/components/common/ToastHost.vue'

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()

function updateTitle(): void {
  const page = route.meta.titleKey ? t(route.meta.titleKey) : ''
  document.title = page ? `${page} · ${t('app.name')}` : t('app.name')
}

// The page title follows the page and the language.
watch([() => route.meta.titleKey, locale], updateTitle, { immediate: true })

function focusMain(): void {
  document.getElementById('main')?.focus({ preventScroll: true })
}

// After moving to another page, focus goes to the top of the content: a screen reader is told the page
// changed, and the next Tab starts from there (as after a normal page load). Not on the first page.
router.afterEach(async (to, from, failure) => {
  if (failure || from === START_LOCATION || to.path === from.path) return
  await nextTick()
  focusMain()
})
</script>

<template>
  <a
    href="#main"
    class="sr-only rounded-lg bg-primary px-4 py-2 text-on-primary focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[70]"
    @click.prevent="focusMain"
  >
    {{ t('common.skipToContent') }}
  </a>
  <RouterView />
  <ToastHost />
</template>
