> 后续核对（ui6）：用户已选择暂不部署。同账号 Android 平台 2 票据有效并读到 764 个会话，iOS 平台 1 仍为 1507；客户端另已修正 SDK 自动退出与重登时序。本文待部署项属于此前备选方案，不代表必须改后端代码。最新证据见 `iOS官方SDK与安卓登录对照` / `ios-sdk-session-20261117` 报告。

# iOS 登录与失效凭据修复（20261117-ui5）

本轮查明了服务端返回不可用 iOS 聊天票据的问题，客户端和业务服务修复已完成本地验证，尚未部署和运行验收。

## 在线证据

使用用户授权账号进行核验，凭据仅在内存使用，报告不包含密码、Token、完整账号或用户 ID。业务登录与平台 1 的 IM Token 接口均为 HTTP 200 / code 0，身份匹配，JWT 当时仍有约 53 天有效期；随后用返回的票据调用 OpenIM `/auth/parse_token`，携带 operationID，返回 HTTP 200 / errCode 1507（票据不存在）。

这证明成功取票不能代表票据可用。代码检查同时发现业务服务的 Redis / 进程缓存只检查时间，不验证上游是否仍保存该票据。失效发生的最初原因（例如撤销或 Redis 状态变化）仍未取得服务端日志，不能据此断言。

## 修复内容

- iOS 冷启动不再因存在 IM 缓存跳过业务资料、过期与身份校验。临时断网仍允许已确认的同一身份尝试读取本机历史。
- 业务接口返回 HTTP 401/403、正文 code=1 时保留 HTTP 认证语义，刷新请求不会因丢失状态而失效；刷新资料不延长旧 access token 的绝对有效期。
- IM 在线票据检查保存时间和 JWT 到期时间；匹配账号、环境和平台后使用。明确失效只撤销匹配票据缓存，每次业务登录最多恢复一次。重复通知不循环签发，1506 互踢不自动重登。
- IM 认证失败与业务 owner 生命周期分离，通讯录、资料不再被误拦为“请求已取消”。
- 后端复用缓存前调用 OpenIM parse_token；明确失效 / 不存在时，按账号平台锁最多签发一次并验证新票据。断网、未知上游异常及互踢不触发循环。只覆盖对应缓存，不清空全局 Redis、不改消息库。

## 已验证

- 125 项 IMCore XCTest，0 失败；8 项工程检查通过；git diff --check 通过。
- Simulator / iPhone Debug 无签名构建通过，两份二进制均包含 20261117-ui5。
- Go internal/im 与 internal/service 的测试及 -race 通过，含失效 Redis/本机缓存、有效缓存复用、24 路并发只签发一次、网络失败、互踢、新签票据再次失效、身份/平台/期限校验。
- 后端 go build ./...、go vet ./... 通过。使用官方 Go 1.25.0 临时工具链及官方 Go 模块代理下载依赖，按仓库 go.sum 验证。

## 待执行

1. 审核并部署附带的后端补丁至当前业务 API 服务。无需数据库迁移；部署前保留当前服务二进制 / 镜像用于回滚，不清空 OpenIM 或 Redis。
2. 在 Xcode 打开 /Users/Admin1/Developer/IM-APP-github/IM-APP-ios/IMNative.xcworkspace，选择 IMNative 和现有模拟器，重新 Run。不要卸载 App。“我的 → 通用 → 调试资讯”应为 20261117-ui5；目前安装的仍为 ui4。
3. 使用授权测试账号验证取票后 parse_token 为 0、SDK 登录、会话完整读取和通讯录；再继续图片保存、群聊历史滚动与逐页 UI 回归。

当前 CoreSimulatorService 连接被执行环境拒绝，未安装新包、未完成 UIKit / Photos 运行验证；不得将测试或构建通过当作真实登录或全部功能验收通过。没有发送消息、改群、提交代码或部署线上服务。

## 参考来源

错误码通过 OpenIM tools v0.0.50-alpha.126 的 errs/predefine.go 确认：1506 为 TokenKickedError，1507 为 TokenNotExistError。OpenIM server 的 auth RPC ParseToken 返回真实 userID / platformID / JWT 到期时间；SDK 和业务登录状态分开判定。
