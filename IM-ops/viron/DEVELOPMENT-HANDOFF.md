# IM 运维平台 — 开发交接文档

> 本文档供下一个 AI 接手继续开发使用。请先完整阅读本文档再开始写代码。

## 1. 项目位置与背景

- **项目路径**：`d:\接单\IM\IM-ops\viron\`
- **上游仓库**：https://github.com/CANYOUFINDIT/viron （已 clone）
- **改造目标**：将 Viron（Node.js + Vue 3 运维工作台）改造为 IM 项目的专属运维管理平台
- **完整改造计划**：`d:\接单\IM\IM-ops\viron\REFORM-PLAN.md`
- **IM 项目总体规则**：`d:\接单\IM\.cursor\rules\base-rules.mdc`

### Viron 原始技术栈
- 服务端：Fastify 5 + TypeScript + better-sqlite3（元数据库）/ mysql2（目标数据库连接）
- 客户端：Vue 3 + Element Plus + Vite 8 + Monaco Editor + xterm
- 部署：Docker Compose（Lite/Full 两版本）

### IM 基础设施（运维平台需要管理的组件）
| 组件 | 用途 | 运维平台对接方式 |
|------|------|-----------------|
| PostgreSQL | IM 业务数据库 | **数据库工作台**（已有基础连接器） |
| MongoDB | OpenIM 消息库 | 计划新增只读工作台（阶段三） |
| Redis | 缓存/在线状态 | Viron 原生 Redis 工作台（直接复用） |
| Kafka/Etcd/MinIO/OpenIM | 中间件 | SSH 终端 + 服务维护模块 |
| Go API 服务 | 业务 API | SSH 终端 + 服务维护模块 |

## 2. 已完成的改造（阶段一）

### 2.1 品牌替换 ✅
- `index.html`：标题改为"IM 运维平台"
- `src/client/views/LoginView.vue`：品牌文案、能力卡片、表单标题
- `src/client/components/AppShell.vue`：侧栏品牌 `IM Ops / 运维管理平台`
- `src/server/product-info.ts`：PRODUCT_ID 改为 `im-ops`

### 2.2 权限收窄 ✅
- `src/server/routes/auth.ts`：
  - 注册接口返回 403（`REGISTRATION_DISABLED`）
  - 登录增加 `is_platform_admin` 校验，非管理员无法登录
- `src/client/views/LoginView.vue`：隐藏注册按钮
- `src/client/router.ts`：邀请路由重定向到首页

### 2.3 PostgreSQL 基础支持 ✅
- **依赖**：已安装 `pg@^8.23.0` + `@types/pg`
- **新增文件**：
  - `src/server/database-workbench/pg-connector.ts` — PostgreSQL 连接器
    - 实现了 `DatabaseConnectionClient` 接口
    - 支持 TCP 直连 + SSH Tunnel + TLS
    - 连接池复用（通过已有的 `IdleResourcePool`）
  - `src/server/pg-schema-reader.ts` — PostgreSQL 元数据读取
    - `listDatabases` / `listSchemas` / `listTables` / `listColumns`
    - `listIndexes` / `listConstraints` / `listFunctions` / `listTriggers` / `listSequences`
    - `completionMetadata`（SQL 补全用）
- **修改文件**：
  - `src/server/database-workbench/connector.ts`：
    - `DatabaseConnectionRecord.engine` 类型扩展为 `"mysql" | "mariadb" | "postgresql"`
    - `createDatabaseConnection` 在 engine 为 postgresql 时调用 `createPgConnection`
    - 导入了 `pg-connector.ts`
  - `src/server/database.ts`：SQLite Schema 的 engine CHECK 约束新增 `postgresql`
  - `src/server/routes/connections.ts`：zod schema engine 枚举新增 `postgresql`
  - `src/server/routes/database-workbench.ts`：
    - 导入了 `loadDatabaseConnection` 和 `pgSchema`
    - `/schemas` 端点增加 pg 分支（返回 PostgreSQL schemas）
    - `/objects` 端点增加 pg 分支（表/视图/函数/触发器）
    - `/completion-metadata` 端点增加 pg 分支
  - `src/client/components/ConnectionEditDialog.vue`：
    - engine 类型新增 `postgresql`
    - 下拉新增 PostgreSQL 选项
    - 默认端口根据 engine 自动切换（pg=5432, mysql=3306）

## 3. 待开发内容

### 阶段二：完整 PostgreSQL 工作台能力（P0）✅

> **已完成**。所有核心端点已加 pg 分支，DDL 生成、补全、导入导出已支持 PostgreSQL。

#### 2.1 表结构详情端点（PostgreSQL 分支）
- **文件**：`src/server/routes/database-workbench.ts`
- **端点**：`/api/v1/database-connections/:id/table-details`（约 line 410+）
- **现状**：该端点用 MySQL 的 `SHOW CREATE TABLE`、`information_schema.COLUMNS/KEY_COLUMN_USAGE/TRIGGERS` 等读取表的完整结构
- **改造**：用 `pg-schema-reader.ts` 的 `listColumns` + `listIndexes` + `listConstraints` + `listTriggers` 组装相同格式的返回值
- **注意**：前端 `DatabaseWorkbench.vue`（201KB）和 `TableDesigner.vue`（41KB）依赖这个返回值的具体字段，需要对齐

#### 2.2 表设计器 DDL 生成
- **文件**：需要新增 `src/server/pg-ddl-generator.ts` 或在现有逻辑里加分支
- **功能**：
  - 建表：根据表设计器提交的字段/索引/约束定义，生成 PostgreSQL `CREATE TABLE` DDL
  - 改表：生成 `ALTER TABLE` DDL（PostgreSQL 语法，如 `ALTER COLUMN TYPE`、`SET NOT NULL` 等）
  - PostgreSQL 类型映射：`SERIAL/BIGSERIAL`、`TEXT`、`VARCHAR`、`JSONB`、`TIMESTAMP WITH TIME ZONE`、`UUID` 等
- **参考**：MySQL 的 DDL 生成逻辑分散在 `routes/database-workbench.ts` 和 `shared/database-table-design.ts` 里

#### 2.3 数据网格编辑
- **文件**：`src/server/routes/database-workbench.ts` 里的表数据 CRUD 端点
- **现状**：`/api/v1/database-connections/:id/table-data` 系列端点用 MySQL 语法做 SELECT/INSERT/UPDATE/DELETE
- **改造**：pg 的参数占位符是 `$1, $2...`（不是 `?`），需要在 pg 分支里用不同的 SQL 拼接逻辑
- **注意**：`src/shared/database-table-data.ts` 有通用的筛选/排序子句构建，需要检查是否兼容 pg

#### 2.4 SQL 语法高亮 & 补全
- **文件**：`src/client/sql-completion.ts`（10KB）
- **现状**：基于 MySQL 关键字做补全
- **改造**：根据当前连接的 engine 切换关键字列表（PostgreSQL 特有关键字如 `RETURNING`、`ILIKE`、`LATERAL`、`WITH RECURSIVE` 等）

#### 2.5 导入导出
- **文件**：`src/server/routes/database-artifacts.ts`（44KB）
- **现状**：MySQL 的 SQL dump / CSV / Excel 导入导出
- **改造**：pg 的 dump 格式不同（`pg_dump` 语法），CSV 导入需要用 `COPY` 语句

#### 2.6 结构同步 & 数据同步
- **文件**：`src/database-sync.ts`（45KB，根目录）
- **现状**：MySQL 连接间的表结构和数据同步
- **改造**：pg 的 DDL 差异检测和同步 SQL 生成需要完全重写

### 阶段三：MongoDB + 仪表盘（P1）

#### 3.1 MongoDB 只读工作台
- 新增 `mongodb` npm 依赖
- 新增 `src/server/mongo-connector.ts`
- 新增 `src/server/routes/mongo-workbench.ts`（集合列表、文档查询、只读）
- 新增 `src/client/views/MongoWorkbenchView.vue`
- 新增 `src/client/components/MongoWorkbench.vue`
- 路由表 `src/client/router.ts` 新增 `/mongo` 路由
- 侧栏 `src/client/components/AppShell.vue` 的 `menuItems` 新增 MongoDB 入口
- 元数据库新增 `mongo_connections` 表（Schema 见 `REFORM-PLAN.md`）

#### 3.2 IM 系统概览仪表盘
- 改造 `src/client/views/OverviewView.vue`（35KB）
- 新增服务状态卡片（通过 SSH 探测 Docker 容器状态）
- 新增 Redis 在线用户数展示
- 复用 `HostMonitorDashboard.vue` 的监控数据

### 阶段四：精简优化（P2）
- 移除 `src/server/web-browser/` 目录和 `src/client/components/WebAccountBrowser.vue` 等 Web 浏览器相关代码
- 移除 `src/desktop/` 目录和桌面 App 相关代码
- 移除 `playwright-core` 依赖
- 优化 Dockerfile 删除 Chromium 安装

## 4. 代码结构速查

```
src/
├── server/                          # Fastify 服务端
│   ├── app.ts                       # Fastify 应用入口
│   ├── config.ts                    # 配置读取
│   ├── database.ts                  # 元数据库初始化（SQLite/MySQL Schema）
│   ├── mysql-schema.ts              # MySQL 版元数据库 Schema
│   ├── database-workbench/
│   │   ├── connector.ts             # 数据库连接器（MySQL，调度入口）
│   │   ├── pg-connector.ts          # 🆕 PostgreSQL 连接器
│   │   ├── query-manager.ts         # 查询任务管理
│   │   └── task-manager.ts          # 后台任务管理（备份/导入/导出）
│   ├── pg-schema-reader.ts          # 🆕 PostgreSQL 元数据读取
│   ├── routes/
│   │   ├── auth.ts                  # 登录/注册（注册已禁用）
│   │   ├── connections.ts           # 连接 CRUD（已支持 pg engine）
│   │   ├── database-workbench.ts    # 数据库工作台路由（核心，1274行）
│   │   ├── database-artifacts.ts    # 导入导出
│   │   ├── database-admin.ts        # 数据库管理操作
│   │   ├── database-operations.ts   # 数据库操作
│   │   ├── redis-workbench.ts       # Redis 工作台
│   │   ├── ssh-sessions.ts          # SSH 会话
│   │   └── ...
│   ├── ssh/                         # SSH 连接
│   ├── redis/                       # Redis 连接
│   └── ...
├── client/                          # Vue 3 客户端
│   ├── router.ts                    # 路由定义
│   ├── views/                       # 页面级组件
│   │   ├── LoginView.vue            # 登录页（已改造）
│   │   ├── OverviewView.vue         # 环境总览（阶段三改造目标）
│   │   ├── DatabaseWorkbenchView.vue # 数据库工作台入口
│   │   └── ...
│   ├── components/
│   │   ├── AppShell.vue             # 应用外壳/侧栏（已改造）
│   │   ├── DatabaseWorkbench.vue    # 数据库工作台（201KB，核心大组件）
│   │   ├── TableDesigner.vue        # 表设计器（41KB）
│   │   ├── TableDataEditor.vue      # 表数据编辑器（52KB）
│   │   ├── ConnectionEditDialog.vue # 连接编辑对话框（已支持 pg）
│   │   ├── SqlEditor.vue            # SQL 编辑器
│   │   └── ...
│   └── sql-completion.ts            # SQL 补全
├── shared/                          # 前后端共享代码
│   ├── database-table-design.ts     # 表设计数据结构
│   ├── database-table-data.ts       # 表数据查询构建
│   ├── sql-statements.ts            # SQL 语句拆分
│   └── ...
└── database-sync.ts                 # 数据库同步（根目录 src 下）
```

## 5. 开发注意事项

1. **语言**：用户要求所有回复用中文，代码注释与既有风格一致
2. **Git**：不主动 commit/push，只在用户明确要求时执行
3. **最小改动**：只改与当前需求直接相关的代码
4. **Shell**：用户环境是 Windows PowerShell，`&&` 不可用，用 `;` 或分开执行
5. **Node.js**：项目要求 Node.js >= 22.19.0
6. **开发命令**：
   ```bash
   cd d:\接单\IM\IM-ops\viron
   npm ci                    # 安装依赖（已完成）
   cp .env.example .env      # 复制配置
   npm run dev               # 启动开发模式
   npm run typecheck          # 类型检查
   npm test                   # 测试
   ```
7. **PostgreSQL 连接器的关键接口**：`DatabaseConnectionClient`（定义在 `connector.ts`），pg-connector 已实现该接口，但 `query()` 返回值格式需要与 MySQL 的 `[rows, fields]` 对齐
8. **元数据库**：Viron 自身的元数据库（存用户/连接/环境等）默认 SQLite，与 IM 业务库完全隔离
9. **改造模式**：所有数据库工作台端点都是在已有 MySQL 逻辑基础上，通过 `if (record.engine === "postgresql") { ... }` 加 pg 分支

## 6. 下一步建议的开发顺序

1. **先做阶段 2.1**（表结构详情端点 pg 分支）— 这是表设计器和数据网格的基础
2. **再做阶段 2.3**（数据网格编辑 pg 分支）— 用户最常用的功能
3. **然后做阶段 2.2**（表设计器 DDL 生成）— 建表/改表
4. **最后做阶段 2.4-2.6**（补全/导入导出/同步）— 锦上添花
