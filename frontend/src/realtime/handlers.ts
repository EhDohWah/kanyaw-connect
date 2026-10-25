import { i18n } from '@/i18n'
import type { ChatChannelHandlers, MessagingHandlers, UserChannelHandlers } from '@/realtime/manager'
import { useAuthStore } from '@/stores/auth'
import { useChatsStore } from '@/stores/chats'
import { useDirectCallStore } from '@/stores/directCall'
import { useMessagesStore } from '@/stores/messages'
import { useRoomsStore } from '@/stores/rooms'
import { useTypingStore } from '@/stores/typing'
import { useUiStore } from '@/stores/ui'

/**
 * What each real-time event does to the app's state. Events are hints that can arrive twice or out of order:
 * every one of these is safe to run again (messages are matched by id, counts by comparing with what is shown).
 */
function sharedHandlers(): MessagingHandlers {
  const auth = useAuthStore()
  const chats = useChatsStore()
  const messages = useMessagesStore()
  const rooms = useRoomsStore()
  const typing = useTypingStore()

  const me = (): string => auth.user?.id ?? ''

  return {
    messageSent: ({ message }) => {
      messages.receive(message)
      // Their message is here: they have stopped typing, even if the "stopped" whisper was lost.
      if (message.sender_id) typing.clear(message.chat_id, message.sender_id)
      // Someone started a meeting in one of your chats: it may now be in "Upcoming meetings".
      if (message.type === 'system' && message.metadata?.event === 'room_created') rooms.refreshIfLoaded()
    },

    // Your other devices read a chat: clear its badge here too. Other people's reading is not shown (yet).
    messageRead: (event) => {
      if (event.user_id === me()) chats.applyRead(event)
    },

    chatUpdated: ({ chat }) => chats.applySummary(chat),

    chatMemberAdded: ({ chat, user }) => {
      // You were added to a chat (or someone started a direct chat with you): fetch it. Otherwise someone joined yours.
      if (user.id === me()) void chats.loadDetails(chat.id).catch(() => undefined)
      else chats.membersChanged(chat.id)
    },

    chatMemberRemoved: ({ chat_id, user_id }) => {
      if (user_id === me()) {
        // You left or were removed: the chat leaves the list, and an open conversation notices it is gone.
        chats.drop(chat_id)
        messages.forget(chat_id)
      } else {
        chats.membersChanged(chat_id)
      }
    },
  }
}

export function userChannelHandlers(): UserChannelHandlers {
  const rooms = useRoomsStore()
  const ui = useUiStore()
  const directCall = useDirectCallStore()

  return {
    ...sharedHandlers(),
    roomAdmitted: ({ room }) => rooms.noteDecision(room.id, 'admitted'),
    roomDenied: ({ room }) => rooms.noteDecision(room.id, 'denied'),
    roomJoinRequested: (event) => {
      rooms.noteJoinRequest(event)
      // In the meeting the Waiting list shows it; anywhere else, say so (the host may be reading their chats).
      if (rooms.activeCallId !== event.room_id) ui.toast(i18n.global.t('call.waiting.toast', { name: event.user.name }))
    },
    callIncoming: ({ call }) => directCall.receive(call),
    callChanged: ({ call }) => directCall.receive(call),
  }
}

export function chatChannelHandlers(chatId: string): ChatChannelHandlers {
  const auth = useAuthStore()
  const messages = useMessagesStore()
  const typing = useTypingStore()

  return {
    ...sharedHandlers(),
    messageUpdated: ({ message }) => messages.receiveUpdate(message),
    messageDeleted: ({ chat_id, message_id }) => messages.receiveDeleted(chat_id, message_id),
    typing: ({ user_id, typing: isTyping }) => {
      if (user_id !== auth.user?.id) typing.receive(chatId, user_id, isTyping)
    },
  }
}
