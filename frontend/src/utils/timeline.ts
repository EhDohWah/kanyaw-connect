import { dayKey } from '@/utils/dates'
import type { TimelineMessage } from '@/types/chat'

export interface TimelineOptions {
  meId: string
  timeZone: string
  /** Messages by the same person closer together than this share a group. */
  groupGapMs?: number
}

export type TimelineItem =
  | { kind: 'day'; key: string; iso: string }
  | { kind: 'system'; key: string; message: TimelineMessage }
  | {
      kind: 'message'
      key: string
      message: TimelineMessage
      own: boolean
      /** First bubble of a run by one person: the name goes above it (groups). */
      firstInGroup: boolean
      /** Last bubble of a run: the time goes below it, and the avatar beside it. */
      lastInGroup: boolean
    }

const FIVE_MINUTES = 5 * 60 * 1000

/** The key a message keeps for its whole life, so a bubble does not flicker when "sending" becomes "sent". */
export function messageKey(message: TimelineMessage): string {
  return message.client_id ?? message.pending?.clientId ?? message.id
}

/**
 * Turns the messages (oldest first) into what is drawn: a line at each new day, centered notices for system messages,
 * and bubbles grouped into runs by the same person.
 */
export function buildTimeline(messages: TimelineMessage[], options: TimelineOptions): TimelineItem[] {
  const gap = options.groupGapMs ?? FIVE_MINUTES
  const items: TimelineItem[] = []
  let currentDay = ''

  const sameRun = (a: TimelineMessage | undefined, b: TimelineMessage | undefined): boolean =>
    Boolean(
      a &&
        b &&
        a.type !== 'system' &&
        b.type !== 'system' &&
        a.sender_id === b.sender_id &&
        dayKey(a.created_at, options.timeZone) === dayKey(b.created_at, options.timeZone) &&
        Math.abs(Date.parse(b.created_at) - Date.parse(a.created_at)) < gap,
    )

  messages.forEach((message, index) => {
    const day = dayKey(message.created_at, options.timeZone)
    if (day !== currentDay) {
      currentDay = day
      items.push({ kind: 'day', key: `day:${day}`, iso: message.created_at })
    }

    if (message.type === 'system') {
      items.push({ kind: 'system', key: messageKey(message), message })
      return
    }

    items.push({
      kind: 'message',
      key: messageKey(message),
      message,
      own: message.sender_id === options.meId,
      firstInGroup: !sameRun(messages[index - 1], message),
      lastInGroup: !sameRun(message, messages[index + 1]),
    })
  })

  return items
}
