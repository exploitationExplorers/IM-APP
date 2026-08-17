# 管理员与角色 Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox syntax.

**Goal:** 将「系统管理 → 管理员 / 角色权限」从假数据改为对接 `im.md` 真实 API。

**Architecture:** 新增 `rbac.ts` API 封装；就地改造两个 View；最小改动 `vite` 代理、`RequestHttp.patch`、请求头 Bearer。

**Tech Stack:** Vue 3 + Element Plus + Axios + Vite 8

## Global Constraints

- 不改其它业务板块页面
- 路由 path 保持 `/system/users`、`/system/roles`
- API 前缀相对 `VITE_API_URL=/api`，路径用 `/admin/v1/...`

---

### Task 1: 基础设施

- [x] `vite.config.ts` 增加 `/api` → `http://127.0.0.1:8090`
- [x] `api/index.ts` 增加 `patch`；拦截器追加 `Authorization: Bearer`；兼容 `code=0`
- [x] `.env.development` 注释说明代理目标

### Task 2: API 模块

- [x] 新增 `src/api/modules/rbac.ts`（admins / roles / permissions）

### Task 3: 管理员页

- [x] 改造 `UserManagementView.vue` + `UserEditorDrawer.vue`
- [x] `AppShell` 文案「管理员」；router title 同步

### Task 4: 角色权限页

- [x] 改造 `RolePermissionView.vue` 对接 roles/permissions API

### Task 5: 自检

- [x] `npm run type-check`：本次新增文件无报错（仓库内既有 AdminPage/Auth 等缺失类型错误仍在）
