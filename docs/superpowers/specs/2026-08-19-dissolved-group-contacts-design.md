# 通讯录展示与删除已解散群

## 背景

当前群解散后，数据库 `groups.status` 置为 `'dismissed'`，`group_members` 记录保留。但通讯录群列表接口（`ListGroups`）过滤 `status='active'`，导致已解散群在通讯录中不可见。用户希望解散后通讯录仍能看到该群（便于识别），并能删除它以清理残留。

## 需求

1. 通讯录群列表显示已解散群，混在列表中，加灰色「已解散」标签，排在正常群后面。
2. 通讯录点已解散群 → 复用群资料页（`group/detail.vue`），已解散模式下仅展示：群头像、群名、「已解散」提示、底部红色「删除该群」按钮，隐藏其余功能。
3. 点「删除该群」→ 软删除当前用户在该群的 `group_members` 记录（置 `status='left'`、`left_at=NOW()`，owner/成员均可），**不碰 OpenIM**（会话与历史消息保留）。保留成员记录使管理后台成员数（admin 用 `COUNT(*)` 统计）不变。
4. 聊天列表入口行为保持现状：点已解散群会话 → toast「群已解散」+ 返回上一页。

## 服务端改动（IM-APP-server）

### 1. `internal/repository/contact.go` — `ListGroups` 返回已解散群

- WHERE 由 `COALESCE(g.status,'active')='active'` 放宽为 `COALESCE(g.status,'active') IN ('active','dismissed')`。
- SELECT 增加 `g.status`。
- 排序：`CASE g.status WHEN 'active' THEN 0 ELSE 1 END, g.created_at DESC`。
- `models.GroupPreview` 增加 `Status string` 字段。

### 2. 新增轻量详情接口 `GET /groups/:id/dissolved`

- handler：`GroupHandler` 新增方法，调用 `GroupRepo.GetDissolvedInfo(ctx, groupID)`。
- repo：`GroupRepo.GetDissolvedInfo` 查询 `name, avatar, status`，`WHERE id=$1::uuid AND status='dismissed'`，返回 `{ID, Name, Avatar, Status}`；无记录返回 `ErrGroupNotFound` → 404。
- 路由：`auth.GET("/groups/:id/dissolved", groupH.DissolvedInfo)`。

### 3. 新增删除接口 `POST /groups/:id/dissolved/remove`

- handler：`GroupHandler` 新增方法，从鉴权上下文取当前用户 ID。
- repo：`GroupRepo.RemoveDissolvedMembership(ctx, groupID, uid)`：
  - 校验 `groups.status='dismissed'`，否则 `ErrInvalidGroupOperation`。
  - `UPDATE group_members SET status='left', left_at=NOW() WHERE group_id=$1 AND user_id=$2`（软删，保留记录，管理后台 `COUNT(*)` 成员数不变）。
  - `ListGroups` 查询增加 `COALESCE(gm.status,'active')='active'` 过滤，软删后通讯录不再显示该群。
  - 不涉及 OpenIM 同步。
- 路由：`auth.POST("/groups/:id/dissolved/remove", groupH.RemoveDissolvedGroup)`。

## 前端改动（IM-APP-fronend）

### 1. `src/types/contact.ts` — `GroupPreview`

增加 `status?: 'active' | 'dismissed'`。

### 2. `src/api/group.ts`

- 新增 `fetchDissolvedGroup(groupId)` → `GET /groups/:id/dissolved`。
- 新增 `removeDissolvedGroup(groupId)` → `POST /groups/:id/dissolved/remove`。

### 3. 群列表展示与点击逻辑

- `contacts/index.vue`（group-band）与 `contacts/groups.vue`：
  - 已解散群显示灰色「已解散」标签。
  - `openGroupChat`：`status === 'dismissed'` 时 `navigateTo /pages/group/detail?id=xxx&dissolved=1`；否则进聊天室（现状）。

### 4. `pages/group/detail.vue` 已解散模式

- `onLoad` 读取 `dissolved` 参数。
- `dissolved=1` 时：
  - 走 `fetchDissolvedGroup` 拉 `name/avatar`。
  - 模板只渲染：头像、群名、「该群已解散」提示行、底部红色「删除该群」按钮。
  - 其余卡片（成员/管理/设置/免打扰/检举等）全部隐藏。
- 「删除该群」：确认弹框 → `removeDissolvedGroup` → 刷新通讯录列表 → `uni.reLaunch('/pages/contacts/index')`。

## 不做的事

- 不动 OpenIM 会话与历史消息。
- 不改聊天列表入口（已解散群 toast+返回）。
- 不新增已解散群单独页面（复用 `detail.vue`）。

## 边界情况

- 已解散群详情报错（群不存在/未解散）→ toast 提示并返回。
- 删除接口在群非解散态调用 → 400。
- 重复删除（成员记录已删）→ 视为幂等成功或返回友好提示。
