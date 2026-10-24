<script setup lang="ts">
import NewChatDialog from '@/components/chat/NewChatDialog.vue'
import NewGroupDialog from '@/components/chat/NewGroupDialog.vue'
</script>

<template>
  <!-- The "new chat" and "new group" dialogs live once in the app shell, so the Messages page, the drawer and the empty state can all open them. -->
  <NewChatDialog />
  <NewGroupDialog />
</template>
