import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { colors } from '@/theme/tokens'

/** `--color-text-muted: #6b6b73;` -> { textMuted: '#6b6b73' }, from the web's design tokens. */
function webColors(): Record<string, string> {
  const css = readFileSync(join(__dirname, '../../../../frontend/src/style.css'), 'utf8')
  const out: Record<string, string> = {}
  for (const [, name, value] of css.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    out[name!.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase())] = value!.toLowerCase()
  }
  return out
}

describe('design tokens', () => {
  it('match the web app exactly (frontend/src/style.css)', () => {
    expect(colors).toEqual(webColors())
  })

  it('found the colours in the CSS (the parser did not silently read nothing)', () => {
    expect(Object.keys(webColors()).length).toBeGreaterThanOrEqual(20)
  })
})
