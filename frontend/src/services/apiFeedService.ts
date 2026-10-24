import { ApiError } from '@/api/errors'
import type { FeedService } from '@/services/feed'

/**
 * The feed as the real API will serve it. The backend has no feed endpoints yet, so every call says so; when they
 * exist, this is the only file that changes (`http.get('/posts')` and so on).
 */
export function createApiFeedService(): FeedService {
  const unavailable = (): Promise<never> =>
    Promise.reject(new ApiError({ status: 501, message: 'VITE_FEED_SOURCE=api: the backend has no feed endpoints yet. Use VITE_FEED_SOURCE=mock.' }))

  return {
    listPosts: unavailable,
    createPost: unavailable,
    likePost: unavailable,
    unlikePost: unavailable,
    listComments: unavailable,
    addComment: unavailable,
    postLink: (postId) => `${window.location.origin}/?post=${encodeURIComponent(postId)}`,
  }
}
