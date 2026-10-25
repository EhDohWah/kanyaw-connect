// Ported from frontend/src/realtime/manager.ts. Mobile adds `pause()`: the app closes the socket in the background.
import { setSocketIdResolver } from '@/api/http'
import type { EchoLike, ConnectionStatus } from '@/realtime/echo'
import type {
  ChatMemberAddedEvent,
  ChatMemberRemovedEvent,
  ChatUpdatedEvent,
  MessageDeletedEvent,
  MessageEvent,
  MessageReadEvent,
  TypingWhisper,
} from '@/types/chat'
import type { DirectCallEvent } from '@/types/call'
import type {
  RoomDecisionEvent,
  RoomEndedEvent,
  RoomJoinRequestedEvent,
  RoomPresenceEvent,
  RoomRoleChangedEvent,
} from '@/types/room'

/** Message and chat events: they arrive on the user channel and on the channel of an open chat. */
export interface MessagingHandlers {
  messageSent(event: MessageEvent): void
  messageRead(event: MessageReadEvent): void
  chatUpdated(event: ChatUpdatedEvent): void
  chatMemberAdded(event: ChatMemberAddedEvent): void
  chatMemberRemoved(event: ChatMemberRemovedEvent): void
}

/** Events on `private-user.{me}`: always on, for the whole session. */
export interface UserChannelHandlers extends MessagingHandlers {
  /** The host let you in: join again for your token. */
  roomAdmitted(event: RoomDecisionEvent): void
  /** The host turned you away, or removed you from the call. */
  roomDenied(event: RoomDecisionEvent): void
  /** For hosts and co-hosts: someone is waiting to be let in, even when the meeting is not open here. */
  roomJoinRequested(event: RoomJoinRequestedEvent): void
  /** Someone is calling you (one-to-one). */
  callIncoming(event: DirectCallEvent): void
  /** `call.accepted`, `call.declined`, `call.missed` or `call.ended`: the call moved on. */
  callChanged(event: DirectCallEvent): void
}

/** Events on `private-chat.{id}` and `presence-chat.{id}`: only while that chat is open. */
export interface ChatChannelHandlers extends MessagingHandlers {
  messageUpdated(event: MessageEvent): void
  messageDeleted(event: MessageDeletedEvent): void
  typing(event: TypingWhisper): void
}

/** Events on `presence-room.{id}`: only during a call (the host and admitted people may join it). */
export interface RoomChannelHandlers {
  participantJoined(event: RoomPresenceEvent): void
  participantLeft(event: RoomPresenceEvent): void
  roleChanged(event: RoomRoleChangedEvent): void
  joinRequested(event: RoomJoinRequestedEvent): void
  ended(event: RoomEndedEvent): void
}

export interface RealtimeHooks {
  /** The connection state changed. */
  status(status: ConnectionStatus): void
  /** The socket is up, the first time and after every drop: repair state from the REST API, events may have been missed. */
  connected(): void
}

/** How often a typing whisper may go out (docs/API.md, 4.2). */
export const TYPING_WHISPER_INTERVAL_MS = 2000

interface RoomWatch {
  roomId: string
  handlers: RoomChannelHandlers
  subscribed: boolean
}

interface Watch {
  handlers: ChatChannelHandlers
  /** How many parts of the screen asked for this chat (the drawer and a page can both show it). */
  count: number
  subscribed: boolean
}

/**
 * Owns the one Echo connection: the user channel for the whole session, a pair of channels for every chat that is
 * open, and the "socket is back" signal that makes the app refetch what it may have missed.
 */
export class RealtimeManager {
  private echo: EchoLike | null = null
  private stopStatus: (() => void) | null = null
  private lastStatus: ConnectionStatus | null = null
  private readonly watches = new Map<string, Watch>()
  private readonly lastWhisper = new Map<string, number>()
  /** The video room of the call on screen (one at a time). */
  private roomWatch: RoomWatch | null = null

  constructor(private readonly createEcho: (token: string) => EchoLike) {}

  /**
   * (Re)connects with this token. Called after login and whenever the token changes: the old connection is closed
   * first. Chats that were asked for earlier (a screen may open before the connection exists) are subscribed now.
   */
  connect(token: string, userId: string, user: UserChannelHandlers, hooks: RealtimeHooks): void {
    this.closeConnection()

    const echo = this.createEcho(token)
    this.echo = echo
    setSocketIdResolver(() => echo.socketId())

    this.stopStatus = echo.connector.onConnectionChange((status) => {
      const wasConnected = this.lastStatus === 'connected'
      this.lastStatus = status
      hooks.status(status)
      if (status === 'connected' && !wasConnected) hooks.connected()
    })
    hooks.status(echo.connectionStatus())

    const channel = echo.private(`user.${userId}`)
    channel
      .listen<MessageEvent>('.message.sent', (event) => user.messageSent(event))
      .listen<MessageReadEvent>('.message.read', (event) => user.messageRead(event))
      .listen<ChatUpdatedEvent>('.chat.updated', (event) => user.chatUpdated(event))
      .listen<ChatMemberAddedEvent>('.chat.member_added', (event) => user.chatMemberAdded(event))
      .listen<ChatMemberRemovedEvent>('.chat.member_removed', (event) => user.chatMemberRemoved(event))
      .listen<RoomDecisionEvent>('.room.admitted', (event) => user.roomAdmitted(event))
      .listen<RoomDecisionEvent>('.room.denied', (event) => user.roomDenied(event))
      .listen<RoomJoinRequestedEvent>('.room.join_requested', (event) => user.roomJoinRequested(event))
      .listen<DirectCallEvent>('.call.incoming', (event) => user.callIncoming(event))
      .listen<DirectCallEvent>('.call.accepted', (event) => user.callChanged(event))
      .listen<DirectCallEvent>('.call.declined', (event) => user.callChanged(event))
      .listen<DirectCallEvent>('.call.missed', (event) => user.callChanged(event))
      .listen<DirectCallEvent>('.call.ended', (event) => user.callChanged(event))

    for (const [chatId, watch] of this.watches) this.subscribe(chatId, watch)
    if (this.roomWatch) this.subscribeRoom(this.roomWatch)
  }

  /**
   * Closes the connection but keeps the watches (the app went to the background). The next `connect` subscribes them
   * again, and its `connected` hook triggers the resync.
   */
  pause(): void {
    this.closeConnection()
  }

  /** True while a connection exists (it may still be connecting). */
  isOpen(): boolean {
    return this.echo !== null
  }

  /** Closes the connection and forgets every watch (signing out). */
  disconnect(): void {
    this.closeConnection()
    this.watches.clear()
    this.lastWhisper.clear()
    this.roomWatch = null
  }

  /**
   * Listens to a video room during a call. Returns the function that stops. A second room replaces the first (there is
   * one call at a time). Kept across a reconnect, like an open chat.
   */
  watchRoom(roomId: string, handlers: RoomChannelHandlers): () => void {
    if (this.roomWatch) this.unwatchRoom(this.roomWatch)
    const watch: RoomWatch = { roomId, handlers, subscribed: false }
    this.roomWatch = watch
    this.subscribeRoom(watch)

    return () => {
      if (this.roomWatch === watch) this.unwatchRoom(watch)
    }
  }

  /**
   * Starts listening to a chat that is open. Returns the function that stops. Asking twice for the same chat shares
   * one subscription; it ends when the last asker lets go.
   */
  watchChat(chatId: string, handlers: ChatChannelHandlers): () => void {
    const existing = this.watches.get(chatId)
    if (existing) {
      existing.count += 1
    } else {
      const watch: Watch = { handlers, count: 1, subscribed: false }
      this.watches.set(chatId, watch)
      this.subscribe(chatId, watch)
    }

    let released = false
    return () => {
      if (released) return
      released = true
      this.unwatchChat(chatId)
    }
  }

  /** Chats being listened to right now (the ones to resync after a reconnect). */
  watchedChatIds(): string[] {
    return [...this.watches.keys()]
  }

  /** "I am typing" (or stopped). Sent to the others on the chat's presence channel, at most one every 2 seconds. */
  sendTyping(chatId: string, userId: string, typing: boolean, now: number = Date.now()): void {
    const watch = this.watches.get(chatId)
    if (!this.echo || !watch?.subscribed) return

    // "Stopped" always goes out (so the other side hides it at once); "typing" is limited.
    if (typing) {
      const last = this.lastWhisper.get(chatId) ?? Number.NEGATIVE_INFINITY
      if (now - last < TYPING_WHISPER_INTERVAL_MS) return
      this.lastWhisper.set(chatId, now)
    } else {
      this.lastWhisper.delete(chatId)
    }

    try {
      this.echo.join(`chat.${chatId}`).whisper('typing', { user_id: userId, typing })
    } catch {
      // Not subscribed yet or the socket is down: a missed typing hint does not matter.
    }
  }

  /* ----------------------------------------------------------------------------------------- inside --- */

  private subscribe(chatId: string, watch: Watch): void {
    if (!this.echo || watch.subscribed) return
    const { handlers } = watch

    this.echo
      .private(`chat.${chatId}`)
      .listen<MessageEvent>('.message.sent', (event) => handlers.messageSent(event))
      .listen<MessageEvent>('.message.updated', (event) => handlers.messageUpdated(event))
      .listen<MessageDeletedEvent>('.message.deleted', (event) => handlers.messageDeleted(event))
      .listen<MessageReadEvent>('.message.read', (event) => handlers.messageRead(event))
      .listen<ChatUpdatedEvent>('.chat.updated', (event) => handlers.chatUpdated(event))
      .listen<ChatMemberAddedEvent>('.chat.member_added', (event) => handlers.chatMemberAdded(event))
      .listen<ChatMemberRemovedEvent>('.chat.member_removed', (event) => handlers.chatMemberRemoved(event))

    this.echo.join(`chat.${chatId}`).listenForWhisper<TypingWhisper>('typing', (event) => handlers.typing(event))
    watch.subscribed = true
  }

  private subscribeRoom(watch: RoomWatch): void {
    if (!this.echo || watch.subscribed) return
    const { handlers } = watch

    this.echo
      .join(`room.${watch.roomId}`)
      .listen<RoomPresenceEvent>('.room.participant_joined', (event) => handlers.participantJoined(event))
      .listen<RoomPresenceEvent>('.room.participant_left', (event) => handlers.participantLeft(event))
      .listen<RoomRoleChangedEvent>('.room.role_changed', (event) => handlers.roleChanged(event))
      .listen<RoomJoinRequestedEvent>('.room.join_requested', (event) => handlers.joinRequested(event))
      .listen<RoomEndedEvent>('.room.ended', (event) => handlers.ended(event))
    watch.subscribed = true
  }

  private unwatchRoom(watch: RoomWatch): void {
    if (watch.subscribed) this.echo?.leave(`room.${watch.roomId}`)
    if (this.roomWatch === watch) this.roomWatch = null
  }

  private unwatchChat(chatId: string): void {
    const watch = this.watches.get(chatId)
    if (!watch) return

    watch.count -= 1
    if (watch.count > 0) return

    this.watches.delete(chatId)
    this.lastWhisper.delete(chatId)
    // The user channel is not touched: `leave('chat.X')` only affects private-chat.X and presence-chat.X.
    if (watch.subscribed) this.echo?.leave(`chat.${chatId}`)
  }

  private closeConnection(): void {
    this.stopStatus?.()
    this.stopStatus = null
    this.lastStatus = null

    if (this.echo) {
      this.echo.disconnect()
      this.echo = null
    }
    for (const watch of this.watches.values()) watch.subscribed = false
    if (this.roomWatch) this.roomWatch.subscribed = false
    setSocketIdResolver(() => undefined)
  }
}
