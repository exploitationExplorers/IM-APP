# 黑名单列表与解除 设计

## 背景与目标

**问题**：`src/pages/mine/blacklist.vue` 是空模板（仅搜索框 + "无资料"占位），用户从「我的 → 隐私 → 黑名单」进入看不到自己拉黑的人；后端按 `user_blocks` 表管理黑名单但**没有提供查询列表接口**。

**目标**：打通"查看黑名单 → 解除黑名单"的完整闭环。

- 后端新增 `GET /api/contacts/blocked`，返回当前用户的黑名单列表
- 复用现有 `DELETE /api/contacts/:id/block`（解除黑名单）
- 前端 `blacklist.vue` 重写：展示列表 + 解除按钮 + 搜索 + 拉黑时间
- 前端 `api/contact.ts` 新增 `fetchBlacklist()` 封装

## 关键决策

| 决策项 | 选择 | 理由 |
|---|---|---|
| 列表字段 | 后端 join 返回完整用户信息（id、publicId、nickname、avatar、blockedAt） | 避免前端多次 getUsersInfo；与 ListContacts 风格一致 |
| 搜索 | 支持（按昵称、备注） | 与 ListContacts 一致 |
| 解除操作 | 二次确认弹窗 | 解除可恢复性低（可能要重新手动拉黑），给用户反悔机会 |
| 空状态 | "暂无黑名单" 文案 | 简洁 |
| 拉黑时间 | 显示（按 `blocked_at` 倒序） | 帮助用户回忆拉黑时间，决定是否解除 |
| 一次加载 | 默认全部加载（不上拉分页） | 黑名单通常数量有限（< 100），不分页降低复杂度；超过 100 给前端一次性返回 |
| 解除后是否同步隐藏会话 | 否 | 解除黑名单是关系修复，不影响历史会话可见性 |

## 架构与数据流

```
┌────────────────────────────────────────────────────────────┐
│  pages/mine/blacklist.vue  (重写)                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  AppSearchBar v-model="keyword"                        │  │
│  │  <view v-for="item in filtered" :key="item.id">         │  │
│  │    <image :src="item.avatar">                          │  │
│  │    <text>{{ item.nickname || item.publicId }}</text>     │  │
│  │    <text>{{ formatDate(item.blockedAt) }}</text>      │  │
│  │    <button @click="onUnblock(item)">解除</button>      │  │
│  │  </view>                                                 │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
                          ↓ 调用
┌────────────────────────────────────────────────────────────┐
│  src/api/contact.ts  (新增 fetchBlacklist)                    │
│  - fetchBlacklist()         → GET /api/contacts/blocked      │
│  - unblockContact(contactId)→ DELETE /api/contacts/:id/block│
└────────────────────────────────────────────────────────────┘
                          ↓ HTTP
┌────────────────────────────────────────────────────────────┐
│  IM-APP-server  (新增)                                       │
│  GET /api/contacts/blocked                                    │
│    → ContactHandler.ListBlockedContacts                      │
│    → ContactService.ListBlockedContacts                     │
│    → ContactRepo.ListBlockedUsers (查询 user_blocks JOIN users)│
└────────────────────────────────────────────────────────────┘
```

## API 设计

### 后端新增

#### `GET /api/contacts/blocked`

**查询参数**：
- `keyword`（可选）：按昵称/备注模糊匹配
- `limit`（可选，默认 100，上限 100）

**响应**：
```json
{
  "items": [
    {
      "id": "uuid",
      "publicId": "公开ID",
      "nickname": "昵称",
      "avatar": "头像URL",
      "blockedAt": "2026-08-15T10:30:00Z"
    },
    ...
  ],
  "total": 5
}
```

**返回模型**（与 `Contact` 区分，命名为 `BlockedUser`）：
```go
type BlockedUser struct {
    ID        string    `json:"id"`
    PublicID  string    `json:"publicId,omitempty"`
    Nickname  string    `json:"nickname"`
    Avatar    string    `json:"avatar"`
    BlockedAt time.Time `json:"blockedAt"`
}

type BlockedListResponse struct {
    Items []BlockedUser `json:"items"`
    Total int64         `json:"total"`
}
```

**SQL 思路**：
```sql
SELECT b.blocked_id::text, u.public_id, u.nickname, u.avatar, b.created_at
FROM user_blocks b
JOIN users u ON u.id = b.blocked_id
WHERE b.user_id = $1
  AND ($2 = '' OR u.nickname ILIKE '%' || $2 || '%')
ORDER BY b.created_at DESC
LIMIT $3
```

#### `DELETE /api/contacts/:id/block`（已存在）

不用动，前端继续走 `unblockContact` 即可。

### 前端新增

#### `src/api/contact.ts`

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

#### `src/types/contact.ts`（新增）

```ts
export interface BlockedUser {
  id: string
  publicId?: string
  nickname: string
  avatar: string
  blockedAt: string
}
```

#### `src/pages/mine/blacklist.vue`（重写）

```
script setup:
- keyword (ref<string>) 搜索关键词
- list (ref<BlockedUser[]>) 黑名单列表
- loading (ref<boolean>)
- onLoad → fetchBlacklist()
- onPullDownRefresh → 重新拉取
- filtered = computed 根据 keyword 过滤
- onUnblock(item) → 二次确认 → unblockContact → 本地移除该项

template:
- AppSearchBar
- <view v-for> 列表 item
  - 头像 / 昵称 / 拉黑时间
  - "解除"按钮
- <view v-if="empty">空状态文案
```

## 错误处理

| 失败场景 | 行为 |
|---|---|
| `fetchBlacklist` 失败 | toast 错误 + 列表保持空 |
| `unblockContact` 失败 | toast 错误 + 列表项保留 |
| 网络断开 | onPullDownRefresh 失败不阻塞 UI |

## 集成测试用例

1. **空黑名单列表**：刚注册用户打开页面，显示"暂无黑名单"
2. **有黑名单**：在 friend-detail 拉黑一个人，回到 blacklist 页面看到该人
3. **搜索**：在搜索框输入昵称关键字，列表过滤
4. **解除**：点击解除 → 二次确认弹窗 → 确认 → 列表项消失
5. **解除后**：在 friend-detail 不再显示"已拉黑"标识
6. **拉黑时间**：每行显示相对时间（如"3 天前"）
7. **下拉刷新**：拉黑新用户后下拉刷新，新用户出现在列表

## 风险点

| 风险 | 缓解 |
|---|---|
| 用户量大时性能 | 限制 100 条以内；SQL 已有 `LIMIT` |
| 解除后关系未同步 | 复用现有 `UnblockUser` 事务，与解除好友逻辑统一 |
| 搜索关键字中文编码 | URL 参数用标准 query，gin 默认支持 UTF-8 |
| 解除时序问题（拉黑中点解除） | 二次确认弹窗 + 请求失败保留原项 |
