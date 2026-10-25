import { http } from '@/api/http'
import type { Paginated, Single } from '@/types/api'
import type { Message, MessageType } from '@/types/chat'

/** One page of a chat's messages, **newest first**. Pass `next` (a full URL from `links.next`) for older ones. */
export async function listMessages(chatId: string, next?: string): Promise<Paginated<Message>> {
  const { data } = await (next
    ? http.get<Paginated<Message>>(next)
    : http.get<Paginated<Message>>(`/chats/${chatId}/messages`, { params: { per_page: 30 } }))
  return data
}

export interface OutgoingMessage {
  client_id: string
  type: Exclude<MessageType, 'system'>
  content?: string
  reply_to_id?: string
  /** `duration_ms` and `waveform` only for a voice message (docs/API.md, 3.5). */
  metadata?: { attachment_id: string; duration_ms?: number; waveform?: number[] }
}

/**
 * Sends a message. The server remembers `client_id`: sending the same one again (a dropped connection, a double tap)
 * returns the original message with 200 instead of making a second, which is why this request may be repeated
 * after a 429. `created` is false for such a repeat.
 */
export async function sendMessage(chatId: string, message: OutgoingMessage): Promise<{ message: Message; created: boolean }> {
  const response = await http.post<Message | Single<Message>>(`/chats/${chatId}/messages`, message, { retryOn429: true })
  // The server wraps it in `data` like every other single resource (docs/API.md used to show it bare). Both are accepted.
  const body = response.data
  return { message: 'data' in body ? body.data : body, created: response.status === 201 }
}

/** A single message, for example to get fresh signed attachment links. */
export async function getMessage(messageId: string): Promise<Message> {
  const { data } = await http.get<Single<Message>>(`/messages/${messageId}`)
  return data.data
}

export async function editMessage(messageId: string, content: string): Promise<Message> {
  const { data } = await http.patch<Single<Message>>(`/messages/${messageId}`, { content })
  return data.data
}

export async function deleteMessage(messageId: string): Promise<void> {
  await http.delete(`/messages/${messageId}`)
}
