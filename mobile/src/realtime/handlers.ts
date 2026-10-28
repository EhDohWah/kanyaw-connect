// Ported from frontend/src/realtime/handlers.ts. Meeting and call events arrive with their screens (8D, 8E).
import type { ChatChannelHandlers, MessagingHandlers, UserChannelHandlers } from '@/realtime/manager'
import { useAuthStore } from '@/stores/auth'
import { useChatsStore } from '@/stores/chats'
import { useMessagesStore } from '@/stores/messages'
import { useTypingStore } from '@/stores/typing'

const me = (): string => useAuthStore.getState().user?.id ?? ''

/**
 * What each real-time event does to the app's state. Events are hints that can arrive twice or out of order: every
 * one of these is safe to run again (messages are matched by id, counts by comparing with what is shown).
 */
function sharedHandlers(): MessagingHandlers {
  return {
    messageSent: ({ message }) => {
      useMessagesStore.getState().receive(message)
      // Their message is here: they have stopped typing, even if the "stopped" whisper was lost.
      if (message.sender_id) useTypingStore.getState().clear(message.chat_id, message.sender_id)
    },

    // Your other devices read a chat: clear its badge here too. Other people's reading is not shown (yet).
    messageRead: (event) => {
      if (event.user_id === me()) useChatsStore.getState().applyRead(event)
    },

    chatUpdated: ({ chat }) => useChatsStore.getState().applySummary(chat),

    chatMemberAdded: ({ chat, user }) => {
      // You were added to a chat (or someone started a direct chat with you): fetch it. Otherwise someone joined yours.
      const chats = useChatsStore.getState()
      if (user.id === me()) void chats.loadDetails(chat.id).catch(() => undefined)
      else chats.membersChanged(chat.id)
    },

    chatMemberRemoved: ({ chat_id, user_id }) => {
      if (user_id === me()) {
        // You left or were removed: the chat leaves the list, and an open conversation notices it is gone.
        useChatsStore.getState().drop(chat_id)
        useMessagesStore.getState().forget(chat_id)
      } else {
        useChatsStore.getState().membersChanged(chat_id)
      }
    },
  }
}

export function userChannelHandlers(): UserChannelHandlers {
  const later = (): void => undefined

  return {
    ...sharedHandlers(),
    roomAdmitted: later,
    roomDenied: later,
    roomJoinRequested: later,
    callIncoming: later,
    callChanged: later,
  }
}

export function chatChannelHandlers(chatId: string): ChatChannelHandlers {
  return {
    ...sharedHandlers(),
    messageUpdated: ({ message }) => useMessagesStore.getState().receiveUpdate(message),
    messageDeleted: ({ chat_id, message_id }) => useMessagesStore.getState().receiveDeleted(chat_id, message_id),
    typing: ({ user_id, typing }) => {
      if (user_id !== me()) useTypingStore.getState().receive(chatId, user_id, typing)
    },
  }
}
