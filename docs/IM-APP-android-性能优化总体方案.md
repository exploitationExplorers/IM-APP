# IM-APP-android 性能优化总体方案

> 日期：2026-11-16  
> 对比对象：YanChat 3.2.0 APK（静态解包/反汇编）与当前 `IM-APP-android`  
> 目标：解释首登为什么慢，并给出一套按优先级落地、可验收的客户端优化方案  
> 边界：本文只针对 Kotlin/Compose 原生 Android；消息主链仍走 OpenIM SDK，不改 Go 消息接口。

---

## 0. 结论

YanChat 的首登“快”，不是因为它绕过了首次同步，也不是因为服务器比当前项目快，而是因为它的**首屏关键路径更短、数据模型更轻、状态发布更增量**：

1. 会话列表只消费轻量会话对象，不等消息历史；
2. 聊天室直接调用 OpenIM `getAdvancedHistoryMessageList`，拿到第一页就渲染；
3. 群 retention/purge 等业务检查没有出现在聊天首屏的硬门禁里；
4. 会话列表使用 StateFlow + RecyclerView/DiffUtil，消息列表使用 RecyclerView/ViewHolder；
5. 会话最新消息只保留 preview/type/time/seq，不挂完整 serialized 消息。

当前 `IM-APP-android` 已经有 `LazyColumn`、OpenIM 本地 SQLite、Coil 和一批本地优化，但仍有三类问题：

- **首屏等待链太长**：群聊要等 retention 才允许读历史；会话同步为空时有 1s/2s/5s 恢复轮询。
- **状态模型偏重**：`ChatConversation` 仍带完整 `ChatMessage`，`ChatState` 承载消息、会话、群成员、权限、上传等所有字段。
- **消息处理仍有全量路径**：离线/实时消息可能逐条进入 Controller；长会话消息列表没有窗口上限。

优化顺序应是：

**先缩短首屏关键路径 → 再做轻量模型/窗口 → 最后做缓存、Paging 和长期监控。**

---

## 1. YanChat APK 的首屏证据

本节是基于 APK 的静态证据，不运行 APK。

### 1.1 会话列表

反汇编中可见：

- `com.vchat.openim.repository.IMConversationRepository` 持有：
  - `_conversations: MutableStateFlow`
  - `convInfoCache: Map`
- `refreshFromSdk` 调用 OpenIM：
  - `ConversationManager.getAllConversationList`
- 把 `ConversationInfo` 映射成 `MessageSessionEntity` 后直接 publish 到 `_conversations`。
- `NewsViewModel` 用 `combine(getMessageSessionsState(), 在线状态, 群申请数, 群列表)` 生成列表状态。
- `NewsFragment` 使用 `DiffResult`/RecyclerView 更新列表。

结论：会话列表首屏只依赖“会话数据”，不等消息历史，也不等群 retention/purge 业务接口。

### 1.2 聊天室

反汇编中可见：

- `BaseChatViewModel`：
  - `PAGE_SIZE = 20`
  - `PRELOAD_THRESHOLD = 5`
  - `_messages: MutableStateFlow`
  - `_messagesFlow: MutableStateFlow/SharedFlow`
- `initMessagesData` 通过 `IMessageRepository.loadMessages` 直接调用：
  - `getAdvancedHistoryMessageList`
- 拿到 `MessagePage` 后直接写 `_messages` StateFlow。
- `MessageListController` 使用 RecyclerView 绑定消息列表。

结论：聊天室拿到第一页历史就渲染，不在首屏等待群 retention/purge/权限接口全部返回。

### 1.3 数据模型

APK 的模型明显更轻：

- `MessageSessionEntity` 只保留：
  - `latestMsgPreview`
  - `latestMsgContentType`
  - `latestMsgSendTime`
  - `latestMsgSeq`
  - 以及会话标题、头像、未读、置顶、草稿等 UI 字段
- `ChatMessageEntity` 使用结构化 elem：
  - Text/Picture/Sound/Video/File/Card/Quote/Face 等
- `IMMessageRepository` 还维护 `messageCache: ConcurrentHashMap` 和 `_newMessages`。

结论：会话列表不保存完整消息 JSON；消息展示信息在入库/映射阶段整理一次，UI 不再反复解析。

### 1.4 业务预检差异

在三个 DEX 中检索：

- `minVisibleSeq`
- `group-retention`
- `message-purges`
- 同类群历史保留预检字符串

未检出对应实现。该结论的边界是：

- 只覆盖静态 DEX 检索；
- 不能证明动态下发/插件化逻辑完全不存在；
- 但可以确认 APK 的聊天首屏没有当前项目这种 retention 硬门禁。

---

## 2. 当前 `IM-APP-android` 的现状

### 2.1 已经做得不错，不要重复改

- Compose `LazyColumn + reverseLayout + stable key`：列表已虚拟化。
- OpenIM Android SDK 本地 SQLite：历史消息有本地数据源。
- Coil 内存/磁盘缓存、尺寸下采样、并发限流：媒体层不是首屏主因。
- `ChatModels.mergeMessages` 已有尾部追加/状态更新快路径。
- `mergeConversations` 已有 `needsSort` 增量排序。
- `ChatState` 已有 revision 轻量发布；`markRoomRead` 已有 300ms 节流。
- `ConversationMappingQueue` 已让会话映射在后台串行/可取消执行。
- `Refresh/ChatState` 主线程发布已合并为最新快照。

### 2.2 仍然存在的首屏问题

#### 问题 A：群聊首开等 retention

`ChatController.open` 先触发 `refreshRetention`；`loadHistory` 中：

```kotlin
if(!boundaryReady(active.target)) {
    refreshRetention(listOf(active))
    return
}
```

这意味着群聊第一次打开时，如果本地没有 retention 水位，消息区必须等 `/im/group-retention/states`。

#### 问题 B：首次登录空会话恢复有固定延迟

`scheduleConversationRecovery` 在同步期间按约 1s/2s/5s 重试；本地库为空时，列表在首轮为空后会等下一轮。

#### 问题 C：`open` 同时触发多个业务 REST

打开房间会触发：

- `refreshRetention`
- `refreshGroupPurges`
- `refreshSendPermission`（群聊还会再请求 `/groups/{id}`）
- `refreshContactPresence`（私聊）

它们不一定都阻塞消息，但会和首屏抢网络/CPU，并增加状态发布次数。

#### 问题 D：消息列表没有窗口上限

`ChatState.messages` 会持续累积当前会话已加载历史；`LazyColumn` 只虚拟化 UI，不限制 JS/对象内存。

#### 问题 E：会话最新消息仍偏重

`ChatConversation.latestMessage` 仍是完整 `ChatMessage`，包含 `serialized` JSON；500 个会话的全量映射和比较成本比 APK 的轻量 `MessageSessionEntity` 高。

#### 问题 F：状态模型集中

`ChatState` 同时承载消息、会话、群成员、权限、上传、转发等字段。即使有 revision/局部 dirty，某些状态变化仍需要生成较大的新快照。

---

## 3. 目标架构

### 3.1 数据层

继续使用 OpenIM 本地 SQLite 作为消息真相源，但新增/调整为“UI 轻量模型”：

```text
OpenIM ConversationInfo
  -> ConversationSummary
       conversationId
       type/title/avatar
       preview
       latestMessageAt
       latestSeq
       unread/pinned/muted
       latestMessageStatus

OpenIM Message
  -> RoomMessage
       id/type/sender/time/status/seq
       preview/content（按类型）
       rawSerialized?（仅引用/转发/详情需要时保留）
```

原则：

- 会话列表不挂完整消息对象；
- 消息展示信息在映射时整理，不在 Composable 每帧重复解析；
- `serialized` 只作为按需取用的原始快照，不作为所有会话/所有消息的常驻字段；
- 引用/转发需要时按 `id` 从当前房间或本地 SDK 查询。

### 3.2 状态层

建议拆成四块，至少先做到逻辑分离：

```text
SessionState       连接、登录、同步、错误
ConversationState  会话列表、加载/结束、未读
RoomMessagesState  当前会话消息、分页、historyEnd
RoomMetaState      群信息、成员、权限、公告、置顶
```

如果暂时不拆类，至少保留以下 dirty 标记：

- `messagesDirty`
- `conversationsDirty`
- `roomMetaDirty`
- `sideListsDirty`（outbox/media/forward）

每次 `emit` 只重算 dirty 区域；不相关内容直接复用旧引用。

### 3.3 UI 层

- 继续使用 `LazyColumn`，保留 stable key；
- 为消息行补 `contentType`，帮助 Compose 复用；
- 行组件只接收当前行需要的字段，不把整个 `ChatState` 传进每个条目；
- 会话列表使用轻量项模型；过滤/未读汇总用 `remember`；
- 首屏显示骨架/空态，不显示空白页等待网络。

---

## 4. 优化方案

### P0：缩短首屏关键路径

#### P0-1 会话列表先出内容，不等完整快照

目标：登录后尽快显示已有会话/骨架，不等全部映射完成。

改动：

- `OnConversationChanged` / `OnNewConversation` 事件直接合并进列表，不再只在初始快照完成后才应用；
- 首次列表为空时立即显示骨架/空态，而不是等 1s/2s/5s 恢复轮询；
- `refreshFromSdk` 映射改成轻量 `ConversationSummary`；
- 会话映射按批/可取消，避免一次性阻塞 UI 状态发布；
- `ConversationMappingQueue` 继续使用，但不要把所有会话的完整 JSON 带进 UI。

当前参考：

- `ChatController.kt:325` 的 `loadConversations`
- `ChatController.kt:163` 的 `scheduleConversationRecovery`
- `OpenIMGateway.kt:162` 的 `initialConversations`

#### P0-2 打开房间先显示壳和本地内容

目标：点击会话后先出现房间标题、输入框、本地消息/骨架，不空白等待业务接口。

改动顺序建议：

1. `open` 立即 publish `active`、房间骨架；
2. 立即加载 outbox/本地消息（有就显示）；
3. `loadHistory` 启动第一页本地/高级历史；
4. `refreshRetention`、`refreshGroupPurges`、`refreshSendPermission` 并行后台执行；
5. retention 返回后只做增量过滤，不重新等待整页；
6. 权限/公告/成员信息只更新对应 meta，不阻塞消息列表。

关键原则：

- 如果合规要求“群消息必须先经过 retention”，保留这个硬门禁，但只让**消息区**显示骨架；房间壳、标题、输入框先显示。
- 不要同时让 retention、purge、权限三个接口串行阻塞消息。

#### P0-3 修正空页/同步完成后的重试

目标：首次登录同步完成后，房间不会因为早先空页把 `historyEnd` 置 true 而永久空白。

改动：

- `OnSyncServerFinish` / `syncProgress` 时，如果当前房间 `messages` 为空或 `historyEnd` 为“空页结束”，重置 `historyEnd`；
- 当前房间重新执行第一页历史加载；
- 区分“SDK 真正 isEnd”和“本地暂时无数据导致的空页”。

#### P0-4 离线/实时消息批处理

目标：一批离线消息只触发一次 Controller 合并/发布。

改动：

- `onRecvOfflineNewMessage` 一次映射列表、一次 `events.messages(items)`；
- `onRecvNewMessage` 增加 16–32ms 合并窗口；
- 一批消息只做一次 `acceptEvidence`、一次 `mergeMessages`、一次 `refreshGroupPurges`、一次 `markRoomRead`、一次提示音。

当前参考：

- `OpenIMGateway.kt:96` 仍是 `messages.forEach { incoming(...) }`

#### P0-5 `emit` 增加消息/会话 dirty 分区

目标：群成员、在线状态、房间权限、横幅等变化不触发消息全量合并。

改动：

```text
emit(next, messagesDirty = next.messages !== snapshot.messages,
          conversationsDirty = next.conversations !== snapshot.conversations,
          roomMetaDirty = ...)
```

- 没有 dirty 的消息列表直接复用 `snapshot.messages`；
- 只有会话 dirty 时执行会话 sanitize；
- 只有 debug 时执行 `ConversationDiagnostics.changed`；
- 同步/加载/错误状态更新不再触发消息 bundle 重建。

#### P0-6 有界集合和已读收敛

- `markRoomRead` 保留 300ms 节流；
- `readMessageIds` 只在最近 2000 条内保留；
- `tombstones` 增加按会话/按数量清理；
- 不把完整 `serialized` 作为每个 `ChatConversation.latestMessage` 的常驻字段。

### P1：消息/UI 长期性能

#### P1-1 对齐 APK 的 20 条/页、预加载 5 条

当前是 40 条/页。20 条第一页更轻，滚动时更容易在边缘前预取。

建议：

- `CHAT_HISTORY_PAGE_SIZE = 20`
- 距边缘 5 条触发预取；
- 与本地/高级历史接口保持一致。

#### P1-2 当前会话消息窗口/Paging

目标：`ChatState.messages` 不再无限增长。

建议：

- 先做 1000–2000 条窗口；
- 上翻到窗口边缘时从本地 SQLite 重新补页；
- 保留当前可视锚点，避免窗口裁剪导致视口跳动；
- 后续可评估 Paging3 + 本地 DataSource。

#### P1-3 Compose 行级优化

- 给 `ChatMessage` 增加 `contentType`，`LazyColumn` 使用 contentType；
- 提取稳定参数的 `MessageRow`，避免每行捕获整个 `ChatState`；
- `uploadsById` / `outboxById` 已做，继续保留；
- 群成员 effect 只依赖 active target，消息列表用 `rememberUpdatedState`；
- `UniParityUI` 的会话过滤、总未读使用 `remember`。

#### P1-4 轻量会话模型

- `ChatConversation.latestMessage` 替换为：
  - `latestMessageId`
  - `latestMessagePreview`
  - `latestMessageType`
  - `latestMessageAt`
  - `latestMessageSeq`
  - `latestMessageStatus`
- 完整 `MessageItem` 只在引用/转发/详情时按 id 取。

### P2：首登/离线体验和监控

#### P2-1 首次登录的合理预期

新账号/新设备没有本地库，必须等 OpenIM 首次同步；APK 也一样。不要把“首次登录无本地数据”当成前端代码 bug。

优化目标应是：

- 首屏骨架和进度尽快出现；
- 会话事件流式进入；
- 第一页消息到达后立即渲染；
- 不在消息前串行业务接口。

#### P2-2 App 断网/冷启动

如果 App 冷启动断网仍需要读本地历史，可以继续完善：

- 缓存 `{userId, imToken, apiAddr, wsAddr, expireAt}`；
- `fetchIMToken` 失败时，使用未过期缓存完成本地 SDK 登录；
- UI 显示“离线，展示本地记录”；
- 联网后自动重连并补同步。

#### P2-3 监控

增加以下 perf mark：

- `chat:business-login`
- `chat:im-token`
- `chat:init-sdk`
- `chat:sdk-login`
- `chat:first-conversation`
- `chat:open-room-shell`
- `chat:group-retention`
- `chat:first-history-page`
- `chat:first-message-frame`
- `chat:emit`
- `chat:merge-messages`
- `chat:mark-read`

重点关注：

- 首屏各阶段耗时；
- 500 会话映射耗时；
- 100 条突发消息的 emit 次数；
- 2000 条长会话滚动 FPS/长帧；
- 内存中 `messages`、`readMessageIds`、`tombstones` 数量。

---

## 5. 验收场景

### 5.1 首次登录/新设备

- 登录后先出现会话骨架/空态，不等业务 retention；
- `OnConversationChanged` 到达即显示会话；
- 打开聊天室先出现房间壳，消息区显示骨架；
- 第一页历史到达后立即渲染；
- 同步完成后空页可自动重试。

### 5.2 已有本地数据

- 进房首屏优先显示本地消息；
- 后台同步不阻塞滚动；
- 不出现整页闪烁或空白。

### 5.3 群聊

- 有 retention 缓存：先用缓存过滤并显示；
- 无 retention 缓存：骨架/加载态，不串行等 purge/权限；
- retention 返回后增量过滤，不重载整页；
- 不展示超出 retention 边界的历史。

### 5.4 长会话

- 2000 条消息滚动无明显掉帧；
- 单条新消息不触发全量排序；
- 上翻 20 条 < 500ms（以实际基线为准）；
- 内存中消息数量有上限。

### 5.5 突发消息

- 100 条离线/实时消息只触发少量 `emit`；
- 一次 `markRoomRead`；
- 消息顺序、去重、状态正确。

---

## 6. 落地顺序

### 第一阶段：关键路径（先做）

1. 修 `ChatController.open` 的 retention 阻塞顺序；
2. 修同步完成后的空页重试；
3. 会话列表事件即时合并 + 空态/骨架；
4. `OpenIMGateway` 离线/实时消息批处理；
5. `emit` dirty 分区 + 有界已读/墓碑集合。

### 第二阶段：模型和 UI

1. `ConversationSummary` / 轻量 `latestMessage`；
2. 20 条/页 + 预加载 5；
3. Compose `MessageRow`、contentType、行参数；
4. `UniParityUI` remember；
5. 消息窗口/Paging3。

### 第三阶段：首登兜底和监控

1. App 离线 token/InitSDK；
2. 首屏骨架/进度；
3. 性能埋点和 Macrobenchmark；
4. 按 500 会话、2000 消息、100 突发、5000 人群验收。

---

## 7. 不要做的改动

- 不要为了首屏快直接删除 retention/purge 检查；这会破坏合规和可见性规则。正确做法是并行、缓存、骨架、后置过滤。
- 不要把 `LazyColumn` 换成 RecyclerView；当前已经是虚拟列表。
- 不要更换 Coil；媒体层已足够。
- 不要修改 Go 消息接口；消息历史仍由 OpenIM SDK/本地库负责。
- 不要把所有会话的完整 OpenIM `serialized` JSON 常驻到会话列表。

---

## 8. 代码位置索引

| 主题 | 位置 |
|---|---|
| 会话/消息状态 | `IM-APP-android/app/src/main/java/com/im/nativebootstrap/chat/ChatController.kt:12` |
| `emit` 热路径 | `IM-APP-android/app/src/main/java/com/im/nativebootstrap/chat/ChatController.kt:182` |
| 会话加载 | `IM-APP-android/app/src/main/java/com/im/nativebootstrap/chat/ChatController.kt:325` |
| 房间打开 | `IM-APP-android/app/src/main/java/com/im/nativebootstrap/chat/ChatController.kt:367` |
| 历史加载/retention 门禁 | `IM-APP-android/app/src/main/java/com/im/nativebootstrap/chat/ChatController.kt:436` |
| 发送权限 | `IM-APP-android/app/src/main/java/com/im/nativebootstrap/chat/ChatController.kt:820` |
| 已读节流 | `IM-APP-android/app/src/main/java/com/im/nativebootstrap/chat/ChatController.kt:1460` |
| 群 retention | `IM-APP-android/app/src/main/java/com/im/nativebootstrap/chat/ChatController.kt:1479` |
| 离线消息回调 | `IM-APP-android/app/src/main/java/com/im/nativebootstrap/chat/OpenIMGateway.kt:96` |
| 会话初始映射 | `IM-APP-android/app/src/main/java/com/im/nativebootstrap/chat/OpenIMGateway.kt:162` |
| 高级历史 | `IM-APP-android/app/src/main/java/com/im/nativebootstrap/chat/OpenIMGateway.kt:191` |
| 轻量会话/消息模型 | `IM-APP-android/app/src/main/java/com/im/nativebootstrap/chat/ChatModels.kt:18` |
| 消息合并 | `IM-APP-android/app/src/main/java/com/im/nativebootstrap/chat/ChatModels.kt:120` |
| Compose 房间 | `IM-APP-android/app/src/main/java/com/im/nativebootstrap/NativeChatUI.kt:440` |
| Compose 会话列表 | `IM-APP-android/app/src/main/java/com/im/nativebootstrap/UniParityUI.kt:387` |
| 启动/IM token | `IM-APP-android/app/src/main/java/com/im/nativebootstrap/BootstrapViewModel.kt:183` |

---

## 9. 最终判断

APK 的“快”是**客户端首屏工程优化**，不是后端魔法。当前项目要接近它，应该先做三件事：

1. **不要阻塞首屏**：会话列表、房间壳、消息区分别尽早出现；
2. **不要把业务检查串到消息之前**：retention/purge/权限并行、缓存、后置过滤；
3. **不要把所有消息/会话都做成重对象**：轻量模型、有界窗口、增量状态和 Diff/Key 更新。

完成这三步后，即使继续使用现有 OpenIM/Go 后端，首登和长会话体感也会有明显改善；首次真正无本地数据时仍会受 OpenIM 首次同步限制，这是所有本地优先方案的共同下限。

---

## 10. 本次执行状态

已落地：

- `ChatController.emit` 增加 messages dirty 分区；消息未变化时复用旧列表；
- `conversationDiagnostics` 只在会话 dirty 时重算；
- 首次同步完成后，当前空房间允许重置 history 并重拉；
- 群聊 retention 等待期间显示 `historySyncing` 加载态；
- `open` 先启动历史加载，群 purge/权限检查并行后置；
- `OpenIMGateway` 离线消息一次批量发布、实时消息 24ms 合并窗口；
- 历史页改为 20 条/页，滚动预加载阈值改为 5；
- 已读回执集合限制为最近 2000 条；
- 保留 `mergeMessages`/`mergeConversations` 快路径和现有 Compose 列表优化；
- `ChatMessage` 在 SDK 映射阶段补齐 `contentType`、`senderId`、`pinSync`，群成员清理、置顶同步过滤和 Compose `contentType` 不再重复解析完整 JSON；
- `ChatConversation.latestMessage` 保留轻量确认字段，但不再常驻完整 `serialized` JSON；
- 撤回/删除墓碑集合增加 4096 条上限，长会话不再无限增长；
- 首登会话列表为空且正在同步/读取时显示轻量骨架行，避免空白等待；
- 首次登录改为“业务认证成功即进入聊天骨架”，`/me` 资料校验与 `/im/token` 移出关键路径并行执行；
- 实测当前网络到业务 API 的单次往返约 1.5–2 秒，本次改动取消了“/me → /im/token”的串行等待，首屏进入约提前一个 RTT；
- 对齐 YanChat 的首登策略：OpenIM 同步期间到达的会话事件立即合并上屏，不再等初次本地快照；同步进度中额外发布前 50 条本地会话快照，同步完成后再用完整快照校准；
- 新增 OpenIM 官方 `conversation/get_all_conversations` 快照请求：IM Token 返回后直接拉服务端会话列表，不等本地首次同步完成；
- 同时调用 `get_sorted_conversation_list` 补齐前 100 条的标题、头像、预览、时间和未读；服务端列表为主，SDK 同步结果后续覆盖；
- 服务端文本消息的 `content` 是 JSON 字符串，预览阶段已解析为正常文本，不再先显示 `{"content":...}` 再等 SDK 替换；
- 真机头像慢/缺失：头像并发从 1 提升到 3；旧 MinIO 明文地址 `http://<ip>/minio/im-uploads/...` 统一转为当前 HTTPS 业务源，避免被 Android 明文网络策略拦截；
- 修复 SDK 首次空快照覆盖服务端/临时会话列表的问题，服务端快照会在本地同步完成前持续保留；
- 模拟器全新安装实测：服务端排序快照约 1.14 秒返回 100 条带标题/预览的会话，完整 759 条约 1.48 秒；旧版本首个会话约 7.33 秒；
- 已通过 `:app:testDebugUnitTest`，并重新构建 Debug APK。

仍建议后续处理：

- 当前会话消息窗口/Paging3：需要把 LazyColumn 可视锚点回传给 Controller，或引入本地 `PagingSource`，不能只做简单裁剪，否则会造成上翻历史丢失/视口跳动；
- Compose `MessageRow` 进一步拆成稳定参数组件，避免行内继续捕获整个 `ChatState`；
- `ChatState` 长期拆分为会话、消息、房间元信息三条状态流；
- 首次登录会话骨架、断网冷启动本地 token 登录；
- 真机 Macrobenchmark、JankStats 和 500 会话/2000 消息压测。
