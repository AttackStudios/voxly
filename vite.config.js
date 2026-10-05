import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: './' for builds so assets load over file:// in the packaged desktop app
// (absolute '/assets' would resolve to the drive root and 404 → blank window).
// Dev stays at '/' for clean HMR.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/uploads': 'http://localhost:3001',
      '/socket.io': { target: 'http://localhost:3001', ws: true },
    },
  },
}))
