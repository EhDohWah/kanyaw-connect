import { fileURLToPath } from 'node:url'
import { mergeConfig, defineConfig, configDefaults } from 'vitest/config'
import viteConfig from './vite.config.ts'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      exclude: [...configDefaults.exclude, 'e2e/**'],
      root: fileURLToPath(new URL('./', import.meta.url)),
      setupFiles: ['./src/__tests__/setup.ts'],
      env: {
        VITE_API_BASE_URL: 'http://api.test/api/v1',
        VITE_REVERB_APP_KEY: 'test-key',
        VITE_REVERB_HOST: 'localhost',
        VITE_REVERB_PORT: '8080',
        VITE_REVERB_SCHEME: 'http',
        VITE_FEED_SOURCE: 'mock',
      },
    },
  }),
)
