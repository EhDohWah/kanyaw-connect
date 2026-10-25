import type { TextStyle } from 'react-native'

import { usesMyanmarScript } from '@/i18n'
import { colors } from '@/theme/tokens'
import { myanmarFont, type FontWeight } from '@/theme/typography'

/** The font for text the navigators draw themselves (headers, tab labels): the Myanmar font for `my` and `ksw`. */
export function navigationFont(locale: string, weight: FontWeight): TextStyle {
  return usesMyanmarScript(locale) ? myanmarFont(weight) : { fontWeight: String(weight) as TextStyle['fontWeight'] }
}

export function headerOptions(locale: string) {
  return {
    headerTintColor: colors.primary,
    headerTitleStyle: { ...navigationFont(locale, 600), color: colors.text },
    headerStyle: { backgroundColor: colors.bg },
    contentStyle: { backgroundColor: colors.bg },
  }
}
