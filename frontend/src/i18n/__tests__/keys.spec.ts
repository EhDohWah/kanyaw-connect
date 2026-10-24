import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import en from '@/i18n/en.json'

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (name === '__tests__' || name === 'i18n') return []
    return statSync(path).isDirectory() ? walk(path) : /\.(vue|ts)$/.test(name) ? [path] : []
  })
}

function has(path: string): boolean {
  let node: unknown = en
  for (const part of path.split('.')) {
    if (typeof node !== 'object' || node === null || !(part in node)) return false
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === 'string'
}

describe('translation keys', () => {
  it('every text key used in the code exists in en.json (a typo would show the raw key to people)', () => {
    const root = join(__dirname, '..', '..')
    const missing: string[] = []

    for (const file of walk(root)) {
      const source = readFileSync(file, 'utf8')
      // t('a.b'), t("a.b"), and keys kept as strings next to a translate call: label: 'nav.home', title: 'create.post'
      for (const match of source.matchAll(/\b(?:t|\$t|translate)\(\s*['"`]([a-zA-Z][\w.]*)['"`]/g)) {
        if (!has(match[1] as string)) missing.push(`${file.slice(root.length)}: ${match[1]}`)
      }
      for (const match of source.matchAll(/\b(?:label|title|hint|key):\s*'((?:nav|common|create|chat|auth|profile|settings|shell|errors|group|people)\.[\w.]+)'/g)) {
        if (!has(match[1] as string)) missing.push(`${file.slice(root.length)}: ${match[1]}`)
      }
    }

    expect(missing).toEqual([])
  })

  it('has no key that is an empty text', () => {
    const empty: string[] = []
    const visit = (node: unknown, path: string): void => {
      if (typeof node === 'string') {
        if (node.trim() === '') empty.push(path)
      } else if (typeof node === 'object' && node !== null) {
        for (const [key, value] of Object.entries(node)) visit(value, path ? `${path}.${key}` : key)
      }
    }
    visit(en, '')
    expect(empty).toEqual([])
  })
})
