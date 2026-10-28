// Ported from frontend/src/utils/messageActions.ts. The phone copies with the system clipboard (expo-clipboard).
import * as Clipboard from 'expo-clipboard'
import { Copy, Pencil, Reply, Trash2, type LucideIcon } from 'lucide-react-native'

import type { Chat, TimelineMessage } from '@/types/chat'
import { canCopy, canDeleteMessage, canEditMessage, canReply } from '@/utils/messageRules'

export type MessageActionKey = 'reply' | 'copy' | 'edit' | 'delete'

export interface MessageAction {
  key: MessageActionKey
  /** Key in the locale files. */
  label: string
  icon: LucideIcon
  danger?: boolean
}

/** What this person may do with this message, in the order the menus show it. */
export function availableActions(
  message: TimelineMessage,
  chat: Pick<Chat, 'type' | 'my_membership'>,
  meId: string,
  now: number = Date.now(),
): MessageAction[] {
  const actions: MessageAction[] = []
  if (canReply(message)) actions.push({ key: 'reply', label: 'message.reply', icon: Reply })
  if (canCopy(message)) actions.push({ key: 'copy', label: 'message.copy', icon: Copy })
  if (canEditMessage(message, meId, now)) actions.push({ key: 'edit', label: 'message.edit', icon: Pencil })
  if (canDeleteMessage(message, meId, chat))
    actions.push({ key: 'delete', label: 'message.delete', icon: Trash2, danger: true })
  return actions
}

/** Puts text on the clipboard. */
export async function copyText(text: string): Promise<boolean> {
  try {
    return await Clipboard.setStringAsync(text)
  } catch {
    return false
  }
}
