import { describe, expect, it } from 'vitest'

import { safeRedirect } from '@/utils/safeRedirect'

describe('safeRedirect', () => {
  it('allows paths inside the app, with query and hash', () => {
    expect(safeRedirect('/chats')).toBe('/chats')
    expect(safeRedirect('/chats/abc?x=1#top')).toBe('/chats/abc?x=1#top')
  })

  it.each([
    'https://evil.example/phish',
    '//evil.example',
    '/\\evil.example',
    '\\\\evil.example',
    'javascript:alert(1)',
    'chats',
    '',
    '/ok\nLocation: elsewhere',
  ])('refuses %j', (target) => {
    expect(safeRedirect(target)).toBe('/')
  })

  it('refuses things that are not text', () => {
    expect(safeRedirect(undefined)).toBe('/')
    expect(safeRedirect(['/chats'])).toBe('/')
    expect(safeRedirect(null)).toBe('/')
  })

  it('never sends someone back to the login or register screen', () => {
    expect(safeRedirect('/login')).toBe('/')
    expect(safeRedirect('/register?x=1')).toBe('/')
    expect(safeRedirect('/login', '/chats')).toBe('/chats')
  })
})
