# Android 原生启动工程

当前实现 Kotlin + Compose 原型、现有后端业务登录与个人资料、业务账号代次隔离，以及独立的 IM 会话/同步状态核心。测试包版本为 `0.1.1-login`（versionCode 2），可覆盖前一版原生测试包。独立安装身份为 `com.im.nativebootstrap.staging`，不会覆盖旧 App；不能用这个测试包代替正式身份的历史数据迁移验收。

## 运行与验证

Windows 使用已有 `D:/JDK17`、`D:/Android/SDK`，在工程目录执行：

```powershell
.\build.ps1
# 已准备依赖缓存时：
.\build.ps1 -Offline
# 静态检查：
.\build.ps1 -Tasks @(':app:lintDebug') -Offline
```

`build.ps1` 把 Gradle、Android 用户目录、临时文件均放在仓库旁的 `.native-cache/`（当前在 D 盘），不修改系统环境变量。优先使用 `.native-cache/tools/gradle-8.4`，否则使用项目 Wrapper。Android SDK 通过 `ANDROID_HOME` 指向已有 D 盘 SDK。JUnit 的标准 Maven 依赖为 4.13.2；本机缺 Maven 缓存时可将已有 Gradle 发行版中的 JUnit/Hamcrest 原件复用到未入库的 `.native-cache/maven/`，CI 正常使用公开 Maven 依赖。

安装产物：`app/build/outputs/apk/debug/app-debug.apk`。Gradle 8.4、AGP 8.2.2、Kotlin 2.0.21、Compose BOM 2024.06.00、API 34 是当前机器可验证的原型基线，正式分发前必须重新核对当期商店要求、SDK/native 库兼容性与依赖升级。任何 Release 构建当前都会明确失败，待正式身份、签名与迁移门禁确认后专门开放。

## 两种验证入口

- **本地样例**：长按登录页原 Logo，在“本地开发设置”进入样例；不联网、不登录。打开“交互测试”会话后输入文本，点击“传送”仅添加到当前内存，离开会话或退出样例清除。页面持续标明“不联网，不送达”。
- **真实账号登录**：普通登录页可直接使用现有账号，无需配置地址。默认地址为 `https://www.xn--jprz53bj9s.com/api/v1`，即 `www.易可聊.com` 的既有 HTTPS 后端入口。用户已明确授权使用现有后端；本工程不修改后端或部署。Logo 长按仍可覆盖 HTTPS 地址，留空使用默认值，禁止明文 HTTP 与自动重定向。短信 API 适配保留，本轮不展示验证码登录。界面不显示或记录 token。

登录仅调用 `POST /auth/login` 与携带 Bearer 业务凭据的 `GET /me`，不主动申请 `/im/token`。资料 ID 必须与本次登录用户 ID 一致；资料加载失败或 ID 不匹配时，保留已经成功的业务认证，显示登录响应中的真实资料并提示。真实主界面的“我的”展示服务端昵称、账号与脱敏手机号，聊天/通讯录明确标示接入中；真实分支没有样例会话。

业务登录不会把 `SessionCoordinator` 或 IM 标记为就绪；现有 IM Token API 仅保留给后续 SDK 适配。业务 token 仅驻留进程内存，密码提交后清空、不持久化；返回/退出登录/切换样例清除凭据与资料，并拒绝迟到请求结果。本机随机 deviceId 使用应用私有 SharedPreferences 持久化，以便进程重启后保持一致；不使用硬件标识。卸载或清除应用数据会重新生成，应用备份禁用。

HTTP 4xx 与业务错误只展示经过长度限制、控制字符清理和凭据过滤的 `message`，不回显原始响应。所有自动测试使用注入的 fake transport 和合成 fixture，不使用真实账号、不发送真实短信或生产写请求。

## 已实现与后续门禁

- `SessionCoordinator` 在一个锁内捕获账号和 generation；退出/换号拒绝旧票据；每次同步另有 operation，旧同步结果不能完成后一次尝试。
- 本地库和同步状态分离；失败、取消、超时保留明确状态；同步完成要求本地可读。没有删除 SDK 数据库的路径。
- `NativeAPI` 实现密码登录、短信登录、短信申请、Token 刷新、个人资料 GET，以及单独保留的 Android IM Token 适配；业务登录不调用 IM Token 接口。业务 user.id 不作为 IM userId。
- `BusinessSession` / `BusinessLoginFlow` 单独负责业务账号与内存凭据，使用锁和代次隔离登录/退出/换号。JUnit 覆盖默认 HTTPS 地址、GET 方法/header、资料 ID、资料失败回退、退出清凭据及迟到回调、稳定 deviceId、业务错误清理；原有 IM 状态与 API 测试保留。测试直接引用共享 `contracts/native-bootstrap/v1/fixtures/`。

OpenIM SDK 选择/接入、真实离线开库、消息持久化、Outbox、媒体/历史分页、后台/推送、旧库迁移、真机性能与真实消息互通仍待后续实现和验证。本地样例不代替这些能力；本工程不要求部署或修改后端。

## 本机验证记录

已验证的首轮 UI 版本包含 13 项 JUnit 测试、Debug 构建与 Lint，正式 Release 构建按保护策略失败。本轮真实业务登录统一执行 `:app:testDebugUnitTest`、`:app:assembleDebug` 和 `:app:lintDebug`，3 分 20 秒退出 0；26 项测试全通过，Lint 0 错误 / 25 警告（含前述 2 项规则覆盖限制）。最终结果与 APK SHA-256 见 `.workflow/scratch/20261112-native-live-login/android-validation.json`，模拟器验证由根任务另行记录。

当前旧原型工具链下，Lint 报告包含依赖更新提示，且 Compose Runtime / Lifecycle 的部分自定义 lint 规则因分析 API 不兼容未执行。这不是完整静态覆盖或正式发布门禁通过；升级工具链和依赖后应再次运行完整 lint。自动化验证未使用真实账号，没有测真机帧率或 SDK 消息可靠性。默认服务入口支持用户主动登录，不代表真实账号链路和真实聊天已完成验收。

## 首轮 UI 还原

用户要求保留现有 uni-app UI。当前以旧 `sign-in.vue` 和最终生效的 `auth-modern.scss`、`ImLegalConsent`、`ImCountryPicker`、`ImTabBar`、`ConversationItem`、`ChatBubble`、`ImMessageComposer`、聊天列表和 room 源码为基线，映射登录、导航、会话行和文本聊天。品牌“易可聊”与原 PNG/SVG 资产复用；普通页面移除原型标题、环境字段和 SDK 术语，开发入口隐藏在登录 Logo 长按。

`rpx` 按当前逻辑视口宽度 / 750 转为 dp/sp；auth-modern 中 px 作为固定逻辑尺寸。登录保留 56px Logo、26px 标题、52px 输入与原蓝色渐变，矮屏按旧媒体查询调整；输入组件使用 BasicTextField 自定义旧外观，避免 Material 默认卡片/输入框。底栏顺序为通讯录、聊天、我的，原 SVG 栅格图标；文本气泡颜色和圆角、输入区及“传送”文案沿用原组件。

本轮未交付的注册、找回密码、好友/群、媒体/语音、表情和更多操作会如实提示未接入；协议与隐私原 HTML 通过禁用脚本的本地视图打开。通讯录仍为边界占位；“我的”在本轮补齐真实账号资料和退出登录。上一轮已由根任务核对同宽旧 H5 登录与 Android 截图、通过 20 项离线模拟器检查，不能据此声明全量 UI 或真机性能验收通过。
