import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { audioState, useFakeAudio } from '@/__tests__/fakeAudio'
import { RINGBACK_CYCLE_MS, RING_CYCLE_MS, Ringer, VIBRATION_PATTERN } from '@/realtime/ringer'

let vibrate: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  useFakeAudio()
  vibrate = vi.fn(() => true)
  Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true, writable: true })
})

afterEach(() => {
  Reflect.deleteProperty(navigator, 'vibrate')
})

describe('the ringer', () => {
  it('rings with two alternating notes, again every 3 seconds, and vibrates 500-250-500', () => {
    const ringer = new Ringer()
    ringer.ring({ sound: true, vibrate: true })

    expect(ringer.current()).toBe('ring')
    expect(audioState.tones).toHaveLength(1)
    expect(new Set(audioState.tones[0])).toEqual(new Set([784, 659]))
    expect(vibrate).toHaveBeenLastCalledWith([...VIBRATION_PATTERN])
    expect(VIBRATION_PATTERN).toEqual([500, 250, 500])

    vi.advanceTimersByTime(RING_CYCLE_MS)
    expect(audioState.tones).toHaveLength(2)
    expect(vibrate).toHaveBeenCalledTimes(2)
    expect(RING_CYCLE_MS).toBe(3000)
  })

  it('plays a single-tone ringback while your own call rings', () => {
    const ringer = new Ringer()
    ringer.ringback({ sound: true })

    expect(ringer.current()).toBe('ringback')
    expect(new Set(audioState.tones[0])).toEqual(new Set([440]))
    expect(vibrate).not.toHaveBeenCalled()
    vi.advanceTimersByTime(RINGBACK_CYCLE_MS)
    expect(audioState.tones).toHaveLength(2)
  })

  it('stops the sound and the vibration', () => {
    const ringer = new Ringer()
    ringer.ring({ sound: true, vibrate: true })
    ringer.stop()

    expect(ringer.current()).toBeNull()
    expect(vibrate).toHaveBeenLastCalledWith(0)
    vi.advanceTimersByTime(RING_CYCLE_MS * 3)
    expect(audioState.tones).toHaveLength(1)
  })

  it('follows the settings: no ringtone, or no vibration', () => {
    const ringer = new Ringer()
    ringer.ring({ sound: false, vibrate: true })
    expect(audioState.tones).toHaveLength(0)
    expect(vibrate).toHaveBeenCalled()

    vibrate.mockClear()
    ringer.ring({ sound: true, vibrate: false })
    expect(audioState.tones).toHaveLength(1)
    expect(vibrate).not.toHaveBeenCalledWith([...VIBRATION_PATTERN])
  })

  it('before the first tap: rings silently, says so, and plays once the page is tapped', async () => {
    audioState.startState = 'suspended'
    audioState.resumeWorks = false
    const ringer = new Ringer()

    ringer.ring({ sound: true, vibrate: true })
    await Promise.resolve()

    expect(ringer.blocked.value).toBe(true)
    expect(audioState.tones).toHaveLength(0)
    expect(vibrate).toHaveBeenCalled() // the phone still vibrates

    // The tap: the browser lets the page play.
    audioState.resumeWorks = true
    await ringer.unlock()
    expect(ringer.blocked.value).toBe(false)
    expect(ringer.isUnlocked()).toBe(true)
    vi.advanceTimersByTime(RING_CYCLE_MS)
    expect(audioState.tones).toHaveLength(1)
  })

  it('unlocks on the first tap or key press of the session', async () => {
    audioState.startState = 'suspended'
    const ringer = new Ringer()
    const target = new EventTarget()
    const stop = ringer.install(target as unknown as Window)

    target.dispatchEvent(new Event('pointerdown'))
    await vi.waitFor(() => expect(audioState.contexts[0]?.resume).toHaveBeenCalled())
    expect(ringer.isUnlocked()).toBe(true)
    stop()
  })

  it('does nothing harmful where the Web Audio API or vibration is missing', () => {
    vi.stubGlobal('AudioContext', undefined)
    Reflect.deleteProperty(navigator, 'vibrate')
    const ringer = new Ringer()
    expect(() => ringer.ring({ sound: true, vibrate: true })).not.toThrow()
    expect(() => ringer.stop()).not.toThrow()
  })
})
