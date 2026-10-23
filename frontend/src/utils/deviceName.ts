/** A readable name for this browser ("Chrome on Windows"), sent at login so each token can be told apart later. */
export function describeDevice(userAgent: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): string {
  let browser = 'Browser'
  if (/Edg\//.test(userAgent)) browser = 'Edge'
  else if (/OPR\/|Opera/.test(userAgent)) browser = 'Opera'
  else if (/Firefox\/|FxiOS\//.test(userAgent)) browser = 'Firefox'
  else if (/Chrome\/|CriOS\//.test(userAgent)) browser = 'Chrome'
  else if (/Safari\//.test(userAgent)) browser = 'Safari'

  // Android and iPhone user agents also mention Linux and Mac OS X, so they are checked first.
  let system = ''
  if (/Android/.test(userAgent)) system = 'Android'
  else if (/iPhone|iPad|iPod/.test(userAgent)) system = 'iOS'
  else if (/Windows/.test(userAgent)) system = 'Windows'
  else if (/CrOS/.test(userAgent)) system = 'ChromeOS'
  else if (/Mac OS X|Macintosh/.test(userAgent)) system = 'macOS'
  else if (/Linux/.test(userAgent)) system = 'Linux'

  return system ? `${browser} on ${system}` : browser
}
