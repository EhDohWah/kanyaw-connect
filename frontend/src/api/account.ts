import { http } from '@/api/http'

/*
 * Passwords and email verification (docs/API.md, section 3.1). The emails the server sends link to pages of this app:
 * `/reset-password?token=…&email=…` and `/verify-email?id=…&hash=…&expires=…&signature=…`.
 */

/** "Forgot your password?": the server answers the same whether or not the address has an account. */
export async function forgotPassword(email: string): Promise<void> {
  await http.post('/auth/forgot-password', { email }, { skipAuth: true })
}

export interface ResetPasswordInput {
  token: string
  email: string
  password: string
  password_confirmation: string
}

/** Sets a new password with the token from the emailed link. Signs out every device, this one included. */
export async function resetPassword(input: ResetPasswordInput): Promise<void> {
  await http.post('/auth/reset-password', input, { skipAuth: true })
}

export interface ChangePasswordInput {
  current_password: string
  password: string
  password_confirmation: string
}

/** Changes the password of the signed-in person. This device stays signed in; every other device is signed out. */
export async function changePassword(input: ChangePasswordInput): Promise<void> {
  await http.put('/me/password', input)
}

/** Emails a new verification link. `verified`: the address was verified already, so nothing was sent. */
export async function sendVerificationEmail(): Promise<{ verified: boolean }> {
  const { data } = await http.post<{ verified: boolean }>('/auth/email/verification-notification')
  return { verified: data.verified === true }
}

/** The four values from the link in the verification email. */
export interface VerificationLink {
  id: string
  hash: string
  expires: string
  signature: string
}

/**
 * Verifies the address from the emailed link. Works signed out (the signature is the proof), so no token is sent. The
 * query string must hold exactly `expires` and `signature`, as they came: the signature covers it.
 */
export async function verifyEmail(link: VerificationLink): Promise<void> {
  await http.post(`/auth/email/verify/${encodeURIComponent(link.id)}/${encodeURIComponent(link.hash)}`, undefined, {
    params: { expires: link.expires, signature: link.signature },
    skipAuth: true,
  })
}
