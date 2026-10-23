/** Where most of the community lives; shown first so nobody has to scroll through 400 names. */
export const COMMON_TIMEZONES = [
  'Asia/Bangkok',
  'Asia/Yangon',
  'Asia/Kolkata',
  'Asia/Kuala_Lumpur',
  'Australia/Sydney',
  'Pacific/Auckland',
  'Europe/London',
  'Europe/Oslo',
  'Europe/Stockholm',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'UTC',
] as const

type IntlWithZones = typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] }

/** Every zone this browser knows, or just the common ones in a browser that cannot list them. */
export function allTimezones(): string[] {
  const intl = Intl as IntlWithZones
  try {
    const zones = intl.supportedValuesOf?.('timeZone') ?? []
    if (zones.length > 0) return zones.includes('UTC') ? zones : [...zones, 'UTC']
  } catch {
    // fall through to the short list
  }
  return [...COMMON_TIMEZONES]
}

/** The browser's own zone, used as a hint for new accounts. */
export function browserTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined
  } catch {
    return undefined
  }
}
