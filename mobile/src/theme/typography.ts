import { Platform, type TextStyle } from 'react-native'

import { usesMyanmarScript } from '@/i18n'

export type FontWeight = 400 | 500 | 600 | 700

/**
 * The bundled Noto Sans Myanmar at a weight (app.config.ts embeds the four files). Android: the family the `expo-font`
 * plugin declares, with the weight. iOS: the PostScript name of each file, because two of the files name their family
 * "Noto Sans Myanmar Medium" and "… SemiBold", so a family name with a weight would not reliably reach them.
 */
export function myanmarFont(weight: FontWeight): TextStyle {
  if (Platform.OS === 'android')
    return { fontFamily: 'NotoSansMyanmar', fontWeight: String(weight) as TextStyle['fontWeight'] }
  const face = { 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold' }[weight]
  return { fontFamily: `NotoSansMyanmar-${face}` }
}

/**
 * The text style for a language. Latin text uses the system font, as on the web (nothing to download). Myanmar script
 * (Burmese, S'gaw Karen) uses the bundled font, with lines about 1.8 times the font size: its stacked vowel signs need
 * the room. `includeFontPadding` stays at its default on Android on purpose: turning it off clips Burmese on older
 * Android versions.
 */
export function textStyleFor(locale: string, fontSize: number, weight: FontWeight = 400): TextStyle {
  if (!usesMyanmarScript(locale)) {
    return { fontSize, lineHeight: Math.round(fontSize * 1.5), fontWeight: String(weight) as TextStyle['fontWeight'] }
  }
  return { fontSize, lineHeight: Math.round(fontSize * 1.8), ...myanmarFont(weight) }
}
