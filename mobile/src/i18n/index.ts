// Ported from frontend/src/i18n/index.ts. The texts are the web app's own files (see scripts/i18n-check.mjs).
import { getLocales } from 'expo-localization'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'

import en from './locales/en.json'
import ksw from './locales/ksw.json'
import my from './locales/my.json'

/** `en` English, `my` Burmese, `ksw` S'gaw Karen (the last two are written in Myanmar script). */
export const LOCALES = ['en', 'my', 'ksw'] as const
export type AppLocale = (typeof LOCALES)[number]

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

/** The account's language if it has one, else the phone's language if we have it, else English. */
export function detectLocale(
  stored: string | null = null,
  phoneLanguages: readonly string[] = getLocales().map((locale) => locale.languageCode ?? ''),
): AppLocale {
  if (isAppLocale(stored)) return stored
  for (const language of phoneLanguages) {
    const base = language.toLowerCase().split('-')[0]
    if (isAppLocale(base)) return base
  }
  return 'en'
}

/** Burmese and S'gaw Karen are written in Myanmar script, which needs the bundled font and taller lines. */
export function usesMyanmarScript(locale: string): boolean {
  return locale === 'my' || locale === 'ksw'
}

void i18next.use(initReactI18next).init({
  resources: { en: { translation: en }, my: { translation: my }, ksw: { translation: ksw } },
  lng: detectLocale(),
  // Anything not translated yet shows in English instead of as an empty gap.
  fallbackLng: 'en',
  // The web's files write placeholders as {name} (vue-i18n), not i18next's default {{name}}.
  interpolation: { prefix: '{', suffix: '}', escapeValue: false },
  returnNull: false,
})

export const i18n = i18next

export function setLocale(locale: AppLocale): void {
  void i18next.changeLanguage(locale)
}

/**
 * The web's plural texts are written for vue-i18n: "No likes | 1 like | {count} likes" (zero | one | many) or
 * "{count} hour | {count} hours" (one | many). This picks the same form vue-i18n would.
 */
export function plural(text: string, count: number): string {
  const forms = text.split(' | ')
  const form =
    forms.length >= 3 ? forms[Math.min(count, 2)] : forms.length === 2 ? forms[count === 1 ? 0 : 1] : forms[0]
  return (form ?? text).replaceAll('{count}', String(count))
}
