<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'

import * as accountApi from '@/api/account'
import { isApiError } from '@/api/errors'
import BaseButton from '@/components/common/BaseButton.vue'
import AuthLayout from '@/components/layout/AuthLayout.vue'
import { useAuthStore } from '@/stores/auth'
import { errorMessage } from '@/utils/errorMessage'

/**
 * The page the verification email links to (`/verify-email?id=…&hash=…&expires=…&signature=…`). It sends the four
 * values to the API at once. It works signed in or not, on any device: the signed link is the proof.
 */
type State = 'checking' | 'verified' | 'invalid' | 'gone' | 'incomplete' | 'failed'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const read = (key: string): string => (typeof route.query[key] === 'string' ? (route.query[key] as string) : '')
const link: accountApi.VerificationLink = { id: read('id'), hash: read('hash'), expires: read('expires'), signature: read('signature') }

const state = ref<State>(Object.values(link).every((value) => value !== '') ? 'checking' : 'incomplete')
const problem = ref('')
const resending = ref(false)
const resent = ref(false)
const resendError = ref('')

async function check(): Promise<void> {
  state.value = 'checking'
  problem.value = ''
  try {
    await accountApi.verifyEmail(link)
    state.value = 'verified'
    // Signed in on this device: the profile now says so (the reminder banner goes away).
    if (auth.isAuthenticated) await auth.refreshUser()
  } catch (error) {
    if (!isApiError(error)) throw error
    if (error.status === 403) state.value = 'invalid'
    else if (error.status === 404) state.value = 'gone'
    else {
      state.value = 'failed'
      problem.value = errorMessage(error, t)
    }
  }
}

async function resend(): Promise<void> {
  resending.value = true
  resendError.value = ''
  try {
    const { verified } = await accountApi.sendVerificationEmail()
    if (verified) {
      state.value = 'verified'
      await auth.refreshUser()
    } else resent.value = true
  } catch (error) {
    if (!isApiError(error)) throw error
    resendError.value = errorMessage(error, t)
  } finally {
    resending.value = false
  }
}

onMounted(() => {
  // The link's values are not kept in the address bar or the history.
  if (Object.keys(route.query).length > 0) void router.replace({ name: 'verify-email' })
  // This page is outside the app's shell, which is what usually loads the profile.
  if (auth.isAuthenticated) void auth.ensureUser()
  if (state.value === 'checking') void check()
})

const linkClass =
  'inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-primary px-4 font-medium text-on-primary transition-colors duration-150 hover:bg-primary-hover'
</script>

<template>
  <AuthLayout :title="t('account.verify.title')">
    <div class="flex flex-col gap-4">
      <p v-if="state === 'checking'" class="text-sm text-text-muted" role="status">{{ t('account.verify.checking') }}</p>

      <template v-else-if="state === 'verified'">
        <p class="rounded-lg bg-primary-soft px-3 py-2 text-sm text-text" role="status">{{ t('account.verify.done') }}</p>
        <RouterLink :to="auth.isAuthenticated ? '/' : '/login'" :class="linkClass">
          {{ auth.isAuthenticated ? t('account.verify.continue') : t('auth.signIn') }}
        </RouterLink>
      </template>

      <template v-else-if="state === 'failed'">
        <p class="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{{ problem }}</p>
        <BaseButton size="lg" block @click="check">{{ t('common.retry') }}</BaseButton>
      </template>

      <template v-else>
        <p class="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
          {{ state === 'gone' ? t('account.verify.gone') : state === 'incomplete' ? t('account.verify.incomplete') : t('account.verify.invalid') }}
        </p>
        <template v-if="state !== 'gone'">
          <template v-if="auth.isAuthenticated">
            <p v-if="resent" class="text-sm text-text" role="status">{{ t('account.verify.sent', { email: auth.user?.email ?? '' }) }}</p>
            <BaseButton v-else size="lg" block :loading="resending" @click="resend">{{ t('account.verify.sendNew') }}</BaseButton>
            <p v-if="resendError" class="text-sm text-danger" role="alert">{{ resendError }}</p>
          </template>
          <RouterLink v-else :to="{ name: 'login', query: { redirect: '/settings' } }" :class="linkClass">{{ t('account.verify.signInForNew') }}</RouterLink>
        </template>
      </template>
    </div>
  </AuthLayout>
</template>
