// Ported from frontend/src/utils/__tests__/timezones.spec.ts.
import { COMMON_TIMEZONES, allTimezones } from '@/utils/timezones'

describe('timezones', () => {
  it('lists many zones, with UTC, and every common one is a real zone name', () => {
    const all = allTimezones()
    expect(all.length).toBeGreaterThan(100)
    expect(all).toContain('UTC')

    for (const zone of COMMON_TIMEZONES) {
      expect(() => new Intl.DateTimeFormat('en', { timeZone: zone })).not.toThrow()
    }
  })

  it('starts the short list with the places the community lives', () => {
    expect(COMMON_TIMEZONES[0]).toBe('Asia/Bangkok')
    expect(COMMON_TIMEZONES).toContain('Asia/Yangon')
  })
})
