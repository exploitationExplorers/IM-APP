# 易可聊 iOS 原生工程

当前开发版本 `0.3.0 (4)`，Swift / UIKit，iOS 15 起。测试 Bundle ID 为 `com.im.nativebootstrap.staging`。以现有 uni-app 的页面、文案、素材与业务操作为基准；核心聊天使用官方 OpenIM SDK。未修改旧前端或后端，未部署或发布。

## 在朋友的 Mac 上验证

解压配套 `IM-iOS-0.3.0-mac-check.zip`，在解压后的根目录执行：

```bash
bash IM-APP-ios/scripts/verify_on_mac.sh
```

需要完整 Xcode、Python 3、Ruby 与 Bundler。脚本依次执行工程静态检查、Swift Package 核心测试、固定 CocoaPods 依赖安装和无分发签名的模拟器 Debug 编译；失败即停，结果和日志保存在 `verification/mac/`。它不提交账号、不发布、不上传证书。

构建后打开 `IM-APP-ios/IMNative.xcworkspace`，选择 `IMNative` Scheme 和模拟器运行。连接 iPhone 时，在 Signing & Capabilities 选择自己的开发团队、信任设备并启用 Developer Mode。真机签名、免费个人团队限制和完整回归步骤见 [Mac 验证步骤](../docs/iOS-Mac验证步骤.md)。不能只打开 `.xcodeproj` 跳过 SDK 依赖。

首次安装依赖后核对并保留 `Podfile.lock` / `Gemfile.lock`；Pods、vendor、DerivedData 和个人签名配置不提交。纯核心测试也可单独运行：

```bash
python3 IM-APP-ios/scripts/verify_project.py
swift test --package-path IM-APP-ios/Packages/IMCore
```

## 固定依赖

- CocoaPods：`OpenIMSDK = 3.8.3-hotfix.15`、`OpenIMSDKCore = 3.8.3-hotfix.15`，CocoaPods 工具版本 `1.16.2`。
- 包装层官方 tag commit：`780307d05fb93f32b093188bfab3ca4047123fa9`；Core：`45cd9dcc80f3b41fcaa49664c768713d6b4976bb`。
- `NativeOpenIMBridge.h/.m` 将固定版本的正式 ObjC selector 适配为自有 Swift 接口；不使用 SDK 替身。Core 生命周期使用正式导出的后台和网络状态 API。
- `Packages/IMCore` 不依赖第三方二进制，覆盖身份与代次、端点策略、Outbox、媒体快照和可见水位等纯核心逻辑。Windows 静态检查和语法解析不能证明 Swift 类型、ObjC 导入或二进制链接正确。

## 登录与页面

普通登录默认连接现有 `https://www.xn--jprz53bj9s.com/api/v1`。`/auth/login` → `/me` 校验业务身份，再独立申请平台 `1` 的 `/im/token` 登录 SDK；业务用户 ID 和 IM userId 分开保存。Logo 长按保留开发配置与明确标注“不联网、不送达”的离线样例，不给真实账号注入样例会话。

Keychain 使用 `AfterFirstUnlockThisDeviceOnly`、不云同步，保存业务会话而不保存密码。冷启动恢复资料；过期或明确 401 最多一次刷新，旋转凭据先安全保存。条件保存/清理防止迟到刷新或退出覆盖新登录。普通断线由 SDK 重连，不循环签发 Token。

已补接通讯录、好友申请/标签/资料、建群/邀请/管理/公告、个人资料/二维码、收藏、设置、反馈举报、注销、注册找回及群发等原生业务流程。具体实现与仍有差异的页面以 [逐页对齐记录](../docs/原生功能与UI对齐-20261113/功能与UI对齐记录.md) 和 `contracts/ui-parity/v1/ios-page-map.json` 为准，不以有页面标题代表全部完成。

图像加载在后台执行，包含共享下载、并发上限、有界解码、内存/磁盘缓存和失效反馈；头像和富消息使用真实媒体。GIF 使用有界动画策略，超大图片回退首帧，实际设备表现仍需验证。媒体兼容旧 camelCase / PascalCase，已知旧签名媒体恢复稳定入口，未知签名参数不随意修改。

## 消息可靠性与本地库

SDK 独占自己的历史数据库，应用不读写私有表、不建立第二套全量消息库、不自动删库或修库。账号和环境分目录隔离，目录排除备份并使用文件保护；自有 Outbox 与业务可见水位单独持久保存。群保留水位和成员清理屏障保持单调，迟到历史不能复活已隐藏原文。

文字、图片、视频、语音与文件走真实 SDK 和持久 Outbox：先创建稳定 clientMsgID、原子保存，再调用发送。写盘失败不发送。SDK 接受只表示已提交，不冒充送达或已读。超时/强杀后的未知结果先按 ID 核对，不自动盲目重发；空查询或本地失败不足以证明服务器未接收。退出/切号取消业务操作并依次停止旧 SDK，代次和独立同步 attempt 拦截旧回调。

会话与历史使用正式分页接口；错误不伪装空页或结束。固定 SDK 请求包装层不暴露 `lastMinSeq`，历史使用真实支持的 `startClientMsgID`，返回水位只作上下文；必须在多页和保留边界场景验证，不自造 SDK 参数。同步等待超时保留库，迟到完成不伪造成功。

## 验收与发布

本机 Windows 无 Xcode：核心 XCTest、CocoaPods、Xcode 编译、iPhone 真机、真实账号互通与性能验收均不能在此声称通过。当前静态执行记录与 Android 合成截图见逐页对齐文档；iOS 运行结果需由朋友的 Mac 回传日志补齐。

Mac 编译成功后仍须验证：旧/新端媒体互通、头像/旧图片、分页和搜索定位、群权限/保留边界、登录恢复与切号、锁屏/前后台、断网与强杀期间同步/发送、磁盘不足、长历史性能。使用授权内测账号；同账号同平台登录会遵守现网 OpenIM 互踢策略。

现有后端 `LoggingPushService` 是日志实现，登记 push-token 不等于 APNs 真正下发。实时音视频、后台推送、线上定制协议、正式身份/签名和旧库覆盖迁移分别验收。当前 staging 安装不覆盖旧正式 App，也不能证明覆盖迁移成功。

Release / Archive Build Phase 仍明确阻断，未提供绕过开关。原生 iOS 不使用 uni-app 云打包；完成门禁后使用团队 Mac / CI 的 Xcode Archive → TestFlight / App Store。正式步骤见原生重构方案。当前不能宣称 iOS 同步故障已彻底解决或已具备生产替换条件。
