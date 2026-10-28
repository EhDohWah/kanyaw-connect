// Ported from frontend/src/utils/messageRules.ts (unchanged).
import type { Chat, MemberRole, TimelineMessage } from '@/types/chat'

/** A message's text can be edited by its sender for 24 hours (docs/API.md, 8.1). */
export const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000

const isManager = (role: MemberRole | undefined): boolean => role === 'owner' || role === 'admin'

export function canReply(message: TimelineMessage): boolean {
  return !message.pending && message.type !== 'system' && !message.encrypted
}

export function canCopy(message: TimelineMessage): boolean {
  return message.type !== 'system' && Boolean(message.content?.trim())
}

/** Your own text message, within 24 hours, in a chat that is not encrypted. */
export function canEditMessage(message: TimelineMessage, meId: string, now: number = Date.now()): boolean {
  return (
    !message.pending &&
    message.sender_id === meId &&
    message.type === 'text' &&
    !message.encrypted &&
    now - Date.parse(message.created_at) < EDIT_WINDOW_MS
  )
}

/** Your own messages; in a group also anyone's if you own or administer it. System messages are not deleted by people. */
export function canDeleteMessage(
  message: TimelineMessage,
  meId: string,
  chat: Pick<Chat, 'type' | 'my_membership'>,
): boolean {
  if (message.pending || message.type === 'system') return false
  if (message.sender_id === meId) return true
  return chat.type === 'group' && isManager(chat.my_membership.role)
}

/* ------------------------------------------------------------------------------------- groups --- */

export function canManageGroup(role: MemberRole | undefined): boolean {
  return isManager(role)
}

/** The owner can remove anyone else; an admin can remove plain members only. Leaving is a separate action. */
export function canRemoveMember(myRole: MemberRole | undefined, targetRole: MemberRole, isSelf: boolean): boolean {
  if (isSelf) return false
  if (myRole === 'owner') return true
  return myRole === 'admin' && targetRole === 'member'
}

/** Only the owner changes roles, and never the owner's own. */
export function canChangeRole(myRole: MemberRole | undefined, targetRole: MemberRole): boolean {
  return myRole === 'owner' && targetRole !== 'owner'
}
