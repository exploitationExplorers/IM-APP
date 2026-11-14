# 原生功能与 UI 对齐记录

本文件保留 2026-11-13 的阶段证据；最新修复与版本请看同目录的《问题修复与验证-20261114.md》，不要把下文旧 APK 的测试结果当作本轮结果。

版本：Android 0.3.0-parity / code 4；iOS 0.3.0 / build 4。目标是全部功能与 UI 对齐现有 uni-app。当前仍处于开发与分层验证阶段，不是生产替换完成声明。

本次针对用户截图中图片不显示、通讯录占位和个人中心不一致继续开发。旧 uni-app 源码是功能与视觉基准；Android 使用 Compose、iOS 使用 UIKit；核心聊天没有套 WebView。

后端与旧前端保持保护基线，不部署、不修改线上数据库。使用现有接口会遵守既有登录互踢和业务权限规则，真实操作仍会写现有服务；没有专用账号时不自动提交登录或业务变更。

## 状态含义

| 状态 | 含义 |
| --- | --- |
| implemented_pending_runtime | 已有实际代码与接口接线；待真实账号、设备与逐页验收 |
| partial | 仍有明确功能或 UI 差异，详见逐页条目 |
| h5_only | 旧版条件编译为 H5 下载站，不属于原生 App 页面 |

runtimeVerified 为 false 的页面不能因为编译、单测或合成截图通过改成 true。合成图片验证单列证据，不替代旧账号历史媒体、真实互通或像素一致性。

## 已实施范围与验证边界

双端补接通讯录、好友申请与标签、群资料与管理、个人资料与二维码、收藏、通知/聊天/隐私/安全/通用设置、反馈举报及认证相关页面；具体入口和差异以逐页映射为准。

图片链路包含异步加载、缓存、有界解码、远程头像和聊天图片预览；兼容旧消息字段和已知媒体稳定入口，未知签名地址保持原样。图/视频/语音/文件发送使用真实 SDK 与持久 Outbox；不确定发送结果先核对，接受不冒充送达。

Android 使用 AndroidKeyStore 加密保存登录信息，iOS 使用不可云同步的 Keychain；不保存密码，不以删库恢复登录。SDK 独占消息库，按账号和环境隔离；群可见水位保持单调。

旧素材共 65 项、双端 130 份副本，保留来源与 SHA-256。个人中心背景按原 CSS 的 luminosity 与 #0a2fc2 预合成，避免双端各自近似混色。

现有服务的 LoggingPushService 是日志实现，注册 push-token 不等于 APNs/厂商推送真正下发。实时音视频、后台推送、现网定制协议及旧库覆盖升级必须独立验收，不能通过页面占位声明已支持。

## 实际验证记录

```json
{
  "status": "in_progress_pending_real_account_and_Mac_acceptance",
  "collected_at": "2026-11-13T09:23:36.195973+00:00",
  "version": {
    "Android": "0.3.0-parity (4)",
    "iOS": "0.3.0 (4)"
  },
  "scope": "Local development evidence, not full feature/UI equivalence or production readiness",
  "android": {
    "apk": {
      "sha256": "10e8158c518822e7c81dbe80bb1d5afe1167a1b78b0a851b315c724b14bf462e",
      "bytes": 97213411
    },
    "unit_tests": {
      "tests": 111,
      "failures": 0,
      "errors": 0,
      "skipped": 0,
      "status": "passed",
      "scope": "Latest local JUnit XML; build evidence must also match the delivered APK and final source snapshot"
    },
    "build": {
      "status": "not_run"
    },
    "device": {
      "status": "passed",
      "scope": "Installed staging APK, no credentials; SDK unauthenticated smoke, Keystore, bounded images/GIF and synthetic UI only",
      "serial": "127.0.0.1:5581",
      "real_account_interoperability": "not_run",
      "pixel_equivalence": "not_verified",
      "screens": [
        {
          "name": "mine",
          "sha256": "b70bbc2c4463007efd6148070f7e450973c3b54168f3f6236518b521ccfc1abc",
          "bytes": 77363
        },
        {
          "name": "contacts",
          "sha256": "5430d01baad470aa3f333b6a0f9b00604754923a2d780ca059e58e5157a281b6",
          "bytes": 78537
        },
        {
          "name": "notifications",
          "sha256": "d7405d4fbde0e9920cf8fd7cba70babe0676a3b80401b672869738aa8788ed46",
          "bytes": 53867
        },
        {
          "name": "chat-settings",
          "sha256": "7a6d82d82dc8cd6b26b48f037a1af50a587e847af558e170d84556bc88ace1a6",
          "bytes": 39748
        },
        {
          "name": "privacy",
          "sha256": "fb5581e90804e70064c99d9ca1a379845d4d1f4edd07df89e4cfccceee12f89b",
          "bytes": 40294
        },
        {
          "name": "security",
          "sha256": "f2a3bbfed59a83efdef0cc0107eec6fd38568c3ba5f92b6025303f2475b1dfec",
          "bytes": 42253
        },
        {
          "name": "general",
          "sha256": "6f1d75a0838e7c94b4faca1b99c37a1b9815dd5543778fb6b28faf3de8cb6393",
          "bytes": 53249
        },
        {
          "name": "profile",
          "sha256": "c991c84fb7f074914b6f5f13611ee122f194a4a36aa639872ac6bf8e93940485",
          "bytes": 73713
        },
        {
          "name": "about",
          "sha256": "2e886812d1a08b5c86bc41c2f56c0d6f82d6a7c8245e976fc5bd6c9a245895b5",
          "bytes": 52262
        },
        {
          "name": "qrcode",
          "sha256": "8e9fd3bbd46e5f170dc993aa3177844c509deb1b2f16654b07e1db88581f9f11",
          "bytes": 38661
        },
        {
          "name": "announcements",
          "sha256": "535af5a6956d00e94776dde3a529ab849f741f5b87a7364154c1a79f5e9ba94d",
          "bytes": 66480
        },
        {
          "name": "chat-image",
          "sha256": "0ec04dc8afd598265eef21b51bec13a90265483c81b179245f95d69f506ebb86",
          "bytes": 43080
        }
      ],
      "apk_sha256": "10e8158c518822e7c81dbe80bb1d5afe1167a1b78b0a851b315c724b14bf462e",
      "test_apk_sha256": "5ee32186da95d17aed2b1c5286d6639aad722f89b822d489f71c26a2a884a416",
      "installed_apk_sha256": "10e8158c518822e7c81dbe80bb1d5afe1167a1b78b0a851b315c724b14bf462e",
      "SDKSmokeInstrumentation": [
        "INSTRUMENTATION_RESULT: loginStatus=1",
        "INSTRUMENTATION_RESULT: sdkVersion=v3.8.3-patch.10",
        "INSTRUMENTATION_RESULT: smoke=passed: native version, init, unauthenticated callback, uninit, reinit, uninit",
        "INSTRUMENTATION_RESULT: unauthenticatedQueryError=10005",
        "INSTRUMENTATION_CODE: -1"
      ],
      "FullParityInstrumentation": [
        "INSTRUMENTATION_RESULT: animatedMedia=passed: native red/blue frames, page stop/resume, invisible stop, no network",
        "INSTRUMENTATION_RESULT: fullParity=passed: bitmap decode/downsampling/cache plus synthetic mine/contacts/chat image rendering",
        "INSTRUMENTATION_RESULT: scope=Synthetic local fixtures only; not production interoperability or pixel equivalence",
        "INSTRUMENTATION_RESULT: secureSession=passed: AndroidKeyStore encryption, recreation, replace, tamper rejected and preserved, clear",
        "INSTRUMENTATION_CODE: -1"
      ]
    },
    "login_UI": {
      "status": "passed",
      "scope": "Android installed APK default login/config and offline sample UI only; no account submitted and no real-account UI runtime validation",
      "apk_sha256": "47c69473f68b8ea9b24f984a73bf162b3eae856d110632ebe34b363261e9ee7a",
      "network": "emulator Wi-Fi/cellular disabled; synthetic credentials never submitted to default backend",
      "checks": [
        {
          "check": "installed versionCode 4 / versionName 0.3.0-parity",
          "passed": true
        },
        {
          "check": "normal legacy login visible",
          "passed": true
        },
        {
          "check": "normal login does not expose developer fields",
          "passed": true
        },
        {
          "check": "register page has native phone and verification flow",
          "passed": true
        },
        {
          "check": "password recovery page has verification flow",
          "passed": true
        },
        {
          "check": "default existing HTTPS endpoint prefilled",
          "passed": true
        },
        {
          "check": "default service is disclosed in developer panel",
          "passed": true
        },
        {
          "check": "sample is clearly isolated",
          "passed": true
        },
        {
          "check": "sample does not pretend a real account",
          "passed": true
        },
        {
          "check": "exit returns to clean login",
          "passed": true
        }
      ]
    }
  },
  "ios": {
    "project_static": {
      "status": "not_run"
    },
    "syntax": {
      "status": "passed",
      "scope": "tree-sitter syntax parsing only, not Swift typechecking or Xcode compilation",
      "files": 41,
      "errors": []
    },
    "core_test_methods_in_source": 53,
    "core_tests": "not_run_no_Mac",
    "Xcode_build": "not_run_no_Mac",
    "iPhone_database_and_sync": "not_run"
  },
  "assets": {
    "status": "not_run"
  },
  "protected_source": {
    "status": "passed",
    "scope": "481 original frontend/backend source files against task-start SHA256 baseline",
    "files": 481,
    "changed": []
  },
  "report_browser": {
    "rows": 146,
    "counts": {
      "Android": 73,
      "iOS": 73
    },
    "images": [
      {
        "ok": true,
        "width": 720,
        "height": 1232
      },
      {
        "ok": true,
        "width": 720,
        "height": 1392
      },
      {
        "ok": true,
        "width": 720,
        "height": 1232
      },
      {
        "ok": true,
        "width": 720,
        "height": 1392
      },
      {
        "ok": true,
        "width": 720,
        "height": 1232
      },
      {
        "ok": true,
        "width": 720,
        "height": 1392
      },
      {
        "ok": true,
        "width": 720,
        "height": 1232
      },
      {
        "ok": true,
        "width": 720,
        "height": 1392
      },
      {
        "ok": true,
        "width": 720,
        "height": 1232
      },
      {
        "ok": true,
        "width": 720,
        "height": 1392
      },
      {
        "ok": true,
        "width": 720,
        "height": 1232
      },
      {
        "ok": true,
        "width": 720,
        "height": 1392
      },
      {
        "ok": true,
        "width": 720,
        "height": 1232
      },
      {
        "ok": true,
        "width": 720,
        "height": 1392
      },
      {
        "ok": true,
        "width": 720,
        "height": 1232
      },
      {
        "ok": true,
        "width": 720,
        "height": 1392
      },
      {
        "ok": true,
        "width": 720,
        "height": 1392
      },
      {
        "ok": true,
        "width": 720,
        "height": 1392
      },
      {
        "ok": true,
        "width": 720,
        "height": 1392
      },
      {
        "ok": true,
        "width": 720,
        "height": 1392
      }
    ],
    "external": 0,
    "status": "passed"
  },
  "not_verified": [
    "Real account authentication and legacy/native interoperability",
    "All routes and full UI equivalence on physical devices",
    "APNs/vendor push delivery and real-time calls",
    "Signed upgrade and old local database migration",
    "Large real history performance and iOS sync recovery"
  ],
  "backend_modified": false,
  "backend_deployed": false,
  "client_published": false
}
```

## 逐页映射

### Android

| 旧路由 | 当前实现与行为 | 差异 | 真实运行验收 |
| --- | --- | --- | --- |
| pages/download/index | 沿用原 H5 下载页；原页面仅面向下载站；不属于 Android App 内路由。 | h5_only，不在原生 App 复制下载页。 | 待验收 |
| pages/chat/index | UniParityUI.kt / ConversationList + chat/ChatController.kt；SDK会话分页/下拉刷新、真实头像/时间/未读、全部/未读筛选；原版左滑置顶/移除并右滑收起，长按免打扰/已读；原⋯全部已读菜单与全量SDK分页标记；原搜索框直接全文检索本机已同步消息、分会话结果/分页及定位。 | 完整交互与系统字形仍需最终设备截图校准；不能检索尚未同步的云端记录。 | 待验收 |
| pages/auth/sign-in | UniParityUI.kt / UniLogin；密码登录、五个国家区号、合法手机号校验、密码显隐、协议、注册/找回入口；BusinessLoginFlow 调 auth/login + me。 | 原 UI 入口隐藏的短信登录未额外展示；真实账号登录尚未实机验证。 | 待验收 |
| pages/auth/sign-up | business/NativeAuthUI.kt / NativeAuthPage(register)；register 场景 SMS、倒计时、重复密码、协议同意、auth/register；进入 onboarding。 | 代码中未登记额外差异；仍需运行验收 | 待验收 |
| pages/auth/onboarding | business/NativeBusinessUI.kt / onboarding；注册后完善资料，头像真实本地裁剪+上传、昵称限制、PATCH me或稍后完善。 | 代码中未登记额外差异；仍需运行验收 | 待验收 |
| pages/auth/forgot-password | business/NativeAuthUI.kt / NativeAuthPage(forgot)；reset 场景 SMS、两步找回、auth/password/reset；成功返回登录。 | 代码中未登记额外差异；仍需运行验收 | 待验收 |
| pages/auth/agreement | UniParityUI.kt / LegalSheet；离线 legal/agreement.html 与 privacy.html，WebView 禁用 JavaScript 与文件访问。 | 代码中未登记额外差异；仍需运行验收 | 待验收 |
| pages/auth/privacy | UniParityUI.kt / LegalSheet；离线 legal/agreement.html 与 privacy.html，WebView 禁用 JavaScript 与文件访问。 | 代码中未登记额外差异；仍需运行验收 | 待验收 |
| pages/contacts/index | business/NativeBusinessUI.kt / ContactsHome；GET /contacts 搜索分页/排序、最近聊天本地排序；群纵向白卡、联络人粗体标题、新朋友角标、真实头像、Material3 下拉刷新。；已按设备截图修正72r搜索框、原34r菜单字/深色40r箭头及16r分组间隔。 | 原生字形和系统安全区仍需最终截图校准。 | 待验收 |
| pages/mine/index | business/NativeBusinessUI.kt / MineHome；GET /me；原 CSS luminosity 预合成 hero 素材，144/48/48 rpx 内边距、160 rpx 头像及居中昵称、原菜单/退出确认。 | 需最终截图校准字体与安全区。 | 待验收 |
| pages/chat/room | NativeChatUI.kt / NativeChatRoom + chat/ChatController.kt；官方SDK历史分页/实时/已读，真实文本/引用/@成员/@全部/图片/视频/语音/文件/名片/收藏；复制/收藏/撤回/删/置顶、多选删除和独立转发；原生输入与durable outbox。；按权限加载消息菜单、群管理禁言/移出/按发送者时间水位清理、举报用户、保存视频/原图、GIF及自定义表情面板真实发送/添加/删除/管理。；已按原34r左对齐标题/原工具栏、点录音→草稿→发送取消、plus四列相机照片视频名片文件收藏与GIF原图缩略优先补齐。 | 实时音视频通话栈及杀进程离线推送尚无现有服务支持；未新增旧原版没有的合并转发生成模式。 | 待验收 |
| pages/chat/forward | NativeChatUI.kt / forwardDialog + ChatController.forward；NativeForwardPicker 最近/联系人/群/标签真实分页与选择；全好友 selector/排除、标签和额外目标；小目标文字/图片顺序 SDK 接受，其余业务 forward-batches 队列，明确区分已提交/已入队。；入队后可真实查询任务进度并调用重试/取消。 | 真实服务端转发队列和多人送达需账号联调；不将入队说成已送达。 | 待验收 |
| pages/chat/image-viewer | media/MediaComponents.kt / ImagePreview；原图缩放、当前可见过滤后的图集前后切换及计数；Android10+MediaStore入相册，旧系统SAF；有界解码和缓存。 | Android8/9需用户选择保存位置。 | 待验收 |
| pages/chat/video-viewer | media/MediaComponents.kt / VideoPreview；真实系统视频播放/暂停/进度、缩略图、原文件保存分享；Android10+MediaStore入相册，旧系统SAF。 | 不同视频编码需设备兼容性验证；Android8/9需用户选择保存位置。 | 待验收 |
| pages/chat/card-picker | NativeChatUI.kt / NativeChatPicker(card)；真实 /contacts 搜索分页，解析 /im/peers，SDK 名片消息进入 durable outbox，群内禁分享名片。 | 代码中未登记额外差异；仍需运行验收 | 待验收 |
| pages/chat/favorite-picker | NativeChatUI.kt / NativeChatPicker(favorite)；真实 /favorites/list 分页/类型筛选，多选逐条发送 text/emoji/image，管理模式真实删除；保持活动聊天上下文。 | 搜索覆盖已载入收藏；与原限制一致不直接发送 voice/video/file。 | 待验收 |
| pages/contacts/report-user | business/NativeBusinessUI.kt / report-user；GET report-reasons，选择 reasonId、说明、证据图片，POST reports targetType/user/evidenceFileIds。 | 代码中未登记额外差异；仍需运行验收 | 待验收 |
| pages/contacts/new-friends | business/NativeBusinessUI.kt / requests；POST /friend-requests/sync；pending/recent 状态，接受/拒绝真实接口；打开来源资料。 | 代码中未登记额外差异；仍需运行验收 | 待验收 |
| pages/contacts/add-friend | business/NativeBusinessUI.kt / add-friend；页内扫一扫，GET users/search publicId nullable 结果与真实 friend-requests。 | 代码中未登记额外差异；仍需运行验收 | 待验收 |
| pages/contacts/add-group | business/NativeBusinessUI.kt / add-group + group(lookup)；页内扫一扫、群号查群、按joinMode真实加入或申请；可查看群资料。 | 代码中未登记额外差异；仍需运行验收 | 待验收 |
| pages/contacts/scan | business/NativeBusinessUI.kt / scan + NativeQr.kt；Journeyapps 相机扫码、相册 ZXing 识别、我的二维码入口、可粘贴 payload；URL/JSON/裸 token 兼容。 | 系统扫码 Activity 替代旧扫描框；照片方向/相册格式仍需实机覆盖。 | 待验收 |
| pages/contacts/scan-result | business/NativeBusinessUI.kt / scan-result；POST /users/qrcode/resolve；好友进入会话，非好友真实申请。 | 代码中未登记额外差异；仍需运行验收 | 待验收 |
| pages/contacts/scan-group-result | business/NativeBusinessUI.kt / scan-group-result；POST /groups/qrcode/resolve；按 nextAction 进入/加入/申请，调用 qrcode/join。 | 代码中未登记额外差异；仍需运行验收 | 待验收 |
| pages/contacts/user-profile | business/NativeBusinessUI.kt / user；GET /users/:id + /contacts/:id 确认关系；好友发消息；群来源独立 group-friend-requests，服务器权限兜底。 | 代码中未登记额外差异；仍需运行验收 | 待验收 |
| pages/contacts/friend-detail | business/NativeBusinessUI.kt / friend；GET /contacts/:id；头像/备注/签名/标签/共同群/成为好友/最近在线；block/unblock/delete 二次确认。 | 代码中未登记额外差异；仍需运行验收 | 待验收 |
| pages/contacts/friend-common-groups | business/NativeBusinessUI.kt / common-groups；真实 contacts/:id commonGroups；打开群资料和聊天。 | 代码中未登记额外差异；仍需运行验收 | 待验收 |
| pages/contacts/friend-remark | business/NativeBusinessUI.kt / friend-remark；PATCH /contacts/:id remark；成功返回刷新真实资料。 | 代码中未登记额外差异；仍需运行验收 | 待验收 |
| pages/contacts/friend-tags | business/NativeBusinessUI.kt / friend-tags；真实标签列表与已选seed、页内新建标签自动勾选、PATCH contact tagIds。 | 代码中未登记额外差异；仍需运行验收 | 待验收 |
| pages/contacts/tag-detail | business/NativeBusinessUI.kt / tag-members；真实成员列表、改名、添加、移除成员和删标签；移除提交前重新取最新成员差集PUT，保留并发新增。 | 代码中未登记额外差异；仍需运行验收 | 待验收 |
| pages/contacts/tag-add-members | business/NativeBusinessUI.kt / tag-add-members；真实联系人搜索分页、已有成员禁选、全选当前页，提交前最新成员union PUT。 | 代码中未登记额外差异；仍需运行验收 | 待验收 |
| pages/contacts/tags | business/NativeBusinessUI.kt / tags；真实 contact-tags 列表/创建、标签详情、重命名与删除接口。 | 代码中未登记额外差异；仍需运行验收 | 待验收 |
| pages/contacts/groups | business/NativeBusinessUI.kt / groups；GET /groups，全部/我创建/我加入筛选、分页、群状态、打开资料/聊天。 | 代码中未登记额外差异；仍需运行验收 | 待验收 |
| pages/group/create | business/NativeBusinessUI.kt / create-group；选择联系人→创建群两步；搜索/最近加入/名字/最近聊天排序、全选当前页、跨页选中保留、自动群名建议；POST groups name/memberIds。 | 代码中未登记额外差异；仍需运行验收 | 待验收 |
| pages/group/detail | business/NativeBusinessUI.kt / GroupDetail；真实 /groups/detail；改群头像/名称/号、成员/公告/二维码/备注/昵称/本地档案/聊天；退出/解散确认。 | 群资料完整视觉层级尚需多角色账号与逐页设备截图。 | 待验收 |
| pages/group/members | business/NativeBusinessUI.kt / members + member；全量业务分页聚合后按昵称/群昵称/备注本地搜索；原API无keyword参数；成员备注/权限/禁言/移出和purge真实操作。 | 多角色权限与大群耗时仍需真实账号测量。 | 待验收 |
| pages/group/invite | business/NativeBusinessUI.kt / invite；真实联系人搜索分页/排序/当前页全选；全分页读取既有群成员并禁选，POST invitations userIds。 | 代码中未登记额外差异；仍需运行验收 | 待验收 |
| pages/group/admin | business/NativeBusinessUI.kt / group-admin / GroupAdmin；独立群管理页；真实管理员/入群申请入口及allMuted/allowMemberAddFriend/joinMode设置。 | 代码中未登记额外差异；仍需运行验收 | 待验收 |
| pages/group/admins | business/NativeBusinessUI.kt / admins；全分页成员聚合筛选owner/admin，可打开成员管理和添加管理员。 | 代码中未登记额外差异；仍需运行验收 | 待验收 |
| pages/group/admin-add | business/NativeBusinessUI.kt / admin-add；全分页普通成员与昵称/群昵称/备注搜索；逐目标设置角色，部分失败刷新实际状态并如实汇总。 | 保持原串行部分成功语义，不自动回滚可能覆盖其他管理员并发操作。 | 待验收 |
| pages/group/join-requests | business/NativeBusinessUI.kt / join-requests；真实列表；approve / reject 接口，刷新处理结果。 | 代码中未登记额外差异；仍需运行验收 | 待验收 |
| pages/group/edit-name | business/NativeBusinessUI.kt / group-name；POST groups/settings/update groupId/name。 | 代码中未登记额外差异；仍需运行验收 | 待验收 |
| pages/group/edit-group-id | business/NativeBusinessUI.kt / group-id；一次修改说明；POST groups/public-id/update groupId/publicId；服务器校验。 | 代码中未登记额外差异；仍需运行验收 | 待验收 |
| pages/group/announcement | business/NativeAnnouncements.kt；原页内发布/编辑/取消及底部提交；按permissions.canEditAnnouncement或角色控制，最多10条/500字/9图；编辑仅更新当前ID、新图fileIds与旧图keep分离；网格图片预览/原图保存、删除确认后刷新。 | 代码中未登记额外差异；仍需运行验收 | 待验收 |
| pages/group/remark | business/NativeBusinessUI.kt / group-remark；PUT groups/:id/remark。 | 代码中未登记额外差异；仍需运行验收 | 待验收 |
| pages/group/qrcode | business/NativeBusinessUI.kt / QrCard + NativeQr.kt；并取真实群详情和payload，显示原群头像/群名/560r QR/扫码进群；生成头像群名合成PNG，Android10+MediaStore入相册，原生分享。 | Android8/9使用系统文件保存窗口。 | 待验收 |
| pages/group/my-nickname | business/NativeBusinessUI.kt / group-nickname；PUT groups/:id/me/nickname。 | 代码中未登记额外差异；仍需运行验收 | 待验收 |
| pages/group/media | NativeChatUI.kt / NativeChatArchive(media=true)；SDK 全本地库媒体类型分页，真实图/视频/文件/语音预览；可定位原聊天，图集前后切换。 | 仅本机已同步记录。 | 待验收 |
| pages/group/search-history | NativeChatUI.kt / NativeChatArchive(media=false)；SDK 全本地库关键词分页检索，群水位过滤；点击定位再次核验可见性后进入对应聊天消息。 | 仅本机已同步记录。 | 待验收 |
| pages/group/report | business/NativeBusinessUI.kt / report-group；原原因选择第一步，选择原因进入填写说明/证据页面。 | 代码中未登记额外差异；仍需运行验收 | 待验收 |
| pages/group/report-submit | business/NativeBusinessUI.kt / report-group；第二步说明和最多9张上传证据，真实POST groups/reports。 | 代码中未登记额外差异；仍需运行验收 | 待验收 |
| pages/group/leave | business/NativeBusinessUI.kt / GroupDetail 退出/解散；真实 groups/:id/leave 或 dismiss，二次确认后回退。 | 原 leave.vue 本身是待实现页；原生入口直接合并在群详情，不保留空页面。 | 待验收 |
| pages/mine/profile | business/NativeBusinessUI.kt / profile；真实GET/PATCH me；头像本地裁剪上传；原版头像左置与昵称/签名、电话/聊天号/二维码、注销分组，聊天号真实复制；统一96r导航、40r标题。；value按原flex分配并右对齐，40r箭头，避免签名过早省略。 | 代码中未登记额外差异；仍需运行验收 | 待验收 |
| pages/mine/account-deletion | business/NativeBusinessUI.kt / Deletion；GET deletion-preview 统计/blockers，delete_account SMS，confirmPhrase 精确匹配与二次确认；服务器确认ok才退出。 | 短信仍需真实环境及账号联调。 | 待验收 |
| pages/mine/edit-nickname | business/NativeBusinessUI.kt / edit-nickname；15 字限制，PATCH /me nickname/bio/avatarFileId 空串保持旧头像；刷新安全缓存不延长 token expiry。 | 代码中未登记额外差异；仍需运行验收 | 待验收 |
| pages/mine/edit-chat-id | business/NativeBusinessUI.kt / edit-chat-id；PUT me/public-id，唯一/一次性限制由服务端校验。 | 代码中未登记额外差异；仍需运行验收 | 待验收 |
| pages/mine/edit-bio | business/NativeBusinessUI.kt / edit-bio；50 字限制，PATCH /me；保留当前昵称/头像。 | 代码中未登记额外差异；仍需运行验收 | 待验收 |
| pages/mine/qrcode | business/NativeBusinessUI.kt / QrCard + NativeQr.kt；ZXing真实个人payload，原头像昵称/560r QR/导航扫码分享/底部保存分享；生成头像昵称合成PNG，Android10+MediaStore入相册，原生分享。 | Android8/9使用系统文件保存窗口。 | 待验收 |
| pages/mine/favorites | business/NativeBusinessUI.kt / Favorites + NativeFavoriteContent；真实类型分页、专用媒体预览/播放、复制、管理多选删除；SDK全会话分页找到真实原消息才允许完整目标选择器转发。 | 收藏转发与原版一样，原消息未同步时需返回聊天先同步；不伪造sourceID。 | 待验收 |
| pages/mine/notifications | business/NativeBusinessUI.kt / notifications + NativeSettings；原56×36r开关、白底黑粗分组/横线/留白；本地偏好持久化；前台声音/震动、后台连接活跃时系统提醒；系统权限入口footer。 | voice保留原邀请偏好，尚无实时通话栈；服务端LoggingPushService不下发，杀进程离线推送未就绪。 | 待验收 |
| pages/mine/chat-settings | business/NativeBusinessUI.kt / chat-settings；原白底紧凑行与56×36r开关；回车发送/表情/群发入口，清历史无额外箭头；全SDK会话分页+业务水位清理，锁定并检查待确认outbox。 | 代码中未登记额外差异；仍需运行验收 | 待验收 |
| pages/mine/mass-assistant | business/MassAssistant.kt / mass-assistant；账号环境隔离本机群发历史；编辑/多选/全选删除与再发一条；删除记录不会撤回消息。 | 代码中未登记额外差异；仍需运行验收 | 待验收 |
| pages/mine/mass-select-contacts | business/MassAssistant.kt / mass-select；联系人/群/最近聊天/标签真实目标，多页取全、搜索、全选与跨类保留；最近群转换业务群ID再去重。 | 代码中未登记额外差异；仍需运行验收 | 待验收 |
| pages/mine/mass-compose | business/MassAssistant.kt / mass-compose；原支持文字/多图片/语音/文件，已补录音和音频文件；一次上传复用、逐目标多图顺序durable发送、标签展开去重、空标签/失败单独计数、不盲重发。 | 暂不添加原massDispatch不支持的视频专属类型。 | 待验收 |
| pages/mine/mass-targets | business/MassAssistant.kt / mass-targets；当前收件人列表与移除、返回编辑；共享群发选择状态。 | 代码中未登记额外差异；仍需运行验收 | 待验收 |
| pages/mine/privacy | business/NativeBusinessUI.kt / privacy；GET/POST me/privacy-settings 两项真实持久化；黑名单入口。 | 代码中未登记额外差异；仍需运行验收 | 待验收 |
| pages/mine/blacklist | business/NativeBusinessUI.kt / blacklist；GET contacts/blocked 搜索；DELETE contacts/:id/block 解除与确认。 | 代码中未登记额外差异；仍需运行验收 | 待验收 |
| pages/mine/security | business/NativeBusinessUI.kt / Security + BusinessController.verifyOldPassword；原手机号+修改密码+旧密码输入与底部下一步；先POST me/password/verify，旧密码仅内存临时持有；无密码直接设置，忘记密码SMS找回。 | 代码中未登记额外差异；仍需运行验收 | 待验收 |
| pages/mine/reset-password | business/NativeBusinessUI.kt / reset-password + BusinessController.changePassword；新密码+确认，PUT me/password；change模式必须有已验证旧密码，返回/退出即清临时值。；两项密码均提供独立显示/隐藏按钮。 | 代码中未登记额外差异；仍需运行验收 | 待验收 |
| pages/mine/general | business/NativeBusinessUI.kt / general；原白底/菜单顺序、28r上下内边距/44r行高；真实缓存清理/重连/反馈/关于/调试探针入口；语言显示保持原静态提示。 | 代码中未登记额外差异；仍需运行验收 | 待验收 |
| pages/mine/feedback | business/NativeBusinessUI.kt / feedback + ImageAttachments；真实内容/联系方式/最多9张图片上传，POST feedbacks，错误保留可重试。 | 代码中未登记额外差异；仍需运行验收 | 待验收 |
| pages/mine/about | business/NativeBusinessUI.kt / about；恢复160r logo/32r标题间距/版本/检查更新/协议布局；只读GET public/app-release canary；拒绝WGT，APK须核验包名/签名/原生releaseFamily/递增版本再交系统安装。 | 后端现有canary/test/prod无独立应用标识维度；本轮不发布新记录，正式发行需先确定原生渠道和签名。 | 待验收 |
| pages/mine/emotions | business/NativeBusinessUI.kt / emotions；真实表情分页/上传/GIF动画预览、管理多选全选删除及二次确认；聊天自定义表情面板发送/添加/删除/管理已接真实接口。 | 代码中未登记额外差异；仍需运行验收 | 待验收 |
| pages/mine/debug | business/NativeDebugPage.kt + NativeDiagnostics.kt；复用当前已获得IM地址；App/API/File/OpenIM/WS与外站真实只读探测，最近10次API采样柱图、设备/网络/储存/媒体解码/权限/能力和本地库同步状态；STARTED生命周期每10秒采样、离页停止；脱敏PNG真导出/相册与摘要复制。 | 原Web浏览器能力字段改为原生设备/解码/权限能力；不额外签发IM token。 | 待验收 |

### iOS

| 旧路由 | 当前实现与行为 | 差异 | 真实运行验收 |
| --- | --- | --- | --- |
| pages/download/index | H5 external download page；原H5下载落地页不编入iOS客户端 | h5_only | 待验收 |
| pages/chat/index | SampleMainViewController.realAccount；SDK会话全分页、头像、未读过滤、搜索、全量已读、置顶/免打扰/隐藏会话 | 原H5桌面分栏不适用；iOS长列表和滑动手势尚未真机验证 | 待验收 |
| pages/auth/sign-in | LoginViewController；真实密码登录、Keychain恢复、刷新旋转、国家区号、协议、登录后进入单SDK owner | 登录逐像素和软键盘尚未验证 | 待验收 |
| pages/auth/sign-up | NativeAuthFlowController.register；短信注册、同意协议、密码确认、注册后资料完善 | 国家地区目前5项；需核对原版完整列表 | 待验收 |
| pages/auth/onboarding | NativeOnboardingController；真实头像上传、昵称15字、PATCH me、跳过 | 头像选择和小屏键盘视觉尚需优化验证 | 待验收 |
| pages/auth/forgot-password | NativeAuthFlowController.resetPassword；SMS、手机号步骤、设置新密码、第二步返回第一步、真实reset API | 原版梯度和间距尚未逐像素验证 | 待验收 |
| pages/auth/agreement | LegalViewController.agreement；加载原协议离线HTML、禁脚本、禁任意跳转 | 需核对正式发布文案及版本 | 待验收 |
| pages/auth/privacy | LegalViewController.privacy；加载原隐私离线HTML、禁脚本、禁任意跳转 | 需核对正式发布文案及版本 | 待验收 |
| pages/contacts/index | NativeContactsController；原搜索与3入口、群卡、联系人分页、排序、直接进入聊天 | 群卡展开/折叠细节尚未完全还原 | 待验收 |
| pages/mine/index | NativeMineViewController；原hero素材、头像昵称、资料入口、收藏设置、退出登录 | 仅原H5截图基准已保存；iOS像素一致性未验证 | 待验收 |
| pages/chat/room | NativeConversationViewController；SDK分页气泡、Outbox可靠发送、图片视频语音文件、相机、引用/@/置顶/多选/收藏/转发/撤回/删除/名片/合并查看 | 富回复条仍用输入提示；原emoji面板仍为原生选择器；历史定位旧新缓存间gap展示待核 | 待验收 |
| pages/chat/forward | NativeForwardPickerController；四类接收对象、媒体preserve、forward-batches、固定幂等键及atomic待确认恢复、任务管理 | 全部走服务端批次；未复刻少量text/image直接SDK快速路径 | 待验收 |
| pages/chat/image-viewer | NativeImagePreviewController；原生缩放、相邻图左右切换、保原字节相册保存、ownedLocal预览 | 动图32帧/12MB解码上限，超限显示首帧；帧延时按总时长均分 | 待验收 |
| pages/chat/video-viewer | NativeVideoPreviewController；AVPlayer播放、300MB有界下载保存Photos、离页暂停取消 | 原自绘视频控制条/分享布局未完全还原 | 待验收 |
| pages/chat/card-picker | NativeContactPickerController.selectionLimit=1；完整联系人分页和单选、resolver校验、真实SDKcard | 原卡片选择视觉未逐像素验证 | 待验收 |
| pages/chat/favorite-picker | NativeFavoritesController.onSelected；收藏分类分页、返回原类型文字/图片/视频/语音/文件消息 | 分类使用系统segmented外观 | 待验收 |
| pages/contacts/report-user | NativeReportController + NativeEvidenceFormController；动态举报理由、描述、9图上传、真实reports API | 理由和证据分两页，原版同页布局尚未完全还原 | 待验收 |
| pages/contacts/new-friends | NativeFriendRequestsController；真实申请sync、待处理与历史、接受拒绝 | 申请列表空/错误态和原卡片样式待真机对齐 | 待验收 |
| pages/contacts/add-friend | NativeAddFriendController；publicId搜索、扫码入口、资料查看及真实申请 | 原搜索卡片视觉待验证 | 待验收 |
| pages/contacts/add-group | NativeGroupsController.joinGroup；输入群号校验、真实join、需审核转join-requests | 复用原生字段编辑器，原专页插画/文案布局未完全还原 | 待验收 |
| pages/contacts/scan | NativeQRScannerController；AVCapture相机扫码、相册识别、只解析业务数据、离页迟到守卫 | 扫码动画/遮罩与原版尚未逐像素还原 | 待验收 |
| pages/contacts/scan-result | NativeQRResultController.user；真实resolve、friend/pending/blocked/self关系及真实好友申请 | 结果页卡片视觉待验证 | 待验收 |
| pages/contacts/scan-group-result | NativeQRResultController.group；resolve nextAction enter/join/apply、pending状态、真实qrcode join | 结果页卡片视觉待验证 | 待验收 |
| pages/contacts/user-profile | NativeContactController；先核对好友关系、用户资料脱敏groupId、加友/发消息/举报 | 原hero资料卡布局未完全还原 | 待验收 |
| pages/contacts/friend-detail | NativeContactController；真实好友详情、备注、标签、共同群、拉黑/删好友/聊天 | 原hero资料卡布局未完全还原 | 待验收 |
| pages/contacts/friend-common-groups | NativeCommonGroupsController；真实contact.commonGroups、群resolver后进入聊天 | 原列表视觉待验证 | 待验收 |
| pages/contacts/friend-remark | NativeContactController.editRemark；push原生字段编辑、PATCH contact remark | 原计数和输入约束细节待核 | 待验收 |
| pages/contacts/friend-tags | NativeTagsController(contactID)；真实tag选择、联系人tagIds保存 | 原复选chips布局未完全还原 | 待验收 |
| pages/contacts/tag-detail | NativeTagMembersController；真实标签成员、备注重命名、批量成员编辑 | 原标签详情视觉待验证 | 待验收 |
| pages/contacts/tag-add-members | NativeTagMembersController；完整联系人分页、多选、PUT tag members | 原添加成员视觉待验证 | 待验收 |
| pages/contacts/tags | NativeTagsController；真实标签列表、新建/改名/删除、成员管理 | 原布局待验证 | 待验收 |
| pages/contacts/groups | NativeGroupsController；真实群分页、创建、加入、群资料 | 原展开和分类筛选细节未完全还原 | 待验收 |
| pages/group/create | NativeGroupsController.createGroup；完整联系人选择、名称编辑、真实POST groups | 原一页创建布局拆为选择+名称页 | 待验收 |
| pages/group/detail | NativeGroupController；真实群详情、权限、头像/名称/群号/备注/昵称、QR、公告、媒体、管理、退出 | 群成员宫格和原资料卡未完全还原 | 待验收 |
| pages/group/members | NativeGroupMembersController；真实40分页、资料、成员备注、角色/禁言/移除与删除消息 | 禁言时长仅提供1小时，原更多时长交互待补 | 待验收 |
| pages/group/invite | NativeGroupController.invite；联系人选择、真实group invitations | 普通成员入口权限和原版需继续核对 | 待验收 |
| pages/group/admin | NativeGroupAdministrationController；真实管理开关、管理员、申请入口 | 通用原生行布局尚未逐像素验证 | 待验收 |
| pages/group/admins | NativeGroupAdministratorsController；完整成员分页筛管理员、群主添加/撤销管理员 | 原管理员页视觉待验证 | 待验收 |
| pages/group/admin-add | NativeGroupAdministratorsController；真实普通成员选择、PUT member role | 原多选交互未完全还原 | 待验收 |
| pages/group/join-requests | NativeGroupRequestsController；真实申请列表、approve/reject | 原批量/分组视觉待核 | 待验收 |
| pages/group/edit-name | NativeGroupController.editName；push原生字段编辑、settings/update | 输入字数与原页样式待核 | 待验收 |
| pages/group/edit-group-id | NativeGroupController.editPublicID；publicIdChangeUsed限制、一次修改确认、真实public-id/update | 原前缀不可改/计数提示尚未还原 | 待验收 |
| pages/group/announcement | NativeAnnouncementsController + NativeAnnouncementEditor；真实公告列表/详情、文本+9图上传、保留旧图、缩略图、编辑删除 | 长公告列表cell仍截断预览，详情原排版待完善 | 待验收 |
| pages/group/remark | NativeGroupController.editRemark；原生字段编辑、真实PUT group remark | 原计数与间距待核 | 待验收 |
| pages/group/qrcode | NativeQRCodeController；真实群QR payload、CoreImage二维码、系统分享 | 原卡片和过期刷新布局待核 | 待验收 |
| pages/group/my-nickname | NativeGroupController.editMyNickname；原生字段编辑、真实PUT group/me/nickname | 原计数与间距待核 | 待验收 |
| pages/group/media | NativeSearchController.initialTypes；SDK媒体类型查询、40分页、图片/视频/文件预览 | 原媒体网格当前为列表，视觉未完整还原 | 待验收 |
| pages/group/search-history | NativeSearchController；真实SDK会话查询、40分页、定位消息或媒体预览 | 类型控件和列表视觉不同 | 待验收 |
| pages/group/report | NativeReportController.group；群6类理由选择 | 原分类页视觉待核 | 待验收 |
| pages/group/report-submit | NativeEvidenceFormController.groupReport；5至200字、9图、真实groups/reports | 原文字/图片区间距待核 | 待验收 |
| pages/group/leave | NativeGroupController.leave；区分群主解散与成员退出、明确确认、真实API | 用系统确认弹窗替代原确认专页 | 待验收 |
| pages/mine/profile | NativeProfileController；头像上传、昵称/签名编辑、手机、聊天号复制、QR、注销 | 原版分组已按源还原，iOS像素与键盘待验 | 待验收 |
| pages/mine/account-deletion | NativeAccountDeletionController + NativeDeletionVerifyController；预览阻塞项、短信delete_account、确认文字、真实不可逆请求、独立本机清理 | 多步骤布局与原版不同；无真实测试账号不可执行验收 | 待验收 |
| pages/mine/edit-nickname | NativeProfileController.nickname；原生字段编辑、PATCH me | 字数计数视觉待核 | 待验收 |
| pages/mine/edit-chat-id | NativeProfileController.publicID；一次修改确认、PUT me/public-id | 原规则提示和计数未完全还原 | 待验收 |
| pages/mine/edit-bio | NativeTextEditorController；原生多行编辑、PATCH me bio | 原最大字数和计数待核 | 待验收 |
| pages/mine/qrcode | NativeQRCodeController；真实me/qrcode、CoreImage二维码、系统分享 | 原卡片与过期刷新布局待核 | 待验收 |
| pages/mine/favorites | NativeFavoritesController；真实20分页/分类、会话日期分组、缩略图、预览、转发原消息核对、复制/确认删除 | segmented和系统菜单外观不同；非媒体文本4行截断；原无多选 | 待验收 |
| pages/mine/notifications | NativeSettingsController.notifications；原白底96r行/40r边距、两section黑字/横线、真实本机开关联动前台通知 | 后端LoggingPushService为日志桩，后台APNs和语音邀请服务未接通 | 待验收 |
| pages/mine/chat-settings | NativeSettingsController.chat；原白底4连续行、回车发送、群发/表情、真实全会话清历史 | 清历史失败中止明确提示，未复制旧端静默仅清本地降级 | 待验收 |
| pages/mine/mass-assistant | NativeMassAssistantController；真实历史atomic own file、复用目标再建新群发、结果核对 | 原群发记录卡片视觉未完全还原 | 待验收 |
| pages/mine/mass-select-contacts | NativeMassTargetPicker；recent/联系人/群/标签、完整分页、搜索、多选 | 原四tab视觉未逐像素验证 | 待验收 |
| pages/mine/mass-compose | NativeMassComposeController；文字/多图/语音/文件、编辑目标、先持久record再发送、取消退出停止 | 群发录音预览交互需继续对照；当前附件列表简化 | 待验收 |
| pages/mine/mass-targets | NativeMassTargetPicker；编辑接收对象、真实数据与去重 | 原接收对象独立页当前复用选择器 | 待验收 |
| pages/mine/privacy | NativeSettingsController.privacy；真实GET/POST privacy、确认后开关状态、黑名单入口 | iOS与原白底行间距仍待验证 | 待验收 |
| pages/mine/blacklist | NativeSettingsController.blocked；真实blocked列表、解除拉黑 | 目前limit100无更多页，需核后端分页能力和大列表 | 待验收 |
| pages/mine/security | NativeSecurityController；原手机展示、旧密码眼睛、下一步、verify后新密码两字段和确认、仅闭包内持旧密码 | 原成功toast样式未复刻；刷新profile和返回场景需Mac验 | 待验收 |
| pages/mine/reset-password | NativeSecurityController.step1；新密码/确认密码、6字匹配、真实PUT me/password、返回清秘密 | 原页面用同controller步骤，返回栈语义需真机核对 | 待验收 |
| pages/mine/general | NativeSettingsController.general；7连续白底原行、反馈/关于/图片缓存清理/重连/诊断，语言显示模式维持原提示 | 重新选线当前对现有SDK networkChanged重连，未虚构测速服务 | 待验收 |
| pages/mine/feedback | NativeEvidenceFormController.feedback；联系方式64、内容200、1图、上传后真实feedbacks | 原纸张与示例插图未完全还原 | 待验收 |
| pages/mine/about | NativeAboutController；原logo/名字/版本/检查更新/协议、GET public/app-release canary只读 | 现有发布无应用identity，不能认定旧IPA/WGT兼容；原生AppStore/TestFlight发布待配置 | 待验收 |
| pages/mine/emotions | NativeEmotionsController；真实列表/原GIFWebP字节上传/多选删除/图片预览或SDK发图 | 当前只取100条需分页扩展；动图遵守有界内存策略 | 待验收 |
| pages/mine/debug | NativeDiagnosticsController；SDK版本/状态/会话/Outbox专用诊断，安全摘要、手动核对、真实forward tasks | 原uniapp JS调试字段不适用iOS，原生诊断有意替换 | 待验收 |

## Mac 验证和打包

使用配套 IM-iOS-0.3.0-mac-check.zip，在 Mac 解压后运行 bash IM-APP-ios/scripts/verify_on_mac.sh。它执行 Swift 核心测试、固定依赖安装与无分发签名的模拟器 Debug 编译，不发布。通过后用 Xcode 打开 workspace，再连接 iPhone 验证数据库、同步、媒体权限和前后台恢复。详见 docs/iOS-Mac验证步骤.md。

正式 Android APK/AAB 使用 Gradle 与团队正式签名；iOS 使用 Mac Xcode Archive → TestFlight/App Store。此阶段 staging 身份与 Debug 包独立于生产应用，不能拿它证明原地升级与旧本地库迁移成功。具体签名、分发、后端兼容发布和回滚顺序保留在原生重构方案中。

不再使用 uni-app 云打包来构建这两套原生工程。前后端已有服务可继续复用，客户端安装包不需要“部署到后端”才能运行。

## 截图证据

HTML 内嵌旧 H5 真实页面基准与原生合成数据截图。旧 H5 页面在本地拦截接口、阻断外网后渲染，原生用测试 APK 注入本地资料；这些均不是生产账号截图。测试横幅、状态栏、导航栏及头像测试图不参与像素一致结论。

尚未获得真实受控账号结果与 Mac/Xcode 结果时，不得标注全部功能完成、iOS 同步故障已解决或性能达标。
