// Photos for a chat. A phone camera takes 4–12 MB pictures, far bigger than anyone sees in a conversation, so they are
// scaled down before the upload: quicker to send, and kinder to the other person's data plan.
import { MAX_ATTACHMENT_BYTES } from '@/api/attachments'
import type { LocalFile } from '@/types/chat'
import { imageTools, imageType, type AvatarTools, type PickedImage } from '@/utils/avatar'

/** The longest side of a photo after shrinking: sharp on any phone screen, and full screen in the viewer. */
export const CHAT_IMAGE_MAX_EDGE = 2048
const QUALITY = 0.82

/** Pictures the server shows as photos; anything else (or bigger) is re-saved as a JPEG first. */
const AS_IS = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

export type AttachProblem = 'too-big' | 'unreadable'

export class AttachError extends Error {
  readonly problem: AttachProblem

  constructor(problem: AttachProblem) {
    super(problem)
    this.name = 'AttachError'
    this.problem = problem
  }
}

/**
 * Makes a picked or taken photo ready to send. A JPEG, PNG, WebP or GIF that is at most 2048 px on its longest side
 * goes as it is (a GIF always does, so it keeps moving); anything bigger, an iPhone's HEIC photo, or a picture of an
 * unknown type is scaled down and saved as a JPEG. Throws `AttachError` when the result is still over 25 MB or the
 * picture cannot be read.
 */
export async function prepareChatImage(image: PickedImage, tools: AvatarTools = imageTools): Promise<LocalFile> {
  const type = imageType(image)
  const longest = Math.max(image.width, image.height)

  if (type && AS_IS.has(type) && (longest <= CHAT_IMAGE_MAX_EDGE || type === 'image/gif')) {
    const size = image.fileSize ?? tools.sizeOf(image.uri)
    if (size > MAX_ATTACHMENT_BYTES) throw new AttachError('too-big')
    return { uri: image.uri, name: fileName(image, type), mimeType: type, size }
  }

  // Resize along the longest side only, so the other follows and the picture keeps its shape.
  const size =
    longest > CHAT_IMAGE_MAX_EDGE
      ? image.width >= image.height
        ? { width: CHAT_IMAGE_MAX_EDGE }
        : { height: CHAT_IMAGE_MAX_EDGE }
      : {}
  let saved: { uri: string }
  try {
    saved = await tools.shrink(image.uri, size, QUALITY)
  } catch {
    throw new AttachError('unreadable')
  }
  const bytes = tools.sizeOf(saved.uri)
  if (bytes > MAX_ATTACHMENT_BYTES) throw new AttachError('too-big')
  return { uri: saved.uri, name: `${baseName(image)}.jpg`, mimeType: 'image/jpeg', size: bytes }
}

function baseName(image: PickedImage): string {
  return (image.fileName ?? '').replace(/\.[^.]+$/, '').trim() || 'photo'
}

function fileName(image: PickedImage, type: string): string {
  const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[type] ?? 'jpg'
  return `${baseName(image)}.${extension}`
}
