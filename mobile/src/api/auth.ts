// Ported from frontend/src/api/auth.ts.
import { http } from '@/api/http'
import type { Single } from '@/types/api'
import type { LoginResponse, RegisterInput, User } from '@/types/user'

/** `device_name` names the token on the server ("Pixel 7 (Android)"), so each phone can be told apart later. */
export async function login(email: string, password: string, deviceName: string): Promise<LoginResponse> {
  const { data } = await http.post<LoginResponse>(
    '/auth/login',
    { email, password, device_name: deviceName },
    { skipAuth: true },
  )
  return data
}

/** Creates the account. It does not sign anyone in: call `login` next. */
export async function register(input: RegisterInput): Promise<User> {
  const { data } = await http.post<Single<User>>('/auth/register', input, { skipAuth: true })
  return data.data
}

export async function logout(): Promise<void> {
  await http.post('/auth/logout')
}
