// Ported from frontend/src/stores/chats.ts (Pinia) to Zustand. Same rules; `chats` is kept sorted in the state (a
// selector that sorts would hand React a new array on every read). Answers that arrive after sign-out are dropped.
import { create } from 'zustand'

import * as chatsApi from '@/api/chats'
import { toApiError, type ApiError } from '@/api/errors'
import type { Chat, ChatSummary, MemberRole, Message, ReadReceipt } from '@/types/chat'
import type { PublicUser } from '@/types/user'
import { compareMessages } from '@/utils/messageMerge'

/**
 * Pinned chats first (in their pin order), then the most recently active.
 * A chat without messages sorts by when it was created.
 */
export function compareChats(a: Chat, b: Chat): number {
  const pinA = a.my_membership.pin_position
  const pinB = b.my_membership.pin_position
  if (pinA !== null && pinB !== null && pinA !== pinB) return pinA - pinB
  if (pinA !== null && pinB === null) return -1
  if (pinA === null && pinB !== null) return 1

  const timeA = a.last_message_at ?? a.created_at
  const timeB = b.last_message_at ?? b.created_at
  return timeA === timeB ? (a.id < b.id ? 1 : -1) : timeA < timeB ? 1 : -1
}

/** `POST /chats/{chat}/members` takes at most this many people at once (docs/API.md). */
export const MAX_ADD_PER_REQUEST = 50

type ById = Record<string, Chat>

interface ChatsState {
  byId: ById
  /** Every chat in `byId`, in list order. */
  chats: Chat[]
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: ApiError | null
  /** The next page's URL, or null when everything is loaded. */
  next: string | null
  loadingMore: boolean
  /** Loading more failed: shown under the list, without hiding the chats already there. */
  loadMoreError: ApiError | null
  /** The chat that is open on screen right now (scrolled to the end): its new messages are not "unread". */
  viewingId: string | null
  /** The chat the person themselves just left: its screen goes back to the list without a "removed" message. */
  lastLeftId: string | null

  get(chatId: string): Chat | undefined
  put(chat: Chat): Chat
  drop(chatId: string): void
  setViewing(chatId: string | null): void

  /** Loads the first page unless it is already there (or on its way). */
  load(): Promise<void>
  /**
   * (Re)loads the first page. Safe at any time (pull to refresh, after a reconnect): chats are matched by id, and
   * chats the page shows are gone from the server are dropped.
   */
  refresh(): Promise<void>
  loadMore(): Promise<void>
  loadDetails(chatId: string): Promise<Chat>
  /** The chat with its members, asking the server only once for them per session. */
  ensureMembers(chatId: string): Promise<Chat>
  /** A chat we may not have yet (a link from a notification, an event about a chat not in the list). */
  ensure(chatId: string): Promise<Chat>

  receiveMessage(message: Message, meId: string): void
  refreshPreview(chatId: string): void
  applyRead(
    receipt: Pick<ReadReceipt, 'chat_id' | 'last_read_message_id' | 'last_read_at'> & { unread_count?: number },
  ): void
  applySummary(summary: ChatSummary): void
  membersChanged(chatId: string): void

  openDirect(userId: string): Promise<Chat>
  createGroup(input: chatsApi.NewGroup): Promise<Chat>
  updateGroup(chatId: string, patch: { name?: string; description?: string | null }): Promise<Chat>
  addMembers(chatId: string, userIds: string[]): Promise<Chat>
  setRole(chatId: string, userId: string, role: Exclude<MemberRole, 'owner'>): Promise<Chat>
  removeMember(chatId: string, userId: string): Promise<void>
  leave(chatId: string): Promise<void>
  knownPeople(meId: string): PublicUser[]
  reset(): void
}

/** Each sign-in session gets a number; an answer from an earlier one is dropped. */
let session = 0
const memberRequests = new Map<string, Promise<Chat>>()

function withList(byId: ById): Pick<ChatsState, 'byId' | 'chats'> {
  return { byId, chats: Object.values(byId).sort(compareChats) }
}

/** Unread messages in chats that are not muted: the badge on "Messages". */
export function totalUnread(chats: Chat[]): number {
  return chats.reduce((sum, chat) => sum + (chat.my_membership.is_muted ? 0 : chat.unread_count), 0)
}

export const useChatsStore = create<ChatsState>()((set, get) => {
  /** Runs `work` and applies its result only if no sign-out happened meanwhile. */
  async function current<T>(work: () => Promise<T>): Promise<{ value: T; stale: boolean }> {
    const mine = session
    const value = await work()
    return { value, stale: mine !== session }
  }

  return {
    ...withList({}),
    status: 'idle',
    error: null,
    next: null,
    loadingMore: false,
    loadMoreError: null,
    viewingId: null,
    lastLeftId: null,

    get: (chatId) => get().byId[chatId],

    put(chat) {
      const known = get().byId[chat.id]
      // The list endpoint has no `members`: keep ones we already know.
      const merged: Chat = chat.members || !known?.members ? chat : { ...chat, members: known.members }
      set(withList({ ...get().byId, [chat.id]: merged }))
      return merged
    },

    drop(chatId) {
      const { [chatId]: _removed, ...rest } = get().byId
      set({ ...withList(rest), viewingId: get().viewingId === chatId ? null : get().viewingId })
    },

    setViewing: (chatId) => set({ viewingId: chatId }),

    /* ----------------------------------------------------------------------------------- loading --- */

    async load() {
      const { status } = get()
      if (status === 'ready' || status === 'loading') return
      await get().refresh()
    },

    async refresh() {
      const mine = session
      if (get().status === 'idle' || get().status === 'error') set({ status: 'loading' })

      try {
        const page = await chatsApi.listChats()
        if (mine !== session) return

        const fetched = page.data
        const fetchedIds = new Set(fetched.map((chat) => chat.id))
        const complete = page.links.next === null
        const oldest = fetched.reduce<string | null>((min, chat) => {
          const time = chat.last_message_at ?? chat.created_at
          return min === null || time < min ? time : min
        }, null)

        // Chats that should be on this page but are not were left or removed meanwhile.
        const kept: ById = {}
        for (const chat of Object.values(get().byId)) {
          const inRange = complete || (oldest !== null && (chat.last_message_at ?? chat.created_at) >= oldest)
          if (fetchedIds.has(chat.id) || !inRange) kept[chat.id] = chat
        }
        for (const chat of fetched) {
          const known = kept[chat.id]
          kept[chat.id] = chat.members || !known?.members ? chat : { ...chat, members: known.members }
        }

        set({
          ...withList(kept),
          next: complete || get().status !== 'ready' ? page.links.next : get().next,
          error: null,
          status: 'ready',
        })
      } catch (problem) {
        if (mine !== session) return
        // A failed refresh must not blank a list that is already on screen.
        set({ error: toApiError(problem), status: get().status === 'ready' ? 'ready' : 'error' })
      }
    },

    async loadMore() {
      const { next, loadingMore } = get()
      if (!next || loadingMore) return

      const mine = session
      set({ loadingMore: true, loadMoreError: null })
      try {
        const page = await chatsApi.listChats(next)
        if (mine !== session) return
        for (const chat of page.data) get().put(chat)
        set({ next: page.links.next })
      } catch (problem) {
        if (mine === session) set({ loadMoreError: toApiError(problem) })
      } finally {
        if (mine === session) set({ loadingMore: false })
      }
    },

    async loadDetails(chatId) {
      const { value, stale } = await current(() => chatsApi.getChat(chatId))
      return stale ? value : get().put(value)
    },

    ensureMembers(chatId) {
      const known = get().get(chatId)
      if (known?.members) return Promise.resolve(known)

      const running = memberRequests.get(chatId)
      if (running) return running

      const request = get()
        .loadDetails(chatId)
        .finally(() => memberRequests.delete(chatId))
      memberRequests.set(chatId, request)
      return request
    },

    async ensure(chatId) {
      return get().get(chatId) ?? get().loadDetails(chatId)
    },

    /* --------------------------------------------------------------------------------- real time --- */

    /**
     * A message arrived (REST answer or event). Updates the preview and, for someone else's message in a chat that
     * is not on screen, the unread count. Only a message newer than the one shown counts, so hearing about the same
     * message twice (it comes on two channels) counts it once.
     */
    receiveMessage(message, meId) {
      const chat = get().get(message.chat_id)
      if (!chat) {
        void get()
          .loadDetails(message.chat_id)
          .catch(() => undefined)
        return
      }

      const newer = !chat.latest_message || compareMessages(chat.latest_message, message) < 0
      if (!newer) return

      const countsAsUnread = message.type !== 'system' && message.sender_id !== meId && get().viewingId !== chat.id
      get().put({
        ...chat,
        latest_message: message,
        last_message_at: message.created_at,
        unread_count: chat.unread_count + (countsAsUnread ? 1 : 0),
      })
    },

    /** The latest message was edited or deleted: only the chat's own details know what the new latest one is. */
    refreshPreview(chatId) {
      if (get().get(chatId))
        void get()
          .loadDetails(chatId)
          .catch(() => undefined)
    },

    /** You read up to here (on this phone after `POST /read`, or on another device: `message.read`). */
    applyRead(receipt) {
      const chat = get().get(receipt.chat_id)
      if (!chat) return

      get().put({
        ...chat,
        // The server counts; an event from another device has no count, and reading up to the end leaves none.
        unread_count:
          receipt.unread_count ?? (chat.latest_message?.id === receipt.last_read_message_id ? 0 : chat.unread_count),
        my_membership: {
          ...chat.my_membership,
          last_read_message_id: receipt.last_read_message_id,
          last_read_at: receipt.last_read_at,
        },
      })
    },

    applySummary(summary) {
      const chat = get().get(summary.id)
      if (!chat) return

      get().put({
        ...chat,
        name: summary.name,
        description: summary.description,
        avatar_url: summary.avatar_url,
        member_count: summary.member_count,
        // Never move the "last activity" backwards: a summary is a snapshot from when the event was made.
        last_message_at:
          (summary.last_message_at ?? '') > (chat.last_message_at ?? '')
            ? summary.last_message_at
            : chat.last_message_at,
      })
    },

    /** Someone else joined or left a chat whose members we hold: the member list is out of date. */
    membersChanged(chatId) {
      if (get().get(chatId)?.members)
        void get()
          .loadDetails(chatId)
          .catch(() => undefined)
    },

    /* ----------------------------------------------------------------------------------- actions --- */

    async openDirect(userId) {
      const { value, stale } = await current(() => chatsApi.createDirectChat(userId))
      return stale ? value.chat : get().put(value.chat)
    },

    async createGroup(input) {
      const { value, stale } = await current(() => chatsApi.createGroupChat(input))
      return stale ? value : get().put(value)
    },

    async updateGroup(chatId, patch) {
      const { value, stale } = await current(() => chatsApi.updateChat(chatId, patch))
      return stale ? value : get().put(value)
    },

    /** Adds people, 50 per request (the API's limit), so a long selection does not fail as a whole. */
    async addMembers(chatId, userIds) {
      let chat: Chat | undefined
      for (let start = 0; start < userIds.length; start += MAX_ADD_PER_REQUEST) {
        const { value, stale } = await current(() =>
          chatsApi.addMembers(chatId, userIds.slice(start, start + MAX_ADD_PER_REQUEST)),
        )
        chat = stale ? value : get().put(value)
      }
      return chat ?? (await get().loadDetails(chatId))
    },

    async setRole(chatId, userId, role) {
      const { value, stale } = await current(() => chatsApi.setMemberRole(chatId, userId, role))
      return stale ? value : get().put(value)
    },

    async removeMember(chatId, userId) {
      await chatsApi.removeMember(chatId, userId)
      await get().loadDetails(chatId)
    },

    async leave(chatId) {
      const { stale } = await current(() => chatsApi.leaveChat(chatId))
      if (stale) return
      set({ lastLeftId: chatId })
      get().drop(chatId)
    },

    /** The people you can see in your chats so far (the other side of direct chats, plus loaded members). */
    knownPeople(meId) {
      const people = new Map<string, PublicUser>()
      for (const chat of Object.values(get().byId)) {
        if (chat.other_user) people.set(chat.other_user.id, chat.other_user)
        for (const member of chat.members ?? []) people.set(member.user_id, member.user)
      }
      people.delete(meId)
      return [...people.values()].sort((a, b) => a.name.localeCompare(b.name))
    },

    reset() {
      session += 1
      memberRequests.clear()
      set({
        ...withList({}),
        status: 'idle',
        error: null,
        next: null,
        loadingMore: false,
        loadMoreError: null,
        viewingId: null,
        lastLeftId: null,
      })
    },
  }
})
