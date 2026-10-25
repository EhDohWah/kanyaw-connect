<script setup lang="ts">
import { ref } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'

import * as accountApi from '@/api/account'
import { isApiError } from '@/api/errors'
import BaseButton from '@/components/common/BaseButton.vue'
import BaseInput from '@/components/common/BaseInput.vue'
import AuthLayout from '@/components/layout/AuthLayout.vue'
import { errorMessage } from '@/utils/errorMessage'

/**
 * "Forgot your password?": asks for the address and sends a reset link. The server answers the same whether or not
 * the address has an account, so this page says the same too.
 */
const { t } = useI18n()
const route = useRoute()

const email = ref(typeof route.query.email === 'string' ? route.query.email : '')
const emailError = ref('')
const formError = ref('')
const submitting = ref(false)
/** The address the link was sent to (shown in the confirmation). */
const sentTo = ref('')

async function submit(): Promise<void> {
  formError.value = ''
  const address = email.value.trim()
  emailError.value = address ? '' : t('auth.emailRequired')
  if (emailError.value) return

  submitting.value = true
  try {
    await accountApi.forgotPassword(address)
    sentTo.value = address
  } catch (error) {
    if (!isApiError(error)) throw error
    if (error.status === 422) emailError.value = error.fieldError('email') ?? error.message
    else formError.value = errorMessage(error, t)
  } finally {
    submitting.value = false
  }
}

function again(): void {
  sentTo.value = ''
}
</script>

<template>
  <AuthLayout :title="t('account.forgot.title')">
    <div v-if="sentTo" class="flex flex-col gap-4">
      <p class="rounded-lg bg-primary-soft px-3 py-2 text-sm text-text" role="status">{{ t('account.forgot.sent', { email: sentTo }) }}</p>
      <p class="text-sm text-text-muted">{{ t('account.forgot.spamHint') }}</p>
      <BaseButton variant="secondary" class="self-start" @click="again">{{ t('account.forgot.again') }}</BaseButton>
    </div>

    <form v-else class="flex flex-col gap-4" novalidate @submit.prevent="submit">
      <p class="text-sm text-text-muted">{{ t('account.forgot.intro') }}</p>
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
      <BaseButton type="submit" size="lg" block :loading="submitting">
        {{ submitting ? t('account.forgot.sending') : t('account.forgot.submit') }}
      </BaseButton>
    </form>

    <p class="mt-6 text-center text-sm">
      <RouterLink to="/login" class="font-medium text-primary underline underline-offset-2 hover:text-primary-hover">
        {{ t('account.backToSignIn') }}
      </RouterLink>
    </p>
  </AuthLayout>
</template>
