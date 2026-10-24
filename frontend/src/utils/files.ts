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
