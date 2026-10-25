// Ported from frontend/src/api/chats.ts (the chat list; the rest of the chat endpoints come with the conversation in 8C).
import { http } from '@/api/http'
import type { Paginated } from '@/types/api'
import type { Chat } from '@/types/chat'

/** One page of your chats, most recently active first. Pass `next` (a full URL from `links.next`) to load the following page. */
export async function listChats(next?: string): Promise<Paginated<Chat>> {
  const { data } = await (next
    ? http.get<Paginated<Chat>>(next)
    : http.get<Paginated<Chat>>('/chats', { params: { per_page: 30 } }))
  return data
}
