<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import { isApiError } from '@/api/errors'
import { ROOM_LIMITS } from '@/api/rooms'
import BaseButton from '@/components/common/BaseButton.vue'
import BaseInput from '@/components/common/BaseInput.vue'
import BaseSelect, { type SelectOption } from '@/components/common/BaseSelect.vue'
import BaseSwitch from '@/components/common/BaseSwitch.vue'
import BaseTextarea from '@/components/common/BaseTextarea.vue'
import Modal from '@/components/common/Modal.vue'
import { useAuthStore } from '@/stores/auth'
import { useChatsStore } from '@/stores/chats'
import { useRoomsStore } from '@/stores/rooms'
import { useUiStore } from '@/stores/ui'
import type { NewRoom, Room } from '@/types/room'
import { formatMeetingTime, fromZonedInput, safeTimeZone, toZonedInput } from '@/utils/dates'
import { errorMessage } from '@/utils/errorMessage'

const DURATIONS = [15, 30, 45, 60, 90, 120, 180]

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; created: [room: Room] }>()

const { t, locale } = useI18n()
const router = useRouter()
const auth = useAuthStore()
const chats = useChatsStore()
const rooms = useRoomsStore()
const ui = useUiStore()

const blank = () => ({ name: '', description: '', startsAt: '', duration: '', password: '', waitingRoom: false, people: String(ROOM_LIMITS.defaultPeople), chatId: '' })
type Field = keyof ReturnType<typeof blank>

const form = reactive(blank())
const errors = reactive<Partial<Record<Field, string>>>({})
const problem = ref('')
const saving = ref(false)

const zone = computed(() => safeTimeZone(auth.user?.timezone ?? 'UTC'))
const earliest = computed(() => toZonedInput(Date.now(), zone.value))
const scheduling = computed(() => form.startsAt !== '')

const durationOptions = computed<SelectOption[]>(() => [
  { value: '', label: t('meetings.form.durationNone') },
  ...DURATIONS.map((minutes) => ({
    value: String(minutes),
    label: minutes % 60 === 0 ? t('meetings.form.hours', { count: minutes / 60 }, minutes / 60) : t('meetings.form.minutes', { count: minutes }),
  })),
])
const groupOptions = computed<SelectOption[]>(() => [
  { value: '', label: t('meetings.form.chatNone') },
  ...chats.chats.filter((chat) => chat.type === 'group').map((chat) => ({ value: chat.id, label: chat.name ?? '' })),
])

// Every time it opens it starts empty.
watch(
  () => props.open,
  (open) => {
    if (!open) return
    Object.assign(form, blank())
    for (const key of Object.keys(errors) as Field[]) delete errors[key]
    problem.value = ''
  },
)

/** Checks what the server would refuse, so the person hears about it at once and in their language. */
function validate(now: number): NewRoom | null {
  for (const key of Object.keys(errors) as Field[]) delete errors[key]

  const name = form.name.trim()
  if (!name) errors.name = t('meetings.form.nameRequired')
  else if (name.length > ROOM_LIMITS.name) errors.name = t('meetings.form.nameTooLong', { max: ROOM_LIMITS.name })

  const description = form.description.trim()
  if (description.length > ROOM_LIMITS.description) errors.description = t('meetings.form.descriptionTooLong', { max: ROOM_LIMITS.description })

  let scheduledAt: string | null = null
  if (form.startsAt) {
    scheduledAt = fromZonedInput(form.startsAt, zone.value)
    if (!scheduledAt || Date.parse(scheduledAt) <= now) errors.startsAt = t('meetings.form.startsInPast')
  }

  if (form.password && (form.password.length < ROOM_LIMITS.passwordMin || form.password.length > ROOM_LIMITS.passwordMax)) {
    errors.password = t('meetings.form.passwordLength')
  }

  const people = Number(form.people)
  if (!Number.isInteger(people) || people < ROOM_LIMITS.minPeople || people > ROOM_LIMITS.maxPeople) errors.people = t('meetings.form.maxRange')

  if (Object.keys(errors).length > 0) return null
  return {
    name,
    ...(description ? { description } : {}),
    ...(scheduledAt ? { scheduled_at: scheduledAt } : {}),
    ...(form.duration ? { duration_minutes: Number(form.duration) } : {}),
    ...(form.password ? { password: form.password } : {}),
    waiting_room_enabled: form.waitingRoom,
    max_participants: people,
    ...(form.chatId ? { chat_id: form.chatId } : {}),
  }
}

/** The server's field names, for its 422 answers. */
const SERVER_FIELDS: Record<string, Field> = {
  name: 'name',
  description: 'description',
  scheduled_at: 'startsAt',
  type: 'startsAt',
  duration_minutes: 'duration',
  password: 'password',
  max_participants: 'people',
  waiting_room_enabled: 'waitingRoom',
  chat_id: 'chatId',
}

async function submit(): Promise<void> {
  if (saving.value) return
  problem.value = ''
  const room = validate(Date.now())
  if (!room) return

  saving.value = true
  try {
    const created = await rooms.create(room)
    rooms.addCreated(created)
    emit('close')
    if (created.scheduled_at) {
      ui.toast(t('meetings.form.scheduled', { when: formatMeetingTime(created.scheduled_at, Date.now(), zone.value, locale.value) }))
      emit('created', created)
    } else {
      await router.push({ name: 'room', params: { id: created.id } })
    }
  } catch (error) {
    if (isApiError(error) && error.status === 422) {
      for (const [serverField, field] of Object.entries(SERVER_FIELDS)) {
        const message = error.fieldError(serverField)
        if (message) errors[field] = message
      }
    }
    if (Object.keys(errors).length === 0) problem.value = isApiError(error) ? errorMessage(error, t) : t('meetings.form.failed')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Modal :open="open" :title="t('meetings.form.title')" @close="$emit('close')">
    <form id="new-meeting" class="flex flex-col gap-4" novalidate @submit.prevent="submit">
      <BaseInput v-model="form.name" :label="t('meetings.form.name')" :error="errors.name" :maxlength="ROOM_LIMITS.name + 20" data-autofocus />
      <BaseTextarea v-model="form.description" :label="t('meetings.form.description')" :error="errors.description" optional />
      <BaseInput
        v-model="form.startsAt"
        type="datetime-local"
        :label="t('meetings.form.startsAt')"
        :hint="t('meetings.form.startsAtHint', { zone })"
        :error="errors.startsAt"
        :min="earliest"
        optional
      />
      <BaseSelect v-if="scheduling" v-model="form.duration" :label="t('meetings.form.duration')" :options="durationOptions" :error="errors.duration" optional />
      <BaseInput
        v-model="form.password"
        type="password"
        autocomplete="new-password"
        :label="t('meetings.form.password')"
        :hint="t('meetings.form.passwordHint')"
        :error="errors.password"
        optional
      />
      <BaseSwitch v-model="form.waitingRoom" :label="t('meetings.form.waitingRoom')" :hint="t('meetings.form.waitingRoomHint')" />
      <BaseInput
        v-model="form.people"
        inputmode="numeric"
        pattern="[0-9]*"
        :label="t('meetings.form.maxParticipants')"
        :hint="t('meetings.form.maxHint')"
        :error="errors.people"
      />
      <BaseSelect
        v-if="groupOptions.length > 1"
        v-model="form.chatId"
        :label="t('meetings.form.chat')"
        :hint="t('meetings.form.chatHint')"
        :options="groupOptions"
        :error="errors.chatId"
        optional
      />
      <p v-if="problem" class="text-sm text-danger" role="alert">{{ problem }}</p>
    </form>

    <template #footer>
      <BaseButton type="submit" form="new-meeting" block :loading="saving">
        {{ saving ? t('meetings.form.creating') : scheduling ? t('meetings.form.schedule') : t('meetings.form.startNow') }}
      </BaseButton>
    </template>
  </Modal>
</template>
