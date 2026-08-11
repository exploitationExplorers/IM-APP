# IM-APP-fronend

UniApp Vue3 + TypeScript IM 客户端，**默认 Mock 模式**开发，无需启动后端。

## 启动

```bash
npm install
npm run dev:h5
```

`.env` 默认：

```
VITE_USE_MOCK=true
VITE_API_BASE_URL=http://127.0.0.1:8080/api/v1
VITE_WS_BASE_URL=ws://127.0.0.1:8080/ws
```

改 `.env` 后需重启 `npm run dev:h5`。

## Mock 演示账号

- 手机号：`13800138000`
- 密码：`123456`
- 验证码：`123456`（开发环境固定）
- 公开 ID：`chat10001`（张三）

其他演示用户公开 ID：`chat10002`（李四）、`chat10003`（王五）、`chat10004`（赵六）

## 对接真实后端联调

1. 启动后端（见 `../IM-APP-server/README.md`）
2. 修改 `.env`：`VITE_USE_MOCK=false`
3. 重启前端 dev server

## 目录结构

```
src/
├── api/          # 统一 API 入口（Mock / Real 双分支）
├── mock/         # 内存 Mock 服务（seed + handlers + store）
├── types/        # 按域拆分的类型定义
├── constants/    # 国家区号等常量
├── composables/  # 路由守卫等
├── stores/       # Pinia 状态
└── pages/        # 页面
```
