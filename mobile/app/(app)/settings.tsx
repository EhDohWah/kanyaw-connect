import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { AppText } from '@/components/common/AppText'
import { Button } from '@/components/common/Button'
import { Screen } from '@/components/common/Screen'
import { useAuthStore } from '@/stores/auth'
import { space } from '@/theme/tokens'

/** A skeleton: the account and signing out. Notifications, calls, data saver and the rest arrive in 8F. */
export default function SettingsScreen() {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.user)
  const logout = useAuthStore((state) => state.logout)
  const [signingOut, setSigningOut] = useState(false)

  async function signOut(): Promise<void> {
    setSigningOut(true)
    // Always ends signed out (the server call is best effort); the root layout then shows the sign-in screen.
    await logout()
  }

  return (
    <Screen>
      <View style={styles.section}>
        <AppText size="sm" weight={600} color="textMuted" accessibilityRole="header">
          {t('settings.account')}
        </AppText>
        {user ? <AppText>{t('settings.signedInAs', { name: user.name })}</AppText> : null}
        <Button
          label={t('settings.signOut')}
          loadingLabel={t('settings.signingOut')}
          loading={signingOut}
          variant="danger"
          onPress={() => void signOut()}
        />
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({ section: { gap: space[3] } })
