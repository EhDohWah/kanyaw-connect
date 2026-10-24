import { http } from '@/api/http'
import type { Paginated, Single } from '@/types/api'
import type { Chat, MemberRole, ReadReceipt } from '@/types/chat'

/** One page of your chats, most recently active first. Pass `next` (a full URL from `links.next`) to load the following page. */
export async function listChats(next?: string): Promise<Paginated<Chat>> {
  const { data } = await (next ? http.get<Paginated<Chat>>(next) : http.get<Paginated<Chat>>('/chats', { params: { per_page: 30 } }))
  return data
}

/** One chat with its full `members` list. */
export async function getChat(chatId: string): Promise<Chat> {
  const { data } = await http.get<Single<Chat>>(`/chats/${chatId}`)
  return data.data
}

/** `created` is false when the two people already had a chat (the server answers 200 instead of 201). */
export async function createDirectChat(userId: string): Promise<{ chat: Chat; created: boolean }> {
  const response = await http.post<Single<Chat>>('/chats/direct', { user_id: userId })
  return { chat: response.data.data, created: response.status === 201 }
}

export interface NewGroup {
  name: string
  description?: string
  /** Everyone except yourself: you become the owner. */
  member_ids: string[]
}

export async function createGroupChat(group: NewGroup): Promise<Chat> {
  const { data } = await http.post<Single<Chat>>('/chats/group', group)
  return data.data
}

export async function updateChat(chatId: string, patch: { name?: string; description?: string | null }): Promise<Chat> {
  const { data } = await http.patch<Single<Chat>>(`/chats/${chatId}`, patch)
  return data.data
}

export async function leaveChat(chatId: string): Promise<void> {
  await http.delete(`/chats/${chatId}/leave`)
}

/** Moves your read position forward to this message. It never moves back, so a late answer is harmless. */
export async function markRead(chatId: string, messageId: string): Promise<ReadReceipt> {
  const { data } = await http.post<Single<ReadReceipt>>(`/chats/${chatId}/read`, { message_id: messageId })
  return data.data
}

export async function addMembers(chatId: string, userIds: string[]): Promise<Chat> {
  const { data } = await http.post<Single<Chat>>(`/chats/${chatId}/members`, { user_ids: userIds })
  return data.data
}

export async function setMemberRole(chatId: string, userId: string, role: Exclude<MemberRole, 'owner'>): Promise<Chat> {
  const { data } = await http.patch<Single<Chat>>(`/chats/${chatId}/members/${userId}`, { role })
  return data.data
}

export async function removeMember(chatId: string, userId: string): Promise<void> {
  await http.delete(`/chats/${chatId}/members/${userId}`)
}
