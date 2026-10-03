import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "path";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src")
    }
  },
  server: {
    host: "0.0.0.0",
    port: 5180,
    proxy: {
      "/api": {
        // 线上管理后台后端（im-admin，经 nginx :8081 转发）。保留 /api 前缀。
        // 旧值 http://8.210.72.157:8090 与 https://admin.ke58.com 均已作废。
        target: "http://8.154.44.197:8081",
        changeOrigin: true
      }
    }
  }
});
