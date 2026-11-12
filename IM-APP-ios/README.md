# iOS 原生验证工程

本工程实现 Swift / UIKit 的首阶段开发基础，当前版本为 `0.1.1 (2)`，使用独立测试 Bundle ID `com.im.nativebootstrap.staging`。默认业务接口为 `https://www.xn--jprz53bj9s.com/api/v1`，对应现有 `www.易可聊.com` 的 HTTPS 服务；普通登录无需配置地址。工程不含正式证书或推送配置，不会覆盖原 uni-app 应用，也没有修改或部署后端。

## 当前可评审内容

- `Packages/IMCore` 是无第三方依赖的 Swift Package：五个既有 Go 认证接口、既有 `GET /me` 资料接口、Codable 模型、可注入 HTTP transport、会话 actor 和纯内存样例。
- 业务用户 ID 与 OpenIM 用户 ID 独立保存；获取业务凭据和 IM Token 不会将本地库设为可读，也不会标记同步完成。
- Session ticket 原子包含账号 key 与 generation；每次同步还有独立 SyncAttempt。切号、重登、退出和同步重试后，旧回调不能推进新状态。
- 同步失败、超时和取消分别记录，已可读本地库保持可读；核心不操作 SDK 私有数据库，没有自动删库、伪 SQLite 或伪同步实现。
- UIKit 登录页沿用 uni-app 的易可聊品牌、蓝渐变、原 Logo、密码登录结构和法律勾选；填写现有手机号与密码并同意协议后，依次调用 `POST /auth/login`、`GET /me`。成功后进入真实账号主界面，“我的”显示返回的昵称、易可聊号、脱敏手机号和简介。`GET /me` 失败时只显示本次 `auth.user` 资料并标明加载异常；若资料的业务 ID 不匹配则拒绝进入账号页。
- 当前没有 IM SDK，业务登录不会申请未使用的 IM Token，也不会调用 SDK 会话的 `authenticationSucceeded` 或标记消息库可读 / 同步完成。真实模式不创建样例会话，“聊天 / 通讯录”如实显示功能接入中。`SessionCoordinator` 和原有 SDK 状态门禁保持独立。
- 业务凭据只保留在当前账号页的内存会话，不写 UserDefaults、文件或日志，不展示 token；退出登录只释放本机内存会话，不请求全局退出。进程重启后需要重新登录；Keychain、自动续期和真实聊天均未接入。请求保持 HTTPS，拒绝自动重定向，未增加 ATS 放行。错误只显示经过长度限制和疑似凭据 / HTML 过滤的业务 `message`，非 JSON 错误使用通用 HTTP 提示，不显示原始正文。
- 长按 Logo 仍可打开开发面板覆盖已授权的 HTTPS 地址，保存地址只影响下一次登录，不会自动请求；也可取消当前登录。普通页面不显示环境输入、验证码登录或 SDK 术语。
- Logo 长按面板中的“打开本地样例”不需要账号、不联网。主导航按“通讯录 / 聊天 / 我的”排列，会话列表和文本聊天映射既有 Vue 组件的尺寸、颜色、文案和原图资产。样例持续显示“本地样例 · 不联网 · 不送达”；内存会话在样例模式内保留，退出样例后释放，没有真实发送或已送达状态。
- 27 项 XCTest 引用与 `contracts/native-bootstrap/v1/fixtures` 逐字节相同的合成 fixture，保留原有路由 / SDK 状态覆盖，并增加登录→资料两路由、GET Bearer、资料失败回退、身份不匹配、取消与安全错误提示验证。测试不使用真实凭据、不访问远端。

## Mac 上运行

需要 Xcode 15 或以上版本、Swift 5.9 或以上、iOS 15 或以上模拟器。工程使用 Swift 5 语言模式，尚未接入任何 OpenIM SDK；不用 CocoaPods 或另外下载项目脚手架。

```bash
# 从仓库根目录执行；只运行本地测试，不访问真实服务。
python3 IM-APP-ios/scripts/verify_project.py
swift test --package-path IM-APP-ios/Packages/IMCore
xcodebuild -list -project IM-APP-ios/IMNative.xcodeproj
xcodebuild -project IM-APP-ios/IMNative.xcodeproj \
  -scheme IMNative -sdk iphonesimulator -configuration Debug \
  -derivedDataPath IM-APP-ios/DerivedData CODE_SIGNING_ALLOWED=NO build
```

在 Xcode 打开 `IMNative.xcodeproj`，选择 `IMNative` Scheme 和可用 iOS 模拟器，Run 后可直接使用团队授权账号验证既有业务登录；长按 Logo 可改用测试地址或进入离线样例。本次开发没有运行真实登录 / 短信请求，没有使用真实凭据；上线账号验证需由团队在 Mac 或真机执行。

手动验收时检查：登录成功确实进入主界面；“我的”资料属于本次登录账号；聊天页没有样例消息；退出后回到登录页；取消登录或改为本地样例后，迟到的请求不能再次打开账号页。业务请求返回成功只能证明登录 / 资料链路可用，不能视作聊天、性能或 iOS 同步问题验收通过。

`Xcode Test` 的空 TestAction 不包含 Package 的独立 XCTest；CI 和本地应执行上面的 `swift test` 命令。Simulator Build 验证 app→IMCore 链接，不能代替 UI 运行或真机库测试。

Windows 上只执行 Python 静态校验。Swift/Xcode/模拟器在当前环境没有安装，因此本次没有执行 `swift test`、`xcodebuild` 或运行截图；不得将这些步骤记作已通过。

## 发布与数据门禁

当前 Release 和 Archive 会由 Build Phase 明确失败，避免把独立测试身份当正式升级包。暂不提供绕过开关。配置正式应用身份、签名、OpenIM SDK 兼容、数据迁移及发布审批后，再通过经过评审的改动接入发布流水线。

后续必须先完成以下验证，才能声称 iOS 同步问题已解决：

1. 确定与现网 OpenIM 服务及旧 App SDK 数据兼容的版本，接入真实 SDK 适配层。
2. 真机验证离线开库、文件保护 / 锁屏、同步中断、网络切换、杀进程重启、磁盘不足与升级迁移。
3. 在 SDK 支持的方式下保全草稿、待发、仅本地消息和附件；同步错误不能直接触发清库。
4. 完成持久 Outbox 与不确定发送结果对账；当前内存样例不具备持久聊天能力。
5. 验证推送、后台生命周期、历史分页和混合媒体性能；通过旧客户端互通与正式签名覆盖升级测试。

当前 App 只做认证与本地界面验证。`SessionCoordinator` 的状态 API 是后续 SDK 适配边界，不能据此推断 SDK 开库、SQLite 事务或同步游标已经可用。

## 首轮 UI 还原范围

本轮已映射 `sign-in.vue` / `auth-modern.scss`、`ImTabBar`、`ConversationItem`、`ChatBubble` 文本部分、`ImMessageComposer` 文本行及 `chat/index` / `chat/room` 的首轮结构。`rpx = 窗口逻辑宽度 / 750`，登录最终覆盖中的 `px` 保持逻辑尺寸。根生成的原 PNG / SVG 栅格图位于 `Assets.xcassets`，法律原文以 `Legal` 目录打包，仅本地读取、禁用 JavaScript 和外部跳转。

通讯录、个人中心、注册、找回密码、群管理、媒体、表情面板等没有在此轮还原，点击未接入入口会如实提示。没有旧 App 与原生同视口截图对照，也没有 Mac 实际运行，不能宣称像素一致、全量 UI 完成或编译通过。
