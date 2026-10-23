/** What the API accepts for a profile picture (docs/API.md, POST /me/avatar). */
export const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024

/** Phones take 4-12 MB photos; the avatar is shown at most 128 px wide, so this is plenty. */
const DOWNSCALE_EDGE = 1600

export type AvatarProblem = 'type' | 'too-big' | 'unreadable'

export class AvatarError extends Error {
  readonly problem: AvatarProblem

  constructor(problem: AvatarProblem) {
    super(problem)
    this.name = 'AvatarError'
    this.problem = problem
  }
}

function isAvatarType(type: string): boolean {
  return (AVATAR_TYPES as readonly string[]).includes(type)
}

async function decode(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file)
  } catch {
    throw new AvatarError('unreadable')
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

/**
 * Makes a picture fit the API's limits before it is uploaded. A file that already fits is sent untouched;
 * a big photo from a phone is scaled down in the browser (slow data is common), instead of being refused.
 * Throws `AvatarError` for a wrong file type, a file that is not an image, or one that is still too big.
 */
export async function prepareAvatar(file: File): Promise<File> {
  if (!isAvatarType(file.type)) throw new AvatarError('type')
  if (file.size <= AVATAR_MAX_BYTES) return file

  const bitmap = await decode(file)
  try {
    const scale = Math.min(1, DOWNSCALE_EDGE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))

    const context = canvas.getContext('2d')
    if (!context) throw new AvatarError('unreadable')
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

    const blob = await toBlob(canvas, 'image/webp', 0.85)
    if (!blob) throw new AvatarError('unreadable')
    if (blob.size > AVATAR_MAX_BYTES) throw new AvatarError('too-big')

    const name = file.name.replace(/\.[^.]+$/, '') || 'avatar'
    return new File([blob], `${name}.webp`, { type: blob.type || 'image/webp' })
  } finally {
    bitmap.close?.()
  }
}
