import { useTranslation } from 'react-i18next'
import { Text, type TextProps } from 'react-native'

import { colors, fontSize as sizes, type ColorName } from '@/theme/tokens'
import { textStyleFor, type FontWeight } from '@/theme/typography'

export interface AppTextProps extends TextProps {
  size?: keyof typeof sizes
  weight?: FontWeight
  color?: ColorName
}

/**
 * Text in the app's language: the bundled Myanmar font and taller lines for Burmese and S'gaw Karen, the system font
 * for English. It grows with the phone's text size up to 200% (the layout is checked at that size).
 */
export function AppText({ size = 'body', weight = 400, color = 'text', style, ...props }: AppTextProps) {
  const { i18n } = useTranslation()
  return (
    <Text
      maxFontSizeMultiplier={2}
      {...props}
      style={[textStyleFor(i18n.language, sizes[size], weight), { color: colors[color] }, style]}
    />
  )
}
