import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { fakeApi, restoreApi, signIn } from '@/__tests__/helpers'
import * as accountApi from '@/api/account'

beforeEach(() => signIn())
afterEach(restoreApi)

const authorization = (headers: Record<string, unknown>) => headers.Authorization ?? headers.authorization

describe('the account requests', () => {
  it('forgot password: the address, without the token (it works signed out)', async () => {
    const { calls } = fakeApi(() => ({ data: { message: 'If an account uses that address…' } }))
    await accountApi.forgotPassword('paw@example.com')

    expect(calls[0]).toMatchObject({ method: 'post', url: '/auth/forgot-password', body: { email: 'paw@example.com' } })
    expect(authorization(calls[0]!.headers)).toBeUndefined()
  })

  it('reset password: token, address and the new password twice, without the token', async () => {
    const { calls } = fakeApi(() => ({ data: { message: 'Your password has been reset.' } }))
    await accountApi.resetPassword({ token: 'tok', email: 'paw@example.com', password: 'new-password', password_confirmation: 'new-password' })

    expect(calls[0]).toMatchObject({
      method: 'post',
      url: '/auth/reset-password',
      body: { token: 'tok', email: 'paw@example.com', password: 'new-password', password_confirmation: 'new-password' },
    })
    expect(authorization(calls[0]!.headers)).toBeUndefined()
  })

  it('change password: PUT /me/password, signed in', async () => {
    const { calls } = fakeApi(() => ({ data: { message: 'Your password has been changed.' } }))
    await accountApi.changePassword({ current_password: 'old', password: 'new-password', password_confirmation: 'new-password' })

    expect(calls[0]).toMatchObject({ method: 'put', url: '/me/password', body: { current_password: 'old', password: 'new-password', password_confirmation: 'new-password' } })
    expect(authorization(calls[0]!.headers)).toBe('Bearer 1|secret-token')
  })

  it('a new verification email, and whether there was nothing to send', async () => {
    const { calls } = fakeApi(() => ({ data: { message: 'We have emailed you a new verification link.', verified: false } }))
    await expect(accountApi.sendVerificationEmail()).resolves.toEqual({ verified: false })
    expect(calls[0]).toMatchObject({ method: 'post', url: '/auth/email/verification-notification' })

    fakeApi(() => ({ data: { message: 'Your email address is already verified.', verified: true } }))
    await expect(accountApi.sendVerificationEmail()).resolves.toEqual({ verified: true })
  })

  it('verify: the link\'s id and hash in the path, exactly expires and signature in the query, without the token', async () => {
    const { calls } = fakeApi(() => ({ data: { message: 'Your email address is verified.', verified: true } }))
    await accountApi.verifyEmail({ id: '0195e2c4-0001', hash: 'abc123', expires: '1773565200', signature: 'f00d' })

    expect(calls[0]).toMatchObject({ method: 'post', url: '/auth/email/verify/0195e2c4-0001/abc123' })
    expect(calls[0]!.uri.endsWith('/auth/email/verify/0195e2c4-0001/abc123?expires=1773565200&signature=f00d')).toBe(true)
    expect(authorization(calls[0]!.headers)).toBeUndefined()
  })
})
