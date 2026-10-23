import { describe, expect, it, vi } from 'vitest'

import { LOCALES, detectLocale, i18n, isAppLocale, setLocale } from '@/i18n'
import en from '@/i18n/en.json'
import ksw from '@/i18n/ksw.json'
import my from '@/i18n/my.json'

function keys(object: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(object).flatMap(([key, value]) =>
    typeof value === 'object' && value !== null ? keys(value as Record<string, unknown>, `${prefix}${key}.`) : [`${prefix}${key}`],
  )
}

describe('locale files', () => {
  const english = keys(en).sort()

  it.each([
    ['my', my],
    ['ksw', ksw],
  ])('%s has exactly the keys of English (run `npm run i18n:sync` after adding a key)', (_name, messages) => {
    expect(keys(messages).sort()).toEqual(english)
  })

  it('every English message compiles and renders without warnings', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    for (const key of english) {
      const text = i18n.global.t(key, { seconds: 5, percent: 50, name: 'Naw' })
      expect(text, key).not.toBe(key)
      expect(text, key).not.toMatch(/[{}]/)
    }

    expect(warn).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  it('falls back to English for a message that has not been translated', () => {
    setLocale('my')
    expect(i18n.global.t('auth.signIn')).toBe(en.auth.signIn)
  })
})

describe('detectLocale', () => {
  it('prefers the saved choice', () => {
    expect(detectLocale('ksw', ['my'])).toBe('ksw')
  })

  it('uses the browser language when nothing is saved, including regional variants', () => {
    expect(detectLocale(null, ['fr-FR', 'my-MM', 'en'])).toBe('my')
    expect(detectLocale(null, ['en-GB'])).toBe('en')
  })

  it('falls back to English, and ignores a saved value it does not know', () => {
    expect(detectLocale(null, ['fr'])).toBe('en')
    expect(detectLocale('xx', [])).toBe('en')
  })

  it('knows the three languages', () => {
    expect(LOCALES).toEqual(['en', 'my', 'ksw'])
    expect(isAppLocale('ksw')).toBe(true)
    expect(isAppLocale('de')).toBe(false)
  })
})

describe('setLocale', () => {
  it('changes the language, the page lang (fonts depend on it) and remembers the choice', () => {
    setLocale('ksw')

    expect(i18n.global.locale.value).toBe('ksw')
    expect(document.documentElement.lang).toBe('ksw')
    expect(window.localStorage.getItem('kc.locale')).toBe('ksw')
  })
})
