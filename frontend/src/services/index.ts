import { createMockFeedService } from '@/mocks/feedService'
import { createApiFeedService } from '@/services/apiFeedService'
import type { FeedService, FeedSource } from '@/services/feed'
import { useAuthStore } from '@/stores/auth'

let current: FeedService | null = null

/** Which feed the app uses: set by `VITE_FEED_SOURCE`. Anything but `api` means the sample posts. */
export function feedSource(): FeedSource {
  return import.meta.env.VITE_FEED_SOURCE === 'api' ? 'api' : 'mock'
}

/** The feed service for this app, made on first use. */
export function feedService(): FeedService {
  if (!current) {
    current =
      feedSource() === 'api'
        ? createApiFeedService()
        : createMockFeedService({
            // Who is writing: the sample service has no server to ask, so it asks the signed-in person.
            currentUser: () => {
              const user = useAuthStore().user
              return user ? { id: user.id, name: user.name, avatar_url: user.avatar_url, avatar_thumb_url: user.avatar_thumb_url } : null
            },
          })
  }
  return current
}

/** For tests: use this service instead (or `null` to make a fresh one next time). */
export function setFeedService(service: FeedService | null): void {
  current = service
}
