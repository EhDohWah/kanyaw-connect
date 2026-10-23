<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'

import { isApiError } from '@/api/errors'
import BaseButton from '@/components/common/BaseButton.vue'
import BaseInput from '@/components/common/BaseInput.vue'
import AuthLayout from '@/components/layout/AuthLayout.vue'
import { useAuthStore } from '@/stores/auth'
import { errorMessage } from '@/utils/errorMessage'

const { t } = useI18n()
const router = useRouter()
const auth = useAuthStore()

const form = reactive({ name: '', email: '', phone: '', password: '', password_confirmation: '' })
const errors = reactive<Record<keyof typeof form, string>>({
  name: '',
  email: '',
  phone: '',
  password: '',
  password_confirmation: '',
})
const formError = ref('')
const submitting = ref(false)

function clearErrors(): void {
  formError.value = ''
  for (const key of Object.keys(errors) as (keyof typeof errors)[]) errors[key] = ''
}

/** Quick checks before asking the server; the server still has the last word (for example on a taken email). */
function validate(): boolean {
  errors.name = form.name.trim() ? '' : t('auth.nameRequired')
  errors.email = form.email.trim() ? '' : t('auth.emailRequired')
  errors.password = form.password.length >= 8 ? '' : t('auth.passwordTooShort')
  errors.password_confirmation = form.password_confirmation === form.password ? '' : t('auth.passwordMismatch')
  return !Object.values(errors).some(Boolean)
}

async function submit(): Promise<void> {
  clearErrors()
  if (!validate()) return

  submitting.value = true
  try {
    const phone = form.phone.trim()
    const outcome = await auth.register({
      name: form.name.trim(),
      email: form.email.trim(),
      password: form.password,
      password_confirmation: form.password_confirmation,
      ...(phone ? { phone } : {}),
    })

    await (outcome === 'signed-in' ? router.replace('/') : router.replace({ name: 'login', query: { created: '1' } }))
  } catch (error) {
    if (!isApiError(error)) throw error

    if (error.status === 422) {
      for (const key of Object.keys(errors) as (keyof typeof errors)[]) errors[key] = error.fieldError(key) ?? ''
      if (!Object.values(errors).some(Boolean)) formError.value = error.message
    } else {
      formError.value = errorMessage(error, t)
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <AuthLayout :title="t('auth.signUpTitle')">
    <form class="flex flex-col gap-4" novalidate @submit.prevent="submit">
      <p v-if="formError" class="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{{ formError }}</p>

      <BaseInput
        v-model="form.name"
        :label="t('auth.fullName')"
        :error="errors.name"
        name="name"
        autocomplete="name"
        required
      />
      <BaseInput
        v-model="form.email"
        :label="t('auth.email')"
        :error="errors.email"
        type="email"
        name="email"
        autocomplete="email"
        inputmode="email"
        autocapitalize="none"
        spellcheck="false"
        required
      />
      <BaseInput
        v-model="form.phone"
        :label="t('auth.phone')"
        :hint="t('auth.phoneHint')"
        :error="errors.phone"
        type="tel"
        name="phone"
        autocomplete="tel"
        inputmode="tel"
        optional
      />
      <BaseInput
        v-model="form.password"
        :label="t('auth.password')"
        :hint="t('auth.passwordHint')"
        :error="errors.password"
        type="password"
        name="password"
        autocomplete="new-password"
        required
      />
      <BaseInput
        v-model="form.password_confirmation"
        :label="t('auth.confirmPassword')"
        :error="errors.password_confirmation"
        type="password"
        name="password_confirmation"
        autocomplete="new-password"
        required
      />

      <BaseButton type="submit" size="lg" block :loading="submitting">
        {{ submitting ? t('auth.creatingAccount') : t('auth.signUp') }}
      </BaseButton>
    </form>

    <p class="mt-6 text-center text-sm text-text-muted">
      {{ t('auth.haveAccount') }}
      <RouterLink to="/login" class="font-medium text-primary underline underline-offset-2 hover:text-primary-hover">
        {{ t('auth.signIn') }}
      </RouterLink>
    </p>
  </AuthLayout>
</template>
