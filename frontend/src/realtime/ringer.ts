import { ref, type Ref } from 'vue'

/**
 * The sounds of a call, made with the Web Audio API (no recorded sound is shipped): a two-tone ring for an incoming
 * call, a single-tone ringback while your own call rings, and the phone's vibration.
 *
 * Browsers play no sound until the person has pressed something on the page. The first tap or key press of the session
 * unlocks the audio (`install`); a call that rings before that shows silently, with vibration, and `blocked` says so.
 */

/** Ringtone: about 1 s of ringing, then 2 s of silence. */
export const RING_CYCLE_MS = 3000
/** Ringback: 1 s of tone, then 3 s of silence. */
export const RINGBACK_CYCLE_MS = 4000
export const VIBRATION_PATTERN: readonly number[] = [500, 250, 500]

/** Two notes that alternate quickly make the "ring" (original, not any phone maker's). */
const RING_NOTES = [784, 659] as const
const RING_NOTE_S = 0.1
const RING_ON_S = 1
const RINGBACK_HZ = 440
const RINGBACK_ON_S = 1
const VOLUME = 0.18

type Playing = 'ring' | 'ringback' | null

export interface RingOptions {
  sound: boolean
  vibrate: boolean
}

type AudioContextConstructor = new () => AudioContext

function audioContextClass(): AudioContextConstructor | null {
  if (typeof window === 'undefined') return null
  const legacy = (window as unknown as { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext
  return (window.AudioContext as AudioContextConstructor | undefined) ?? legacy ?? null
}

export class Ringer {
  /** Sound is wanted but the browser is not letting the page play it yet ("Tap to hear ringing"). */
  readonly blocked: Ref<boolean> = ref(false)
  private context: AudioContext | null = null
  private playing: Playing = null
  private soundTimer: ReturnType<typeof setInterval> | undefined
  private vibrateTimer: ReturnType<typeof setInterval> | undefined
  private unlocked = false
  private vibrating = false

  /** Unlocks the audio on the first tap or key press. Returns the function that stops listening. */
  install(target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window): () => void {
    const unlock = (): void => void this.unlock()
    const events = ['pointerdown', 'keydown', 'touchend'] as const
    for (const event of events) target.addEventListener(event, unlock, { capture: true, passive: true })
    return () => {
      for (const event of events) target.removeEventListener(event, unlock, { capture: true })
    }
  }

  /** Called from a tap: lets the page play sound from now on (and starts a ring that was waiting for it). */
  async unlock(): Promise<void> {
    const context = this.ensureContext()
    if (!context) return
    try {
      if (context.state !== 'running') await context.resume()
    } catch {
      return
    }
    this.unlocked = context.state === 'running'
    if (this.unlocked) this.blocked.value = false
  }

  /** Has the page been allowed to play sound in this session? */
  isUnlocked(): boolean {
    return this.unlocked && this.context?.state === 'running'
  }

  /** An incoming call: the ringtone (if wanted) and the vibration (if wanted and the device can). */
  ring(options: RingOptions): void {
    this.stop()
    this.playing = 'ring'
    if (options.sound) this.loop(() => this.playRing(), RING_CYCLE_MS)
    if (options.vibrate) this.startVibration()
  }

  /** Your call is ringing on their side. */
  ringback(options: Pick<RingOptions, 'sound'>): void {
    this.stop()
    this.playing = 'ringback'
    if (options.sound) this.loop(() => this.playRingback(), RINGBACK_CYCLE_MS)
  }

  stop(): void {
    this.playing = null
    clearInterval(this.soundTimer)
    clearInterval(this.vibrateTimer)
    this.soundTimer = undefined
    this.vibrateTimer = undefined
    this.blocked.value = false
    // Cancels a vibration still going (only one this ringer started).
    if (this.vibrating && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(0)
    this.vibrating = false
  }

  /** What is sounding now (for tests and the screen). */
  current(): Playing {
    return this.playing
  }

  /* ----------------------------------------------------------------------------------------- inside --- */

  private ensureContext(): AudioContext | null {
    if (this.context && this.context.state !== 'closed') return this.context
    const Context = audioContextClass()
    if (!Context) return null
    try {
      this.context = new Context()
    } catch {
      this.context = null
    }
    return this.context
  }

  private loop(play: () => void, cycleMs: number): void {
    const context = this.ensureContext()
    if (!context) return
    // Not allowed to play yet: say so, and try (a page the person has used may resume without a new tap).
    if (context.state !== 'running') {
      this.blocked.value = true
      void context.resume().then(
        () => {
          if (context.state === 'running') this.blocked.value = false
        },
        () => undefined,
      )
    }
    play()
    this.soundTimer = setInterval(play, cycleMs)
  }

  private tone(frequencies: readonly number[], noteSeconds: number, totalSeconds: number): void {
    const context = this.context
    if (!context || context.state !== 'running') return
    const start = context.currentTime + 0.02
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'sine'
    // Each note in turn for the whole "on" time; the volume fades in and out so it does not click.
    const steps = Math.max(1, Math.round(totalSeconds / noteSeconds))
    for (let i = 0; i < steps; i++) oscillator.frequency.setValueAtTime(frequencies[i % frequencies.length] ?? frequencies[0] ?? RINGBACK_HZ, start + i * noteSeconds)
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(VOLUME, start + 0.03)
    gain.gain.setValueAtTime(VOLUME, start + totalSeconds - 0.05)
    gain.gain.linearRampToValueAtTime(0, start + totalSeconds)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start(start)
    oscillator.stop(start + totalSeconds + 0.05)
  }

  private playRing(): void {
    this.tone(RING_NOTES, RING_NOTE_S, RING_ON_S)
  }

  private playRingback(): void {
    this.tone([RINGBACK_HZ], RINGBACK_ON_S, RINGBACK_ON_S)
  }

  private startVibration(): void {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
    const vibrate = (): void => {
      navigator.vibrate([...VIBRATION_PATTERN])
    }
    this.vibrating = true
    vibrate()
    this.vibrateTimer = setInterval(vibrate, RING_CYCLE_MS)
  }
}

/** The app's one ringer. */
export const ringer = new Ringer()
