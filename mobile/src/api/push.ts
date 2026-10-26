// The phone app's own push registration (the web app uses web push subscriptions instead). See docs/API.md, 6.4.
import { http } from '@/api/http'
import type { Single } from '@/types/api'

export interface NativePushRegistration {
  id: string
  platform: 'android' | 'ios'
  has_voip_token: boolean
  app_version: string | null
  last_seen_at: string
  created_at: string
}

export interface NativePushTokenInput {
  platform: 'android' | 'ios'
  /** The FCM registration token (Android) or the APNs device token in hex (iOS). Never logged. */
  token: string
  voip_token?: string | null
  app_version?: string | null
}

/** Safe to repeat: the same token refreshes its registration (200) instead of adding one (201). */
export async function registerNativePushToken(input: NativePushTokenInput): Promise<NativePushRegistration> {
  const { data } = await http.post<Single<NativePushRegistration>>('/push/native-tokens', input)
  return data.data
}

/** 204; someone else's (or an already removed) registration answers 404. */
export async function removeNativePushToken(id: string): Promise<void> {
  await http.delete(`/push/native-tokens/${id}`)
}
