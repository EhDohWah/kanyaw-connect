<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'

import * as accountApi from '@/api/account'
import { isApiError } from '@/api/errors'
import BaseButton from '@/components/common/BaseButton.vue'
import BaseInput from '@/components/common/BaseInput.vue'
import AuthLayout from '@/components/layout/AuthLayout.vue'
import { useAuthStore } from '@/stores/auth'
import { errorMessage } from '@/utils/errorMessage'

/**
 * The page the reset email links to (`/reset-password?token=…&email=…`): choose a new password. The token is read
 * once and taken out of the address bar, so it does not stay in the history or reach other sites as the referrer.
 */
const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const token = typeof route.query.token === 'string' ? route.query.token : ''
const email = typeof route.query.email === 'string' ? route.query.email : ''
const complete = token !== '' && email !== ''

const form = reactive({ password: '', password_confirmation: '' })
const errors = reactive({ password: '', password_confirmation: '' })
const formError = ref('')
/** The link is wrong, used or expired: a new one is needed. */
const linkInvalid = ref(false)
const submitting = ref(false)
const done = ref(false)

onMounted(() => {
  if (route.query.token !== undefined || route.query.email !== undefined) void router.replace({ name: 'reset-password' })
})

function validate(): boolean {
  errors.password = form.password.length >= 8 ? '' : t('auth.passwordTooShort')
  errors.password_confirmation = form.password_confirmation === form.password ? '' : t('auth.passwordMismatch')
  return !errors.password && !errors.password_confirmation
}

async function submit(): Promise<void> {
  formError.value = ''
  if (!validate()) return

  submitting.value = true
  try {
    await accountApi.resetPassword({ token, email, ...form })
    done.value = true
    // Every device was signed out, this one included.
    if (auth.isAuthenticated) auth.clearSession()
  } catch (error) {
    if (!isApiError(error)) throw error
    if (error.status === 422 && error.fieldError('token')) linkInvalid.value = true
    else if (error.status === 422) {
      errors.password = error.fieldError('password') ?? ''
      formError.value = errors.password ? '' : error.message
    } else formError.value = errorMessage(error, t)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <AuthLayout :title="t('account.reset.title')">
    <div v-if="done" class="flex flex-col gap-4">
      <p class="rounded-lg bg-primary-soft px-3 py-2 text-sm text-text" role="status">{{ t('account.reset.done') }}</p>
      <RouterLink :to="{ name: 'login', query: { email } }" class="inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-primary px-4 font-medium text-on-primary transition-colors duration-150 hover:bg-primary-hover">{{ t('auth.signIn') }}</RouterLink>
    </div>

    <div v-else-if="!complete || linkInvalid" class="flex flex-col gap-4">
      <p class="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
        {{ linkInvalid ? t('account.reset.invalid') : t('account.reset.incomplete') }}
      </p>
      <RouterLink :to="{ name: 'forgot-password', query: email ? { email } : {} }" class="inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-primary px-4 font-medium text-on-primary transition-colors duration-150 hover:bg-primary-hover">{{ t('account.reset.askAgain') }}</RouterLink>
    </div>

    <form v-else class="flex flex-col gap-4" novalidate @submit.prevent="submit">
      <p class="text-sm text-text-muted">{{ t('account.reset.for', { email }) }}</p>
      <p v-if="formError" class="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{{ formError }}</p>
      <!-- For password managers: the account this new password belongs to. -->
      <input type="email" name="email" autocomplete="username" :value="email" class="sr-only" tabindex="-1" aria-hidden="true" readonly />
      <BaseInput
        v-model="form.password"
        :label="t('account.newPassword')"
        :hint="t('auth.passwordHint')"
        :error="errors.password"
        type="password"
        name="password"
        autocomplete="new-password"
        required
      />
      <BaseInput
        v-model="form.password_confirmation"
        :label="t('account.confirmNewPassword')"
        :error="errors.password_confirmation"
        type="password"
        name="password_confirmation"
        autocomplete="new-password"
        required
      />
      <BaseButton type="submit" size="lg" block :loading="submitting">
        {{ submitting ? t('account.saving') : t('account.reset.submit') }}
      </BaseButton>
    </form>

    <!-- Once done, "Sign in" above is the way on. -->
    <p v-if="!done" class="mt-6 text-center text-sm">
      <RouterLink to="/login" class="font-medium text-primary underline underline-offset-2 hover:text-primary-hover">
        {{ t('account.backToSignIn') }}
      </RouterLink>
    </p>
  </AuthLayout>
</template>
