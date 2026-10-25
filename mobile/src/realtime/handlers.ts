import type { UserChannelHandlers } from '@/realtime/manager'
import { useChatsStore } from '@/stores/chats'

/**
 * What each event on the user channel does, for now. Chat events refetch the chat list (8C applies them one by one,
 * as the web does); meeting and call events arrive with their screens in 8D and 8E.
 */
export function userChannelHandlers(): UserChannelHandlers {
  const refreshChats = (): void => useChatsStore.getState().refreshSoon()
  const later = (): void => undefined

  return {
    messageSent: refreshChats,
    messageRead: refreshChats,
    chatUpdated: refreshChats,
    chatMemberAdded: refreshChats,
    chatMemberRemoved: refreshChats,
    roomAdmitted: later,
    roomDenied: later,
    roomJoinRequested: later,
    callIncoming: later,
    callChanged: later,
  }
}
