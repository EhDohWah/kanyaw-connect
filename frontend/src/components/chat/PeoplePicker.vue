<script setup lang="ts">
import { Check, Search } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import BaseButton from '@/components/common/BaseButton.vue'
import BaseInput from '@/components/common/BaseInput.vue'
import Skeleton from '@/components/common/Skeleton.vue'
import UserAvatar from '@/components/common/UserAvatar.vue'
import type { PublicUser } from '@/types/user'

const props = defineProps<{
  people: PublicUser[]
  loading?: boolean
  /** Several can be chosen (a group) instead of one tap choosing one person (a direct chat). */
  multiple?: boolean
  modelValue?: string[]
  emptyText: string
  /** Some people could not be loaded (the chat list, or some groups). */
  failed?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [ids: string[]]; pick: [user: PublicUser]; retry: [] }>()

const { t } = useI18n()
const query = ref('')

const shown = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase()
  return needle ? props.people.filter((person) => person.name.toLocaleLowerCase().includes(needle)) : props.people
})

const selected = computed(() => new Set(props.modelValue ?? []))

function choose(person: PublicUser): void {
  if (!props.multiple) {
    emit('pick', person)
    return
  }
  const next = new Set(selected.value)
  if (!next.delete(person.id)) next.add(person.id)
  emit('update:modelValue', [...next])
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- The label is read by screen readers only; the magnifier says it for everyone else. -->
    <div class="relative [&_input]:pl-10 [&_label]:sr-only">
      <Search class="pointer-events-none absolute bottom-3 left-3 z-10 size-5 text-text-muted" aria-hidden="true" />
      <BaseInput v-model="query" :label="t('people.search')" type="search" autocomplete="off" />
    </div>

    <div v-if="loading && people.length === 0" class="flex flex-col gap-2" role="status">
      <span class="sr-only">{{ t('people.loading') }}</span>
      <Skeleton v-for="row in 4" :key="row" class="h-12" />
    </div>

    <div v-else-if="failed && people.length === 0" class="flex flex-col items-center gap-3 py-6 text-center" role="alert">
      <p class="text-text">{{ t('people.loadFailed') }}</p>
      <BaseButton variant="secondary" @click="emit('retry')">{{ t('common.retry') }}</BaseButton>
    </div>

    <p v-else-if="people.length === 0" class="py-6 text-center text-text-muted">{{ emptyText }}</p>
    <p v-else-if="shown.length === 0" class="py-6 text-center text-text-muted">{{ t('people.noMatch', { query: query.trim() }) }}</p>

    <ul v-else class="max-h-72 overflow-y-auto">
      <li v-for="person in shown" :key="person.id">
        <button
          type="button"
          class="flex min-h-14 w-full items-center gap-3 rounded-lg px-2 text-left transition-colors duration-150 hover:bg-surface"
          :aria-pressed="multiple ? selected.has(person.id) : undefined"
          @click="choose(person)"
        >
          <UserAvatar :name="person.name" :seed="person.id" :src="person.avatar_thumb_url" />
          <span class="min-w-0 flex-1 truncate font-medium">{{ person.name }}</span>
          <span
            v-if="multiple"
            :class="[
              'flex size-6 shrink-0 items-center justify-center rounded-lg border',
              selected.has(person.id) ? 'border-primary bg-primary text-on-primary' : 'border-border',
            ]"
            aria-hidden="true"
          >
            <Check v-if="selected.has(person.id)" class="size-4" />
          </span>
        </button>
      </li>
    </ul>

    <!-- Some are shown, but not everyone: say so, rather than let a missing name look like a person who is not there. -->
    <div v-if="failed && people.length > 0 && !loading" class="flex items-center justify-between gap-3 text-sm" role="status">
      <p class="text-text-muted">{{ t('people.someMissing') }}</p>
      <BaseButton variant="ghost" @click="emit('retry')">{{ t('common.retry') }}</BaseButton>
    </div>
  </div>
</template>
