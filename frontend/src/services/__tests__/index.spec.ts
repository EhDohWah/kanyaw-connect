import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { feedService, feedSource, setFeedService } from '@/services'
import type { FeedService } from '@/services/feed'

afterEach(() => {
  vi.unstubAllEnvs()
  setFeedService(null)
})

describe('which feed the app uses', () => {
  it('is the sample feed by default and for "mock"', () => {
    vi.stubEnv('VITE_FEED_SOURCE', 'mock')
    expect(feedSource()).toBe('mock')
    vi.stubEnv('VITE_FEED_SOURCE', '')
    expect(feedSource()).toBe('mock')
    vi.stubEnv('VITE_FEED_SOURCE', 'anything else')
    expect(feedSource()).toBe('mock')
  })

  it('is the real API for "api"', () => {
    vi.stubEnv('VITE_FEED_SOURCE', 'api')
    expect(feedSource()).toBe('api')
  })

  it('makes the service once and keeps it', () => {
    setFeedService(null)
    expect(feedService()).toBe(feedService())
  })

  it('answers with sample posts when the source is "mock"', async () => {
    vi.stubEnv('VITE_FEED_SOURCE', 'mock')
    setFeedService(null)
    setActivePinia(createPinia())
    // Not the test setup's quick one: the real choice. Its pause is short enough to wait for.
    const page = await feedService().listPosts()

    expect(page.data.length).toBeGreaterThan(0)
  })

  it('for "api" says plainly that the backend has no feed yet (501), instead of showing sample posts', async () => {
    vi.stubEnv('VITE_FEED_SOURCE', 'api')
    setFeedService(null)
    const service = feedService()

    await expect(service.listPosts()).rejects.toMatchObject({ status: 501, message: expect.stringContaining('no feed endpoints') })
    await expect(service.likePost('x')).rejects.toMatchObject({ status: 501 })
    await expect(service.addComment('x', 'y')).rejects.toMatchObject({ status: 501 })
    expect(service.postLink('p1')).toMatch(/\/\?post=p1$/)
  })

  it('can be replaced (for tests, or later for a different server)', () => {
    const other = { listPosts: vi.fn() } as unknown as FeedService
    setFeedService(other)

    expect(feedService()).toBe(other)
  })
})
