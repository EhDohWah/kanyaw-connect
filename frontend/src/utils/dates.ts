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

/**
 * A language the browser has no dates for (S'gaw Karen, for one) would quietly get the browser's own language, which
 * may be Thai or anything else. The app's texts fall back to English, so its dates do too.
 */
export function dateLocale(locale: string): string {
  try {
    return Intl.DateTimeFormat.supportedLocalesOf([locale]).length > 0 ? locale : 'en'
  } catch {
    return 'en'
  }
}

function formatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`
  let found = formatters.get(key)
  if (!found) {
    try {
      found = new Intl.DateTimeFormat(dateLocale(locale), options)
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

/** The wall-clock parts of a moment in a time zone. */
function zonedParts(ms: number, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = formatter('en', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ms))
  const get = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((part) => part.type === type)?.value)
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') }
}

/** How far a time zone is ahead of UTC at a moment, in milliseconds. */
function zoneOffset(ms: number, timeZone: string): number {
  const p = zonedParts(ms, timeZone)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - (ms - (ms % 1000))
}

const pad = (n: number): string => String(n).padStart(2, '0')

/**
 * A moment as the value of an `<input type="datetime-local">` ("2026-03-14T16:30") on the clock of a time zone: the
 * person's own (from their profile), which may not be the browser's.
 */
export function toZonedInput(iso: string | number | Date, timeZone: string): string {
  const p = zonedParts(new Date(iso).getTime(), safeTimeZone(timeZone))
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`
}

/**
 * The moment a `datetime-local` value ("2026-03-14T16:30") means on the clock of a time zone, as an ISO string in UTC.
 * `null` for a value that is not a date. A clock time skipped by a daylight-saving change counts as the hour after.
 */
export function fromZonedInput(value: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [number, number, number, number, number]
  const tz = safeTimeZone(timeZone)

  const asUtc = Date.UTC(year, month - 1, day, hour, minute)
  if (Number.isNaN(asUtc)) return null
  // Two guesses: with the zone's offset at that clock time read as UTC, and with its offset at the first guess. Near a
  // daylight-saving change they differ; the right one shows the same clock time again. A time the change skipped
  // (02:30 on the night clocks jump from 02:00 to 03:00) shows on neither: the later guess is the hour after.
  const first = asUtc - zoneOffset(asUtc, tz)
  const second = asUtc - zoneOffset(first, tz)
  const fits = (moment: number): boolean => toZonedInput(moment, tz) === value
  const moment = fits(first) ? first : fits(second) ? second : Math.max(first, second)
  return new Date(moment).toISOString()
}

/** A length of time as a clock: "0:05", "3:12", "1:02:09". Negative and broken values read as 0:00. */
export function formatDuration(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`
}
