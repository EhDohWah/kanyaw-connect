import { afterEach, describe, expect, it, vi } from 'vitest'

import { formatBytes, messageTypeForFile } from '@/utils/files'
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
    expect(messageTypeForFile({ type: 'image/png' })).toBe('image')
    expect(messageTypeForFile({ type: 'audio/webm' })).toBe('voice')
    expect(messageTypeForFile({ type: 'application/pdf' })).toBe('file')
    expect(messageTypeForFile({ type: '' })).toBe('file')
  })
})

describe('uuid', () => {
  afterEach(() => vi.unstubAllGlobals())

  const shape = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

  it('makes a version 4 uuid', () => {
    expect(uuid()).toMatch(shape)
    expect(uuid()).not.toBe(uuid())
  })

  it('still works where crypto.randomUUID does not exist (a page opened over plain HTTP)', () => {
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => bytes.map((_, i) => (i * 37 + 11) % 256) })

    expect(uuid()).toMatch(shape)
  })
})
