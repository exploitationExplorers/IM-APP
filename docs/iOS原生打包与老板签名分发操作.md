# iOS 原生打包、老板签名与朋友安装操作文档

更新日期：2026-11-18。适用于本仓库 `IM-APP-ios`（Swift / UIKit），目标流程是：你在 Mac 构建 → 老板签名 → 上传服务器 → 朋友在 iPhone 安装。

你不需要拥有 iPhone，也不需要把朋友手机接到你的 Mac 才能构建。真机安装与功能验收由朋友完成。原生工程使用 Xcode；原来的 uni-app 云打包入口不能直接构建这个 Swift 工程。

## 1. 先了解本项目当前状态

| 项目 | 当前状态 |
| --- | --- |
| 工程目录 | `IM-APP-ios` |
| 打开入口 | 安装依赖后生成的 `IMNative.xcworkspace` |
| Scheme | `IMNative` |
| 最低系统 | iOS 15.0，以最终构建设置为准 |
| 当前测试 Bundle ID | `com.im.nativebootstrap.staging` |
| 依赖 | CocoaPods；版本以 Podfile、Podfile.lock、Gemfile.lock 为准 |
| 正式打包 | 工程主动阻断 Release / Archive，尚不能直接按本文导出正式 IPA |

阻断位于 `IM-APP-ios/IMNative.xcodeproj/project.pbxproj` 的构建脚本，报错文字为：

```text
Production identity, signing, SDK compatibility and migration gates are not configured. Debug simulator build only.
```

**本文提供完整操作流程，不代表发布准备已经完成，也没有修改或解除该阻断。** 第 2～4 节可以先做；第 5 节由开发负责人完成后，才能继续归档与分发。不要仅删除脚本或改用 Debug 冒充正式发布准备完成。

## 2. 先向老板确认签名方式与交付格式

将下面这段发给老板即可：

> 现在 iOS 已改为 Swift 原生工程，准备继续沿用“我构建、你签名、服务器下载”的流程。请确认：
> 1. 之前使用 Ad Hoc、企业内部分发，还是其他渠道？
> 2. 你接收 `.xcarchive`、带原签名的待重签 `.ipa`，还是完整源码？是否支持本项目的原生 Swift 应用？
> 3. 本次内测使用什么 Bundle ID、Team ID 和应用名称？是否与旧版并存？
> 4. 是否需要朋友提供 UDID？证书和描述文件由谁管理？
> 5. 旧服务器安装页和 manifest 是否可以复用？签名完成后是否由你生成安装清单？
> 6. 如果以后覆盖旧版，旧版的 Bundle ID、签名团队与 entitlement 配置能否提供给开发负责人核对？
> 7. 如果这次用的是试用企业签，请确认实际签名团队、允许分发的对象、证书与描述文件的到期时间，以及到期后的续签安排。

不要仅凭“以前能下载”判断是企业签名；也不要把所有重签服务视为同一种分发方式。

| 老板的分发方式 | 对朋友的要求 | 处理方式 |
| --- | --- | --- |
| Ad Hoc | 手机 UDID 必须包含在本次描述文件里 | 老板登记设备并生成包含该设备的 profile，再导出或重签 |
| 企业内部分发 | 仅适用于符合 Apple 企业计划条件的组织内部使用 | 由老板确认资格、适用对象和设备侧安装要求 |
| TestFlight | 外部客户通过邀请安装，首个外测构建需提交 Beta App Review，每个构建最多测试 90 天 | 通过 App Store Connect 上传，宝塔下载页可以放 TestFlight 邀请链接 |
| 尚不清楚 | 暂不能确定安装条件 | 先确认签名资料和工具，再选第 6 节交付路线 |

Ad Hoc 需要匹配应用身份、分发证书与已登记设备，Apple 官方说明见文末参考。企业分发不是面向任意朋友或公众的通用下载方式。

## 3. 每个人需要准备什么

### 你：构建负责人

- 一台能安装适用 Xcode 的 Mac；也可以使用团队 Mac 或已配置的 macOS CI。
- 当前完整源码、完整 Xcode、Python 3、受维护的 Ruby 与 Bundler。
- 老板确认的交付格式、Bundle ID、签名路径。
- 如由你导出已签名 IPA，需要团队授权、对应签名证书及私钥、描述文件；如老板自己归档导出，你可只交付源码或归档。

没有付费开发者账号时仍可做无签名模拟器验证；**Xcode 常规分发导出 IPA 需要有效签名配置**。没有账号或证书，不保证能在你这台 Mac 通过 Organizer 直接导出 IPA，改用第 6 节对应路线。

### 老板：签名负责人

- 有效的签名渠道及其适用资格。
- 匹配本次应用身份与权限的签名资料、导出或重签工具。
- Ad Hoc 场景下登记朋友的 iPhone UDID。
- 确认签名后 IPA、到期时间、安装清单与下载地址。

### 朋友：设备测试负责人

- iOS 15 或更高版本的 iPhone，并确认实际版本满足本次包的要求。
- Ad Hoc 场景向老板提供 UDID，可通过连接 Mac 的 Finder 或 Xcode 设备窗口查看；UDID 不是手机序列号或 IMEI。
- 能在 Safari 打开安装页面，有可用存储空间与网络。
- 专用测试账号，以及安装、登录、聊天和媒体测试反馈。

UDID 不代表必须把手机接到你的 Mac；可以由朋友在自己可用的电脑上获取，再交给老板。不使用来历不明的设备信息采集描述文件。

## 4. 你在 Mac 准备环境与验证源码

### 4.1 安装并初始化 Xcode

安装完整 Xcode，打开一次并完成许可与组件安装。模拟器验证需要安装 iOS Simulator runtime。Xcode 版本需支持项目和待测设备系统；如走 App Store Connect，还需满足当期上传要求。

终端检查：

```bash
xcode-select -p
xcodebuild -version
xcrun swift --version
python3 --version
ruby --version
bundle --version
```

如果 `xcode-select -p` 指向 CommandLineTools，而完整 Xcode 安装在默认位置，执行：

```bash
sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
```

缺少 Ruby / Bundler 时参考同目录《iOS-Mac验证步骤.md》的环境准备章节。避免使用系统 Ruby 随意安装项目依赖。

### 4.2 打开当前源码目录

在终端输入 `cd `，把包含 `IM-APP-ios` 的仓库根目录拖入终端，再回车。确认使用的是包含最新修改的代码；只拉远端旧提交可能缺少本地修复。

```bash
pwd
git status --short
git rev-parse HEAD
```

记录提交号；如有未提交修改，交付时另外记录修改内容。不要为获得“干净目录”丢弃现有工作。

### 4.3 运行项目已有验证脚本

在仓库根目录执行：

```bash
bash IM-APP-ios/scripts/verify_on_mac.sh
```

脚本负责环境记录、工程静态检查、IMCore 测试、依赖准备与模拟器 Debug 构建。结果和日志查看 `verification/mac/`。失败先处理错误，不继续声称可打包。

如需单独安装依赖，在仓库根目录进入 iOS 目录后执行：

```bash
cd IM-APP-ios
bundle config set --local path vendor/bundle
bundle install
bundle exec pod install
open IMNative.xcworkspace
```

已有 lock 文件应保留，不为解决安装错误随意升级 SDK。需要更新依赖索引时再按错误处理。当前 Podfile 含自维护 OpenIMSDKCore podspec，交源码时必须一并保留 `podspecs/`。

### 4.4 模拟器运行

Xcode 顶部选 `IMNative` Scheme 和一个 iPhone 模拟器，按 `Command-R`。确认启动、登录入口与主要页面正常。模拟器 `.app` 不能安装到朋友的 iPhone，不能把模拟器产物压缩改名成 IPA。

## 5. 首次分发前：开发负责人完成发布配置

这一节是代码与发布配置工作，不能只靠 Xcode 按钮完成。当前仓库尚未完成，需单独实施并复核。

1. **确定测试还是覆盖升级。** 第一轮建议采用独立测试身份，与旧 App 并存。正式覆盖前核对旧版 Bundle ID、团队、应用记录、Keychain access groups 等权限及数据兼容性；不要先卸载旧 App，以免丢失本地数据。
2. **配置应用身份。** 在 Target → General / Signing & Capabilities 核对名称、Bundle ID、Team、版本号和 Build 号。每轮交付递增 Build，避免朋友装错包。
3. **核对运行环境。** 检查 API 地址与测试账号；独立安装身份不代表连接独立后端，当前工程默认业务接口见 README。
4. **核对权限与能力。** 相机、相册、麦克风使用说明，以及实际启用的推送、Keychain、关联域名等能力，必须与签名 profile 和代码一致；只配置真实需要的能力。
5. **完成适用验收。** 检查正式 SDK、设备架构、登录恢复、收发与媒体兼容。独立内测记录尚待朋友真机确认的项目；覆盖旧版前还需迁移验证。现有后端 LoggingPushService 不等于已完成 APNs 推送。
6. **接入经过评审的 Release / Archive 流程。** 当前阻断脚本和 `scripts/verify_project.py` 中的阻断测试需要按批准后的发布流程同步维护，不能只删除脚本让测试失效。

完成后应留下可检查的配置变更、验证日志和本次允许分发的范围。没有通过这一步，下面归档命令触发阻断是预期行为。

## 6. 选择一种交给老板的方式

### 路线 A：老板有 Mac，接收源码并负责归档签名

适合你没有签名账号，也没有双方已验证的无签名归档或重签工具链时使用。

1. 交付当前源码及依赖 lock 文件，包含 `IM-APP-ios`、`contracts`、相关 `docs` 和脚本引用的其他必要文件。
2. 排除构建缓存、Pods、vendor、个人配置和签名秘密；不要只交 `.xcodeproj`，也不要误发历史备份目录当作当前工程。
3. 一并提供提交号/修改清单、版本号、Bundle ID、模拟器验证结果和本文。
4. 老板在自己的 Mac 安装依赖，打开 workspace，配置团队与 profile，按路线 B 归档导出。

如果老板接收 `.xcarchive`，按双方确定的归档签名配置生成归档后交付。归档不是可安装包，老板仍须完成有效的导出签名；不要假定任意无签名归档都能被其工具接受。

### 路线 B：你具备构建签名权限，先导出 IPA，再交给老板

这是最接近原来“我给老板一个 IPA”的流程。前提是第 5 节已完成，且你本机有可用的签名配置。

1. 打开 `IMNative.xcworkspace`。
2. 选择 Scheme `IMNative`。
3. 运行目标选择通用 iOS 设备（如 `Any iOS Device (arm64)`，名称因 Xcode 版本不同），不能选择模拟器。
4. Target → Signing & Capabilities 选择授权团队，确认 Release 的 Bundle ID 和 profile 匹配。自动签名由 Xcode 管理；手动签名按老板提供的证书和 profile 配置。
5. 点击 Product → Archive。
6. 成功后进入 Window → Organizer → Archives，选择本次归档，点击 Distribute App。
7. 选择与实际签名渠道相符的导出方式。不同 Xcode 版本可能显示 `Ad Hoc`、`Release Testing`、`Custom` 等名称，按说明确认是指定设备分发；不要把 App Store 上传包当作可直接下载的安装包。
8. 确认证书、profile、设备范围和权限，导出到单独目录。若向导提供网站分发配置，可填写最终 HTTPS 地址生成清单；否则由分发负责人另行生成。
9. 保存 `.ipa`、`.xcarchive`、dSYM（可在归档包内）和导出摘要，记录版本、Build 与构建来源。
10. 将 IPA 和交付说明发给老板。老板若需要重签，必须重新核对 Bundle ID、profile、entitlements 和嵌入组件，并验证最终签名；你原先导出的包能签名成功，不代表重签后的包也能安装。

**不要把“未签名 IPA”当成 Xcode 一定提供的标准导出选项。** 如果老板工具明确接收未签名设备构建，应由双方先验证该工具的具体构建和封装流程，包括 Swift 运行库、嵌入 framework、entitlements 与最终签名。本文不提供把任意 `.app` 压缩改名就声称能安装的命令。

### 可选：命令行归档

以下命令仅用于第 5 节已完成且 Xcode 已配置正确签名之后，在仓库根目录运行；不自动解除门禁或创建证书：

```bash
mkdir -p build/ios
xcodebuild \
  -workspace IM-APP-ios/IMNative.xcworkspace \
  -scheme IMNative \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath build/ios/IMNative.xcarchive \
  archive
```

归档成功后，先通过 Organizer 完成一次人工导出。自动导出使用该次导出生成并经核对的 `ExportOptions.plist`：

```bash
xcodebuild \
  -exportArchive \
  -archivePath build/ios/IMNative.xcarchive \
  -exportPath build/ios/export \
  -exportOptionsPlist /实际路径/ExportOptions.plist
```

替换实际路径后再执行。导出选项随 Xcode 和渠道变化，不复制占位 Team ID 或固定的过时 `method` 值。无 iPhone 不妨碍设备归档，但 SDK 必须包含所需真机架构。

## 7. 给老板的交付清单

每次发送时附上这段信息，填入本次真实值：

```text
应用：易可聊 iOS 原生内测
交付格式：IPA / xcarchive / 源码（选一项）
版本 / Build：
源码提交号及未提交修改说明：
Bundle ID：
最低 iOS：
本次用途：独立内测 / 覆盖验证
签名方式：
需包含的测试设备 UDID：通过约定的私密渠道提供
连接的后端环境：
已完成验证：
尚待朋友真机验证：
本次修改：
```

证书私钥、p12 密码和描述文件不要提交仓库。老板掌握最终签名资料时，你无需索取其全部账号和私钥。

## 8. 老板签名后检查最终 IPA

以下是有 Mac 的签名负责人可执行的基础检查，示例路径替换为真实 IPA。使用新目录，避免混入旧包：

```bash
task_ipa_dir=$(mktemp -d /tmp/im-ios-ipa.XXXXXX)
unzip /实际路径/老板签名后的应用.ipa -d "$task_ipa_dir"
```

查看解压后的 `Payload`，确定真实 `.app` 名称，再执行：

```bash
codesign --verify --deep --strict --verbose=2 /实际解压路径/Payload/实际应用.app
codesign -d --entitlements :- /实际解压路径/Payload/实际应用.app
plutil -p /实际解压路径/Payload/实际应用.app/Info.plist
security cms -D -i /实际解压路径/Payload/实际应用.app/embedded.mobileprovision
```

核对 Bundle ID、版本、Build、MinimumOSVersion、签名团队、profile 到期时间、允许的 entitlements。Ad Hoc 还需确认 `ProvisionedDevices` 包含朋友 UDID。输出含设备与团队信息，按签名资料管理，不贴到公开页面。

这些静态检查不能代替朋友实际安装；最终交付以签名后的文件为准。对最终 IPA 计算校验值并交接：

```bash
shasum -a 256 /实际路径/老板签名后的应用.ipa
```

## 9. 上传服务器与生成安装页面

如果旧服务器已经有可用的 iOS OTA 安装页，可以复用结构，但要核对本次最终 IPA、Bundle ID、版本和 manifest。**仅发一个 `.ipa` 文件下载地址，不能保证 Safari 会安装。**

通常由服务器/签名负责人准备：

```text
本次分发目录/
  index.html       安装入口
  manifest.plist   安装清单
  IMNative.ipa     老板签名后的最终包
```

给每个版本使用独立目录或文件名，避免旧 manifest 与新 IPA 混用。服务器需提供有效 HTTPS 证书，手机可访问下载资源，下载请求不能返回登录页或 HTML 错误页。按分发范围控制访问；系统安装请求也必须能获取资源，不能仅依赖浏览器现有登录会话。

以下为服务器负责人的清单示意，所有 `example.com`、包名、版本和名称都要替换为最终签名包的真实值：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>items</key>
  <array>
    <dict>
      <key>assets</key>
      <array>
        <dict>
          <key>kind</key><string>software-package</string>
          <key>url</key><string>https://example.com/ios/build-编号/IMNative.ipa</string>
        </dict>
      </array>
      <key>metadata</key>
      <dict>
        <key>bundle-identifier</key><string>最终签名包的BundleID</string>
        <key>bundle-version</key><string>最终签名包的CFBundleVersion</string>
        <key>kind</key><string>software</string>
        <key>title</key><string>易可聊内测</string>
      </dict>
    </dict>
  </array>
</dict>
</plist>
```

安装页中的按钮示例：

```html
<a href="itms-services://?action=download-manifest&amp;url=https%3A%2F%2Fexample.com%2Fios%2Fbuild-编号%2Fmanifest.plist">安装 iOS 内测版</a>
```

这里的 manifest URL 必须完整进行 URL 编码，以上只是占位示意，不是可直接部署的安装链接。服务器可为 IPA 设置 `application/octet-stream`，为 plist 设置 `application/xml`，并确认实际响应内容、HTTPS 和资源可达性。若使用签名下载 URL，XML 中的 `&` 需转义为 `&amp;`，链接有效期要覆盖安装过程。

OTA 清单只负责告诉系统从哪里安装，不能让无效证书、未授权设备或不匹配的 profile 变得可用。

### 9.1 找到旧下载页与站点目录

仓库的旧入口包括 `app/ios.html` 和 `testapp/ios.html`。前者的脚本指向根路径 `/manifest.plist`，后者使用 `/testapp/manifest.plist`，旧测试清单指向 `/testapp/app.ipa`。这些是源码中的路径，登录宝塔后再核对实际站点、域名和文件位置。第一次原生内测建议使用独立 Bundle ID 和 `/ios-native/` 目录，先与旧版并存。

1. 在宝塔的「网站」中找到旧下载域名，查看「网站目录」和「SSL」。如果用了反向代理或 CDN，也核对 `/ios-native/` 实际由哪个站点提供。若旧站只有 HTTP 或 IP，先为原生入口准备手机可访问的 HTTPS 域名和受信任证书。
2. 在站点根目录下创建 `ios-native/`。每个签名包使用独立目录，例如 `ios-native/0.3.0-15/`。`0.3.0-15` 是目录示例，发布时用最终包的版本号和 Build。
3. 先上传老板已经签好的 IPA，再上传同目录的 `manifest.plist`。清单里的 URL 指向这一版 IPA 的 HTTPS 地址，应用标识和版本取自**最终签名包**。按分发范围控制安装页和资源访问，实际安装请求也须能访问清单和 IPA。
4. 用 iPhone 验证这一版独立入口可以安装，再更新 `ios-native/index.html` 里稳定的下载按钮。对常用入口设置 `Cache-Control: no-store`，有 CDN 时刷新该入口。每版独立目录保留用于排查，避免替换正在下载的文件。

上传前后分别比较签名包的 SHA-256，确认 HTTPS 返回的文件字节与老板交付的包一致。有鉴权的站点使用实际发布方式验证，不要把下载凭据写进脚本或文档。

```bash
plutil -lint manifest.plist
shasum -a 256 IMNative.ipa
curl --fail --silent --show-error --dump-header - \
  https://download.example.com/ios-native/0.3.0-15/manifest.plist \
  --output /tmp/im-native-manifest.plist
plutil -lint /tmp/im-native-manifest.plist
curl --fail --silent --show-error --dump-header - \
  https://download.example.com/ios-native/0.3.0-15/IMNative.ipa \
  --output /tmp/im-native-download.ipa
shasum -a 256 /tmp/im-native-download.ipa
```

给服务器负责人准备站点域名、宝塔中的站点名、目标目录和上传权限即可。后续按约定使用专用权限，签名私钥留在签名负责人处。

## 10. 朋友下载安装与反馈

1. 使用 Safari 打开你发的安装页；聊天软件内置浏览器打不开时，选择在 Safari 打开。
2. 点击安装并确认，回到桌面等待完成。
3. 组织内部通过网站手动安装的企业 App，若显示「不受信任的企业级开发者」，打开「设置 → 通用 → VPN 与设备管理」，选择对应组织并按提示信任。在 iOS 18 及更新系统上，这一步可能显示「允许并重新启动」。设备需要联网完成验证。Ad Hoc 和 TestFlight 按各自安装流程进行。
4. 需要 Developer Mode 的开发签名测试包按系统提示处理；不要把它当作所有分发包通用的安装前提。
5. 打开 App，先确认显示的版本和 Build 是本次包。
6. 用专用测试账号验证登录、会话加载、文字/图片/视频/语音/文件收发、前后台切换和断网重连。
7. 首轮保留旧 App。覆盖升级单独安排，先处理本地数据与登录状态验证。

反馈格式：手机型号、iOS 版本、App 版本/Build、发生时间、操作步骤、提示截图或录屏。崩溃时由开发人员结合该次归档的 dSYM 分析。

## 11. 常见问题

| 现象 | 优先检查 |
| --- | --- |
| Archive 显示生产身份未配置错误 | 第 5 节尚未完成，当前门禁仍在生效 |
| Xcode 找不到 OpenIMSDK 或链接失败 | 是否打开 workspace、pod install 是否成功、依赖下载是否完整 |
| No profiles / requires a development team | Team、证书私钥、Bundle ID、profile、Release 配置是否对应 |
| Organizer 不能导出 IPA | 本机是否有有效签名权限，所选分发渠道是否正确 |
| 模拟器正常，真机构建失败 | SDK 真机架构、链接、签名和权限；模拟器通过不能证明真机通过 |
| 点击安装没有反应 | Safari、安装 URL 编码、manifest 格式和 HTTPS 可达性 |
| 无法安装或无法验证完整性 | 先核对签名、profile、UDID、到期时间与下载完整性，再看手机系统日志 |
| 安装成第二个 App | 本次 Bundle ID 与旧版不同；独立内测时属于预期 |
| 无法覆盖旧版 | 应用身份、签名关系、权限或版本不匹配；不要直接卸载来掩盖迁移问题 |
| 过一段时间突然打不开 | 证书/profile 到期或撤销、企业验证等；服务器文件还在不等于签名有效 |
| 安装成功但登录/聊天异常 | 后端环境、账号、网络、SDK 与权限；安装成功仅说明安装链路通过 |
| 收不到离线推送 | APNs、能力、profile 和后端下发链路；当前项目不能仅凭 token 登记声称推送已完成 |

## 12. 本项目建议执行顺序

1. 你先把第 2 节确认模板给老板，确定签名方式和交付格式。
2. 你在 Mac 运行第 4 节验证，模拟器先跑通。
3. 开发负责人完成独立内测的发布配置与门禁调整。
4. 按老板实际工具选择源码/归档交付，或由你导出待重签 IPA。
5. 老板签名并检查最终 IPA；Ad Hoc 包含朋友 UDID。
6. 服务器负责人更新 HTTPS 安装页和 manifest。
7. 朋友安装，完成设备回归并反馈；通过后再安排正式覆盖升级。

以上角色可由同一个人兼任。你没有 iPhone 不阻碍构建，最终签名方式与当前 Release 门禁是打通流程前需要解决的两件事。

## 13. 原生版本怎么更新

旧 uni-app 通过版本接口下载 `.wgt`，在 App 内使用 `plus.runtime.install` 安装资源包，再重启生效。相关发布流程在 [WGT 热更新发布](../IM-APP-fronend/docs/wgt热更新发布.md)。原生版的 Swift、UIKit 页面和 OpenIM 桥接已编译进 App，修复这些内容需要新的签名 IPA。兼容已发布客户端的服务端修复和 App 已支持的远程配置，可走原有服务端发布流程。

| 本次改了什么 | 发布方式 | 客户收到更新的方式 |
| --- | --- | --- |
| Swift 页面、客户端交互或原生 SDK | 提高 `CFBundleVersion`，重新归档、签名、分发。继续使用该版本线的应用身份和签名配置 | TestFlight 更新，或重新打开同一个下载页，点安装申请覆盖 |
| 后端缺陷、后端兼容配置 | 发布服务端变更并验证旧客户端仍能工作 | 客户继续使用现有 App |
| 旧 uni-app 的 WGT | 继续使用旧壳对应的版本接口和发布流程 | 仍用旧壳的设备按其更新策略安装 WGT |

每次原生发布沿用第 8～10 节。客户先保留旧原生 App，直接安装更高 Build。先在一台已装旧包的 iPhone 上确认覆盖成功，并核对登录态、历史消息和本地资源。需要回退代码时，用上一可用提交构建更高 Build，再签名分发。保留上一个包和清单便于核验。

当前原生版的「检查更新」使用 `NativeTestFlightURL`、`NativeAppStoreURL`，或读取 `NativeUpdateManifestURL` 对应 `update.json` 中受支持的 Apple 链接。这个 JSON 用于 App 内提示，和 Safari 安装使用的 `manifest.plist` 是两个文件。自建 OTA 安装页目前通过 Safari 链接交付，App 内没有 OTA 自动安装入口。构建参数和 JSON 字段见[原生分发与更新操作](原生分发与更新操作.md)。

## 14. 参考资料

- 项目现状：`IM-APP-ios/README.md`。
- 环境与模拟器验证：`docs/iOS-Mac验证步骤.md`。
- 现有分发设计：`docs/原生分发与更新操作.md`。
- 迁移与发布门禁：`docs/原生重构方案-20261112/原生重构方案.md`。
- Apple：Create an ad hoc provisioning profile — https://developer.apple.com/help/account/provisioning-profiles/create-an-ad-hoc-provisioning-profile/
- Apple：Distributing your app to registered devices — https://developer.apple.com/documentation/xcode/distributing-your-app-to-registered-devices
- Apple：Distribute proprietary in-house apps（企业内部分发、网站与清单要求）— https://support.apple.com/guide/deployment/distribute-proprietary-in-house-apps-depce7cefc4d/web

- [Apple Developer Enterprise Program](https://developer.apple.com/programs/enterprise/)
- [Apple 企业 App 安装与信任说明](https://support.apple.com/118254)
- [Apple TestFlight](https://developer.apple.com/testflight/)
- [DCloud uni-upgrade-center](https://uniapp.dcloud.net.cn/uniCloud/upgrade-center.html)
- [HTML5+ Runtime 的 install 方法](https://www.html5plus.org/doc/zh_cn/runtime.html)

菜单名称、账号要求与设备侧行为以实际 Xcode/iOS 版本及 Apple 当前说明为准。
