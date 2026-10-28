// Ported from frontend/src/api/attachments.ts. The phone uploads a local file by its URI (React Native's FormData
// reads `{ uri, name, type }` parts from disk), not a browser File.
import { http } from '@/api/http'
import type { Single } from '@/types/api'
import type { Attachment, LocalFile } from '@/types/chat'

/** The API's own limit for one file (docs/API.md, 9.1). Bigger files are refused before the upload starts. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

/**
 * Uploads a file to a chat; the returned `id` goes into `metadata.attachment_id` of the message that uses it.
 * An upload that is not used within 24 hours is deleted by the server.
 */
export async function uploadAttachment(
  chatId: string,
  file: LocalFile,
  options: { onProgress?: (percent: number) => void; signal?: AbortSignal } = {},
): Promise<Attachment> {
  const form = new FormData()
  form.append('file', { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob)

  const { data } = await http.post<Single<Attachment>>(`/chats/${chatId}/attachments`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    // 25 MB over a slow connection takes a while.
    timeout: 5 * 60_000,
    ...(options.signal ? { signal: options.signal } : {}),
    onUploadProgress: (event) => {
      if (options.onProgress && event.total) options.onProgress(Math.round((event.loaded / event.total) * 100))
    },
  })
  return data.data
}
