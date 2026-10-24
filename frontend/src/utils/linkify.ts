export type TextToken = { type: 'text'; value: string } | { type: 'link'; value: string; href: string }

const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"']+/gi
const TRAILING_PUNCTUATION = /[.,;:!?'"]+$/

/** Cuts punctuation that belongs to the sentence ("see https://x.org.") and a closing bracket that has no opening one. */
function trimUrl(raw: string): string {
  let url = raw.replace(TRAILING_PUNCTUATION, '')
  while (url.endsWith(')') && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) {
    url = url.slice(0, -1).replace(TRAILING_PUNCTUATION, '')
  }
  return url
}

/**
 * Splits message text into plain text and web links. It returns data, not HTML: the component turns it into elements,
 * so nothing a sender writes can become markup. Only http and https links are made clickable.
 */
export function linkify(text: string): TextToken[] {
  const tokens: TextToken[] = []
  let cursor = 0

  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0
    const url = trimUrl(match[0])
    const href = url.toLowerCase().startsWith('www.') ? `https://${url}` : url

    let valid = false
    try {
      const parsed = new URL(href)
      valid = (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname.includes('.')
    } catch {
      valid = false
    }
    if (!valid) continue

    if (start > cursor) tokens.push({ type: 'text', value: text.slice(cursor, start) })
    tokens.push({ type: 'link', value: url, href })
    cursor = start + url.length
  }

  if (cursor < text.length) tokens.push({ type: 'text', value: text.slice(cursor) })
  return tokens
}
