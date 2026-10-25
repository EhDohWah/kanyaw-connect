import type { ReactNode } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { colors, space } from '@/theme/tokens'

export interface ScreenProps {
  children: ReactNode
  /** Forms scroll, so nothing is cut off at large text sizes or behind the keyboard. */
  scroll?: boolean
  /** Screens without a navigation header (sign-in) keep clear of the notch themselves. */
  padTop?: boolean
}

export function Screen({ children, scroll = true, padTop = false }: ScreenProps) {
  const insets = useSafeAreaInsets()
  const padding = { paddingTop: padTop ? insets.top + space[4] : space[4], paddingBottom: space[6] }
  if (!scroll) return <View style={[styles.fill, styles.page, padding]}>{children}</View>

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={styles.fill}
        contentContainerStyle={[styles.page, padding]}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  page: { paddingHorizontal: space[4], gap: space[4], flexGrow: 1 },
})
