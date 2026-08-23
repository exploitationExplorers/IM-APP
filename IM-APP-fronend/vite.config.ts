import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'
import { visualizer } from 'rollup-plugin-visualizer'

const analyze = process.env.ANALYZE === 'true'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    uni(),
    analyze &&
      visualizer({
        filename: 'dist/stats.html',
        gzipSize: true,
        open: false,
      }),
  ].filter(Boolean),
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@openim/client-sdk') || id.includes('openim-uniapp-polyfill')) {
            return 'openim-sdk'
          }
          if (id.includes('@openim/protocol')) {
            return 'openim-protocol'
          }
          if (id.includes('node_modules')) {
            if (id.includes('vue') || id.includes('pinia')) return 'vendor-vue'
            if (id.includes('qrcode') || id.includes('jsqr')) return 'vendor-qrcode'
          }
        },
      },
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        api: 'modern-compiler',
        silenceDeprecations: ['legacy-js-api', 'import'],
      },
    },
  },
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
        // 本地后端（docker compose 的 api 服务，127.0.0.1:8080）没起时，
        // 直接代理线上，前端开发不依赖本地后端。代理是 Node 服务端转发，不受浏览器 CORS 限制。
        target: 'https://www.ke58.com',
        changeOrigin: true,
      },
    },
  },
})
