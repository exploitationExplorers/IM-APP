# iOS 部分群聊天未就绪修复（2026-11-17）

## 原因与修复

授权测试账号进入“困困、用户8612”时，SDK 已连接并同步完成，但群保留水位接口成功返回 `items: []`。iOS 错误要求响应中必须有对应水位，抛出聊天未就绪；Android 将成功空响应记录为已查询。后端对尚未发布清理水位的群允许返回空列表。

`GroupVisibilityLedger.applyRetentionSnapshot` 现在记录成功且通过校验的查询，允许空/部分响应；不伪造零水位，不降低已有水位，不移除成员清理记录。重复、越界、负值或非请求群响应原子拒绝，持久化失败不更新确认状态。旧归档仍可读取。单群刷新和批量刷新统一使用该入口。

群成员权限接口与成员消息清理快照仍独立校验；空水位响应本身不会放行群权限。未清库，未升级 SDK，未解除发布门禁。

## 官方资料核对

- https://docs.openim.io/sdk/ios/conversation/retrieving-conversations/get-conversation-by-target
- https://docs.openim.io/sdk/ios/message/retrieving-messages/load-older-messages

核对固定依赖 OpenIMSDK `3.8.3-hotfix.15` 的 `OIMManager+Conversation.h`、`OIMManager+Message.h` 及项目桥接。官方会话查询与历史分页保持原用法；本次根因在项目业务水位响应处理，并非 SDK 未连接。

后端依据：`internal/repository/group_retention_visibility.go`、`internal/handler/group_retention.go`、`internal/service/im.go`；对照 Android `chat/ChatController.kt` 与 `chat/GroupRetention.kt`。

## 实际验证

- 159 项 IMCore 测试通过，0 失败（新增 6 项覆盖空响应、重启、旧归档、水位不回退、非法响应和写盘失败）。见 core-tests.log。
- 8 项工程静态检查通过；`git diff --check` 通过。
- Simulator Debug 本地签名构建成功，见 simulator-build.log。构建保留 `CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=-`，保证 Keychain 正常工作。
- 独立模拟器 IM-iOS-Refactor-20261117（iPhone 18 Pro / iOS 27.2）安装当前构建，保留原有数据与测试登录。
- 原故障群“困困、用户8612”：历史图片与系统通知正常加载，输入框可用，未再出现聊天未就绪。
- “坤坤、用户0520、测试用户”和“初心帮”：群历史正常加载，输入框可用。
- 结束进程再启动，自动恢复登录，重新搜索并进入原故障群：历史正常，异步校验结束后输入框恢复可用。

没有发送消息、提交邀请或审批；未验证真实离线场景、iPhone 真机或正式分发。本记录仅覆盖本次群就绪问题。
