# 原生 iOS 对齐 Android：第一批改动与验证

日期：2026-11-16。开发目录：`/Users/Admin1/Developer/IM-APP-github`。

## 代码同步确认

已成功执行 `git fetch --prune origin`，本次检查时远程 `codex/native-bootstrap` 与本机均为 `ac5bdbf1f32c725d48ae5385dc7819157633dc9b`。其中已包含 Android `6806486` 的首屏/头像性能优化。另一份 `/Users/Admin1/Developer/IM-APP` 停留在 `f1c0d68`；本次修改只在较新的仓库中完成。

## 本次修改

1. 业务身份校验与本地登录保存成功后先进入聊天页面，再等待 SDK 登录、开库和会话读取；未就绪时仍不能发送。
2. 本地与正式历史每页由 40 条改为 20 条。首次同步前缓存的空历史结束页在同步完成时失效，通知当前聊天页重新读取；旧异步结果按历史版本丢弃。
3. 头像/消息图片候选保留缩略图和原地址，缓存优先。只发起 HTTPS 请求，未知签名 URL、账号缓存隔离及 capability token 保留。
4. 标记已读后只读取对应会话，避免进入一个聊天就扫描整个会话列表；查询期间到达的新事件优先。
5. 会话列表提取摘要不再额外序列化完整消息 JSON。已有有序消息做线性合并，只排序新增/更新消息，保留撤回和成功状态不回退的规则。
6. 16ms 内 UI 通知合并；聊天列表仅重配消息、发送状态、日期、附件准备状态或选择状态变化的行，并保留原有滚动锚点逻辑。

## 已执行验证

| 检查 | 结果 |
| --- | --- |
| `git diff --check` | 通过 |
| 工程静态检查 | 8 项通过 |
| Swift 核心测试 | 96 项通过，0 失败（原 93 项 + 3 项回归测试） |
| iPhone Debug，arm64，真实固定 SDK，无签名 | BUILD SUCCEEDED |
| iOS Simulator Debug，arm64，真实固定 SDK，无签名 | BUILD SUCCEEDED |
| 模拟器启动/截图 | 未完成：当前环境连接 CoreSimulatorService 被拒绝 |
| 真机安装、登录、长历史和媒体回归 | 未测 |

新增测试覆盖：缩略图失效后的原地址候选、签名/HTTPS/相对地址处理，以及乱序、重复、状态更新消息的增量合并与完整快照结果一致性。

验证使用 Xcode 27.2（27B52）、macOS 27.2.1、arm64。本机环境下 workspace 类型识别失败，直接构建已包含 `Pods-IMNative` 显式依赖的项目与 Scheme，未跳过 SDK 编译/链接；使用 `-IDEPackageSupportDisableManifestSandbox=YES` 处理已信任本地 Swift Package 的嵌套 manifest sandbox 限制。SDK 版本、签名和发布阻断未更改。

两次最终 Debug 构建命令分别为：

```bash
xcodebuild -project IM-APP-ios/IMNative.xcodeproj -scheme IMNative -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath .native-cache/DerivedData -IDEPackageSupportDisableManifestSandbox=YES CODE_SIGNING_ALLOWED=NO build
xcodebuild -project IM-APP-ios/IMNative.xcodeproj -scheme IMNative -configuration Debug -sdk iphoneos -destination 'generic/platform=iOS' -derivedDataPath .native-cache/DerivedData -IDEPackageSupportDisableManifestSandbox=YES CODE_SIGNING_ALLOWED=NO build
```

完整日志保留在 `/Users/Admin1/Developer/IM-APP-github/.native-cache/verification/ios-android-parity-20261116/`。产物分别位于 `.native-cache/DerivedData/Build/Products/Debug-iphoneos/IMNative.app` 和 `Debug-iphonesimulator/IMNative.app`；iPhone 产物尚未签名，不能直接安装。

## 下一轮实际验收

- 在 Xcode 打开较新目录中的 `IM-APP-ios/IMNative.xcworkspace`，选择自己的 Team 和测试 iPhone，执行 Debug Run。
- 核对首次登录进入页面后的同步进度；同步前打开空房间，同步结束后应自动出现真实历史。
- 连续向上滚动长历史，检查分页无跳动、多选与日期分隔正确；核对媒体发送中/失败/成功状态。
- 验证旧头像、缩略图失败后的原图回退、断网下已有缓存，以及已读红点和切换账号隔离。

本次未登录真实账号、未向联系人发送消息、未安装真机包、未发布，也未提交或推送代码。Android 的全部功能和真机性能尚不能因此宣称已完全对齐。
