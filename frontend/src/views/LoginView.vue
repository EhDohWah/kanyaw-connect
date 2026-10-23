<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'

import { isApiError } from '@/api/errors'
import BaseButton from '@/components/common/BaseButton.vue'
import BaseInput from '@/components/common/BaseInput.vue'
import AuthLayout from '@/components/layout/AuthLayout.vue'
import { useAuthStore } from '@/stores/auth'
import { errorMessage } from '@/utils/errorMessage'
import { safeRedirect } from '@/utils/safeRedirect'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const email = ref('')
const password = ref('')
const submitting = ref(false)
const formError = ref('')
const emailError = ref('')
const passwordError = ref('')

// Why the person is looking at this screen when they did not ask to sign out. Kept as a key so a language
// change translates it; the reason is shown once, so it is cleared from the store after this screen opens.
const noticeKey =
  route.query.created === '1' ? 'auth.createdButSignInFailed' : auth.endedReason === 'expired' ? 'auth.sessionEnded' : ''
onMounted(() => {
  auth.endedReason = null
})

function validate(): boolean {
  emailError.value = email.value.trim() ? '' : t('auth.emailRequired')
  passwordError.value = password.value ? '' : t('auth.passwordRequired')
  return !emailError.value && !passwordError.value
}

async function submit(): Promise<void> {
  formError.value = ''
  if (!validate()) return

  submitting.value = true
  try {
    await auth.login(email.value, password.value)
    await router.replace(safeRedirect(route.query.redirect))
  } catch (error) {
    if (!isApiError(error)) throw error
    // A wrong email and a wrong password get the same answer on purpose, so it is shown for the form as a whole.
    formError.value =
      error.status === 422
        ? (error.fieldError('email') ?? error.fieldError('password') ?? error.message)
        : errorMessage(error, t)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <AuthLayout :title="t('auth.signInTitle')">
    <form class="flex flex-col gap-4" novalidate @submit.prevent="submit">
      <p v-if="noticeKey" class="rounded-lg bg-primary-soft px-3 py-2 text-sm text-text" role="status">{{ t(noticeKey) }}</p>
      <p v-if="formError" class="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{{ formError }}</p>

      <BaseInput
        v-model="email"
        :label="t('auth.email')"
        :error="emailError"
        type="email"
        name="email"
        autocomplete="username"
        inputmode="email"
        autocapitalize="none"
        spellcheck="false"
        required
      />
      <BaseInput
        v-model="password"
        :label="t('auth.password')"
        :error="passwordError"
        type="password"
        name="password"
        autocomplete="current-password"
        required
      />

      <BaseButton type="submit" size="lg" block :loading="submitting">
        {{ submitting ? t('auth.signingIn') : t('auth.signIn') }}
      </BaseButton>
    </form>

    <p class="mt-6 text-center text-sm text-text-muted">
      {{ t('auth.noAccount') }}
      <RouterLink to="/register" class="font-medium text-primary underline underline-offset-2 hover:text-primary-hover">
        {{ t('auth.signUp') }}
      </RouterLink>
    </p>
  </AuthLayout>
</template>
