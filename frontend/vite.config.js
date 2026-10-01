import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const apiProxyTarget = 'http://127.0.0.1:8000'

// Every backend prefix, so a blank VITE_API_BASE_URL works in dev. `/session`
// also carries the agent WebSocket, which Vite only forwards with `ws: true`.
const API_PREFIXES = ['/audit', '/employer', '/health', '/market', '/match', '/route', '/skills']

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      ...Object.fromEntries(
        API_PREFIXES.map((prefix) => [prefix, { target: apiProxyTarget, changeOrigin: true }]),
      ),
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
