<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import BaseButton from '@/components/common/BaseButton.vue'
import Skeleton from '@/components/common/Skeleton.vue'
import UserAvatar from '@/components/common/UserAvatar.vue'
import { useMessagePerson } from '@/composables/useMessagePerson'
import { useAuthStore } from '@/stores/auth'
import { useChatsStore } from '@/stores/chats'
import { usePresenceStore } from '@/stores/presence'

/** How many people show before "Show more". */
const VISIBLE = 8

const { t } = useI18n()
const auth = useAuthStore()
const chats = useChatsStore()
const presence = usePresenceStore()
const { message, busyId } = useMessagePerson()
const showAll = ref(false)

const known = computed(() => chats.knownPeople(auth.user?.id ?? ''))
const online = computed(() => known.value.filter((person) => presence.isOnline(person.id)))
const shown = computed(() => (showAll.value ? online.value : online.value.slice(0, VISIBLE)))

/** The list is still on its way: the chats it is made from, or the first answer about who is online. */
const waiting = computed(() => chats.status === 'idle' || chats.status === 'loading' || (known.value.length > 0 && (presence.status === 'idle' || presence.status === 'loading')))
const failed = computed(() => presence.status === 'error' && online.value.length === 0)

const retry = (): Promise<void> => presence.refresh(known.value.map((person) => person.id))
</script>

<template>
  <section :aria-labelledby="'online-title'">
    <h2 id="online-title" class="mb-2 flex items-center gap-2 text-sm font-semibold text-text">
      {{ t('activity.online.title') }}
      <span v-if="online.length > 0" class="rounded-lg bg-surface px-2 py-0.5 text-xs font-medium text-text-muted">{{ online.length }}</span>
    </h2>

    <div v-if="waiting" class="flex flex-col gap-1" role="status">
      <span class="sr-only">{{ t('common.loading') }}</span>
      <div v-for="row in 3" :key="row" class="flex min-h-11 items-center gap-3 px-2" aria-hidden="true">
        <Skeleton rounded="full" class="size-8" />
        <Skeleton class="h-3.5 w-28" />
      </div>
    </div>

    <div v-else-if="failed" class="flex flex-col items-start gap-2" role="alert">
      <p class="text-sm text-text-muted">{{ t('activity.online.failed') }}</p>
      <BaseButton variant="secondary" @click="retry">{{ t('common.retry') }}</BaseButton>
    </div>

    <p v-else-if="known.length === 0" class="text-sm text-text-muted">{{ t('activity.online.none') }}</p>
    <p v-else-if="online.length === 0" class="text-sm text-text-muted">{{ t('activity.online.empty') }}</p>

    <template v-else>
      <ul>
        <li v-for="person in shown" :key="person.id">
          <button
            type="button"
            class="flex min-h-11 w-full items-center gap-3 rounded-lg px-2 text-left transition-colors duration-150 hover:bg-surface disabled:opacity-60"
            :disabled="busyId === person.id"
            :aria-label="t('activity.online.message', { name: person.name })"
            @click="message(person)"
          >
            <span class="relative shrink-0">
              <UserAvatar :name="person.name" :seed="person.id" :src="person.avatar_thumb_url" size="sm" />
              <span class="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-bg bg-success" aria-hidden="true" />
            </span>
            <span class="min-w-0 flex-1 truncate font-medium text-text">{{ person.name }}</span>
          </button>
        </li>
      </ul>
      <button
        v-if="online.length > VISIBLE"
        type="button"
        class="mt-1 min-h-11 px-2 text-sm text-primary hover:underline"
        :aria-expanded="showAll"
        @click="showAll = !showAll"
      >
        {{ showAll ? t('activity.online.showLess') : t('activity.online.showMore', { count: online.length - VISIBLE }) }}
      </button>
    </template>
  </section>
</template>
