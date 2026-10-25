import { WifiOff } from 'lucide-react-native'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { AppText } from '@/components/common/AppText'
import { isOfflineShown, useRealtimeStore } from '@/stores/realtime'
import { colors, space } from '@/theme/tokens'

/** "You are offline" across the top while the phone has no network or the live connection is down. */
export function OfflineBanner() {
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()
  const shown = useRealtimeStore(isOfflineShown)
  const networkOnline = useRealtimeStore((state) => state.networkOnline)
  if (!shown) return null

  return (
    <View
      style={[styles.banner, { paddingTop: insets.top + space[2] }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <WifiOff size={16} color={colors.text} />
      <AppText size="sm" weight={500} style={styles.text}>
        {networkOnline ? t('shell.reconnecting') : t('shell.offline')}
      </AppText>
    </View>
  )
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingHorizontal: space[4],
    paddingBottom: space[2],
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  text: { flex: 1 },
})
