import { ref, type Ref } from 'vue'

import { uuid } from '@/utils/uuid'

/**
 * The app's open tabs in this browser agree, over a `BroadcastChannel`, on two things:
 *
 * - **Who rings.** Of the tabs, the visible one that was focused most recently shows the incoming-call screen and plays
 *   the sound; the others show a small banner. (When none is visible, the one focused last rings.)
 * - **Who has the call.** Only one tab is in a call. A tab that reloads, or reconnects, asks whether another tab already
 *   has it before joining (two tabs joining would push each other out of LiveKit).
 *
 * Every tab also tells the others when it answered or declined, so they all close at once.
 */

export interface TabInfo {
  id: string
  visible: boolean
  /** When it last had the focus (ms); 0 if never. */
  focusedAt: number
}

export type TabMessage =
  | { type: 'state'; tab: TabInfo; reply?: boolean }
  | { type: 'bye'; id: string }
  | { type: 'handled'; callId: string; by: string; how: 'answered' | 'declined' }
  | { type: 'owner?'; callId: string; from: string }
  | { type: 'owner'; callId: string; id: string }

export const CHANNEL_NAME = 'kanyaw-connect:calls'
/** Each tab says it is still there this often; one not heard from for `STALE_MS` is forgotten (it crashed). */
export const HEARTBEAT_MS = 10_000
export const STALE_MS = 25_000
/** How long to wait for "I have that call" before deciding nobody has it. */
export const OWNER_WAIT_MS = 300

/** Visible beats hidden, then the most recently focused, then the id (so every tab picks the same one). */
export function pickLeader(tabs: readonly TabInfo[]): string | null {
  let best: TabInfo | null = null
  for (const tab of tabs) {
    if (
      !best ||
      (tab.visible && !best.visible) ||
      (tab.visible === best.visible && (tab.focusedAt > best.focusedAt || (tab.focusedAt === best.focusedAt && tab.id < best.id)))
    ) {
      best = tab
    }
  }
  return best?.id ?? null
}

interface Peer extends TabInfo {
  seenAt: number
}

type ChannelLike = Pick<BroadcastChannel, 'postMessage' | 'close'> & {
  onmessage: ((event: MessageEvent) => void) | null
}

export type ChannelFactory = (name: string) => ChannelLike | null

const defaultFactory: ChannelFactory = (name) => (typeof BroadcastChannel === 'function' ? new BroadcastChannel(name) : null)

export class TabLeader {
  readonly id = uuid()
  /** This tab is the one that rings. */
  readonly leader: Ref<boolean> = ref(true)
  private channel: ChannelLike | null = null
  private readonly peers = new Map<string, Peer>()
  private visible = true
  private focusedAt = 0
  private ownedCall: string | null = null
  private readonly handledListeners = new Set<(message: Extract<TabMessage, { type: 'handled' }>) => void>()
  private readonly ownerWaits = new Map<string, () => void>()
  private heartbeat: ReturnType<typeof setInterval> | undefined

  constructor(
    private readonly factory: ChannelFactory = defaultFactory,
    private readonly now: () => number = Date.now,
  ) {}

  /** Joins the other tabs. Returns the function that leaves. */
  start(doc: Document = document, win: Window = window): () => void {
    this.visible = doc.visibilityState !== 'hidden'
    this.focusedAt = doc.hasFocus() ? this.now() : 0
    this.channel = this.factory(CHANNEL_NAME)
    if (this.channel) this.channel.onmessage = (event: MessageEvent) => this.receive(event.data as TabMessage)

    const onVisibility = (): void => {
      this.visible = doc.visibilityState !== 'hidden'
      if (this.visible && doc.hasFocus()) this.focusedAt = this.now()
      this.announce()
    }
    const onFocus = (): void => {
      this.focusedAt = this.now()
      this.announce()
    }
    const onLeave = (): void => this.post({ type: 'bye', id: this.id })

    doc.addEventListener('visibilitychange', onVisibility)
    win.addEventListener('focus', onFocus)
    win.addEventListener('pagehide', onLeave)
    this.heartbeat = setInterval(() => {
      this.dropStale()
      this.announce()
    }, HEARTBEAT_MS)
    this.announce()

    return () => {
      doc.removeEventListener('visibilitychange', onVisibility)
      win.removeEventListener('focus', onFocus)
      win.removeEventListener('pagehide', onLeave)
      clearInterval(this.heartbeat)
      onLeave()
      this.channel?.close()
      this.channel = null
      this.peers.clear()
      this.update()
    }
  }

  /** The tabs this one knows of, itself included. */
  tabs(): TabInfo[] {
    return [this.self(), ...[...this.peers.values()].map(({ id, visible, focusedAt }) => ({ id, visible, focusedAt }))]
  }

  isLeader(): boolean {
    return pickLeader(this.tabs()) === this.id
  }

  /** Tell the other tabs this call was answered or declined here: they close their screens. */
  announceHandled(callId: string, how: 'answered' | 'declined'): void {
    this.post({ type: 'handled', callId, by: this.id, how })
  }

  onHandled(listener: (message: Extract<TabMessage, { type: 'handled' }>) => void): () => void {
    this.handledListeners.add(listener)
    return () => this.handledListeners.delete(listener)
  }

  /** This tab is in that call now (`null`: in none). */
  own(callId: string | null): void {
    this.ownedCall = callId
    if (callId) this.post({ type: 'owner', callId, id: this.id })
  }

  /** Is another tab in this browser already in that call? Asks, and waits a moment for an answer. */
  otherTabOwns(callId: string, waitMs: number = OWNER_WAIT_MS): Promise<boolean> {
    if (!this.channel) return Promise.resolve(false)
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.ownerWaits.delete(callId)
        resolve(false)
      }, waitMs)
      this.ownerWaits.set(callId, () => {
        clearTimeout(timer)
        this.ownerWaits.delete(callId)
        resolve(true)
      })
      this.post({ type: 'owner?', callId, from: this.id })
    })
  }

  /* ----------------------------------------------------------------------------------------- inside --- */

  private self(): TabInfo {
    return { id: this.id, visible: this.visible, focusedAt: this.focusedAt }
  }

  private post(message: TabMessage): void {
    try {
      this.channel?.postMessage(message)
    } catch {
      // the channel was closed: this tab is on its own
    }
  }

  private announce(reply = false): void {
    this.post({ type: 'state', tab: this.self(), ...(reply ? { reply: true } : {}) })
    this.update()
  }

  private receive(message: TabMessage): void {
    if (!message || typeof message !== 'object') return
    switch (message.type) {
      case 'state': {
        if (message.tab.id === this.id) return
        const known = this.peers.has(message.tab.id)
        this.peers.set(message.tab.id, { ...message.tab, seenAt: this.now() })
        // A tab we did not know: tell it about us (but do not answer an answer).
        if (!known && !message.reply) this.announce(true)
        else this.update()
        return
      }
      case 'bye':
        this.peers.delete(message.id)
        this.update()
        return
      case 'handled':
        if (message.by !== this.id) for (const listener of this.handledListeners) listener(message)
        return
      case 'owner?':
        if (message.from !== this.id && this.ownedCall === message.callId) this.post({ type: 'owner', callId: message.callId, id: this.id })
        return
      case 'owner':
        if (message.id !== this.id) this.ownerWaits.get(message.callId)?.()
        return
    }
  }

  private dropStale(): void {
    const cutoff = this.now() - STALE_MS
    for (const [id, peer] of this.peers) if (peer.seenAt < cutoff) this.peers.delete(id)
  }

  private update(): void {
    this.leader.value = this.isLeader()
  }
}

/** This tab. */
export const tabLeader = new TabLeader()
