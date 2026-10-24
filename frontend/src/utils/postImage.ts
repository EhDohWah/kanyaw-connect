/** Pictures for a new post: what is accepted, and how a big photo is made small enough to keep on this device. */

export const POST_IMAGE_MAX_BYTES = 10 * 1024 * 1024

export type PostImageProblem = 'type' | 'too-big' | 'unreadable'

export class PostImageError extends Error {
  readonly problem: PostImageProblem

  constructor(problem: PostImageProblem) {
    super(problem)
    this.name = 'PostImageError'
    this.problem = problem
  }
}

/** Throws `PostImageError` for something that is not a picture, or is over 10 MB. */
export function checkPostImage(file: Pick<File, 'type' | 'size'>): void {
  if (!file.type.startsWith('image/')) throw new PostImageError('type')
  if (file.size > POST_IMAGE_MAX_BYTES) throw new PostImageError('too-big')
}

/** Long edge, in pixels, of a picture kept in the browser's storage, which is small (about 5 MB for everything). */
const STORED_EDGE = 900

/**
 * A small JPEG copy of the picture as a `data:` address, for the sample posts that live in `localStorage`. (A real
 * server would receive the original file instead.) Transparent areas become white, as JPEG has no transparency.
 */
export async function shrinkToDataUrl(file: Blob, edge: number = STORED_EDGE): Promise<string> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new PostImageError('unreadable')
  }

  try {
    const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))

    const context = canvas.getContext('2d')
    if (!context) throw new PostImageError('unreadable')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

    return canvas.toDataURL('image/jpeg', 0.82)
  } finally {
    bitmap.close?.()
  }
}
