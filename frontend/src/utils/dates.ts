/** Formatting of times for the conversation. Everything is shown in the person's own time zone (docs/API.md, 1.4). */

/** An unknown zone name must not break a screen: fall back to UTC. */
const knownZones = new Map<string, string>()

export function safeTimeZone(timeZone: string): string {
  let zone = knownZones.get(timeZone)
  if (zone === undefined) {
    try {
      new Intl.DateTimeFormat('en', { timeZone })
      zone = timeZone
    } catch {
      zone = 'UTC'
    }
    knownZones.set(timeZone, zone)
  }
  return zone
}

// Making a formatter is slow and a conversation asks for thousands of them, so each kind is made once.
const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`
  let found = formatters.get(key)
  if (!found) {
    try {
      found = new Intl.DateTimeFormat(locale, options)
    } catch {
      found = new Intl.DateTimeFormat('en', options)
    }
    formatters.set(key, found)
  }
  return found
}

/** `2026-03-14`: the calendar day of a moment in a time zone. Used to know where one day ends and the next begins. */
export function dayKey(iso: string | number | Date, timeZone: string): string {
  return formatter('en-CA', { timeZone: safeTimeZone(timeZone), year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
}

/** `14:05`, or `2:05 PM`, as the language prefers. */
export function formatClock(iso: string, timeZone: string, locale: string): string {
  return formatter(locale, { timeZone: safeTimeZone(timeZone), hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
}

export interface DayLabels {
  today: string
  yesterday: string
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Whole days between two calendar days (by day key, so a time zone's midnight is respected). */
function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / DAY_MS)
}

/** "Today", "Yesterday", the weekday for the last week, otherwise the date: the line between two days in a conversation. */
export function formatDayLabel(iso: string, now: number, timeZone: string, locale: string, labels: DayLabels): string {
  const tz = safeTimeZone(timeZone)
  const diff = daysBetween(dayKey(iso, tz), dayKey(now, tz))

  if (diff === 0) return labels.today
  if (diff === 1) return labels.yesterday
  if (diff > 1 && diff < 7) return formatter(locale, { timeZone: tz, weekday: 'long' }).format(new Date(iso))

  const sameYear = dayKey(iso, tz).slice(0, 4) === dayKey(now, tz).slice(0, 4)
  return formatter(locale, { timeZone: tz, day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }) }).format(new Date(iso))
}

/** The short time on a chat-list row: the clock today, "Yesterday", a weekday, or a short date. */
export function formatListTime(iso: string, now: number, timeZone: string, locale: string, labels: DayLabels): string {
  const tz = safeTimeZone(timeZone)
  const diff = daysBetween(dayKey(iso, tz), dayKey(now, tz))

  if (diff <= 0) return formatClock(iso, tz, locale)
  if (diff === 1) return labels.yesterday
  if (diff < 7) return formatter(locale, { timeZone: tz, weekday: 'short' }).format(new Date(iso))
  return formatter(locale, { timeZone: tz, day: 'numeric', month: 'short', year: '2-digit' }).format(new Date(iso))
}

const relativeFormatters = new Map<string, Intl.RelativeTimeFormat>()

/** A language the browser does not know (S'gaw Karen, for one) falls back to English instead of the browser's own language. */
function relativeFormatter(locale: string): Intl.RelativeTimeFormat {
  let found = relativeFormatters.get(locale)
  if (!found) {
    const supported = Intl.RelativeTimeFormat.supportedLocalesOf([locale]).length > 0
    found = new Intl.RelativeTimeFormat(supported ? locale : 'en', { numeric: 'auto', style: 'short' })
    relativeFormatters.set(locale, found)
  }
  return found
}

/**
 * How long ago, for a post: "now", "5 min. ago", "3 hr. ago", "yesterday", "2 days ago", and from a week on the date.
 * A time slightly in the future (the phone's clock is a little fast) counts as now.
 */
export function formatRelativeTime(iso: string, now: number, timeZone: string, locale: string): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000))
  const relative = relativeFormatter(locale)

  if (seconds < 60) return relative.format(0, 'second')
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return relative.format(-minutes, 'minute')
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return relative.format(-hours, 'hour')
  const days = Math.floor(hours / 24)
  if (days < 7) return relative.format(-days, 'day')

  const tz = safeTimeZone(timeZone)
  const sameYear = dayKey(iso, tz).slice(0, 4) === dayKey(now, tz).slice(0, 4)
  return formatter(locale, { timeZone: tz, day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) }).format(new Date(iso))
}

/** The full date and time of a moment, for hovering over "5 min. ago" and for screen readers. */
export function formatFullTime(iso: string, timeZone: string, locale: string): string {
  return formatter(locale, { timeZone: safeTimeZone(timeZone), dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
}

/** When a meeting starts: "Sat, 14 Mar, 9:09 AM" (with the year when it is not this year). */
export function formatMeetingTime(iso: string, now: number, timeZone: string, locale: string): string {
  const tz = safeTimeZone(timeZone)
  const sameYear = dayKey(iso, tz).slice(0, 4) === dayKey(now, tz).slice(0, 4)
  return formatter(locale, {
    timeZone: tz,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso))
}
