import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const apiProxyTarget = 'http://127.0.0.1:8000'

// Every path prefix the backend serves. With demo mode off and no
// VITE_API_BASE_URL, the app calls its own origin, so each prefix has to be
// proxied — the proxy used to cover only /audit and /session, which left the
// route map, matching, radar, rewrite and work sample returning Vite 404s.
const API_PREFIXES = ['/audit', '/employer', '/health', '/market', '/match', '/route', '/skills']

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      ...Object.fromEntries(
        API_PREFIXES.map((prefix) => [prefix, { target: apiProxyTarget, changeOrigin: true }]),
      ),
      // `ws: true` forwards the WebSocket upgrade for the live agent stream at
      // /session/{id}/stream; without it the socket never reached the backend.
      '/session': {
        target: apiProxyTarget,
        changeOrigin: true,
        ws: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
    css: true,
  },
})
