import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: process.env.GH_PAGES ? '/Coldcoin/' : '/',
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/opendota': {
        target: 'https://api.opendota.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/opendota/, '/api'),
      },
    },
  },
})
