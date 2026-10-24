import { defineStore } from 'pinia'
import { computed, reactive, ref, shallowRef, watch } from 'vue'

import { toApiError, type ApiError } from '@/api/errors'
import * as roomsApi from '@/api/rooms'
import { i18n } from '@/i18n'
import { realtime } from '@/realtime'
import { CallSession, CHAT_MAX_LENGTH, DisconnectReason, type CallMedia, type CallSessionEvents, type MediaKind } from '@/realtime/callSession'
import { useAuthStore } from '@/stores/auth'
import { useRealtimeStore } from '@/stores/realtime'
import { useRoomsStore } from '@/stores/rooms'
import { useUiStore } from '@/stores/ui'
import type { CallChatMessage, CallOverReason, CallParticipant, JoinProblem } from '@/types/call'
import type { JoinResult, MuteKind, Room, RoomParticipant, RoomRole } from '@/types/room'
import type { PublicUser } from '@/types/user'
import { joinFailure, loadFailure } from '@/utils/joinOutcome'
import { readSession, removeSession, writeSession } from '@/utils/storage'

/**
 * Where the meeting screen is:
 * `loading` the room → `prejoin` (preview, Join) → `joining` → `waiting` for the host, or `connecting` to LiveKit →
 * `connected`; a dropped call is `rejoining` on its own; `over` says why it ended. `load-failed` offers "Try again".
 */
export type CallPhase = 'idle' | 'loading' | 'load-failed' | 'prejoin' | 'joining' | 'waiting' | 'connecting' | 'connected' | 'rejoining' | 'over'

export type CallPanel = 'participants' | 'chat'

/** While waiting to be let in, the room is asked about this often too, in case the "let in" event was missed. */
export const WAITING_CHECK_MS = 30_000
/** How many times a dropped call joins again by itself before the person is asked. */
export const REJOIN_ATTEMPTS = 3
export const REJOIN_DELAY_MS = 2000
/** The chat keeps this many messages (they are not saved anywhere anyway). */
export const CHAT_KEEP = 200

/** This tab was in a call (it survives a reload, not closing the tab): a reload joins again without asking. */
const RESUME_KEY = 'kc.call'

interface Resume {
  roomId: string
  micOn: boolean
  cameraOn: boolean
}

type Admitted = Extract<JoinResult, { status: 'admitted' }>

const t = (key: string, named: Record<string, unknown> = {}): string => i18n.global.t(key, named)
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export const useCallStore = defineStore('call', () => {
  const auth = useAuthStore()
  const rooms = useRoomsStore()
  const ui = useUiStore()
  const connection = useRealtimeStore()

  const roomId = ref<string | null>(null)
  const room = ref<Room | null>(null)
  const phase = ref<CallPhase>('idle')
  /** Why the last join did not get in (shown on the pre-join screen). */
  const problem = ref<JoinProblem | null>(null)
  const overReason = ref<CallOverReason | null>(null)
  const loadError = ref<ApiError | null>(null)
  const participants = shallowRef<CallParticipant[]>([])
  const speakerId = ref<string | null>(null)
  /** LiveKit is getting a short drop back by itself. */
  const reconnecting = ref(false)
  const audioBlocked = ref(false)
  /** Everyone's current role, by user id: from the tokens, then `room.role_changed`. */
  const roles = reactive<Record<string, RoomRole>>({})
  /** People asking to be let in (hosts and co-hosts only). */
  const waiting = ref<RoomParticipant[]>([])
  const messages = ref<CallChatMessage[]>([])
  const unread = ref(0)
  const panel = ref<CallPanel | null>(null)
  const dataSaver = ref(false)
  const mediaBusy = reactive<Record<MediaKind, boolean>>({ microphone: false, camera: false, screen: false })
  /** This tab was in this call before a reload. */
  const resume = ref<Resume | null>(null)

  let session: CallSession | null = null
  let stopRoomWatch: (() => void) | null = null
  /** The camera and microphone to start with once the host lets you in. */
  let pendingMedia: CallMedia | null = null
  let lastMedia = { micOn: false, cameraOn: false }
  let waitingTimer: ReturnType<typeof setInterval> | undefined
  let snapshotQueued = false
  /** Goes up whenever the screen moves to another room or closes: late answers for the old one are dropped. */
  let generation = 0

  const me = computed(() => auth.user?.id ?? '')
  const myRole = computed<RoomRole>(() => roles[me.value] ?? room.value?.my_participation?.role ?? 'participant')
  const isHost = computed(() => myRole.value === 'host')
  const canModerate = computed(() => myRole.value === 'host' || myRole.value === 'co_host')
  const local = computed(() => participants.value.find((person) => person.isLocal) ?? null)
  const inCall = computed(() => phase.value === 'connected' || phase.value === 'rejoining')

  function roleOf(userId: string): RoomRole {
    return roles[userId] ?? 'participant'
  }

  /** May you mute or remove this person? (A co-host cannot act on the host or another co-host; nobody on themselves.) */
  function canActOn(userId: string): boolean {
    if (!canModerate.value || userId === me.value) return false
    return isHost.value || roleOf(userId) === 'participant'
  }

  /* ------------------------------------------------------------------------------------ opening --- */

  /** Shows a meeting: loads it and goes to the pre-join screen (or says why it cannot be joined). */
  async function open(id: string): Promise<void> {
    // Anything from a meeting shown before is reset at once; its disconnect finishes in the background.
    const leaving = close()
    const asked = generation
    roomId.value = id
    rooms.activeCallId = id
    resume.value = readResume(id)
    dataSaver.value = auth.user?.settings?.data_saver === true
    phase.value = 'loading'

    try {
      await leaving
      const loaded = await roomsApi.getRoom(id)
      if (asked !== generation) return
      room.value = loaded
      if (loaded.status === 'ended') return finish('ended')
      phase.value = 'prejoin'
    } catch (error) {
      if (asked !== generation) return
      const apiError = toApiError(error)
      const reason = loadFailure(apiError)
      if (reason) return finish(reason)
      loadError.value = apiError
      phase.value = 'load-failed'
    }
  }

  /** Asks to join (the Join button, a "let in", a reload during a call). */
  async function join(media: CallMedia, password?: string): Promise<void> {
    const id = roomId.value
    if (!id || (phase.value !== 'prejoin' && phase.value !== 'waiting')) return
    const asked = generation
    problem.value = null
    phase.value = 'joining'

    let result: JoinResult
    try {
      result = await roomsApi.joinRoom(id, password || undefined)
    } catch (error) {
      if (asked !== generation) return
      const failure = joinFailure(toApiError(error), Boolean(password))
      if ('over' in failure) return finish(failure.over)
      return backToPrejoin(failure.problem)
    }
    if (asked !== generation) return

    if (result.status === 'waiting') {
      pendingMedia = media
      phase.value = 'waiting'
      startWaitingChecks()
      return
    }

    stopWaitingChecks()
    phase.value = 'connecting'
    if (await connect(result, media)) return
    if (asked === generation) backToPrejoin({ kind: 'connect-failed' })
  }

  /**
   * Not in (or no longer in) the call: the pre-join screen, saying why. Not in a call means nothing to come back to
   * after a reload either.
   */
  function backToPrejoin(reason: JoinProblem): void {
    clearResume()
    problem.value = reason
    phase.value = 'prejoin'
  }

  /** Connects to LiveKit with an "admitted" answer. False if it did not work (nothing is left half open). */
  async function connect(result: Admitted, media: CallMedia): Promise<boolean> {
    const asked = generation
    room.value = result.room
    seedRoles(result.room)
    if (canModerate.value && result.room.waiting_participants) waiting.value = result.room.waiting_participants

    const next: CallSession = new CallSession(me.value, sessionEvents((): boolean => session === next))
    session = next
    try {
      await next.connect(result.livekit_url, result.token, media)
    } catch {
      if (session === next) session = null
      await next.leave().catch(() => undefined)
      return false
    }
    if (asked !== generation || session !== next) {
      await next.leave().catch(() => undefined)
      return false
    }

    phase.value = 'connected'
    reconnecting.value = false
    pendingMedia = null
    if (dataSaver.value) next.setIncomingVideo(false)
    watchRoomEvents()
    takeSnapshot()
    return true
  }

  function sessionEvents(current: () => boolean): CallSessionEvents {
    return {
      changed: () => current() && queueSnapshot(),
      reconnecting: (active) => {
        if (current()) reconnecting.value = active
      },
      disconnected: (reason) => {
        if (current()) void dropped(reason)
      },
      chat: (message) => current() && receiveChat(message),
      audioBlocked: (blocked) => {
        if (current()) audioBlocked.value = blocked
      },
      mediaFailed: (kind, mediaProblem) => {
        if (current()) ui.toast(t(`call.media.${kind}.${mediaProblem}`), 'error')
      },
    }
  }

  /* ------------------------------------------------------------------------------- staying in --- */

  /** LiveKit ended the connection without us asking. Some reasons are final; anything else joins again by itself. */
  async function dropped(reason: DisconnectReason | undefined): Promise<void> {
    session = null
    reconnecting.value = false
    // The room's channel stays: `room.ended` may arrive while joining again (the host ending the meeting disconnects
    // everyone a moment before the server marks it ended).
    if (reason === DisconnectReason.PARTICIPANT_REMOVED) return finish('removed')
    if (reason === DisconnectReason.ROOM_DELETED || reason === DisconnectReason.ROOM_CLOSED) return finish('ended')
    if (reason === DisconnectReason.DUPLICATE_IDENTITY) return finish('elsewhere')
    await rejoin()
  }

  /**
   * Joins again without asking: after a long drop, or when the one-hour token ran out. Someone already admitted always
   * gets back in; a few tries with a pause between them before handing over to the pre-join screen.
   */
  async function rejoin(): Promise<void> {
    const id = roomId.value
    if (!id) return
    const asked = generation
    phase.value = 'rejoining'
    const media: CallMedia = { ...lastMedia }

    for (let attempt = 1; attempt <= REJOIN_ATTEMPTS; attempt += 1) {
      try {
        const result = await roomsApi.joinRoom(id)
        if (asked !== generation) return
        if (result.status === 'waiting') {
          pendingMedia = media
          phase.value = 'waiting'
          startWaitingChecks()
          return
        }
        if (await connect(result, media)) return
        if (asked !== generation) return
        // LiveKit would not take us back: perhaps the meeting was just ended.
        if ((await roomsApi.getRoom(id).catch(() => null))?.status === 'ended') return finish('ended')
        if (asked !== generation) return
      } catch (error) {
        if (asked !== generation) return
        const failure = joinFailure(toApiError(error), false)
        // Turned away while back in the call means removed.
        if ('over' in failure) return finish(failure.over === 'denied' ? 'removed' : failure.over)
        if (failure.problem.kind !== 'network' && failure.problem.kind !== 'unavailable') return backToPrejoin(failure.problem)
      }
      if (attempt < REJOIN_ATTEMPTS) await delay(REJOIN_DELAY_MS * attempt)
      if (asked !== generation) return
    }
    backToPrejoin({ kind: 'connect-failed' })
  }

  /** The WebSocket came back: events may have been missed, so ask the API how things stand. */
  async function repair(): Promise<void> {
    if (phase.value === 'waiting') return checkWaiting()
    const id = roomId.value
    if (!inCall.value || !id) return
    const asked = generation
    try {
      const latest = await roomsApi.getRoom(id)
      if (asked !== generation || !inCall.value) return
      room.value = latest
      if (latest.status === 'ended') return finish('ended')
      applyHost(latest.host_id)
      if (latest.my_participation?.role) roles[me.value] = latest.my_participation.role
      if (canModerate.value) waiting.value = latest.waiting_participants ?? []
    } catch {
      // the next reconnect tries again
    }
  }

  function startWaitingChecks(): void {
    stopWaitingChecks()
    waitingTimer = setInterval(() => void checkWaiting(), WAITING_CHECK_MS)
  }

  function stopWaitingChecks(): void {
    if (waitingTimer !== undefined) clearInterval(waitingTimer)
    waitingTimer = undefined
  }

  /** Still waiting? The room says whether the host let you in or turned you away. */
  async function checkWaiting(): Promise<void> {
    const id = roomId.value
    if (phase.value !== 'waiting' || !id) return
    const asked = generation
    try {
      const latest = await roomsApi.getRoom(id)
      if (asked !== generation || phase.value !== 'waiting') return
      room.value = latest
      if (latest.status === 'ended') return finish('ended')
      const admission = latest.my_participation?.admission
      if (admission === 'admitted') await join(pendingMedia ?? { ...lastMedia })
      else if (admission === 'denied') finish('denied')
    } catch {
      // asked again at the next check
    }
  }

  /* --------------------------------------------------------------------------------- leaving --- */

  /** The call is over for this person: show why. Safe to call more than once. */
  function finish(reason: CallOverReason): void {
    // Anything still on its way (a join, getting back in) is for a call that is over now.
    generation += 1
    stopWaitingChecks()
    stopRoomWatch?.()
    stopRoomWatch = null
    const ending = session
    session = null
    void ending?.leave().catch(() => undefined)
    pendingMedia = null
    clearResume()
    participants.value = []
    reconnecting.value = false
    audioBlocked.value = false
    panel.value = null
    overReason.value = reason
    phase.value = 'over'
  }

  function leave(): void {
    finish('left')
  }

  /** Host only: ends the meeting for everyone. Throws `ApiError` (the meeting stays open, for example on a 503). */
  async function endForEveryone(): Promise<void> {
    const id = roomId.value
    if (!id) return
    try {
      await roomsApi.endRoom(id)
    } catch (error) {
      throw toApiError(error)
    }
    finish('ended')
  }

  /** The meeting screen went away (another page, signing out): disconnect without showing anything. */
  async function close(): Promise<void> {
    generation += 1
    stopWaitingChecks()
    stopRoomWatch?.()
    stopRoomWatch = null
    const ending = session
    session = null
    if (roomId.value && rooms.activeCallId === roomId.value) rooms.activeCallId = null
    if (phase.value === 'connected' || phase.value === 'rejoining' || phase.value === 'over') clearResume()

    roomId.value = null
    room.value = null
    phase.value = 'idle'
    problem.value = null
    overReason.value = null
    loadError.value = null
    participants.value = []
    speakerId.value = null
    reconnecting.value = false
    audioBlocked.value = false
    for (const id of Object.keys(roles)) delete roles[id]
    waiting.value = []
    messages.value = []
    unread.value = 0
    panel.value = null
    resume.value = null
    pendingMedia = null
    lastMedia = { micOn: false, cameraOn: false }
    await ending?.leave().catch(() => undefined)
  }

  /* ---------------------------------------------------------------------------- what we see --- */

  function queueSnapshot(): void {
    if (snapshotQueued) return
    snapshotQueued = true
    queueMicrotask(() => {
      snapshotQueued = false
      takeSnapshot()
    })
  }

  function takeSnapshot(): void {
    if (!session) return
    const people = session.snapshot()
    for (const person of people) {
      if (!(person.id in roles) && person.tokenRole) roles[person.id] = person.tokenRole
    }
    participants.value = people
    speakerId.value = session.speakerId()

    const self = people.find((person) => person.isLocal)
    if (self) lastMedia = { micOn: self.micOn, cameraOn: self.cameraOn }
    // Only once really in the call (snapshots also come while still connecting).
    if (phase.value === 'connected' && self && (resume.value?.micOn !== self.micOn || resume.value?.cameraOn !== self.cameraOn)) saveResume()
    // Someone in the call is no longer waiting.
    if (waiting.value.length > 0) waiting.value = waiting.value.filter((entry) => !people.some((person) => person.id === entry.user_id))
  }

  function seedRoles(joined: Room): void {
    applyHost(joined.host_id)
    roles[me.value] = joined.my_participation?.role ?? (joined.host_id === me.value ? 'host' : 'participant')
  }

  /** There is one host: whoever had the role before is a participant now (the server does not announce that part). */
  function applyHost(hostId: string): void {
    for (const [id, role] of Object.entries(roles)) {
      if (role === 'host' && id !== hostId) roles[id] = 'participant'
    }
    roles[hostId] = 'host'
    if (room.value && room.value.host_id !== hostId) room.value = { ...room.value, host_id: hostId }
  }

  function applyRole(userId: string, role: RoomRole, hostId: string): void {
    const couldModerate = canModerate.value
    roles[userId] = role
    applyHost(hostId)
    if (userId !== me.value) return
    if (role === 'host') ui.toast(t('call.roles.nowHost'))
    else if (role === 'co_host') ui.toast(t('call.roles.nowCoHost'))
    if (!couldModerate && canModerate.value) void loadWaiting()
  }

  /** A new co-host sees who is already waiting. */
  async function loadWaiting(): Promise<void> {
    const id = roomId.value
    if (!id) return
    try {
      const latest = await roomsApi.getRoom(id)
      if (roomId.value === id && canModerate.value) waiting.value = latest.waiting_participants ?? []
    } catch {
      // new requests still arrive as events
    }
  }

  function addWaiting(user: PublicUser): void {
    if (!canModerate.value || waiting.value.some((entry) => entry.user_id === user.id)) return
    if (participants.value.some((person) => person.id === user.id)) return
    waiting.value = [...waiting.value, { user, user_id: user.id, role: 'participant', admission: 'waiting', joined_at: null, left_at: null }]
  }

  function dropWaiting(userId: string): void {
    waiting.value = waiting.value.filter((entry) => entry.user_id !== userId)
  }

  function watchRoomEvents(): void {
    const id = roomId.value
    if (!id) return
    stopRoomWatch?.()
    stopRoomWatch = realtime.watchRoom(id, {
      participantJoined: ({ user, role }) => {
        roles[user.id] = role
        dropWaiting(user.id)
      },
      participantLeft: () => queueSnapshot(),
      roleChanged: ({ user_id, role, host_id }) => applyRole(user_id, role, host_id),
      joinRequested: ({ user }) => addWaiting(user),
      ended: () => finish('ended'),
    })
  }

  /* ------------------------------------------------------------------------- your own media --- */

  async function toggle(kind: MediaKind, run: (session: CallSession, on: boolean) => Promise<boolean>, isOn: boolean): Promise<void> {
    if (!session || mediaBusy[kind]) return
    mediaBusy[kind] = true
    try {
      await run(session, !isOn)
    } finally {
      mediaBusy[kind] = false
    }
  }

  const toggleMicrophone = (): Promise<void> => toggle('microphone', (s, on) => s.setMicrophone(on), local.value?.micOn ?? false)
  const toggleCamera = (): Promise<void> => toggle('camera', (s, on) => s.setCamera(on), local.value?.cameraOn ?? false)
  const toggleScreenShare = (): Promise<void> => toggle('screen', (s, on) => s.setScreenShare(on), local.value?.screenSharing ?? false)

  async function switchDevice(kind: 'audioinput' | 'videoinput', deviceId: string): Promise<void> {
    await session?.switchDevice(kind, deviceId)
  }

  function activeDevice(kind: 'audioinput' | 'videoinput'): string | undefined {
    return session?.activeDevice(kind)
  }

  function setDataSaver(on: boolean): void {
    dataSaver.value = on
    session?.setIncomingVideo(!on)
  }

  async function startAudio(): Promise<void> {
    await session?.startAudio().catch(() => undefined)
  }

  /* ----------------------------------------------------------------------------------- chat --- */

  function receiveChat(message: CallChatMessage): void {
    if (messages.value.some((known) => known.id === message.id)) return
    messages.value = [...messages.value, message].slice(-CHAT_KEEP)
    if (panel.value !== 'chat') unread.value += 1
  }

  /** Sends a chat message to everyone in the call. False if it could not be sent (the text stays in the box). */
  async function sendChat(text: string): Promise<boolean> {
    const clean = text.trim().slice(0, CHAT_MAX_LENGTH)
    if (!clean || !session || phase.value !== 'connected') return false
    try {
      const sent = await session.sendChat(clean)
      messages.value = [...messages.value, sent].slice(-CHAT_KEEP)
      return true
    } catch {
      return false
    }
  }

  function togglePanel(which: CallPanel): void {
    panel.value = panel.value === which ? null : which
    if (panel.value === 'chat') unread.value = 0
  }

  function closePanel(): void {
    panel.value = null
  }

  /* ------------------------------------------------------------------- host and co-host --- */

  function controlled<T>(run: (roomId: string) => Promise<T>): Promise<T> {
    const id = roomId.value
    if (!id) return Promise.reject(new Error('No meeting is open.'))
    return run(id).catch((error: unknown) => {
      throw toApiError(error)
    })
  }

  async function admit(userId: string): Promise<void> {
    await controlled((id) => roomsApi.admit(id, userId))
    dropWaiting(userId)
  }

  async function deny(userId: string): Promise<void> {
    try {
      await controlled((id) => roomsApi.deny(id, userId))
    } catch (error) {
      // Not waiting any more (let in by a co-host, or gone): the list was out of date.
      if ((error as ApiError).code === 'not_waiting') return dropWaiting(userId)
      throw error
    }
    dropWaiting(userId)
  }

  const removeParticipant = (userId: string): Promise<void> => controlled((id) => roomsApi.removeParticipant(id, userId))

  const muteParticipant = (userId: string, kind: MuteKind): Promise<number> => controlled((id) => roomsApi.muteParticipant(id, userId, kind))

  async function makeCoHost(userId: string): Promise<void> {
    const promoted = await controlled((id) => roomsApi.makeCoHost(id, userId))
    roles[userId] = promoted.role
  }

  async function setLocked(locked: boolean): Promise<void> {
    room.value = await controlled((id) => roomsApi.setLocked(id, locked))
  }

  /* ------------------------------------------------------------------------------ resuming --- */

  function readResume(id: string): Resume | null {
    try {
      const saved = JSON.parse(readSession(RESUME_KEY) ?? 'null') as Partial<Resume> | null
      if (saved?.roomId !== id) return null
      return { roomId: id, micOn: saved.micOn === true, cameraOn: saved.cameraOn === true }
    } catch {
      return null
    }
  }

  function saveResume(): void {
    if (!roomId.value) return
    const next: Resume = { roomId: roomId.value, ...lastMedia }
    resume.value = next
    writeSession(RESUME_KEY, JSON.stringify(next))
  }

  function clearResume(): void {
    resume.value = null
    removeSession(RESUME_KEY)
  }

  /* ----------------------------------------------------------------------------- reacting --- */

  // The host let you in, or turned you away (your own user channel).
  watch(
    () => rooms.decision,
    (decision) => {
      if (!decision || decision.roomId !== roomId.value) return
      if (decision.outcome === 'admitted') {
        if (phase.value === 'waiting') void join(pendingMedia ?? { ...lastMedia })
      } else if (phase.value === 'waiting' || phase.value === 'joining') {
        finish('denied')
      } else if (inCall.value || phase.value === 'connecting') {
        finish('removed')
      }
    },
  )

  // Someone asked to join while the room channel was not listening yet (your own user channel has it too).
  watch(
    () => rooms.joinRequest,
    (request) => {
      if (request && request.event.room_id === roomId.value && inCall.value) addWaiting(request.event.user)
    },
  )

  watch(
    () => connection.status,
    (status, before) => {
      if (status === 'connected' && before !== 'connected') void repair()
    },
  )

  return {
    roomId,
    room,
    phase,
    problem,
    overReason,
    loadError,
    participants,
    speakerId,
    reconnecting,
    audioBlocked,
    roles,
    waiting,
    messages,
    unread,
    panel,
    dataSaver,
    mediaBusy,
    resume,
    myRole,
    isHost,
    canModerate,
    local,
    inCall,
    roleOf,
    canActOn,
    open,
    join,
    leave,
    endForEveryone,
    close,
    toggleMicrophone,
    toggleCamera,
    toggleScreenShare,
    switchDevice,
    activeDevice,
    setDataSaver,
    startAudio,
    sendChat,
    togglePanel,
    closePanel,
    admit,
    deny,
    removeParticipant,
    muteParticipant,
    makeCoHost,
    setLocked,
  }
})
