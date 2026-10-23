<script setup lang="ts">
import { Settings } from 'lucide-vue-next'
import { computed, reactive, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import { isApiError } from '@/api/errors'
import AvatarUploader from '@/components/common/AvatarUploader.vue'
import BaseButton from '@/components/common/BaseButton.vue'
import BaseInput from '@/components/common/BaseInput.vue'
import LanguageSwitcher from '@/components/common/LanguageSwitcher.vue'
import Skeleton from '@/components/common/Skeleton.vue'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { errorMessage } from '@/utils/errorMessage'
import { COMMON_TIMEZONES, allTimezones } from '@/utils/timezones'

const { t } = useI18n()
const auth = useAuthStore()
const ui = useUiStore()

const timezoneId = useId()

const form = reactive({
  name: auth.user?.name ?? '',
  phone: auth.user?.phone ?? '',
  timezone: auth.user?.timezone ?? 'Asia/Bangkok',
})
const errors = reactive({ name: '', phone: '', timezone: '' })
const formError = ref('')
const saving = ref(false)

const otherTimezones = computed(() => {
  const common = new Set<string>(COMMON_TIMEZONES)
  return allTimezones().filter((zone) => !common.has(zone))
})

// The account's zone might be a name this browser does not list; keep it selectable.
const knownZone = computed(
  () => (COMMON_TIMEZONES as readonly string[]).includes(form.timezone) || otherTimezones.value.includes(form.timezone),
)

const changes = computed(() => {
  const user = auth.user
  if (!user) return {}

  const patch: { name?: string; phone?: string | null; timezone?: string } = {}
  if (form.name.trim() !== user.name) patch.name = form.name.trim()
  if (form.phone.trim() !== (user.phone ?? '')) patch.phone = form.phone.trim() === '' ? null : form.phone.trim()
  if (form.timezone !== user.timezone) patch.timezone = form.timezone
  return patch
})
const dirty = computed(() => Object.keys(changes.value).length > 0)

async function save(): Promise<void> {
  formError.value = ''
  errors.name = errors.phone = errors.timezone = ''

  if (!form.name.trim()) {
    errors.name = t('auth.nameRequired')
    return
  }

  saving.value = true
  try {
    const saved = await auth.updateProfile(changes.value)
    // Show what the server kept (it may tidy a value), so "Save changes" does not stay on for no reason.
    form.name = saved.name
    form.phone = saved.phone ?? ''
    form.timezone = saved.timezone
    ui.toast(t('profile.saved'))
  } catch (error) {
    if (!isApiError(error)) throw error

    if (error.status === 422) {
      errors.name = error.fieldError('name') ?? ''
      errors.phone = error.fieldError('phone') ?? ''
      errors.timezone = error.fieldError('timezone') ?? ''
      if (!errors.name && !errors.phone && !errors.timezone) formError.value = error.message
    } else {
      formError.value = errorMessage(error, t)
    }
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="mx-auto flex max-w-xl flex-col gap-8 p-4 md:p-8">
    <header class="flex items-center justify-between gap-3">
      <h1 class="text-2xl font-semibold">{{ t('profile.title') }}</h1>
      <!-- On phones Settings is not in the bottom bar, so it is one tap away from here. -->
      <RouterLink
        to="/settings"
        class="flex size-11 items-center justify-center rounded-lg text-text transition-colors duration-150 hover:bg-surface md:hidden"
        :aria-label="t('nav.settings')"
      >
        <Settings class="size-5" aria-hidden="true" />
      </RouterLink>
    </header>

    <div v-if="!auth.user" class="flex flex-col gap-4" role="status">
      <span class="sr-only">{{ t('common.loading') }}</span>
      <Skeleton rounded="full" class="size-28" />
      <Skeleton class="h-11" />
      <Skeleton class="h-11" />
      <Skeleton class="h-11" />
    </div>

    <template v-else>
      <AvatarUploader />

      <form class="flex flex-col gap-4" novalidate @submit.prevent="save">
        <p v-if="formError" class="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{{ formError }}</p>

        <BaseInput v-model="form.name" :label="t('profile.name')" :error="errors.name" name="name" autocomplete="name" required />
        <BaseInput
          :model-value="auth.user.email"
          :label="t('profile.email')"
          :hint="t('profile.emailLocked')"
          type="email"
          name="email"
          autocomplete="email"
          disabled
        />
        <BaseInput
          v-model="form.phone"
          :label="t('profile.phone')"
          :hint="t('auth.phoneHint')"
          :error="errors.phone"
          type="tel"
          name="phone"
          autocomplete="tel"
          inputmode="tel"
          optional
        />

        <div class="flex flex-col gap-1.5">
          <label :for="timezoneId" class="text-sm font-medium text-text">{{ t('profile.timezone') }}</label>
          <select
            :id="timezoneId"
            v-model="form.timezone"
            :aria-invalid="errors.timezone ? 'true' : undefined"
            :class="[
              'min-h-11 w-full rounded-lg border bg-bg px-3 text-text transition-colors duration-150',
              errors.timezone ? 'border-danger' : 'border-border hover:border-text-muted',
            ]"
          >
            <option v-if="!knownZone" :value="form.timezone">{{ form.timezone }}</option>
            <optgroup :label="t('profile.commonZones')">
              <option v-for="zone in COMMON_TIMEZONES" :key="zone" :value="zone">{{ zone.replaceAll('_', ' ') }}</option>
            </optgroup>
            <optgroup :label="t('profile.allZones')">
              <option v-for="zone in otherTimezones" :key="zone" :value="zone">{{ zone.replaceAll('_', ' ') }}</option>
            </optgroup>
          </select>
          <p class="text-sm text-text-muted">{{ t('profile.timezoneHint') }}</p>
          <p v-if="errors.timezone" class="text-sm text-danger">{{ errors.timezone }}</p>
        </div>

        <LanguageSwitcher />

        <BaseButton type="submit" :loading="saving" :disabled="!dirty">
          {{ saving ? t('common.saving') : t('common.save') }}
        </BaseButton>
      </form>
    </template>
  </div>
</template>
