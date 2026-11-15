# Mac 新机环境与 Git 协作：iOS 原生开发 AI 交接

编写日期：2026-11-14。适用于易可聊 IM 项目的原生 iOS 工程。本文可以单独发给 Mac 上的 AI，作为首次环境搭建和编译验证任务书。

## 1. 给 Mac 上 AI 的任务

请检查这台 Mac，补齐必要开发环境，从指定 Git 仓库取得正确代码，执行项目已有检查和 Xcode 编译，再协助连接 iPhone 做 Debug 验证。已有且兼容的工具直接复用。每个阶段记录实际结果，失败时保留日志并定位原因。

执行顺序：

1. 检测 Mac 芯片、macOS、磁盘和已安装工具，选择兼容的完整 Xcode。
2. 安装缺少的工具，完成 GitHub 认证。
3. 克隆或更新原生开发分支，与 Windows 提供的提交号核对。
4. 安装固定依赖，运行静态检查、Swift 核心测试和模拟器 Debug 编译。
5. 在模拟器运行，再用 iPhone 验证真实账号、历史消息和媒体。
6. 回传环境、Git 提交号、构建日志、测试结果以及剩余问题。

Apple ID 登录、管理员密码、许可证确认和设备信任由电脑主人在本机完成，不要求对方把密码发到聊天中。其他正常检查与可逆修复持续完成，不必每一步都请求确认。本次任务是搭建和开发验证；正式发布另行安排。

## 2. 两台电脑如何共用 Git

**可以共同使用同一个 GitHub 仓库。Windows 和 Mac 各有自己的本地克隆，通过 commit、push、fetch、pull 交换代码。** Git 软件、工作目录和本地构建环境分别安装。

```text
Windows 本地代码  ←→  GitHub 同一个远程仓库  ←→  Mac 本地代码
Android / 后端等                              iOS / Xcode / iPhone
```

不需要让 Mac 远程读取 Windows 的 `.git`，也不要用网盘或共享磁盘让两台电脑同时操作同一个工作目录。Windows 的 Xcode 编译能力无法通过 Git 转移到 Mac；Mac 需要自己的开发工具和依赖。

本次确认的信息：

| 项目 | 值 |
| --- | --- |
| Git 远程地址 | `https://github.com/exploitationExplorers/IM-APP.git` |
| 当前原生开发分支 | `codex/native-bootstrap` |
| 编写时 Windows 本地 HEAD | `5aa6d69`，`feat: 新架构` |
| 原生 iOS 目录 | `IM-APP-ios/` |
| 建议的 Mac 本地目录 | `~/Developer/IM-APP` |

**重要：编写本文时 Windows 工作区存在大量未提交的 iOS、Android 等改动。上面的 HEAD 不能代表这些改动，也没有在本次交接中联网核验远程最新状态。Git 只能同步已提交且已推送的内容。**

### 2.1 Windows 首次交接前

在 Windows 仓库中检查：

```powershell
cd D:\jiedan\IM
git status --short
git branch --show-current
git diff --stat
git diff --cached --stat
```

由 Windows 端开发者确认本次要交给 Mac 的完整代码范围，选择性暂存相关修改和新增文件。必须包含这些修改依赖的新文件，不能只暂存已有文件的一部分而漏掉依赖。不要直接 `git add .` 收入整个工作区。

检查暂存区后再提交和推送，以下命令只用于已经确认好的交接内容：

```powershell
git diff --cached --name-status
git diff --cached
git commit -m "chore: 同步 iOS 原生 Mac 验证源码与交接文档"
git push origin codex/native-bootstrap
git rev-parse HEAD
```

将最后得到的完整提交号发给 Mac 端 AI。上面的提交信息可按实际改动调整。推送成功后再通知 Mac 拉取；本文件的生成操作本身没有执行提交或推送。

仓库不需要额外加入账号密码、`.env`、私钥、证书或客户聊天数据。已有历史敏感文件也不应被复制到交接报告中。未准备好推送时，可按第 10 节使用源码 ZIP 临时验证。

## 3. 先识别这台二手 Mac

“2022 年的 Mac”不足以确定是 Intel 还是 Apple Silicon，也不能确定支持哪个最新 macOS。先执行：

```bash
uname -m
sw_vers
system_profiler SPHardwareDataType
df -h /
command -v git xcodebuild swift brew ruby bundle python3 gh
```

`arm64` 通常表示 Apple Silicon；`x86_64` 可能是 Intel，也可能是 Apple Silicon 正在使用 Rosetta 终端，应结合硬件信息确认。硬件输出中的序列号不放入公开报告。

建议为 Xcode、模拟器、Pods 和构建缓存预留约 60–100 GB 可用空间，实际取决于安装版本和模拟器数量。先确认能正常使用自己的管理员账户和 Apple ID；二手设备若仍受原机主激活锁或组织远程管理限制，先联系卖家处理。

选择 Xcode 时同时检查：

- 这台 Mac 能安装的 macOS 是否支持该 Xcode。
- 项目需要 Swift 5.9 工具链，Xcode 15 是最低工具基线；实际优先选当前 macOS 支持、且支持目标 iPhone 系统的稳定版本。
- 项目最低部署版本是 iOS 15，**这不表示 Xcode 15 能连接任意更新系统的 iPhone**。真机系统较新时，可能需要更新 Xcode 和 macOS。

以 Apple 的实时兼容表为准：<https://developer.apple.com/support/xcode/>。不要仅按本文日期猜测应该装哪个最新版本。

## 4. 安装必要开发工具

| 工具 | 用途与要求 |
| --- | --- |
| 完整 Xcode | 编译、Swift 工具链、模拟器、真机调试；只装 Command Line Tools 不够 |
| Git | 通常可使用 Xcode 提供的版本 |
| Homebrew | 本文推荐的工具安装方式；已有合适的版本管理方案可继续使用 |
| Ruby 与 Bundler | 运行项目 Gemfile；优先 Ruby 3.3 的受维护补丁版本，与现有 CI 对齐 |
| CocoaPods | 由项目 Bundler 安装，固定 `1.16.2` |
| Python 3 | 项目检查和验证报告脚本；建议 3.10 或以上 |
| GitHub CLI（`gh`） | 推荐用于浏览器登录和 Git HTTPS 认证，也可使用已有凭据管理方式 |

首次只验证 iOS，**无需先安装 Node.js、HBuilderX、Android Studio、Java、Go、Docker、MySQL 或 Redis**。项目默认连接已有后端。以后确实要运行旧前端或本地后端时，再按各自工程说明安装。

### 4.1 完整 Xcode

通过 Mac App Store 或 Apple Developer 官方下载渠道安装兼容版本。首次打开 Xcode，完成许可证确认、额外组件安装，并在 Settings 的 Platforms / Components 中安装一个兼容的 iOS Simulator Runtime。菜单名称随 Xcode 版本略有不同。

假设安装位置为 `/Applications/Xcode.app`，选择工具链：

```bash
sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -runFirstLaunch
xcode-select -p
xcodebuild -version
swift --version
git --version
```

若安装了多个 Xcode，应使用实际选定的 App 路径。若提示许可证未接受，先让本人阅读并确认。若路径仍是 `/Library/Developer/CommandLineTools`，说明尚未切换到完整 Xcode。

### 4.2 Homebrew

先检查 `brew --version`。没有安装时，按官方说明执行：<https://brew.sh/>。当前官方安装命令为：

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

按安装器的 Next steps 设置 shell 环境。Apple Silicon 通常在 `/opt/homebrew`，Intel 通常在 `/usr/local`。优先使用与芯片匹配的原生终端，不默认切 Rosetta。

若已安装但当前终端找不到 `brew`，可按实际存在的路径加载：

```bash
if [ -x /opt/homebrew/bin/brew ]; then
  eval "$(/opt/homebrew/bin/brew shellenv)"
elif [ -x /usr/local/bin/brew ]; then
  eval "$(/usr/local/bin/brew shellenv)"
fi
brew --version
```

### 4.3 Ruby、Bundler、Python 和 GitHub CLI

先检查现有版本，兼容则复用。以下是采用 Homebrew 的安装示例；先通过 `brew info ruby@3.3` 确认该版本仍可安装。若不可用，由 Mac AI 选择与 CocoaPods 1.16.2 兼容的受维护 Ruby，记录选择依据，不盲目升级项目 SDK。

```bash
brew info ruby@3.3
brew install ruby@3.3 python gh
task_ruby_prefix="$(brew --prefix ruby@3.3)"
export PATH="$task_ruby_prefix/bin:$PATH"
ruby --version
gem install bundler --no-document
export PATH="$(ruby -r rubygems -e 'puts Gem.bindir'):$PATH"
bundle --version
python3 --version
gh --version
```

如仓库后来已有 `Gemfile.lock`，应按其 `BUNDLED WITH` 安装对应的 Bundler，避免无理由改锁文件。不要使用 `sudo gem install` 向 macOS 系统 Ruby 强装 CocoaPods。

确认无误后，由 Mac AI 检查并将需要的 Homebrew、Ruby 和 gem 可执行目录配置写入 `~/.zprofile`，不要重复追加。采用上面 Ruby 方案时，可参考以下配置内容；这是配置片段，不是要求重复覆盖整个文件：

```bash
if [ -x /opt/homebrew/bin/brew ]; then
  eval "$(/opt/homebrew/bin/brew shellenv)"
elif [ -x /usr/local/bin/brew ]; then
  eval "$(/usr/local/bin/brew shellenv)"
fi
if command -v brew >/dev/null 2>&1; then
  task_ruby_prefix="$(brew --prefix ruby@3.3 2>/dev/null)"
  if [ -n "$task_ruby_prefix" ] && [ -x "$task_ruby_prefix/bin/ruby" ]; then
    export PATH="$task_ruby_prefix/bin:$PATH"
    export PATH="$(ruby -r rubygems -e 'puts Gem.bindir'):$PATH"
  fi
fi
```

重新打开终端再确认 `which ruby`、`ruby --version`、`bundle --version`、`python3 --version`。如果实际采用其他 Ruby 管理器，使用对应配置，不再混加上述 Ruby 路径。

## 5. 在 Mac 登录 GitHub 并拉取代码

### 5.1 认证

使用对该仓库有访问权限的 GitHub 账号，可以与 Windows 使用同一个账号；Mac 自己完成设备认证。推荐 HTTPS 浏览器登录：

```bash
gh auth login --hostname github.com --git-protocol https --web
gh auth setup-git
gh auth status
```

浏览器授权由本人完成。不需要复制 Windows 的 SSH 私钥，也不要把 Token 写进 Git 远程 URL。若已有 SSH 方案可继续使用，但 Mac 应使用自己生成并登记的密钥。

### 5.2 首次克隆

以下命令用于目标目录尚不存在的情况；已有仓库时先检查其 `git status` 和 `git remote -v`，不要覆盖：

```bash
mkdir -p ~/Developer
cd ~/Developer
git clone --branch codex/native-bootstrap https://github.com/exploitationExplorers/IM-APP.git IM-APP
cd IM-APP
git config --local core.autocrlf input
git remote -v
git branch -vv
git status --short
git rev-parse HEAD
```

首次提交前检查 `git config user.name` 和 `git config user.email`，使用主人确认的身份或 GitHub 提供的 noreply 邮箱，按仓库设置 `--local` 配置；不要编造提交人。

**将完整 HEAD 与 Windows 本次交接的提交号核对。** 若 Windows 此后又推送了更新，确认本次验收目标，报告实际测试的 SHA。不要默认拉 `main`，也不要硬把代码回退到本文中的历史 HEAD。

### 5.3 已有克隆的更新

在对应分支、工作区干净时执行：

```bash
cd ~/Developer/IM-APP
git status --short
git fetch origin
git pull --ff-only
git rev-parse HEAD
```

存在未提交修改或分支分叉时，先检查 diff 并保留本地工作，再处理同步。不要通过 `reset --hard`、覆盖目录或强制推送来省略冲突处理。

## 6. 认清项目目录和固定依赖

| 路径 | 本次用途 |
| --- | --- |
| `IM-APP-ios/IMNative/` | Swift / UIKit 页面和业务、Objective-C SDK bridge |
| `IM-APP-ios/IMNative.xcodeproj/` | 已提交的 Xcode 工程，无需 XcodeGen 生成 |
| `IM-APP-ios/Packages/IMCore/` | 本地 Swift Package 与核心测试 |
| `IM-APP-ios/Podfile`、`Gemfile` | 固定 SDK 与 CocoaPods 工具版本 |
| `contracts/native-bootstrap/v1/` | SDK、接口和现有后端端点契约 |
| `contracts/ui-parity/v1/` | 页面映射和旧版 UI 对齐依据 |
| `IM-APP-fronend/` | 旧 uni-app 工程，本次仅作为功能、样式和媒体兼容参考 |
| `docs/iOS-Mac验证步骤.md` | 更详细的 UI、媒体和真机验收清单 |

编写时版本为 `0.3.0 (4)`，最低 iOS 15，测试 Bundle ID 为 `com.im.nativebootstrap.staging`。后续若已正常升级，以本次拉取的工程为准。

当前固定依赖：

- CocoaPods：`1.16.2`，通过项目 `Gemfile` 使用。
- `OpenIMSDK`：`3.8.3-hotfix.15`。
- `OpenIMSDKCore`：`3.8.3-hotfix.15`。
- 版本依据：`contracts/native-bootstrap/v1/sdk-dependencies.json` 与 `IM-APP-ios/Podfile`。

原生 iOS 的 Swift、Objective-C 和 SDK 变更需要重新编译 App。**本工程不使用 HBuilderX 云打包，也不能靠 WGT 更新这些原生代码。**

## 7. 安装依赖、测试和模拟器编译

### 7.1 推荐：运行现有验证脚本

工具准备好、代码版本核对后，在仓库根目录执行：

```bash
cd ~/Developer/IM-APP
bash IM-APP-ios/scripts/verify_on_mac.sh
```

脚本依次记录环境，运行工程静态检查、`IMCore` 的 Swift 测试，安装 Bundler / CocoaPods 依赖，生成 workspace，执行无分发签名的 iOS Simulator Debug 构建。**脚本失败即停，检查失败步骤的日志，不把后续未执行步骤标为成功。**

结果在 `verification/mac/`，包括 `result.json`、`environment.log`、`project-check.log`、`core-tests.log`、`bundle-install.log`、`pod-install.log`、`simulator-build.log` 和实际生成的锁文件副本。重跑会覆盖同名日志，需要保留的失败证据先另存。

脚本成功仅表示核心测试与模拟器编译通过。报告中的真机同步、真实账号互通、发布仍是 `not_run`，不能据此声称已解决大账号 iOS 故障。Git 克隆场景下，脚本末尾若提到 `README-Mac.md`，这是 ZIP 交接包的文件名；请阅读仓库中的 `docs/iOS-Mac验证步骤.md`。

### 7.2 排查时拆开运行

只有需要定位失败时才逐条执行下面的对应步骤，无需成功后再重复全套检查：

```bash
cd ~/Developer/IM-APP
python3 IM-APP-ios/scripts/verify_project.py
swift test --package-path IM-APP-ios/Packages/IMCore
cd IM-APP-ios
bundle config set --local path vendor/bundle
bundle install
bundle exec pod --version
bundle exec pod install --repo-update
xcodebuild -list -workspace IMNative.xcworkspace
xcodebuild -workspace IMNative.xcworkspace -scheme IMNative \
  -sdk iphonesimulator -configuration Debug \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath ../.native-cache/DerivedData \
  CODE_SIGNING_ALLOWED=NO build
```

每条成功再继续。`bundle exec pod --version` 应为 `1.16.2`。`IMNative.xcworkspace` 在安装 Pods 后生成，被 Git 忽略，首次 clone 没有它是正常的。

首次生成 `IM-APP-ios/Podfile.lock`、`Gemfile.lock` 后核对固定 SDK 版本，并作为依赖锁文件正常纳入后续代码评审。已有锁文件就保留并使用；日常使用 `pod install`，不要通过 `pod update` 或删锁文件来随意改变解析结果。

`Pods/`、`vendor/bundle/`、`.bundle/`、`.build/`、DerivedData、个人 Xcode 状态和构建产物留在本机。`verification/` 日志也不要整目录提交，分享前脱敏；如需要，可在本机 `.git/info/exclude` 中加入 `/verification/`，不必为此改公共规则。

### 7.3 启动模拟器

```bash
cd ~/Developer/IM-APP
open IM-APP-ios/IMNative.xcworkspace
xcrun simctl list devices available
```

在 Xcode 选择 Scheme `IMNative`，选择已安装的具体 iPhone 模拟器，使用 Debug，按 Command-R。必须打开 `.xcworkspace`。`generic/platform=iOS Simulator` 是编译目标，真正运行时要选择具体模拟器。

核心测试用前面的 `swift test` 执行；当前 App Scheme 的空 TestAction 不能替代它。模拟器构建无需付费 Apple 开发者账号。

### 7.4 常见失败的处理方向

| 现象 | 优先检查 |
| --- | --- |
| `xcodebuild` 要求完整 Xcode | `xcode-select -p` 是否指向实际 Xcode，首次组件是否装完 |
| `bundle` / `pod` 不存在或 Ruby 太旧 | `which ruby`、gem 的 bin 路径；使用 Homebrew / 版本管理器的 Ruby 和 `bundle exec pod` |
| 找不到 workspace / `OpenIMSDK` | 是否在 `IM-APP-ios` 中成功完成 `bundle install` 和 `pod install` |
| CocoaPods / GitHub 下载失败 | 网络、代理、DNS、证书、明确版本是否存在；保留具体 URL 与错误，不能关闭 TLS 校验 |
| 模拟器目标不存在 | 安装兼容的 iOS Runtime，并选择实际存在的设备 |
| arm64 / x86_64 / 链接架构错误 | Mac 是否运行 Rosetta、Ruby 架构、SDK 是否包含目标 slice；不要直接全局排除 arm64 |
| Swift 类型、ObjC selector 或 bridge 错误 | 对照固定版本正式 SDK 修复导入和调用，保留完整编译错误，不使用 SDK 替身 |
| Release / Archive 被主动拒绝 | 见第 9 节，当前工程有明确发布阻断，先完成 Debug 验证 |

Windows 尚未做真实 Xcode 编译，首次 Mac 编译可能暴露平台问题。AI 应修复可定位的问题并重新运行受影响检查，不能只改文档把失败写成通过，也不要无依据地升级固定 SDK 或清空消息数据库。

## 8. iPhone 真机 Debug

### 8.1 连接与签名

1. 准备项目支持的 iPhone，确认所选 Xcode 支持其 iOS 版本。
2. 通过 USB 连接，手机解锁并选择“信任此电脑”；iOS 16 及以后按系统要求开启 Developer Mode。
3. 在 Xcode Settings → Accounts 添加本人或团队 Apple ID。
4. 使用 `IMNative` Scheme、Debug 配置和该 iPhone 运行。

模拟器阶段不需要 Team；真机需要开发签名。免费 Personal Team 通常可用于自己的设备 USB 调试，但有能力、设备和签名期限限制，常见需约 7 天重新签名，以 Apple 当前政策为准。TestFlight、App Store 和 APNs 等需按付费团队能力配置，不必在首次模拟器编译前完成。

**个人 Team 和临时 Bundle ID 应只在本机配置。** 当前公共工程没有写死 `DEVELOPMENT_TEAM`，而静态检查会验证这一点。优先使用命令行构建设置覆盖，避免把个人签名提交进公共工程。下面仅为真机 Debug 构建示例，将两项替换为真实值后执行：

```bash
cd ~/Developer/IM-APP
task_team_id='替换为自己的 Team ID'
task_device_udid='替换为已连接 iPhone 的 UDID'
xcodebuild -workspace IM-APP-ios/IMNative.xcworkspace -scheme IMNative \
  -configuration Debug -destination "id=$task_device_udid" \
  -derivedDataPath .native-cache/DerivedData \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM="$task_team_id" CODE_SIGN_STYLE=Automatic build
```

命令行 `build` 不等于已安装并运行；后续仍需通过 Xcode 的设备安装 / 调试流程确认手机启动。也可以直接在 Xcode 的 Signing & Capabilities 选 Team 并 Run，但它可能改动 `project.pbxproj`；提交前检查 diff，将自己的临时签名修改单独留在本地，不能覆盖其他代码修改。

若测试 Bundle ID 无法由该 Team 注册，可通过本机构建设置使用唯一测试 ID，并记录实际值。改 ID 会创建不同沙盒，**不代表旧正式 App 的覆盖升级或历史库迁移已经通过**。当前只有 `.gitignore` 中的 `Config/Local.xcconfig` 忽略项，不应假设工程已经接入该配置文件。

### 8.2 后端和测试账号

项目默认连接已有 HTTPS 后端，不需要先在 Mac 启动服务器。配置依据为 `contracts/native-bootstrap/v1/runtime-endpoints.json`。使用主人授权的内测账号，最好两个账号分别登录原生端和旧端，以便互相收发。

不要直接用正在服务客户的账号做强杀、切号、清理或发送测试；同账号同平台登录可能触发现网互踢。Logo 长按中的本地样例只验证离线 UI，不等于真实 SDK 登录、同步或送达成功。

### 8.3 首轮必须记录的验证

| 范围 | 要观察的结果 |
| --- | --- |
| 登录与恢复 | 登录、强杀后再开、凭据过期、退出再登录和 A/B 切号；不串号，不自动删库 |
| 大账号与历史分页 | 首次登录、同步进度/错误、进入会话、连续多页历史、滚动；没有卡死、重复、跳漏或错误伪装空页 |
| 旧端互通与媒体 | 文本、图片、视频、语音、文件双向收发；头像、历史图、转发、播放与保存 |
| 弱网与待发 | 断网/恢复、发送时强杀再开；不盲重发，不把 SDK 接受当作已送达 |
| 系统生命周期 | 锁屏、回前台、手机重启并首次解锁后开库；同步和历史恢复 |
| UI 与群规则 | 对照旧端菜单/键盘/表情；群权限、保留边界、撤回/删除/已读等 |
| 性能与异常 | Xcode Memory / Instruments 记录 CPU、内存、卡顿；崩溃保留设备日志和复现步骤 |

更完整的操作依据：`docs/iOS-Mac验证步骤.md` 及 `docs/原生功能与UI对齐-20261113/` 中的记录。不要用卸载重装代替强杀恢复验证，卸载会删除沙盒。真实大账号不能取得授权时，明确标为未测，并继续完成其他独立验证。

## 9. 本次编译与正式发布的区别

当前工程明确阻断 Release / Archive，用来避免正式身份、签名、SDK 兼容和迁移验收尚未完成时产出发布包。**不要为了导出 IPA 删除或绕过该 Build Phase。** 首次环境任务做到 Debug 构建、运行和真机验证即可。

后续正式分发再配置团队证书、Provisioning Profile、正式 Bundle ID、Capabilities、APNs、版本号及 App Store Connect，使用 Xcode Archive → TestFlight / App Store。`.github/workflows/native-distribution.yml` 当前是 Android 分发流程，不能当成现成的 iOS IPA 发布流程。

现有后端 `LoggingPushService` 只写日志，登记 Push Token 不能证明 APNs 已真正下发。后台推送、实时音视频、正式覆盖迁移需分别验证。仓库中的 CI 配置存在，也不表示该提交已经在远程成功运行。

## 10. 两台电脑日常协作与临时 ZIP

### 10.1 推荐日常流程

每次开始前，先检查本地修改、fetch，并在干净工作区执行 `pull --ff-only`。完成一项独立修改后选择性提交、推送，把分支名和提交号发给另一端；另一端拉取同一提交后验证。

若两端 AI 同时开发，建议按任务建立独立分支，例如 Mac 使用 `codex/ios-mac-validation`，Windows 使用自己的任务分支。新分支基于双方确认的交接提交建立；合并或 cherry-pick 时检查完整依赖，避免两边同时改同一个 Xcode 工程或共享契约。

推荐职责：Mac 负责 iOS 源码、Xcode 工程和真机验证；Windows 负责 Android / 后端等。共享接口、媒体模型、SDK 契约变更应通知另一端。修复 iOS 时继续沿用旧版 UI 和业务语义，不另起一套视觉设计。

### 10.2 Git 暂时不可用时

仓库已有 `scripts/native/prepare_mac_handoff.py` 可制作不含 Git 历史的 iOS 源码交接 ZIP，说明见 `docs/iOS-Mac验证步骤.md`。这是临时快照，**不会自动和 Windows Git 同步**。使用包内 `HANDOFF-MANIFEST.json` 核对来源，另行记录与 Git 版本的关系。

ZIP 可以包含 Windows 尚未提交的工作区源码，因此可能比远程更新；不要用较旧 Git clone 覆盖 ZIP 中的较新修复，也不要直接将 ZIP 全目录覆盖已有带本地修改的仓库。长期开发仍建议完成正常 Git 交接。

## 11. Mac AI 最终回传格式

任务结束请提供一份简洁报告，包含以下信息；真实未执行的项目明确写“未执行”：

```text
Mac：机型 / 芯片 / macOS / 可用磁盘（不含序列号）
工具：Xcode / Swift / Ruby / Bundler / CocoaPods / Python
代码：Git 远程、分支、完整提交号、是否有未提交修改
依赖：两个 OpenIM Pod 实际版本，锁文件是否新建或变更
静态检查：通过 / 失败 / 未执行，日志位置
Swift 核心测试：实际运行数量、失败数量，日志位置
模拟器：型号 / Runtime / 编译及启动结果
iPhone：机型 / iOS / 测试 Bundle ID / 签名方式 / 启动结果
真实账号互通、大账号历史、断网恢复：分别列已测结果与未测项
修复：改动文件、原因和重新验证结果
剩余问题：第一处有效错误、复现步骤、错误码、待补条件
证据：verification/mac/ 日志、锁文件、必要截图和崩溃日志
```

报告与截图不含密码、Token、Apple ID 凭据、手机号、私人聊天正文或签名私钥。编译通过、模拟器运行通过、iPhone 业务通过分别记录，Windows 的语法或文本检查不能替代 Mac 的真实结果。

## 12. 官方参考

- Xcode 版本与系统兼容：<https://developer.apple.com/support/xcode/>
- Xcode 获取与下载：<https://developer.apple.com/xcode/resources/>
- Homebrew：<https://brew.sh/>
- GitHub CLI 安装与登录：<https://cli.github.com/manual/installation>、<https://cli.github.com/manual/gh_auth_login>
- CocoaPods 与 Gemfile：<https://guides.cocoapods.org/using/a-gemfile.html>
- Apple 开发者计划比较：<https://developer.apple.com/support/compare-memberships/>

本文中的工程信息来自编写时 Windows 工作区。Mac 端开始执行时应先读取实际检出的 `AGENTS.md`、`IM-APP-ios/README.md`、依赖契约和验证脚本；后续仓库实现发生变化时，以已确认的最新代码为依据更新执行方式。
