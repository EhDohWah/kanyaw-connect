import { StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { AppText } from '@/components/common/AppText'
import { space } from '@/theme/tokens'

/** The app's name and the screen's title, at the top of the sign-in and sign-up screens. */
export function AuthHeader({ title }: { title: string }) {
  const { t } = useTranslation()
  return (
    <View style={styles.wrap}>
      <AppText size="sm" weight={600} color="primary">
        {t('app.name')}
      </AppText>
      <AppText size="xl" weight={700} accessibilityRole="header">
        {title}
      </AppText>
    </View>
  )
}

const styles = StyleSheet.create({ wrap: { gap: space[1], marginTop: space[6] } })
