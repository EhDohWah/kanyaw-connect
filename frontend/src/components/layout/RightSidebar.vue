<script setup lang="ts">
import ActivityPanel from '@/components/layout/ActivityPanel.vue'
</script>

<template>
  <!-- The bottom padding keeps the last section clear of the chat drawer's tab, which is docked in this corner. -->
  <div class="p-5 pb-24">
    <ActivityPanel :active="true" />
  </div>
</template>
