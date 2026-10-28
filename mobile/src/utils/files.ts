// Ported from frontend/src/utils/files.ts. The phone reads `expires` with a pattern (React Native's URL has no
// searchParams), and saving a file goes through the share sheet or the photo library instead (see MessageMedia).

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
export function messageTypeForFile(file: { mimeType: string }): 'image' | 'voice' | 'file' {
  if (file.mimeType.startsWith('image/')) return 'image'
  if (file.mimeType.startsWith('audio/')) return 'voice'
  return 'file'
}

/**
 * Whether a signed attachment link has run out (or will within `marginMs`). The server signs links for 60 minutes and
 * puts the end, in seconds, in `expires`. A link without it is treated as good.
 */
export function linkExpired(url: string, now: number = Date.now(), marginMs = 30_000): boolean {
  const expires = Number(/[?&]expires=(\d+)/.exec(url)?.[1])
  return Number.isFinite(expires) && expires > 0 && expires * 1000 <= now + marginMs
}
