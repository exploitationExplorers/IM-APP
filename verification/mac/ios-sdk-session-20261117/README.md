# iOS 官方 SDK 与 Android 登录对照（20261117-ui6）

当前模拟器安装包已包含 ui6，但 SDK 在线登录、UI、图片保存和群聊滚动仍未完成运行验收。本轮未改后端、未部署、未提交或推送代码；之前准备的后端补丁继续待审，不作为已经证实的唯一解决方式。

## 同账号、同服务的在线证据

| 项目 | iOS 平台 1 | Android 平台 2 |
|---|---|---|
| 业务登录与取 IM 票据 | HTTP 200 / code 0 | 同一次业务登录 / 取票 HTTP 200 / code 0 |
| 票据平台、身份 | 匹配 | 匹配 |
| `/auth/parse_token` | HTTP 200 / errCode 1507 | HTTP 200 / errCode 0 |
| `/conversation/get_all_conversations`（与原生 Android 相同） | HTTP 200 / errCode 1507 | HTTP 200 / errCode 0，764 个会话 |
| 规范化 API / WebSocket | 与 Android 相同 | 与 iOS 相同 |

平台 1 的 JWT 当时仍有约 53 天有效期，但 OpenIM 不再承认该票据。1507 在固定 SDK 依赖的 tools 定义中为 TokenNotExistError。此结果解释 Android 能读会话、iOS 不能；不证明最初失效原因，也不等于必须部署新后端代码。之前 uni-app 能用与当前平台 1 票据失效可以同时成立。

核验只读业务和聊天接口；没有连接 Android SDK、发送消息、撤回消息或修改群。最初几次核验出现临时 500/网络错误，最终同一次业务会话下的两平台对照全部完成。报告不含完整账号、用户 ID、密码或 Token。

## 官方文档和固定版本源码核对

- 官方 iOS 会话文档：`https://docs.openim.io/sdk/ios/getting-started/authenticate-and-manage-session`
- 官方旧版 login 文档：`https://openim-docs-legacy.vercel.app/sdks/api/initialization/login`
- 官方旧版 logout 文档：`https://openim-docs-legacy.vercel.app/sdks/api/initialization/logout`
- 固定 Core 源码：`https://github.com/openimsdk/openim-sdk-core/blob/v3.8.3-patch.15/open_im_sdk/apicb.go` 和 `userRelated.go`
- 固定依赖错误码：`https://github.com/openimsdk/tools/blob/v0.0.50-alpha.80/errs/predefine.go`

当前官网与旧版文档分开核对，以固定版源码确认具体时序。Core 的 login 负责本地开库和启动后台连接；回调成功不能代替 onConnectSuccess。凭据错误先回调 App，再排队自动 Logout。unInit 不替代已登录会话的 Logout。保留项目现有 3.8.3-hotfix.15 包装层与内存修复 Core，不升级 SDK。

## iOS 本轮修正

1. Token 失效后等待 SDK 自动退出完成，不额外 Logout，也不在状态 2/3 或上一 Login 回调未完成时重登。
2. 替换票据若仍与已拒绝票据完全相同，停止保存和重登，明确提示；继续只允许一次自动取票恢复。
3. 在线恢复等连接成功事件。发送还须满足在线连接、SDK 登录和本地可读条件。
4. 正常退出/切号等待登录和 Logout 回调释放旧核心，再 unInit；失败时阻止新 owner 接管，保留数据库及 Outbox。
5. 连接失效回调只提取白名单数字错误码，不传出原始 SDK 错误。诊断记录 iOS 平台、恢复阶段、是否重复票据及 SDK 连接状态。
6. 认证失败后，迟到的本地会话读取不能覆盖认证提示或清除失败状态。

## 验证

131 项 IMCore 测试、8 项工程检查、git diff --check 通过。Simulator / iPhone Debug 无签名构建均通过，二进制含 ui6。新增回归覆盖异步自动退出、退出卡住、SDK 未初始化、取消等待、重复失效票据和安全连接诊断。构建仍有既有 Swift 并发 Sendable 警告；编译成功不代表回调时序已经实际运行验收。

本轮开始时安装包是 ui5，后续核对安装包已变为 ui6。当前执行环境仍无法连接 CoreSimulatorService 或控制原生 UI，未直接安装/启动或点击验收，不能确认当前运行进程和安装文件一致。

## 剩余验证

平台 1 必须取得 OpenIM 接受的有效票据后，才可核验真实 SDK 在线连接与全部会话、通讯录、图片保存、群聊连续上翻和每页 UI。不要改用 Android 平台号，不要卸载 App 或删除 SDK 聊天数据库。客户端时序修正不能让已被服务拒绝的票据恢复有效。
