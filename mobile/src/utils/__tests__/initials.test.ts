// Ported from frontend/src/utils/__tests__/initials.spec.ts.
import { AVATAR_COLOR_COUNT, avatarColorIndex, initials } from '@/utils/initials'

describe('initials', () => {
  it('uses the first and last word', () => {
    expect(initials('Naw Paw Say')).toBe('NS')
    expect(initials('Saw Eh Doh')).toBe('SD')
    expect(initials('  eh   doh  ')).toBe('ED')
  })

  it('gives one letter for one word', () => {
    expect(initials('Madonna')).toBe('M')
  })

  it('keeps a whole Myanmar letter together instead of cutting it in the middle', () => {
    // "မြန်မာ": the first letter is a consonant plus a medial sign: two code points that must stay together.
    const first = initials('မြန်မာ')
    expect(Array.from(first).length).toBeGreaterThan(1)
    expect(first.startsWith('မြ')).toBe(true)
  })

  it('shows a question mark when there is nothing to show', () => {
    expect(initials('   ')).toBe('?')
    expect(initials('')).toBe('?')
  })
})

describe('avatarColorIndex', () => {
  it('is stable and within 1..8', () => {
    const id = '0195e2c4-0001-7a00-8100-5f3a9c000000'
    expect(avatarColorIndex(id)).toBe(avatarColorIndex(id))

    for (let i = 0; i < 200; i++) {
      const index = avatarColorIndex(`user-${i}`)
      expect(index).toBeGreaterThanOrEqual(1)
      expect(index).toBeLessThanOrEqual(AVATAR_COLOR_COUNT)
    }
  })

  it('uses every colour across many people', () => {
    const used = new Set(Array.from({ length: 200 }, (_, i) => avatarColorIndex(`user-${i}`)))
    expect(used.size).toBe(AVATAR_COLOR_COUNT)
  })
})
