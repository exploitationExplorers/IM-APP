# 在新 Mac 上验证 iOS 原生版

更新日期：2026-11-15。工程：Swift / UIKit，iOS 15 起；版本 `0.3.0 (4)`，测试 Bundle ID `com.im.nativebootstrap.staging`。配套源码包：`IM-iOS-0.3.0-startup-20261115-mac.zip`。

这份文档可以交给 Mac 上有终端和文件访问能力的 AI 执行。最短流程：安装 Xcode → 解压源码 → 在 AI 中打开解压目录 → 发送同目录的《给Mac端AI的iOS验证指令.md》。AI 可以准备依赖、测试、编译和安装模拟器；Apple ID 登录、管理员密码、iPhone 信任和真机触摸操作由你完成。

## 1. 你先准备这几样

1. 在 Mac App Store 安装**完整 Xcode**，使用这台 Mac 的 macOS 能支持的稳定版本。最低需要支持 Swift 5.9 的 Xcode 15；iPhone 系统比 Xcode 支持的新时，升级到支持该 iOS 的 Xcode/macOS。
2. 打开 Xcode 一次，按引导完成许可证、附加组件安装。在 Xcode → Settings → Components（部分版本叫 Platforms）安装一个 iOS Simulator runtime。
3. 下载并传到 Mac：`IM-iOS-0.3.0-startup-20261115-mac.zip`。用 Finder 解压到例如 `~/Developer/IM-iOS-0.3.0-startup-20261115-mac`，不放 iCloud 自动同步目录。
4. 在 Mac 的 Codex 或其他具备本地终端能力的 AI 中打开这个文件夹。网页聊天 AI 只能指导，不能直接替你运行终端。
5. 首轮模拟器编译不需要付费 Apple Developer 会员，也不需要后端部署。后面测 iPhone 再准备 Apple ID、USB 线和专用内测账号。

解压后正确的根目录应包含：

```text
README-Mac.md
HANDOFF-MANIFEST.json
IM-APP-ios/
  IMNative.xcodeproj/
  IMNative/
  Packages/IMCore/
  Podfile
  Gemfile
  scripts/verify_on_mac.sh
contracts/
docs/
  iOS-Mac验证步骤.md
  给Mac端AI的iOS验证指令.md
```

本包是当前工作区源码快照，不是 IPA，不包含账号、证书、Pods 和构建缓存；只拉远程旧分支可能缺少本轮修改。iOS 最新代码已做语法和工程静态检查，**尚未在 Xcode 编译或在 iPhone 运行**，第一次 Mac 编译可能发现需要继续修复的类型或链接错误。

## 2. 检查环境和交接文件

打开终端，输入 `cd ` 后把解压文件夹拖进终端，再回车。确认当前目录有 `IM-APP-ios`，执行：

```bash
pwd
uname -m
sw_vers
xcode-select -p
xcodebuild -version
xcrun swift --version
python3 --version
ruby --version
bundle --version
```

如果开发目录指向 `CommandLineTools`，切换到实际安装的 Xcode；下面假设应用名为 Xcode.app：

```bash
sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
```

管理员密码由你在 Mac 系统提示中输入。许可证或首次组件未完成时，先打开 Xcode 完成引导，不让 AI读取或保存密码。

验证 ZIP 内各文件与 manifest 一致，须在**修改源码前**执行：

```bash
python3 - <<'PY'
import hashlib, json
from pathlib import Path
root = Path.cwd().resolve()
manifest = json.loads((root / 'HANDOFF-MANIFEST.json').read_text())
for item in manifest['files']:
    path = (root / item['path']).resolve()
    if root not in path.parents:
        raise SystemExit('Manifest path outside source root')
    if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != item['sha256']:
        raise SystemExit('Source mismatch: ' + item['path'])
print('Source manifest verified:', len(manifest['files']), 'files')
PY
```

若有不匹配，先区分传输损坏和你在 Mac 上已有的修改，不能为通过检查覆盖已有开发内容。AI 修复后保留修改记录，原 manifest 仅代表收到的源码快照，不重新伪装为原始快照。

## 3. 安装 Ruby / Bundler 依赖

需要 Python 3、受维护的 Ruby 和 Bundler，建议 Ruby 3.3。Gemfile 已固定 CocoaPods `1.16.2`。先检查已有版本，不重复安装，不使用 `sudo gem install` 修改系统 Ruby。

如果已用 Homebrew 管理环境但没有合适的 Ruby：

```bash
brew install ruby@3.3
export PATH="$(brew --prefix ruby@3.3)/bin:$PATH"
ruby --version
gem install bundler --no-document
bundle --version
```

上面的 PATH 只对当前终端生效；换终端需重新设置，确认正常后可由 AI 按当前 shell 配置持久 PATH。如果没有 Homebrew，由你按 Homebrew 官方安装说明安装，或让 AI 使用现有 Ruby 版本管理器。涉及系统密码时你自己操作，不把密码发给 AI。Python 3 缺失时同样使用已有工具安装，避免同时维护多套环境。

Apple Silicon 优先使用原生 arm64 工具链；不要一开始就开 Rosetta 或全局排除 arm64，只有实际 SDK 架构诊断证明必要时才做局部调整。

## 4. 一键测试与编译

在解压根目录执行：

```bash
bash IM-APP-ios/scripts/verify_on_mac.sh
```

脚本依次执行：环境记录 → 工程静态检查 → `IMCore` 全部 Swift 测试 → Bundler → CocoaPods → 不带分发签名的模拟器 Debug 构建。失败即停，不继续假报成功。日志位于 `verification/mac/`，总结果为 `verification/mac/result.json`；保留失败日志，修复后再运行。

固定依赖：

- OpenIMSDK：`3.8.3-hotfix.15`。
- OpenIMSDKCore：`3.8.3-hotfix.15`。
- CocoaPods：`1.16.2`。

首次安装成功后保留 `IM-APP-ios/Podfile.lock`、`Gemfile.lock`。不要为让编译变绿自动升级 SDK 或修改为 latest。

成功标准：实际核心测试 0 失败，模拟器日志出现 `BUILD SUCCEEDED`，`result.json` 的 `status` 为 `passed`。当前有 90 个 XCTest 方法的源码计数，**实际运行数量以 Mac 测试日志为准**。这一步不包含 UI 自动化、真机 SDK 同步、真实收发或 APNs。

需要单独定位失败时，按阶段执行：

```bash
# 在解压根目录
set -o pipefail
mkdir -p verification/mac
python3 IM-APP-ios/scripts/verify_project.py 2>&1 | tee verification/mac/project-check.log
swift test --package-path IM-APP-ios/Packages/IMCore 2>&1 | tee verification/mac/core-tests.log
```

上一步成功后，再安装依赖和构建：

```bash
cd IM-APP-ios
bundle config set --local path vendor/bundle
bundle install
bundle exec pod install --repo-update
xcodebuild -workspace IMNative.xcworkspace -scheme IMNative   -sdk iphonesimulator -configuration Debug   -destination 'generic/platform=iOS Simulator'   -derivedDataPath ../.native-cache/DerivedData   CODE_SIGNING_ALLOWED=NO build
cd ..
```

这份精简手动命令用于排查；需要完整日志时优先运行一键脚本。Scheme 当前没有 App XCTest target，不能把 `xcodebuild test` 的空 TestAction 当核心测试执行；核心测试用上面的 `swift test`。

## 5. 在模拟器里打开 App

最方便的方法：

```bash
open IM-APP-ios/IMNative.xcworkspace
```

在 Xcode 顶部选择 Scheme `IMNative` 和已安装的 iPhone Simulator，按 `Command-R`。**打开 .xcworkspace，不是单独打开 .xcodeproj**。模拟器阶段不选真机，不填写生产证书。

AI 也可用命令启动。先列设备，选一个 available 的 iPhone UUID：

```bash
xcrun simctl list devices available
```

把下面 UUID 替换为实际设备值；如果设备已经 Booted，跳过 boot：

```bash
task_sim_udid="替换为实际模拟器UUID"
xcrun simctl boot "$task_sim_udid"
xcrun simctl bootstatus "$task_sim_udid" -b
open -a Simulator
xcrun simctl install "$task_sim_udid" .native-cache/DerivedData/Build/Products/Debug-iphonesimulator/IMNative.app
xcrun simctl launch "$task_sim_udid" com.im.nativebootstrap.staging
xcrun simctl io "$task_sim_udid" screenshot verification/mac/simulator-launch.png
```

如果 generic build 产物不能安装，先检查设备 runtime/架构，再用 `-destination "platform=iOS Simulator,id=$task_sim_udid"` 对选定模拟器重新构建，沿用相同 DerivedData；不能通过移除聊天 SDK 来回避链接问题。

先检查启动、登录表单、协议、返回、键盘、表情面板、列表布局及短提示。Logo 长按里的本地样例不联网、不送达，不能拿样例聊天成功证明真实 SDK 已通。

## 6. USB 安装到你的 iPhone

1. iPhone 用 USB 连 Mac，在手机上选择“信任”，按系统要求输入手机密码。iOS 16 及以上如要求，打开 设置 → 隐私与安全性 → 开发者模式并重启确认。
2. Xcode → Settings → Accounts 添加你的测试 Apple ID；账号登录和双重验证由你完成。
3. 打开 workspace，Target `IMNative` → Signing & Capabilities → Automatically manage signing，选择自己的 Team；顶部运行目标改为你的 iPhone。
4. 用 **Debug / Run**，按 `Command-R`。首次构建可能需要 Xcode 下载对应 Device Support。
5. 如果手机提示未受信任的开发者，按系统提示到“VPN 与设备管理”等相应入口信任。记录 Xcode/macOS/iPhone/iOS 版本和本次 Bundle ID。

若现有测试 Bundle ID 无法由你的 Team 注册，可在本地测试副本用唯一 ID（例如 `com.yourteam.imnative.dev`）运行，但要记录变更。更换 Bundle ID 会新建沙盒，**不能拿它证明覆盖升级保留本地库**。静态检查固定了 staging 身份；因本地签名更换 ID 产生的检查差异要如实记录，不能删检查冒充原身份通过。

免费个人 Team 可用于受限制的 USB 开发测试，签名/能力/有效期受 Apple 限制；个人免费签名通常需约 7 天重新运行安装。App 测试不等于可以发给所有人安装。TestFlight/正式分发后续使用开发者团队配置；本轮不需要导出 IPA。

工程目前有 Release/Archive 阻断，验证期间保留它，不能为得到安装包删掉阻断。新版原生 iOS 使用 Xcode 构建，与 uni-app 云打包无关。

## 7. 真机优先验收：本地库、历史与媒体

普通登录默认对接现有 HTTPS 后端，不需要启动本地后端。使用专用内测账号和测试群；测试消息、隐私设置会写现有服务，不动客户日常账号。同账号同平台双开可能互踢，互通测试用 A/B 两个专用账号。账号在设备上输入，密码和 Token 不放指令或日志。

按下面顺序测，每项标记通过、失败或未测，并保存证据：

| 编号 | 操作 | 预期与记录 |
| --- | --- | --- |
| P0-01 | 联网首次登录，等待同步；打开已有长历史会话 | 真实 SDK 成功开库，记录同步完成/失败时间和数字错误码，无自动清库 |
| P0-02 | 连续上滑 5～10 页，快速往返最新与旧记录 | 自动预读，无“点击加载更早”按钮、重复和漏消息，追加旧页不把阅读位置拉走 |
| P0-03 | 先实际浏览文字和缓存图片，再强杀 App，开启飞行模式重启 | 同账号已有本地资料/会话/文字/缓存图片可读；记录首屏耗时；从未下载的媒体不要求离线可见 |
| P0-04 | 恢复网络，另一专用账号发送新消息，再进入前台 | 正常增量同步，无重复收发、历史清空、长时间卡住；失败保留数据和诊断 |
| P0-05 | 发送文本、图片、横竖视频，点本机视频 | 图片/视频先出现本地气泡和 loading，封面比例正确；本机副本可播放；发送状态依据真实 ACK，不冒充已读 |
| P0-06 | A 发图片/视频给 B，B 实际查看和播放 | 接收端拿到远程资源，不依赖 A 的本地路径；记录上传、封面、播放各耗时 |
| P0-07 | 分别转图片和视频给 1 人、4 人、测试群 | 接收方逐一检查收到和播放，失败/未知不假报成功，不整批盲重发。iOS 多人视频仍走原服务端批量路径，不能套用 Android 0.3.7 的通过结论 |
| P0-08 | 发送中断网/强杀，再开 | 未决结果先按 ID 核对，不自动重复发送；记录待核对与 SDK 错误码 |
| P1-01 | 会话有 1、52、100+ 未读，另开免打扰会话 | 普通小红圆、99+；免打扰小点，聊天 Tab 总未读；已读后更新 |
| P1-02 | 通讯录滚动多页、搜索、返回 | 联系人标题不变为 0，数量与接口/已加载数据一致，快捷入口和群卡同列表滚动 |
| P1-03 | 两个隐私开关分别关/开，退出再进；模拟保存失败 | 两开关始终可见，修改一项不改变另一项，保存后回读正确、失败保值 |
| P1-04 | 图片/视频/文字长按及多选菜单逐项操作 | 撤回、引用、转发、收藏、置顶、删除、保存等按权限执行；短提示居中自动消失 |
| P1-05 | A→退出→B→A，锁屏后台再恢复，重启手机首次解锁 | 不串号，A 本地历史和未决状态保留；前后台同步正常 |
| P1-06 | 管理员清理群历史/成员消息，再刷新和离线重启 | 保留业务可见边界，迟到历史不能复活已隐藏内容；未知边界不放开历史 |
| P1-07 | 冷启动会话页，再同步、分页和更新已读状态 | 同时间、同置顶状态的已有会话不换序；真实新消息及置顶仍正确移动，未变化内容不整表重刷 |
| P1-08 | 添加管理员页长名单、搜索、勾选和返回 | 头像及圆形选框完整，搜索保留选择，底部确认始终可用；只操作指定测试群 |

不要用“卸载重装”代替“强杀重开”。同一原生 Bundle ID、Team、设备上覆盖 Run 后再测断网，才是原生沙盒保留测试；当前 staging 包不能覆盖旧正式 uni-app，也未证明旧版 uni-app 数据迁移成功。

本机票据需要先联网成功登录保存一次。旧快照未保存 SDK 票据时，不能直接跳过首次联网要求。图片已下载、有缓存字节、从未下载、缓存被清理/损坏应分开记录。

## 8. 性能与当前未验收范围

核心问题在 iOS 本地库同步，至少用一台真实 iPhone 和真实长期测试账号验证，模拟器跑通不等于真机通过。记录手机型号、系统、消息数量级、网络条件、进入会话到文字/图片出现的时间、同步时长、快速滚动卡顿和内存。

先用 Debug 的 Xcode Memory Gauge 与运行日志定位问题；需要 Instruments Time Profiler / Allocations 时，以本地 Debug 构建 Attach 到运行进程。当前 Scheme 的 Profile 指向 Release，会触发现有阻断，不能为测性能偷偷删除阻断。不要把 Debug 的单次时间当发布版本性能指标。

现有后端 APNs 服务是日志实现；登记推送 Token 不等于后台真正下发。杀进程推送、实时音视频、正式签名分发、旧版迁移分别列未测/未接通，不能用前台收到消息替代推送验证。

## 9. 失败时交给 AI 怎么处理

- 环境/许可证问题：先修环境，保留原源码，不无依据修改 SDK 版本。
- Swift 编译/ObjC selector/链接错误：保存首个根错误上下文，做最小兼容修复，重跑受影响测试和构建；不要用 SDK 替身、注释业务或跳过测试让日志变绿。
- Pods 网络失败：区分 DNS、代理、证书、版本不存在与架构错误，保留完整日志，不反复删整个项目或清消息库。
- 真机签名/信任：让你完成账号或系统弹窗；不读取 Keychain 私钥、不上传证书。
- 本地库/消息问题：保留沙盒和错误码，先查账号/环境/SDK 生命周期/回调代次，不卸载、不删库、不直接改 SDK 私有表、不盲重发未知消息。
- AI 没有 GUI/设备控制能力：继续做测试和编译，把具体手动页面、操作与预期列给你，不把未执行动作标通过。

## 10. 回传什么

将 `verification/mac/`、依赖锁文件、AI 修改的文件/差异及下表结果交回；日志先去掉密码、Token、手机号和私人聊天正文。不要回传签名证书、私钥、Apple ID 密码或整个带账号数据的沙盒。

```text
Mac 芯片 / macOS / Xcode：
iPhone 型号 / iOS / Bundle ID / Team 是否一致：
源码包名 / manifest 核对结果：
核心测试：实际执行 __ 项，通过 __，失败 __。
模拟器构建 / 启动：通过 / 失败 / 未测。
iPhone Debug 安装 / 首次登录：通过 / 失败 / 未测。
P0-01 ～ P0-08：逐项结果、证据路径。
P1-01 ～ P1-08：逐项结果、证据路径。
主要失败：复现顺序、时间、SDK 数字码、首个错误上下文。
AI 修改：文件、原因、验证结果。
仍未测 / 阻塞项：
```

最后由 AI 在 `verification/mac/AI-验证结果.md` 汇总实际结果。`result.json=passed` 只代表脚本内核心测试与模拟器编译，不代表上表真机功能全部通过。
