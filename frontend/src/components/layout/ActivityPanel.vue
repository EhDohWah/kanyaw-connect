<script setup lang="ts">
import GroupPeople from '@/components/layout/GroupPeople.vue'
import OnlineNow from '@/components/layout/OnlineNow.vue'
import UpcomingMeetings from '@/components/layout/UpcomingMeetings.vue'

/**
 * "People & activity": who is online, the meetings coming up, and people from your groups to start a chat with. It sits in
 * the right column on wide screens and in a sheet on the others. `active` is whether it is on screen, so nothing is
 * fetched for a sheet nobody opened.
 */
defineProps<{ active: boolean }>()
</script>

<template>
  <div class="flex flex-col gap-6">
    <OnlineNow />
    <UpcomingMeetings :active="active" />
    <GroupPeople :active="active" />
  </div>
</template>
