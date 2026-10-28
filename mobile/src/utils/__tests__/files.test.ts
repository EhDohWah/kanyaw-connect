// Ported from frontend/src/utils/__tests__/files.spec.ts (without saveFile, which is browser-only).
import { formatBytes, linkExpired, messageTypeForFile } from '@/utils/files'
import { uuid } from '@/utils/uuid'

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [41, '41 B'],
    [1024, '1 KB'],
    [1536, '1.5 KB'],
    [820 * 1024, '820 KB'],
    [5 * 1024 * 1024, '5 MB'],
    [25 * 1024 * 1024, '25 MB'],
  ])('%i bytes is %s', (bytes, shown) => {
    expect(formatBytes(bytes)).toBe(shown)
  })
})

describe('messageTypeForFile', () => {
  it('pictures are images, audio is a voice message, anything else is a file', () => {
    expect(messageTypeForFile({ mimeType: 'image/png' })).toBe('image')
    expect(messageTypeForFile({ mimeType: 'audio/webm' })).toBe('voice')
    expect(messageTypeForFile({ mimeType: 'application/pdf' })).toBe('file')
    expect(messageTypeForFile({ mimeType: '' })).toBe('file')
  })
})

describe('uuid (phone)', () => {
  it('makes a version 4 uuid, a new one each time', () => {
    const shape = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    expect(uuid()).toMatch(shape)
    expect(uuid()).not.toBe(uuid())
  })
})

describe('linkExpired', () => {
  const now = Date.parse('2026-03-14T09:00:00Z')
  const at = (seconds: number) => `https://api.example.org/api/v1/attachments/a1/file?expires=${seconds}&signature=abc`

  it('is true once the signed link has run out, and a little before (so a tap does not land on an error)', () => {
    expect(linkExpired(at(now / 1000 - 1), now)).toBe(true)
    expect(linkExpired(at(now / 1000 + 10), now)).toBe(true)
    expect(linkExpired(at(now / 1000 + 600), now)).toBe(false)
  })

  it('treats a link without an end as good, and does not break on a local file', () => {
    expect(linkExpired('https://api.example.org/file', now)).toBe(false)
    expect(linkExpired('file:///data/cache/photo.jpg', now)).toBe(false)
  })
})
