# iOS 原生版 Mac 与 iPhone 验证步骤

适用版本：0.3.0 / build 4，最新配套 `IM-iOS-0.3.0-media-fixes-20261114-mac-check.zip`。Windows 已做工程静态与 Swift 语法检查，尚未执行 Xcode/Swift 编译，不将其记作 iOS 已通过。本包以现有 uni-app 的功能与 UI 为基准，仍有差异的页面见逐页清单；最新本地图片气泡、转发和更新入口见 `docs/历史图片性能优化方案-20261113/即时图片发送与原生更新-20261114.md`，前一轮修复保留于 `docs/原生功能与UI对齐-20261113/问题修复与验证-20261114.md`。

本次额外检查：键盘切换表情面板、收藏表情加载和发送；图片转发给单聊与群聊、接收方实际收到、只有真实完成才出现“转发成功”；竖横视频卡片等比展示、点击直接播放、本地与远端视频、退出停止。聊天页不应再出现本地转发任务或批次进度文案。当前 79 个 XCTest 方法尚未运行，必须执行下述 Mac 验证命令后再记录结果。

本轮优先复测：已有账号本地库同步后进入聊天，连续收发文本与图片；图片转发给自己、好友和群；长按菜单与多选；通讯录从快捷入口滑到最后一位联系人。发送结果不确定时显示“待核对”，这不是审核状态；先核对再重试，避免重复发送。记录诊断页的 SDK 数字错误码，不在公开日志中贴 token。

## 1. 准备 Mac

安装完整 Xcode 15 或以上版本，打开一次完成许可证与组件安装，在 Settings → Platforms / Components 安装一个 iOS Simulator。需要 Python 3、受维护的 Ruby（建议 3.3）和 Bundler；Gemfile 固定 CocoaPods 1.16.2。系统 Ruby 太旧时使用团队版本管理器或 Homebrew，按其安装提示设置 PATH。

```bash
sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
xcodebuild -version
swift --version
python3 --version
ruby --version
bundle --version
```

只有 `xcode-select` 切换可能需要管理员权限；不要用 sudo 向系统 Ruby 强装依赖。模拟器编译不用生产证书或付费会员。

## 2. 解压本次交接包

把 ZIP 传给朋友，在 Mac 本地工作目录解压，终端进入能看到 `IM-APP-ios`、`contracts` 和 `README-Mac.md` 的目录。包内是本次工作区源码快照，包含新增业务与媒体页面、Keychain 登录恢复、固定 SDK 依赖声明、测试与逐页清单，不包含账号、证书、后端、Android APK 和 Windows 缓存。

本次改动尚未提交，单独拉远程旧分支可能缺少本次代码。解压后保留 `HANDOFF-MANIFEST.json`，便于核对文件与结果属于同一份源码。

## 3. 一键执行可自动化检查

在解压根目录执行：

```bash
bash IM-APP-ios/scripts/verify_on_mac.sh
```

脚本依次执行环境记录、8 项工程静态检查、全部 Swift 核心测试、Bundler、固定 CocoaPods 依赖安装、无分发签名的模拟器 Debug 编译。任何一步失败立即停在该步，`verification/mac/` 保留日志与 `result.json`。日志显示的实际测试数量与失败数是验收依据，不能用源码中有多少个测试方法冒充运行通过。

首次 `pod install` 后保留 Podfile.lock；OpenIMSDK / OpenIMSDKCore 应均为 `3.8.3-hotfix.15`，不要自行改成 latest。CI 工作流存在不代表已经在远端执行。

脚本不登录、不发送消息、不发布、不上架。核心测试与模拟器编译通过后，还须执行以下 UI 和真机检查。

## 4. 手动编译和启动（需要排查时）

逐条成功后再继续：

```bash
set -o pipefail
mkdir -p verification/mac
python3 IM-APP-ios/scripts/verify_project.py 2>&1 | tee verification/mac/project-check.log
swift test --package-path IM-APP-ios/Packages/IMCore 2>&1 | tee verification/mac/core-tests.log
cd IM-APP-ios
bundle config set --local path vendor/bundle
bundle install 2>&1 | tee ../verification/mac/bundle-install.log
bundle exec pod install --repo-update 2>&1 | tee ../verification/mac/pod-install.log
xcodebuild -workspace IMNative.xcworkspace -scheme IMNative \
  -sdk iphonesimulator -configuration Debug \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath ../.native-cache/DerivedData CODE_SIGNING_ALLOWED=NO build \
  2>&1 | tee ../verification/mac/simulator-build.log
open IMNative.xcworkspace
```

必须打开 `.xcworkspace`，选择 `IMNative` Scheme 与已安装的 iPhone 模拟器，Command-R。空 TestAction 不替代单独的 `swift test`。当前 Release/Archive 有明确阻断，本阶段使用 Debug；不要为了产生 IPA 删除阻断脚本。

普通登录默认对接现有 HTTPS 后端，使用专用内测账号；原版隐藏的短信登录入口继续隐藏，注册/找回密码仍走验证码。Logo 长按中的本地样例不联网、不送达，只验证隔离的演示流程。

## 5. 连接朋友的 iPhone

iPhone 使用 iOS 15 或以上，通过 USB 连接，允许“信任此电脑”，按系统要求打开开发者模式。Xcode Settings → Accounts 添加测试用 Apple ID。Target `IMNative` → Signing & Capabilities 勾选 Automatically manage signing，选择自己的 Team、该 iPhone，点击 Run。

如果 staging Bundle ID 无法注册，仅在朋友的本地副本中改为唯一测试 ID 并记录。变更 ID 会创建另一套沙盒，不能据此验收旧 App 覆盖升级。免费个人 Team 的开发测试受设备、能力与签名有效期限制；TestFlight/APNs 需按团队开发者计划配置。先用 USB Debug，无需先导出 IPA。

用两个专用账号分别登录原生端和旧客户端，避免用客户正在使用的同平台账号触发现有互踢。真实测试会写现有服务；本轮不需要部署后端。

## 6. 按旧版逐页验收

| 范围 | 操作与检查 |
| --- | --- |
| UI 与返回 | 同机对照旧版通讯录/聊天/我的、各子页面；核对图标、文字、间距、菜单、返回位置、键盘和空/错状态；不能只看首页 |
| 认证 | 密码登录、注册/找回、协议与区号、完善资料、退出；杀进程后 Keychain 恢复；失效凭据与离线错误有明确提示，不删除消息库 |
| 图片与头像 | 历史签名图片、稳定代理地址、群头像、个人头像；列表滚动、图片预览/缩放/保存；图片权限拒绝与网络失败可重试 |
| 真实收发 | 原生与旧端双向文本、图片、视频、语音、文件、名片、表情；接收端不能依赖发送者本地路径；已提交不冒充对端已读 |
| 历史与群规则 | 多页历史无重复/跳漏；水位限制、成员清除记录、撤回/删除/引用/转发/收藏、已读与置顶；不可重新露出无权查看的旧消息 |
| 通讯录与群 | 搜索/分页/排序、申请与标签、扫码、建群/邀请、管理权限/公告/禁言/入群审核；分别覆盖群主/管理员/普通成员 |
| 设置 | 回车发送实际生效；隐私设置保存失败恢复；清图片缓存保留聊天/待发；清历史有明确范围与确认；群发失败不自动重复发送 |
| 断网恢复 | 会话中飞行模式→恢复；消息/历史保留，错误不冒充空历史；重连后继续同步与收发 |
| 待发中断 | 发送时断网/强杀，再开同账号；先核对 clientMsgID，不盲重发，待核对状态保留 |
| 锁屏/后台 | 锁屏期间另一账号发消息，解锁回前台；恢复同步、开库正常，不自动清库 |
| 重启首次解锁 | 重启 iPhone，首次解锁后打开，检查文件保护和同账号本地状态恢复 |
| 账号切换 | A→退出→B→A；无串号，A 的本地历史和未决发送没有被退出删除 |
| 长历史性能 | 大量真实历史、多媒体列表滚动、快速进出页面；用 Instruments Time Profiler/Allocations 和 Xcode Memory 记录卡顿、CPU、峰值内存及崩溃，不凭主观感受宣称达标 |

不要用卸载重装代替强杀恢复，卸载会删沙盒。现有 `LoggingPushService` 只记日志，登记 Token 不等于 APNs 真下发；杀进程推送、实时音视频、旧版覆盖升级、定制协议和性能规模分别验收，不能用前台收到消息代替后台推送测试。

## 7. 回传证据

提供 Mac 芯片、macOS/Xcode/Ruby、iPhone/模拟器型号与 iOS 版本；`verification/mac/` 日志、Podfile.lock/Gemfile.lock；逐项通过/失败/未测；失败操作顺序、时间、错误码、截图。编译错误提供完整上下文，崩溃从 Xcode Devices and Simulators → View Device Logs 导出。

去掉密码、Token、手机号和私人聊天正文；不发送 Apple ID 密码、签名私钥。模拟器构建成功只证明能构建，iOS 本地库与同步是否改善必须以 iPhone 的真实 SDK、故障恢复和数据规模结果判断。


## 2026-11-14 追加验收：菜单与录像

- 逐项点击图片/视频长按菜单：撤回、转发、引用、保存、加入表情、收藏、置顶、删除及多选。确认真实接口结果，撤回超时等服务端拒绝仍应显示失败。
- 成功和错误短提示应在窗口中间约 3 秒后消失，无顶部固定操作提示；删除、收藏、撤回的确认框仍需确认。
- 相册/录像确认后，应先出现本地准备占位；封面生成和上传在后台。断网时不可提前显示发送成功，结果不明不可盲目重发。
- 本机视频复制完成后点击占位应播放本地文件；发送 ACK 后、退出重进及应用重启后仍检查本机副本，不能额外下载同一视频。
- 同时覆盖大视频、无封面/无时长、上传失败、账号切换、后台恢复、照片/iCloud 权限。首帧、封面就绪、上传 ACK 分别计时；不把约 1 秒的目标当已测结果。
