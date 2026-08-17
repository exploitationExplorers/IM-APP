# IM 会话设置（业务 ID 入参）+ 消息推送 接口开发计划

> 本计划覆盖三类需求：
> 1. 把之前「传 OpenIM conversationId」的会话设置接口，改为 **传业务好友 ID / 群 ID，由后端拼 conversationId**。
> 2. 增加「消息推送」能力（来消息提示）：前端注册设备 push token + OpenIM 回调触发推送管线。
> 3. 产出可导入 **Apifox** 的 OpenAPI 3.0 文档（含完整传参）。

---

## 一、会话设置接口：业务 ID 入参（替代 conversationId）

### 改动动机
之前接口用 `:conversationId` 作路径参数，要求前端自己持有 OpenIM 会话 ID。
但前端进会话时本就只有「业务好友 ID / 业务群 ID」，让前端拼 `si_`/`sg_` 既重复又易错（尤其群聊前缀 `g_` vs `sg_` 在不同版本有歧义）。
改为后端用已有的 `ResolvePeer` / `ResolveGroup`（业务 ID → OpenIM ID，且带好友/群关系校验）拼出 conversationId，前端只需传它本来就有的值。

### conversationId 拼接规则（来自 OpenIM `pkg/msgprocessor/conversation.go`）
- **单聊**：`si_` + `sort.Strings([userA, userB])` 用 `_` 连接。
  - 本系统业务 userID 经 `UserIDFromBusinessID` 已是「去连字符的小写 UUID」（32 位 hex），无大小写问题，`sort.Strings` 结果确定。
- **群聊**：本项目 `EnsureGroup` 用 `groupType: 2`（超级群）→ 前缀 **`sg_`**。
  - 但不同 OpenIM 版本常量命名有分歧（`WriteGroupChatType=2` 在部分源码里是 `g_`），为避免落到幽灵会话，**后端按候选顺序尝试**：先 `sg_<groupID>`，若 `GetConversations` 命中已存在会话则用它；都不存在则默认 `sg_<groupID>`（与本项目群类型一致）。

### 端点（均在业务 JWT 组下）
| 方法 & 路径 | 说明 |
|---|---|
| `GET /api/v1/im/conversations/:peerType/:peerId` | 获取会话设置 |
| `PATCH /api/v1/im/conversations/:peerType/:peerId` | 部分更新会话设置 |
| `POST /api/v1/im/conversations/:peerType/:peerId/read` | 标记已读 |
| `PUT /api/v1/im/me/global-msg-recv-opt` | 用户级全局免打扰（不变） |

`peerType` ∈ `c2c` / `group`；`peerId` 为业务好友 ID 或业务群 ID。
`c2c` 走 `ResolvePeer`（含 CanChat 校验），`group` 走 `ResolveGroup`（含 CanChat 校验）。
校验不通过 → 403；peerType 非法 → 400；会话不存在（仅 GET）→ 404。

### 防清零策略（不变）
更新仍走 `GET 全量 → 叠加本次传入字段 → SET 回写`，避免 protobuf 部分写入把未传字段清零。

---

## 二、消息推送（来消息提示）

### 设计
「来消息提示」= App 在后台/离线时，由推送通道（APNs / FCM / 个推 / 鸿蒙）下发通知。
需要两块：

1. **前端注册设备凭证（前端对接接口）**
   - `POST /api/v1/im/me/push-token`：注册/更新设备 push token（platform / channel / deviceToken / enabled）。
   - `DELETE /api/v1/im/me/push-token`：注销（用户退出或关闭推送时）。
   - 存储：Redis JSON 列表，key = `openim:push-tokens:v1:<openIMUserID>`，按 `Platform+DeviceToken` 去重 upsert，不过期。

2. **OpenIM 回调触发推送（后端内部管线）**
   - 复用现有 `AfterMessage` webhook（单聊/群聊消息落库后由 OpenIM 回调）。
   - 在记录审计后构造 `PushMessage{conversationID, sender, recvIDs, groupID, contentType, sendTime}`，调用 `PushService.Dispatch`。
   - 推送失败**不影响**消息投递（webhook 仍返回 allow）。
   - 当前 `PushService` 先用 **`LoggingPushService` 日志桩**（仅打印推送意图），预留接入 APNs/FCM/个推 的接口位。真实实现需持有设备令牌仓库 + 各通道客户端（后续按需实现）。

### 未读角标说明
未读总数由前端直接调用 OpenIM SDK `getTotalUnreadMsgCount` 获取（客户端已有 WS 连接，无需后端中转）。
后端不额外提供未读汇总接口，避免引入不确定的 admin 端点路径。

---

## 三、Apifox 文档（前端对接）
产出 `docs/openapi-im.json`（OpenAPI 3.0.3），覆盖以上**全部前端对接接口**：
`/im/token`、`/im/peers/:businessUserId`、`/im/groups/:businessGroupId`、
`/im/conversations/:peerType/:peerId`（GET/PATCH/read）、
`/im/me/global-msg-recv-opt`、`/im/me/push-token`（POST/DELETE）。
含：Bearer 鉴权、路径/请求体/响应字段类型与说明、示例值、错误码。
前端在 Apifox 导入该 JSON 即可直接调试。

---

## 四、风险与验证
- **群聊前缀歧义**：已用 `sg_` 优先 + `g_` 兜底容错。
- **编译验证受限**：本机 Go 为 1.23，go.mod 要求 1.25 且联网下载被墙，无法 `go build`；以 `gofmt -e` 语法校验 + 严格遵循既有模式（postWithAdmin / response.OK / middleware.UserID）兜底。真机需 `docker compose` 起 OpenIM + 后端联调：
  - `PATCH /api/v1/im/conversations/c2c/<好友ID>` `{"recvMsgOpt":1,"isPinned":true}` → `GET` 确认生效；
  - `POST /api/v1/im/me/push-token` 注册 → 发消息看 `LoggingPushService` 是否打印推送意图。
- **Redis 不可用**：push token 注册返回 503（提示未生效），不阻塞主流程。
