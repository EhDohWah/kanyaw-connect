// Ported from frontend/src/stores/messages.ts (Pinia) to Zustand: the same rules, with immutable updates. The phone's
// differences: a file to send is a local file (its URI is also the preview, nothing to release), and answers that
// arrive after sign-out are dropped.
import { create } from 'zustand'

import { uploadAttachment } from '@/api/attachments'
import { toApiError, type ApiError } from '@/api/errors'
import * as messagesApi from '@/api/messages'
import { useAuthStore } from '@/stores/auth'
import { useChatsStore } from '@/stores/chats'
import { useDraftsStore } from '@/stores/drafts'
import type { Message, PendingInfo, ReplyPreview, SendDraft, TimelineMessage } from '@/types/chat'
import { mergeMessages, reconcileFirstPage, withoutMessage } from '@/utils/messageMerge'
import { uuid } from '@/utils/uuid'

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
export const SEND_RETRY_DELAYS_MS = [800, 2500]

/** Attachment links are refreshed at most this often per message, so a file that is really gone does not cause a
 *  stream of requests. */
export const LINK_REFRESH_GAP_MS = 5 * 60 * 1000

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const retryable = (error: ApiError): boolean => error.isNetwork || error.status >= 500

/** The API lists newest first; the conversation reads oldest first. */
const oldestFirst = (page: Message[]): Message[] => [...page].reverse()

function emptyTimeline(): ChatTimeline {
  return { messages: [], nextUrl: null, status: 'loading', error: null, loadingOlder: false, olderError: null }
}

/** Uploads that can be cancelled when the person discards a message. */
const uploads = new Map<string, AbortController>()
const refreshedAttachments = new Map<string, number>()
/** Messages known to be deleted. A late copy (an event on its way, a retry's answer) must not bring one back. */
const deletedIds = new Set<string>()
/** Each sign-in session gets a number; work started in an earlier one changes nothing. */
let session = 0

interface MessagesState {
  timelines: Record<string, ChatTimeline>

  timeline(chatId: string): ChatTimeline | undefined
  loadInitial(chatId: string): Promise<void>
  /** Opens a chat's history once; later visits show what is already there (events keep it current). */
  ensureLoaded(chatId: string): Promise<void>
  loadOlder(chatId: string): Promise<void>
  /** After a reconnect or coming back to the app: fold the newest page into what is on screen. */
  resync(chatId: string): Promise<void>

  /** A message arrived from the server (an event, or the answer to our own send). */
  receive(message: Message): void
  receiveUpdate(message: Message): void
  receiveDeleted(chatId: string, messageId: string): void
  /** An attachment link stopped working (they last 60 minutes): ask for the message again, with fresh links. */
  refreshAttachment(message: Message): Promise<void>

  /** The person pressed send: show the message at once, then deliver it. */
  send(chatId: string, input: Omit<SendDraft, 'attachmentId'>): Promise<void>
  /** "Tap to retry": the same message, with the same `client_id`. */
  retry(chatId: string, clientId: string): Promise<void>
  /** Gives up on a message that failed (or stops one that is still going up). */
  discard(chatId: string, clientId: string): void

  edit(message: Message, content: string): Promise<void>
  remove(message: Message): Promise<void>
  forget(chatId: string): void
  reset(): void
}

export const useMessagesStore = create<MessagesState>()((set, get) => {
  const notDeleted = (list: Message[]): Message[] => list.filter((message) => !deletedIds.has(message.id))

  function patch(chatId: string, change: (timeline: ChatTimeline) => Partial<ChatTimeline>): void {
    const timeline = get().timelines[chatId]
    if (!timeline) return
    set({ timelines: { ...get().timelines, [chatId]: { ...timeline, ...change(timeline) } } })
  }

  function ensureTimeline(chatId: string): void {
    if (!get().timelines[chatId]) set({ timelines: { ...get().timelines, [chatId]: emptyTimeline() } })
  }

  function findPending(chatId: string, clientId: string): (TimelineMessage & { pending: PendingInfo }) | undefined {
    const found = get().timelines[chatId]?.messages.find((message) => message.pending?.clientId === clientId)
    return found?.pending ? (found as TimelineMessage & { pending: PendingInfo }) : undefined
  }

  /** Changes the "on its way" state of one message (a copy, so the screen sees the change). */
  function patchPending(
    chatId: string,
    clientId: string,
    change: (pending: PendingInfo) => Partial<PendingInfo>,
  ): void {
    patch(chatId, (timeline) => ({
      messages: timeline.messages.map((message) =>
        message.pending?.clientId === clientId
          ? { ...message, pending: { ...message.pending, ...change(message.pending) } }
          : message,
      ),
    }))
  }

  function replyPreview(chatId: string, replyToId: string | null): ReplyPreview | null {
    if (!replyToId) return null
    const original = get().timelines[chatId]?.messages.find((message) => message.id === replyToId)
    if (!original) return null
    return {
      id: original.id,
      sender_id: original.sender_id,
      type: original.type,
      content: original.content ? original.content.slice(0, 140) : null,
      is_deleted: false,
    }
  }

  /** A recorded voice message's length and waveform, as the API takes them (voice messages only). */
  function voiceMetadata(draft: SendDraft): { duration_ms?: number; waveform?: number[] } {
    if (draft.type !== 'voice' || !draft.voice) return {}
    return { duration_ms: Math.round(draft.voice.durationMs), waveform: draft.voice.waveform }
  }

  /** What the message looks like on screen before the server has answered. */
  function optimisticMessage(chatId: string, clientId: string, draft: SendDraft): TimelineMessage {
    const me = useAuthStore.getState().user
    const now = new Date().toISOString()
    return {
      id: `pending:${clientId}`,
      chat_id: chatId,
      sender: me
        ? { id: me.id, name: me.name, avatar_url: me.avatar_url, avatar_thumb_url: me.avatar_thumb_url }
        : null,
      sender_id: me?.id ?? null,
      type: draft.type,
      content: draft.content || null,
      reply_to_id: draft.replyToId,
      reply_to: replyPreview(chatId, draft.replyToId),
      client_id: clientId,
      is_edited: false,
      edited_at: null,
      // A voice message plays from the recording at once, with its length and waveform.
      metadata: draft.voice ? { duration_ms: draft.voice.durationMs, waveform: draft.voice.waveform } : {},
      encrypted: false,
      // The local file is the preview: an image shows from it, a voice message plays from it.
      attachment: draft.file
        ? {
            id: `local:${clientId}`,
            original_name: draft.file.name,
            mime_type: draft.file.mimeType,
            size: draft.file.size ?? 0,
            url: draft.file.uri,
            thumbnail_url: draft.type === 'image' ? draft.file.uri : null,
            created_at: now,
          }
        : null,
      created_at: now,
      pending: { status: 'sending', clientId, progress: draft.file ? 0 : null, error: null, draft: { ...draft } },
    }
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
   * One delivery attempt for a message on screen: upload the file (once), then send. The `client_id` stays the same
   * through every attempt, so a send that reached the server but whose answer was lost is not duplicated.
   */
  async function deliver(chatId: string, clientId: string): Promise<void> {
    const entry = findPending(chatId, clientId)
    if (!entry) return
    const mine = session

    patchPending(chatId, clientId, () => ({ status: 'sending', error: null }))

    try {
      const draft = { ...entry.pending.draft }

      if (draft.file && !draft.attachmentId) {
        const controller = new AbortController()
        uploads.set(clientId, controller)
        patchPending(chatId, clientId, () => ({ progress: 0 }))
        const attachment = await uploadAttachment(chatId, draft.file, {
          signal: controller.signal,
          onProgress: (percent) => {
            if (mine === session) patchPending(chatId, clientId, () => ({ progress: percent }))
          },
        })
        if (mine !== session) return
        draft.attachmentId = attachment.id
        // Remember the upload, so a retry after a failed send does not upload the file again.
        patchPending(chatId, clientId, (pending) => ({
          progress: 100,
          draft: { ...pending.draft, attachmentId: attachment.id },
        }))
      }

      const message = await sendWithRetries(chatId, {
        client_id: clientId,
        type: draft.type,
        ...(draft.content ? { content: draft.content } : {}),
        ...(draft.replyToId ? { reply_to_id: draft.replyToId } : {}),
        ...(draft.attachmentId ? { metadata: { attachment_id: draft.attachmentId, ...voiceMetadata(draft) } } : {}),
      })
      if (mine !== session) return

      uploads.delete(clientId)
      get().receive({ ...message, client_id: message.client_id ?? clientId })
    } catch (problem) {
      uploads.delete(clientId)
      if (mine !== session || !findPending(chatId, clientId)) return // signed out, or discarded while going up

      const error = toApiError(problem)
      patchPending(chatId, clientId, () => ({ status: 'failed', progress: null, error }))
    }
  }

  return {
    timelines: {},

    timeline: (chatId) => get().timelines[chatId],

    /* -------------------------------------------------------------------------------- loading --- */

    async loadInitial(chatId) {
      const mine = session
      ensureTimeline(chatId)
      patch(chatId, () => ({ status: 'loading', error: null }))

      try {
        const page = await messagesApi.listMessages(chatId)
        if (mine !== session) return
        patch(chatId, (timeline) => ({
          messages: mergeMessages(timeline.messages, notDeleted(oldestFirst(page.data))),
          nextUrl: page.links.next,
          status: 'ready',
        }))
      } catch (problem) {
        if (mine === session) patch(chatId, () => ({ error: toApiError(problem), status: 'error' }))
      }
    },

    async ensureLoaded(chatId) {
      const timeline = get().timelines[chatId]
      if (!timeline || timeline.status === 'error') await get().loadInitial(chatId)
    },

    async loadOlder(chatId) {
      const timeline = get().timelines[chatId]
      if (!timeline?.nextUrl || timeline.loadingOlder) return

      const mine = session
      patch(chatId, () => ({ loadingOlder: true, olderError: null }))
      try {
        const page = await messagesApi.listMessages(chatId, timeline.nextUrl)
        if (mine !== session) return
        patch(chatId, (current) => ({
          messages: mergeMessages(current.messages, notDeleted(oldestFirst(page.data))),
          nextUrl: page.links.next,
        }))
      } catch (problem) {
        if (mine === session) patch(chatId, () => ({ olderError: toApiError(problem) }))
      } finally {
        if (mine === session) patch(chatId, () => ({ loadingOlder: false }))
      }
    },

    async resync(chatId) {
      const timeline = get().timelines[chatId]
      if (!timeline || timeline.status !== 'ready') return

      const mine = session
      try {
        const page = await messagesApi.listMessages(chatId)
        if (mine !== session) return
        patch(chatId, (current) => {
          const result = reconcileFirstPage(current.messages, notDeleted(oldestFirst(page.data)))
          return result.replaced
            ? { messages: result.messages, nextUrl: page.links.next }
            : { messages: result.messages }
        })
      } catch {
        // Still offline or the server is busy: the next reconnect tries again.
      }
    },

    /* ------------------------------------------------------------------- from events and answers --- */

    receive(message) {
      if (deletedIds.has(message.id)) return
      // A chat nobody has opened has no timeline to keep: its history is fetched when it is opened. A timeline that is
      // still loading takes the message too; merging by id means the page that arrives later does not duplicate it.
      patch(message.chat_id, (timeline) => ({ messages: mergeMessages(timeline.messages, [message]) }))
      useChatsStore.getState().receiveMessage(message, useAuthStore.getState().user?.id ?? '')
    },

    receiveUpdate(message) {
      if (deletedIds.has(message.id)) return
      patch(message.chat_id, (timeline) => ({ messages: mergeMessages(timeline.messages, [message]) }))
      const chats = useChatsStore.getState()
      if (chats.get(message.chat_id)?.latest_message?.id === message.id) chats.refreshPreview(message.chat_id)
    },

    receiveDeleted(chatId, messageId) {
      deletedIds.add(messageId)

      // The box must not keep editing or answering a message that is gone: an edit would go out as a new message, and
      // a reply would quote nothing the person can see.
      const drafts = useDraftsStore.getState()
      const draft = drafts.drafts[chatId]
      if (draft?.editingId === messageId) drafts.update(chatId, { editingId: null, text: '' })
      if (draft?.replyToId === messageId) drafts.update(chatId, { replyToId: null })

      // Replies that quoted it now say the original is gone (the server does the same: `reply_to.is_deleted`).
      patch(chatId, (timeline) => ({
        messages: withoutMessage(timeline.messages, messageId).map((message) =>
          message.reply_to_id === messageId && message.reply_to
            ? { ...message, reply_to: { ...message.reply_to, is_deleted: true, content: null } }
            : message,
        ),
      }))
      const chats = useChatsStore.getState()
      if (chats.get(chatId)?.latest_message?.id === messageId) chats.refreshPreview(chatId)
    },

    async refreshAttachment(message) {
      const last = refreshedAttachments.get(message.id)
      if (last !== undefined && Date.now() - last < LINK_REFRESH_GAP_MS) return
      refreshedAttachments.set(message.id, Date.now())

      const mine = session
      try {
        const fresh = await messagesApi.getMessage(message.id)
        if (mine === session) get().receiveUpdate(fresh)
      } catch {
        // The file may really be gone; the message keeps showing its fallback.
      }
    },

    /* ----------------------------------------------------------------------------------- send --- */

    async send(chatId, input) {
      ensureTimeline(chatId)
      const clientId = uuid()
      patch(chatId, (timeline) => ({
        messages: [...timeline.messages, optimisticMessage(chatId, clientId, { ...input, attachmentId: null })],
      }))
      await deliver(chatId, clientId)
    },

    retry: (chatId, clientId) => deliver(chatId, clientId),

    discard(chatId, clientId) {
      uploads.get(clientId)?.abort()
      uploads.delete(clientId)
      patch(chatId, (timeline) => ({
        messages: timeline.messages.filter((message) => message.pending?.clientId !== clientId),
      }))
    },

    /* ---------------------------------------------------------------------------- edit and delete --- */

    async edit(message, content) {
      get().receiveUpdate(await messagesApi.editMessage(message.id, content))
    },

    async remove(message) {
      await messagesApi.deleteMessage(message.id)
      get().receiveDeleted(message.chat_id, message.id)
    },

    forget(chatId) {
      const { [chatId]: _gone, ...rest } = get().timelines
      set({ timelines: rest })
      useDraftsStore.getState().clear(chatId)
    },

    reset() {
      session += 1
      uploads.forEach((controller) => controller.abort())
      uploads.clear()
      refreshedAttachments.clear()
      deletedIds.clear()
      set({ timelines: {} })
    },
  }
})
