import { defineStore } from 'pinia'
import { reactive } from 'vue'

import { uploadAttachment } from '@/api/attachments'
import { toApiError, type ApiError } from '@/api/errors'
import * as messagesApi from '@/api/messages'
import type { Message, PendingInfo, SendDraft, TimelineMessage } from '@/types/chat'
import type { PublicUser } from '@/types/user'
import { mergeMessages, reconcileFirstPage, withoutMessage } from '@/utils/messageMerge'
import { uuid } from '@/utils/uuid'
import { useAuthStore } from '@/stores/auth'
import { useChatsStore } from '@/stores/chats'

export interface ChatTimeline {
  /** Oldest first: confirmed messages in order, then the ones still on their way. */
  messages: TimelineMessage[]
  /** Full URL of the next (older) page, or null when everything is loaded. */
  nextUrl: string | null
  status: 'loading' | 'ready' | 'error'
  error: ApiError | null
  loadingOlder: boolean
  olderError: ApiError | null
}

/** How the app tries again before it gives up on a send and shows "Tap to retry" (docs/API.md, 1.9). */
const SEND_RETRY_DELAYS_MS = [800, 2500]

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const retryable = (error: ApiError): boolean => error.isNetwork || error.status >= 500

function emptyTimeline(): ChatTimeline {
  return { messages: [], nextUrl: null, status: 'loading', error: null, loadingOlder: false, olderError: null }
}

function toPublicUser(user: { id: string; name: string; avatar_url: string | null; avatar_thumb_url: string | null }): PublicUser {
  return { id: user.id, name: user.name, avatar_url: user.avatar_url, avatar_thumb_url: user.avatar_thumb_url }
}

/** The pictures of failed or sending messages that are shown from the person's own file, to be released once sent. */
const localPreviews = new Map<string, string>()
/** Uploads that can be cancelled when the person discards a message. */
const uploads = new Map<string, AbortController>()
/** Messages whose attachment links were refreshed once already (a broken image is refetched once, not forever). */
const refreshedAttachments = new Set<string>()

export const useMessagesStore = defineStore('messages', () => {
  const timelines = reactive<Record<string, ChatTimeline>>({})

  const auth = useAuthStore()
  const chats = useChatsStore()

  function timeline(chatId: string): ChatTimeline | undefined {
    return timelines[chatId]
  }

  function ensureTimeline(chatId: string): ChatTimeline {
    // Read it back after creating it: the value of `a ??= b` is the plain object, and changes made to the plain
    // object are invisible to the screen. What `timelines[chatId]` returns is the reactive version.
    if (!timelines[chatId]) timelines[chatId] = emptyTimeline()
    return timelines[chatId] as ChatTimeline
  }

  /** The API lists newest first; the conversation reads oldest first. */
  const oldestFirst = (page: Message[]): Message[] => [...page].reverse()

  /* ------------------------------------------------------------------------------------ loading --- */

  async function loadInitial(chatId: string): Promise<void> {
    const entry = ensureTimeline(chatId)
    entry.status = 'loading'
    entry.error = null

    try {
      const page = await messagesApi.listMessages(chatId)
      entry.messages = mergeMessages(entry.messages, oldestFirst(page.data))
      entry.nextUrl = page.links.next
      entry.status = 'ready'
    } catch (problem) {
      entry.error = toApiError(problem)
      entry.status = 'error'
    }
  }

  /** Opens a chat's history once; later visits show what is already there (events keep it current). */
  async function ensureLoaded(chatId: string): Promise<void> {
    const entry = timelines[chatId]
    if (!entry || entry.status === 'error') await loadInitial(chatId)
  }

  async function loadOlder(chatId: string): Promise<void> {
    const entry = timelines[chatId]
    if (!entry?.nextUrl || entry.loadingOlder) return

    entry.loadingOlder = true
    entry.olderError = null
    try {
      const page = await messagesApi.listMessages(chatId, entry.nextUrl)
      entry.messages = mergeMessages(entry.messages, oldestFirst(page.data))
      entry.nextUrl = page.links.next
    } catch (problem) {
      entry.olderError = toApiError(problem)
    } finally {
      entry.loadingOlder = false
    }
  }

  /** After a reconnect: fold the newest page into what is on screen (see `reconcileFirstPage`). */
  async function resync(chatId: string): Promise<void> {
    const entry = timelines[chatId]
    if (!entry || entry.status !== 'ready') return

    try {
      const page = await messagesApi.listMessages(chatId)
      const result = reconcileFirstPage(entry.messages, oldestFirst(page.data))
      entry.messages = result.messages
      if (result.replaced) entry.nextUrl = page.links.next
    } catch {
      // Still offline or the server is busy: the next reconnect tries again.
    }
  }

  /* ----------------------------------------------------------------------- from events and answers --- */

  /** A message arrived from the server (an event, or the answer to our own send). */
  function receive(message: Message): void {
    // A chat nobody has opened has no timeline to keep: its history is fetched when it is opened. A timeline that is
    // still loading takes the message too; merging by id means the page that arrives later does not duplicate it.
    const entry = timelines[message.chat_id]
    if (entry) entry.messages = mergeMessages(entry.messages, [message])
    chats.receiveMessage(message, auth.user?.id ?? '')
  }

  function receiveUpdate(message: Message): void {
    const entry = timelines[message.chat_id]
    if (entry) entry.messages = mergeMessages(entry.messages, [message])
    if (chats.get(message.chat_id)?.latest_message?.id === message.id) chats.refreshPreview(message.chat_id)
  }

  function receiveDeleted(chatId: string, messageId: string): void {
    const entry = timelines[chatId]
    if (entry) {
      // Replies that quoted it now say the original is gone (the server does the same: `reply_to.is_deleted`).
      entry.messages = withoutMessage(entry.messages, messageId).map((message) =>
        message.reply_to_id === messageId && message.reply_to
          ? { ...message, reply_to: { ...message.reply_to, is_deleted: true, content: null } }
          : message,
      )
    }
    if (chats.get(chatId)?.latest_message?.id === messageId) chats.refreshPreview(chatId)
  }

  /** An image or audio link stopped working (they last 60 minutes): ask for the message again, once. */
  async function refreshAttachment(message: Message): Promise<void> {
    if (refreshedAttachments.has(message.id)) return
    refreshedAttachments.add(message.id)

    try {
      receiveUpdate(await messagesApi.getMessage(message.id))
    } catch {
      // The file may really be gone; the message keeps showing its fallback.
    }
  }

  /* --------------------------------------------------------------------------------------- send --- */

  function replyPreview(chatId: string, replyToId: string | null) {
    if (!replyToId) return null
    const original = timelines[chatId]?.messages.find((message) => message.id === replyToId)
    if (!original) return null
    return {
      id: original.id,
      sender_id: original.sender_id,
      type: original.type,
      content: original.content ? original.content.slice(0, 140) : null,
      is_deleted: false,
    }
  }

  /** What the message looks like on screen before the server has answered. */
  function optimisticMessage(chatId: string, clientId: string, draft: SendDraft): TimelineMessage {
    const me = auth.user!
    let attachment = null
    if (draft.file) {
      const preview = URL.createObjectURL(draft.file)
      localPreviews.set(clientId, preview)
      attachment = {
        id: `local:${clientId}`,
        original_name: draft.file.name,
        mime_type: draft.file.type,
        size: draft.file.size,
        url: preview,
        thumbnail_url: draft.type === 'image' ? preview : null,
        created_at: new Date().toISOString(),
      }
    }

    return {
      id: `pending:${clientId}`,
      chat_id: chatId,
      sender: toPublicUser(me),
      sender_id: me.id,
      type: draft.type,
      content: draft.content || null,
      reply_to_id: draft.replyToId,
      reply_to: replyPreview(chatId, draft.replyToId),
      client_id: clientId,
      is_edited: false,
      edited_at: null,
      metadata: {},
      encrypted: false,
      attachment,
      created_at: new Date().toISOString(),
      pending: { status: 'sending', clientId, progress: draft.file ? 0 : null, error: null, draft: { ...draft } },
    }
  }

  function findPending(chatId: string, clientId: string): (TimelineMessage & { pending: PendingInfo }) | undefined {
    const found = timelines[chatId]?.messages.find((message) => message.pending?.clientId === clientId)
    return found?.pending ? (found as TimelineMessage & { pending: PendingInfo }) : undefined
  }

  function releasePreview(clientId: string): void {
    const url = localPreviews.get(clientId)
    if (url) URL.revokeObjectURL(url)
    localPreviews.delete(clientId)
    uploads.delete(clientId)
  }

  /** Tries a send a few times when the network is the problem, so a bad moment does not turn into a failed message. */
  async function sendWithRetries(chatId: string, body: messagesApi.OutgoingMessage): Promise<Message> {
    for (let attempt = 0; ; attempt++) {
      try {
        return (await messagesApi.sendMessage(chatId, body)).message
      } catch (problem) {
        const error = toApiError(problem)
        const delay = SEND_RETRY_DELAYS_MS[attempt]
        if (delay === undefined || !retryable(error)) throw error
        await wait(delay)
      }
    }
  }

  /**
   * One delivery attempt for a message that is on screen: upload the file (once), then send. The `client_id` stays the
   * same through every attempt, so a send that reached the server but whose answer was lost is not duplicated.
   */
  async function deliver(chatId: string, clientId: string): Promise<void> {
    const entry = findPending(chatId, clientId)
    if (!entry) return

    const pending = entry.pending
    pending.status = 'sending'
    pending.error = null

    try {
      const { draft } = pending

      if (draft.file && !draft.attachmentId) {
        const controller = new AbortController()
        uploads.set(clientId, controller)
        pending.progress = 0
        const attachment = await uploadAttachment(chatId, draft.file, {
          signal: controller.signal,
          onProgress: (percent) => {
            const current = findPending(chatId, clientId)
            if (current) current.pending.progress = percent
          },
        })
        draft.attachmentId = attachment.id
        pending.progress = 100
      }

      const message = await sendWithRetries(chatId, {
        client_id: clientId,
        type: draft.type,
        ...(draft.content ? { content: draft.content } : {}),
        ...(draft.replyToId ? { reply_to_id: draft.replyToId } : {}),
        ...(draft.attachmentId ? { metadata: { attachment_id: draft.attachmentId } } : {}),
      })

      releasePreview(clientId)
      receive({ ...message, client_id: message.client_id ?? clientId })
    } catch (problem) {
      const current = findPending(chatId, clientId)
      if (!current) return // discarded while it was going up

      const error = toApiError(problem)
      current.pending.status = 'failed'
      current.pending.progress = null
      current.pending.error = error
    }
  }

  /** The person pressed send: show the message at once, then deliver it. */
  async function send(chatId: string, input: Omit<SendDraft, 'attachmentId'>): Promise<void> {
    const entry = ensureTimeline(chatId)
    const clientId = uuid()
    entry.messages = [...entry.messages, optimisticMessage(chatId, clientId, { ...input, attachmentId: null })]
    await deliver(chatId, clientId)
  }

  /** "Tap to retry": the same message, with the same `client_id`. */
  async function retry(chatId: string, clientId: string): Promise<void> {
    await deliver(chatId, clientId)
  }

  /** Gives up on a message that failed (or stops one that is still going up). */
  function discard(chatId: string, clientId: string): void {
    uploads.get(clientId)?.abort()
    releasePreview(clientId)

    const entry = timelines[chatId]
    if (entry) entry.messages = entry.messages.filter((message) => message.pending?.clientId !== clientId)
  }

  /* ------------------------------------------------------------------------ edit and delete --- */

  async function edit(message: Message, content: string): Promise<void> {
    receiveUpdate(await messagesApi.editMessage(message.id, content))
  }

  async function remove(message: Message): Promise<void> {
    await messagesApi.deleteMessage(message.id)
    receiveDeleted(message.chat_id, message.id)
  }

  function forget(chatId: string): void {
    delete timelines[chatId]
  }

  function reset(): void {
    for (const key of Object.keys(timelines)) delete timelines[key]
    for (const url of localPreviews.values()) URL.revokeObjectURL(url)
    localPreviews.clear()
    uploads.forEach((controller) => controller.abort())
    uploads.clear()
    refreshedAttachments.clear()
  }

  return {
    timelines,
    timeline,
    ensureTimeline,
    loadInitial,
    ensureLoaded,
    loadOlder,
    resync,
    receive,
    receiveUpdate,
    receiveDeleted,
    refreshAttachment,
    send,
    retry,
    discard,
    edit,
    remove,
    forget,
    reset,
  }
})

