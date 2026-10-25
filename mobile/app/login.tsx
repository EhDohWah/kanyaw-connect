import { Link, useLocalSearchParams } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { isApiError } from '@/api/errors'
import { AppText } from '@/components/common/AppText'
import { AuthHeader } from '@/components/common/AuthHeader'
import { Button } from '@/components/common/Button'
import { LanguagePicker } from '@/components/common/LanguagePicker'
import { Notice } from '@/components/common/Notice'
import { Screen } from '@/components/common/Screen'
import { TextField, type TextFieldHandle } from '@/components/common/TextField'
import { useAuthStore } from '@/stores/auth'
import { space } from '@/theme/tokens'
import { errorMessage } from '@/utils/errorMessage'

// Ported from frontend/src/views/LoginView.vue.
export default function LoginScreen() {
  const { t } = useTranslation()
  const params = useLocalSearchParams<{ created?: string }>()
  const login = useAuthStore((state) => state.login)
  const passwordRef = useRef<TextFieldHandle>(null)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const [emailError, setEmailError] = useState('')
  const [passwordError, setPasswordError] = useState('')

  // Why the person is here without asking to sign out: shown once, so it is cleared from the store at once.
  const [noticeKey] = useState(() =>
    params.created === '1'
      ? 'auth.createdButSignInFailed'
      : useAuthStore.getState().endedReason === 'expired'
        ? 'auth.sessionEnded'
        : '',
  )
  useEffect(() => useAuthStore.getState().dismissEndedReason(), [])

  async function submit(): Promise<void> {
    setFormError('')
    const nextEmailError = email.trim() ? '' : t('auth.emailRequired')
    const nextPasswordError = password ? '' : t('auth.passwordRequired')
    setEmailError(nextEmailError)
    setPasswordError(nextPasswordError)
    if (nextEmailError || nextPasswordError) return

    setSubmitting(true)
    try {
      // On success the root layout moves to the signed-in screens by itself.
      await login(email, password)
    } catch (error) {
      if (!isApiError(error)) throw error
      // A wrong email and a wrong password get the same answer on purpose, so it is shown for the form as a whole.
      setFormError(
        error.status === 422
          ? (error.fieldError('email') ?? error.fieldError('password') ?? error.message)
          : errorMessage(error, t),
      )
      setSubmitting(false)
    }
  }

  return (
    <Screen padTop>
      <AuthHeader title={t('auth.signInTitle')} />
      {noticeKey ? <Notice text={t(noticeKey)} /> : null}
      {formError ? <Notice text={formError} tone="error" /> : null}

      <TextField
        label={t('auth.email')}
        value={email}
        onChangeText={setEmail}
        error={emailError}
        autoComplete="email"
        textContentType="username"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        submitBehavior="submit"
      />
      <TextField
        ref={passwordRef}
        label={t('auth.password')}
        value={password}
        onChangeText={setPassword}
        error={passwordError}
        password
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
      />
      <Button
        label={t('auth.signIn')}
        loadingLabel={t('auth.signingIn')}
        loading={submitting}
        onPress={() => void submit()}
      />

      <View style={styles.row}>
        <AppText color="textMuted">{t('auth.noAccount')}</AppText>
        <Link href="/register" asChild>
          <Button label={t('auth.signUp')} variant="ghost" />
        </Link>
      </View>

      <View style={styles.language}>
        <AppText size="sm" weight={500}>
          {t('common.language')}
        </AppText>
        <LanguagePicker />
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: space[1] },
  language: { gap: space[2], marginTop: space[4] },
})
