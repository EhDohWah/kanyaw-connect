import { StyleSheet, View } from 'react-native'

import { AppText } from '@/components/common/AppText'
import { colors, radius, space } from '@/theme/tokens'

/** A message about the whole form or screen: an error (red) or information. Read out when it appears. */
export function Notice({ text, tone = 'info' }: { text: string; tone?: 'info' | 'error' | 'success' }) {
  const look =
    tone === 'error'
      ? { backgroundColor: colors.dangerSoft, color: 'danger' as const }
      : tone === 'success'
        ? { backgroundColor: colors.surface, color: 'success' as const }
        : { backgroundColor: colors.primarySoft, color: 'text' as const }
  return (
    <View
      style={[styles.box, { backgroundColor: look.backgroundColor }]}
      accessibilityRole={tone === 'error' ? 'alert' : 'text'}
      accessibilityLiveRegion="polite"
    >
      <AppText size="sm" color={look.color}>
        {text}
      </AppText>
    </View>
  )
}

const styles = StyleSheet.create({ box: { borderRadius: radius.md, padding: space[3] } })
