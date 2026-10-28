// Ported from frontend/src/utils/__tests__/timeline.spec.ts.

import { ME, makeMessage } from '@/testing/factories'
import type { TimelineMessage } from '@/types/chat'
import { buildTimeline, messageKey } from '@/utils/timeline'

const at = (iso: string, over = {}) => makeMessage({ created_at: iso, ...over })
const options = { meId: ME, timeZone: 'UTC' }
const kinds = (messages: TimelineMessage[], opts = options) => buildTimeline(messages, opts).map((item) => item.kind)

describe('buildTimeline', () => {
  it('puts a day line before the first message and again whenever the day changes', () => {
    const items = buildTimeline(
      [at('2026-03-14T09:00:00.000000Z'), at('2026-03-14T10:00:00.000000Z'), at('2026-03-15T09:00:00.000000Z')],
      options,
    )

    expect(items.map((i) => i.kind)).toEqual(['day', 'message', 'message', 'day', 'message'])
  })

  it('draws the day boundary in the person’s time zone, not UTC', () => {
    // 20:00 UTC on the 14th is 03:00 on the 15th in Bangkok: the next calendar day
    const late = [at('2026-03-14T10:00:00.000000Z'), at('2026-03-14T20:00:00.000000Z')]

    expect(kinds(late, { meId: ME, timeZone: 'UTC' })).toEqual(['day', 'message', 'message'])
    expect(kinds(late, { meId: ME, timeZone: 'Asia/Bangkok' })).toEqual(['day', 'message', 'day', 'message'])
  })

  it('groups consecutive messages by the same person, and tells which is first and last in the run', () => {
    const items = buildTimeline(
      [at('2026-03-14T09:00:00.000000Z'), at('2026-03-14T09:01:00.000000Z'), at('2026-03-14T09:02:00.000000Z')],
      options,
    ).filter((i) => i.kind === 'message')

    expect(items.map((i) => i.kind === 'message' && [i.firstInGroup, i.lastInGroup])).toEqual([
      [true, false],
      [false, false],
      [false, true],
    ])
  })

  it('starts a new run when the person changes, or after a pause of 5 minutes or more', () => {
    const items = buildTimeline(
      [
        at('2026-03-14T09:00:00.000000Z'),
        at('2026-03-14T09:00:30.000000Z', { sender_id: ME }),
        at('2026-03-14T09:01:00.000000Z', { sender_id: ME }),
        at('2026-03-14T09:10:00.000000Z', { sender_id: ME }),
      ],
      options,
    ).filter((i) => i.kind === 'message')

    expect(items.map((i) => i.kind === 'message' && [i.firstInGroup, i.lastInGroup])).toEqual([
      [true, true], // someone else, alone
      [true, false], // mine
      [false, true], // mine, within a minute
      [true, true], // mine again, 9 minutes later
    ])
  })

  it('marks which messages are yours', () => {
    const [mine, theirs] = buildTimeline(
      [at('2026-03-14T09:00:00.000000Z', { sender_id: ME }), at('2026-03-14T09:20:00.000000Z')],
      options,
    ).filter((i) => i.kind === 'message')

    expect(mine?.kind === 'message' && mine.own).toBe(true)
    expect(theirs?.kind === 'message' && theirs.own).toBe(false)
  })

  it('shows system messages as notices that break a run', () => {
    const items = buildTimeline(
      [
        at('2026-03-14T09:00:00.000000Z'),
        at('2026-03-14T09:00:10.000000Z', { type: 'system', sender_id: null, sender: null }),
        at('2026-03-14T09:00:20.000000Z'),
      ],
      options,
    )

    expect(items.map((i) => i.kind)).toEqual(['day', 'message', 'system', 'message'])
    const before = items[1]
    const after = items[3]
    expect(before?.kind === 'message' && before.lastInGroup).toBe(true)
    expect(after?.kind === 'message' && after.firstInGroup).toBe(true)
  })

  it('does not group across midnight', () => {
    const items = buildTimeline([at('2026-03-14T23:59:00.000000Z'), at('2026-03-15T00:00:30.000000Z')], options).filter(
      (i) => i.kind === 'message',
    )

    expect(items.map((i) => i.kind === 'message' && [i.firstInGroup, i.lastInGroup])).toEqual([
      [true, true],
      [true, true],
    ])
  })

  it('is empty for no messages', () => {
    expect(buildTimeline([], options)).toEqual([])
  })
})

describe('messageKey', () => {
  it('stays the same when a message goes from "sending" to "sent", so its bubble is not redrawn', () => {
    const sending = {
      ...at('2026-03-14T09:00:00.000000Z', { id: 'pending:c1', client_id: 'c1' }),
      pending: {
        status: 'sending' as const,
        clientId: 'c1',
        progress: null,
        error: null,
        draft: { type: 'text' as const, content: 'x', replyToId: null, file: null, attachmentId: null },
      },
    }
    const sent = at('2026-03-14T09:00:01.000000Z', { id: 'real-id', client_id: 'c1' })

    expect(messageKey(sending)).toBe(messageKey(sent))
  })

  it('is the id for messages from other people', () => {
    const message = at('2026-03-14T09:00:00.000000Z', { id: 'abc' })
    expect(messageKey(message)).toBe('abc')
  })
})
