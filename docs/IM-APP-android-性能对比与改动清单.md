# IM-APP-android 性能对比与优化改动清单

> 日期：2026-11-16  
> 审阅对象：`IM-APP-android`（Kotlin + Compose 原生 Android 工程）  
> 对比对象：`docs/YanChat-APK与当前项目性能对比分析.md` 中的 YanChat 3.2.0 APK  
> 方法：源码走读 + 静态复杂度分析；未运行 APK，未做 Macrobenchmark，收益为结构性判断，最终以真机验收为准。

---

## 0. 先明确边界

本文只讨论 `IM-APP-android`，不讨论 `IM-APP-fronend`，也不改 uni-app 的 H5/WebView 方案。

| 产物 | 代码 | 本文是否涉及 |
|---|---|---|
| H5 网页 | `IM-APP-fronend` | 否 |
| uni-app App（WebView） | `IM-APP-fronend` | 否 |
| 原生 Android App | `IM-APP-android` | **是** |
| 原生 iOS App | `IM-APP-ios` | 否 |
| Go 业务后端 | `IM-APP-server` | 基本否，消息链路不在 Go |

`IM-APP-android` 是独立的 Kotlin + Compose 工程，核心聊天直接使用 OpenIM Android SDK。它已经具备 YanChat 的三项关键能力：

1. Compose `LazyColumn` 虚拟列表；
2. OpenIM SDK 本地 SQLite 历史；
3. Coil 内存/磁盘图片缓存。

因此**不能把 uni-app 的 `rawMessages`、`messagesMap`、48 个 `ChatBubble` 虚拟列表方案直接套过来**。原生 App 当前的主要瓶颈不在列表虚拟化，而在 `ChatController` 的状态发布和消息合并。

### 本次已落地的第一版

本轮已完成以下低风险、高收益改动：

- `ChatController.emit` 增加 messages/conversations dirty 分区，未变化时复用旧列表；
- 为 `ChatState` 增加 revision，避免主线程对 2K 消息 + 500 会话做深度 equals；
- 离线消息在 `OpenIMGateway` 中一次批量映射、一次发布；
- 实时消息在 `OpenIMGateway` 中增加 24ms 合并窗口，同一批 SDK 回调只触发一次 UI 发布；
- `mergeMessages` / `mergeConversations` 增加尾部追加和同位置更新快路径；
- `markRoomRead` 增加 300ms 收敛，避免每条消息单独调 SDK；
- `OpenIMGateway.conversation` 的 `latestMsg` 只解析一次，`map` 只序列化一次；
- Compose 群成员 effect 不再以整段消息列表为 key，新消息滚动改为 `scrollToItem`，行内 uploads/outbox 改为按 id map 查询；
- 会话列表过滤和总未读使用 `remember` 缓存；
- retention 成功后不再全量 `loadConversations(true)`，直接基于当前会话列表应用新水位；
- 已读回执集合限制为最近 2000 条，避免长会话无限增长；
- `ChatMessage` 增加 `contentType`、`senderId`、`pinSync` 轻量字段，群成员清理、置顶同步过滤和 Compose 列表 contentType 不再重复解析完整 JSON；
- `ChatConversation.latestMessage` 不再常驻完整 `serialized` JSON，只保留预览、状态、seq、发送者等确认字段；
- 撤回/删除墓碑集合限制为 4096 条，避免长会话无限增长；
- 首登会话列表为空且正在同步/读取时显示轻量骨架行，减少空白等待感；
- 首次登录只阻塞业务认证；进入聊天骨架后，资料校验与 IM Token 并行执行，不再等待 `/me → /im/token` 串行链；
- OpenIM 同步期间不再暂存会话事件；事件到达即显示，并按同步进度发布前 50 条本地快照，最终完整快照再校准；
- IM Token 返回后直接调用 OpenIM 官方 `get_all_conversations` 拉服务端会话快照；SDK 首次空快照不再覆盖该列表；
- 首屏额外调用 `get_sorted_conversation_list` 补齐前 100 条标题、头像、预览、时间和未读，避免先把所有会话显示成“聊天”；
- 补充了消息合并和已读收敛单测。

仍待后续处理：消息窗口/Paging3、Compose `MessageRow` 的稳定参数拆分、`ChatState` 拆流，以及真机 Macrobenchmark。

---

## 1. 结论摘要

### 1.1 已经做对、不需要重复改的部分

- 消息列表已经是 `LazyColumn + reverseLayout + key`，见 `NativeChatUI.kt:500`、`:501`。
- 历史消息优先读本地 SQLite，本地不可用时再走高级历史，见 `OpenIMGateway.kt:144`、`:155` 和 `ChatController.kt:386`。
- 图片使用 Coil，内存缓存 24 MB、磁盘缓存 384 MB、图片/头像/缓存解码分别限流，见 `MediaLoader.kt:35`、`:36`、`:58`。
- 群成员按可见消息发送者查询，最多 100 个，不拉全量，见 `ChatController.kt:815`。
- 已实现持久 Outbox、媒体上传队列、群保留水位、成员清理边界、离线会话恢复。
- 上翻历史已经有 `HistoryLoadGate`，可避免一次滑动扫完整库，见 `HistoryLoadGate.kt:12`。

### 1.2 当前真正的性能矛盾

`ChatController.emit` 是整个原生 App 的状态发布中心，但它在**每一次状态变化**时都做全量工作：

- 重新合并、排序当前会话全部消息；
- 重新过滤全部可见消息；
- 重新 sanitize 全部会话；
- 执行会话诊断比较；
- 生成新的 `ChatState`；
- 主线程 `StateFlow` 做深度 equals。

`ChatController.kt` 中约有 **131 处 `emit` 调用**。其中大量只是更新加载状态、群成员、在线状态、已读状态或横幅显示，却仍会触发当前会话全部消息的重排。

所以当前的现象会是：

- 刚进房时，因为本地 SQLite，首屏通常不慢；
- 消息一多、群成员一更新、已读回执一到，单次状态发布成本持续上升；
- 离线同步或群消息突发时，每条消息都触发一次全量合并，表现为“越用越卡”。

### 1.3 预期收益

按本文 P0 改完后，方向上的变化是：

- 100 条离线/突发消息：从 100 次全量合并、排序、发布，降到 1 次批量合并；
- 2000 条长会话：单条新消息不再每次 O(n log n) 全量排序；
- 500 个会话：群成员/已读/在线状态变化不再触发全部会话 sanitize 和深度比较；
- 长会话内存：通过窗口上限避免无限增长；
- 首屏：本来就走本地 SQLite，提升有限，主要改善收消息和滚动阶段。

---

## 2. 与 YanChat 的对比

| 维度 | YanChat 3.2.0 APK | IM-APP-android | 判断 |
|---|---|---|---|
| UI 框架 | RecyclerView + ListAdapter/DiffUtil | Compose LazyColumn + stable key | 基本等价，不需要换 |
| 列表虚拟化 | 只绑定屏幕内 ViewHolder | 只组合可见 item | 已对齐 |
| 消息存储 | OpenIM 本地 SQLite | OpenIM Android SDK 本地 SQLite | 已对齐 |
| 历史分页 | 20 条/页，本地查询 | 本地 40 条/页 + 远程 40 条/页 | 可接受，不是主瓶颈 |
| 单条消息更新 | 当前会话追加 + DiffUtil | 全量 `mergeMessages` + 排序 | **主要差距** |
| 会话列表更新 | 变化行更新 | 每次 emit 全量 sanitize/诊断 | **主要差距** |
| 图片 | Glide 内存/磁盘缓存、采样 | Coil 内存/磁盘缓存、下采样、限流 | 已够用 |
| 群成员 | 按需查询 | 可见发送者查询，最多 100 | 已对齐，甚至更克制 |
| 大群进入 | 不阻塞消息列表 | 可见成员异步加载 | 已对齐 |
| 已读 | 会话级已读 | 每条消息都调一次 SDK markRead | **需要收敛** |
| 状态发布 | ViewModel/StateFlow + DiffUtil | 单次 emit 全量重算 + StateFlow 深度 equals | **主要差距** |

结论：**原生 App 的结构已经接近 APK，真正要补的是状态管线和批量更新，不是再写一个虚拟列表。**

---

## 3. 关键瓶颈与代码证据

### 3.1 `emit` 每次都全量重建消息和会话

`ChatController.kt:150`：

```kotlin
private fun emit(next: ChatState = snapshot, source: String = "state") {
    val previousConversations = snapshot.conversations
    val core = coordinator.snapshot()
    val id = next.active?.target?.conversationId.orEmpty()
    val uploads = mediaUploads?.all().orEmpty()
    val localMessages = uploads.filter { it.target.conversationId == id }.map { it.placeholder() }
    snapshot = next.copy(
        pendingForwards = pendingForwards?.all().orEmpty(),
        mediaUploads = uploads,
        localSentMedia = sentVideos?.all().orEmpty(),
        mediaOwnerDirectory = mediaUploads?.ownerDirectory().orEmpty(),
        messages = mergeMessages(
            next.messages.filterNot { it.id.startsWith("upload-") },
            localMessages,
        ),
        store = core.store,
        sync = core.sync,
        outbox = outbox?.all().orEmpty(),
        showPinnedBanner = ...,
        showAnnouncementBanner = ...,
        conversations = next.conversations.map {
            if (!boundaryReady(it.target)) it.copy(preview = "", unread = 0)
            else purges?.conversation(retention?.conversation(it) ?: it)
                ?: retention?.conversation(it)
                ?: it
        },
    )
    conversationDiagnostics.changed(source, previousConversations, snapshot.conversations)
    snapshot = snapshot.copy(conversationDiagnostics = conversationDiagnostics.report())
    changed(snapshot)
}
```

问题点：

- `mergeMessages` 对全部消息做 map + sort；
- `conversations.map` 对全部会话做边界判断、保留策略、成员清理；
- `conversationDiagnostics.changed` 对全部会话做深度比较和诊断聚合；
- 即使只是 `groupMembers`、`peerOnline`、`readMessageIds` 或 `sendBlockedReason` 变化，也会执行上述全部工作。

典型例子：

- `ChatController.kt:207`：已读回执只更新 `readMessageIds`，仍触发全量消息合并；
- `ChatController.kt:815`：群成员只更新 `groupMembers`，仍触发全量消息合并；
- `ChatController.kt:373`：在线状态只更新 `peerOnline`，仍触发全量消息合并；
- `ChatController.kt:212`：群成员变化只清空成员表，仍触发全量消息合并。

### 3.2 `ChatState` / `BootstrapState` 在主线程做深度 equals

`BootstrapViewModel.kt:49`：

```kotlin
private val mutableState = MutableStateFlow(BootstrapState())
```

`BootstrapViewModel.kt:60`：

```kotlin
{ chat ->
    main.post {
        if (chat.sessionTag == operation && mutableState.value.authenticated) {
            mutableState.value = mutableState.value.copy(
                chat = chat,
                chatOpen = chat.active != null,
            )
        }
    }
}
```

`BootstrapState` 包含 `ChatState`，`ChatState` 包含：

- `messages: List<ChatMessage>`，当前会话全部已加载消息；
- `conversations: List<ChatConversation>`，全部会话；
- 每个会话的 `latestMessage`，其中还有完整 `serialized` JSON；
- `outbox`、`mediaUploads`、`readMessageIds`、`groupMembers` 等。

Kotlin `StateFlow` 用 `equals` 判断新旧值是否相同。也就是说，每次发布都会在主线程比较：

- 2000 条消息的字段；
- 500 个会话的字段；
- 每条会话最新消息的 JSON 字符串；
- 其他集合。

即使最终因为“相等”而没有继续通知 Compose，**比较本身已经发生**。这是原生 App 和 uni-app 的 `deep ref` 类似的一层成本，只是位置从 JS store 换到了 Kotlin StateFlow。

### 3.3 离线消息和实时消息逐条处理

`OpenIMGateway.kt:64`、`:65`：

```kotlin
override fun onRecvNewMessage(message: Message?) {
    message?.let { incoming(it, events, true) }
}

override fun onRecvOfflineNewMessage(messages: MutableList<Message>?) {
    messages.orEmpty().forEach { incoming(it, events) }
}
```

`OpenIMGateway.kt:76` 的 `incoming` 每次只发一条：

```kotlin
val items = listOf(target to map(message))
if (realtime) events.liveMessages(items) else events.messages(items)
```

`ChatController.kt:215` 的 `messages` 每次收到列表后立即合并、发布：

```kotlin
override fun messages(items: List<Pair<ChatTarget, ChatMessage>>) {
    dispatch {
        if (!current(t)) return@dispatch
        items.forEach { (_, msg) -> if (msg.mine && (msg.seq > 0 || msg.status == 2)) acceptEvidence(msg) }
        val active = snapshot.active?.target
        emit(snapshot.copy(messages = mergeMessages(snapshot.messages, visible(...))))
        items.map { it.first }.distinct().filter { it.sessionType == 3 }.forEach { refreshGroupPurges(it) }
        if (items.any { it.first.conversationId == active?.conversationId && !it.second.mine }) markRoomRead()
    }
}
```

100 条离线消息 = 100 次 `emit`、100 次 `mergeMessages`、100 次 `markRoomRead`、最多 100 次群清理刷新判断。

### 3.4 `mergeMessages` 每次全量 map + sort

`ChatModels.kt:108`：

```kotlin
fun mergeMessages(old: List<ChatMessage>, incoming: List<ChatMessage>): List<ChatMessage> {
    val result = old.associateBy { it.id }.toMutableMap()
    incoming.filter { it.id.isNotBlank() }.forEach { next ->
        val previous = result[next.id]
        result[next.id] = if (previous != null && (previous.seq > next.seq || (previous.status == 2 && next.status != 2))) previous else next
    }
    return result.values.sortedWith(compareBy<ChatMessage> { it.time }.thenBy { it.id })
}
```

每次调用都会：

- 为全部旧消息建立 map；
- 为全部消息做一次排序；
- 分配新的 map 和 list。

当前会话没有消息条数上限，2000 条就是 2000 次 map 写入 + 2000 log 2000 次比较；如果 100 条消息逐条到达，就是 100 次全量排序。

`ChatModels.kt:99` 的 `mergeConversations` 同样每次都 `associateByTo` + `sortedWith`，500 个会话时也会反复全量排序。

### 3.5 `visible` 每次扫描全部消息

`ChatController.kt:144`：

```kotlin
private fun visible(messages: List<ChatMessage>) =
    messages
        .filterNot { tombstones[it.id] == true || MessageContents.isPinSync(it.serialized) }
        .filter { message -> snapshot.active?.target?.let { target ->
            (message.seq <= 0 || boundaryReady(target)) && permits(target, message)
        } != false }
        .map {
            if (tombstones.containsKey(it.id)) it.copy(text = "[消息已撤回]", serialized = "", status = 2)
            else it
        }
```

`visible` 本来只需要处理新到的消息，但当前很多调用传的是 `snapshot.messages` 全量列表。只要保留策略、成员清理或撤回状态变化，就会整表扫描一次。

### 3.6 `OpenIMGateway` 重复 JSON 解析

`OpenIMGateway.kt:104`：

```kotlin
private fun map(message: Message) =
    ChatMessage(
        message.clientMsgID.orEmpty(),
        summary(message),
        message.sendID == userId,
        if (message.sendTime > 0) message.sendTime else message.createTime,
        message.status,
        message.seq.toLong(),
        gson.toJson(message),
        message.senderNickname.orEmpty(),
    )
```

`summary()` 对自定义消息会调用 `MessageContents.parse(gson.toJson(message))`，`map()` 又会 `gson.toJson(message)` 一次。

`OpenIMGateway.kt:105` 的 `conversation()` 对 `latestMsg` 解析了三次：

- 一次算 `preview`；
- 一次算 `latestSeq`；
- 一次算 `latestMessage`。

500 个会话首屏加载时，这就是 1500 次 `latestMsg` JSON 解析。`initialConversations` 还会忽略传入的 `count`，一次性返回完整会话表，见 `OpenIMGateway.kt:116`。

### 3.7 Compose 层的重复触发

`NativeChatUI.kt:443`、`:446`：

```kotlin
val latestId = state.messages.lastOrNull()?.id
LaunchedEffect(latestId) {
    if (list.firstVisibleItemIndex < 3) list.animateScrollToItem(0)
}
```

每条新消息都会触发一次滚动动画。突发消息时，`latestId` 多次变化，动画会反复启动/取消。

`NativeChatUI.kt:463`：

```kotlin
LaunchedEffect(list, state.active?.target, state.messages) {
    if (state.active?.target?.sessionType == 3) snapshotFlow {
        list.layoutInfo.visibleItemsInfo.mapNotNull { item ->
            state.messages.asReversed().getOrNull(item.index)?.let {
                MessageContents.parse(it.serialized, it.text).senderId.takeIf(String::isNotBlank)
            }
        }.distinct()
    }.distinctUntilChanged().collect { ids ->
        if (ids.isNotEmpty()) callbacks.onLoadGroupMembers(ids)
    }
}
```

`state.messages` 作为 key，每来一条消息都会重启这个 effect，并重新解析可见消息的发送者。

另外，`NativeChatUI.kt:501` 的 `itemsIndexed` 没有 `contentType`，每个可见行还读取整个 `state`、`state.mediaUploads.firstOrNull`、`state.outbox.any`、`state.messages.asReversed()`。这些都会放大重组成本。

### 3.8 会话列表的派生计算

`UniParityUI.kt:409`、`:410`：

```kotlin
items(
    state.chat.conversations.filter {
        (!filterUnread || it.unread > 0) &&
        (query.isBlank() || it.title.contains(query, true) || it.preview.contains(query, true))
    },
    key = { it.target.conversationId },
) { item -> ... }
```

每次重组都会 filter 全部会话；底部未读数还会每次 `sumOf`。500 个会话时不是大问题，但会叠加在每条消息的状态发布上。

### 3.9 已读状态和 retention 刷新

- `ChatController.kt:1410` 的 `markRoomRead` 对每条活跃会话消息都调用一次 `gateway.markRead`；群聊 HTTP 有 2 秒节流，但 SDK markRead 没有。
- `ChatController.kt:1435` 的 `refreshRetention` 每批成功后调用 `loadConversations(true)`，群多时会重复全量加载会话。
- `ChatController.kt:207` 的 `readMessageIds` 用 `Set + ids` 无限增长；长会话会不断复制更大的 Set。

---

## 4. 改动清单

### P0：先做，直接改善“越用越卡”

#### P0-1 给 `emit` 增加 dirty 分区

目标：不让“只改组员/在线/已读/加载状态”的更新重排全部消息。

建议：

- 给 `emit` 增加 `messagesDirty`、`conversationsDirty`、`sideDirty`；
- `next.messages === snapshot.messages` 且无待上传占位变化时，直接复用旧 `messages`；
- `next.conversations === snapshot.conversations` 且 retention/purge 未变时，直接复用旧 `conversations`；
- 只有消息变化才执行 `visible` + `mergeMessages`；
- 只有会话或 retention/purge 变化才执行 `conversations.map`；
- `conversationDiagnostics` 只在 debug 且 `conversationsDirty` 时执行。

收益：

- `groupMembers`、`peerOnline`、`readMessageIds`、`sendBlockedReason`、横幅显示等更新不再触碰 2000 条消息；
- 这是当前原生 App 性价比最高的一项。

#### P0-2 批量处理离线/实时消息

目标：100 条消息只做一次状态发布。

建议：

- `OpenIMGateway.onRecvOfflineNewMessage` 一次性映射整个列表，调用一次 `events.messages`；
- `ChatController` 对实时消息增加 16–32ms 的缓冲，合并同一批到达的消息；
- 一次 flush 内完成：去重、`acceptEvidence`、`mergeMessages`、`refreshGroupPurges`（按群去重）、`markRoomRead`（每会话一次）、通知；
- `liveMessages` 的通知逻辑也移到 flush 后，避免“先把消息塞进 UI，再逐条通知”。

收益：

- 100 条离线消息从 100 次 emit/sort/read 降到约 1 次；
- 群消息突发时不再出现明显的连续卡顿。

#### P0-3 增量合并消息

目标：从 O(n log n) 全量排序，降到 O(k) 尾部追加或 O(n+k) 历史页合并。

建议：

- 维护 `id -> index` 或至少 `Set<String>`，O(1) 去重；
- 新消息时间大于等于当前最后一条时，直接追加；
- 上翻历史页时，做两个有序列表的线性合并；
- 已有消息状态更新时，原位替换；只有时间改变才重新插入；
- `mergeConversations` 同样改成按 id 更新 + 必要时插入，不要每次全量排序。

收益：

- 2000 条长会话的单条消息成本大幅下降；
- 100 条突发消息不再做 100 次全量排序。

#### P0-4 收敛 `markRoomRead`

目标：每条消息不再单独调用 SDK 已读。

建议：

- 每个会话维护 `lastMarkedSeq` / `pendingRead`；
- 300–500ms 合并一次，批量消息只在 flush 后调用一次 `gateway.markRead`；
- 群聊的 `/im/group-read-cursors/report` 和 `/im/group-read-state` 继续保留现有 2 秒节流；
- 进入房间、上翻历史页时仍可立即触发一次。

#### P0-5 避免 `ChatState` 深度 equals

目标：主线程不再比较 2000 条消息 + 500 个会话。

建议二选一：

1. 短期：给 `ChatState` 增加 `revision: Long`，每个 emit 自增，并用 revision 实现 `equals/hashCode`；这样 StateFlow 只比较 revision，不深比较列表。
2. 长期：拆成 `ChatSessionState`、`ConversationListState`、`RoomState` 三个 StateFlow，UI 分别 collect；`BootstrapState` 只保留登录/资料/导航等轻量状态。

注意：revision 方案仍会让 Compose 收到新状态，所以必须同时做 P0-1 的 dirty 分区，不能只改 equals。

#### P0-6 会话列表热路径减负

建议：

- 缓存 sanitize 后的会话列表，只在会话事件、retention、purge 变化时重算；
- `ConversationDiagnostics.changed` 改为只比较 `conversationId/time/unread/pinned/latestMessage.id` 等轻量签名；
- release 版本关闭诊断，或只在 debug 页面开启；
- `ChatConversation.latestMessage` 改成轻量元数据，不要把完整 `serialized` JSON 挂在每个会话上。

### P1：长会话和 Compose 细节

#### P1-1 `OpenIMGateway` 减少重复解析

- `conversation()` 只解析一次 `latestMsg`，复用 `Message` 对象算 preview、latestSeq、latestMessage；
- `map()` 只序列化一次 `serialized`，`summary()` 复用同一个序列化结果；
- `ConversationInfo.ex` 只解析一次；
- `initialConversations` 忽略 `count` 的问题要重新评估：如果必须保留完整本地快照，至少使用轻量 `ChatConversation` 模型；否则第一页先返回 30 条，后台再补齐全量。

#### P1-2 Compose effect 和行组合优化

- `LaunchedEffect(list, state.active?.target, state.messages)` 改成只依赖 `target`，用 `rememberUpdatedState`/`snapshotFlow` 读取最新消息；
- 新消息滚动从 `animateScrollToItem(0)` 改为 `scrollToItem(0)`，或按帧合并，避免突发消息反复动画；
- 给 `ChatMessage` 增加 `contentType`、`senderId` 等轻量字段，`LazyColumn` 增加 `contentType`；
- 把 `MessageRow` 提取为接收稳定参数的 composable，避免每个可见行捕获整个 `ChatState`；
- 用 `remember(state.messages) { state.messages.asReversed() }` 复用反转视图；
- 用 `mediaUploadsById`、`outboxById` 替代每行的 `firstOrNull`/`any`；
- 会话列表的 filter 和未读 sum 用 `remember(conversations, query, filterUnread)` 缓存。

#### P1-3 给消息列表设置内存窗口

当前 `ChatState.messages` 无上限，长会话会持续增长。

建议：

- 先设置 1000–2000 条窗口，保留当前可视区域和上翻锚点；
- 上翻到窗口边缘时从本地 SQLite 重新补页；
- 或者引入 Paging3，用本地历史作为 `PagingSource`，远程历史作为补充；
- `readMessageIds` 改成最近 N 条，或直接用 `maxOtherReadSeq` 表示已读范围；
- `tombstones` 也应有上限或按会话清理。

#### P1-4 retention 刷新收敛

- `refreshRetention` 成功后的 `loadConversations(true)` 改成 debounce/合并；
- 只更新受影响的会话行，不要每次都全量重载；
- `refreshGroupPurges` 成功后的 `visible(snapshot.messages)` 只在规则实际变化时执行。

#### P1-5 群成员加载保持现状

`loadVisibleGroupMembers` 的方向是对的：按可见发送者、最多 100、`checkedMembers` 最多 500。  
需要改的只是 `NativeChatUI` 的 effect key，避免每来一条消息就重新触发一次可见成员扫描。

### P2：可观测性与验收

#### P2-1 增加性能埋点

在 debug 版本记录：

- 单次 `emit` 各阶段耗时：message merge、visible、conversation sanitize、diagnostics、publish；
- `mergeMessages` 输入/输出条数；
- `markRoomRead` 调用次数；
- `loadConversations` 耗时和会话数；
- `loadHistory` 本地页/远程页耗时；
- Compose 帧耗时和 Jank 帧。

#### P2-2 增加测试场景

- 500 会话 × 300 条消息持续收消息；
- 2000 条长会话滚动、上翻 40 条；
- 100 条离线消息一次 flush；
- 5000 人大群只加载可见成员；
- 断网重连后的离线同步；
- 群保留水位、成员清理、撤回、置顶同时变化的场景。

#### P2-3 Go 后端

消息主链路不需要改 Go：

- 前端直接使用 OpenIM SDK；
- Go 不保存消息正文，不负责历史查询；
- 当前原生 App 的群成员也是按可见发送者查 `getGroupMembersInfo`，不是全量 REST 拉取。

只有以下情况才需要单独看 Go：

- `/im/group-retention/states` 或成员清理接口实际很慢；
- 群成员详情接口批量查询出现瓶颈；
- 业务登录/刷新 token 阻塞了首屏。

---

## 5. 预期收益

| 改动 | 预期 |
|---|---|
| P0-1 emit dirty 分区 | 群成员/已读/在线状态更新不再重排全部消息；单次状态发布成本从 O(消息数 + 会话数) 降到接近 O(变化量) |
| P0-2 批量消息 | 100 条突发从 100 次 emit/sort/read 降到约 1 次；突发卡顿明显下降 |
| P0-3 增量 merge | 单条消息从 O(n log n) 全量排序降到 O(k) 尾部追加或 O(n+k) 历史页合并 |
| P0-4 已读收敛 | 每条消息不再单独调用 SDK markRead；减少本地库/网络写入 |
| P0-5 revision/拆流 | 主线程不再对 2000 条消息 + 500 会话做深度 equals |
| P0-6 会话热路径 | 500 会话下减少 sanitize、诊断和完整 latestMessage 比较 |
| P1-2 Compose | 可见行重组、滚动动画和群成员 effect 重启减少，长会话滚动更稳 |
| P1-3 消息窗口 | 长会话内存有界，避免越用越大 |
| P1-1 JSON 优化 | 500 会话首屏减少约 2/3 的 latestMsg 解析和重复序列化 |

注意：首屏首次加载仍受本地 SQLite 和 OpenIM SDK 初始化影响；P0/P1 主要改善“收消息、切状态、长会话滚动”，不会把首次拉历史变成零成本。

---

## 6. 验收建议

### 6.1 真机场景

1. **长会话**：2000+ 条消息，进入房间、上翻 40 条、连续收 20 条消息，记录：
   - 首次可见消息时间；
   - 上翻一页耗时；
   - 滚动 30 秒的 Jank 帧；
   - `emit` 次数和单次耗时。
2. **多会话**：500 个会话，持续收消息，记录：
   - `loadConversations` 耗时；
   - 每条消息的 `emit` 耗时；
   - 会话列表重组次数；
   - 内存中 `messages`、`conversations` 数量。
3. **突发消息**：一次注入 100 条离线消息，确认：
   - 只发生一次批量 flush；
   - 消息顺序、去重、状态正确；
   - `markRoomRead` 只调用一次；
   - 没有 100 次主线程状态发布。
4. **大群**：5000 人群进入房间，确认只查询可见发送者，不拉全量成员。
5. **边界状态**：撤回、删除、群保留、成员清理、置顶、已读回执同时变化，确认没有消息复活或状态倒退。

### 6.2 目标值

- 2000 条长会话单条新消息不再触发全量排序；
- 100 条突发只产生一次批量状态发布；
- 500 会话下，群成员/在线状态变化不触发消息 merge；
- 长会话内存不超过约定窗口；
- 滚动阶段无明显长帧。

---

## 7. 明确不要做的事

- 不要把 uni-app 的 `rawMessages` / `messagesMap` / 48 个 `ChatBubble` 方案搬到原生 App。
- 不要把 `LazyColumn` 换成 RecyclerView；Compose 列表已经虚拟化。
- 不要为了性能替换 Coil；当前 Coil + 自定义缓存已经接近 Glide。
- 不要引入 H5 IndexedDB；原生已有 OpenIM SQLite。
- 不要改成进群拉全量群成员；当前按可见发送者查询是正确方向。
- 不要为了消息性能改 Go 业务接口；消息历史不经过 `IM-APP-server`。

---

## 8. 代码位置索引

| 主题 | 位置 |
|---|---|
| `ChatState` 定义 | `IM-APP-android/app/src/main/java/com/im/nativebootstrap/chat/ChatController.kt:12` |
| `visible` 全量过滤 | `IM-APP-android/app/src/main/java/com/im/nativebootstrap/chat/ChatController.kt:144` |
| `emit` 全量发布 | `IM-APP-android/app/src/main/java/com/im/nativebootstrap/chat/ChatController.kt:150` |
| 已读回执 Set 增长 | `IM-APP-android/app/src/main/java/com/im/nativebootstrap/chat/ChatController.kt:207` |
| 实时/离线消息处理 | `IM-APP-android/app/src/main/java/com/im/nativebootstrap/chat/ChatController.kt:215` |
| `markRoomRead` | `IM-APP-android/app/src/main/java/com/im/nativebootstrap/chat/ChatController.kt:1410` |
| 群成员按可见加载 | `IM-APP-android/app/src/main/java/com/im/nativebootstrap/chat/ChatController.kt:815` |
| retention 刷新 | `IM-APP-android/app/src/main/java/com/im/nativebootstrap/chat/ChatController.kt:1435` |
| 成员清理刷新 | `IM-APP-android/app/src/main/java/com/im/nativebootstrap/chat/ChatController.kt:1468` |
| 会话加载 | `IM-APP-android/app/src/main/java/com/im/nativebootstrap/chat/ChatController.kt:278` |
| 历史加载 | `IM-APP-android/app/src/main/java/com/im/nativebootstrap/chat/ChatController.kt:386` |
| `mergeConversations` | `IM-APP-android/app/src/main/java/com/im/nativebootstrap/chat/ChatModels.kt:99` |
| `mergeMessages` | `IM-APP-android/app/src/main/java/com/im/nativebootstrap/chat/ChatModels.kt:108` |
| StateFlow 状态 | `IM-APP-android/app/src/main/java/com/im/nativebootstrap/BootstrapViewModel.kt:49` |
| 主线程发布 | `IM-APP-android/app/src/main/java/com/im/nativebootstrap/BootstrapViewModel.kt:60` |
| 离线消息逐条回调 | `IM-APP-android/app/src/main/java/com/im/nativebootstrap/chat/OpenIMGateway.kt:64` |
| 单条消息映射 | `IM-APP-android/app/src/main/java/com/im/nativebootstrap/chat/OpenIMGateway.kt:76` |
| 重复 JSON 解析 | `IM-APP-android/app/src/main/java/com/im/nativebootstrap/chat/OpenIMGateway.kt:104` |
| 本地/远程历史 | `IM-APP-android/app/src/main/java/com/im/nativebootstrap/chat/OpenIMGateway.kt:144` |
| LazyColumn 消息列表 | `IM-APP-android/app/src/main/java/com/im/nativebootstrap/NativeChatUI.kt:500` |
| 新消息滚动 effect | `IM-APP-android/app/src/main/java/com/im/nativebootstrap/NativeChatUI.kt:446` |
| 群成员可见 effect | `IM-APP-android/app/src/main/java/com/im/nativebootstrap/NativeChatUI.kt:463` |
| 会话列表 filter | `IM-APP-android/app/src/main/java/com/im/nativebootstrap/UniParityUI.kt:409` |
| 会话诊断 | `IM-APP-android/app/src/main/java/com/im/nativebootstrap/chat/ConversationDiagnostics.kt:21` |
| Coil 缓存 | `IM-APP-android/app/src/main/java/com/im/nativebootstrap/media/MediaLoader.kt:35` |
| 历史加载阈值 | `IM-APP-android/app/src/main/java/com/im/nativebootstrap/HistoryLoadGate.kt:12` |

---

## 9. 建议实施顺序

1. **P0-2 + P0-4**：批量消息、已读收敛，先解决突发卡顿。
2. **P0-1**：emit dirty 分区，解决“任何状态变化都重排消息”。
3. **P0-3**：增量 merge，解决长会话单条消息成本。
4. **P0-5 + P0-6**：StateFlow revision/拆流、会话热路径减负。
5. **P1-2 + P1-3**：Compose effect、行参数、消息窗口。
6. **P1-1 + P1-4 + P1-5**：JSON 解析、retention 收敛、会话列表缓存。
7. **P2**：埋点、Macrobenchmark、JankStats、真机验收。

完成 P0 后，原生 App 的体感应接近“APK 的原生列表 + 本地 SQLite”这一层；完成 P1 后，长会话滚动和内存占用才会接近 YanChat 的长期稳定表现。
