import type { Message, TimelineMessage } from '@/types/chat'

/** Messages sort by `(created_at, id)`, oldest first (docs/API.md, 1.4). Ids are UUIDv7, so they break ties in time order. */
export function compareMessages(a: Message, b: Message): number {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

const isPending = (message: TimelineMessage): boolean => message.pending !== undefined

/**
 * Which copy of the same message is the fresher one. Events can arrive twice or out of order, so a late
 * `message.sent` must not undo an edit that was already applied.
 */
function fresher(existing: TimelineMessage, incoming: Message): Message {
  if (existing.edited_at && (!incoming.edited_at || incoming.edited_at < existing.edited_at)) {
    const { pending: _pending, ...confirmed } = existing
    return { ...incoming, ...confirmed }
  }
  return incoming
}

/**
 * Puts messages into a conversation. The same message may arrive several times (the REST answer, `message.sent` on two
 * channels, a page fetched after a reconnect): it is kept once, found by `id`. A message of your own that is still
 * "sending" is matched to its confirmed copy by `client_id` and replaced by it. Confirmed messages come out sorted,
 * oldest first, followed by the ones still on their way, in the order they were sent.
 */
export function mergeMessages(existing: TimelineMessage[], incoming: Message[]): TimelineMessage[] {
  const confirmed = new Map<string, TimelineMessage>()
  let pending = existing.filter(isPending)
  for (const message of existing) if (!isPending(message)) confirmed.set(message.id, message)

  for (const message of incoming) {
    if (message.client_id) pending = pending.filter((entry) => entry.pending?.clientId !== message.client_id)

    const known = confirmed.get(message.id)
    if (known) {
      const winner = fresher(known, message)
      // Events never carry `client_id`; keep the one we already learned from the REST answer.
      const clientId = winner.client_id ?? known.client_id
      confirmed.set(message.id, clientId ? { ...winner, client_id: clientId } : { ...winner })
    } else {
      confirmed.set(message.id, { ...message })
    }
  }

  return [...confirmed.values()].sort(compareMessages).concat(pending)
}

export interface Reconciled {
  messages: TimelineMessage[]
  /** True when there was nothing in common with what we had, so the old list was thrown away. */
  replaced: boolean
}

/**
 * After a reconnect: fold the freshest page (the newest messages) into what is on screen.
 * - Messages in the page are added or updated.
 * - Messages we show that are as new as the oldest one in the page, but are missing from it, were deleted meanwhile.
 * - If the page shares nothing with what we have, more happened than one page can show and there is a hole in
 *   between; the old list is dropped (pagination starts again from this page) rather than leaving the hole.
 * Messages that are still "sending" are always kept.
 */
export function reconcileFirstPage(existing: TimelineMessage[], page: Message[]): Reconciled {
  const confirmed = existing.filter((message) => !isPending(message))
  const pending = existing.filter(isPending)
  const pageIds = new Set(page.map((message) => message.id))

  if (page.length === 0) return { messages: pending, replaced: confirmed.length > 0 }

  if (confirmed.length > 0 && !confirmed.some((message) => pageIds.has(message.id))) {
    return { messages: mergeMessages(pending, page), replaced: true }
  }

  const oldest = [...page].sort(compareMessages)[0] as Message
  const kept = confirmed.filter((message) => pageIds.has(message.id) || compareMessages(message, oldest) < 0)

  return { messages: mergeMessages([...kept, ...pending], page), replaced: false }
}

export function withoutMessage(messages: TimelineMessage[], id: string): TimelineMessage[] {
  return messages.filter((message) => message.id !== id)
}

/**
 * Whether there is something to report as read: a message from someone else (not a system notice) that comes after the
 * read position. Your own messages never count as unread, so a chat that ends with your own message needs no report.
 * If the position is not among the messages we hold, it is older than all of them: anything from others is unread.
 */
export function hasUnreadFromOthers(messages: TimelineMessage[], lastReadId: string | null, meId: string): boolean {
  const start = lastReadId ? messages.findIndex((message) => message.id === lastReadId) + 1 : 0
  return messages
    .slice(start)
    .some((message) => !isPending(message) && message.type !== 'system' && message.sender_id !== meId)
}

/** The newest message the server has confirmed (what "read up to here" refers to), if any. */
export function newestConfirmed(messages: TimelineMessage[]): TimelineMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message && !isPending(message)) return message
  }
  return undefined
}
