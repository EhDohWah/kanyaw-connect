// Ported from frontend/src/realtime/echo.ts; only the settings and the pusher-js build differ.
import Echo, { type ConnectionStatus } from 'laravel-echo'
// The React Native build of pusher-js (it watches the network with NetInfo). Its README marks React Native support as
// deprecated in favour of a native SDK; it still works with Reverb, and PROGRESS.md records the risk.
import * as pusherReactNative from 'pusher-js/react-native'

import { config } from '@/config'

/**
 * The Pusher class. The React Native build is CommonJS and exports `{ Pusher }`, although its types declare a default
 * export: a default import gives the wrapper object, and Echo then fails with "Object cannot be used as a constructor".
 */
export const PusherClient = (pusherReactNative as unknown as { Pusher: typeof pusherReactNative.default }).Pusher

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
    key: config.reverb.key,
    wsHost: config.reverb.host,
    wsPort: config.reverb.port,
    wssPort: config.reverb.port,
    forceTLS: config.reverb.tls,
    enabledTransports: ['ws', 'wss'],
    authEndpoint: `${config.apiBaseUrl}/broadcasting/auth`,
    auth: { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
    Pusher: PusherClient,
    withoutInterceptors: true,
  })

  return echo as unknown as EchoLike
}
