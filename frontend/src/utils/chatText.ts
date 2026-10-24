import type { Chat, Message } from '@/types/chat'
import type { PublicUser } from '@/types/user'

export type Translate = (key: string, named?: Record<string, unknown>) => string

/** The name of a chat: a group's own name, or for a direct chat the other person's. */
export function chatTitle(chat: Pick<Chat, 'type' | 'name' | 'other_user'>, fallback: string): string {
  if (chat.type === 'direct') return chat.other_user?.name ?? fallback
  return chat.name?.trim() || fallback
}

/** What to draw as the chat's picture: the other person's photo, or initials for a group. */
export function chatAvatar(chat: Pick<Chat, 'id' | 'type' | 'name' | 'other_user'>, fallback: string): {
  name: string
  src: string | null
  seed: string
} {
  if (chat.type === 'direct' && chat.other_user) {
    return { name: chat.other_user.name, src: chat.other_user.avatar_thumb_url, seed: chat.other_user.id }
  }
  return { name: chatTitle(chat, fallback), src: null, seed: chat.id }
}

const firstWord = (name: string): string => name.trim().split(/\s+/)[0] ?? name

/** The line under a chat's name in the list: who said what, or what kind of thing was sent. */
export function messagePreview(chat: Chat, meId: string, t: Translate): string {
  const message = chat.latest_message
  if (chat.is_encrypted) return t('chat.encryptedMessage')
  if (!message) return t('chat.noMessagesYet')

  let body: string
  switch (message.type) {
    case 'image':
      body = message.content?.trim() ? message.content : t('chat.preview.photo')
      break
    case 'voice':
      body = t('chat.preview.voice')
      break
    case 'file':
      body = message.content?.trim() ? message.content : t('chat.preview.file')
      break
    case 'system':
      return systemText(message, t, (userId) => (userId === meId ? t('common.you') : personById(chat, userId)?.name))
    default:
      body = message.content ?? ''
  }

  body = body.replace(/\s+/g, ' ').trim()

  if (message.sender_id === meId) return t('chat.preview.you', { text: body })
  if (chat.type === 'group' && message.sender) return t('chat.preview.person', { name: firstWord(message.sender.name), text: body })
  return body
}

/**
 * The sentence for a message written by the server ("X started a video room"). It is built from `metadata`, in the
 * app's language; `content` is only an English fallback for events this version does not know.
 */
export function systemText(message: Message, t: Translate, nameOf: (userId: string) => string | undefined): string {
  if (message.metadata.event === 'room_created') {
    const hostId = typeof message.metadata.host_id === 'string' ? message.metadata.host_id : undefined
    const name = hostId ? nameOf(hostId) : undefined
    if (name) return t('chat.system.roomCreated', { name })
    // The host's name is not known here (the chat list carries no member names): the server's own English sentence,
    // which names them, says more than "Someone started a video meeting".
    return message.content?.trim() || t('chat.system.roomCreated', { name: t('chat.someone') })
  }
  return message.content ?? ''
}

export function personById(chat: Pick<Chat, 'members' | 'other_user'>, userId: string): PublicUser | undefined {
  const member = chat.members?.find((entry) => entry.user_id === userId)
  if (member) return member.user
  return chat.other_user?.id === userId ? chat.other_user : undefined
}
