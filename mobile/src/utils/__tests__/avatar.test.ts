import {
  AVATAR_MAX_BYTES,
  AvatarError,
  imageType,
  prepareAvatar,
  type AvatarTools,
  type PickedImage,
} from '@/utils/avatar'

jest.mock('expo-file-system', () => ({ File: jest.fn() }))
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: { JPEG: 'jpeg' } }))

const MB = 1024 * 1024

/** A fake manipulator: records each shrink, and "saves" files of the sizes given, one per attempt. */
function tools(savedSizes: number[] = [500_000], originalSize = 1 * MB) {
  const shrinks: { size: { width?: number; height?: number }; quality: number }[] = []
  let attempt = 0
  const fake: AvatarTools = {
    async shrink(_uri, size, quality) {
      shrinks.push({ size, quality })
      attempt += 1
      return { uri: `file:///cache/out-${attempt}.jpg` }
    },
    sizeOf(uri) {
      const match = /out-(\d+)/.exec(uri)
      return match ? (savedSizes[Number(match[1]) - 1] ?? 0) : originalSize
    },
  }
  return { fake, shrinks }
}

const photo = (overrides: Partial<PickedImage> = {}): PickedImage => ({
  uri: 'file:///picker/IMG_0001.jpg',
  width: 1200,
  height: 900,
  mimeType: 'image/jpeg',
  fileName: 'IMG_0001.jpg',
  fileSize: 800_000,
  ...overrides,
})

async function problem(promise: Promise<unknown>): Promise<string> {
  const error = await promise.catch((e: unknown) => e)
  return error instanceof AvatarError ? error.problem : 'no error'
}

describe('preparing a profile photo', () => {
  it('sends a small JPEG, PNG or WebP as it is', async () => {
    const { fake, shrinks } = tools()
    expect(await prepareAvatar(photo(), fake)).toEqual({
      uri: 'file:///picker/IMG_0001.jpg',
      name: 'IMG_0001.jpg',
      type: 'image/jpeg',
    })
    expect(await prepareAvatar(photo({ mimeType: 'image/png', fileName: 'a.png' }), fake)).toMatchObject({
      name: 'a.png',
      type: 'image/png',
    })
    expect(shrinks).toHaveLength(0)
  })

  it('shrinks a big photo along its longest side to 1600 px and saves it as a JPEG', async () => {
    const { fake, shrinks } = tools()
    const result = await prepareAvatar(photo({ width: 4032, height: 3024, fileSize: 6 * MB }), fake)
    expect(shrinks[0]).toEqual({ size: { width: 1600 }, quality: 0.85 })
    expect(result).toEqual({ uri: 'file:///cache/out-1.jpg', name: 'IMG_0001.jpg', type: 'image/jpeg' })

    await prepareAvatar(photo({ width: 3024, height: 4032, fileSize: 6 * MB }), fake)
    expect(shrinks[1]?.size).toEqual({ height: 1600 })
  })

  it('shrinks a photo over 1600 px even when it is under 2 MB', async () => {
    const { fake, shrinks } = tools()
    await prepareAvatar(photo({ width: 2000, height: 1000, fileSize: 1 * MB }), fake)
    expect(shrinks).toHaveLength(1)
  })

  it('re-saves a small picture that is over 2 MB without resizing it', async () => {
    const { fake, shrinks } = tools()
    await prepareAvatar(photo({ width: 1500, height: 1500, mimeType: 'image/png', fileSize: 3 * MB }), fake)
    expect(shrinks[0]).toEqual({ size: {}, quality: 0.85 })
  })

  it('tries lower qualities until the file is under 2 MB, then gives up', async () => {
    const big = { width: 4000, height: 4000, fileSize: 9 * MB }
    const { fake, shrinks } = tools([3 * MB, AVATAR_MAX_BYTES])
    expect((await prepareAvatar(photo(big), fake)).uri).toBe('file:///cache/out-2.jpg')
    expect(shrinks.map((s) => s.quality)).toEqual([0.85, 0.7])

    const stubborn = tools([3 * MB, 3 * MB, 3 * MB])
    expect(await problem(prepareAvatar(photo(big), stubborn.fake))).toBe('too-big')
    expect(stubborn.shrinks).toHaveLength(3)
  })

  it('converts an iPhone HEIC photo to JPEG', async () => {
    const { fake, shrinks } = tools()
    const result = await prepareAvatar(photo({ mimeType: 'image/heic', fileName: 'IMG_0002.HEIC' }), fake)
    expect(shrinks).toHaveLength(1)
    expect(result).toMatchObject({ name: 'IMG_0002.jpg', type: 'image/jpeg' })
  })

  it('refuses GIF and SVG, and anything else, before anything is sent', async () => {
    const { fake, shrinks } = tools()
    expect(await problem(prepareAvatar(photo({ mimeType: 'image/gif', fileName: 'party.gif' }), fake))).toBe('type')
    expect(
      await problem(prepareAvatar(photo({ mimeType: null, fileName: 'logo.svg', uri: 'file:///x/logo.svg' }), fake)),
    ).toBe('type')
    expect(await problem(prepareAvatar(photo({ mimeType: 'application/pdf', fileName: 'cv.pdf' }), fake))).toBe('type')
    expect(
      await problem(prepareAvatar(photo({ mimeType: null, fileName: null, uri: 'content://media/42' }), fake)),
    ).toBe('type')
    expect(shrinks).toHaveLength(0)
  })

  it('a picture the phone cannot decode is "unreadable"', async () => {
    const fake: AvatarTools = { shrink: () => Promise.reject(new Error('decode failed')), sizeOf: () => 6 * MB }
    expect(await problem(prepareAvatar(photo({ width: 4000, height: 3000, fileSize: 6 * MB }), fake))).toBe(
      'unreadable',
    )
  })

  it('reads the size from the file when the picker did not give one', async () => {
    const { fake, shrinks } = tools([500_000], 3 * MB)
    await prepareAvatar(photo({ fileSize: null }), fake)
    expect(shrinks).toHaveLength(1)
  })
})

describe('imageType', () => {
  it('uses the picker type, else the file name', () => {
    expect(imageType({ mimeType: 'image/JPG', uri: 'x' })).toBe('image/jpeg')
    expect(imageType({ mimeType: null, fileName: 'a.WEBP', uri: 'x' })).toBe('image/webp')
    expect(imageType({ mimeType: undefined, uri: 'file:///a/b.png?x=1' })).toBe('image/png')
  })
})
