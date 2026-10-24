import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import * as chatsApi from '@/api/chats'
import { toApiError, type ApiError } from '@/api/errors'
import type { Chat, ChatSummary, MemberRole, Message, ReadReceipt } from '@/types/chat'
import type { PublicUser } from '@/types/user'
import { compareMessages } from '@/utils/messageMerge'

/**
 * Pinned chats first (in their pin order), then the most recently active.
 * A chat without messages sorts by when it was created.
 */
function compareChats(a: Chat, b: Chat): number {
  const pinA = a.my_membership.pin_position
  const pinB = b.my_membership.pin_position
  if (pinA !== null && pinB !== null && pinA !== pinB) return pinA - pinB
  if (pinA !== null && pinB === null) return -1
  if (pinA === null && pinB !== null) return 1

  const timeA = a.last_message_at ?? a.created_at
  const timeB = b.last_message_at ?? b.created_at
  return timeA === timeB ? (a.id < b.id ? 1 : -1) : timeA < timeB ? 1 : -1
}

export const useChatsStore = defineStore('chats', () => {
  const byId = ref<Record<string, Chat>>({})
  const status = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const error = ref<ApiError | null>(null)
  const nextUrl = ref<string | null>(null)
  const loadingMore = ref(false)
  /** The chat that is open on screen right now (and the page is visible): its new messages are not "unread". */
  const viewingId = ref<string | null>(null)
  /** The chat the person themselves just left: the screen showing it goes back to the list without a "removed" message. */
  const lastLeftId = ref<string | null>(null)

  const chats = computed(() => Object.values(byId.value).sort(compareChats))
  const hasMore = computed(() => nextUrl.value !== null)
  /** Unread messages in chats that are not muted: the badge on "Messages". */
  const totalUnread = computed(() =>
    chats.value.reduce((sum, chat) => sum + (chat.my_membership.is_muted ? 0 : chat.unread_count), 0),
  )

  function get(chatId: string): Chat | undefined {
    return byId.value[chatId]
  }

  /** Puts a chat in the list. The list endpoint has no `members`, so ones we already know are kept. */
  function put(chat: Chat): Chat {
    const known = byId.value[chat.id]
    const merged: Chat = chat.members || !known?.members ? chat : { ...chat, members: known.members }
    byId.value = { ...byId.value, [chat.id]: merged }
    return merged
  }

  function drop(chatId: string): void {
    const { [chatId]: _removed, ...rest } = byId.value
    byId.value = rest
    if (viewingId.value === chatId) viewingId.value = null
  }

  /* ------------------------------------------------------------------------------------- loading --- */

  /**
   * (Re)loads the first page of the list. Safe to call again at any time, for instance after a reconnect: chats
   * are matched by id, and chats the page shows are gone from the server are dropped.
   */
  async function fetchChats(): Promise<void> {
    if (status.value === 'idle' || status.value === 'error') status.value = 'loading'

    try {
      const page = await chatsApi.listChats()
      const fetched = page.data
      const fetchedIds = new Set(fetched.map((chat) => chat.id))
      const complete = page.links.next === null
      const oldest = fetched.reduce<string | null>((min, chat) => {
        const time = chat.last_message_at ?? chat.created_at
        return min === null || time < min ? time : min
      }, null)

      // Chats that should be on this page but are not were left or removed meanwhile.
      const next: Record<string, Chat> = {}
      for (const chat of Object.values(byId.value)) {
        const inRange = complete || (oldest !== null && (chat.last_message_at ?? chat.created_at) >= oldest)
        if (fetchedIds.has(chat.id) || !inRange) next[chat.id] = chat
      }
      byId.value = next

      for (const chat of fetched) put(chat)
      if (complete || status.value !== 'ready') nextUrl.value = page.links.next

      error.value = null
      status.value = 'ready'
    } catch (problem) {
      error.value = toApiError(problem)
      // A failed refresh must not blank a list that is already on screen.
      if (status.value !== 'ready') status.value = 'error'
    }
  }

  async function loadMore(): Promise<void> {
    if (!nextUrl.value || loadingMore.value) return

    loadingMore.value = true
    try {
      const page = await chatsApi.listChats(nextUrl.value)
      for (const chat of page.data) put(chat)
      nextUrl.value = page.links.next
    } catch (problem) {
      error.value = toApiError(problem)
    } finally {
      loadingMore.value = false
    }
  }

  /** One chat with its members. */
  async function loadDetails(chatId: string): Promise<Chat> {
    return put(await chatsApi.getChat(chatId))
  }

  const memberRequests = new Map<string, Promise<Chat>>()

  /**
   * The chat with its members, asking the server only if they are not known yet (cached for the session), and only
   * once when several screens ask at the same time (the people pickers and the sidebar both want them).
   */
  function ensureMembers(chatId: string): Promise<Chat> {
    const known = get(chatId)
    if (known?.members) return Promise.resolve(known)

    const running = memberRequests.get(chatId)
    if (running) return running

    const request = loadDetails(chatId).finally(() => memberRequests.delete(chatId))
    memberRequests.set(chatId, request)
    return request
  }

  /** A chat we may not have yet (a deep link, or an event about a chat that is not in the list). */
  async function ensure(chatId: string): Promise<Chat> {
    return get(chatId) ?? loadDetails(chatId)
  }

  /* ------------------------------------------------------------------------------------ real time --- */

  /**
   * A message arrived (REST answer or event). Updates the preview and, for someone else's message in a chat that is
   * not on screen, the unread count. It counts a message only when it is newer than the one the list already
   * shows, so hearing about the same message twice (it comes on two channels) counts it once.
   */
  function receiveMessage(message: Message, meId: string): void {
    const chat = get(message.chat_id)
    if (!chat) {
      void loadDetails(message.chat_id).catch(() => undefined)
      return
    }

    const newer = !chat.latest_message || compareMessages(chat.latest_message, message) < 0
    if (!newer) return

    const countsAsUnread = message.type !== 'system' && message.sender_id !== meId && viewingId.value !== chat.id
    put({
      ...chat,
      latest_message: message,
      last_message_at: message.created_at,
      unread_count: chat.unread_count + (countsAsUnread ? 1 : 0),
    })
  }

  /** The latest message was edited or deleted: only the chat's own details know what the new latest message is. */
  function refreshPreview(chatId: string): void {
    if (get(chatId)) void loadDetails(chatId).catch(() => undefined)
  }

  /** You read up to here (on this device after `POST /read`, or on another one: `message.read` on your user channel). */
  function applyRead(receipt: Pick<ReadReceipt, 'chat_id' | 'last_read_message_id' | 'last_read_at'> & { unread_count?: number }): void {
    const chat = get(receipt.chat_id)
    if (!chat) return

    put({
      ...chat,
      // The server counts; an event from another device has no count, and reading up to the end leaves none.
      unread_count: receipt.unread_count ?? (chat.latest_message?.id === receipt.last_read_message_id ? 0 : chat.unread_count),
      my_membership: {
        ...chat.my_membership,
        last_read_message_id: receipt.last_read_message_id,
        last_read_at: receipt.last_read_at,
      },
    })
  }

  function applySummary(summary: ChatSummary): void {
    const chat = get(summary.id)
    if (!chat) return

    put({
      ...chat,
      name: summary.name,
      description: summary.description,
      avatar_url: summary.avatar_url,
      member_count: summary.member_count,
      // Never move the "last activity" backwards: a summary is a snapshot from when the event was made.
      last_message_at: (summary.last_message_at ?? '') > (chat.last_message_at ?? '') ? summary.last_message_at : chat.last_message_at,
    })
  }

  /** Someone else joined or left a chat you have open: the member list on screen is out of date. */
  function membersChanged(chatId: string): void {
    const chat = get(chatId)
    if (chat?.members) void loadDetails(chatId).catch(() => undefined)
  }

  /* ------------------------------------------------------------------------------------- actions --- */

  async function openDirect(userId: string): Promise<Chat> {
    const { chat } = await chatsApi.createDirectChat(userId)
    return put(chat)
  }

  async function createGroup(input: chatsApi.NewGroup): Promise<Chat> {
    return put(await chatsApi.createGroupChat(input))
  }

  async function updateGroup(chatId: string, patch: { name?: string; description?: string | null }): Promise<Chat> {
    return put(await chatsApi.updateChat(chatId, patch))
  }

  async function addMembers(chatId: string, userIds: string[]): Promise<Chat> {
    return put(await chatsApi.addMembers(chatId, userIds))
  }

  async function setRole(chatId: string, userId: string, role: Exclude<MemberRole, 'owner'>): Promise<Chat> {
    return put(await chatsApi.setMemberRole(chatId, userId, role))
  }

  async function removeMember(chatId: string, userId: string): Promise<void> {
    await chatsApi.removeMember(chatId, userId)
    await loadDetails(chatId)
  }

  async function leave(chatId: string): Promise<void> {
    await chatsApi.leaveChat(chatId)
    lastLeftId.value = chatId
    drop(chatId)
  }

  /** The people you can see in your chats' lists so far (other side of direct chats, plus loaded members). */
  function knownPeople(meId: string): PublicUser[] {
    const people = new Map<string, PublicUser>()
    for (const chat of Object.values(byId.value)) {
      if (chat.other_user) people.set(chat.other_user.id, chat.other_user)
      for (const member of chat.members ?? []) people.set(member.user_id, member.user)
    }
    people.delete(meId)
    return [...people.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  function reset(): void {
    byId.value = {}
    status.value = 'idle'
    error.value = null
    nextUrl.value = null
    loadingMore.value = false
    viewingId.value = null
    lastLeftId.value = null
    memberRequests.clear()
  }

  return {
    byId,
    status,
    error,
    hasMore,
    loadingMore,
    viewingId,
    lastLeftId,
    chats,
    totalUnread,
    get,
    put,
    drop,
    fetchChats,
    loadMore,
    loadDetails,
    ensureMembers,
    ensure,
    receiveMessage,
    refreshPreview,
    applyRead,
    applySummary,
    membersChanged,
    openDirect,
    createGroup,
    updateGroup,
    addMembers,
    setRole,
    removeMember,
    leave,
    knownPeople,
    reset,
  }
})
