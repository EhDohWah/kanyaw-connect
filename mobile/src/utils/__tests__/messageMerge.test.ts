// Ported from frontend/src/utils/__tests__/messageMerge.spec.ts.

import { ME, makeMessage } from '@/testing/factories'
import type { TimelineMessage } from '@/types/chat'
import {
  compareMessages,
  hasUnreadFromOthers,
  mergeMessages,
  newestConfirmed,
  reconcileFirstPage,
  withoutMessage,
} from '@/utils/messageMerge'

const pendingMessage = (clientId: string, content = 'on its way'): TimelineMessage => ({
  ...makeMessage({
    id: `pending:${clientId}`,
    sender_id: ME,
    content,
    client_id: clientId,
    created_at: '2099-01-01T00:00:00.000000Z',
  }),
  pending: {
    status: 'sending',
    clientId,
    progress: null,
    error: null,
    draft: { type: 'text', content, replyToId: null, file: null, attachmentId: null },
  },
})

const contents = (messages: TimelineMessage[]) => messages.map((message) => message.content)

describe('compareMessages', () => {
  it('orders by time, then by id for the same moment', () => {
    const a = makeMessage({ created_at: '2026-03-14T09:00:00.000000Z', id: 'a' })
    const b = makeMessage({ created_at: '2026-03-14T09:00:00.000000Z', id: 'b' })
    const c = makeMessage({ created_at: '2026-03-14T09:00:01.000000Z', id: '0' })

    expect([c, b, a].sort(compareMessages).map((m) => m.id)).toEqual(['a', 'b', '0'])
  })
})

describe('mergeMessages', () => {
  it('keeps a message once however many times it arrives (REST answer, two channels, a refetched page)', () => {
    const message = makeMessage({ content: 'Hello' })

    const once = mergeMessages([], [message])
    const twice = mergeMessages(once, [message, message])
    const again = mergeMessages(twice, [{ ...message }])

    expect(again).toHaveLength(1)
    expect(again[0]?.content).toBe('Hello')
  })

  it('sorts by time whatever order they arrive in', () => {
    const [first, second, third] = [makeMessage(), makeMessage(), makeMessage()]

    expect(mergeMessages([], [third, first, second]).map((m) => m.id)).toEqual([first.id, second.id, third.id])
  })

  it('adds a page of older messages in front, without touching the newer ones (pagination)', () => {
    const older = [makeMessage(), makeMessage(), makeMessage()]
    const newer = [makeMessage(), makeMessage()]

    const onScreen = mergeMessages([], newer)
    const after = mergeMessages(onScreen, older)

    expect(after.map((m) => m.id)).toEqual([...older, ...newer].map((m) => m.id))
  })

  it('lets a page overlap what is already there without duplicating it', () => {
    const all = [makeMessage(), makeMessage(), makeMessage(), makeMessage()]
    const onScreen = mergeMessages([], all.slice(2))

    expect(mergeMessages(onScreen, all.slice(0, 3))).toHaveLength(4)
  })

  it('replaces a message of your own that is still "sending" with its confirmed copy, found by client_id', () => {
    const earlier = makeMessage()
    const sending = pendingMessage('client-1', 'Hi')
    const confirmed = makeMessage({ sender_id: ME, content: 'Hi', client_id: 'client-1' })

    const result = mergeMessages([earlier, sending], [confirmed])

    expect(result).toHaveLength(2)
    expect(result.some((m) => m.pending)).toBe(false)
    expect(result[1]?.id).toBe(confirmed.id)
  })

  it('does not lose the client_id when the same message later arrives as an event, which never has one', () => {
    const confirmed = makeMessage({ sender_id: ME, client_id: 'client-1' })
    const { client_id: _unused, ...event } = confirmed

    const result = mergeMessages(mergeMessages([], [confirmed]), [event])

    expect(result).toHaveLength(1)
    expect(result[0]?.client_id).toBe('client-1')
  })

  it('handles the event arriving before the REST answer: no duplicate, the sending copy still goes away', () => {
    const sending = pendingMessage('client-1', 'Hi')
    const { client_id: _unused, ...event } = makeMessage({ sender_id: ME, content: 'Hi', client_id: 'client-1' })

    const afterEvent = mergeMessages([sending], [event])
    expect(afterEvent).toHaveLength(2) // the event cannot say it is the same message: it has no client_id

    const afterAnswer = mergeMessages(afterEvent, [{ ...event, client_id: 'client-1' }])
    expect(afterAnswer).toHaveLength(1)
    expect(afterAnswer[0]?.pending).toBeUndefined()
  })

  it('shows messages still on their way after all confirmed ones, in the order they were sent', () => {
    const result = mergeMessages(
      [pendingMessage('a', 'first'), pendingMessage('b', 'second')],
      [makeMessage({ content: 'confirmed' })],
    )

    expect(contents(result)).toEqual(['confirmed', 'first', 'second'])
  })

  it('does not let a late "message.sent" undo an edit that was already applied', () => {
    const original = makeMessage({ content: 'Original' })
    const edited = { ...original, content: 'Edited', is_edited: true, edited_at: '2026-03-14T09:30:00.000000Z' }

    const result = mergeMessages(mergeMessages([], [edited]), [original])

    expect(result[0]?.content).toBe('Edited')
    expect(result[0]?.is_edited).toBe(true)
  })

  it('applies a newer edit over an older one', () => {
    const first = { ...makeMessage(), content: 'v1', is_edited: true, edited_at: '2026-03-14T09:30:00.000000Z' }
    const second = { ...first, content: 'v2', edited_at: '2026-03-14T09:31:00.000000Z' }

    expect(mergeMessages(mergeMessages([], [first]), [second])[0]?.content).toBe('v2')
  })

  it('does not change the list it was given', () => {
    const existing = mergeMessages([], [makeMessage()])
    const copy = JSON.stringify(existing)
    mergeMessages(existing, [makeMessage()])

    expect(JSON.stringify(existing)).toBe(copy)
  })
})

describe('reconcileFirstPage (after a reconnect)', () => {
  const thread = (n: number) => Array.from({ length: n }, () => makeMessage())

  it('adds what arrived while offline', () => {
    const known = thread(5)
    const missed = thread(2)

    const { messages, replaced } = reconcileFirstPage(known, [...known.slice(2), ...missed])

    expect(replaced).toBe(false)
    expect(messages.map((m) => m.id)).toEqual([...known, ...missed].map((m) => m.id))
  })

  it('removes messages that were deleted meanwhile, but only inside the range the page covers', () => {
    const all = thread(6)
    const [oldest, , deleted] = [all[0]!, all[1]!, all[3]!]
    // the page holds the newest four (indexes 2..5) minus the deleted one (index 3)
    const page = [all[2]!, all[4]!, all[5]!]

    const { messages } = reconcileFirstPage(all, page)

    expect(messages.map((m) => m.id)).not.toContain(deleted.id)
    expect(messages.map((m) => m.id)).toContain(oldest.id) // older than the page: cannot say, so it stays
    expect(messages).toHaveLength(5)
  })

  it('updates an edited message', () => {
    const known = thread(3)
    const edited = { ...known[2]!, content: 'edited', is_edited: true, edited_at: '2026-03-14T10:00:00.000000Z' }

    const { messages } = reconcileFirstPage(known, [known[1]!, edited])

    expect(messages.at(-1)?.content).toBe('edited')
  })

  it('throws the old list away when the page shares nothing with it (a hole in between)', () => {
    const old = thread(5)
    const fresh = thread(5)

    const { messages, replaced } = reconcileFirstPage(old, fresh)

    expect(replaced).toBe(true)
    expect(messages.map((m) => m.id)).toEqual(fresh.map((m) => m.id))
  })

  it('keeps messages that are still being sent', () => {
    const known = thread(2)
    const result = reconcileFirstPage([...known, pendingMessage('x', 'sending')], known)

    expect(result.messages.at(-1)?.pending?.clientId).toBe('x')
  })

  it('empties the conversation when the page is empty (everything was deleted)', () => {
    expect(reconcileFirstPage(thread(3), []).messages).toEqual([])
  })

  it('takes the page as it is when nothing was loaded yet', () => {
    const page = thread(3)
    const { messages, replaced } = reconcileFirstPage([], page)

    expect(replaced).toBe(false)
    expect(messages).toHaveLength(3)
  })
})

describe('small helpers', () => {
  it('withoutMessage removes by id', () => {
    const [a, b] = [makeMessage(), makeMessage()]
    expect(withoutMessage([a, b], a.id).map((m) => m.id)).toEqual([b.id])
  })

  it('newestConfirmed skips messages that are still on their way', () => {
    const confirmed = makeMessage()
    expect(newestConfirmed([confirmed, pendingMessage('x')])?.id).toBe(confirmed.id)
    expect(newestConfirmed([pendingMessage('x')])).toBeUndefined()
    expect(newestConfirmed([])).toBeUndefined()
  })

  describe('hasUnreadFromOthers', () => {
    const mine = () => makeMessage({ sender_id: ME })
    const theirs = () => makeMessage()

    it('is true when someone else wrote something after the read position', () => {
      const [a, b, c] = [theirs(), mine(), theirs()]
      expect(hasUnreadFromOthers([a, b, c], a.id, ME)).toBe(true)
    })

    it('is false when only your own messages follow it', () => {
      const [a, b, c] = [theirs(), mine(), mine()]
      expect(hasUnreadFromOthers([a, b, c], a.id, ME)).toBe(false)
    })

    it('is false when the read position is the newest message', () => {
      const [a, b] = [mine(), theirs()]
      expect(hasUnreadFromOthers([a, b], b.id, ME)).toBe(false)
    })

    it('ignores system notices and messages still being sent', () => {
      const [a, notice] = [theirs(), makeMessage({ type: 'system', sender_id: null, sender: null })]
      expect(hasUnreadFromOthers([a, notice, pendingMessage('x')], a.id, ME)).toBe(false)
    })

    it('treats everything as unread when the read position is not among the loaded messages, or unknown', () => {
      const [a, b] = [theirs(), theirs()]
      expect(hasUnreadFromOthers([a, b], 'older-than-all-of-these', ME)).toBe(true)
      expect(hasUnreadFromOthers([a, b], null, ME)).toBe(true)
      expect(hasUnreadFromOthers([], null, ME)).toBe(false)
    })
  })
})
