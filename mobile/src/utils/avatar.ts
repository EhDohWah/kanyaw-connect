// The phone's version of frontend/src/utils/image.ts (prepareAvatar): the same limits, with expo-image-manipulator
// instead of a canvas.
import { File } from 'expo-file-system'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'

import type { AvatarFile } from '@/api/me'

/** What the API accepts for a profile picture (docs/API.md, POST /me/avatar). */
export const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024
/** The longest side after shrinking. The avatar is shown at most 128 points wide, so this is plenty. */
export const AVATAR_MAX_EDGE = 1600
/** JPEG qualities to try, best first, until the file is under the limit. */
const QUALITIES = [0.85, 0.7, 0.5] as const

export type AvatarProblem = 'type' | 'too-big' | 'unreadable'

export class AvatarError extends Error {
  readonly problem: AvatarProblem

  constructor(problem: AvatarProblem) {
    super(problem)
    this.name = 'AvatarError'
    this.problem = problem
  }
}

/** The fields of an `expo-image-picker` asset this needs. */
export interface PickedImage {
  uri: string
  width: number
  height: number
  mimeType?: string | null
  fileName?: string | null
  fileSize?: number | null
}

export interface AvatarTools {
  /** Scales the picture to `size` (one side; the other follows) and saves it as a JPEG. */
  shrink(uri: string, size: { width?: number; height?: number }, quality: number): Promise<{ uri: string }>
  /** The size of a local file in bytes. */
  sizeOf(uri: string): number
}

const EXTENSION_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  gif: 'image/gif',
  svg: 'image/svg+xml',
}

/** Photos the phone can decode and re-save as a JPEG: iPhones take HEIC pictures. */
const CONVERTIBLE = new Set(['image/heic', 'image/heif'])

/** The picture's type, from the picker or else from the file name. */
export function imageType(image: Pick<PickedImage, 'mimeType' | 'fileName' | 'uri'>): string | null {
  const mime = image.mimeType?.toLowerCase().trim()
  if (mime) return mime === 'image/jpg' ? 'image/jpeg' : mime
  const name = image.fileName ?? image.uri
  const extension = name.split('?')[0]?.split('.').pop()?.toLowerCase()
  return (extension && EXTENSION_TYPES[extension]) || null
}

/** The real tools; tests pass their own. */
export const imageTools: AvatarTools = {
  async shrink(uri, size, quality) {
    // Decode at the target size: a 12-megapixel photo decoded in full can run a 2 GB phone out of memory.
    const context = ImageManipulator.manipulate(uri, { maxWidth: size.width, maxHeight: size.height })
    try {
      if (size.width || size.height) context.resize(size)
      const image = await context.renderAsync()
      try {
        return await image.saveAsync({ compress: quality, format: SaveFormat.JPEG })
      } finally {
        image.release()
      }
    } finally {
      context.release()
    }
  },
  sizeOf(uri) {
    return new File(uri).size
  },
}

/**
 * Makes a picture fit the API's limits before it is uploaded: at most 1600 px on its longest side and under 2 MB.
 * A JPEG, PNG or WebP that already fits is sent untouched; anything bigger (or an iPhone's HEIC photo) is scaled down
 * and saved as a JPEG. GIF, SVG and anything else are refused here, before anything is sent.
 */
export async function prepareAvatar(image: PickedImage, tools: AvatarTools = imageTools): Promise<AvatarFile> {
  const type = imageType(image)
  const accepted = type !== null && (AVATAR_TYPES as readonly string[]).includes(type)
  if (!type || (!accepted && !CONVERTIBLE.has(type))) throw new AvatarError('type')

  const longest = Math.max(image.width, image.height)
  if (accepted && longest <= AVATAR_MAX_EDGE) {
    const bytes = image.fileSize ?? tools.sizeOf(image.uri)
    if (bytes > 0 && bytes <= AVATAR_MAX_BYTES) {
      return { uri: image.uri, name: fileName(image, type), type: type as AvatarFile['type'] }
    }
  }

  // Resize along the longest side only, so the other follows and the picture keeps its shape.
  const size =
    longest > AVATAR_MAX_EDGE
      ? image.width >= image.height
        ? { width: AVATAR_MAX_EDGE }
        : { height: AVATAR_MAX_EDGE }
      : {}
  for (const quality of QUALITIES) {
    let saved: { uri: string }
    try {
      saved = await tools.shrink(image.uri, size, quality)
    } catch {
      throw new AvatarError('unreadable')
    }
    if (tools.sizeOf(saved.uri) <= AVATAR_MAX_BYTES) {
      return { uri: saved.uri, name: `${baseName(image)}.jpg`, type: 'image/jpeg' }
    }
  }
  throw new AvatarError('too-big')
}

function baseName(image: PickedImage): string {
  return (image.fileName ?? '').replace(/\.[^.]+$/, '').trim() || 'avatar'
}

function fileName(image: PickedImage, type: string): string {
  const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[type] ?? 'jpg'
  return `${baseName(image)}.${extension}`
}
