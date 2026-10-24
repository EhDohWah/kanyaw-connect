import Echo, { type ConnectionStatus } from 'laravel-echo'
import Pusher from 'pusher-js'

export type { ConnectionStatus }

/**
 * The small part of Laravel Echo this app uses. The rest of the code depends on this shape instead of on Echo itself,
 * so tests can stand in a fake that needs no WebSocket.
 */
export interface ChannelLike {
  listen<T = unknown>(event: string, callback: (payload: T) => void): ChannelLike
}

export interface PresenceChannelLike extends ChannelLike {
  listenForWhisper<T = unknown>(event: string, callback: (payload: T) => void): PresenceChannelLike
  whisper(event: string, data: Record<string, unknown>): PresenceChannelLike
}

export interface EchoLike {
  private(channel: string): ChannelLike
  join(channel: string): PresenceChannelLike
  /** Leaves the channel and its private and presence variants. */
  leave(channel: string): void
  socketId(): string | undefined
  connectionStatus(): ConnectionStatus
  disconnect(): void
  connector: { onConnectionChange(callback: (status: ConnectionStatus) => void): () => void }
}

/**
 * One connection to Reverb for the signed-in person. The token goes in the authorization header used to prove
 * the person may join private channels, so a new token needs a new connection (see `RealtimeManager.connect`).
 * Echo's own request interceptors are off: the API client adds `X-Socket-ID` itself (`setSocketIdResolver`).
 */
export function createEcho(token: string): EchoLike {
  const echo = new Echo({
    broadcaster: 'reverb',
    key: import.meta.env.VITE_REVERB_APP_KEY,
    wsHost: import.meta.env.VITE_REVERB_HOST,
    wsPort: Number(import.meta.env.VITE_REVERB_PORT),
    wssPort: Number(import.meta.env.VITE_REVERB_PORT),
    forceTLS: import.meta.env.VITE_REVERB_SCHEME === 'https',
    enabledTransports: ['ws', 'wss'],
    authEndpoint: `${import.meta.env.VITE_API_BASE_URL}/broadcasting/auth`,
    auth: { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
    Pusher,
    withoutInterceptors: true,
  })

  return echo as unknown as EchoLike
}
