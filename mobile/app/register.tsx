import { useRouter } from 'expo-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { isApiError } from '@/api/errors'
import { AppText } from '@/components/common/AppText'
import { AuthHeader } from '@/components/common/AuthHeader'
import { Button } from '@/components/common/Button'
import { Notice } from '@/components/common/Notice'
import { Screen } from '@/components/common/Screen'
import { TextField } from '@/components/common/TextField'
import { useAuthStore } from '@/stores/auth'
import { space } from '@/theme/tokens'
import { errorMessage } from '@/utils/errorMessage'

type Field = 'name' | 'email' | 'phone' | 'password' | 'password_confirmation'
const FIELDS: Field[] = ['name', 'email', 'phone', 'password', 'password_confirmation']
const EMPTY: Record<Field, string> = { name: '', email: '', phone: '', password: '', password_confirmation: '' }

// Ported from frontend/src/views/RegisterView.vue.
export default function RegisterScreen() {
  const { t } = useTranslation()
  const router = useRouter()
  const register = useAuthStore((state) => state.register)

  const [form, setForm] = useState(EMPTY)
  const [errors, setErrors] = useState(EMPTY)
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const set = (field: Field) => (value: string) => setForm((current) => ({ ...current, [field]: value }))

  /** Quick checks before asking the server; the server still has the last word (for example on a taken email). */
  function validate(): boolean {
    const next = {
      ...EMPTY,
      name: form.name.trim() ? '' : t('auth.nameRequired'),
      email: form.email.trim() ? '' : t('auth.emailRequired'),
      password: form.password.length >= 8 ? '' : t('auth.passwordTooShort'),
      password_confirmation: form.password_confirmation === form.password ? '' : t('auth.passwordMismatch'),
    }
    setErrors(next)
    return !Object.values(next).some(Boolean)
  }

  async function submit(): Promise<void> {
    setFormError('')
    if (!validate()) return

    setSubmitting(true)
    try {
      const phone = form.phone.trim()
      const outcome = await register({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        password_confirmation: form.password_confirmation,
        ...(phone ? { phone } : {}),
      })
      // Signed in: the root layout moves on by itself. Otherwise the account exists: sign in with it.
      if (outcome === 'needs-login') router.replace({ pathname: '/login', params: { created: '1' } })
    } catch (error) {
      if (!isApiError(error)) throw error
      if (error.status === 422) {
        const next = Object.fromEntries(FIELDS.map((field) => [field, error.fieldError(field) ?? ''])) as Record<
          Field,
          string
        >
        setErrors(next)
        if (!Object.values(next).some(Boolean)) setFormError(error.message)
      } else {
        setFormError(errorMessage(error, t))
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Screen padTop>
      <AuthHeader title={t('auth.signUpTitle')} />
      {formError ? <Notice text={formError} tone="error" /> : null}

      <TextField
        label={t('auth.fullName')}
        value={form.name}
        onChangeText={set('name')}
        error={errors.name}
        autoComplete="name"
        textContentType="name"
      />
      <TextField
        label={t('auth.email')}
        value={form.email}
        onChangeText={set('email')}
        error={errors.email}
        autoComplete="email"
        textContentType="emailAddress"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <TextField
        label={`${t('auth.phone')} (${t('common.optional')})`}
        value={form.phone}
        onChangeText={set('phone')}
        error={errors.phone}
        hint={t('auth.phoneHint')}
        autoComplete="tel"
        textContentType="telephoneNumber"
        keyboardType="phone-pad"
      />
      <TextField
        label={t('auth.password')}
        value={form.password}
        onChangeText={set('password')}
        error={errors.password}
        hint={t('auth.passwordHint')}
        password
        autoComplete="new-password"
        textContentType="newPassword"
      />
      <TextField
        label={t('auth.confirmPassword')}
        value={form.password_confirmation}
        onChangeText={set('password_confirmation')}
        error={errors.password_confirmation}
        password
        autoComplete="new-password"
        textContentType="newPassword"
      />
      <Button
        label={t('auth.signUp')}
        loadingLabel={t('auth.creatingAccount')}
        loading={submitting}
        onPress={() => void submit()}
      />

      <View style={styles.row}>
        <AppText color="textMuted">{t('auth.haveAccount')}</AppText>
        {/* Create account opens over sign-in, so going back is the way there (and the back gesture does the same). */}
        <Button
          label={t('auth.signIn')}
          variant="ghost"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/login'))}
        />
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: space[1] },
})
