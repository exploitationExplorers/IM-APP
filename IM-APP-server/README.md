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

`.env` 从工作目录读取，已存在的进程环境变量优先。`.env.example` 默认 `127.0.0.1:5433`，对应 docker compose 的端口映射；直连本机原生 PostgreSQL 时改回 `5432`。

聊天要能用，`.env` 里这四项必须填：`OPENIM_API_URL`（后端调 OpenIM 的地址）、`OPENIM_SECRET`、`OPENIM_PUBLIC_API_URL` 与 `OPENIM_PUBLIC_WS_URL`（下发给客户端，前端不再自行配置）。任一为空时 `POST /api/v1/im/token` 返回 503。

## API 文档

- [docs/openapi.yaml](docs/openapi.yaml) — 可直接导入 Apifox、Postman、YApi 等工具的 OpenAPI 3.0 Swagger
- [docs/api-contract.md](docs/api-contract.md) — REST 契约
- [docs/私聊设置与用户举报接口部署说明.md](docs/私聊设置与用户举报接口部署说明.md) — 本次 SQL 核对、上线顺序和回退说明
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
VITE_API_BASE_URL=http://127.0.0.1:8080/api/v1
VITE_OPENIM_ENABLED=true
```

聊天连接地址不再由前端配置，改为登录后调 `POST /api/v1/im/token` 取 `apiAddr` / `wsAddr`。

## OpenIM 后端

- [对话后端实现与部署文档](docs/OpenIM对话后端接口与WebSocket开发规划.md)
- [OpenIM 服务器 Webhook 启用步骤](docs/OpenIM服务器Webhook部署步骤.md)
- PostgreSQL 保存业务身份、关系、群、Outbox 和元数据审计。
- OpenIM 自己管理 MongoDB 消息、会话和序号；Go 不直连 OpenIM MongoDB。

## 生产部署配置（服务器 .env）

服务器 `.env`（`/root/IM-APP/IM-APP-server/.env`）是**手动维护**的，**部署脚本上传代码时排除 `.env`，不会覆盖**，所以配置不会因为重新部署而丢。

### 新环境部署步骤

```bash
cd /root/IM-APP/IM-APP-server
cp .env.example .env      # 以模板创建
vim .env                  # 填真实配置
docker compose up -d --build
```

### .env 必填项

| 配置 | 说明 |
|---|---|
| `JWT_SECRET` | 随机长密钥（生成：`openssl rand -hex 32`） |
| `ALIYUN_ACCESS_KEY_ID` / `ALIYUN_ACCESS_KEY_SECRET` | 阿里云短信密钥（**敏感，勿提交 git**） |
| `SMS_SIGN_NAME` / `SMS_TEMPLATE_CODE` | 阿里云短信签名 / 模板（审核通过） |
| `MINIO_PUBLIC_URL` | MinIO 对外访问地址，如 `http://8.210.72.157:9000`（空则文件 URL 是内网，外部不可访问） |
| `OPENIM_API_URL` / `OPENIM_SECRET` | 连 OpenIM 服务 |
| `KAFKA_BROKERS` | 万人转发 Kafka broker；未配置时转发提交/恢复/重试返回 503 |

### 关键约定

- **`.env` 不进 git**（可能含密钥）；`.env.example` 是模板（提交 git），密钥用 `CHANGE_ME` 占位。
- **验证码默认随机**（`DEV_SMS_CODE` 留空）；想固定联调可填 `123456`。
- 改 `.env` 后重启生效：`docker compose up -d --force-recreate api`。
