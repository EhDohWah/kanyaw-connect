<script setup lang="ts">
// Filled in a later step: who is online and upcoming meetings.
import { Users } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
  <div class="p-5">
    <div class="flex flex-col items-start gap-3 rounded-xl border border-border p-5">
      <span class="flex size-10 items-center justify-center rounded-lg bg-primary-soft text-primary">
        <Users class="size-5" aria-hidden="true" />
      </span>
      <h2 class="font-semibold text-text">{{ t('shell.sidebarTitle') }}</h2>
      <p class="text-sm text-text-muted">{{ t('shell.sidebarText') }}</p>
    </div>
  </div>
</template>
