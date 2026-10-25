import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import en from '@/i18n/locales/en.json'
import ksw from '@/i18n/locales/ksw.json'
import my from '@/i18n/locales/my.json'
import { detectLocale, i18n, plural, usesMyanmarScript } from '@/i18n'

const WEB = join(__dirname, '../../../../frontend/src/i18n')
const MINE = { en, my, ksw } as const

/** Every key path that leads to a text, sorted. */
function keys(node: object, prefix = ''): string[] {
  return Object.entries(node)
    .flatMap(([key, value]) =>
      typeof value === 'object' && value !== null ? keys(value as object, `${prefix}${key}.`) : [`${prefix}${key}`],
    )
    .sort()
}

describe('the locale files', () => {
  it.each(['en', 'my', 'ksw'] as const)(
    '%s.json is the web app’s file, unchanged (the app adds no keys of its own)',
    (locale) => {
      const web = JSON.parse(readFileSync(join(WEB, `${locale}.json`), 'utf8')) as object
      expect(MINE[locale]).toEqual(web)
    },
  )

  it('all three have the same keys', () => {
    expect(keys(my)).toEqual(keys(en))
    expect(keys(ksw)).toEqual(keys(en))
  })

  it('placeholders are written {name}, as i18next is set up to read them', () => {
    expect(i18n.t('settings.signedInAs', { name: 'Naw Paw' })).toBe('Signed in as Naw Paw')
  })
})

describe('choosing the language', () => {
  it('uses the account’s language, then the phone’s, then English', () => {
    expect(detectLocale('ksw', ['my-MM'])).toBe('ksw')
    expect(detectLocale(null, ['fr-FR', 'my-MM'])).toBe('my')
    expect(detectLocale('xx', ['fr-FR'])).toBe('en')
  })

  it('Burmese and S’gaw Karen use Myanmar script', () => {
    expect(usesMyanmarScript('my')).toBe(true)
    expect(usesMyanmarScript('ksw')).toBe(true)
    expect(usesMyanmarScript('en')).toBe(false)
  })
})

describe('plural texts written for vue-i18n', () => {
  it('picks zero | one | many, or one | many', () => {
    expect(plural('No likes | 1 like | {count} likes', 0)).toBe('No likes')
    expect(plural('No likes | 1 like | {count} likes', 1)).toBe('1 like')
    expect(plural('No likes | 1 like | {count} likes', 7)).toBe('7 likes')
    expect(plural('{count} hour | {count} hours', 1)).toBe('1 hour')
    expect(plural('{count} hour | {count} hours', 3)).toBe('3 hours')
    expect(plural('Just one form', 3)).toBe('Just one form')
  })
})
