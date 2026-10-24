<script setup lang="ts">
import { computed } from 'vue'

import { linkify } from '@/utils/linkify'

const props = defineProps<{ text: string; own?: boolean }>()

// Plain data from the linkifier, drawn as elements below: text from a sender is never treated as markup.
const tokens = computed(() => linkify(props.text))
</script>

<template>
  <span class="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
    <template v-for="(token, index) in tokens" :key="index">
      <a
        v-if="token.type === 'link'"
        :href="token.href"
        target="_blank"
        rel="noopener noreferrer nofollow"
        :class="['underline underline-offset-2', own ? 'text-on-primary' : 'text-primary']"
      >{{ token.value }}</a>
      <template v-else>{{ token.value }}</template>
    </template>
  </span>
</template>
