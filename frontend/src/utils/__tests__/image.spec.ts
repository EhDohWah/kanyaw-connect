import { afterEach, describe, expect, it, vi } from 'vitest'

import { AVATAR_MAX_BYTES, AvatarError, prepareAvatar } from '@/utils/image'

function file(name: string, type: string, size: number): File {
  return new File([new Uint8Array(size)], name, { type })
}

function stubImageApis(options: { width: number; height: number; outputBytes: number | null }) {
  const bitmap = { width: options.width, height: options.height, close: vi.fn() }
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap))

  const drawImage = vi.fn()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
    callback(options.outputBytes === null ? null : new Blob([new Uint8Array(options.outputBytes)], { type: 'image/webp' }))
  })

  return { bitmap, drawImage }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('prepareAvatar', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp'])('accepts %s that already fits, and sends the same file', async (type) => {
    const original = file('me', type, 1000)
    expect(await prepareAvatar(original)).toBe(original)
  })

  it.each(['image/gif', 'image/svg+xml', 'application/pdf', ''])('refuses the type %j', async (type) => {
    await expect(prepareAvatar(file('x', type, 10))).rejects.toMatchObject({ problem: 'type' })
  })

  it('accepts a file of exactly 2 MB', async () => {
    const exact = file('me.png', 'image/png', AVATAR_MAX_BYTES)
    expect(await prepareAvatar(exact)).toBe(exact)
  })

  it('shrinks a big phone photo to fit, keeping its shape', async () => {
    const { drawImage, bitmap } = stubImageApis({ width: 4000, height: 3000, outputBytes: 300_000 })

    const result = await prepareAvatar(file('IMG_1.JPG', 'image/jpeg', 5 * 1024 * 1024))

    expect(result.type).toBe('image/webp')
    expect(result.name).toBe('IMG_1.webp')
    expect(result.size).toBe(300_000)
    // 4000x3000 scaled so the long edge is 1600: 1600x1200
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 1600, 1200)
    expect(bitmap.close).toHaveBeenCalled()
  })

  it('does not enlarge a picture that is small in pixels but heavy in bytes', async () => {
    const { drawImage, bitmap } = stubImageApis({ width: 800, height: 600, outputBytes: 100_000 })

    await prepareAvatar(file('big.png', 'image/png', 3 * 1024 * 1024))

    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 800, 600)
  })

  it('refuses when it is still too big after shrinking', async () => {
    stubImageApis({ width: 4000, height: 3000, outputBytes: AVATAR_MAX_BYTES + 1 })

    await expect(prepareAvatar(file('x.jpg', 'image/jpeg', 5 * 1024 * 1024))).rejects.toMatchObject({ problem: 'too-big' })
  })

  it('refuses a file that is not really a picture', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('bad image')))

    const error = await prepareAvatar(file('fake.png', 'image/png', 5 * 1024 * 1024)).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(AvatarError)
    expect(error).toMatchObject({ problem: 'unreadable' })
  })

  it('reports unreadable when the browser cannot encode the result', async () => {
    stubImageApis({ width: 4000, height: 3000, outputBytes: null })

    await expect(prepareAvatar(file('x.jpg', 'image/jpeg', 5 * 1024 * 1024))).rejects.toMatchObject({ problem: 'unreadable' })
  })
})
