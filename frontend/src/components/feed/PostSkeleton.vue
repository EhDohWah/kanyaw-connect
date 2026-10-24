<script setup lang="ts">
import Skeleton from '@/components/common/Skeleton.vue'
</script>

<template>
  <div class="rounded-xl border border-border bg-bg" aria-hidden="true">
    <div class="flex items-center gap-3 p-3">
      <Skeleton rounded="full" class="size-10" />
      <div class="flex flex-1 flex-col gap-2">
        <Skeleton class="h-3.5 w-32" />
        <Skeleton class="h-3 w-16" />
      </div>
    </div>
    <Skeleton rounded="xl" class="aspect-square w-full !rounded-none" />
    <div class="flex flex-col gap-2 p-3">
      <Skeleton class="h-4 w-24" />
      <Skeleton class="h-4 w-full" />
      <Skeleton class="h-4 w-2/3" />
    </div>
  </div>
</template>
