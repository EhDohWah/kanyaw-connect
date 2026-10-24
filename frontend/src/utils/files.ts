/** `1.4 MB`, `820 KB`: file sizes for people. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 || Number.isInteger(value) ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

/** What kind of message a chosen file becomes: pictures show as pictures, audio gets a player, the rest is a file card. */
export function messageTypeForFile(file: Pick<File, 'type'>): 'image' | 'voice' | 'file' {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('audio/')) return 'voice'
  return 'file'
}

/**
 * Whether a signed attachment link has run out (or will within `marginMs`). The server signs links for 60 minutes and
 * puts the end, in seconds, in `expires`. A link without it is treated as good.
 */
export function linkExpired(url: string, now: number = Date.now(), marginMs = 30_000): boolean {
  try {
    const expires = Number(new URL(url).searchParams.get('expires'))
    return Number.isFinite(expires) && expires > 0 && expires * 1000 <= now + marginMs
  } catch {
    return false
  }
}

/** How long the downloaded bytes stay in memory after the save starts. */
const SAVE_RELEASE_MS = 60_000

/**
 * Saves a file to the person's device under its own name, staying on this page: no new tab, nothing a popup blocker
 * stops, works after waiting for a fresh link. The file server must let this site read it (the API allows it for
 * everything under /api).
 */
export async function saveFile(url: string, name: string): Promise<void> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`The file could not be fetched (${response.status}).`)

  const href = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = href
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(href), SAVE_RELEASE_MS)
}
