# 黑名单列表与解除 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现「我的 → 隐私 → 黑名单」页面，展示当前用户拉黑的所有人，支持搜索和解除。

**Architecture:** 后端新增 `GET /api/contacts/blocked`（查 `user_blocks` JOIN `users`），前端 `blacklist.vue` 重写展示列表 + 解除按钮 + 搜索。复用现有 `DELETE /api/contacts/:id/block` 解除接口。

**Tech Stack:** Go (Gin) + PostgreSQL + uni-app + Vue 3 + TypeScript

**Spec:** `docs/superpowers/specs/2026-08-20-blacklist-design.md`

---

## File Structure

| 类型 | 路径 | 责任 |
|---|---|---|
| Modify | `IM-APP-server/internal/models/models.go` | 新增 `BlockedUser` / `BlockedListResponse` 模型 |
| Modify | `IM-APP-server/internal/repository/contact.go` | 新增 `ListBlockedUsers` 方法 |
| Modify | `IM-APP-server/internal/service/contact.go` | 新增 `ListBlockedContacts` service |
| Modify | `IM-APP-server/internal/handler/user.go` | 新增 `ListBlockedContacts` handler |
| Modify | `IM-APP-server/cmd/server/main.go` | 注册路由 `GET /contacts/blocked` |
| Modify | `IM-APP-fronend/src/api/contact.ts` | 新增 `fetchBlacklist` + `BlockedUser` 类型 |
| Modify | `IM-APP-fronend/src/types/contact.ts` | 新增 `BlockedUser` 类型（如存在） |
| Modify | `IM-APP-fronend/src/pages/mine/blacklist.vue` | 重写：列表 + 搜索 + 解除按钮 |

---

## Task 1: 后端新增 `BlockedUser` 与 `BlockedListResponse` 模型

**Files:**
- Modify: `IM-APP-server/internal/models/models.go`

- [ ] **Step 1: 在 `models.go` 末尾追加新类型**

打开 `IM-APP-server/internal/models/models.go`，在文件末尾（最后一个 `type` 之后）追加：

```go
// BlockedUser 黑名单成员简表（区别于 Contact：不含好友/标签/共同群信息）
type BlockedUser struct {
    ID        string    `json:"id"`
    PublicID  string    `json:"publicId,omitempty"`
    Nickname  string    `json:"nickname"`
    Avatar    string    `json:"avatar"`
    BlockedAt time.Time `json:"blockedAt"`
}

// BlockedListResponse 黑名单列表响应
type BlockedListResponse struct {
    Items []BlockedUser `json:"items"`
    Total int64         `json:"total"`
}
```

- [ ] **Step 2: 确认 `time` 包已 import**

如果文件已经 `import "time"` 则无需修改；否则在 imports 块加 `"time"`。

- [ ] **Step 3: 编译验证**

```bash
cd IM-APP-server && go build ./...
```

Expected: 编译通过，无错误。

- [ ] **Step 4: 提交**

```bash
git add IM-APP-server/internal/models/models.go
git commit -m "feat(server): 新增 BlockedUser 与 BlockedListResponse 模型"
```

---

## Task 2: 后端新增 `ListBlockedUsers` repository 方法

**Files:**
- Modify: `IM-APP-server/internal/repository/contact.go`

- [ ] **Step 1: 在 `IsBlocked` 方法之后新增 `ListBlockedUsers`**

打开 `IM-APP-server/internal/repository/contact.go`，找到 `IsBlocked` 函数（约 383 行），在它之后追加：

```go
// ListBlockedUsers 当前用户拉黑的所有人，按拉黑时间倒序。
// keyword 为空时不附加搜索条件；limit<=0 或 >100 默认 100。
func (r *ContactRepo) ListBlockedUsers(ctx context.Context, uid, keyword string, limit int) ([]models.BlockedUser, int64, error) {
    if limit <= 0 || limit > 100 {
        limit = 100
    }
    var total int64
    if err := r.DB.QueryRow(ctx, `
        SELECT COUNT(*)
        FROM user_blocks b
        JOIN users u ON u.id = b.blocked_id
        WHERE b.user_id = $1::uuid
          AND ($2 = '' OR u.nickname ILIKE '%' || $2 || '%')`,
        uid, keyword).Scan(&total); err != nil {
        return nil, 0, err
    }
    rows, err := r.DB.Query(ctx, `
        SELECT b.blocked_id::text, COALESCE(u.public_id,''), u.nickname, u.avatar, b.created_at
        FROM user_blocks b
        JOIN users u ON u.id = b.blocked_id
        WHERE b.user_id = $1::uuid
          AND ($2 = '' OR u.nickname ILIKE '%' || $2 || '%')
        ORDER BY b.created_at DESC
        LIMIT $3`,
        uid, keyword, limit)
    if err != nil {
        return nil, 0, err
    }
    defer rows.Close()
    items := make([]models.BlockedUser, 0)
    for rows.Next() {
        var u models.BlockedUser
        if err := rows.Scan(&u.ID, &u.PublicID, &u.Nickname, &u.Avatar, &u.BlockedAt); err != nil {
            return nil, 0, err
        }
        items = append(items, u)
    }
    if err := rows.Err(); err != nil {
        return nil, 0, err
    }
    return items, total, nil
}
```

- [ ] **Step 2: 编译验证**

```bash
cd IM-APP-server && go build ./...
```

Expected: 编译通过。

- [ ] **Step 3: 提交**

```bash
git add IM-APP-server/internal/repository/contact.go
git commit -m "feat(server): 新增 ListBlockedUsers repository 方法"
```

---

## Task 3: 后端新增 service 与 handler

**Files:**
- Modify: `IM-APP-server/internal/service/contact.go`
- Modify: `IM-APP-server/internal/handler/user.go`

- [ ] **Step 1: 在 service 中新增 `ListBlockedContacts`**

打开 `IM-APP-server/internal/service/contact.go`，在文件末尾（或 `ListContacts` 附近）新增：

```go
// ListBlockedContacts 返回当前用户的黑名单列表
func (s *ContactService) ListBlockedContacts(ctx context.Context, uid, keyword string, limit int) (models.BlockedListResponse, error) {
    items, total, err := s.Contacts.ListBlockedUsers(ctx, uid, keyword, limit)
    if err != nil {
        return models.BlockedListResponse{}, err
    }
    return models.BlockedListResponse{Items: items, Total: total}, nil
}
```

- [ ] **Step 2: 在 handler 中新增 `ListBlockedContacts`**

打开 `IM-APP-server/internal/handler/user.go`，在 `BlockContact` 之前新增：

```go
func (h *ContactHandler) ListBlockedContacts(c *gin.Context) {
    uid := middleware.UserID(c)
    keyword := c.Query("keyword")
    limit := 100
    if l := c.Query("limit"); l != "" {
        if n, err := strconv.Atoi(l); err == nil {
            limit = n
        }
    }
    resp, err := h.Svc.ListBlockedContacts(c.Request.Context(), uid, keyword, limit)
    if err != nil {
        response.Fail(c, http.StatusInternalServerError, "查询失败")
        return
    }
    response.OK(c, resp)
}
```

如果在文件内还没 `import "strconv"`，在 import 块加 `"strconv"`。

- [ ] **Step 3: 编译验证**

```bash
cd IM-APP-server && go build ./...
```

Expected: 编译通过。

- [ ] **Step 4: 提交**

```bash
git add IM-APP-server/internal/service/contact.go IM-APP-server/internal/handler/user.go
git commit -m "feat(server): 新增 ListBlockedContacts service 与 handler"
```

---

## Task 4: 后端注册路由

**Files:**
- Modify: `IM-APP-server/cmd/server/main.go`

- [ ] **Step 1: 在 `BlockContact` 路由前新增路由**

打开 `IM-APP-server/cmd/server/main.go`，找到 `auth.POST("/contacts/:id/block", contactH.BlockContact)`，在它之前新增：

```go
auth.GET("/contacts/blocked", contactH.ListBlockedContacts),
```

注意：必须放在 `BlockContact` 之前，否则 `/contacts/blocked` 会被 `/contacts/:id/block` 吞掉（Gin 路由匹配规则）。

- [ ] **Step 2: 编译验证**

```bash
cd IM-APP-server && go build ./...
```

Expected: 编译通过。

- [ ] **Step 3: 提交**

```bash
git add IM-APP-server/cmd/server/main.go
git commit -m "feat(server): 注册 GET /contacts/blocked 路由"
```

---

## Task 5: 前端新增 `fetchBlacklist` API 与类型

**Files:**
- Modify: `IM-APP-fronend/src/api/contact.ts`

- [ ] **Step 1: 在 `unblockContact` 之后新增 `fetchBlacklist`**

打开 `IM-APP-fronend/src/api/contact.ts`，在 `unblockContact` 函数之后追加：

```ts
export interface BlockedUser {
  id: string
  publicId?: string
  nickname: string
  avatar: string
  blockedAt: string
}

export async function fetchBlacklist(params?: { keyword?: string; limit?: number }) {
  return request<{ items: BlockedUser[]; total: number }>({
    url: '/contacts/blocked',
    method: 'GET',
    data: params,
  })
}
```

注意：`request` 函数如果当前不支持 GET 传 `data`，检查 `request` 实现，必要时改为在 `data` 中传 `keyword` 与 `limit`，或在 URL 加 query string。

- [ ] **Step 2: 跑类型检查**

```bash
cd IM-APP-fronend && npm run type-check
```

Expected: 通过。

- [ ] **Step 3: 提交**

```bash
git add IM-APP-fronend/src/api/contact.ts
git commit -m "feat(frontend): 新增 fetchBlacklist API 与 BlockedUser 类型"
```

---

## Task 6: 前端重写 `blacklist.vue`

**Files:**
- Modify: `IM-APP-fronend/src/pages/mine/blacklist.vue`

- [ ] **Step 1: 用以下完整代码替换文件**

完整代码：

```vue
<script setup lang="ts">
import { ref, computed } from 'vue'
import AppSearchBar from '@/components/AppSearchBar.vue'
import { fetchBlacklist, unblockContact, type BlockedUser } from '@/api/contact'
import { formatRelativeTime } from '@/utils/format'
import { THEME } from '@/config'

const list = ref<BlockedUser[]>([])
const loading = ref(false)
const keyword = ref('')

const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  if (!k) return list.value
  return list.value.filter(
    (u) => u.nickname.toLowerCase().includes(k) || (u.publicId || '').toLowerCase().includes(k),
  )
})

async function loadList() {
  loading.value = true
  try {
    const res = await fetchBlacklist()
    list.value = res.items
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '加载失败', icon: 'none' })
  } finally {
    loading.value = false
  }
}

function onUnblock(item: BlockedUser) {
  uni.showModal({
    title: '解除黑名单',
    content: `确定将「${item.nickname || item.publicId}」移出黑名单吗？`,
    confirmText: '解除',
    confirmColor: THEME.danger,
    success: async (res) => {
      if (!res.confirm) return
      try {
        await unblockContact(item.id)
        list.value = list.value.filter((u) => u.id !== item.id)
        uni.showToast({ title: '已解除', icon: 'success' })
        // 通知通讯录页面刷新（如有订阅）
        // 简单做法：直接 reload 该用户的通讯录缓存
      } catch (e) {
        uni.showToast({ title: (e as Error).message || '解除失败', icon: 'none' })
      }
    },
  })
}

onLoad(() => {
  loadList()
})
onPullDownRefresh(async () => {
  await loadList()
  uni.stopPullDownRefresh()
})
</script>

<template>
  <view class="page">
    <view class="search-wrap">
      <AppSearchBar v-model="keyword" placeholder="搜索" />
    </view>

    <scroll-view
      scroll-y
      class="list"
      refresher-enabled
      :refresher-triggered="loading"
      @refresherrefresh="onPullDownRefresh"
    >
      <view v-for="item in filtered" :key="item.id" class="item">
        <image class="avatar" :src="item.avatar || '/static/avatar-1.png'" mode="aspectFill" />
        <view class="meta">
          <text class="name">{{ item.nickname || item.publicId }}</text>
          <text class="time">拉黑于 {{ formatRelativeTime(item.blockedAt) }}</text>
        </view>
        <view class="action" @click="onUnblock(item)">
          <text>解除</text>
        </view>
      </view>
      <view v-if="!filtered.length && !loading" class="empty">
        <text>{{ list.length ? '无匹配结果' : '暂无黑名单' }}</text>
      </view>
    </scroll-view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background-color: #fff;
  display: flex;
  flex-direction: column;
}

.search-wrap {
  padding-top: 8rpx;
}

.list {
  flex: 1;
  min-height: 0;
}

.item {
  display: flex;
  align-items: center;
  padding: 24rpx 40rpx;
  border-bottom: 1rpx solid #f0f1f4;
}

.avatar {
  width: 80rpx;
  height: 80rpx;
  border-radius: 50%;
  margin-right: 24rpx;
  background: #eee;
  flex-shrink: 0;
}

.meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.name {
  font-size: 30rpx;
  color: #212121;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.time {
  font-size: 24rpx;
  color: #8a8f9c;
}

.action {
  flex-shrink: 0;
  padding: 12rpx 28rpx;
  border: 1rpx solid #e54d42;
  border-radius: 8rpx;
  color: #e54d42;
  font-size: 26rpx;
}

.empty {
  padding: 120rpx 40rpx;
  text-align: center;
  color: #8a8f9c;
  font-size: 28rpx;
}
</style>
```

- [ ] **Step 2: 跑类型检查**

```bash
cd IM-APP-fronend && npm run type-check
```

Expected: 通过。

- [ ] **Step 3: 提交**

```bash
git add IM-APP-fronend/src/pages/mine/blacklist.vue
git commit -m "feat(frontend): 黑名单页面展示列表与解除"
```

---

## Task 7: 集成测试

**Files:** 无（手测阶段）

按以下场景验证：

1. **空黑名单**：新用户打开页面显示"暂无黑名单"
2. **有黑名单**：在 friend-detail 拉黑一个用户，blacklist 页面显示该用户
3. **搜索**：搜索框输入昵称关键字，列表过滤
4. **拉黑时间**：每行显示相对时间（如"3 天前"）
5. **解除**：点击解除 → 二次确认弹窗 → 确认 → 列表项消失 + Toast"已解除"
6. **下拉刷新**：拉黑新用户后下拉刷新，新用户出现在列表
7. **边界**：解除后再次进入页面，被解除的用户不再显示

## Self-Review

- ✅ Spec coverage：每个 spec 章节都有对应 task
- ✅ Placeholder scan：无 TBD/TODO
- ✅ Type consistency：`BlockedUser` 在 models、API、前端三处一致
- ✅ Sequential ordering：Task 1 → Task 6 顺序合理
