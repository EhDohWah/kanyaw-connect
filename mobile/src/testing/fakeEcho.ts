// Ported from frontend/src/__tests__/fakeEcho.ts.
import type { ChannelLike, ConnectionStatus, EchoLike, PresenceChannelLike } from '@/realtime/echo'

type Callback = (payload: never) => void

/** A channel that records what the app listens to and whispers, and lets a test deliver events to it. */
export class FakeChannel implements PresenceChannelLike {
  readonly listeners = new Map<string, Callback[]>()
  readonly whisperListeners = new Map<string, Callback[]>()
  readonly whispers: { event: string; data: Record<string, unknown> }[] = []

  listen<T = unknown>(event: string, callback: (payload: T) => void): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), callback as unknown as Callback])
    return this
  }

  listenForWhisper<T = unknown>(event: string, callback: (payload: T) => void): this {
    this.whisperListeners.set(event, [...(this.whisperListeners.get(event) ?? []), callback as unknown as Callback])
    return this
  }

  whisper(event: string, data: Record<string, unknown>): this {
    this.whispers.push({ event, data })
    return this
  }

  /** Delivers a server event (`'.message.sent'`) to everything listening for it. */
  emit(event: string, payload: unknown): void {
    for (const callback of this.listeners.get(event) ?? []) (callback as (p: unknown) => void)(payload)
  }

  emitWhisper(event: string, payload: unknown): void {
    for (const callback of this.whisperListeners.get(event) ?? []) (callback as (p: unknown) => void)(payload)
  }
}

export class FakeEcho implements EchoLike {
  readonly token: string
  readonly channels = new Map<string, FakeChannel>()
  readonly left: string[] = []
  status: ConnectionStatus = 'connecting'
  disconnected = false
  private readonly statusListeners = new Set<(status: ConnectionStatus) => void>()

  constructor(token: string) {
    this.token = token
  }

  readonly connector = {
    onConnectionChange: (callback: (status: ConnectionStatus) => void): (() => void) => {
      this.statusListeners.add(callback)
      return () => this.statusListeners.delete(callback)
    },
  }

  private channel(key: string): FakeChannel {
    let found = this.channels.get(key)
    if (!found) {
      found = new FakeChannel()
      this.channels.set(key, found)
    }
    return found
  }

  private(name: string): ChannelLike {
    return this.channel(`private-${name}`)
  }

  join(name: string): PresenceChannelLike {
    return this.channel(`presence-${name}`)
  }

  leave(name: string): void {
    this.left.push(name)
    this.channels.delete(`private-${name}`)
    this.channels.delete(`presence-${name}`)
  }

  socketId(): string | undefined {
    return this.status === 'connected' ? 'fake.socket' : undefined
  }

  connectionStatus(): ConnectionStatus {
    return this.status
  }

  disconnect(): void {
    this.disconnected = true
    this.statusListeners.clear()
  }

  /* ----------------------------------------------------------------------------- for tests --- */

  setStatus(status: ConnectionStatus): void {
    this.status = status
    for (const callback of [...this.statusListeners]) callback(status)
  }

  /** A channel by its full name, for example `private-user.123` or `presence-chat.456`. */
  get(name: string): FakeChannel | undefined {
    return this.channels.get(name)
  }
}

export const echoes: FakeEcho[] = []

export function fakeEchoFactory(token: string): FakeEcho {
  const echo = new FakeEcho(token)
  echoes.push(echo)
  return echo
}

export function lastEcho(): FakeEcho {
  const echo = echoes[echoes.length - 1]
  if (!echo) throw new Error('No Echo connection was created')
  return echo
}
