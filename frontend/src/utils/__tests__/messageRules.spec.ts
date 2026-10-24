import { describe, expect, it } from 'vitest'

import { ME, PAW, makeChat, makeMessage } from '@/__tests__/helpers'
import type { TimelineMessage } from '@/types/chat'
import { availableActions } from '@/utils/messageActions'
import {
  EDIT_WINDOW_MS,
  canChangeRole,
  canCopy,
  canDeleteMessage,
  canEditMessage,
  canManageGroup,
  canRemoveMember,
  canReply,
} from '@/utils/messageRules'

const sentAt = Date.parse('2026-03-14T09:00:00.000000Z')
const mine = (over = {}) => makeMessage({ sender_id: ME, created_at: '2026-03-14T09:00:00.000000Z', ...over })

describe('editing', () => {
  it('lets you edit your own text for 24 hours', () => {
    expect(canEditMessage(mine(), ME, sentAt + 60_000)).toBe(true)
    expect(canEditMessage(mine(), ME, sentAt + EDIT_WINDOW_MS - 1)).toBe(true)
  })

  it('stops after 24 hours', () => {
    expect(canEditMessage(mine(), ME, sentAt + EDIT_WINDOW_MS)).toBe(false)
  })

  it('never lets you edit other people’s messages, pictures, files, system notices or encrypted messages', () => {
    expect(canEditMessage(makeMessage({ created_at: '2026-03-14T09:00:00.000000Z' }), ME, sentAt + 1000)).toBe(false)
    expect(canEditMessage(mine({ type: 'image' }), ME, sentAt + 1000)).toBe(false)
    expect(canEditMessage(mine({ type: 'file' }), ME, sentAt + 1000)).toBe(false)
    expect(canEditMessage(mine({ encrypted: true }), ME, sentAt + 1000)).toBe(false)
  })

  it('does not apply to a message that has not been sent yet', () => {
    const pending = { ...mine(), pending: { status: 'sending' as const, clientId: 'x', progress: null, error: null, draft: { type: 'text' as const, content: '', replyToId: null, file: null, attachmentId: null } } }
    expect(canEditMessage(pending, ME, sentAt + 1000)).toBe(false)
  })
})

describe('deleting', () => {
  const direct = makeChat()
  const group = (role: 'owner' | 'admin' | 'member') => makeChat({ type: 'group', my_membership: { ...makeChat().my_membership, role } })

  it('lets you delete your own messages anywhere', () => {
    expect(canDeleteMessage(mine(), ME, direct)).toBe(true)
    expect(canDeleteMessage(mine(), ME, group('member'))).toBe(true)
  })

  it('lets a group owner or admin delete anyone’s', () => {
    const theirs = makeMessage({ sender_id: PAW })
    expect(canDeleteMessage(theirs, ME, group('owner'))).toBe(true)
    expect(canDeleteMessage(theirs, ME, group('admin'))).toBe(true)
  })

  it('does not let a plain member, or anyone in a direct chat, delete other people’s', () => {
    const theirs = makeMessage({ sender_id: PAW })
    expect(canDeleteMessage(theirs, ME, group('member'))).toBe(false)
    expect(canDeleteMessage(theirs, ME, direct)).toBe(false)
  })

  it('never deletes system notices', () => {
    expect(canDeleteMessage(makeMessage({ type: 'system', sender_id: null, sender: null }), ME, group('owner'))).toBe(false)
  })
})

describe('reply and copy', () => {
  it('reply works for real messages, not system notices or encrypted ones', () => {
    expect(canReply(makeMessage())).toBe(true)
    expect(canReply(makeMessage({ type: 'system', sender_id: null, sender: null }))).toBe(false)
    expect(canReply(makeMessage({ encrypted: true }))).toBe(false)
  })

  it('copy needs some text', () => {
    expect(canCopy(makeMessage({ content: 'Hi' }))).toBe(true)
    expect(canCopy(makeMessage({ content: '   ' }))).toBe(false)
    expect(canCopy(makeMessage({ content: null, type: 'image' }))).toBe(false)
  })
})

describe('availableActions (what the menus offer)', () => {
  const keys = (message: TimelineMessage, chat = makeChat(), now = sentAt + 1000) => availableActions(message, chat, ME, now).map((a) => a.key)

  it('offers everything on your own recent text message', () => {
    expect(keys(mine())).toEqual(['reply', 'copy', 'edit', 'delete'])
  })

  it('offers only reply and copy on someone else’s message in a direct chat', () => {
    expect(keys(makeMessage({ created_at: '2026-03-14T09:00:00.000000Z' }))).toEqual(['reply', 'copy'])
  })

  it('drops edit when the window has passed, and copy when there is no text', () => {
    expect(keys(mine(), makeChat(), sentAt + EDIT_WINDOW_MS + 1)).toEqual(['reply', 'copy', 'delete'])
    expect(keys(mine({ type: 'image', content: null }))).toEqual(['reply', 'delete'])
  })

  it('marks delete as the dangerous one', () => {
    expect(availableActions(mine(), makeChat(), ME, sentAt + 1000).find((a) => a.key === 'delete')?.danger).toBe(true)
  })
})

describe('group permissions', () => {
  it('only the owner and admins manage the group', () => {
    expect(canManageGroup('owner')).toBe(true)
    expect(canManageGroup('admin')).toBe(true)
    expect(canManageGroup('member')).toBe(false)
    expect(canManageGroup(undefined)).toBe(false)
  })

  it('the owner removes anyone else; an admin only plain members; nobody removes themselves this way', () => {
    expect(canRemoveMember('owner', 'admin', false)).toBe(true)
    expect(canRemoveMember('owner', 'member', false)).toBe(true)
    expect(canRemoveMember('admin', 'member', false)).toBe(true)
    expect(canRemoveMember('admin', 'admin', false)).toBe(false)
    expect(canRemoveMember('admin', 'owner', false)).toBe(false)
    expect(canRemoveMember('member', 'member', false)).toBe(false)
    expect(canRemoveMember('owner', 'member', true)).toBe(false)
  })

  it('only the owner changes roles, and never the owner’s own', () => {
    expect(canChangeRole('owner', 'member')).toBe(true)
    expect(canChangeRole('owner', 'admin')).toBe(true)
    expect(canChangeRole('owner', 'owner')).toBe(false)
    expect(canChangeRole('admin', 'member')).toBe(false)
  })
})
