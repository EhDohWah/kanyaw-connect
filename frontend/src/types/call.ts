import type { RoomRole } from '@/types/room'

/** A video (camera or screen) a tile can show. LiveKit's tracks have this shape; tests use a stand-in. */
export interface VideoTrackLike {
  attach(element: HTMLMediaElement): HTMLMediaElement
  detach(element: HTMLMediaElement): HTMLMediaElement
}

export type ConnectionQuality = 'excellent' | 'good' | 'poor' | 'lost' | 'unknown'

/**
 * One person in the call, as the screen shows them: a plain snapshot made from LiveKit's participant every time
 * something about them changes (Vue never wraps LiveKit's own objects).
 */
export interface CallParticipant {
  /** The LiveKit identity: the person's user id. */
  id: string
  name: string
  avatarUrl: string | null
  isLocal: boolean
  micOn: boolean
  cameraOn: boolean
  screenSharing: boolean
  speaking: boolean
  /** Raw tracks for the tiles to attach (never made reactive). `null` when off or not received. */
  cameraTrack: VideoTrackLike | null
  screenTrack: VideoTrackLike | null
  /** When they connected (ms), for a steady order. */
  joinedAt: number
  quality: ConnectionQuality
  /** The role in their LiveKit token (when they joined); the call store keeps the current one. */
  tokenRole: RoomRole | null
}

/** A message in the call's chat (LiveKit text stream on topic `chat`). Not saved anywhere. */
export interface CallChatMessage {
  id: string
  /** The sender's user id. */
  from: string
  /** Their name when it was sent: still shown after they leave the call. */
  name: string
  text: string
  /** ms */
  at: number
  mine: boolean
}

/** Why the call screen is showing "it's over" instead of the call. */
export type CallOverReason = 'ended' | 'left' | 'removed' | 'denied' | 'forbidden' | 'not-found' | 'elsewhere'

/** A join attempt that did not get in, but can be tried again from the pre-join screen. */
export type JoinProblem =
  | { kind: 'password-required' }
  | { kind: 'password-wrong'; message: string }
  | { kind: 'locked' }
  | { kind: 'full' }
  | { kind: 'unavailable' }
  | { kind: 'rate-limited'; retryAfter: number | undefined }
  | { kind: 'network' }
  | { kind: 'connect-failed' }
  | { kind: 'unknown'; message: string }
