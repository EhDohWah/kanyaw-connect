import { describe, expect, it } from 'vitest'

import { dayKey, formatClock, formatDayLabel, formatListTime, safeTimeZone } from '@/utils/dates'

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
