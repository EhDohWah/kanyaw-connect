import type { AppStateStatus } from 'react-native'

import type { RealtimeHooks, RealtimeManager, UserChannelHandlers } from '@/realtime/manager'

export interface LifecycleOptions {
  manager: Pick<RealtimeManager, 'connect' | 'pause' | 'disconnect' | 'isOpen'>
  userHandlers: () => UserChannelHandlers
  hooks: RealtimeHooks
  /** Refetch what may have been missed while the socket was closed. */
  resync: () => void
  /** True while a call is running: the socket then stays open in the background (calls set this from 8E). */
  isCallActive: () => boolean
  /** The connection is gone because the app is in the background (not a network problem): reset the banner state. */
  paused: () => void
}

/**
 * When the one WebSocket is open, on a phone. The web keeps it open while the tab exists; here the OS suspends a
 * backgrounded app's sockets anyway, so:
 *
 * - it opens after sign-in, and again (with a resync) when the app comes back to the foreground;
 * - it closes when the app goes to the background, unless a call is running;
 * - `inactive` (iOS: Control Centre, the app switcher, a system sheet) changes nothing.
 */
export class RealtimeLifecycle {
  private session: { token: string; userId: string } | null = null
  private foreground = true
  private isPaused = false

  constructor(private readonly options: LifecycleOptions) {}

  /** Signed in (or the token changed). Connects now when the app is in the foreground or a call is running. */
  signIn(token: string, userId: string): void {
    const same = this.session?.token === token && this.session.userId === userId
    this.session = { token, userId }
    if (same && (this.options.manager.isOpen() || this.isPaused)) return
    if (this.foreground || this.options.isCallActive()) this.open()
    else this.isPaused = true
  }

  signOut(): void {
    this.session = null
    this.isPaused = false
    this.options.manager.disconnect()
  }

  appStateChanged(state: AppStateStatus): void {
    if (state === 'active') {
      const wasBackground = !this.foreground
      this.foreground = true
      if (!this.session || !wasBackground) return
      // A fresh connection resyncs when it is up (the `connected` hook); a socket kept open for a call may still have
      // missed events while the app was suspended, so resync now.
      if (this.isPaused) this.open()
      else this.options.resync()
    } else if (state === 'background') {
      this.foreground = false
      if (this.session && !this.options.isCallActive()) this.pause()
    }
  }

  /** A call ended. If the app is in the background, nothing needs the socket any more. */
  callEnded(): void {
    if (!this.foreground && this.session && !this.isPaused) this.pause()
  }

  private open(): void {
    if (!this.session) return
    this.isPaused = false
    this.options.manager.connect(
      this.session.token,
      this.session.userId,
      this.options.userHandlers(),
      this.options.hooks,
    )
  }

  private pause(): void {
    this.isPaused = true
    this.options.manager.pause()
    this.options.paused()
  }
}
