# IM 系统架构

本文档描述正式环境技术栈与组件职责，依据项目根目录 `技术.png`。

## 技术栈总览

| 组件 | 技术 | 职责 |
|---|---|---|
| 移动端 | uni-app Vue3 | Android / iOS 客户端 |
| 业务 API | Go + Gin | 用户、好友、群组、风控、文件元数据、OpenIM 桥接 |
| 业务数据库 | PostgreSQL | 账号、好友关系、群元数据、申请/拉黑 |
| IM 引擎 | OpenIM 私有化 | 单聊/群聊、消息同步、已读、离线 |
| 消息存储 | MongoDB | OpenIM 消息数据（随 OpenIM 部署） |
| 缓存 | Redis | 验证码限流、Session、在线状态（Phase 3） |
| 对象存储 | MinIO / S3 | 图片、语音、文件（Phase 3） |
| 消息队列 | Kafka | 异步群发、推送任务（Phase 5） |
| 服务协调 | Etcd | 服务发现与配置（生产部署期） |

**管理后台**（React + shadcn/ui）暂不纳入当前迭代。

## 架构图

```
┌─────────────────┐     REST/JWT      ┌──────────────────┐
│  uni-app 客户端  │ ───────────────▶ │  Go 业务服务      │
│  IM-APP-fronend │                   │  IM-APP-server   │
└────────┬────────┘                   └────────┬─────────┘
         │                                     │
         │ OpenIM SDK / WS (Phase 4)           ├── PostgreSQL（业务）
         ▼                                     ├── Redis（缓存）
┌─────────────────┐                            ├── MinIO（文件）
│  OpenIM 集群     │ ◀── 用户/群同步 ───────────┘
└────────┬────────┘
         ├── MongoDB（消息）
         └── Kafka（异步）
```

## 职责边界

### Go 业务服务（IM-APP-server）

- 多国手机号注册登录、JWT 签发
- 用户资料、公开 ID、二维码
- 好友申请、拉黑、通讯录
- 群组元数据、成员关系、群设置（禁加好友等）
- 文件上传预签名（MinIO）
- OpenIM Token 签发、对象解析、用户/关系/群 Outbox 同步
- OpenIM 发送前权限 Webhook、发送后元数据审计和内部系统消息
- 客户端 wgt 热更新 / 整包发布检查（公开接口 `/api/v1/public/app-release`）与带内部密钥的发布（`/api/v1/admin/app-releases`，内网另有 `/internal/admin/app-releases`）

### OpenIM

- 消息收发、历史消息、会话列表
- 已读回执、离线消息、在线状态
- 群聊消息与 @ 提醒

### 当前消息链路

- OpenIM + MongoDB 是唯一的新消息、会话、历史和实时连接主链。
- Go 不直连 OpenIM MongoDB，不保存新消息正文，只保留业务关系、同步任务和回调审计元数据。
- 旧 Go `/ws`、PostgreSQL 消息 REST 和旧转发任务默认关闭；只可通过 `LEGACY_CHAT_ENABLED=true` 临时回滚。

## 代码分层（Go）

```
cmd/server/main.go          # 路由注册、依赖注入
internal/
  handler/                  # HTTP 入参校验
  service/                  # 业务逻辑
  repository/               # PostgreSQL 访问
  im/                       # OpenIM 管理 REST 客户端
  infra/                    # Phase 3+: redis, minio, kafka
  ws/                       # 旧 WS，仅回滚开关启用
```

## 前端架构

- API 层：`src/api/*`，禁止页面内直接 `uni.request`
- 状态：Pinia Setup Store
- 聊天：OpenIM SDK（`openim-uniapp-polyfill`），会话、消息、未读、已读、撤回都由 SDK 提供，不走业务 REST
- 规范：见仓库 `.cursor/rules/im-uniapp.mdc`

## 演进阶段

| 阶段 | 内容 |
|---|---|
| Phase 1 | 认证、资料、好友、基础单聊（已完成） |
| Phase 2 | 建群、加群、群设置、群聊 |
| Phase 3 | Redis + MinIO、验证码限流、文件上传 |
| Phase 4 | OpenIM 部署和 Go 后端桥接（已实现） |
| Phase 5 | Kafka 群发、真实短信、离线推送 |

## 相关文档

- [api-contract.md](./api-contract.md) — REST API 契约
- [../../plan.md](../../plan.md) — 客户端 wgt 热更新方案与发布流程
- [离线推送实现分析.md](./离线推送实现分析.md) — 与参考站对齐的离线推送：OpenIM 在线 vs 系统推送、前后端分工
- [OpenIM对话后端接口与WebSocket开发规划.md](./OpenIM对话后端接口与WebSocket开发规划.md) — 后端实现与验收
- [OpenIM服务器Webhook部署步骤.md](./OpenIM服务器Webhook部署步骤.md) — OpenIM 服务器回调启用步骤
- [../README.md](../README.md) — 本地启动说明
