<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{ names: string[] }>()

const { t } = useI18n()

const text = computed(() => {
  const [first, second] = props.names
  if (!first) return ''
  if (props.names.length === 1) return t('chat.typing.one', { name: first })
  if (props.names.length === 2 && second) return t('chat.typing.two', { first, second })
  return t('chat.typing.many')
})
</script>

<template>
  <!-- Always in the page (and always the same height), so the box below does not jump when someone starts typing. -->
  <p class="h-6 truncate px-4 text-xs text-text-muted" aria-live="polite">{{ text }}</p>
</template>
