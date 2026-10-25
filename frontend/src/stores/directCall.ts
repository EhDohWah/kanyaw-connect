import { defineStore } from 'pinia'
import { computed, reactive, ref, shallowRef, watch } from 'vue'

import * as callsApi from '@/api/calls'
import { toApiError } from '@/api/errors'
import * as roomsApi from '@/api/rooms'
import { interruptRecording } from '@/composables/useVoiceRecorder'
import { i18n } from '@/i18n'
import { closeCallNotification } from '@/push/browser'
import type { CallSession, CallSessionEvents } from '@/realtime/callSession'
import { ringer } from '@/realtime/ringer'
import { tabLeader } from '@/realtime/tabLeader'
import { ScreenWakeLock } from '@/realtime/wakeLock'
import { useAuthStore } from '@/stores/auth'
import { useChatsStore } from '@/stores/chats'
import { useRealtimeStore } from '@/stores/realtime'
import { useUiStore } from '@/stores/ui'
import type { CallParticipant, DirectCall, DirectCallKind } from '@/types/call'
import type { PublicUser } from '@/types/user'
import {
  IDLE,
  acceptFailure,
  closingOf,
  endingOf,
  isLive,
  startFailure,
  transition,
  type CallEnding,
  type CallEvent,
  type CallMachine,
} from '@/utils/callOutcome'

/** How many times a dropped call joins again by itself (the server waits 30 s for a person to come back). */
export const REJOIN_ATTEMPTS = 3
export const REJOIN_DELAY_MS = 2000
/** The ringing is over a moment after `ring_expires_at` even if the server's word is late. */
export const EXPIRY_GRACE_MS = 1500
/** The voice layout's ring follows their loudness this often. */
export const LEVEL_POLL_MS = 100

const t = (key: string, named: Record<string, unknown> = {}): string => i18n.global.t(key, named)
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** LiveKit's code (530 KB) is loaded only when a call actually connects. */
const loadSession = (): Promise<typeof import('@/realtime/callSession')> => import('@/realtime/callSession')
const loadMedia = (): Promise<typeof import('@/realtime/localMedia')> => import('@/realtime/localMedia')

/**
 * The one-to-one call, for the whole app: drawn by an overlay above every page, so moving around never hangs up. The
 * rules are in `utils/callOutcome.ts`; this store talks to the API, LiveKit (through `CallSession`), the ringer, the
 * other tabs and the screen's wake lock.
 */
export const useDirectCallStore = defineStore('directCall', () => {
  const auth = useAuthStore()
  const ui = useUiStore()
  const connection = useRealtimeStore()
  const chats = useChatsStore()

  const machine = ref<CallMachine>(IDLE)
  const call = ref<DirectCall | null>(null)
  /** Full screen (`true`) or the slim "Return to call" bar while moving around the app. */
  const expanded = ref(true)
  const participants = shallowRef<CallParticipant[]>([])
  const reconnecting = ref(false)
  /** The browser is holding back the other person's sound until a tap. */
  const audioBlocked = ref(false)
  /** How loud the other person is right now (0–1), for the voice layout. */
  const remoteLevel = ref(0)
  /** The length to show on "Call ended · 3:12" (seconds), when it was answered. */
  const endedSeconds = ref<number | null>(null)
  const mediaBusy = reactive({ microphone: false, camera: false })
  /** More than one camera: Flip is offered. */
  const cameraCount = ref(0)
  /** Speakers to choose from, where the browser allows it (desktop). */
  const speakers = ref<MediaDeviceInfo[]>([])
  const speakerId = ref<string | null>(null)

  let session: CallSession | null = null
  let expiryTimer: ReturnType<typeof setTimeout> | undefined
  let closeTimer: ReturnType<typeof setTimeout> | undefined
  let levelTimer: ReturnType<typeof setInterval> | undefined
  let snapshotQueued = false
  /** What was last dialled here, for "Call again" (a refused start has no call to look at). */
  const lastDialled = ref<{ chatId: string; kind: DirectCallKind } | null>(null)
  /** End was pressed while `POST /calls` was still on its way: cancel the call as soon as it exists. */
  let cancelWhenStarted = false
  /** Goes up whenever a call ends or another begins: late answers for the old one are dropped. */
  let generation = 0
  /** Calls handled by another tab of this browser (answered or declined there): not shown again here. */
  const handledElsewhere = new Set<string>()
  const wakeLock = new ScreenWakeLock()

  const me = computed(() => auth.user?.id ?? '')
  const phase = computed(() => machine.value.phase)
  const ending = computed(() => machine.value.ending)
  const direction = computed(() => machine.value.direction)
  const live = computed(() => isLive(machine.value.phase))
  /** Anything to draw (a live call, or its closing screen). */
  const visible = computed(() => machine.value.phase !== 'idle')
  const kind = computed<DirectCallKind>(() => call.value?.kind ?? lastDialled.value?.kind ?? 'voice')
  /** The chat the call is in (also when a refused start left no call). */
  const chatId = computed(() => call.value?.chat_id ?? lastDialled.value?.chatId ?? null)
  /** The other person. */
  const peer = computed<PublicUser | null>(() => {
    const current = call.value
    if (current) return current.caller?.id === me.value ? current.callee : current.caller
    // A start that was refused ("busy") has no call: the chat says who it was for.
    return chatId.value ? (chats.get(chatId.value)?.other_user ?? null) : null
  })
  const local = computed(() => participants.value.find((person) => person.isLocal) ?? null)
  const remote = computed(() => participants.value.find((person) => !person.isLocal) ?? null)
  /** This tab is the one that rings (the others show a small banner). */
  const ringsHere = computed(() => tabLeader.leader.value)
  /** In a group meeting right now: an incoming call is a banner there, not a full screen. */
  const inMeeting = computed(() => ui.callOpen)
  const closing = computed(() => (machine.value.ending ? closingOf(machine.value.ending, machine.value.direction) : null))

  const ringSettings = (): { sound: boolean; vibrate: boolean } => ({
    sound: auth.user?.settings?.call_ringtone !== false,
    vibrate: auth.user?.settings?.call_vibrate !== false,
  })

  function send(event: CallEvent): void {
    const before = machine.value
    const next = transition(before, event)
    if (next === before) return
    machine.value = next
    if (next.phase !== before.phase) onPhase(next, before)
  }

  /** Sounds, the wake lock and clean-up follow the phase. */
  function onPhase(next: CallMachine, before: CallMachine): void {
    if (before.phase === 'incoming' && call.value) void closeCallNotification(call.value.id)
    if (next.phase === 'incoming') {
      updateRinging()
      interruptRecording()
    } else if (next.phase === 'ringing') {
      ringer.ringback(ringSettings())
    } else {
      ringer.stop()
    }

    if (isLive(next.phase)) void wakeLock.hold()
    if (next.phase === 'active') startLevels()
    if (next.phase === 'ended' && isLive(before.phase)) finishUp()
  }

  function updateRinging(): void {
    if (machine.value.phase !== 'incoming') return
    // Only one tab rings; in a meeting the banner rings quietly (the meeting's sound must stay clear).
    if (ringsHere.value && !inMeeting.value) ringer.ring(ringSettings())
    else if (ringsHere.value) ringer.ring({ sound: false, vibrate: ringSettings().vibrate })
    else ringer.stop()
  }

  /* -------------------------------------------------------------------------------------- outgoing --- */

  /** Rings the other person of a direct chat. Does nothing while another call is on. */
  async function start(chatId: string, callKind: DirectCallKind): Promise<void> {
    if (live.value) {
      ui.toast(t('directCall.alreadyInCall'), 'error')
      return
    }
    clearClosing()
    const asked = ++generation
    lastDialled.value = { chatId, kind: callKind }
    cancelWhenStarted = false
    call.value = null
    endedSeconds.value = null
    expanded.value = true
    send({ type: 'start' })
    // A call needs sound: a tap started it, so the page may play sound from now on.
    void ringer.unlock()

    let started: DirectCall
    try {
      started = await callsApi.startCall(chatId, callKind)
    } catch (error) {
      cancelWhenStarted = false
      if (asked === generation) send({ type: 'start-failed', ending: startFailure(toApiError(error)) })
      return
    }
    // The person pressed End while the request was on its way: the call is cancelled now it exists.
    if (cancelWhenStarted) {
      cancelWhenStarted = false
      void callsApi.cancelCall(started.id).catch(() => undefined)
      return
    }
    if (asked !== generation) return
    call.value = started
    tabLeader.own(started.id)
    send({ type: 'started' })
    scheduleExpiry(started)
    void connectMedia({ camera: callKind === 'video' })
  }

  /* -------------------------------------------------------------------------------------- incoming --- */

  /**
   * A call as the server sees it now, from `call.incoming` and the other events, `GET /calls/current`, a push, or the
   * `/calls/:id` page. Safe to call twice with the same thing.
   */
  function receive(next: DirectCall): void {
    const current = call.value
    if (current && current.id === next.id) return update(next)
    if (live.value) return // one call at a time (the server says "busy" to anyone else)
    if (handledElsewhere.has(next.id)) return

    const mine = next.caller?.id === me.value
    if (next.status === 'ringing') {
      if (Date.parse(next.ring_expires_at) <= Date.now()) return
      clearClosing()
      ++generation
      call.value = next
      endedSeconds.value = null
      expanded.value = true
      if (mine) {
        // Reloaded while your own call rang: ring on, and get the media ready again.
        send({ type: 'resume-ringing' })
        tabLeader.own(next.id)
        scheduleExpiry(next)
        void connectMedia({ camera: next.kind === 'video' })
      } else {
        send({ type: 'incoming' })
        scheduleExpiry(next)
      }
      return
    }
    if (next.status === 'ongoing') void resume(next)
  }

  /** News about the call on screen. */
  function update(next: DirectCall): void {
    call.value = next
    if (next.status === 'ongoing') {
      if (machine.value.direction === 'outgoing') send({ type: 'answered' })
      else if (machine.value.phase === 'incoming') send({ type: 'answered-elsewhere' })
      return
    }
    if (next.status === 'ringing') return
    endedSeconds.value = next.duration_seconds
    send({ type: 'finished', ending: endingOf(next, me.value) })
  }

  /** After a reload or a reconnect: an answered call joins again, unless another tab of this browser is in it. */
  async function resume(ongoing: DirectCall): Promise<void> {
    const asked = ++generation
    if (await tabLeader.otherTabOwns(ongoing.id)) return
    if (asked !== generation || live.value) return
    clearClosing()
    call.value = ongoing
    endedSeconds.value = null
    expanded.value = true
    tabLeader.own(ongoing.id)
    send({ type: 'resume-ongoing', direction: ongoing.caller?.id === me.value ? 'outgoing' : 'incoming' })
    void connectMedia({ camera: false, rejoining: true })
  }

  /** The callee answers (`withVideo: false` is "Answer without video"). */
  async function accept(withVideo = true): Promise<void> {
    const current = call.value
    if (!current || machine.value.phase !== 'incoming') return
    const asked = generation
    send({ type: 'accept' })
    void ringer.unlock()

    let accepted: DirectCall
    try {
      accepted = await callsApi.acceptCall(current.id)
    } catch (error) {
      if (asked !== generation) return
      const conflict = callsApi.callInConflict(error)
      if (conflict) call.value = conflict
      send({ type: 'accept-failed', ending: acceptFailure(toApiError(error), conflict) })
      return
    }
    if (asked !== generation) return
    call.value = accepted
    tabLeader.announceHandled(accepted.id, 'answered')
    tabLeader.own(accepted.id)
    send({ type: 'accepted' })
    void connectMedia({ camera: accepted.kind === 'video' && withVideo })
  }

  /** The callee says no. */
  function decline(): void {
    const current = call.value
    if (!current || machine.value.phase !== 'incoming') return
    send({ type: 'hang-up' })
    tabLeader.announceHandled(current.id, 'declined')
    void callsApi.declineCall(current.id).catch(() => undefined)
  }

  /** End: cancels while it rings, ends once it is answered. */
  function hangUp(): void {
    const current = call.value
    const before = machine.value.phase
    if (before === 'incoming') return decline()
    if (!isLive(before)) return
    send({ type: 'hang-up' })
    if (!current || before === 'starting') {
      cancelWhenStarted = true // `start` cancels it when the answer arrives
      return
    }
    if (before === 'ringing') void callsApi.cancelCall(current.id).then(applyFinal, () => undefined)
    else void callsApi.endCall(current.id).then(applyFinal, () => undefined)
  }

  /** The server's own answer to End: the length it measured is the one shown. */
  function applyFinal(final: DirectCall): void {
    if (!final?.id || call.value?.id !== final.id) return
    call.value = final
    if (final.duration_seconds !== null) endedSeconds.value = final.duration_seconds
  }

  /* ----------------------------------------------------------------------------------------- media --- */

  async function connectMedia(options: { camera: boolean; rejoining?: boolean }): Promise<void> {
    const current = call.value
    if (!current) return
    const asked = generation

    for (let attempt = 1; attempt <= (options.rejoining ? REJOIN_ATTEMPTS : 1); attempt += 1) {
      try {
        const joined = await roomsApi.joinRoom(current.room_id)
        if (asked !== generation) return
        if (joined.status !== 'admitted') throw new Error('A call room never has a waiting room.')

        const { CallSession: Session } = await loadSession()
        if (asked !== generation) return
        const next: CallSession = new Session(me.value, sessionEvents(() => session === next))
        session = next
        await next.connect(joined.livekit_url, joined.token, { micOn: true, cameraOn: options.camera })
        if (asked !== generation || session !== next) {
          await next.leave().catch(() => undefined)
          return
        }
        reconnecting.value = false
        takeSnapshot()
        send({ type: 'media-ready' })
        void loadDevices()
        return
      } catch (error) {
        session = null
        if (asked !== generation) return
        // The room is closed: the call is over. Ask how it ended.
        if (toApiError(error).code === 'room_ended') return settleFromServer(current.id)
        if (attempt < (options.rejoining ? REJOIN_ATTEMPTS : 1)) await delay(REJOIN_DELAY_MS * attempt)
        if (asked !== generation) return
      }
    }
    send({ type: options.rejoining ? 'connection-lost' : 'failed' })
    // Tell the server too, so the other person is not left waiting.
    if (machine.value.ending === 'failed' || machine.value.ending === 'connection-lost') void giveUp(current)
  }

  async function giveUp(current: DirectCall): Promise<void> {
    const action = current.status === 'ringing' && current.caller?.id === me.value ? callsApi.cancelCall : current.status === 'ongoing' ? callsApi.endCall : null
    await action?.(current.id).catch(() => undefined)
  }

  /** How did the call end? (When we only know that its room is closed.) */
  async function settleFromServer(callId: string): Promise<void> {
    const asked = generation
    try {
      const latest = await callsApi.getCall(callId)
      if (asked !== generation) return
      if (latest.status === 'ringing' || latest.status === 'ongoing') return send({ type: 'connection-lost' })
      update(latest)
    } catch {
      if (asked === generation) send({ type: 'connection-lost' })
    }
  }

  function sessionEvents(current: () => boolean): CallSessionEvents {
    return {
      changed: () => current() && queueSnapshot(),
      reconnecting: (active) => {
        if (current()) reconnecting.value = active
      },
      disconnected: () => {
        if (!current()) return
        session = null
        participants.value = []
        // A drop LiveKit could not get back by itself: join again (the token may simply have run out).
        if (isLive(machine.value.phase)) {
          reconnecting.value = true
          void connectMedia({ camera: local.value?.cameraOn ?? false, rejoining: true })
        }
      },
      chat: () => undefined,
      audioBlocked: (blocked) => {
        if (current()) audioBlocked.value = blocked
      },
      mediaFailed: (mediaKind, problem) => {
        if (current() && mediaKind !== 'screen') ui.toast(t(`call.media.${mediaKind}.${problem}`), 'error')
      },
    }
  }

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
    participants.value = session.snapshot()
    // The other person is in the room: they answered, even if `call.accepted` has not arrived yet.
    if (participants.value.some((person) => !person.isLocal)) send({ type: 'answered' })
  }

  function startLevels(): void {
    clearInterval(levelTimer)
    levelTimer = setInterval(() => {
      const other = remote.value
      remoteLevel.value = session && other ? session.audioLevelOf(other.id) : 0
    }, LEVEL_POLL_MS)
  }

  async function loadDevices(): Promise<void> {
    try {
      const media = await loadMedia()
      cameraCount.value = (await media.listDevices('videoinput')).length
      speakers.value = media.canPickSpeaker() ? (await media.listDevices('audiooutput')).filter((device) => device.deviceId !== '') : []
      speakerId.value = session?.activeDevice('audiooutput') ?? null
    } catch {
      cameraCount.value = 0
      speakers.value = []
    }
  }

  async function toggleMicrophone(): Promise<void> {
    if (!session || mediaBusy.microphone) return
    mediaBusy.microphone = true
    try {
      await session.setMicrophone(!(local.value?.micOn ?? false))
    } finally {
      mediaBusy.microphone = false
    }
  }

  /** Video calls only (a voice call's token cannot publish a camera). */
  async function toggleCamera(): Promise<void> {
    if (!session || mediaBusy.camera || kind.value !== 'video') return
    mediaBusy.camera = true
    try {
      await session.setCamera(!(local.value?.cameraOn ?? false))
    } finally {
      mediaBusy.camera = false
    }
  }

  /** The next camera (front and back on a phone). */
  async function flipCamera(): Promise<void> {
    if (!session || mediaBusy.camera) return
    mediaBusy.camera = true
    try {
      const media = await loadMedia()
      const cameras = await media.listDevices('videoinput')
      if (cameras.length < 2) return
      const active = session.activeDevice('videoinput')
      const index = cameras.findIndex((camera) => camera.deviceId === active)
      const next = cameras[(index + 1) % cameras.length]
      if (next) await session.switchDevice('videoinput', next.deviceId)
    } catch {
      ui.toast(t('directCall.flipFailed'), 'error')
    } finally {
      mediaBusy.camera = false
    }
  }

  async function chooseSpeaker(deviceId: string): Promise<void> {
    if (!session) return
    try {
      await session.switchDevice('audiooutput', deviceId)
      speakerId.value = deviceId
    } catch {
      ui.toast(t('directCall.speakerFailed'), 'error')
    }
  }

  async function startAudio(): Promise<void> {
    await session?.startAudio().catch(() => undefined)
  }

  /* --------------------------------------------------------------------------------------- the end --- */

  function scheduleExpiry(ringing: DirectCall): void {
    clearTimeout(expiryTimer)
    const wait = Date.parse(ringing.ring_expires_at) - Date.now() + EXPIRY_GRACE_MS
    expiryTimer = setTimeout(() => {
      if (call.value?.id === ringing.id) send({ type: 'expired' })
    }, Math.max(0, wait))
  }

  /** The call is over: let go of everything, then show the closing screen for as long as it says. */
  function finishUp(): void {
    generation += 1
    clearTimeout(expiryTimer)
    clearInterval(levelTimer)
    ringer.stop()
    const ending = session
    session = null
    void ending?.leave().catch(() => undefined)
    void wakeLock.release()
    tabLeader.own(null)
    participants.value = []
    reconnecting.value = false
    audioBlocked.value = false
    remoteLevel.value = 0
    // A call that ended while minimized comes back to say so.
    expanded.value = true
    if (endedSeconds.value === null && call.value?.answered_at) {
      endedSeconds.value = Math.max(0, Math.round((Date.now() - Date.parse(call.value.answered_at)) / 1000))
    }

    // A call that only ever rang as a banner (in a meeting, or in another tab) just goes away.
    if (machine.value.direction === 'incoming' && !machine.value.answered && (inMeeting.value || !ringsHere.value)) return dismiss()
    const after = closing.value?.closeAfterMs ?? null
    if (after !== null) closeTimer = setTimeout(dismiss, after)
  }

  function clearClosing(): void {
    clearTimeout(closeTimer)
    closeTimer = undefined
  }

  /** Closes the closing screen. */
  function dismiss(): void {
    clearClosing()
    if (machine.value.phase !== 'ended') return
    machine.value = IDLE
    call.value = null
    endedSeconds.value = null
  }

  /** "Call again" on the closing screen. */
  async function callAgain(): Promise<void> {
    const previous = call.value ? { chatId: call.value.chat_id, kind: call.value.kind } : lastDialled.value
    if (!previous) return
    dismiss()
    await start(previous.chatId, previous.kind)
  }

  /** Signing out (or leaving the app): hang up quietly and forget everything. */
  function reset(): void {
    if (live.value) hangUp()
    generation += 1
    clearClosing()
    clearTimeout(expiryTimer)
    clearInterval(levelTimer)
    ringer.stop()
    const ending = session
    session = null
    void ending?.leave().catch(() => undefined)
    void wakeLock.release()
    tabLeader.own(null)
    machine.value = IDLE
    call.value = null
    participants.value = []
    reconnecting.value = false
    audioBlocked.value = false
    endedSeconds.value = null
    expanded.value = true
    handledElsewhere.clear()
  }

  function expand(): void {
    expanded.value = true
  }

  function minimize(): void {
    if (live.value && !isRingingIncoming()) expanded.value = false
  }

  function isRingingIncoming(): boolean {
    return machine.value.phase === 'incoming'
  }

  /* ---------------------------------------------------------------------------------- staying in step --- */

  let resyncing: Promise<void> | null = null

  /**
   * Asks the server how things stand (on start, after every WebSocket reconnect): a call ringing for you shows the
   * incoming screen, an answered one is joined again, and a call we thought was on but the server has finished ends.
   */
  function resync(): Promise<void> {
    if (!auth.user) return Promise.resolve()
    resyncing ??= (async () => {
      try {
        const current = await callsApi.currentCall()
        const shown = call.value
        if (current) return receive(current)
        if (shown && live.value && machine.value.phase !== 'starting') await settleFromServer(shown.id)
      } catch {
        // the next reconnect asks again
      } finally {
        resyncing = null
      }
    })()
    return resyncing
  }

  /** A call from a push or the `/calls/:id` page. `answer`: the notification's Answer button. */
  async function openCall(callId: string, options: { answer?: boolean } = {}): Promise<DirectCall | null> {
    let found: DirectCall
    try {
      found = await callsApi.getCall(callId)
    } catch {
      return null
    }
    if (!found?.id) return null
    receive(found)
    if (options.answer && call.value?.id === found.id && machine.value.phase === 'incoming') await accept()
    return found
  }

  // Another tab of this browser answered or declined: this one closes without a word.
  tabLeader.onHandled(({ callId }) => {
    handledElsewhere.add(callId)
    if (call.value?.id !== callId || machine.value.phase !== 'incoming') return
    generation += 1
    clearTimeout(expiryTimer)
    ringer.stop()
    machine.value = IDLE
    call.value = null
  })

  // Focus moved to another tab (or into a meeting): the ringing follows.
  watch([ringsHere, inMeeting], () => updateRinging())

  watch(
    () => connection.status,
    (status, before) => {
      if (status === 'connected' && before !== 'connected') void resync()
    },
  )

  return {
    machine,
    call,
    expanded,
    participants,
    reconnecting,
    audioBlocked,
    remoteLevel,
    endedSeconds,
    mediaBusy,
    cameraCount,
    speakers,
    speakerId,
    phase,
    ending,
    direction,
    live,
    visible,
    kind,
    chatId,
    peer,
    local,
    remote,
    ringsHere,
    inMeeting,
    closing,
    start,
    receive,
    accept,
    decline,
    hangUp,
    toggleMicrophone,
    toggleCamera,
    flipCamera,
    chooseSpeaker,
    startAudio,
    dismiss,
    callAgain,
    reset,
    expand,
    minimize,
    resync,
    openCall,
  }
})

export type { CallEnding }
