// Copies every key that exists in en.json but is missing from my.json / ksw.json into those files, with the
// English text as a placeholder. Existing translations are never overwritten, and keys that no longer exist in
// en.json are removed. Run it after adding or removing English text:  npm run i18n:sync
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const dir = fileURLToPath(new URL('../src/i18n/', import.meta.url))
const read = (name) => JSON.parse(readFileSync(dir + name, 'utf8'))

/** Same shape as `source`; values from `target` where they exist, otherwise the source (English) value. */
function merge(source, target) {
  const out = {}
  for (const [key, value] of Object.entries(source)) {
    const existing = target?.[key]
    out[key] = typeof value === 'object' && value !== null ? merge(value, existing) : typeof existing === 'string' ? existing : value
  }
  return out
}

const en = read('en.json')
for (const locale of ['my', 'ksw']) {
  let current = {}
  try {
    current = read(`${locale}.json`)
  } catch {
    // first run: the file does not exist yet
  }
  writeFileSync(dir + `${locale}.json`, JSON.stringify(merge(en, current), null, 2) + '\n')
}
console.log('my.json and ksw.json now have the same keys as en.json')
