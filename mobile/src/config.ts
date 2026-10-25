/**
 * Settings from `.env` (see `.env.example`). Expo inlines `process.env.EXPO_PUBLIC_*` at build time, and only when each
 * one is written out in full like this, so they are read here and nowhere else. None of them is a secret.
 */
export const config = {
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8000/api/v1',
  reverb: {
    key: process.env.EXPO_PUBLIC_REVERB_APP_KEY ?? 'local-dev-key',
    host: process.env.EXPO_PUBLIC_REVERB_HOST ?? 'localhost',
    port: Number(process.env.EXPO_PUBLIC_REVERB_PORT ?? 8080),
    tls: process.env.EXPO_PUBLIC_REVERB_SCHEME === 'https',
  },
  feedSource: process.env.EXPO_PUBLIC_FEED_SOURCE ?? 'mock',
} as const
