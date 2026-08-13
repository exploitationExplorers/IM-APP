# IM-APP-server

Go + Gin **正式业务后端**，负责用户/好友/群组/风控及 OpenIM 桥接（见 [docs/architecture.md](docs/architecture.md)）。

- 业务库：PostgreSQL
- 消息层：OpenIM + MongoDB；Go 仅负责业务身份、关系、群权限、同步和 Webhook

## 快速启动（Docker）

```bash
cd IM-APP-server
docker compose up -d --build
```

- API: `http://127.0.0.1:8080`
- Health: `GET /health`
- Chat WS: 由 `POST /api/v1/im/token` 返回 OpenIM `wsAddr`
- 旧 Go `/ws` 默认关闭（`LEGACY_CHAT_ENABLED=false`）

演示数据默认不写入；仅本地明确设置 `SEED_DEMO=true` 时启用。

## 本地直接跑 API

```bash
docker compose up -d postgres
cp .env.example .env
go run ./cmd/server
```

本机 PostgreSQL 18 直连使用 `127.0.0.1:5432`；Docker 示例映射仍使用 `5433`，不要混用。

## API 文档

- [docs/openapi.yaml](docs/openapi.yaml) — 可直接导入 Apifox、Postman、YApi 等工具的 OpenAPI 3.0 Swagger
- [docs/api-contract.md](docs/api-contract.md) — REST 契约
- [docs/architecture.md](docs/architecture.md) — 全栈架构

## 架构

```
handler → service → repository → PostgreSQL
```

Phase 3+：`internal/infra/`（Redis、MinIO）  
Phase 4+：`internal/im/`（OpenIM 桥接）

## OpenIM 后端

- [对话后端实现与部署文档](docs/OpenIM对话后端接口与WebSocket开发规划.md)
- [OpenIM 服务器 Webhook 启用步骤](docs/OpenIM服务器Webhook部署步骤.md)
- PostgreSQL 保存业务身份、关系、群、Outbox 和元数据审计。
- OpenIM 自己管理 MongoDB 消息、会话和序号；Go 不直连 OpenIM MongoDB。
