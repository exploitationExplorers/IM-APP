# IM 运维平台 — Viron 改造计划

## 0. 项目定位

将 Viron（Apache 2.0）改造为 IM 项目的**专属运维管理平台**，独立部署，仅限管理员访问。
覆盖 IM 后端全部 Docker 化基础设施：PostgreSQL、MongoDB、Redis、Kafka、Etcd、MinIO、OpenIM、Go API 服务。

## 1. 改造范围总览

| 类别 | 改造项 | 优先级 | 预计工作量 |
|------|--------|--------|------------|
| 品牌与入口 | 替换 Viron 品牌为"IM 运维平台"，登录页/导航/标题/favicon | P0 | 0.5天 |
| 权限收窄 | 关闭自主注册，关闭组织/邀请，只保留平台管理员登录 | P0 | 1天 |
| PostgreSQL 工作台 | 新增 pg 驱动 + 连接器 + 对象树 + SQL + 数据网格 + 表设计器 + 同步 | P0 | 5-8天 |
| MongoDB 只读工作台 | 新增 mongo 驱动 + 集合浏览 + 文档查询（只读） | P1 | 3-5天 |
| IM 仪表盘首页 | 替换环境总览为 IM 系统概览（服务状态/在线数/告警） | P1 | 2-3天 |
| Web 浏览器模块删除 | 移除 Chromium 嵌入、Web 入口/账号相关代码和依赖 | P2 | 1天 |
| 部署适配 | 调整 Dockerfile/docker-compose 适配 IM 部署 | P0 | 0.5天 |
| 桌面 App 删除 | 移除 Electron/桌面相关代码（只保留 Web） | P2 | 0.5天 |

## 2. 架构概要

```
IM 运维平台（Viron 改造）
├── src/server/          # Fastify 5 服务端
│   ├── database-workbench/
│   │   ├── connector.ts          # MySQL connector（保留）
│   │   ├── pg-connector.ts       # 🆕 PostgreSQL connector
│   │   ├── mongo-connector.ts    # 🆕 MongoDB connector（只读）
│   │   ├── query-manager.ts      # 查询管理（扩展支持 pg）
│   │   └── task-manager.ts       # 任务管理（扩展支持 pg）
│   ├── routes/
│   │   ├── database-workbench.ts # 扩展支持 pg engine
│   │   ├── mongo-workbench.ts    # 🆕 MongoDB 只读路由
│   │   └── ...
│   ├── pg-schema-reader.ts       # 🆕 PostgreSQL 元数据读取
│   └── ...
├── src/client/
│   ├── views/
│   │   ├── MongoWorkbenchView.vue  # 🆕
│   │   └── ...
│   ├── components/
│   │   ├── MongoWorkbench.vue      # 🆕
│   │   └── ...
│   └── ...
└── docker-compose.yml   # IM 运维平台部署
```

## 3. 环境映射设计

Viron 的 `Environment` 概念映射到 IM 的 Docker 部署环境：

| Viron 概念 | IM 映射 | 说明 |
|-----------|---------|------|
| 环境组(EnvironmentGroup) | 部署阶段 | 如 `production`、`staging` |
| 环境(Environment) | 一套 IM 栈 | 如 `im-prod-01`（包含该栈全部容器） |
| SSH 连接 | 服务器节点 | 管理 Docker 容器、查日志、重启服务 |
| 数据库连接(PostgreSQL) | IM 业务库 | 对象树/SQL/表结构/数据/同步 |
| 数据库连接(MongoDB) | OpenIM 消息库 | 只读查询，消息排障 |
| Redis 连接 | 缓存/在线状态 | 复用 Viron Redis 工作台 |

Kafka/Etcd/MinIO/OpenIM 通过 SSH 终端 + 服务维护模块管理。

## 4. 分阶段实施

### 阶段一：最小可用（P0，目标 3 天）
1. ✅ 克隆仓库到 `IM-ops/viron/`
2. 品牌替换（标题/Logo/favicon/登录页文案）
3. 权限收窄（关闭注册、关闭组织邀请、只保留管理员）
4. PostgreSQL 连接器（`pg` 驱动 + SSH Tunnel + TLS）
5. PostgreSQL 基础工作台（连接 → 对象树 → SQL 执行 → 数据查看）
6. 部署配置调整

### 阶段二：完整 PostgreSQL 能力（P0，目标 5 天）
1. PostgreSQL 表设计器（建表/改表/索引/约束）
2. PostgreSQL 数据网格（编辑/插入/删除/筛选/排序）
3. PostgreSQL 结构同步 & 数据同步
4. PostgreSQL 导入导出（CSV/SQL dump）
5. SQL 语法高亮 & 补全适配 PostgreSQL

### 阶段三：MongoDB + 仪表盘（P1，目标 5 天）
1. MongoDB 只读连接器
2. MongoDB 集合浏览 + 文档查询界面
3. IM 系统概览仪表盘（首页）
4. Docker Compose 服务状态集成

### 阶段四：精简优化（P2，目标 2 天）
1. 移除 Web 浏览器模块（Chromium/playwright 依赖）
2. 移除桌面 App 相关代码
3. 优化 Docker 镜像体积
4. 移除不需要的导入功能（Navicat/SecureCRT）

## 5. 技术要点

### 5.1 PostgreSQL 连接器设计
- 使用 `pg` (node-postgres) 包，与 MySQL 的 `mysql2` 并列
- `DatabaseConnectionRecord.engine` 扩展为 `"mysql" | "mariadb" | "postgresql"`
- 连接编辑对话框根据 engine 切换表单字段
- 复用现有 SSH Tunnel 机制（`ssh2` forwardOut）
- 复用现有加密凭据存储（AES-256-GCM）

### 5.2 PostgreSQL 元数据读取
- 对象树：`information_schema` + `pg_catalog`
- 表结构：`pg_attribute` + `pg_constraint` + `pg_index`
- 补全：`information_schema.columns` + `information_schema.tables` + `pg_proc`
- 表设计器 DDL 生成：PostgreSQL 语法（`SERIAL/BIGSERIAL`、`TEXT`、`JSONB` 等类型）

### 5.3 权限收窄
- `.env` 新增 `ALLOW_REGISTRATION=false`（默认关闭）
- 路由守卫：非 `is_platform_admin` 用户直接踢回登录页
- API 层：所有路由默认要求 `is_platform_admin`
- 移除组织邀请链接路由

### 5.4 元数据库
- Viron 自身的元数据库继续使用 SQLite（默认）或 MySQL
- 不与 IM 业务库混用
- `database_connections` 表的 `engine` 列新增 `postgresql` 枚举值

## 6. 数据库 Schema 变更

```sql
-- SQLite: database_connections 表 engine 列原有 CHECK 约束修改
-- 从: CHECK(engine IN ('mysql','mariadb'))
-- 改为: CHECK(engine IN ('mysql','mariadb','postgresql'))

-- 新增 MongoDB 连接表
CREATE TABLE IF NOT EXISTS mongo_connections (
  id TEXT PRIMARY KEY,
  workspace_type TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 27017,
  username TEXT NOT NULL DEFAULT '',
  default_database TEXT NOT NULL DEFAULT '',
  auth_database TEXT NOT NULL DEFAULT 'admin',
  connection_mode TEXT NOT NULL DEFAULT 'tcp',
  credential_ciphertext TEXT NOT NULL DEFAULT '',
  options_json TEXT NOT NULL DEFAULT '{}',
  connection_group_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

## 7. 不改动的模块（直接复用）

- SSH 终端 / SFTP / 实时日志
- Redis 工作台
- 主机监控 / 服务维护
- 审计 / 终端录像 / SQL 历史
- 加密凭据存储
- 连接巡检

## 8. 文件改动清单（阶段一）

### 服务端
| 文件 | 操作 | 说明 |
|------|------|------|
| `package.json` | 修改 | 添加 `pg` 依赖 |
| `src/server/database-workbench/connector.ts` | 修改 | engine 类型扩展，新增 pg 连接逻辑 |
| `src/server/database-workbench/pg-connector.ts` | 新增 | PostgreSQL 连接器 |
| `src/server/pg-schema-reader.ts` | 新增 | PostgreSQL 元数据读取 |
| `src/server/database.ts` | 修改 | Schema 变更（engine 枚举） |
| `src/server/mysql-schema.ts` | 修改 | MySQL 元数据库 Schema 变更 |
| `src/server/routes/database-workbench.ts` | 修改 | 路由支持 pg engine |
| `src/server/routes/connections.ts` | 修改 | 连接 CRUD 支持 pg |
| `src/server/routes/auth.ts` | 修改 | 关闭注册、强制管理员 |
| `src/server/config.ts` | 修改 | 新增配置项 |
| `src/server/app.ts` | 修改 | 品牌信息 |

### 客户端
| 文件 | 操作 | 说明 |
|------|------|------|
| `index.html` | 修改 | 标题 |
| `src/client/views/LoginView.vue` | 修改 | 品牌文案 |
| `src/client/components/AppShell.vue` | 修改 | 导航标题/Logo |
| `src/client/components/ConnectionEditDialog.vue` | 修改 | 支持 PostgreSQL engine |
| `src/client/components/DatabaseWorkbench.vue` | 修改 | 适配 pg 元数据 |
| `src/client/sql-completion.ts` | 修改 | pg 语法补全 |
| `src/client/router.ts` | 修改 | 移除邀请路由 |
| `src/shared/i18n-messages.ts` | 修改 | 品牌相关文案 |

### 部署
| 文件 | 操作 | 说明 |
|------|------|------|
| `.env.example` | 修改 | 新增配置项 |
| `docker-compose.full.yml` | 修改 | 适配 IM 部署 |
| `Dockerfile` | 修改 | 移除 Chromium（阶段四） |
