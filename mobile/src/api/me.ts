// Ported from frontend/src/api/me.ts and frontend/src/api/presence.ts (the heartbeat).
import { http } from '@/api/http'
import type { Single } from '@/types/api'
import type { ProfilePatch, User, UserStatus } from '@/types/user'

export async function getMe(): Promise<User> {
  const { data } = await http.get<Single<User>>('/me')
  return data.data
}

export async function updateMe(patch: ProfilePatch): Promise<User> {
  const { data } = await http.patch<Single<User>>('/me', patch)
  return data.data
}

/** A picture prepared on the phone (see `utils/avatar.ts`): a local file to send as multipart form data. */
export interface AvatarFile {
  uri: string
  name: string
  type: 'image/jpeg' | 'image/png' | 'image/webp'
}

/** JPEG, PNG or WebP, at most 2 MB. React Native sends `{ uri, name, type }` parts as files. */
export async function uploadAvatar(file: AvatarFile, onProgress?: (percent: number) => void): Promise<User> {
  const form = new FormData()
  form.append('avatar', file as unknown as Blob)

  const { data } = await http.post<Single<User>>('/me/avatar', form, {
    timeout: 120_000,
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (event) => {
      if (onProgress && event.total) onProgress(Math.round((event.loaded / event.total) * 100))
    },
  })
  return data.data
}

/** Tells the server the app is open. 12 per minute at most; answers 204. */
export async function sendHeartbeat(status?: Exclude<UserStatus, 'offline'>): Promise<void> {
  await http.post('/me/heartbeat', status ? { status } : {})
}
