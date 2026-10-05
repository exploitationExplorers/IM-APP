import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "path";

// 用函数式配置才能读到 .env 里的 VITE_PUBLIC_PATH。
// ★ 这个变量以前只在 .env 里定义、没人读，所以产物一直是根绝对路径 /assets/...
//   线上要挂在 www.易可聊.com/admin/ 子路径下，必须真正接到 vite 的 base 上，
//   否则 /admin/index.html 会去请求 /assets/xxx.js（根路径）→ 404 白屏。
//   dev 下 VITE_PUBLIC_PATH=/ 不受影响，仍是 http://localhost:5180/。
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, "");
  return {
    base: env.VITE_PUBLIC_PATH || "/",
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
  };
});
