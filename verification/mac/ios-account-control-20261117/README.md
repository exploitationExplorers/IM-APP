# iOS 双账号登录复核（2026-11-17）

> 后续状态更新：已于北京时间 2026-11-17 14:39:32 完成用户授权的单账号平台 1 定点票据恢复，并经公网校验和读取 766 个会话。下文保留修复前的诊断过程；现网恢复结果及限制以 [单账号票据恢复报告](../ios-ticket-recovery-20261117/README.md) 为准。没有部署或重启服务，尚未完成原生 SDK 在线连接与 UI 验收。

已复现的阻塞是：失败账号经业务接口取得的 iOS / 平台 1 票据，被 OpenIM 自身拒绝。业务密码登录与资料读取都成功。另一个账号可用与这一张票据失效可以同时成立；本次证据不代表业务服务整体不可用，也不证明必须修改或部署后端代码。

## 实测结果

两个账号使用相同服务地址、相同请求结构；单个账号的平台 1 / 2 对照复用同一次业务登录。没有保存账号、密码、用户 ID 或票据。

| 校验 | 可用账号 | 失败账号 |
|---|---:|---:|
| 业务密码登录 | HTTP 200 / code 0 | HTTP 200 / code 0 |
| iOS 取票的平台、身份、地址、期限 | 通过 | 通过 |
| iOS `/auth/parse_token` | errCode 0 | errCode 1507 |
| iOS `/conversation/get_all_conversations` | errCode 0，13 个会话 | errCode 1507 |
| 安卓平台 2 的上述两项 | 均为 0，13 个会话 | 均为 0，766 个会话 |

随后构建独立 Swift 可执行程序，直接链接当前 iOS 工程的 `IMCore`，调用同一个 `APIClient.businessPasswordLogin`、`APIClient.imToken` 和 `IMBootstrapCredential.validForLogin`。这次没有使用模拟器、Keychain、SDK 数据库或 OpenIM SDK，两个账号各连续申请平台 1 票据两次：

- 可用账号两次都通过 OpenIM 校验，均读取到 13 个会话。
- 失败账号两次返回完全相同的票据，两次校验和会话读取均为 1507。
- 业务账号资料均成功加载；没有修改或裁剪密码。当前复现不依赖旧安装包、本地票据或 SDK 登录时序。

最后按固定 Core 的 `reConn` 参数独立检查失败账号的 WSS 握手，服务返回 HTTP 200 / errCode 1507，没有升级为 WebSocket。这进一步确认在线连接也拒绝该票据，不能通过改会话列表 UI 消除这一阻塞。该探针没有发送聊天消息。

原始脱敏状态分别保存在 `platform-comparison.json`、`swift-client-result.json`、`websocket-result.json`。Swift 核验完成于北京时间 2026-11-17 13:58:24，WSS 核验完成于 14:01:14。

## 官方资料及原生安卓核对

- 官方 iOS 会话文档：`https://docs.openim.io/sdk/ios/getting-started/authenticate-and-manage-session`。客户端消费服务签发的用户票据；无效后应取得有效凭据再认证，不能由客户端自行生成票据。
- 固定 Core：`https://github.com/openimsdk/openim-sdk-core/tree/v3.8.3-patch.15`。核对 `open_im_sdk/userRelated.go`、`apicb.go`、`internal/interaction/long_conn_mgr.go`：本地 login 回调与在线连接是不同阶段；凭据错误通知后 SDK 自动退出；WSS 握手遇到 1507 停止本轮重连。
- 固定错误定义：`https://github.com/openimsdk/tools/blob/v0.0.50-alpha.80/errs/predefine.go`，1507 为 `TokenNotExistError`。
- 仓库部署文件固定的官方 server tag 为 `v3.8.3-patch.16`，已核对其 `internal/rpc/auth/auth.go`：即使 JWT 期限正常，票据不在对应 user/platform 的有效集合中仍返回 1507。没有据此断言现网实际镜像版本已被核验。
- 原生安卓 `NativeAPI.imToken` 使用平台 2；`OpenIMGateway` 用这张平台 2 票据读取相同会话接口并登录 SDK。安卓成功不能验证同账号的平台 1 票据；本次没有把安卓票据用于 iOS。
- 正常 SDK logout 的固定实现发送 `DelUserPushToken`、释放本地资源；已查看的 server 消息处理也只调用推送令牌删除。没有证据表明这次独立请求前由 iOS logout 删除了认证票据。

初始核验确认“返回的票据失效且重复申请不变”。后续已在现网核对业务 Redis，确认其缓存持有同一张被 OpenIM 拒绝的票据，缓存期限仍在未来。业务取票缓存与 OpenIM 有效票据状态不一致已得到验证；最初何时、被哪个流程撤销或替换，仍未查明。

## 恢复路径与边界

当前普通用户取票接口只接收 `platformId`，没有已实现的强制重签参数。仅在客户端清缓存或重构 SDK 调用，仍会拿到上述同一张票据。当前没有证据支持用一次大规模 iOS 重构解决这一张票据的拒绝。

可评估无需代码部署或容器重启的定点恢复：通过现有受信任管理通道，为失败账号的平台 1 取得 OpenIM 接受的凭据，并同步该账号对应的业务取票缓存。执行前须确认实际环境、同账号多端策略和缓存层：现有实现还保留进程内缓存，不能只删除 Redis 键并假定一定会重新签发。不得批量清理用户数据或票据。

用户已明确授权仅修复失败测试账号的平台 1 票据及对应缓存，授权不包括代码部署或服务重启。随后用户提供已有管理入口，已完成定点恢复：业务接口返回有效的平台 1 票据，OpenIM 解析及会话读取均为 0，读取 766 个会话。Android 原票据未改变且仍有效。原生 SDK 在线连接与页面仍待验收；没有越过用户“暂不部署”的决定。

## 本轮实际改动和限制

初始核验阶段新增只读登录核验工具和报告，随后经用户授权替换单账号平台 1 的票据和一项对应业务缓存。没有修改 App 业务代码、SDK 版本或后端代码，没有部署、服务重启、提交或推送。此前本地待审后端补丁原样保留。

独立 Swift 探针编译及两账号在线对照通过执行，原生模拟器/UI 仍未由本轮直接操控；不把接口验证说成真机登录、保存图片、滚动和逐页 UI 验收通过。此前 ui6 的编译/单元测试结果属于前一轮，本轮没有重复宣称新构建修复了此账号。

`source-sha256.json` 记录本次实际链接及对照的客户端源文件摘要；`probe-sources/` 仅含没有硬编码账号凭据的探针源文件。密码及完整 Token 只在隐藏标准输入与进程内存中处理。
