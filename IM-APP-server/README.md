# IM-APP-server

Go + Gin **正式业务后端**，负责用户/好友/群组/风控及 OpenIM 桥接（见 [docs/architecture.md](docs/architecture.md)）。

- 业务库：PostgreSQL
- 消息层：Phase 1–2 自研 WS 过渡；Phase 4 迁移 OpenIM + MongoDB
- 前端默认 Mock 开发，联调时切换 `VITE_USE_MOCK=false`

## 快速启动（Docker）

```bash
cd IM-APP-server
docker compose up -d --build
```

- API: `http://127.0.0.1:8080`
- Health: `GET /health`
- WS: `ws://127.0.0.1:8080/ws?token=<jwt>`（过渡态，Phase 4 后由 OpenIM 承担）

演示账号：手机号 `13800138000` / 密码 `123456` / 公开 ID `chat10001` / 验证码 `123456`

## 本地直接跑 API

```bash
docker compose up -d postgres
cp .env.example .env
go run ./cmd/server
```

确认 `.env` 中 `DATABASE_URL` 端口为 **5433**。

## API 文档

- [docs/api-contract.md](docs/api-contract.md) — REST 契约
- [docs/architecture.md](docs/architecture.md) — 全栈架构

## 架构

```
handler → service → repository → PostgreSQL
```

Phase 3+：`internal/infra/`（Redis、MinIO）  
Phase 4+：`internal/im/`（OpenIM 桥接）

## 与前端联调

`IM-APP-fronend/.env`：

```
VITE_USE_MOCK=false
VITE_API_BASE_URL=http://127.0.0.1:8080/api/v1
VITE_WS_BASE_URL=ws://127.0.0.1:8080/ws
```
