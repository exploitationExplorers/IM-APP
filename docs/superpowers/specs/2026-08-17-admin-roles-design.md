# 管理员与角色（对接真实 API）设计

日期：2026-08-17  
范围：仅 `IM-APP-system` 中「系统管理 → 管理员 / 角色权限」；不改用户管理、群组、审计等其它业务页。

## 背景

- 菜单与路由已存在：`/system/users`、`/system/roles`。
- 当前页面为本地假数据，未调用任何 `@/api`。
- API 文档：`IM-APP-system/im.md`（`/api/admin/v1/admins|roles|permissions`）。

## 决策

采用方案 A + 原页面对接真实接口（完整 CRUD，含 MFA 重置）。

## 菜单与路由

| 现文案 | 新文案 | 路径 | 页面文件 |
|--------|--------|------|----------|
| 平台用户管理 | 管理员 | `/system/users` | `UserManagementView.vue`（就地改造） |
| 角色权限 | 角色权限（可保持） | `/system/roles` | `RolePermissionView.vue`（就地改造） |
| 操作日志 | 不动 | `/system/logs` | 不动 |

仅改 `AppShell.vue` 中「平台用户管理」文案；路由 path 不变。

## 功能

### 管理员（`/system/users`）

- 列表：`GET /api/admin/v1/admins`（`page` / `size` / `keyword`）
- 新建：`POST /api/admin/v1/admins`（username、password≥6、nickname、roleIds、status）
- 编辑：`PATCH /api/admin/v1/admins/{id}`（nickname、password 可选、roleIds、status）
- 启用/停用：`PUT /api/admin/v1/admins/{id}/status`
- 重置 MFA：`POST /api/admin/v1/admins/{id}/mfa/reset`（可选 reason）
- 角色选项来自：`GET /api/admin/v1/roles`

去掉当前假数据、导入/导出等与文档无关的演示能力。

### 角色权限（`/system/roles`）

- 角色列表：`GET /api/admin/v1/roles`
- 权限字典：`GET /api/admin/v1/permissions`（按 `module` 分组勾选）
- 新建：`POST /api/admin/v1/roles`
- 编辑：`PUT /api/admin/v1/roles/{id}`
- 删除：`DELETE /api/admin/v1/roles/{id}`（`code === super_admin` 前端禁用删除）

## API 封装

新增 `src/api/modules/rbac.ts`（或 `admins.ts`），只服务本板块：

- admins CRUD / status / mfa reset
- roles CRUD
- permissions list

类型放在同文件或 `api/interface` 中本模块命名空间，不改其它模块类型。

## 基础设施（最小必要）

1. **Vite 代理**：`/api` → `http://127.0.0.1:8090`（否则开发环境无法打到 `IM-APP-admin`）。
2. **HTTP `patch`**：`RequestHttp` 增加 `patch`（管理员编辑接口为 PATCH）。
3. **鉴权头**：文档要求 `Authorization: Bearer <token>`。在现有请求拦截器中**追加**该头（保留现有 `x-access-token` 不动），以便本板块及其它已接 `/admin/v1` 的页面可走通。不改其它业务视图逻辑。

> 注：若登录仍写假 token，后端会 401。登录对接可另开任务；本设计不重做登录页，但鉴权头与代理要就绪。

## 非目标

- 不改 `/app/users`、群组、短信、转发、审计、导出等页面。
- 不新增平行菜单或新路由 path。
- 不引入新 UI 框架依赖。

## 验收

1. 侧栏显示「管理员」「角色权限」，进入对应页。
2. 后端 `8090` 可用且已登录拿到真实 token 时：列表可加载；管理员可增改、启停、重置 MFA；角色可增改删与勾选权限。
3. 其它菜单页面行为与改前一致。
