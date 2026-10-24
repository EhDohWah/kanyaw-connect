<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import BaseButton from '@/components/common/BaseButton.vue'
import UserAvatar from '@/components/common/UserAvatar.vue'
import type { ChatMember, MemberRole } from '@/types/chat'
import { canChangeRole, canRemoveMember } from '@/utils/messageRules'

const props = defineProps<{ member: ChatMember; myRole: MemberRole | undefined; isMe: boolean; busy?: boolean }>()
defineEmits<{ remove: []; setRole: [role: 'admin' | 'member'] }>()

const { t } = useI18n()

const removable = computed(() => canRemoveMember(props.myRole, props.member.role, props.isMe))
const roleChangeable = computed(() => canChangeRole(props.myRole, props.member.role))
</script>

<template>
  <li class="flex flex-wrap items-center gap-3 py-2">
    <UserAvatar :name="member.user.name" :seed="member.user_id" :src="member.user.avatar_thumb_url" />
    <div class="min-w-0 flex-1">
      <p class="truncate font-medium">
        {{ member.user.name }}<span v-if="isMe" class="font-normal text-text-muted"> ({{ t('common.you') }})</span>
      </p>
      <p v-if="member.role !== 'member'" class="text-xs font-medium text-primary">{{ t(`group.${member.role}`) }}</p>
    </div>
    <div v-if="roleChangeable || removable" class="flex flex-wrap gap-1">
      <BaseButton
        v-if="roleChangeable"
        variant="ghost"
        :disabled="busy"
        @click="$emit('setRole', member.role === 'admin' ? 'member' : 'admin')"
      >
        {{ member.role === 'admin' ? t('group.removeAdmin') : t('group.makeAdmin') }}
      </BaseButton>
      <BaseButton v-if="removable" variant="danger" :disabled="busy" @click="$emit('remove')">{{ t('group.remove') }}</BaseButton>
    </div>
  </li>
</template>
