# 易可聊 Android 原生工程

当前开发版本 `0.3.0-parity` / versionCode `4`。Kotlin + Compose，核心聊天直接使用官方 OpenIM 原生 SDK。以现有 uni-app 的页面、素材、文字与操作为基准，不另做视觉设计。

测试应用身份 `com.im.nativebootstrap.staging` 与正式 uni-app 不同，可覆盖前一版原生测试包，不覆盖生产 App。当前未验证旧本地库覆盖迁移，Release 有明确阻断。未改旧前端/后端，未部署或发布。

## 构建和安装

Windows 已有 `D:/JDK17`、`D:/Android/SDK`，从仓库根目录运行：

```powershell
./IM-APP-android/build.ps1 -Tasks @(':app:testDebugUnitTest', ':app:assembleDebug', ':app:lintDebug', ':app:assembleDebugAndroidTest') -Offline
```

首次机器缺缓存时移除 `-Offline` 联网解析固定依赖。Gradle、Android 用户目录、临时文件与下载均使用 D 盘 `.native-cache/`，不改系统环境变量。现有 Gradle 8.4、AGP 8.2.2、Kotlin 2.0.21、Compose BOM 2024.06.00、API 34 是开发基线，不等于已符合当前商店分发要求。

主包 `app/build/outputs/apk/debug/app-debug.apk`，测试包 `app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk`。普通内测只安装主包；Instrumentation 验证才需同时安装测试包。

```powershell
D:/Android/SDK/platform-tools/adb.exe install -r IM-APP-android/app/build/outputs/apk/debug/app-debug.apk
```

原生工程不再使用 uni-app 云打包。正式 APK/AAB 签名、发行与后端兼容步骤见方案文档；本阶段不解除发布阻断。

## SDK 与接口

固定官方 `io.openim:android-sdk:3.8.3.5@aar` + `io.openim:core-sdk:3.8.3-patch10@aar`，Maven POM 不含传递依赖，wrapper/core 均须显式声明。Gson、Lifecycle Process 同样显式声明。坐标来源、官方标签和 SHA-256 见 `contracts/native-bootstrap/v1/sdk-dependencies.json`。

Core 含四个 ABI；正式 AAB 分拆、体积与 16 KB 页兼容需专门验证。仓库服务声明 `v3.8.3-patch.16`，仍需核对线上实际版本、定制消息和互通，不能因为同为 3.8.3 就宣布兼容。

普通密码登录默认使用现有 `https://www.xn--jprz53bj9s.com/api/v1`，无需配置。区号、手机号、密码和协议按原版操作。Logo 长按中的 HTTPS 覆盖与离线样例保留给开发验证；样例持续标注“不联网、不送达”，不能证明真实 SDK 互通。

业务登录 `/auth/login` → Bearer `/me`，身份校验后独立申请平台 2 的 `/im/token` 并登录 SDK。AndroidKeyStore AES-GCM 加密/原子保存业务凭据，重启尝试恢复；不存密码。401 最多一次刷新并先保存旋转结果，资料身份不符拒绝接收。普通断线交 SDK 重连，不循环签发 Token，不自动删库。

## 当前实现

补接通讯录、申请、标签、好友资料、扫码、建群/邀请/管理/公告、个人资料与头像裁剪、二维码、收藏、通知/聊天/隐私/安全/通用设置、反馈举报、注销、注册找回及群发等。具体页面行为和差异以 `contracts/ui-parity/v1/android-page-map.json` 为准；73 条原路由含一条 H5 下载站，不将该下载页当原生页面。

聊天包含分页/实时消息、远程头像、图片/视频/语音/文件、引用/名片/表情/转发/收藏/撤回/删除、群 @、已读、置顶及搜索定位。图像在后台有界解码与缓存，媒体接受旧 camelCase/PascalCase，已知旧签名图片恢复稳定逻辑入口；未知签名地址不修改查询参数。GIF/播放器等仍需对应设备验收，不能仅凭编译判定可用。

全量已读与清历史遍历 SDK 分页；历史错误不冒充空页或结束。群 `minVisibleSeq/revision`、成员清理边界与本地墓碑单独持久并单调应用，不能把退出重登当作恢复被限制消息的方式。SDK 独占自己的数据库，自有状态文件与 SDK 表分离，账号/环境隔离，退出不删除消息库。

持久 Outbox 先原子写入、fsync 后再发送；进程中断/超时恢复为待核对，按 clientMsgID 查询，未知结果不盲重发。SDK 接受不等于对端送达或已读。保留 generation、房间 operation 与同步 attempt，拒绝旧回调推进新账号状态。

目前服务端 `LoggingPushService` 只记日志，注册 Token 不等于后台推送可下发。实时通话、厂商离线推送、现网定制协议、旧 App 原地升级与真实数据规模性能是单独门禁，当前不能称完整生产替换版本。

## 验证

单测和 Lint 覆盖本地可验证逻辑；静态检查/合成 UI 不替代账号互通与真机。安装主/测试 APK 后可断网执行：

```powershell
D:/Android/SDK/platform-tools/adb.exe shell am instrument -w com.im.nativebootstrap.staging.test/com.im.nativebootstrap.SDKSmokeInstrumentation
D:/Android/SDK/platform-tools/adb.exe shell am instrument -w com.im.nativebootstrap.staging.test/com.im.nativebootstrap.FullParityInstrumentation
```

SDKSmoke 实际加载原生 Core，运行无凭据 init/查询错误/uninit/reinit。FullParity 实际检查 AndroidKeyStore 加密/重建/替换/篡改拒绝，以及图片缓存/下采样/坏缓存清理；用本地合成接口数据渲染实际个人中心、通讯录、设置/资料和图片消息截图，不提交真实账号，不连业务服务。

结果需 `INSTRUMENTATION_CODE: -1` 且对应项目 passed，不能只看命令启动成功。最终包哈希、检查结果、旧 H5 对照与逐页差异见 `docs/原生功能与UI对齐-20261113/功能与UI对齐记录.html` 及 `.workflow/scratch/20261113-native-full-parity/verification.json`。测试截图不证明所有 73 路由运行通过。
