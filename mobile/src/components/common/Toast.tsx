import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { AppText } from '@/components/common/AppText'
import { useToastStore } from '@/stores/toast'
import { colors, radius, space } from '@/theme/tokens'

/** The toast from `useToastStore`, above the bottom edge. Read out by screen readers when it appears. */
export function Toast() {
  const toast = useToastStore((state) => state.current)
  const insets = useSafeAreaInsets()
  if (!toast) return null

  return (
    <View pointerEvents="none" style={[styles.wrap, { bottom: insets.bottom + space[10] * 2 }]}>
      <View
        style={[styles.toast, toast.tone === 'error' ? styles.error : null]}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
      >
        <AppText color={toast.tone === 'error' ? 'danger' : 'onPrimary'} weight={500}>
          {toast.text}
        </AppText>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space[4], right: space[4], alignItems: 'center' },
  toast: {
    backgroundColor: colors.text,
    borderRadius: radius.lg,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
  },
  error: { backgroundColor: colors.dangerSoft },
})
