# 通讯录展示与删除已解散群 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 通讯录群列表显示已解散群（灰标签、排后），点进复用群资料页（只读+删除按钮），成员可删除已解散群（仅移除成员记录，不碰 OpenIM）。

**Architecture:** 服务端 `ListGroups` 放宽 status 过滤返回已解散群并带 status 字段；新增轻量已解散群详情接口与删除接口（service 层经 `internalGroupID` 转 UUID，repo 层操作）。前端 `GroupPreview` 加 status，群列表点击区分正常/已解散，`detail.vue` 增加 `dissolved=1` 精简模式。

**Tech Stack:** Go + gin + pgx（服务端）；Vue3 + uni-app + pinia（前端）。

---

## 文件结构

**服务端（IM-APP-server）：**
- `internal/models/models.go` — 改：`GroupPreview` 加 Status；新增 `DissolvedGroupInfo`
- `internal/repository/contact.go` — 改：`ListGroups` 返回已解散群 + status + 排序
- `internal/repository/group.go` — 改：新增 `GetDissolvedInfo`、`RemoveDissolvedMembership`
- `internal/service/group.go` — 改：新增 `GetDissolvedInfo`、`RemoveDissolvedGroup`
- `internal/service/group_dissolved_test.go` — 建：参数校验测试
- `internal/handler/group.go` — 改：新增 `DissolvedInfo`、`RemoveDissolvedGroup`
- `cmd/server/main.go` — 改：注册两条路由

**前端（IM-APP-fronend）：**
- `src/types/contact.ts` — 改：`GroupPreview` 加 status
- `src/api/group.ts` — 改：新增 `fetchDissolvedGroup`、`removeDissolvedGroup`
- `src/pages/contacts/index.vue` — 改：灰标签 + 点击逻辑
- `src/pages/contacts/groups.vue` — 改：灰标签 + 点击逻辑
- `src/pages/group/detail.vue` — 改：已解散精简模式

---

### Task 1: 服务端模型扩展

**Files:**
- Modify: `IM-APP-server/internal/models/models.go`

- [ ] **Step 1: `GroupPreview` 加 Status，新增 `DissolvedGroupInfo`**

在 `models.go` 中找到 `type GroupPreview struct`（当前为 `ID/Name/Avatar/Role/ConversationID`），替换为：

```go
type GroupPreview struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	Avatar         string `json:"avatar"`
	Role           string `json:"role,omitempty"`
	ConversationID string `json:"conversationId,omitempty"`
	Status         string `json:"status,omitempty"`
}
```

在其后新增：

```go
// DissolvedGroupInfo 已解散群的轻量资料（通讯录详情页只读展示用）
type DissolvedGroupInfo struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Avatar string `json:"avatar"`
	Status string `json:"status"`
}
```

- [ ] **Step 2: 编译验证**

Run: `cd IM-APP-server && go build ./internal/models/...`
Expected: 无输出（编译成功）

- [ ] **Step 3: Commit**

```bash
git add IM-APP-server/internal/models/models.go
git commit -m "feat(server): GroupPreview 增加 status 字段，新增 DissolvedGroupInfo 模型"
```

---

### Task 2: `ListGroups` 返回已解散群

**Files:**
- Modify: `IM-APP-server/internal/repository/contact.go:78-107`

- [ ] **Step 1: 修改 `ListGroups`**

将 `contact.go` 中 `ListGroups`（约 78-107 行）的 SQL 改为允许 active+dismissed、SELECT 加 status、排序已解散在后：

```go
func (r *ContactRepo) ListGroups(ctx context.Context, uid, role string) ([]models.GroupPreview, error) {
	query := `
		SELECT g.public_id, g.name, g.avatar, gm.role, COALESCE(g.conversation_id::text,''), COALESCE(g.status,'active')
		FROM groups g
		JOIN group_members gm ON gm.group_id = g.id
		WHERE gm.user_id=$1 AND COALESCE(g.status,'active') IN ('active','dismissed')`
	args := []interface{}{uid}
	if role == "owner" {
		query += ` AND gm.role='owner'`
	} else if role == "joined" || role == "member" {
		query += ` AND gm.role <> 'owner'`
	} else if role == "admin" {
		query += ` AND gm.role='admin'`
	}
	query += ` ORDER BY CASE g.status WHEN 'active' THEN 0 ELSE 1 END, g.created_at DESC`
	rows, err := r.DB.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := make([]models.GroupPreview, 0)
	for rows.Next() {
		var g models.GroupPreview
		if err := rows.Scan(&g.ID, &g.Name, &g.Avatar, &g.Role, &g.ConversationID, &g.Status); err != nil {
			return nil, err
		}
		list = append(list, g)
	}
	return list, nil
}
```

- [ ] **Step 2: 编译验证**

Run: `cd IM-APP-server && go build ./...`
Expected: 编译成功

- [ ] **Step 3: Commit**

```bash
git add IM-APP-server/internal/repository/contact.go
git commit -m "feat(server): 群列表返回已解散群并带 status，排序置后"
```

---

### Task 3: 服务端新增已解散群查询与删除的 repo 方法

**Files:**
- Modify: `IM-APP-server/internal/repository/group.go`

- [ ] **Step 1: 新增 `GetDissolvedInfo`**

在 `group.go` 中 `GetByID`（约 143 行）之前新增：

```go
// GetDissolvedInfo 已解散群的轻量资料（不校验请求者成员身份，仅用于通讯录只读展示）
func (r *GroupRepo) GetDissolvedInfo(ctx context.Context, groupID string) (models.DissolvedGroupInfo, error) {
	var g models.DissolvedGroupInfo
	err := r.DB.QueryRow(ctx, `
		SELECT public_id, name, COALESCE(avatar,''), status
		FROM groups WHERE id=$1::uuid AND status='dismissed'`, groupID).Scan(
		&g.ID, &g.Name, &g.Avatar, &g.Status)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return models.DissolvedGroupInfo{}, ErrGroupNotFound
		}
		return models.DissolvedGroupInfo{}, err
	}
	return g, nil
}
```

- [ ] **Step 2: 新增 `RemoveDissolvedMembership`**

在 `Dismiss`（约 626 行）之前新增：

```go
// RemoveDissolvedMembership 成员从已解散群中移除自己（owner/普通成员均可，不碰 OpenIM）
func (r *GroupRepo) RemoveDissolvedMembership(ctx context.Context, groupID, uid string) error {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var status string
	err = tx.QueryRow(ctx, `SELECT status FROM groups WHERE id=$1::uuid`, groupID).Scan(&status)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrGroupNotFound
		}
		return err
	}
	if status != "dismissed" {
		return ErrInvalidGroupOperation
	}
	if _, err := tx.Exec(ctx, `DELETE FROM group_members WHERE group_id=$1::uuid AND user_id=$2::uuid`, groupID, uid); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
```

- [ ] **Step 3: 编译验证**

Run: `cd IM-APP-server && go build ./internal/repository/...`
Expected: 编译成功

- [ ] **Step 4: Commit**

```bash
git add IM-APP-server/internal/repository/group.go
git commit -m "feat(server): 新增已解散群轻量查询与成员移除方法"
```

---

### Task 4: service 层方法与参数校验测试

**Files:**
- Modify: `IM-APP-server/internal/service/group.go`
- Create: `IM-APP-server/internal/service/group_dissolved_test.go`
- Test: `IM-APP-server/internal/service/group_dissolved_test.go`

- [ ] **Step 1: 写失败测试**

创建 `group_dissolved_test.go`：

```go
package service

import (
	"context"
	"errors"
	"testing"

	"im-app-server/internal/repository"
)

// 已解散群接口与现有群接口一致：非数字 public_id 在访问 DB 前即被拒绝。
func TestDissolvedGroupRejectsInvalidPublicID(t *testing.T) {
	svc := &GroupService{}
	ctx := context.Background()
	uid := "10223cf6-59ec-4556-8c09-141915e190ed"

	if _, err := svc.GetDissolvedInfo(ctx, "abc"); !errors.Is(err, repository.ErrInvalidGroupOperation) {
		t.Fatalf("GetDissolvedInfo('abc') error = %v, want ErrInvalidGroupOperation", err)
	}
	if err := svc.RemoveDissolvedGroup(ctx, "abc", uid); !errors.Is(err, repository.ErrInvalidGroupOperation) {
		t.Fatalf("RemoveDissolvedGroup('abc') error = %v, want ErrInvalidGroupOperation", err)
	}
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cd IM-APP-server && go test ./internal/service/ -run TestDissolvedGroupRejectsInvalidPublicID -v`
Expected: FAIL（`GetDissolvedInfo`/`RemoveDissolvedGroup` 未定义，编译失败）

- [ ] **Step 3: 在 `group.go` 新增 service 方法**

在 `GetDetail`（约 52 行）后追加：

```go
func (s *GroupService) GetDissolvedInfo(ctx context.Context, groupID string) (models.DissolvedGroupInfo, error) {
	internalID, err := s.internalGroupID(ctx, groupID)
	if err != nil {
		return models.DissolvedGroupInfo{}, err
	}
	return s.Groups.GetDissolvedInfo(ctx, internalID)
}

func (s *GroupService) RemoveDissolvedGroup(ctx context.Context, groupID, uid string) error {
	internalID, err := s.internalGroupID(ctx, groupID)
	if err != nil {
		return err
	}
	return s.Groups.RemoveDissolvedMembership(ctx, internalID, uid)
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd IM-APP-server && go test ./internal/service/ -run TestDissolvedGroupRejectsInvalidPublicID -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add IM-APP-server/internal/service/group.go IM-APP-server/internal/service/group_dissolved_test.go
git commit -m "feat(server): 已解散群 service 方法（查询+移除）及参数校验测试"
```

---

### Task 5: handler 方法与路由注册

**Files:**
- Modify: `IM-APP-server/internal/handler/group.go`
- Modify: `IM-APP-server/cmd/server/main.go`

- [ ] **Step 1: 新增 handler 方法**

在 `handler/group.go` 的 `detail` 方法（约 67 行）后新增：

```go
// DissolvedInfo 已解散群轻量资料（通讯录只读展示用）
func (h *GroupHandler) DissolvedInfo(c *gin.Context) {
	g, err := h.Svc.GetDissolvedInfo(c.Request.Context(), c.Param("id"))
	if err != nil {
		if errors.Is(err, repository.ErrGroupNotFound) {
			response.Fail(c, http.StatusNotFound, "群不存在")
			return
		}
		if errors.Is(err, repository.ErrInvalidGroupOperation) {
			response.Fail(c, http.StatusBadRequest, "群聊 ID 不正确")
			return
		}
		response.Fail(c, http.StatusInternalServerError, "查询失败")
		return
	}
	response.OK(c, g)
}

// RemoveDissolvedGroup 成员删除已解散群（仅移除自己的成员记录）
func (h *GroupHandler) RemoveDissolvedGroup(c *gin.Context) {
	uid := middleware.UserID(c)
	if err := h.Svc.RemoveDissolvedGroup(c.Request.Context(), c.Param("id"), uid); err != nil {
		if errors.Is(err, repository.ErrGroupNotFound) {
			response.Fail(c, http.StatusNotFound, "群不存在")
			return
		}
		if errors.Is(err, repository.ErrInvalidGroupOperation) {
			response.Fail(c, http.StatusBadRequest, "该群不是已解散状态")
			return
		}
		response.Fail(c, http.StatusInternalServerError, "操作失败")
		return
	}
	response.OK(c, gin.H{"ok": true})
}
```

确认 `handler/group.go` 顶部已导入 `errors`、`net/http`、`im-app-server/internal/repository`、`im-app-server/internal/middleware`（现有代码已用，无需新增 import）。

- [ ] **Step 2: 注册路由**

在 `cmd/server/main.go` 中，`auth.POST("/groups/:id/dismiss", groupH.Dismiss)`（约 288 行）之后新增：

```go
			auth.GET("/groups/:id/dissolved", groupH.DissolvedInfo)
			auth.POST("/groups/:id/dissolved/remove", groupH.RemoveDissolvedGroup)
```

- [ ] **Step 3: 编译验证**

Run: `cd IM-APP-server && go build ./...`
Expected: 编译成功

- [ ] **Step 4: 运行全部服务端测试**

Run: `cd IM-APP-server && go test ./...`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add IM-APP-server/internal/handler/group.go IM-APP-server/cmd/server/main.go
git commit -m "feat(server): 已解散群轻量详情与删除接口及路由"
```

---

### Task 6: 前端类型与 API

**Files:**
- Modify: `IM-APP-fronend/src/types/contact.ts`
- Modify: `IM-APP-fronend/src/api/group.ts`

- [ ] **Step 1: `GroupPreview` 加 status**

在 `src/types/contact.ts` 中 `GroupPreview`（约 38-44 行）加字段：

```ts
export interface GroupPreview {
  id: string
  name: string
  avatar: string
  role?: string
  conversationId?: string
  status?: 'active' | 'dismissed'
}
```

- [ ] **Step 2: 新增两个 API**

在 `src/api/group.ts` 中 `dismissGroup` 附近新增：

```ts
/** 已解散群轻量资料（通讯录只读展示用） */
export async function fetchDissolvedGroup(groupId: string): Promise<{
  id: string
  name: string
  avatar: string
  status: string
}> {
  return request({ url: `/groups/${groupId}/dissolved`, method: 'GET' })
}

/** 成员删除已解散群（仅移除自己的成员记录，不碰 OpenIM） */
export async function removeDissolvedGroup(groupId: string): Promise<void> {
  await request({ url: `/groups/${groupId}/dissolved/remove`, method: 'POST' })
}
```

- [ ] **Step 3: 类型检查**

Run: `cd IM-APP-fronend && npx vue-tsc --noEmit`（若脚本不存在则 `npx tsc --noEmit -p tsconfig.json`）
Expected: 通过（无新增类型错误）

- [ ] **Step 4: Commit**

```bash
git add IM-APP-fronend/src/types/contact.ts IM-APP-fronend/src/api/group.ts
git commit -m "feat(frontend): 群类型与 API 支持已解散群"
```

---

### Task 7: 通讯录群列表展示已解散群

**Files:**
- Modify: `IM-APP-fronend/src/pages/contacts/index.vue`
- Modify: `IM-APP-fronend/src/pages/contacts/groups.vue`

- [ ] **Step 1: `index.vue` 点击逻辑 + 灰标签**

`index.vue` 中 `openGroupChat`（约 91 行）改为：

```ts
function openGroupChat(g: GroupPreview) {
  if (g.status === 'dismissed') {
    uni.navigateTo({ url: `/pages/group/detail?id=${encodeURIComponent(g.id)}&dissolved=1` })
    return
  }
  contactStore.openChatWithGroup(g.id, g.name, g.avatar || '/static/icons/menu-group.svg')
}
```

模板 `group-card`（约 170-176 行）内，`<text class="group-name">` 之后加：

```html
          <text v-if="g.status === 'dismissed'" class="dissolved-tag">已解散</text>
```

样式区（约 381 行 `.group-name` 之后）新增：

```scss
.dissolved-tag {
  flex-shrink: 0;
  font-size: 22rpx;
  color: #999;
  border: 1rpx solid #c9cdd4;
  border-radius: 6rpx;
  padding: 2rpx 10rpx;
  margin-left: 12rpx;
}
```

- [ ] **Step 2: `groups.vue` 点击逻辑 + 灰标签**

`groups.vue` 中 `openGroup`（约 32 行）改为：

```ts
function openGroup(g: GroupPreview) {
  if (g.status === 'dismissed') {
    uni.navigateTo({ url: `/pages/group/detail?id=${encodeURIComponent(g.id)}&dissolved=1` })
    return
  }
  contactStore.openChatWithGroup(g.id, g.name, g.avatar || APP_CONFIG.defaultGroupAvatarUrl)
}
```

模板 `row`（约 56-69 行）内，`<text class="name">` 之后加：

```html
      <text v-if="g.status === 'dismissed'" class="dissolved-tag">已解散</text>
```

样式区新增：

```scss
.dissolved-tag {
  flex-shrink: 0;
  font-size: 22rpx;
  color: #999;
  border: 1rpx solid #c9cdd4;
  border-radius: 6rpx;
  padding: 2rpx 10rpx;
  margin-left: 12rpx;
}
```

- [ ] **Step 3: 类型检查**

Run: `cd IM-APP-fronend && npx vue-tsc --noEmit`
Expected: 通过

- [ ] **Step 4: Commit**

```bash
git add IM-APP-fronend/src/pages/contacts/index.vue IM-APP-fronend/src/pages/contacts/groups.vue
git commit -m "feat(frontend): 通讯录群列表展示已解散群灰标签并区分点击入口"
```

---

### Task 8: `detail.vue` 已解散精简模式

**Files:**
- Modify: `IM-APP-fronend/src/pages/group/detail.vue`

- [ ] **Step 1: 脚本部分改造**

`detail.vue` 中 import 增加两个 API（在 `clearConversationHistory` import 附近）：

```ts
import { clearConversationHistory } from '@/api/im'
import { fetchDissolvedGroup, removeDissolvedGroup } from '@/api/group'
```

新增状态（在 `const leaving = ref(false)` 之后）：

```ts
const dissolved = ref(false)
const dissolvedInfo = ref<{ id: string; name: string; avatar: string; status: string } | null>(null)
```

`onLoad`（约 87 行）改为读取 dissolved：

```ts
onLoad((query) => {
  groupId.value = String(query?.id || '')
  dissolved.value = String(query?.dissolved || '') === '1'
})
```

`onShow`（约 91 行）改为：dissolved 时走轻量接口：

```ts
onShow(async () => {
  if (!groupId.value) {
    uni.showToast({ title: '缺少群聊 ID', icon: 'none' })
    return
  }
  if (dissolved.value) {
    try {
      dissolvedInfo.value = await fetchDissolvedGroup(groupId.value)
    } catch (e) {
      uni.showToast({ title: (e as Error)?.message || '群不存在或不是已解散状态', icon: 'none' })
      safeBack('/pages/contacts/index')
    }
    return
  }
  try {
    if (!userStore.profile) await userStore.loadProfile()
    await groupStore.loadDetail(groupId.value)
    await initConversationSettings()
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '加载群聊详情失败', icon: 'none' })
  }
})
```

新增删除方法（`onLeave` 之后）：

```ts
async function onRemoveDissolved() {
  const res = await uni.showModal({
    title: '删除该群',
    content: '删除后通讯录将不再显示该群，聊天记录保留。确定删除吗？',
    confirmText: '删除',
    cancelText: '取消',
  })
  if (!res.confirm) return
  uni.showLoading({ title: '删除中…', mask: true })
  try {
    await removeDissolvedGroup(groupId.value)
    uni.reLaunch({ url: '/pages/contacts/index' })
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '删除失败', icon: 'none' })
  } finally {
    uni.hideLoading()
  }
}
```

- [ ] **Step 2: 模板加已解散分支**

将 `<template>` 整个包裹改为：外层 `page-wrap` 内，先 `v-if="dissolved"` 渲染精简视图，否则渲染现有内容。具体：在 `<view class="page-wrap">` 内、现有 `<scroll-view>` 之前插入已解散分支，并给现有 `<scroll-view>` 加 `v-else`：

```html
  <view class="page-wrap">
    <view v-if="dissolved" class="dissolved-page">
      <ImNavBar title="群组详情" @back="goBack" />
      <view class="dissolved-card">
        <image class="dissolved-avatar" :src="dissolvedInfo?.avatar || APP_CONFIG.defaultGroupAvatarUrl" mode="aspectFit" />
        <text class="dissolved-name">{{ dissolvedInfo?.name || '群聊' }}</text>
        <text class="dissolved-tip">该群已解散</text>
      </view>
      <view class="dissolved-delete-row" @click="onRemoveDissolved">
        <text class="dissolved-delete-label">删除该群</text>
      </view>
    </view>
    <scroll-view v-else scroll-y class="page" :show-scrollbar="false">
```

- [ ] **Step 3: 新增已解散模式样式**

在 `<style scoped>` 内新增：

```scss
.dissolved-page {
  height: 100vh;
  height: 100dvh;
  background: #f3f4f7;
  box-sizing: border-box;
}

.dissolved-card {
  margin-top: 16rpx;
  background: #fff;
  padding: 64rpx 40rpx 48rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24rpx;
}

.dissolved-avatar {
  width: 160rpx;
  height: 160rpx;
  border-radius: 24rpx;
  background: #eee;
}

.dissolved-name {
  font-size: 36rpx;
  font-weight: 600;
  color: #212121;
}

.dissolved-tip {
  font-size: 26rpx;
  color: #999;
}

.dissolved-delete-row {
  margin-top: 48rpx;
  background: #fff;
  min-height: 100rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.dissolved-delete-label {
  font-size: 30rpx;
  color: #ff4d4f;
  font-weight: 500;
}
```

- [ ] **Step 4: 类型检查**

Run: `cd IM-APP-fronend && npx vue-tsc --noEmit`
Expected: 通过

- [ ] **Step 5: Commit**

```bash
git add IM-APP-fronend/src/pages/group/detail.vue
git commit -m "feat(frontend): 群资料页支持已解散精简模式与删除入口"
```

---

### Task 9: 全量验证

- [ ] **Step 1: 服务端测试与构建**

Run: `cd IM-APP-server && go build ./... && go test ./...`
Expected: 编译成功，全部测试 PASS

- [ ] **Step 2: 前端类型检查**

Run: `cd IM-APP-fronend && npx vue-tsc --noEmit`
Expected: 通过

- [ ] **Step 3: 手工验证要点**

- 通讯录「群聊天」/ 通讯录首页群卡片：已解散群显示「已解散」灰标签，排在正常群后。
- 点正常群 → 进聊天室（不变）。
- 点已解散群 → 进群资料页，仅见头像/群名/「该群已解散」+「删除该群」。
- 聊天列表点已解散群 → toast「群已解散」+ 返回（不变）。
- 「删除该群」→ 确认 → 回通讯录，该群不再显示；OpenIM 会话与历史消息保留。

- [ ] **Step 4: 最终提交确认**

Run: `git status`
Expected: 工作区无遗留（system 的 `vite.config.ts` 改动保持未提交，按用户要求不提交）
