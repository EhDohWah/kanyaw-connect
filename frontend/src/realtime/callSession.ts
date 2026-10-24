import {
  DisconnectReason,
  Room,
  RoomEvent,
  Track,
  type LocalAudioTrack,
  type LocalVideoTrack,
  type Participant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RoomOptions,
} from 'livekit-client'
import { markRaw } from 'vue'

import { CAMERA_PRESET, mediaProblem, type MediaProblem } from '@/realtime/localMedia'
import type { CallChatMessage, CallParticipant, ConnectionQuality } from '@/types/call'
import type { RoomRole } from '@/types/room'

/** In-call chat travels as LiveKit text streams on this topic (the API has no endpoint for it). */
export const CHAT_TOPIC = 'chat'
export const CHAT_MAX_LENGTH = 1000

/** What docs/API.md and the prompt ask for: adaptive stream, dynacast, the camera at 360p, simulcast for big rooms. */
export const ROOM_OPTIONS: RoomOptions = {
  adaptiveStream: true,
  dynacast: true,
  videoCaptureDefaults: { resolution: CAMERA_PRESET.resolution },
  publishDefaults: { simulcast: true },
}

let roomFactory: () => Room = () => new Room(ROOM_OPTIONS)

/** Tests stand in a fake room here (`null` puts the real one back). */
export function setRoomFactory(factory: (() => Room) | null): void {
  roomFactory = factory ?? (() => new Room(ROOM_OPTIONS))
}

/** What to start the call with: tracks already open from the pre-join preview are sent as they are. */
export interface CallMedia {
  micOn: boolean
  cameraOn: boolean
  audioTrack?: LocalAudioTrack | null
  videoTrack?: LocalVideoTrack | null
  audioDeviceId?: string | undefined
  videoDeviceId?: string | undefined
}

export type MediaKind = 'microphone' | 'camera' | 'screen'

export interface CallSessionEvents {
  /** Someone joined, left, muted, spoke…: take a new snapshot. */
  changed(): void
  /** LiveKit lost the connection for a moment and is getting it back (`true`), or got it back (`false`). */
  reconnecting(active: boolean): void
  /** The call is over for this room object. Not called when we left ourselves. */
  disconnected(reason: DisconnectReason | undefined): void
  chat(message: CallChatMessage): void
  /** The browser will not play sound until the person presses something (a reload with no click). */
  audioBlocked(blocked: boolean): void
  mediaFailed(kind: MediaKind, problem: MediaProblem): void
}

const ROLES: readonly string[] = ['host', 'co_host', 'participant']

/** The token's metadata: `{ role, avatar_url }` (docs/API.md, POST /rooms/{room}/join). */
function metadataOf(participant: Participant): { role: RoomRole | null; avatarUrl: string | null } {
  try {
    const parsed = JSON.parse(participant.metadata ?? '') as { role?: unknown; avatar_url?: unknown }
    return {
      role: typeof parsed.role === 'string' && ROLES.includes(parsed.role) ? (parsed.role as RoomRole) : null,
      avatarUrl: typeof parsed.avatar_url === 'string' ? parsed.avatar_url : null,
    }
  } catch {
    return { role: null, avatarUrl: null }
  }
}

/** Events after which the people on screen may look different. */
const CHANGES = [
  RoomEvent.ParticipantConnected,
  RoomEvent.ParticipantDisconnected,
  RoomEvent.TrackUnpublished,
  RoomEvent.TrackMuted,
  RoomEvent.TrackUnmuted,
  RoomEvent.LocalTrackPublished,
  RoomEvent.LocalTrackUnpublished,
  RoomEvent.ParticipantMetadataChanged,
  RoomEvent.ParticipantNameChanged,
  RoomEvent.ConnectionQualityChanged,
  RoomEvent.TrackStreamStateChanged,
] as const

/**
 * One connection to a LiveKit room: the only place that talks to `livekit-client` during a call. It turns LiveKit's
 * participants into plain snapshots for the screen, plays the others' sound, carries the chat, and applies data saver.
 */
export class CallSession {
  readonly room: Room
  private leaving = false
  private incomingVideo = true
  private speaker: string | null = null
  private readonly sounds = new Map<RemoteTrack, HTMLMediaElement>()
  private readonly soundHost: HTMLElement

  constructor(
    private readonly selfId: string,
    private readonly events: CallSessionEvents,
  ) {
    this.room = roomFactory()
    // The others' voices play through audio elements kept out of sight.
    this.soundHost = document.createElement('div')
    this.soundHost.hidden = true
    document.body.append(this.soundHost)
    this.listen()
  }

  /** Connects with the token from `POST /rooms/{room}/join`, then turns the camera and microphone on as chosen. */
  async connect(url: string, token: string, media: CallMedia): Promise<void> {
    await this.room.connect(url, token)
    this.events.audioBlocked(!this.room.canPlaybackAudio)
    await Promise.all([
      this.startTrack('camera', media.cameraOn, media.videoTrack ?? null, media.videoDeviceId),
      this.startTrack('microphone', media.micOn, media.audioTrack ?? null, media.audioDeviceId),
    ])
  }

  /** Leaves on purpose: stops the camera and microphone, and does not report it as a drop. */
  async leave(): Promise<void> {
    this.leaving = true
    try {
      await this.room.disconnect(true)
    } finally {
      this.cleanUp()
    }
  }

  /** Everyone in the call, as the screen shows them. */
  snapshot(): CallParticipant[] {
    const everyone: Participant[] = [this.room.localParticipant, ...this.room.remoteParticipants.values()]
    return everyone.filter((participant) => participant.identity !== '').map((participant) => this.describe(participant))
  }

  /** The other person who spoke last (kept while it is quiet, so the tile does not jump away), if still here. */
  speakerId(): string | null {
    return this.speaker && this.room.remoteParticipants.has(this.speaker) ? this.speaker : null
  }

  async setMicrophone(on: boolean): Promise<boolean> {
    return this.toggle('microphone', () => this.room.localParticipant.setMicrophoneEnabled(on))
  }

  async setCamera(on: boolean): Promise<boolean> {
    return this.toggle('camera', () => this.room.localParticipant.setCameraEnabled(on, { resolution: CAMERA_PRESET.resolution }))
  }

  /** Closing the browser's "choose what to share" window is not an error: nothing happens. */
  async setScreenShare(on: boolean): Promise<boolean> {
    try {
      await this.room.localParticipant.setScreenShareEnabled(on, { audio: false })
      return true
    } catch (error) {
      const problem = mediaProblem(error)
      if (problem !== 'blocked') this.events.mediaFailed('screen', problem)
      return false
    } finally {
      this.events.changed()
    }
  }

  async switchDevice(kind: 'audioinput' | 'videoinput', deviceId: string): Promise<void> {
    await this.room.switchActiveDevice(kind, deviceId)
  }

  activeDevice(kind: 'audioinput' | 'videoinput'): string | undefined {
    return this.room.getActiveDevice(kind)
  }

  /** Data saver: stop (or start again) receiving the others' cameras. Screen shares still come, so slides can be followed. */
  setIncomingVideo(on: boolean): void {
    this.incomingVideo = on
    for (const participant of this.room.remoteParticipants.values()) {
      const camera = participant.getTrackPublication(Track.Source.Camera) as RemoteTrackPublication | undefined
      camera?.setSubscribed(on)
    }
    this.events.changed()
  }

  async sendChat(text: string): Promise<CallChatMessage> {
    const info = await this.room.localParticipant.sendText(text, { topic: CHAT_TOPIC })
    return { id: info.id, from: this.selfId, name: this.room.localParticipant.name ?? '', text, at: info.timestamp, mine: true }
  }

  /** After a press: lets the browser play the others' sound. */
  async startAudio(): Promise<void> {
    await this.room.startAudio()
    this.events.audioBlocked(!this.room.canPlaybackAudio)
  }

  /* ----------------------------------------------------------------------------------------- inside --- */

  private listen(): void {
    const room = this.room
    const changed = (): void => this.events.changed()
    for (const event of CHANGES) room.on(event, changed)

    room
      .on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Audio) this.play(track)
        changed()
      })
      .on(RoomEvent.TrackUnsubscribed, (track) => {
        this.silence(track)
        changed()
      })
      .on(RoomEvent.TrackPublished, (publication) => {
        // A camera that starts while data saver is on is not received.
        if (!this.incomingVideo && publication.source === Track.Source.Camera) publication.setSubscribed(false)
        changed()
      })
      .on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        const remote = speakers.find((participant) => !participant.isLocal)
        if (remote) this.speaker = remote.identity
        changed()
      })
      .on(RoomEvent.Reconnecting, () => this.events.reconnecting(true))
      .on(RoomEvent.SignalReconnecting, () => this.events.reconnecting(true))
      .on(RoomEvent.Reconnected, () => this.events.reconnecting(false))
      .on(RoomEvent.AudioPlaybackStatusChanged, () => this.events.audioBlocked(!room.canPlaybackAudio))
      .on(RoomEvent.Disconnected, (reason) => {
        this.cleanUp()
        if (!this.leaving) this.events.disconnected(reason)
      })

    room.registerTextStreamHandler(CHAT_TOPIC, (reader, { identity }) => {
      void reader
        .readAll()
        .then((text) => {
          const message = text.trim().slice(0, CHAT_MAX_LENGTH)
          const name = this.room.remoteParticipants.get(identity)?.name || identity
          if (message) this.events.chat({ id: reader.info.id, from: identity, name, text: message, at: reader.info.timestamp, mine: false })
        })
        .catch(() => undefined) // a message cut off by a drop is simply not shown
    })
  }

  /** Sends a preview track as it is, or opens the device; failures leave it off and are reported. */
  private async startTrack(
    kind: 'camera' | 'microphone',
    on: boolean,
    track: LocalVideoTrack | LocalAudioTrack | null,
    deviceId: string | undefined,
  ): Promise<void> {
    if (!on) {
      track?.stop()
      return
    }
    const local = this.room.localParticipant
    try {
      if (track) {
        await local.publishTrack(track, { source: kind === 'camera' ? Track.Source.Camera : Track.Source.Microphone })
      } else if (kind === 'camera') {
        await local.setCameraEnabled(true, { resolution: CAMERA_PRESET.resolution, ...(deviceId ? { deviceId } : {}) })
      } else {
        await local.setMicrophoneEnabled(true, deviceId ? { deviceId } : undefined)
      }
    } catch (error) {
      track?.stop()
      this.events.mediaFailed(kind, mediaProblem(error))
    }
  }

  private async toggle(kind: MediaKind, run: () => Promise<unknown>): Promise<boolean> {
    try {
      await run()
      return true
    } catch (error) {
      this.events.mediaFailed(kind, mediaProblem(error))
      return false
    } finally {
      this.events.changed()
    }
  }

  private describe(participant: Participant): CallParticipant {
    const camera = participant.getTrackPublication(Track.Source.Camera)
    const screen = participant.getTrackPublication(Track.Source.ScreenShare)
    const meta = metadataOf(participant)
    const cameraOn = participant.isCameraEnabled
    const screenSharing = participant.isScreenShareEnabled
    return {
      id: participant.identity,
      name: participant.name || participant.identity,
      avatarUrl: meta.avatarUrl,
      isLocal: participant.isLocal,
      micOn: participant.isMicrophoneEnabled,
      cameraOn,
      screenSharing,
      speaking: participant.isSpeaking,
      // A remote track exists only while it is received (not with data saver on).
      cameraTrack: cameraOn && camera?.track ? markRaw(camera.track) : null,
      screenTrack: screenSharing && screen?.track ? markRaw(screen.track) : null,
      joinedAt: participant.joinedAt?.getTime() ?? 0,
      quality: participant.connectionQuality as ConnectionQuality,
      tokenRole: meta.role,
    }
  }

  private play(track: RemoteTrack): void {
    if (this.sounds.has(track)) return
    const element = track.attach()
    this.soundHost.append(element)
    this.sounds.set(track, element)
  }

  private silence(track: RemoteTrack): void {
    const element = this.sounds.get(track)
    if (!element) return
    track.detach(element)
    element.remove()
    this.sounds.delete(track)
  }

  private cleanUp(): void {
    for (const track of [...this.sounds.keys()]) this.silence(track)
    this.soundHost.remove()
  }
}

export { DisconnectReason }
