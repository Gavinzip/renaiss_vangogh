import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/open-monitor-api': {
        target: 'https://open-monitor-rmrm.pages.dev',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/open-monitor-api/, '/api'),
      },
    },
  },
})
