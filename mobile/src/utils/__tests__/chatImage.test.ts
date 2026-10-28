import type { AvatarTools, PickedImage } from '@/utils/avatar'
import { CHAT_IMAGE_MAX_EDGE, AttachError, prepareChatImage } from '@/utils/chatImage'

jest.mock('expo-file-system', () => ({ File: jest.fn() }))
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: { JPEG: 'jpeg' } }))

const MB = 1024 * 1024

function tools({ saved = 600_000, original = 2 * MB, fails = false } = {}) {
  const shrinks: { size: { width?: number; height?: number }; quality: number }[] = []
  const fake: AvatarTools = {
    async shrink(_uri, size, quality) {
      if (fails) throw new Error('cannot decode')
      shrinks.push({ size, quality })
      return { uri: 'file:///cache/out.jpg' }
    },
    sizeOf: (uri) => (uri.includes('out') ? saved : original),
  }
  return { fake, shrinks }
}

const photo = (overrides: Partial<PickedImage> = {}): PickedImage => ({
  uri: 'file:///picker/IMG_0001.jpg',
  width: 1600,
  height: 1200,
  mimeType: 'image/jpeg',
  fileName: 'IMG_0001.jpg',
  fileSize: 900_000,
  ...overrides,
})

describe('prepareChatImage', () => {
  it('sends a photo that already fits as it is', async () => {
    const { fake, shrinks } = tools()
    expect(await prepareChatImage(photo(), fake)).toEqual({
      uri: 'file:///picker/IMG_0001.jpg',
      name: 'IMG_0001.jpg',
      mimeType: 'image/jpeg',
      size: 900_000,
    })
    expect(shrinks).toHaveLength(0)
  })

  it('scales a big camera photo down along its longest side and saves it as a JPEG', async () => {
    const { fake, shrinks } = tools()
    const file = await prepareChatImage(photo({ width: 3000, height: 4000, fileSize: 5 * MB }), fake)
    expect(shrinks).toEqual([{ size: { height: CHAT_IMAGE_MAX_EDGE }, quality: 0.82 }])
    expect(file).toEqual({ uri: 'file:///cache/out.jpg', name: 'IMG_0001.jpg', mimeType: 'image/jpeg', size: 600_000 })
  })

  it('turns an iPhone HEIC photo into a JPEG even when it is small', async () => {
    const { fake, shrinks } = tools()
    const file = await prepareChatImage(photo({ mimeType: 'image/heic', fileName: 'IMG_0002.HEIC' }), fake)
    expect(shrinks).toEqual([{ size: {}, quality: 0.82 }])
    expect(file.name).toBe('IMG_0002.jpg')
    expect(file.mimeType).toBe('image/jpeg')
  })

  it('keeps a GIF as it is, whatever its size on screen, so it still moves', async () => {
    const { fake, shrinks } = tools()
    const file = await prepareChatImage(photo({ mimeType: 'image/gif', fileName: 'party.gif', width: 3000 }), fake)
    expect(shrinks).toHaveLength(0)
    expect(file).toMatchObject({ name: 'party.gif', mimeType: 'image/gif' })
  })

  it('names a camera photo without a file name "photo"', async () => {
    const { fake } = tools()
    expect((await prepareChatImage(photo({ fileName: null }), fake)).name).toBe('photo.jpg')
  })

  it('refuses a file over 25 MB before anything is sent', async () => {
    const { fake } = tools()
    await expect(prepareChatImage(photo({ mimeType: 'image/gif', fileSize: 26 * MB }), fake)).rejects.toEqual(
      new AttachError('too-big'),
    )
  })

  it('says when the picture cannot be read', async () => {
    const { fake } = tools({ fails: true })
    await expect(prepareChatImage(photo({ mimeType: 'image/heic' }), fake)).rejects.toMatchObject({
      problem: 'unreadable',
    })
  })
})
