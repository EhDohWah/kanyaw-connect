import { defineStore } from 'pinia'
import { ref } from 'vue'

import * as pushApi from '@/api/push'
import { browserPush } from '@/push/browser'
import { useAuthStore } from '@/stores/auth'
import { readStorage, removeStorage, writeStorage } from '@/utils/storage'

/**
 * Where notifications stand on this browser.
 * - `idle`: not looked at yet; `checking`: asking the server and the browser.
 * - `unsupported`: this browser cannot show them (on an iPhone: not until the app is on the Home Screen).
 * - `unavailable`: the server has push switched off, so the option is hidden.
 * - `blocked`: notifications were refused for this site; only the browser's own settings can allow them again.
 * - `off`, `on`.
 * - `failed`: the state could not be checked (no network, say).
 */
export type PushStatus = 'idle' | 'checking' | 'unsupported' | 'unavailable' | 'blocked' | 'off' | 'on' | 'failed'

/** Who turned notifications on in this browser. Signing out ends them; when that person signs in again they come back. */
export const PUSH_OWNER_KEY = 'kc.pushFor'

export const usePushStore = defineStore('push', () => {
  const auth = useAuthStore()

  const status = ref<PushStatus>('idle')
  /** Turning on or off. */
  const busy = ref(false)
  /** Why the last check, or turning on or off, failed. */
  const error = ref<unknown>(null)
  /** The server's id for this browser's subscription. */
  const subscriptionId = ref<string | null>(null)
  let publicKey: string | null = null

  /** Bumped on sign-out: whatever was asked before it must not change anything after. */
  let generation = 0
  /** One step at a time (check, turn on, turn off, restore), so two cannot cross. */
  let queue: Promise<unknown> = Promise.resolve()

  function run<T>(task: (asked: number) => Promise<T>): Promise<T> {
    const asked = generation
    const next = queue.then(() => task(asked))
    queue = next.catch(() => undefined)
    return next
  }

  function remember(): void {
    if (auth.user) writeStorage(PUSH_OWNER_KEY, auth.user.id)
  }

  /** The server's id for this browser's subscription, if the browser has one and the server knows it. */
  async function knownId(): Promise<string | null> {
    const mine = await browserPush().current()
    if (!mine) return null
    const known = (await pushApi.listSubscriptions()).find((entry) => entry.endpoint === mine.endpoint)
    return known?.id ?? null
  }

  /** Works out where things stand. The Settings page asks when it opens, and again when the person comes back to it. */
  async function check(): Promise<void> {
    const push = browserPush()
    if (!push.supported()) {
      status.value = 'unsupported'
      return
    }
    // Keep showing what is known while asking again; show "checking" only when nothing is.
    if (status.value === 'idle' || status.value === 'failed') status.value = 'checking'

    await run(async (asked) => {
      if (asked !== generation) return
      try {
        const key = await pushApi.getPublicKey()
        if (asked !== generation) return
        if (!key.enabled || !key.public_key) {
          status.value = 'unavailable'
          return
        }
        publicKey = key.public_key
        if (push.permission() === 'denied') {
          subscriptionId.value = null
          status.value = 'blocked'
          return
        }
        const id = await knownId()
        if (asked !== generation) return
        subscriptionId.value = id
        status.value = id ? 'on' : 'off'
        error.value = null
        if (id) remember()
      } catch (caught) {
        if (asked !== generation) return
        error.value = caught
        status.value = 'failed'
      }
    })
  }

  /** The switch was turned on. Must be called straight from the tap (the browser may ask the person). */
  async function turnOn(): Promise<void> {
    const push = browserPush()
    const key = publicKey
    if (busy.value || !key) return
    const started = generation
    busy.value = true
    error.value = null

    // Before anything else, while still answering the tap: Safari shows the question only in direct answer to one.
    const asking = push.permission() === 'default' ? push.requestPermission() : Promise.resolve(push.permission())
    try {
      await run(async (asked) => {
        const permission = await asking
        if (asked !== generation) return
        if (permission === 'denied') {
          status.value = 'blocked'
          return
        }
        // Closed without answering: nothing changes, and they can try again.
        if (permission !== 'granted') return

        const saved = await pushApi.addSubscription(await push.subscribe(key))
        if (asked !== generation) return
        subscriptionId.value = saved.id
        status.value = 'on'
        remember()
      })
    } catch (caught) {
      if (started === generation) error.value = caught
    } finally {
      if (started === generation) busy.value = false
    }
  }

  async function turnOff(): Promise<void> {
    if (busy.value) return
    const push = browserPush()
    const started = generation
    busy.value = true
    error.value = null

    try {
      await run(async (asked) => {
        // The browser's subscription goes first: once it is gone nothing can arrive here, even if the server is not
        // reached (it forgets the subscription by itself when the push service says it is gone).
        const unsubscribed = await push.unsubscribe().then(
          () => true,
          () => false,
        )
        const id = subscriptionId.value
        if (id) {
          try {
            await pushApi.removeSubscription(id)
          } catch (caught) {
            if (!unsubscribed) throw caught
          }
        }
        if (asked !== generation) return
        subscriptionId.value = null
        status.value = 'off'
        removeStorage(PUSH_OWNER_KEY)
      })
    } catch (caught) {
      if (started === generation) error.value = caught
    } finally {
      if (started === generation) busy.value = false
    }
  }

  /**
   * After signing in (and when the service worker says the browser changed the subscription): if this person had
   * notifications on in this browser, turn them back on. Only when the browser already allows notifications, so nobody
   * is asked anything. Failing is quiet: the Settings page shows the state when it is opened.
   */
  function restore(): Promise<void> {
    const push = browserPush()
    const user = auth.user
    if (!user || !push.supported() || push.permission() !== 'granted' || readStorage(PUSH_OWNER_KEY) !== user.id) {
      return Promise.resolve()
    }

    return run(async (asked) => {
      if (asked !== generation) return
      const key = await pushApi.getPublicKey()
      if (asked !== generation || !key.enabled || !key.public_key) return
      publicKey = key.public_key
      // Known already (a reload): nothing to send. Otherwise register again: the server dropped it at sign-out.
      const id = (await knownId()) ?? (await pushApi.addSubscription(await push.subscribe(key.public_key))).id
      if (asked !== generation) return
      subscriptionId.value = id
      status.value = 'on'
    }).catch(() => undefined)
  }

  /**
   * Signing out. The server ends the subscriptions of that sign-in; the browser's goes too, so that nothing more can
   * arrive here even if the server could not be told (the next person on this browser must not see them).
   */
  function forget(): void {
    generation += 1
    status.value = 'idle'
    busy.value = false
    error.value = null
    subscriptionId.value = null
    publicKey = null

    const push = browserPush()
    if (push.supported()) void run(() => push.unsubscribe()).catch(() => undefined)
  }

  return { status, busy, error, subscriptionId, check, turnOn, turnOff, restore, forget }
})
