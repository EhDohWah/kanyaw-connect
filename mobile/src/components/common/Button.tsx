import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, View, type PressableProps } from 'react-native'

import { AppText } from '@/components/common/AppText'
import { colors, radius, space, TOUCH_TARGET, type ColorName } from '@/theme/tokens'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'

const LOOK: Record<
  Variant,
  { background: ColorName | null; pressed: ColorName; text: ColorName; border: ColorName | null }
> = {
  primary: { background: 'primary', pressed: 'primaryHover', text: 'onPrimary', border: null },
  secondary: { background: 'bg', pressed: 'surface', text: 'text', border: 'border' },
  danger: { background: 'bg', pressed: 'dangerSoft', text: 'danger', border: 'border' },
  ghost: { background: null, pressed: 'surface', text: 'primary', border: null },
}

export interface ButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  label: string
  variant?: Variant
  /** Shows a spinner and the busy label, and ignores presses. */
  loading?: boolean
  loadingLabel?: string
  icon?: ReactNode
}

/** At least 48 points tall, so it is easy to hit on both platforms. */
export function Button({
  label,
  variant = 'primary',
  loading = false,
  loadingLabel,
  icon,
  disabled,
  ...props
}: ButtonProps) {
  const look = LOOK[variant]
  const inactive = disabled || loading
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      {...props}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: pressed ? colors[look.pressed] : look.background ? colors[look.background] : 'transparent',
          borderColor: look.border ? colors[look.border] : 'transparent',
          opacity: disabled && !loading ? 0.5 : 1,
        },
      ]}
    >
      <View style={styles.row}>
        {loading ? <ActivityIndicator color={colors[look.text]} /> : icon}
        <AppText weight={600} color={look.text} style={styles.label}>
          {loading && loadingLabel ? loadingLabel : label}
        </AppText>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  base: {
    minHeight: TOUCH_TARGET,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[2] },
  label: { textAlign: 'center', flexShrink: 1 },
})
