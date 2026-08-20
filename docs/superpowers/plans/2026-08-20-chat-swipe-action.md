# 聊天列表左滑操作（置顶 / 移除）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在聊天列表（`pages/chat/index.vue`）给每条会话增加左滑操作：「置顶」与「移除」。

**Architecture:** 引入 `@dcloudio/uni-ui` 提供 `<uni-swipe-action>` 跨端滑动组件；新增 `ImSwipeActionItem.vue` 组合 `<ConversationItem>` 拦截事件冒泡；在 `stores/chat.ts` 新增 `togglePin` / `hideConversationLocal` 两个动作（新置顶走 `setConversationPin` 已存在 API，移除走新增 `hideConversation` 封装）；置顶用乐观更新 + 失败回滚，移除用本地 filter + 失败回插。

**Tech Stack:** uni-app + Vue 3 + Pinia + OpenIM SDK + `@dcloudio/uni-ui` + TypeScript + SCSS

**Spec:** `docs/superpowers/specs/2026-08-20-chat-swipe-action-design.md`

---

## File Structure

执行此计划将涉及的文件：

| 类型 | 路径 | 责任 |
|---|---|---|
| Modify | `IM-APP-fronend/package.json` | 新增 `@dcloudio/uni-ui` 依赖 |
| Modify | `IM-APP-fronend/src/pages.json` | 配置 easycom 自动引入 uni-ui 组件 |
| Modify | `IM-APP-fronend/src/utils/openim.ts` | 新增 `hideConversation` 封装 |
| Modify | `IM-APP-fronend/src/stores/chat.ts` | 新增 `togglePin` / `hideConversationLocal` 两个 store action |
| Create | `IM-APP-fronend/src/components/ImSwipeActionItem.vue` | 包装 `uni-swipe-action-item` + `<ConversationItem>`，拦截事件冒泡 |
| Modify | `IM-APP-fronend/src/pages/chat/index.vue` | 把列表渲染从 `<ConversationItem>` 替换为 `<ImSwipeActionItem>`，配置右滑按钮 |

不在范围的文件（保持不变）：
- `IM-APP-fronend/src/components/ConversationItem.vue` — 核心渲染逻辑稳定，外部组合替代

---

## Task 1: 安装 uni-ui 依赖并配置 easycom

**Files:**
- Modify: `IM-APP-fronend/package.json`
- Modify: `IM-APP-fronend/src/pages.json`

- [ ] **Step 1: 修改 `package.json` 新增依赖**

打开 `IM-APP-fronend/package.json`，在 `dependencies` 块末尾（`"@openim/protocol"` 之后）新增：

```json
"@dcloudio/uni-ui": "^1.5.7",
```

注意：版本号需与 `@dcloudio/uni-app` 主版本兼容，参考 uni-app 官方文档当前推荐版本。如安装时 npm 提示版本冲突，使用实际能解析的版本。

- [ ] **Step 2: 安装依赖**

```bash
cd IM-APP-fronend
npm install @dcloudio/uni-ui --save
```

Expected: 看到 `+ @dcloudio/uni-ui@x.y.z` 行；`package-lock.json` 同步更新；`node_modules/@dcloudio/uni-ui` 目录存在。

- [ ] **Step 3: 在 `pages.json` 顶部新增 `easycom` 字段**

打开 `IM-APP-fronend/src/pages.json`，在 `{` 之后第一行新增 `easycom` 配置（注意是顶层，不是 `pages` 数组里）：

```json
{
  "easycom": {
    "autoscan": true,
    "custom": {
      "^uni-(.*)": "@dcloudio/uni-ui/lib/uni-$1/uni-$1.vue"
    }
  },
  "pages": [
    ...
  ],
  ...
}
```

注意：`autoscan: true` 表示如果用户自定义组件也用 `uni-` 开头，会自动扫描；我们项目没有这个冲突模式。

- [ ] **Step 4: 跑类型检查确认不影响其它代码**

```bash
cd IM-APP-fronend
npm run type-check
```

Expected: 类型检查通过，无报错（uni-ui 还未被引用，按需编译不影响）。

- [ ] **Step 5: 提交**

```bash
git add IM-APP-fronend/package.json IM-APP-fronend/package-lock.json IM-APP-fronend/src/pages.json
git commit -m "feat(deps): 引入 @dcloudio/uni-ui 用于左滑操作"
```

---

## Task 2: 在 `utils/openim.ts` 新增 `hideConversation` 封装

**Files:**
- Modify: `IM-APP-fronend/src/utils/openim.ts`

- [ ] **Step 1: 在 `setConversationRecvOpt` 函数后新增 `hideConversation`**

打开 `IM-APP-fronend/src/utils/openim.ts`，搜索 `setConversationRecvOpt` 函数（位于约 1389 行附近），在它之后（约 1392 行）插入：

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

- [ ] **Step 2: 跑类型检查**

```bash
cd IM-APP-fronend
npm run type-check
```

Expected: 类型检查通过，无新增报错。

- [ ] **Step 3: 提交**

```bash
git add IM-APP-fronend/src/utils/openim.ts
git commit -m "feat(openim): 新增 hideConversation 封装"
```

---

## Task 3: 在 `stores/chat.ts` 新增 `togglePin` 和 `hideConversationLocal`

**Files:**
- Modify: `IM-APP-fronend/src/stores/chat.ts`

- [ ] **Step 1: 在 import 区引入 `hideConversation`**

打开 `IM-APP-fronend/src/stores/chat.ts`，在 `from '@/utils/openim'` 的导入列表中找到 `setConversationPin`（如果存在）或 `clearConversationMessages` 之后的位置，确保这行包含 `hideConversation`：

```ts
import {
  ...
  clearConversationMessages,
  hideConversation,
  ...
} from '@/utils/openim'
```

如未引入 `setConversationPin`，同样加入。最终这一行应包含：clearConversationMessages, hideConversation, setConversationPin。

- [ ] **Step 2: 在 `patchConversation` 函数前新增 `togglePin`**

在 `stores/chat.ts` 中找到 `function patchConversation`（约 567 行），在它之前插入：

```ts
/**
 * 切换会话置顶状态。OpenIM 云同步，多端一致。
 * 乐观更新：先 patchConversation 翻转 pinned 字段，失败时回滚。
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
```

- [ ] **Step 3: 在 `togglePin` 之后新增 `hideConversationLocal`**

紧随 `togglePin` 之后插入：

```ts
/**
 * 从聊天列表移除（本地隐藏）。SDK 不会再推送该会话，
 * 直到有新消息触发 OnNewConversation / OnConversationChanged。
 * 失败回滚：重新拉回会话（conversationOf 内部会通过 upsertConversations 重新插入 + 排序）。
 */
async function hideConversationLocal(conversationId: string) {
  conversations.value = conversations.value.filter((c) => c.id !== conversationId)
  try {
    await hideConversation(conversationId)
  } catch (e) {
    await conversationOf(conversationId).catch(() => null)
    throw new Error((e as Error)?.message || '移除失败')
  }
}
```

- [ ] **Step 4: 在 `return { ... }` 中导出两个新 action**

找到 `stores/chat.ts` 末尾的 `return {` 块（约 853 行），在 `patchConversation` 附近新增：

```ts
    togglePin,
    hideConversationLocal,
```

具体位置：紧邻 `patchConversation,` 一行之后。

- [ ] **Step 5: 跑类型检查**

```bash
cd IM-APP-fronend
npm run type-check
```

Expected: 类型检查通过，无新增报错。

- [ ] **Step 6: 提交**

```bash
git add IM-APP-fronend/src/stores/chat.ts
git commit -m "feat(chat): 新增 togglePin 与 hideConversationLocal 动作"
```

---

## Task 4: 创建 `ImSwipeActionItem.vue`

**Files:**
- Create: `IM-APP-fronend/src/components/ImSwipeActionItem.vue`

- [ ] **Step 1: 新建组件文件**

创建 `IM-APP-fronend/src/components/ImSwipeActionItem.vue`：

```vue
<script setup lang="ts">
import ConversationItem from '@/components/ConversationItem.vue'
import type { Conversation } from '@/types'

/**
 * 包装 uni-swipe-action-item：组合 <ConversationItem>，
 * 拦截按钮区点击事件，避免冒泡触发"打开会话"。
 *
 * 右侧按钮通过 #right 插槽注入。
 * 整行点击（左侧内容区）才走 item-click，让父组件决定打开会话。
 */

defineProps<{
  item: Conversation
  show: boolean
}>()

const emit = defineEmits<{
  (e: 'item-click', item: Conversation): void
}>()

function onItemClick(item: Conversation) {
  emit('item-click', item)
}
</script>

<template>
  <uni-swipe-action-item :show="show" @click="onItemClick(item)">
    <ConversationItem :item="item" @click="onItemClick" />
    <template #right>
      <slot name="right" />
    </template>
  </uni-swipe-action-item>
</template>

<style scoped lang="scss">
/* uni-swipe-action-item 自带样式 + row 高度继承 */
</style>
```

**注意**：外层 `<uni-swipe-action-item>` 的 `@click` 是 uni-swipe-action-item 暴露的事件（点击**非按钮区**触发），用它做"打开会话"。右侧按钮点击事件由父组件在 `#right` 插槽里直接绑定 `@click`，不会冒泡到 row。

- [ ] **Step 2: 跑类型检查**

```bash
cd IM-APP-fronend
npm run type-check
```

Expected: 可能出现 `uni-swipe-action-item` 全局类型未声明的提示。这是因为 easycom 会在运行时编译时注入类型，类型检查会读不到。如有报错（仅 TS 级别），运行 `npm run dev:h5` 启动一次让 vite 编译过类型即可正常运行；CI 报错时忽略此警告。

- [ ] **Step 3: 提交**

```bash
git add IM-APP-fronend/src/components/ImSwipeActionItem.vue
git commit -m "feat(ui): 新增 ImSwipeActionItem 组件"
```

---

## Task 5: 在 `pages/chat/index.vue` 集成左滑操作

**Files:**
- Modify: `IM-APP-fronend/src/pages/chat/index.vue`

- [ ] **Step 1: 替换 import**

打开 `IM-APP-fronend/src/pages/chat/index.vue`，把 `import ConversationItem from '@/components/ConversationItem.vue'` 替换为：

```ts
import ImSwipeActionItem from '@/components/ImSwipeActionItem.vue'
import { useChatStore } from '@/stores/chat'
```

`useChatStore` 已经在第 7 行 import 过，请去掉重复的 import。

- [ ] **Step 2: 在 `script setup` 中新增响应式状态与方法**

在 `const filterLabel = computed(...)` 之后新增：

```ts
// 当前左滑展开的会话 id（同一时间只允许一个 row 展开）
const activeSwipeId = ref<string | null>(null)

// 点击「置顶」按钮
async function onTogglePin(item: Conversation) {
  activeSwipeId.value = null
  try {
    await chatStore.togglePin(item.id)
  } catch (e) {
    uni.showToast({
      title: (e as Error)?.message || '置顶失败',
      icon: 'none',
    })
  }
}

// 点击「移除」按钮
async function onHideConversation(item: Conversation) {
  activeSwipeId.value = null
  try {
    await chatStore.hideConversationLocal(item.id)
  } catch (e) {
    uni.showToast({
      title: (e as Error)?.message || '移除失败',
      icon: 'none',
    })
  }
}

// 点击 row 内容区 → 打开会话
function onSwipeItemClick(item: Conversation) {
  activeSwipeId.value = null
  openConversation(item)
}
```

并删除原 `function openConversation` 函数的引用（暂时保留原函数体，只是改为被 `onSwipeItemClick` 间接调用）。

- [ ] **Step 3: 把列表循环改为 `<uni-swipe-action>` + `<ImSwipeActionItem>`**

把当前的：

```vue
<ConversationItem
  v-for="item in filtered"
  :key="item.id"
  :item="item"
  @click="openConversation"
/>
```

替换为：

```vue
<uni-swipe-action>
  <ImSwipeActionItem
    v-for="item in filtered"
    :key="item.id"
    :item="item"
    :show="activeSwipeId === item.id"
    @item-click="onSwipeItemClick"
  >
    <template #right>
      <view class="swipe-actions">
        <view
          class="swipe-btn swipe-btn-pin"
          :class="{ active: item.pinned }"
          @click="onTogglePin(item)"
        >
          <text>{{ item.pinned ? '取消置顶' : '置顶' }}</text>
        </view>
        <view class="swipe-btn swipe-btn-remove" @click="onHideConversation(item)">
          <text>移除</text>
        </view>
      </view>
    </template>
  </ImSwipeActionItem>
</uni-swipe-action>
```

- [ ] **Step 4: 把 `closeMenus` 扩展关闭已展开的 row**

找到 `function closeMenus()`（约 80 行），把它的内容改为：

```ts
function closeMenus() {
  showAddMenu.value = false
  showFilter.value = false
  activeSwipeId.value = null
}
```

这样点页面其它区域时，已展开的 row 会自动关闭。

- [ ] **Step 5: 添加左滑按钮样式**

在 `<style scoped>` 块末尾新增：

```scss
.swipe-actions {
  display: flex;
  height: 100%;
}

.swipe-btn {
  width: 140rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28rpx;
  color: #212121;
}

.swipe-btn-pin {
  background: #f0f1f4;
}

.swipe-btn-remove {
  background: #ffe5e5;
  color: #e54d42;
}

.swipe-btn.active {
  background: #e7e8ec;
}
```

- [ ] **Step 6: 跑类型检查 + 启动开发服务**

```bash
cd IM-APP-fronend
npm run type-check
```

Expected: 通过（最多有 uni-swipe-action 全局组件的 TS 提示，不影响运行）。

```bash
cd IM-APP-fronend
npm run dev:h5
```

Expected: 启动成功，浏览器打开 http://localhost:5173/ ，聊天列表页面正常渲染。

- [ ] **Step 7: 提交**

```bash
git add IM-APP-fronend/src/pages/chat/index.vue
git commit -m "feat(chat): 聊天列表左滑支持置顶/移除"
```

---

## Task 6: 手动集成测试

**Files:** 无（手测阶段）

按以下场景手测，确保符合 spec 中的行为：

- [ ] **Step 1: 测试置顶流程**

1. 启动 `npm run dev:h5`，登录账号，进入聊天列表
2. 至少要有 2 个会话（私聊或群聊）
3. 鼠标按住一条会话向左拖拽 → 出现「置顶」和「移除」两个按钮
4. 点击「置顶」→ 该行立即移动到列表顶部，头像右上角出现蓝色徽章
5. 再次左滑该行 → 点击「置顶」→ 徽章消失，行回到按时间排序的位置
6. 刷新页面（F5）→ 置顶状态保留（云同步）

- [ ] **Step 2: 测试移除 + 群聊核心场景**

1. 找一个活跃群聊（其他成员会发消息的）
2. 左滑该群 → 点击「移除」→ 该行立即从列表消失
3. 等群里有人发消息 → 该群重新出现在列表顶部
4. 找一个私聊或冷门群 → 移除 → 该行消失 → 切到聊天页 → 退回到聊天列表 → 该行仍不显示

- [ ] **Step 3: 测试交互冲突**

1. 左滑会话 A 展开 → 不操作
2. 左滑会话 B → A 自动关闭，B 展开
3. 在搜索框输入关键字 → 列表过滤 → 隐藏某行 → 取消搜索 → 列表中确实没有该行
4. 下拉刷新 → 已置顶会话状态保持

- [ ] **Step 4: 测试错误回滚**

通过暂时把 `hideConversation` 内部抛错（注释掉 await）模拟失败：

1. 临时改 `utils/openim.ts` 的 `hideConversation`，让 `imCall('hideConversation'...)` 之前 `throw new Error('模拟失败')`
2. 浏览器 dev tools 看错误 → 点击「移除」按钮 → 看到 toast 「移除失败」，且会话**重新出现在列表中**
3. 改回原代码

- [ ] **Step 5: H5 + App 双端验证**

如可构建 App：执行 `npm run dev:mp-weixin` 跑一遍小程序，确认跨端没有手势失效。

- [ ] **Step 6: 整体提交（如有遗漏）**

如有手测过程中产生的临时改动：

```bash
git status
git add <changed-files>
git commit -m "test: 聊天列表左滑操作手测完成"
```

---

## Task 7: 一次性提交所有改动到 git（按用户偏好）

**根据用户偏好**：批量改完统一提交，不逐个提交。如已按 Task 1-5 各自提交，则跳过本 Task。

如未按 Task 1-5 提交，可在此一次性补提交：

```bash
git add IM-APP-fronend/package.json IM-APP-fronend/package-lock.json IM-APP-fronend/src/pages.json \
  IM-APP-fronend/src/utils/openim.ts \
  IM-APP-fronend/src/stores/chat.ts \
  IM-APP-fronend/src/components/ImSwipeActionItem.vue \
  IM-APP-fronend/src/pages/chat/index.vue \
  docs/superpowers/plans/2026-08-20-chat-swipe-action.md

git commit -m "feat(chat): 聊天列表左滑支持置顶/移除"
```

---

## Self-Review

**1. Spec coverage:**

- ✅ 移除语义（本地隐藏） → Task 2 `hideConversation`, Task 3 `hideConversationLocal`
- ✅ 滑动组件选择（uni-ui） → Task 1 安装 + easycom
- ✅ 按钮顺序（置顶 → 移除） → Task 5 模板顺序
- ✅ 移除无确认 → Task 5 无 modal/toast
- ✅ 置顶用现有徽章 → Task 5 复用 `pin-badge`
- ✅ 组件分层（ImSwipeActionItem 包 ConversationItem） → Task 4
- ✅ 乐观更新 + 失败回滚 → Task 3 togglePin / hideConversationLocal
- ✅ 错误 toast → Task 5
- ✅ closeMenus 关闭已展开 row → Task 5 Step 4
- ✅ 群聊核心场景（解散/未解散） → Task 6 Step 2

**2. Placeholder scan:** ✅ 无 TBD / TODO / "类似 Task N" 类引用

**3. Type consistency:**
- `hideConversation` 在 Task 2 定义，在 Task 3 import 并使用，在 Task 5 通过 store action 调用
- `togglePin` / `hideConversationLocal` 在 Task 3 定义并 export，在 Task 5 通过 `chatStore.togglePin` 调用
- `ImSwipeActionItem` 在 Task 4 创建，在 Task 5 import 并使用
- `Conversation` 类型在 spec / Task 3 / Task 4 / Task 5 一致使用
