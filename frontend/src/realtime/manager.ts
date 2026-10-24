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

/** Events on `private-user.{me}`: always on, for the whole session. */
export interface UserChannelHandlers {
  messageSent(event: MessageEvent): void
  messageRead(event: MessageReadEvent): void
  chatUpdated(event: ChatUpdatedEvent): void
  chatMemberAdded(event: ChatMemberAddedEvent): void
  chatMemberRemoved(event: ChatMemberRemovedEvent): void
}

/** Events on `private-chat.{id}` and `presence-chat.{id}`: only while that chat is open. */
export interface ChatChannelHandlers extends UserChannelHandlers {
  messageUpdated(event: MessageEvent): void
  messageDeleted(event: MessageDeletedEvent): void
  typing(event: TypingWhisper): void
}

export interface RealtimeHooks {
  /** The connection state changed. */
  status(status: ConnectionStatus): void
  /** The socket is up, the first time and after every drop: repair state from the REST API, events may have been missed. */
  connected(): void
}

/** How often a typing whisper may go out (docs/API.md, 4.2). */
export const TYPING_WHISPER_INTERVAL_MS = 2000

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

    for (const [chatId, watch] of this.watches) this.subscribe(chatId, watch)
  }

  /** Closes the connection and forgets every watch (signing out). */
  disconnect(): void {
    this.closeConnection()
    this.watches.clear()
    this.lastWhisper.clear()
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
    setSocketIdResolver(() => undefined)
  }
}
