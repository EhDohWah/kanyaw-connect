<script setup lang="ts">
import { LogOut, Pencil, UserPlus } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { isApiError } from '@/api/errors'
import GroupMemberRow from '@/components/chat/GroupMemberRow.vue'
import PeoplePicker from '@/components/chat/PeoplePicker.vue'
import BaseButton from '@/components/common/BaseButton.vue'
import BaseInput from '@/components/common/BaseInput.vue'
import BaseTextarea from '@/components/common/BaseTextarea.vue'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import Modal from '@/components/common/Modal.vue'
import UserAvatar from '@/components/common/UserAvatar.vue'
import { usePeople } from '@/composables/usePeople'
import { useAuthStore } from '@/stores/auth'
import { useChatsStore } from '@/stores/chats'
import { useUiStore } from '@/stores/ui'
import type { ChatMember } from '@/types/chat'
import { errorMessage } from '@/utils/errorMessage'
import { canManageGroup } from '@/utils/messageRules'

const props = defineProps<{ open: boolean; chatId: string }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const auth = useAuthStore()
const chats = useChatsStore()
const ui = useUiStore()
const { people, loading } = usePeople(computed(() => props.open))

const chat = computed(() => chats.get(props.chatId))
const members = computed(() => chat.value?.members ?? [])
const myRole = computed(() => chat.value?.my_membership.role)
const manager = computed(() => canManageGroup(myRole.value))

type Mode = 'view' | 'edit' | 'add'
const mode = ref<Mode>('view')
const name = ref('')
const description = ref('')
const toAdd = ref<string[]>([])
const busy = ref(false)
const problem = ref('')
const confirmRemove = ref<ChatMember | null>(null)
const confirmLeave = ref(false)

const candidates = computed(() => {
  const inGroup = new Set(members.value.map((member) => member.user_id))
  return people.value.filter((person) => !inGroup.has(person.id))
})

watch(
  () => props.open,
  (open) => {
    if (!open) return
    mode.value = 'view'
    problem.value = ''
    toAdd.value = []
    if (!chat.value?.members) void chats.loadDetails(props.chatId).catch(() => undefined)
  },
)

function startEdit(): void {
  name.value = chat.value?.name ?? ''
  description.value = chat.value?.description ?? ''
  problem.value = ''
  mode.value = 'edit'
}

/** Runs one change to the group; shows why it failed in the dialog and leaves the choice open to try again. */
async function attempt(action: () => Promise<unknown>, failure: string): Promise<boolean> {
  busy.value = true
  problem.value = ''
  try {
    await action()
    return true
  } catch (error) {
    problem.value = isApiError(error) ? (error.status === 422 ? (Object.values(error.fieldErrors)[0]?.[0] ?? error.message) : errorMessage(error, t)) : failure
    return false
  } finally {
    busy.value = false
  }
}

async function saveEdit(): Promise<void> {
  if (!name.value.trim()) {
    problem.value = t('group.nameRequired')
    return
  }
  const patch = { name: name.value.trim(), description: description.value.trim() || null }
  if (await attempt(() => chats.updateGroup(props.chatId, patch), t('group.saveFailed'))) mode.value = 'view'
}

async function addPeople(): Promise<void> {
  if (toAdd.value.length === 0) return
  if (await attempt(() => chats.addMembers(props.chatId, toAdd.value), t('group.actionFailed'))) {
    toAdd.value = []
    mode.value = 'view'
  }
}

async function setRole(member: ChatMember, role: 'admin' | 'member'): Promise<void> {
  await attempt(() => chats.setRole(props.chatId, member.user_id, role), t('group.actionFailed'))
}

async function removeConfirmed(): Promise<void> {
  const member = confirmRemove.value
  if (member && (await attempt(() => chats.removeMember(props.chatId, member.user_id), t('group.actionFailed')))) {
    confirmRemove.value = null
  }
}

async function leaveConfirmed(): Promise<void> {
  if (!(await attempt(() => chats.leave(props.chatId), t('group.actionFailed')))) return
  confirmLeave.value = false
  // The conversation notices the chat is gone and goes back to the list by itself.
  emit('close')
  ui.toast(t('group.left'))
}
</script>

<template>
  <Modal :open="open && chat !== undefined" :title="t('group.info')" @close="emit('close')">
    <div v-if="chat" class="flex flex-col gap-5">
      <p v-if="problem" class="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{{ problem }}</p>

      <!-- Name and description -->
      <section v-if="mode === 'edit'" class="flex flex-col gap-3">
        <BaseInput v-model="name" :label="t('group.name')" maxlength="100" autocomplete="off" required />
        <BaseTextarea v-model="description" :label="t('group.description')" :optional="true" :optional-label="t('common.optional')" maxlength="1000" />
        <div class="flex justify-end gap-2">
          <BaseButton variant="ghost" :disabled="busy" @click="mode = 'view'">{{ t('common.cancel') }}</BaseButton>
          <BaseButton :loading="busy" @click="saveEdit">{{ t('common.save') }}</BaseButton>
        </div>
      </section>
      <section v-else class="flex items-start gap-4">
        <UserAvatar :name="chat.name ?? t('chat.untitled')" :seed="chat.id" size="lg" />
        <div class="min-w-0 flex-1">
          <h3 class="break-words text-lg font-semibold">{{ chat.name }}</h3>
          <p v-if="chat.description" class="mt-1 whitespace-pre-wrap break-words text-text-muted">{{ chat.description }}</p>
          <p class="mt-1 text-sm text-text-muted">{{ t('chat.members', { count: chat.member_count }) }}</p>
        </div>
        <button
          v-if="manager"
          type="button"
          class="flex size-11 shrink-0 items-center justify-center rounded-lg text-text transition-colors duration-150 hover:bg-surface"
          :aria-label="t('group.rename')"
          @click="startEdit"
        >
          <Pencil class="size-5" aria-hidden="true" />
        </button>
      </section>

      <!-- Add people -->
      <section v-if="mode === 'add'" class="flex flex-col gap-3">
        <h3 class="font-semibold">{{ t('group.addMembers') }}</h3>
        <PeoplePicker v-model="toAdd" multiple :people="candidates" :loading="loading" :empty-text="t('group.noOneToAdd')" />
        <div class="flex justify-end gap-2">
          <BaseButton variant="ghost" :disabled="busy" @click="mode = 'view'">{{ t('common.cancel') }}</BaseButton>
          <BaseButton :loading="busy" :disabled="toAdd.length === 0" @click="addPeople">
            {{ busy ? t('group.adding') : t('group.add') }}
          </BaseButton>
        </div>
      </section>

      <!-- Members -->
      <section v-if="mode === 'view'">
        <div class="flex items-center justify-between gap-2">
          <h3 class="font-semibold">{{ t('group.members') }}</h3>
          <BaseButton v-if="manager" variant="secondary" @click="mode = 'add'"><UserPlus class="size-4" aria-hidden="true" />{{ t('group.addMembers') }}</BaseButton>
        </div>
        <ul class="mt-2 divide-y divide-border">
          <GroupMemberRow
            v-for="member in members"
            :key="member.user_id"
            :member="member"
            :my-role="myRole"
            :is-me="member.user_id === auth.user?.id"
            :busy="busy"
            @set-role="setRole(member, $event)"
            @remove="confirmRemove = member"
          />
        </ul>
      </section>

      <BaseButton v-if="mode === 'view'" variant="danger" class="self-start" @click="confirmLeave = true">
        <LogOut class="size-4" aria-hidden="true" />{{ t('group.leave') }}
      </BaseButton>
    </div>

    <ConfirmDialog
      :open="confirmRemove !== null"
      :title="t('group.removeTitle', { name: confirmRemove?.user.name ?? '' })"
      :text="t('group.removeText')"
      :confirm-label="t('group.remove')"
      danger
      :busy="busy"
      :error="problem"
      @cancel="confirmRemove = null"
      @confirm="removeConfirmed"
    />
    <ConfirmDialog
      :open="confirmLeave"
      :title="t('group.leaveTitle')"
      :text="t('group.leaveText')"
      :confirm-label="t('group.leave')"
      danger
      :busy="busy"
      :error="problem"
      @cancel="confirmLeave = false"
      @confirm="leaveConfirmed"
    />
  </Modal>
</template>
