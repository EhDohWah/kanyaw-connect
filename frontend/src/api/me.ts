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

/** `avatar` is sent as multipart form data: JPEG, PNG or WebP, at most 2 MB. */
export async function uploadAvatar(file: Blob, onProgress?: (percent: number) => void): Promise<User> {
  const form = new FormData()
  form.append('avatar', file, file instanceof File ? file.name : 'avatar')

  const { data } = await http.post<Single<User>>('/me/avatar', form, {
    timeout: 60_000,
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
