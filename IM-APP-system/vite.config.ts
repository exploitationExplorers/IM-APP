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
        target: "https://admin.ke58.com",
        changeOrigin: true
      }
    }
  }
});
