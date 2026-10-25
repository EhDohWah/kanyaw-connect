// Ported from frontend/src/types/user.ts (docs/API.md, section 2: User and PublicUser).
import type { AppLocale } from '@/i18n'

export type UserStatus = 'online' | 'away' | 'busy' | 'offline'

/** Your own profile (`/auth/*` and `/me*`). It has private fields: other people never receive it. */
export interface User {
  id: string
  name: string
  email: string
  phone: string | null
  email_verified_at: string | null
  avatar_url: string | null
  /** 256x256 WebP: use it in lists. */
  avatar_thumb_url: string | null
  status: UserStatus
  last_seen_at: string | null
  /** IANA zone, for example Asia/Bangkok. */
  timezone: string
  locale: AppLocale
  settings: Record<string, unknown>
  created_at: string
}

/** How other people appear: never an email, phone number or settings. */
export interface PublicUser {
  id: string
  name: string
  avatar_url: string | null
  avatar_thumb_url: string | null
}

/** What `POST /auth/login` returns. */
export interface LoginResponse {
  token: string
  /** When the token stops working: 30 days after it was issued. It is not extended by use. */
  expires_at: string
  user: User
}

export interface RegisterInput {
  name: string
  email: string
  password: string
  password_confirmation: string
  phone?: string
}

/** What `PATCH /me` accepts. Send only what changed. `settings` is merged key by key on the server. */
export interface ProfilePatch {
  name?: string
  phone?: string | null
  timezone?: string
  locale?: AppLocale
  settings?: Record<string, unknown>
}
