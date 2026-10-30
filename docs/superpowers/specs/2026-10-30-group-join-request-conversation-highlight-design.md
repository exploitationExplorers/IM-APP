# 入群申请群会话强提醒设计

## 背景与目标

当前群主/管理员收到入群申请时，后端通过 OpenIM 管理员账号向每个群主/管理员发送 C2C CustomMessage。前端因此生成一个 `imAdmin` 私聊会话，并在会话中展示入群申请卡片。

新的交互要求：

1. 提醒挂在实际群聊会话上，而不是新建 `imAdmin` 会话。
2. 会话列表预览显示红色 `[有新的进群申请]`。
3. 右侧不再显示未读数字，改为无数字红点。
4. 只有当前有效的群主和管理员收到提醒。
5. 进入对应群聊后立即清除红字和红点。
6. 群会话免打扰时，沿用现有 @ 提醒规则，不显示红色强提醒。

不在本次范围：

- 入群申请审批逻辑。
- 入群申请卡片历史消息的删除。
- 跨设备同步待审核申请数量。
- 重新设计群详情页的入群申请入口。

## 现状

后端入群申请通知链路：

```text
group_join_requests
  -> im_sync_outbox(group.join.requested)
  -> IMSyncWorker.syncGroupJoinRequest
  -> GroupService.sendGroupJoinRequestCard
  -> OpenIM C2C CustomMessage(sendID=imAdmin)
```

前端将 CustomMessage 解析为 `groupJoinRequest` 消息，并在 `imAdmin` 会话里展示卡片。

OpenIM 现有 `groupAtType` 只适用于群会话，不能直接给私聊会话设置 `[有人@我]`，也不能表达新的入群申请状态。

## 关键决策

| 决策项 | 选择 | 理由 |
|---|---|---|
| 通知通道 | OpenIM 业务通知 `SendBusinessNotification` | 不会更新普通会话预览/未读，客户端有独立 `OnRecvCustomBusinessMessage` 事件 |
| 提醒位置 | 实际群会话 | 符合用户要求的“像群聊 @ 一样” |
| 右侧标记 | 无数字红点 | 业务通知没有普通未读数，不能伪造消息未读 |
| 清除时机 | 进入群聊即清除 | 与现有群 @ 强提醒一致 |
| 免打扰 | 隐藏红色强提醒 | 与现有 `ConversationItem` 的 @ 规则一致 |
| 历史 imAdmin 会话 | 仅隐藏最后一条为入群申请的会话 | 不删除消息，避免误删其他系统通知 |
| 兼容旧消息 | 保留现有 `groupJoinRequest` 卡片解析 | 历史 imAdmin 消息仍可正常显示 |

## 架构与数据流

```text
CreateJoinRequest
  -> im_sync_outbox(group.join.requested)
  -> IMSyncWorker
  -> PendingJoinRequestNotification
  -> SendBusinessNotification(owner/admin)
  -> OpenIM OnRecvCustomBusinessMessage
  -> chat store 写入 joinRequestPending
  -> 对应群会话显示 [有新的进群申请] + 红点
  -> 进入群聊 markAsRead
  -> 清除 joinRequestPending / 红字 / 红点
```

### 业务通知 payload

后端发送：

```json
{
  "key": "group_join_request",
  "data": {
    "requestId": "uuid",
    "groupId": "qun_xxx",
    "groupConversationId": "sg_xxx",
    "groupName": "测试",
    "applicantId": "uuid",
    "applicantNickname": "用户0520",
    "applicantAvatar": "https://..."
  }
}
```

`data` 在 OpenIM 业务通知中按 JSON 字符串传输，前端统一解析为对象。

### 后端

1. `PendingGroupJoinRequestNotification` 增加 `GroupConversationID`。
2. 该字段不读取 `groups.conversation_id`（这是旧版业务会话 UUID），而是由 `event.AggregateID` 经 `im.UserIDFromBusinessID` 转成 OpenIM 群 ID 后拼接为 `sg_<openimGroupID>`。
3. `sendGroupJoinRequestCard` 重命名为 `sendGroupJoinRequestNotification`，改为发送业务通知：
   - 逐个别发送给有效群主/管理员。
   - 使用 `SendBusinessNotification(..., guaranteed=true)`。
   - 不再调用 `SendCustomC2CMessage`。
4. `IMSyncWorker.syncGroupJoinRequest` 保持事件消费逻辑，只调整发送方法。
5. 如果 `GroupConversationID` 无法生成，返回错误并交给 outbox 重试；不把通知挂到错误的群。

### 前端

1. `GroupJoinRequestPayload` 增加 `groupConversationId`。
2. 新增业务通知解析：
   - 校验 `key === group_join_request`
   - 解析 `data`
   - 校验 `groupConversationId`
3. `chat store` 订阅 `IMEvents.OnRecvCustomBusinessMessage`：
   - 解析通知。
   - 若当前正在该群会话，忽略提醒。
   - 否则把会话 ID 写入 `joinRequestPending` 本地集合。
   - 立即 patch 对应群会话。
4. `Conversation` 增加 `joinRequestPending?: boolean`。
5. `ConversationItem`：
   - 未免打扰且 `joinRequestPending`：显示 `[有新的进群申请]` 和右侧无数字红点。
   - 红点优先于未读数字。
   - 免打扰时不显示红字/红点，保留普通未读状态。
6. `markAsRead`：
   - 清除该会话的 `joinRequestPending`。
   - 重算 `highlightTags`。
7. 历史 `imAdmin` 会话：
   - 加载会话列表时，若私聊对方是 `imAdmin` 且最后一条预览为 `[入群申请]`，调用现有 `hideConversation` 隐藏。
   - 不删除消息。

## 状态与持久化

新增本地状态 key：

```text
im_join_request_pending_<userId>
```

值为 conversationId 的布尔映射，例如 `{ "sg_xxx": true }`。用途：

- 业务通知到达后立即写入。
- 会话列表刷新/重新登录后恢复红字和红点。
- 进入群聊后删除对应 conversationId。

该状态是每用户本地状态，不写入 OpenIM 会话 ex，避免影响普通会话同步。

## 组件边界

```text
utils/groupJoinRequest.ts
  - 原始 CustomMessage payload 解析
  - 业务通知 payload 解析

utils/conversation-highlight.ts
  - joinRequestPending 本地存储
  - 会话红字/红点计算

stores/chat.ts
  - 订阅 OnRecvCustomBusinessMessage
  - patch 群会话
  - markAsRead 清理
  - 历史 imAdmin 会话隐藏

components/ConversationItem.vue
  - 展示 [有新的进群申请]
  - 右侧无数字红点
```

`ChatBubble.vue` 的现有 `groupJoinRequest` 卡片保留，用于兼容历史消息，不参与新通知链路。

## 失败与边界处理

- 业务通知重复到达：pending 是布尔状态，重复设置无副作用。
- 通知到达时会话不在列表：先持久化 pending，会话加载时再应用。
- 进入群聊：本地立即清除，不等待服务端操作。
- 多个待审核申请：同一群只显示一个 `[有新的进群申请]` 和一个红点。
- 群被解散/退出：忽略通知，不创建群会话。
- 群会话免打扰：不展示强提醒，避免绕过用户设置。
- App 原生桥不转发业务通知：需要真机验证；若未支持，后续增加待审核数量补偿接口。

## 发布顺序

1. 先发布前端：同时兼容旧的 C2C 入群申请卡片和新的业务通知。
2. 再发布后端：停止发送 C2C 入群申请通知，改发业务通知。
3. 历史 imAdmin 会话由前端在会话加载时渐进隐藏。

## 测试计划

### 后端

- `PendingJoinRequestNotification` 返回正确的 `GroupConversationID`。
- `sendGroupJoinRequestNotification` 调用 `/msg/send_business_notification`。
- payload 包含 `key`、`requestId`、`groupId`、`groupConversationId`。
- 不再调用 `/msg/send_msg`。
- 只有有效群主/管理员收到通知。

### 前端

- 业务通知解析成功/失败用例。
- 收到通知后对应群会话 `joinRequestPending=true`。
- 刷新会话列表后红字/红点恢复。
- 进入群聊后 pending、红字、红点清除。
- 免打扰群不显示红色强提醒。
- 历史 `imAdmin` 入群申请会话被隐藏。

### 端到端

- H5 PC：申请入群 -> 群主/管理员群会话出现红字+红点 -> 进入群聊清除。
- H5 移动端：同上。
- App 原生：人工验证 `OnRecvCustomBusinessMessage` 是否可达。

