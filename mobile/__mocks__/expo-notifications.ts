// A stand-in for the notification system in tests: permission, the device token and channels are plain values a
// test can set, and every call is recorded. Nothing is ever shown or sent.

export const AndroidImportance = { MIN: 3, LOW: 4, DEFAULT: 5, HIGH: 6, MAX: 7 } as const

interface Permission {
  granted: boolean
  canAskAgain: boolean
  status: 'granted' | 'denied' | 'undetermined'
}

const state = {
  permission: { granted: false, canAskAgain: true, status: 'undetermined' } as Permission,
  /** What the system answers when the app asks (requestPermissionsAsync). */
  answer: 'granted' as 'granted' | 'denied' | 'blocked',
  token: 'fake-device-token',
  tokenError: null as Error | null,
  channels: {} as Record<string, { name: string; importance: number }>,
  requests: 0,
  tokenListeners: new Set<(token: { type: string; data: string }) => void>(),
}

export async function getPermissionsAsync(): Promise<Permission> {
  return { ...state.permission }
}

export async function requestPermissionsAsync(): Promise<Permission> {
  state.requests += 1
  state.permission =
    state.answer === 'granted'
      ? { granted: true, canAskAgain: true, status: 'granted' }
      : { granted: false, canAskAgain: state.answer === 'denied', status: 'denied' }
  return { ...state.permission }
}

export async function getDevicePushTokenAsync(): Promise<{ type: string; data: string }> {
  if (state.tokenError) throw state.tokenError
  return { type: 'android', data: state.token }
}

export async function setNotificationChannelAsync(id: string, channel: { name: string; importance: number }) {
  state.channels[id] = channel
  return channel
}

export function addPushTokenListener(listener: (token: { type: string; data: string }) => void) {
  state.tokenListeners.add(listener)
  return { remove: () => state.tokenListeners.delete(listener) }
}

/** For tests. */
export const __state = state

export function __grant(): void {
  state.permission = { granted: true, canAskAgain: true, status: 'granted' }
}

export function __emitToken(token: string): void {
  state.token = token
  for (const listener of state.tokenListeners) listener({ type: 'android', data: token })
}

export function __reset(): void {
  state.permission = { granted: false, canAskAgain: true, status: 'undetermined' }
  state.answer = 'granted'
  state.token = 'fake-device-token'
  state.tokenError = null
  state.channels = {}
  state.requests = 0
  state.tokenListeners.clear()
}
