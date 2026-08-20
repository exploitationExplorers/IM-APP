# 聊天列表左滑操作（置顶 / 移除）设计

## 背景与目标

聊天列表（`pages/chat/index.vue`）目前只支持点击进入会话、对单条会话做"标已读"等基础操作。用户在使用其它 IM（微信、Telegram、钉钉）时已经习惯通过左滑对单条会话做快捷操作：置顶、未读、删除等。

本次新增两个左滑操作：

1. **置顶**：把会话固定到列表顶部，跨端云同步（基于 OpenIM 现有 `isPinned` 能力）。
2. **移除**：从本地列表中隐藏该会话。群聊未解散时，对方发消息会重新出现在列表上（基于 OpenIM `hideConversation`）。

不在本次范围：批量操作、未读切换、消息免打扰（已通过 conversation 级设置走 `setConversationRecvOpt` 实现，与本任务无关）。

## 关键决策（来自 brainstorming）

| 决策项 | 选择 | 理由 |
|---|---|---|
| 移除语义 | 本地隐藏（`hideConversation`） | 贴合"群未解散别人发消息还会出现"的诉求；最贴合主流 IM 体验 |
| 滑动组件 | 引入 `@dcloudio/uni-ui` 的 `uni-swipe-action` | 跨端兼容性最好；easycom 按需打包 |
| 按钮顺序 | 置顶 → 移除 | 中性动作在前、警示动作在后，符合一般交互习惯 |
| 移除确认 | 无确认，立即隐藏 | 减少操作摩擦；用户可再次进入会话后从会话页操作 |
| 置顶视觉 | 复用现有头像右上角小蓝徽章 | 现有 `pin-badge` 已能清晰区分置顶态 |

## 架构与数据流

```
┌────────────────────────────────────────────────────────────┐
│  pages/chat/index.vue  (聊天列表页)                          │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  scroll-view                                           │  │
│  │    <uni-swipe-action>      ← 每条会话一个 row            │  │
│  │      <uni-swipe-action-item                            │  │
│  │        :right-options="options"                        │  │
│  │        @click="onSwipeAction(item, index)"             │  │
│  │      >                                                 │  │
│  │        <ConversationItem :item="item"/>                │  │
│  │      </uni-swipe-action-item>                          │  │
│  │    </uni-swipe-action>                                 │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
                          ↓ 调用
┌────────────────────────────────────────────────────────────┐
│  stores/chat.ts  (新增 2 个 actions)                          │
│  - togglePin(conversationId)       → setConversationPin      │
│  - hideConversationLocal(id)       → hideConversation         │
│                                                                 │
│  隐藏语义：用户操作后立即从本地列表移除；                            │
│  收到 OnNewConversation 事件时，SDK 会重新插入到列表。                  │
└────────────────────────────────────────────────────────────┘
                          ↓ 走
┌────────────────────────────────────────────────────────────┐
│  utils/openim.ts  (新增 1 个封装)                              │
│  hideConversation(conversationID)  → imCall('hideConversation')│
└────────────────────────────────────────────────────────────┘
```

**置顶事件流**：
1. 用户点击按钮 → `chatStore.togglePin(id)`
2. `patchConversation` 立即翻转本地 `pinned` 字段（乐观更新）
3. `setConversationPin(id, !pinned)` → OpenIM 云同步
4. 跨端：OnConversationChanged 事件推送 → `upsertConversations` 重排
5. 失败：回滚 pinned 字段 + toast

**移除事件流**：
1. 用户点击按钮 → `chatStore.hideConversationLocal(id)`
2. 本地 `conversations.value = filter(...)` 立即移除
3. `hideConversation(id)` → OpenIM 本地标记隐藏
4. 群聊/私聊未解散时，对方发消息触发 `OnConversationChanged` / `OnNewConversation` → 重新插入
5. 失败：从 `conversationOf` 重新拉取并回插 + toast

## 组件分层

```
src/
├── pages/chat/index.vue              ← 改：替换 <ConversationItem> 循环为 <uni-swipe-action>
├── components/
│   ├── ConversationItem.vue          ← 不动：核心渲染逻辑保留
│   └── ImSwipeActionItem.vue         ← 新：包装 uni-swipe-action-item，
│                                         组合 ConversationItem，
│                                         对外暴露 item / @click 等 prop
├── stores/chat.ts                    ← 改：新增 togglePin / hideConversationLocal
├── utils/openim.ts                   ← 改：新增 hideConversation 封装
└── pages.json                        ← 改：easycom 配置自动引入 uni-ui
```

### 为什么新增 `ImSwipeActionItem.vue`？

uni-swipe-action-item 套 ConversationItem 后，按钮点击事件如果不在 row 内部拦截，会冒泡到 row 的 click 触发"打开会话"。需要在 row 内部统一处理：左侧 ConversationItem 区域点击 → 打开会话；右侧按钮区点击 → 走对应 action，避免重复触发。

直接把这些逻辑写在 `pages/chat/index.vue` 里会让单文件模板过厚，包一层组件更清晰，也方便后续 forward / card-picker 等页面复用。

### 为什么不动 ConversationItem 核心渲染？

ConversationItem 后续在 forward / card-picker / favorite-picker 等页面可能复用，保持纯渲染最稳。

## API 签名

### `utils/openim.ts` 新增

```ts
/**
 * 隐藏指定会话（仅本地层面）。
 * - 群聊/私聊未解散时，对方发消息会重新插入列表（OpenIM OnNewConversation 事件触发）。
 * - 不影响服务端消息记录。
 * - 走到 imCall('hideConversation' as IMMethods) → 实际为 OpenIM 客户端双向持有的 "hideConversation" 方法。
 */
export async function hideConversation(conversationID: string): Promise<void> {
  await imCall('hideConversation' as IMMethods, conversationID)
}
```

### `stores/chat.ts` 新增

```ts
/**
 * 切换会话置顶状态。OpenIM 云同步，多端一致。
 * 立即本地 patchConversation 翻转 pinned 字段，UI 即时反映。
 */
async function togglePin(conversationId: string) {
  const conv = conversations.value.find((c) => c.id === conversationId)
  if (!conv) return
  const next = !conv.pinned
  // 乐观更新：先翻本地值，失败再回滚
  patchConversation(conversationId, { pinned: next })
  try {
    await setConversationPin(conversationId, next)
  } catch (e) {
    patchConversation(conversationId, { pinned: !next })
    throw new Error((e as Error)?.message || '置顶失败')
  }
}

/**
 * 从聊天列表移除（本地隐藏）。SDK 不会再推送该会话，直到有新消息触发 OnNewConversation。
 */
async function hideConversationLocal(conversationId: string) {
  conversations.value = conversations.value.filter((c) => c.id !== conversationId)
  try {
    await hideConversation(conversationId)
  } catch (e) {
    // 失败：拉回会话（conversationOf 内部已通过 upsertConversations 重新插入 + 排序）
    await conversationOf(conversationId).catch(() => null)
    throw new Error((e as Error)?.message || '移除失败')
  }
}
```

### `pages.json` 改动

新增 easycom 配置：

```json
{
  "easycom": {
    "autoscan": true,
    "custom": {
      "^uni-(.*)": "@dcloudio/uni-ui/lib/uni-$1/uni-$1.vue"
    }
  }
}
```

## UI 交互与样式

### 左滑后的两项按钮

```
┌────────────────────────────────────────────┐
│ 🟢 会话名称                    时间    |   │ ← 正常状态
│    最后消息预览              [未读 12]  |   │
└────────────────────────────────────────────┘
                          ← 左滑 →
┌────────────────────────────┬──────────────┐
│ 🟢 会话名称                 │ 置顶 │ 移除  │
│    最后消息预览             │      │      │
└────────────────────────────┴──────────────┘
                              ↑ 浅灰    ↑ 浅红
```

**按钮规格**：
- 宽度：每个 140rpx
- 高度：与 row 等高（≈112rpx，与现有 padding 匹配）
- 颜色：
  - **置顶**：浅灰底 `#F0F1F4` + 深灰字 `#212121`（中性，不抢眼）
  - **移除**：浅红底 `#FFE5E5` + 警示红字 `#E54D42`（与未读徽章同色系）
- 字号：28rpx
- 关闭按钮阈值：滑动超过 1/2 宽度自动展开，否则回弹（uni-swipe-action 默认）

### 状态文案

- 置顶点击：无 toast（徽章已足够反馈）
- 移除点击：无 toast（无确认）
- 失败：toast 提示

### 多端兼容

- **H5**：uni-swipe-action 自动 mouse + touch 适配
- **App 原生**：原生手势，自动支持
- **小程序**：基础库 2.0+ 自动支持

### 易遗漏细节

| 项 | 处理 |
|---|---|
| 列表外点击关闭已展开 row | scroll-view 容器 `@click` 关闭（已有 `closeMenus` 模式可复用） |
| 搜索/过滤状态下隐藏某会话 | 隐藏后 store 移除 → filtered 自动跳过 |
| 撤销按钮 | 不做（用户选择无确认） |
| 已解散群移除 | 不做特殊处理，移除后保持一致行为 |

## 错误处理

| 失败场景 | 行为 |
|---|---|
| `setConversationPin` 失败 | `patchConversation` 回滚 pinned 字段；`uni.showToast('置顶失败')` |
| `hideConversation` 失败 | 把会话重新插入列表底部（按 `conversationOf` 重新拉）；`uni.showToast('移除失败')` |
| 切到聊天页时本地 num 异常 | 已有 `requireConversation` 兜底重新拉 |

## 集成测试用例（手测）

1. **置顶流程**
   - 左滑 row → 点「置顶」→ row 头顶出现蓝徽章 + 上下排序换位
   - 再次左滑 → 点「置顶」→ 徽章消失 + 排序回归
   - 杀进程重启 → 重新拉列表 → 置顶状态保留（云同步）

2. **移除流程**
   - 左滑 row → 点「移除」→ row 立即从列表消失
   - 切到聊天页 → 退出回到聊天列表 → 该 row 仍不显示
   - 触发该会话新消息（私聊/群聊）→ row 重新出现在列表顶部

3. **群聊场景（核心需求）**
   - 群聊 A 移除 → 群成员 B 在 A 内发消息 → A 重新出现在列表
   - 群聊 A 已解散 → 移除 → 不会再有新消息触发 → 永久不出现

4. **交互冲突**
   - row A 已展开 → 左滑 row B → row A 自动关闭（uni-swipe-action 开箱默认行为）
   - 搜索框输入 → 列表过滤 → 隐藏某 row → filtered 列表同步移除
   - 下拉刷新 → 不影响已置顶 / 已隐藏状态

5. **多端兼容**（H5 + App）
   - H5 鼠标拖拽滑动
   - App 原生左滑
   - 切换会话页前后 → 状态保持

## 风险点

| 风险 | 缓解 |
|---|---|
| `hideConversation` 在某些平台 SDK 实现差异 | 失败时已回滚；首版只测 H5 + App，发现差异再适配 |
| 现有 `ConversationItem` 在 forward 页等其它地方复用 | 包一层 `ImSwipeActionItem.vue`，不动原组件 |
| 一次性安装整个 uni-ui 包 | 用 easycom 按需编译，影响很小 |
| 置顶状态乐观更新 → 失败回滚 → 列表抖动 | 回滚时也调用 `sortConversations` 避免脏位置 |
