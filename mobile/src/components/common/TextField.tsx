import { Eye, EyeOff } from 'lucide-react-native'
import { useId, useState, type ComponentRef, type Ref } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native'

import { AppText } from '@/components/common/AppText'
import { colors, fontSize, radius, space, TOUCH_TARGET } from '@/theme/tokens'
import { textStyleFor } from '@/theme/typography'

export interface TextFieldProps extends TextInputProps {
  label: string
  hint?: string
  /** Shown under the field in red, and read out with it. */
  error?: string
  /** A password field with a "Show password" button. */
  password?: boolean
  ref?: Ref<TextFieldHandle>
}

export type TextFieldHandle = ComponentRef<typeof TextInput>

export function TextField({ label, hint, error, password = false, style, ref, ...props }: TextFieldProps) {
  const { t, i18n } = useTranslation()
  const [revealed, setRevealed] = useState(false)
  const id = useId()
  const help = error || hint

  return (
    <View style={styles.wrap}>
      <AppText size="sm" weight={500} nativeID={`${id}-label`}>
        {label}
      </AppText>
      <View style={[styles.box, { borderColor: error ? colors.danger : colors.border }]}>
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          accessibilityLabelledBy={`${id}-label`}
          accessibilityHint={help}
          aria-invalid={Boolean(error)}
          placeholderTextColor={colors.textMuted}
          maxFontSizeMultiplier={2}
          secureTextEntry={password && !revealed}
          autoCapitalize={password ? 'none' : props.autoCapitalize}
          autoCorrect={password ? false : props.autoCorrect}
          {...props}
          style={[styles.input, textStyleFor(i18n.language, fontSize.field), { color: colors.text }, style]}
        />
        {password ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={revealed ? t('common.hidePassword') : t('common.showPassword')}
            onPress={() => setRevealed((value) => !value)}
            style={styles.reveal}
            hitSlop={4}
          >
            {revealed ? <EyeOff size={20} color={colors.textMuted} /> : <Eye size={20} color={colors.textMuted} />}
          </Pressable>
        ) : null}
      </View>
      {help ? (
        <AppText size="sm" color={error ? 'danger' : 'textMuted'} accessibilityLiveRegion={error ? 'polite' : 'none'}>
          {help}
        </AppText>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: space[1] },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: TOUCH_TARGET,
    borderWidth: 1,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
  },
  input: { flex: 1, paddingHorizontal: space[3], paddingVertical: space[2] },
  reveal: { width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
})
