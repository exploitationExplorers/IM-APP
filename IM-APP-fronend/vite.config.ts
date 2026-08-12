import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [uni()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://8.210.72.157:8080',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://8.210.72.157:8080',
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
