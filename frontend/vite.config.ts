import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // The video library alone is about 530 KB (140 KB compressed). It is in its own file, loaded only with a meeting.
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            // The video library is large and changes rarely: in its own file, so an app update does not make phones
            // download it again. It is loaded only when a meeting is opened.
            { name: 'livekit', test: /node_modules[\\/](livekit-client|@livekit)[\\/]/ },
          ],
        },
      },
    },
  },
  server: {
    // The backend allows exactly this origin (CORS). If the port were taken, Vite would silently pick
    // another one and every request would be blocked, so fail loudly instead.
    port: 5173,
    strictPort: true,
  },
})
