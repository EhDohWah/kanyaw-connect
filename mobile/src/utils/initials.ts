// Ported unchanged from frontend/src/utils/initials.ts.
const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null

/** First visible character of a word. Myanmar script builds a letter from several code points, so cut by grapheme. */
function firstCharacter(word: string): string {
  if (segmenter) {
    for (const part of segmenter.segment(word)) return part.segment
  }
  return Array.from(word)[0] ?? ''
}

/** "Naw Paw Say" -> "NP". One word gives one letter. Names with no letters at all give "?". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const letters = [words[0], words.length > 1 ? words[words.length - 1] : undefined]
    .map((word) => (word ? firstCharacter(word) : ''))
    .join('')

  return letters ? letters.toLocaleUpperCase() : '?'
}

export const AVATAR_COLOR_COUNT = 8

/** The same person always gets the same colour: 1 to 8, picked from their id (or name). */
export function avatarColorIndex(seed: string): number {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  return (hash % AVATAR_COLOR_COUNT) + 1
}
