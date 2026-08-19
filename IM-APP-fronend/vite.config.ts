import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [uni()],
  resolve: {
    alias: [
      {
        // 见 src/utils/openim-protocol-shim.ts
        find: '@openim/protocol/lib/pb/sdkws/sdkws',
        replacement: fileURLToPath(new URL('./src/utils/openim-protocol-shim.ts', import.meta.url)),
      },
    ],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'https://www.ke58.com',
        changeOrigin: true,
      },
    },
  },
})
