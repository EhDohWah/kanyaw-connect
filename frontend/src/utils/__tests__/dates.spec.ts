import { describe, expect, it } from 'vitest'

import { dateLocale, dayKey, formatClock, formatDayLabel, formatFullTime, formatListTime, formatMeetingTime, formatRelativeTime, fromZonedInput, safeTimeZone, toZonedInput } from '@/utils/dates'

const labels = { today: 'Today', yesterday: 'Yesterday' }
const now = Date.parse('2026-03-14T12:00:00Z') // a Saturday

describe('dayKey', () => {
  it('is the calendar day in the given zone', () => {
    expect(dayKey('2026-03-14T20:00:00Z', 'UTC')).toBe('2026-03-14')
    expect(dayKey('2026-03-14T20:00:00Z', 'Asia/Bangkok')).toBe('2026-03-15')
    expect(dayKey('2026-03-14T03:00:00Z', 'America/Los_Angeles')).toBe('2026-03-13')
  })
})

describe('formatClock', () => {
  it('shows the time in the person’s zone', () => {
    expect(formatClock('2026-03-14T09:05:00Z', 'Asia/Bangkok', 'en-GB')).toBe('16:05')
    expect(formatClock('2026-03-14T09:05:00Z', 'UTC', 'en-US')).toMatch(/9:05\s?AM/)
  })
})

describe('formatDayLabel', () => {
  it('says Today and Yesterday', () => {
    expect(formatDayLabel('2026-03-14T01:00:00Z', now, 'UTC', 'en', labels)).toBe('Today')
    expect(formatDayLabel('2026-03-13T23:00:00Z', now, 'UTC', 'en', labels)).toBe('Yesterday')
  })

  it('uses the weekday for the last week, and the date for older days', () => {
    expect(formatDayLabel('2026-03-11T10:00:00Z', now, 'UTC', 'en', labels)).toBe('Wednesday')
    expect(formatDayLabel('2026-03-01T10:00:00Z', now, 'UTC', 'en-GB', labels)).toBe('1 March')
  })

  it('adds the year for another year', () => {
    expect(formatDayLabel('2025-12-24T10:00:00Z', now, 'UTC', 'en-GB', labels)).toBe('24 December 2025')
  })

  it('decides "today" by the person’s zone, not by UTC', () => {
    // 20:00 UTC on the 13th is already the 14th in Bangkok
    expect(formatDayLabel('2026-03-13T20:00:00Z', now, 'Asia/Bangkok', 'en', labels)).toBe('Today')
  })
})

describe('formatListTime', () => {
  it('shows the clock for today, a label for yesterday, a weekday this week, a date after that', () => {
    expect(formatListTime('2026-03-14T09:05:00Z', now, 'UTC', 'en-GB', labels)).toMatch(/^0?9:05$/)
    expect(formatListTime('2026-03-13T09:05:00Z', now, 'UTC', 'en-GB', labels)).toBe('Yesterday')
    expect(formatListTime('2026-03-11T09:05:00Z', now, 'UTC', 'en-GB', labels)).toBe('Wed')
    expect(formatListTime('2026-02-01T09:05:00Z', now, 'UTC', 'en-GB', labels)).toMatch(/1 Feb 26/)
  })
})

describe('safeTimeZone', () => {
  it('keeps real zones and replaces nonsense with UTC instead of breaking the screen', () => {
    expect(safeTimeZone('Asia/Yangon')).toBe('Asia/Yangon')
    expect(safeTimeZone('Not/AZone')).toBe('UTC')
  })

  it('still formats with a bad zone', () => {
    expect(formatClock('2026-03-14T09:05:00Z', 'Not/AZone', 'en-GB')).toMatch(/^0?9:05$/)
  })
})

describe('formatRelativeTime', () => {
  const ago = (ms: number): string => new Date(now - ms).toISOString()
  const SECOND = 1000
  const MINUTE = 60 * SECOND
  const HOUR = 60 * MINUTE
  const DAY = 24 * HOUR

  it('says "now" for the first minute', () => {
    expect(formatRelativeTime(ago(0), now, 'UTC', 'en')).toBe('now')
    expect(formatRelativeTime(ago(59 * SECOND), now, 'UTC', 'en')).toBe('now')
  })

  it('counts whole minutes, hours and days (never rounding up into the next unit)', () => {
    expect(formatRelativeTime(ago(MINUTE), now, 'UTC', 'en')).toBe('1 min. ago')
    expect(formatRelativeTime(ago(59 * MINUTE + 59 * SECOND), now, 'UTC', 'en')).toBe('59 min. ago')
    expect(formatRelativeTime(ago(HOUR), now, 'UTC', 'en')).toBe('1 hr. ago')
    expect(formatRelativeTime(ago(23 * HOUR + 59 * MINUTE), now, 'UTC', 'en')).toBe('23 hr. ago')
    expect(formatRelativeTime(ago(DAY), now, 'UTC', 'en')).toBe('yesterday')
    expect(formatRelativeTime(ago(3 * DAY), now, 'UTC', 'en')).toBe('3 days ago')
    expect(formatRelativeTime(ago(6 * DAY + 23 * HOUR), now, 'UTC', 'en')).toBe('6 days ago')
  })

  it('shows the date from a week on, with the year only when it is not this year', () => {
    expect(formatRelativeTime(ago(7 * DAY), now, 'UTC', 'en')).toBe('Mar 7')
    expect(formatRelativeTime('2025-12-31T10:00:00Z', now, 'UTC', 'en')).toBe('Dec 31, 2025')
  })

  it('treats a time a little in the future (a fast phone clock) as now', () => {
    expect(formatRelativeTime(new Date(now + 2 * MINUTE).toISOString(), now, 'UTC', 'en')).toBe('now')
  })

  it('falls back to English for a language the browser does not know (S’gaw Karen)', () => {
    expect(formatRelativeTime(ago(5 * MINUTE), now, 'UTC', 'ksw')).toBe('5 min. ago')
  })
})

describe('formatFullTime', () => {
  it('writes date and time in the person’s zone', () => {
    expect(formatFullTime('2026-03-14T09:09:00Z', 'Asia/Bangkok', 'en-US')).toMatch(/Mar 14, 2026.*4:09\s?PM/)
  })
})

describe('formatMeetingTime', () => {
  it('shows weekday, date and time in the person’s zone, without the year in the current year', () => {
    expect(formatMeetingTime('2026-03-14T09:09:00Z', now, 'Asia/Bangkok', 'en-US')).toMatch(/^Sat, Mar 14, 4:09\s?PM$/)
  })

  it('adds the year for another year', () => {
    expect(formatMeetingTime('2027-01-05T09:00:00Z', now, 'UTC', 'en-US')).toMatch(/2027/)
  })
})

describe('dateLocale', () => {
  it('keeps a language the browser has dates for', () => {
    expect(dateLocale('my')).toBe('my')
    expect(dateLocale('en')).toBe('en')
  })

  it('uses English for one it does not know (S’gaw Karen), like the rest of the app, not the browser’s own language', () => {
    expect(dateLocale('ksw')).toBe('en')
  })
})

describe('toZonedInput / fromZonedInput (the start time of a meeting, on the clock of the person\'s time zone)', () => {
  it('reads a clock time in the profile\'s time zone, not the browser\'s', () => {
    expect(fromZonedInput('2026-03-14T16:30', 'Asia/Bangkok')).toBe('2026-03-14T09:30:00.000Z')
    expect(fromZonedInput('2026-03-14T16:30', 'Asia/Yangon')).toBe('2026-03-14T10:00:00.000Z') // +06:30
    expect(fromZonedInput('2026-03-14T16:30', 'UTC')).toBe('2026-03-14T16:30:00.000Z')
  })

  it('shows a moment as that clock time, and the two agree', () => {
    expect(toZonedInput('2026-03-14T09:30:00Z', 'Asia/Bangkok')).toBe('2026-03-14T16:30')
    expect(toZonedInput('2026-12-31T23:59:00Z', 'Asia/Yangon')).toBe('2027-01-01T06:29')
    for (const zone of ['Asia/Bangkok', 'America/New_York', 'Europe/London', 'Australia/Sydney']) {
      expect(toZonedInput(fromZonedInput('2026-07-04T08:15', zone)!, zone)).toBe('2026-07-04T08:15')
    }
  })

  it('gets the right hour on either side of a daylight-saving change', () => {
    expect(fromZonedInput('2026-03-08T01:30', 'America/New_York')).toBe('2026-03-08T06:30:00.000Z') // still EST
    expect(fromZonedInput('2026-03-08T03:30', 'America/New_York')).toBe('2026-03-08T07:30:00.000Z') // EDT
    expect(fromZonedInput('2026-03-29T12:00', 'Europe/London')).toBe('2026-03-29T11:00:00.000Z') // BST
  })

  it('takes a clock time that a daylight-saving change skipped as the hour after, in every zone', () => {
    expect(toZonedInput(fromZonedInput('2026-03-08T02:30', 'America/New_York')!, 'America/New_York')).toBe('2026-03-08T03:30')
    expect(toZonedInput(fromZonedInput('2026-03-29T01:30', 'Europe/London')!, 'Europe/London')).toBe('2026-03-29T02:30')
  })

  it('refuses what is not a date and time, and survives an unknown zone (UTC)', () => {
    expect(fromZonedInput('', 'UTC')).toBeNull()
    expect(fromZonedInput('2026-03-14', 'UTC')).toBeNull()
    expect(fromZonedInput('2026-03-14T16:30', 'Nowhere/Atlantis')).toBe('2026-03-14T16:30:00.000Z')
  })
})
