<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { isApiError } from '@/api/errors'
import PeoplePicker from '@/components/chat/PeoplePicker.vue'
import BaseButton from '@/components/common/BaseButton.vue'
import BaseInput from '@/components/common/BaseInput.vue'
import BaseTextarea from '@/components/common/BaseTextarea.vue'
import Modal from '@/components/common/Modal.vue'
import { useOpenChat } from '@/composables/useOpenChat'
import { usePeople } from '@/composables/usePeople'
import { useChatsStore } from '@/stores/chats'
import { useUiStore } from '@/stores/ui'
import { errorMessage } from '@/utils/errorMessage'

const { t } = useI18n()
const ui = useUiStore()
const chats = useChatsStore()
const openChat = useOpenChat()
const { people, loading, failed: peopleFailed, retry: retryPeople } = usePeople(computed(() => ui.newGroupOpen))

const name = ref('')
const description = ref('')
const members = ref<string[]>([])
const errors = ref({ name: '', members: '', form: '' })
const saving = ref(false)

// Every time the dialog opens it starts empty.
watch(
  () => ui.newGroupOpen,
  (open) => {
    if (!open) return
    name.value = ''
    description.value = ''
    members.value = []
    errors.value = { name: '', members: '', form: '' }
  },
)

async function submit(): Promise<void> {
  errors.value = { name: '', members: '', form: '' }
  if (!name.value.trim()) errors.value.name = t('group.nameRequired')
  if (members.value.length === 0) errors.value.members = t('group.chooseMembers')
  if (errors.value.name || errors.value.members) return

  saving.value = true
  try {
    const chat = await chats.createGroup({
      name: name.value.trim(),
      ...(description.value.trim() ? { description: description.value.trim() } : {}),
      member_ids: members.value,
    })
    ui.newGroupOpen = false
    openChat(chat.id)
  } catch (error) {
    if (isApiError(error) && error.status === 422) {
      errors.value.name = error.fieldError('name') ?? ''
      errors.value.members = error.fieldError('member_ids') ?? ''
      if (!errors.value.name && !errors.value.members) errors.value.form = error.message
    } else {
      errors.value.form = isApiError(error) ? errorMessage(error, t) : t('group.createFailed')
    }
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Modal :open="ui.newGroupOpen" :title="t('group.newTitle')" @close="ui.newGroupOpen = false">
    <form class="flex flex-col gap-4" novalidate @submit.prevent="submit">
      <p v-if="errors.form" class="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{{ errors.form }}</p>

      <BaseInput v-model="name" :label="t('group.name')" :error="errors.name" maxlength="100" autocomplete="off" required />
      <BaseTextarea
        v-model="description"
        :label="t('group.description')"
        :optional="true"
        :optional-label="t('common.optional')"
        maxlength="1000"
      />

      <fieldset class="flex flex-col gap-2">
        <legend class="mb-1 text-sm font-medium text-text">
          {{ t('group.members') }} <span class="font-normal text-text-muted">· {{ t('people.selected', { count: members.length }) }}</span>
        </legend>
        <PeoplePicker v-model="members" multiple :people="people" :loading="loading" :failed="peopleFailed" :empty-text="t('people.noPeople')" @retry="retryPeople" />
        <p v-if="errors.members" class="text-sm text-danger" role="alert">{{ errors.members }}</p>
      </fieldset>

      <BaseButton type="submit" size="lg" block :loading="saving">
        {{ saving ? t('group.creating') : t('group.create') }}
      </BaseButton>
    </form>
  </Modal>
</template>
