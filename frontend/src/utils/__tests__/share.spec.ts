import { afterEach, describe, expect, it, vi } from 'vitest'

import { shareLink } from '@/utils/share'

const data = { title: 'Post by Naw Paw', url: 'http://localhost/?post=1' }

afterEach(() => {
  // @ts-expect-error put the browser back the way jsdom has it
  delete navigator.share
  // @ts-expect-error same
  delete navigator.clipboard
})

describe('shareLink', () => {
  it('uses the share sheet where the browser has one', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { share })

    expect(await shareLink(data)).toBe('shared')
    expect(share).toHaveBeenCalledWith(data)
  })

  it('is not an error when the person closes the share sheet', async () => {
    Object.assign(navigator, { share: vi.fn().mockRejectedValue(new DOMException('closed', 'AbortError')) })
    const writeText = vi.fn()
    Object.assign(navigator, { clipboard: { writeText } })

    expect(await shareLink(data)).toBe('cancelled')
    expect(writeText).not.toHaveBeenCalled()
  })

  it('copies the link when the share sheet refuses for another reason', async () => {
    Object.assign(navigator, { share: vi.fn().mockRejectedValue(new DOMException('no', 'NotAllowedError')) })
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    expect(await shareLink(data)).toBe('copied')
    expect(writeText).toHaveBeenCalledWith(data.url)
  })

  it('copies the link when there is no share sheet at all', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    expect(await shareLink(data)).toBe('copied')
    expect(writeText).toHaveBeenCalledWith(data.url)
  })

  it('says it failed when nothing can copy', async () => {
    document.execCommand = vi.fn(() => false)

    expect(await shareLink(data)).toBe('failed')
  })
})
