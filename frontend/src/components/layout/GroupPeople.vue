<script setup lang="ts">
import { computed, ref, toRef } from 'vue'
import { useI18n } from 'vue-i18n'

import BaseButton from '@/components/common/BaseButton.vue'
import Skeleton from '@/components/common/Skeleton.vue'
import UserAvatar from '@/components/common/UserAvatar.vue'
import { useGroupPeople } from '@/composables/useGroupPeople'
import { useMessagePerson } from '@/composables/useMessagePerson'
import { useChatsStore } from '@/stores/chats'

/** How many people show before "Show more". */
const VISIBLE = 5

const props = defineProps<{ active: boolean }>()

const { t } = useI18n()
const chats = useChatsStore()
const { people, groups, loading, failed, retry } = useGroupPeople(toRef(props, 'active'))
const { message, busyId } = useMessagePerson()
const showAll = ref(false)

const shown = computed(() => (showAll.value ? people.value : people.value.slice(0, VISIBLE)))
const waiting = computed(() => chats.status === 'idle' || chats.status === 'loading' || (loading.value && people.value.length === 0))
</script>

<template>
  <section aria-labelledby="group-people-title">
    <h2 id="group-people-title" class="mb-2 text-sm font-semibold text-text">{{ t('activity.groups.title') }}</h2>

    <div v-if="waiting" class="flex flex-col gap-1" role="status">
      <span class="sr-only">{{ t('common.loading') }}</span>
      <div v-for="row in 3" :key="row" class="flex min-h-11 items-center gap-3 px-2" aria-hidden="true">
        <Skeleton rounded="full" class="size-8" />
        <Skeleton class="h-3.5 w-28" />
      </div>
    </div>

    <div v-else-if="failed && people.length === 0" class="flex flex-col items-start gap-2" role="alert">
      <p class="text-sm text-text-muted">{{ t('activity.groups.failed') }}</p>
      <BaseButton variant="secondary" @click="retry">{{ t('common.retry') }}</BaseButton>
    </div>

    <p v-else-if="groups.length === 0" class="text-sm text-text-muted">{{ t('activity.groups.noGroups') }}</p>
    <p v-else-if="people.length === 0" class="text-sm text-text-muted">{{ t('activity.groups.empty') }}</p>

    <template v-else>
      <ul>
        <li v-for="person in shown" :key="person.id" class="flex min-h-11 items-center gap-3 px-2 py-1">
          <UserAvatar :name="person.name" :seed="person.id" :src="person.avatar_thumb_url" size="sm" />
          <span class="min-w-0 flex-1 truncate font-medium text-text">{{ person.name }}</span>
          <BaseButton
            variant="secondary"
            class="shrink-0"
            :loading="busyId === person.id"
            :disabled="busyId !== null"
            :aria-label="t('activity.groups.messageNamed', { name: person.name })"
            @click="message(person)"
          >
            {{ t('activity.groups.message') }}
          </BaseButton>
        </li>
      </ul>
      <button
        v-if="people.length > VISIBLE"
        type="button"
        class="mt-1 min-h-11 px-2 text-sm text-primary hover:underline"
        :aria-expanded="showAll"
        @click="showAll = !showAll"
      >
        {{ showAll ? t('activity.groups.showLess') : t('activity.groups.showMore', { count: people.length - VISIBLE }) }}
      </button>
    </template>
  </section>
</template>
