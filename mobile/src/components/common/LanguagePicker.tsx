import { Check } from 'lucide-react-native'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, View } from 'react-native'

import { isApiError } from '@/api/errors'
import { AppText } from '@/components/common/AppText'
import { LOCALES, type AppLocale } from '@/i18n'
import { useAuthStore } from '@/stores/auth'
import { colors, radius, space, TOUCH_TARGET } from '@/theme/tokens'
import { textStyleFor } from '@/theme/typography'
import { errorMessage } from '@/utils/errorMessage'

/** Myanmar, Myanmar Extended-A and Extended-B. */
const MYANMAR_SCRIPT = /[\u1000-\u109F\uA9E0-\uA9FF\uAA60-\uAA7F]/

/**
 * The three languages as a list of choices, each written in its own language, in the font its script needs (so "မြန်မာ" uses
 * the Myanmar font even while the app is in English). Changing it switches the app at once and, when signed in, saves it on the account.
 */
export function LanguagePicker({ onError }: { onError?: (message: string) => void }) {
  const { t, i18n } = useTranslation()
  const changeLocale = useAuthStore((state) => state.changeLocale)

  async function choose(locale: AppLocale): Promise<void> {
    try {
      await changeLocale(locale)
    } catch (error) {
      // The language already changed on this phone; only remembering it on the account failed.
      if (isApiError(error)) onError?.(errorMessage(error, t))
    }
  }

  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={t('common.language')} style={styles.list}>
      {LOCALES.map((locale) => {
        const selected = i18n.language === locale
        const name = t(`languages.${locale}`, { lng: locale })
        return (
          <Pressable
            key={locale}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => void choose(locale)}
            style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.surface : colors.bg }]}
          >
            <AppText
              style={[styles.label, textStyleFor(MYANMAR_SCRIPT.test(name) ? 'my' : 'en', 15, selected ? 600 : 400)]}
            >
              {name}
            </AppText>
            {selected ? <Check size={20} color={colors.primary} /> : null}
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  list: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' },
  row: {
    minHeight: TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space[4],
    gap: space[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  label: { flex: 1 },
})
