import { Copy, Pencil, Reply, Trash2 } from 'lucide-vue-next'
import type { Component } from 'vue'

import type { Chat, TimelineMessage } from '@/types/chat'
import { canCopy, canDeleteMessage, canEditMessage, canReply } from '@/utils/messageRules'

export type MessageActionKey = 'reply' | 'copy' | 'edit' | 'delete'

export interface MessageAction {
  key: MessageActionKey
  /** Key in the locale files. */
  label: string
  icon: Component
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
  if (canDeleteMessage(message, meId, chat)) actions.push({ key: 'delete', label: 'message.delete', icon: Trash2, danger: true })
  return actions
}

/** Puts text on the clipboard. Falls back to a hidden text box where the modern API is missing (plain HTTP pages). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the old way
  }

  const box = document.createElement('textarea')
  box.value = text
  box.setAttribute('readonly', '')
  box.style.position = 'fixed'
  box.style.opacity = '0'
  document.body.append(box)
  box.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    box.remove()
  }
}
