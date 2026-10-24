import { http } from '@/api/http'
import type { Single } from '@/types/api'
import type { Attachment } from '@/types/chat'

/** The API's own limit for one file (docs/API.md, 8.1). Bigger files are refused before the upload starts. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

/**
 * Uploads a file to a chat; the returned `id` goes into `metadata.attachment_id` of the message that uses it.
 * An upload that is not used within 24 hours is deleted by the server.
 */
export async function uploadAttachment(
  chatId: string,
  file: File,
  options: { onProgress?: (percent: number) => void; signal?: AbortSignal } = {},
): Promise<Attachment> {
  const form = new FormData()
  form.append('file', file, file.name)

  const { data } = await http.post<Single<Attachment>>(`/chats/${chatId}/attachments`, form, {
    // 25 MB over a slow connection takes a while.
    timeout: 5 * 60_000,
    ...(options.signal ? { signal: options.signal } : {}),
    onUploadProgress: (event) => {
      if (options.onProgress && event.total) options.onProgress(Math.round((event.loaded / event.total) * 100))
    },
  })
  return data.data
}
