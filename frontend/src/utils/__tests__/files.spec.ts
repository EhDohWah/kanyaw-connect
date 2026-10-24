import { afterEach, describe, expect, it, vi } from 'vitest'

import { formatBytes, linkExpired, messageTypeForFile, saveFile } from '@/utils/files'
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

describe('linkExpired', () => {
  const now = Date.parse('2026-03-14T09:00:00Z')
  const at = (seconds: number) => `https://api.example.org/api/v1/attachments/a1/file?expires=${seconds}&signature=abc`

  it('is true once the signed link has run out, and a little before (so a click does not land on an error)', () => {
    expect(linkExpired(at(now / 1000 - 1), now)).toBe(true)
    expect(linkExpired(at(now / 1000 + 10), now)).toBe(true)
    expect(linkExpired(at(now / 1000 + 600), now)).toBe(false)
  })

  it('treats a link without an end as good, and does not break on something that is not a link', () => {
    expect(linkExpired('https://api.example.org/file', now)).toBe(false)
    expect(linkExpired('blob:preview', now)).toBe(false)
    expect(linkExpired('not a url', now)).toBe(false)
  })
})

describe('saveFile', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  function stubBrowser(response: { ok: boolean; status: number }) {
    const blob = new Blob(['Committee agenda'])
    const fetch = vi.fn(async () => ({ ...response, blob: async () => blob }))
    vi.stubGlobal('fetch', fetch)
    const created = vi.fn((_blob: Blob) => 'blob:saved')
    const revoked = vi.fn()
    vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: created, revokeObjectURL: revoked }))
    const clicked: { href: string; download: string; inPage: boolean }[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ href: this.href, download: this.download, inPage: document.body.contains(this) })
    })
    return { fetch, blob, created, revoked, clicked }
  }

  it('fetches the file and saves it under its own name, then lets go of the bytes', async () => {
    vi.useFakeTimers()
    const browser = stubBrowser({ ok: true, status: 200 })

    await saveFile('https://api.example.org/api/v1/attachments/a1/file?expires=1&signature=x', 'agenda.pdf')

    expect(browser.fetch).toHaveBeenCalledWith('https://api.example.org/api/v1/attachments/a1/file?expires=1&signature=x')
    expect(browser.created).toHaveBeenCalledWith(browser.blob)
    expect(browser.clicked).toEqual([{ href: 'blob:saved', download: 'agenda.pdf', inPage: true }])
    expect(document.querySelector('a[download]')).toBeNull()

    expect(browser.revoked).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(browser.revoked).toHaveBeenCalledWith('blob:saved')
  })

  it('fails, saving nothing, when the server refuses', async () => {
    const browser = stubBrowser({ ok: false, status: 403 })

    await expect(saveFile('https://api.example.org/file', 'agenda.pdf')).rejects.toThrow('403')
    expect(browser.clicked).toEqual([])
  })
})
