<script setup lang="ts">
import { Ellipsis, Mic, MicOff, Video, VideoOff } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import type { ApiError } from '@/api/errors'
import ParticipantActionsDialog from '@/components/call/ParticipantActionsDialog.vue'
import BaseSwitch from '@/components/common/BaseSwitch.vue'
import UserAvatar from '@/components/common/UserAvatar.vue'
import { useCallStore } from '@/stores/call'
import { useUiStore } from '@/stores/ui'
import type { CallParticipant } from '@/types/call'
import { callOrder } from '@/utils/callLayout'
import { errorMessage } from '@/utils/errorMessage'

const { t } = useI18n()
const call = useCallStore()
const ui = useUiStore()

const people = computed(() => callOrder(call.participants))
const chosen = ref<CallParticipant | null>(null)
const deciding = ref<string | null>(null)
const locking = ref(false)

const roleLabel = (id: string): string => {
  const role = call.roleOf(id)
  return role === 'host' ? t('call.participants.host') : role === 'co_host' ? t('call.participants.coHost') : ''
}

function failed(error: unknown): void {
  ui.toast((error as ApiError).status ? errorMessage(error as ApiError, t) : t('call.participants.failed'), 'error')
}

async function decide(userId: string, name: string, admit: boolean): Promise<void> {
  if (deciding.value) return
  deciding.value = userId
  try {
    if (admit) {
      await call.admit(userId)
      ui.toast(t('call.participants.admitted', { name }))
    } else {
      await call.deny(userId)
    }
  } catch (error) {
    failed(error)
  } finally {
    deciding.value = null
  }
}

async function setLocked(locked: boolean): Promise<void> {
  if (locking.value) return
  locking.value = true
  try {
    await call.setLocked(locked)
  } catch (error) {
    failed(error)
  } finally {
    locking.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-5 p-4">
    <section v-if="call.canModerate && call.waiting.length > 0" aria-labelledby="waiting-title">
      <h2 id="waiting-title" class="mb-2 text-sm font-semibold text-on-call">{{ t('call.waiting.section') }} ({{ call.waiting.length }})</h2>
      <ul class="flex flex-col gap-1">
        <li v-for="entry in call.waiting" :key="entry.user_id" class="flex items-center gap-3 py-1">
          <UserAvatar :name="entry.user.name" :src="entry.user.avatar_thumb_url" :seed="entry.user_id" size="sm" />
          <span class="min-w-0 flex-1 truncate text-on-call">{{ entry.user.name }}</span>
          <button
            type="button"
            class="min-h-11 rounded-lg bg-primary px-3 text-sm font-medium text-on-primary hover:bg-primary-hover disabled:opacity-60"
            :disabled="deciding !== null"
            :aria-label="t('call.waiting.admitNamed', { name: entry.user.name })"
            @click="decide(entry.user_id, entry.user.name, true)"
          >
            {{ t('call.waiting.admit') }}
          </button>
          <button
            type="button"
            class="min-h-11 rounded-lg border border-call-raised px-3 text-sm font-medium text-on-call hover:bg-call-raised disabled:opacity-60"
            :disabled="deciding !== null"
            :aria-label="t('call.waiting.denyNamed', { name: entry.user.name })"
            @click="decide(entry.user_id, entry.user.name, false)"
          >
            {{ t('call.waiting.deny') }}
          </button>
        </li>
      </ul>
    </section>

    <BaseSwitch
      v-if="call.isHost"
      dark
      :model-value="call.room?.is_locked ?? false"
      :disabled="locking"
      :label="t('call.participants.lock')"
      :hint="t('call.participants.lockHint')"
      @update:model-value="setLocked"
    />

    <section aria-labelledby="in-call-title">
      <h2 id="in-call-title" class="mb-2 text-sm font-semibold text-on-call">{{ t('call.participants.inCall', { count: people.length }) }}</h2>
      <ul class="flex flex-col gap-1">
        <li v-for="person in people" :key="person.id" class="flex items-center gap-3 py-1">
          <UserAvatar :name="person.name" :src="person.avatarUrl" :seed="person.id" size="sm" />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-on-call">{{ person.isLocal ? t('call.stage.you', { name: person.name }) : person.name }}</span>
            <span v-if="roleLabel(person.id)" class="block text-xs text-on-call-muted">{{ roleLabel(person.id) }}</span>
          </span>
          <Mic v-if="person.micOn" class="size-4 shrink-0 text-on-call-muted" aria-hidden="true" />
          <MicOff v-else class="size-4 shrink-0 text-on-call" :aria-label="t('call.stage.micOff')" role="img" />
          <Video v-if="person.cameraOn" class="size-4 shrink-0 text-on-call-muted" aria-hidden="true" />
          <VideoOff v-else class="size-4 shrink-0 text-on-call" :aria-label="t('call.participants.cameraOff')" role="img" />
          <button
            v-if="call.canActOn(person.id)"
            type="button"
            class="flex size-11 shrink-0 items-center justify-center rounded-lg text-on-call hover:bg-call-raised"
            :aria-label="t('call.participants.actions', { name: person.name })"
            @click="chosen = person"
          >
            <Ellipsis class="size-5" aria-hidden="true" />
          </button>
        </li>
      </ul>
    </section>

    <ParticipantActionsDialog :person="chosen" @close="chosen = null" />
  </div>
</template>
