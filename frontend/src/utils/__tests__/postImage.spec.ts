import { afterEach, describe, expect, it, vi } from 'vitest'

import { checkPostImage, POST_IMAGE_MAX_BYTES, PostImageError, shrinkToDataUrl } from '@/utils/postImage'

const MB = 1024 * 1024

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('checkPostImage', () => {
  it('accepts pictures up to 10 MB, 10 MB itself included', () => {
    expect(() => checkPostImage({ type: 'image/jpeg', size: 1 })).not.toThrow()
    expect(() => checkPostImage({ type: 'image/png', size: POST_IMAGE_MAX_BYTES })).not.toThrow()
    expect(POST_IMAGE_MAX_BYTES).toBe(10 * MB)
  })

  it('refuses a picture that is one byte over', () => {
    expect(() => checkPostImage({ type: 'image/jpeg', size: POST_IMAGE_MAX_BYTES + 1 })).toThrowError(expect.objectContaining({ problem: 'too-big' }))
  })

  it('refuses what is not a picture', () => {
    expect(() => checkPostImage({ type: 'application/pdf', size: 10 })).toThrowError(expect.objectContaining({ problem: 'type' }))
    expect(() => checkPostImage({ type: '', size: 10 })).toThrowError(PostImageError)
  })
})

describe('shrinkToDataUrl', () => {
  function drawing(width: number, height: number) {
    const context = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
    const toDataURL = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,AAAA')
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width, height, close }))
    return { context, toDataURL, close }
  }

  it('scales a big photo down so its long edge is 900 px, keeping its shape, and returns a JPEG address', async () => {
    const { context, toDataURL, close } = drawing(4000, 3000)
    const canvases: HTMLCanvasElement[] = []
    const create = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const element = create(tag)
      if (tag === 'canvas') canvases.push(element as HTMLCanvasElement)
      return element
    })

    const result = await shrinkToDataUrl(new Blob(['x']))

    expect(result).toBe('data:image/jpeg;base64,AAAA')
    expect(canvases[0]?.width).toBe(900)
    expect(canvases[0]?.height).toBe(675)
    expect(context.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 900, 675)
    expect(toDataURL).toHaveBeenCalledWith('image/jpeg', expect.any(Number))
    expect(close).toHaveBeenCalled()
  })

  it('does not enlarge a small picture', async () => {
    const { context } = drawing(300, 200)

    await shrinkToDataUrl(new Blob(['x']))

    expect(context.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 300, 200)
  })

  it('paints white first, so a transparent picture does not turn black', async () => {
    const { context } = drawing(100, 100)

    await shrinkToDataUrl(new Blob(['x']))

    expect(context.fillStyle).toBe('#ffffff')
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 100, 100)
  })

  it('says "unreadable" when the browser cannot decode the file', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('bad')))

    await expect(shrinkToDataUrl(new Blob(['x']))).rejects.toMatchObject({ problem: 'unreadable' })
  })

  it('says "unreadable" when there is nothing to draw on, and still lets go of the picture', async () => {
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 10, height: 10, close }))
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)

    await expect(shrinkToDataUrl(new Blob(['x']))).rejects.toMatchObject({ problem: 'unreadable' })
    expect(close).toHaveBeenCalled()
  })
})
