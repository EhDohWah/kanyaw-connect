/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the API, including /api/v1 (no trailing slash). */
  readonly VITE_API_BASE_URL: string
  /** Reverb (WebSocket) app key: public, it only identifies the application. */
  readonly VITE_REVERB_APP_KEY: string
  readonly VITE_REVERB_HOST: string
  readonly VITE_REVERB_PORT: string
  readonly VITE_REVERB_SCHEME: 'http' | 'https'
  /** Where the feed comes from: `mock` (sample posts) or `api` (when the backend has a feed). */
  readonly VITE_FEED_SOURCE: 'mock' | 'api'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
