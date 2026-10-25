import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'

import { AppText } from '@/components/common/AppText'
import { Button } from '@/components/common/Button'
import { space } from '@/theme/tokens'

export interface StateMessageProps {
  title: string
  text?: string
  icon?: ReactNode
  /** A button under the text, for example "Try again". */
  action?: { label: string; onPress: () => void }
}

/** The empty and error states: a short title, a sentence, and at most one thing to do. */
export function StateMessage({ title, text, icon, action }: StateMessageProps) {
  return (
    <View style={styles.wrap}>
      {icon}
      <AppText size="lg" weight={600} style={styles.center} accessibilityRole="header">
        {title}
      </AppText>
      {text ? (
        <AppText color="textMuted" style={styles.center}>
          {text}
        </AppText>
      ) : null}
      {action ? <Button label={action.label} variant="secondary" onPress={action.onPress} /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space[3], padding: space[6] },
  center: { textAlign: 'center' },
})
