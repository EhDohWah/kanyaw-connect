// The app shows the same texts as the web app: its locale files are copies of frontend/src/i18n/*.json.
//
//   npm run i18n:check   fails when a mobile file differs from the web file, or the three locales have different keys
//   npm run i18n:copy    copies the web files over the mobile ones
//
// A text the app needs is added to frontend/src/i18n/en.json first (then `npm run i18n:sync` in frontend/ fills in
// my.json and ksw.json), and copied here. The app never has a key the web does not.
import { copyFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const LOCALES = ['en', 'my', 'ksw']
const web = fileURLToPath(new URL('../../frontend/src/i18n/', import.meta.url))
const mobile = fileURLToPath(new URL('../src/i18n/locales/', import.meta.url))

if (process.argv.includes('--copy')) {
  for (const locale of LOCALES) copyFileSync(`${web}${locale}.json`, `${mobile}${locale}.json`)
  process.stdout.write('Copied en.json, my.json and ksw.json from the web app.\n')
  process.exit(0)
}

/** Every key path that leads to a text, sorted. */
function keys(node, prefix = '') {
  return Object.entries(node)
    .flatMap(([key, value]) =>
      typeof value === 'object' && value !== null ? keys(value, `${prefix}${key}.`) : [`${prefix}${key}`],
    )
    .sort()
}

const problems = []
const english = keys(JSON.parse(readFileSync(`${mobile}en.json`, 'utf8')))

for (const locale of LOCALES) {
  const mine = readFileSync(`${mobile}${locale}.json`, 'utf8')
  const theirs = readFileSync(`${web}${locale}.json`, 'utf8')
  if (JSON.stringify(JSON.parse(mine)) !== JSON.stringify(JSON.parse(theirs))) {
    problems.push(`${locale}.json differs from frontend/src/i18n/${locale}.json (run npm run i18n:copy)`)
  }
  const missing = english.filter((key) => !keys(JSON.parse(mine)).includes(key))
  const extra = keys(JSON.parse(mine)).filter((key) => !english.includes(key))
  if (missing.length) problems.push(`${locale}.json is missing: ${missing.slice(0, 5).join(', ')}`)
  if (extra.length) problems.push(`${locale}.json has keys English does not: ${extra.slice(0, 5).join(', ')}`)
}

if (problems.length) {
  process.stderr.write(problems.join('\n') + '\n')
  process.exit(1)
}
process.stdout.write(`The app's ${LOCALES.length} locale files match the web app (${english.length} keys).\n`)
