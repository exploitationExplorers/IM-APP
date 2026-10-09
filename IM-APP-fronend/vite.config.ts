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
          // 不要把 openim-uniapp-polyfill / @openim/* 单独拆包：
          // H5 产物里该包在模块加载期会读 __uniConfig，独立 chunk 可能先于 uni 入口执行 → 白屏。
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
        target: 'http://8.154.44.197',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://8.154.44.197',
        changeOrigin: true,
      },
      // OpenIM 的 WebSocket 网关。和 /api 同理：让浏览器只连 localhost，
      // 真正的连接由 Vite（Node）发起 —— 这样本机开着系统代理/VPN 也不影响（代理一般不接管回环）。
      // 配套：src/utils/openim.ts 的 h5SdkAddr() 在 H5 开发时把 SDK 的 wsAddr 改写成同源路径。
      // ws: true 必须写，否则升级请求不会被转发，握手会一直 pending。
      '/openim-ws': {
        target: 'http://8.154.44.197',
        ws: true,
        changeOrigin: true,
      },
      // H5 开发时 fetch 会把 http://8.154.44.197/openim-api 等改到 localhost。
      // 线上由 nginx 反代；这里没配就会 404。前缀不要写成 /openim，否则会吃掉 /openim-api、/openim-ws。
      // changeOrigin 让 Host 仍是 8.154.44.197，MinIO 签名才对得上。不剥前缀，上游 nginx 自己剥。
      '/openim-api': {
        target: 'http://8.154.44.197',
        changeOrigin: true,
      },
      '/openim/': {
        target: 'http://8.154.44.197',
        changeOrigin: true,
      },
      '/object/': {
        target: 'http://8.154.44.197',
        changeOrigin: true,
      },
      '/minio/': {
        target: 'http://8.154.44.197',
        changeOrigin: true,
      },
    },
  },
})
