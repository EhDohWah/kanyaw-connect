import { ConnectionQuality, DisconnectReason, RoomEvent, Track, type Room } from 'livekit-client'
import { afterEach, beforeEach } from 'vitest'

import { setRoomFactory } from '@/realtime/callSession'

/**
 * A stand-in for LiveKit's `Room`: enough of it for the call session (participants, publications, the local camera and
 * microphone, text streams), with helpers so a test can make people join, speak, mute, drop and send messages.
 */

type Listener = (...args: unknown[]) => void

export class FakeTrack {
  readonly attached: HTMLMediaElement[] = []
  stopped = false

  constructor(
    readonly kind: 'audio' | 'video',
    readonly source: Track.Source,
  ) {}

  attach(element?: HTMLMediaElement): HTMLMediaElement {
    const target = element ?? document.createElement(this.kind === 'audio' ? 'audio' : 'video')
    this.attached.push(target)
    return target
  }

  detach(element?: HTMLMediaElement): HTMLMediaElement | HTMLMediaElement[] {
    if (element) {
      this.attached.splice(this.attached.indexOf(element), 1)
      return element
    }
    return this.attached.splice(0)
  }

  stop(): void {
    this.stopped = true
  }
}

export class FakePublication {
  subscribed = true

  constructor(
    readonly source: Track.Source,
    public track: FakeTrack | null,
    public isMuted = false,
  ) {}

  setSubscribed(subscribed: boolean): void {
    this.subscribed = subscribed
    this.track = subscribed ? new FakeTrack(this.source === Track.Source.Microphone ? 'audio' : 'video', this.source) : null
  }
}

const kindOf = (source: Track.Source): 'audio' | 'video' => (source === Track.Source.Microphone ? 'audio' : 'video')

export class FakeParticipant {
  readonly publications = new Map<Track.Source, FakePublication>()
  isSpeaking = false
  connectionQuality: ConnectionQuality = ConnectionQuality.Good
  joinedAt: Date
  /** Local participant only: what the call published, and the text messages it sent. */
  readonly published: { track: unknown; source: Track.Source }[] = []
  readonly sent: { text: string; topic: string | undefined }[] = []
  /** The next media call of this kind fails with this error (then works again). */
  readonly failures = new Map<'microphone' | 'camera' | 'screen' | 'text', unknown>()
  /** Local participant: called when a track is published, as LiveKit then emits `LocalTrackPublished`. */
  onPublished: ((publication: FakePublication) => void) | null = null

  constructor(
    public identity: string,
    public name: string,
    public metadata: string,
    readonly isLocal: boolean,
    joinedAt = Date.now(),
  ) {
    this.joinedAt = new Date(joinedAt)
  }

  getTrackPublication(source: Track.Source): FakePublication | undefined {
    return this.publications.get(source)
  }

  private on(source: Track.Source): boolean {
    const publication = this.publications.get(source)
    return publication !== undefined && !publication.isMuted
  }

  get isMicrophoneEnabled(): boolean {
    return this.on(Track.Source.Microphone)
  }

  get isCameraEnabled(): boolean {
    return this.on(Track.Source.Camera)
  }

  get isScreenShareEnabled(): boolean {
    return this.on(Track.Source.ScreenShare)
  }

  /** Turns a track on or off the way LiveKit does: publish once, then mute and unmute. */
  set(source: Track.Source, on: boolean): void {
    const publication = this.publications.get(source)
    if (publication) {
      publication.isMuted = !on
    } else if (on) {
      const fresh = new FakePublication(source, new FakeTrack(kindOf(source), source))
      this.publications.set(source, fresh)
      this.onPublished?.(fresh)
    }
  }

  private fail(kind: 'microphone' | 'camera' | 'screen' | 'text'): void {
    const error = this.failures.get(kind)
    if (error === undefined) return
    this.failures.delete(kind)
    throw error
  }

  async setMicrophoneEnabled(on: boolean): Promise<void> {
    this.fail('microphone')
    this.set(Track.Source.Microphone, on)
  }

  async setCameraEnabled(on: boolean): Promise<void> {
    this.fail('camera')
    this.set(Track.Source.Camera, on)
  }

  async setScreenShareEnabled(on: boolean): Promise<void> {
    this.fail('screen')
    this.set(Track.Source.ScreenShare, on)
  }

  async publishTrack(track: unknown, options: { source: Track.Source }): Promise<void> {
    this.fail(options.source === Track.Source.Camera ? 'camera' : 'microphone')
    this.published.push({ track, source: options.source })
    const publication = new FakePublication(options.source, track as FakeTrack)
    this.publications.set(options.source, publication)
    this.onPublished?.(publication)
  }

  async sendText(text: string, options: { topic?: string }): Promise<{ id: string; timestamp: number; topic: string }> {
    this.fail('text')
    this.sent.push({ text, topic: options.topic })
    return { id: `sent-${this.sent.length}`, timestamp: Date.now(), topic: options.topic ?? '' }
  }
}

/** What the local person looks like once connected (LiveKit takes it from the token). */
export const self = { identity: '0195e2c4-0001-7a00-8100-5f3a9c000000', name: 'Saw Eh Doh', metadata: '{"role":"host","avatar_url":null}' }

export class FakeRoom {
  readonly listeners = new Map<string, Listener[]>()
  readonly localParticipant = new FakeParticipant('', '', '', true)
  readonly remoteParticipants = new Map<string, FakeParticipant>()
  readonly textHandlers = new Map<string, (reader: unknown, info: { identity: string }) => void>()
  readonly activeDevices: Partial<Record<MediaDeviceKind, string>> = {}
  activeSpeakers: FakeParticipant[] = []
  canPlaybackAudio = true
  connectedWith: { url: string; token: string } | null = null
  /** The next `connect` fails with this. */
  connectError: unknown = null
  /** While set, `connect` waits for it (to look at the screen while it is connecting). */
  connectGate: Promise<void> | null = null
  disconnects = 0

  constructor() {
    // LiveKit tells the room about the local tracks it publishes, while it is still connecting too.
    this.localParticipant.onPublished = (publication) => this.emit(RoomEvent.LocalTrackPublished, publication, this.localParticipant)
  }

  on(event: string, listener: Listener): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
    return this
  }

  off(event: string, listener: Listener): this {
    this.listeners.set(event, (this.listeners.get(event) ?? []).filter((known) => known !== listener))
    return this
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args)
  }

  async connect(url: string, token: string): Promise<void> {
    if (this.connectGate) await this.connectGate
    if (this.connectError) {
      const error = this.connectError
      this.connectError = null
      throw error
    }
    this.connectedWith = { url, token }
    Object.assign(this.localParticipant, self)
  }

  async disconnect(stopTracks = true): Promise<void> {
    this.disconnects += 1
    if (stopTracks) for (const publication of this.localParticipant.publications.values()) publication.track?.stop()
    this.emit(RoomEvent.Disconnected, DisconnectReason.CLIENT_INITIATED)
  }

  registerTextStreamHandler(topic: string, handler: (reader: unknown, info: { identity: string }) => void): void {
    if (this.textHandlers.has(topic)) throw new Error(`A text stream handler for topic "${topic}" has already been set.`)
    this.textHandlers.set(topic, handler)
  }

  async startAudio(): Promise<void> {
    this.canPlaybackAudio = true
  }

  async switchActiveDevice(kind: MediaDeviceKind, deviceId: string): Promise<boolean> {
    this.activeDevices[kind] = deviceId
    return true
  }

  getActiveDevice(kind: MediaDeviceKind): string | undefined {
    return this.activeDevices[kind]
  }

  /* ----------------------------------------------------------------------------- for tests --- */

  /** Someone joins, with their microphone and camera on unless said otherwise. */
  addPerson(identity: string, name: string, options: { role?: string; mic?: boolean; camera?: boolean; joinedAt?: number; avatarUrl?: string } = {}): FakeParticipant {
    const person = new FakeParticipant(identity, name, JSON.stringify({ role: options.role ?? 'participant', avatar_url: options.avatarUrl ?? null }), false, options.joinedAt)
    this.remoteParticipants.set(identity, person)
    this.emit(RoomEvent.ParticipantConnected, person)
    if (options.mic ?? true) this.publish(person, Track.Source.Microphone)
    if (options.camera ?? true) this.publish(person, Track.Source.Camera)
    return person
  }

  /** A remote person starts sending a track; the room receives it (LiveKit subscribes on its own). */
  publish(person: FakeParticipant, source: Track.Source): FakePublication {
    const publication = new FakePublication(source, null)
    person.publications.set(source, publication)
    this.emit(RoomEvent.TrackPublished, publication, person)
    if (publication.subscribed) {
      publication.track = new FakeTrack(kindOf(source), source)
      this.emit(RoomEvent.TrackSubscribed, publication.track, publication, person)
    }
    return publication
  }

  mute(person: FakeParticipant, source: Track.Source, muted = true): void {
    const publication = person.publications.get(source)!
    publication.isMuted = muted
    this.emit(muted ? RoomEvent.TrackMuted : RoomEvent.TrackUnmuted, publication, person)
  }

  leaveRoom(identity: string): void {
    const person = this.remoteParticipants.get(identity)!
    for (const publication of person.publications.values()) {
      if (publication.track) this.emit(RoomEvent.TrackUnsubscribed, publication.track, publication, person)
    }
    this.remoteParticipants.delete(identity)
    this.emit(RoomEvent.ParticipantDisconnected, person)
  }

  speak(...people: FakeParticipant[]): void {
    for (const person of [this.localParticipant, ...this.remoteParticipants.values()]) person.isSpeaking = people.includes(person)
    this.activeSpeakers = people
    this.emit(RoomEvent.ActiveSpeakersChanged, people)
  }

  /** A chat message from someone (a LiveKit text stream on that topic). */
  deliverText(identity: string, text: string, id = `in-${Math.random()}`, topic = 'chat'): void {
    const reader = { info: { id, timestamp: Date.now(), topic }, readAll: async () => text }
    this.textHandlers.get(topic)?.(reader, { identity })
  }

  /** LiveKit lost the connection (or the server ended it) for this reason. */
  drop(reason: DisconnectReason = DisconnectReason.SIGNAL_CLOSE): void {
    this.emit(RoomEvent.Disconnected, reason)
  }
}

export const liveRooms: FakeRoom[] = []

export function lastRoom(): FakeRoom {
  const room = liveRooms[liveRooms.length - 1]
  if (!room) throw new Error('No LiveKit room was created')
  return room
}

/** Call in a test file: every call session gets a fake room for the tests in it. */
export function useFakeLiveKit(): void {
  beforeEach(() => {
    liveRooms.length = 0
    setRoomFactory(() => {
      const room = new FakeRoom()
      liveRooms.push(room)
      return room as unknown as Room
    })
  })
  afterEach(() => setRoomFactory(null))
}
