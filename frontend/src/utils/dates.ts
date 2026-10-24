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
