import { createI18n } from 'vue-i18n'

import { readStorage, writeStorage } from '@/utils/storage'

import en from './en.json'
import my from './my.json'
import ksw from './ksw.json'

/** `en` English, `my` Burmese, `ksw` S'gaw Karen (the last two are written in Myanmar script). */
export const LOCALES = ['en', 'my', 'ksw'] as const
export type AppLocale = (typeof LOCALES)[number]

export const LOCALE_STORAGE_KEY = 'kc.locale'

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

/** The stored choice, else the browser's language if we have it, else English. */
export function detectLocale(
  stored: string | null = readStorage(LOCALE_STORAGE_KEY),
  browserLanguages: readonly string[] = typeof navigator === 'undefined' ? [] : navigator.languages,
): AppLocale {
  if (isAppLocale(stored)) return stored

  for (const language of browserLanguages) {
    const base = language.toLowerCase().split('-')[0]
    if (isAppLocale(base)) return base
  }

  return 'en'
}

export const i18n = createI18n({
  legacy: false,
  locale: detectLocale(),
  // Anything not translated yet shows in English instead of as an empty gap.
  fallbackLocale: 'en',
  messages: { en, my, ksw },
})

/** Switches the language of the whole app, the `lang` of the page (fonts and line height depend on it), and remembers it. */
export function setLocale(locale: AppLocale): void {
  i18n.global.locale.value = locale
  document.documentElement.lang = locale
  writeStorage(LOCALE_STORAGE_KEY, locale)
}

document.documentElement.lang = i18n.global.locale.value
