import { vi } from 'vitest'

import { setBrowserPush } from '@/push/browser'
import type { BrowserSubscription } from '@/types/push'

/** A subscription as Chrome gives it (the keys have the right lengths for the server's checks). */
export const SUBSCRIPTION: BrowserSubscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/dAbC12-example',
  expirationTime: null,
  keys: {
    p256dh: 'BAfdcVBP-fIMUGvJlOfSrSCDj-NTJ2XMt1kkyizswjqAxWAEf-crQpQhIYd4Ub4T3ieZHTKURw8mlOSuUOF9GLA',
    auth: '1rY-tSBOKoGQ7yb_puqBpw',
  },
}

export interface FakePushState {
  supported: boolean
  needsHomeScreen: boolean
  permission: NotificationPermission
  /** What the person answers when asked: `default` is closing the question without answering. */
  answer: NotificationPermission
  /** This browser's subscription now. */
  subscription: BrowserSubscription | null
  /** What subscribing gives when there is none yet. */
  next: BrowserSubscription
  failSubscribe: Error | null
  failUnsubscribe: Error | null
}

/**
 * A browser for push notifications that a test can drive: what it supports, what the person answers, its subscription,
 * and messages from the service worker (`send`). Installed for the app at once; `setBrowserPush(null)` (after each
 * test) puts the real one back.
 */
export function useFakePush(initial: Partial<FakePushState> = {}) {
  const state: FakePushState = {
    supported: true,
    needsHomeScreen: false,
    permission: 'default',
    answer: 'granted',
    subscription: null,
    next: SUBSCRIPTION,
    failSubscribe: null,
    failUnsubscribe: null,
    ...initial,
  }
  const listeners = new Set<(message: unknown) => void>()
  const permissionListeners = new Set<() => void>()

  const push = {
    state,
    supported: vi.fn(() => state.supported),
    needsHomeScreen: vi.fn(() => state.needsHomeScreen),
    permission: vi.fn(() => state.permission),
    requestPermission: vi.fn(async () => {
      state.permission = state.answer
      return state.answer
    }),
    current: vi.fn(async () => state.subscription),
    subscribe: vi.fn(async (_publicKey: string) => {
      if (state.failSubscribe) throw state.failSubscribe
      state.subscription ??= state.next
      return state.subscription
    }),
    unsubscribe: vi.fn(async () => {
      if (state.failUnsubscribe) throw state.failUnsubscribe
      state.subscription = null
    }),
    listen: vi.fn((handler: (message: unknown) => void) => {
      listeners.add(handler)
      return () => void listeners.delete(handler)
    }),
    onPermissionChange: vi.fn((handler: () => void) => {
      permissionListeners.add(handler)
      return () => void permissionListeners.delete(handler)
    }),
    /** The service worker posts a message to the page. */
    send(message: unknown): void {
      listeners.forEach((handler) => handler(message))
    },
    /** Notifications are allowed or blocked in the browser's own settings. */
    changePermission(next: NotificationPermission): void {
      state.permission = next
      permissionListeners.forEach((handler) => handler())
    },
  }

  setBrowserPush(push)
  return push
}
