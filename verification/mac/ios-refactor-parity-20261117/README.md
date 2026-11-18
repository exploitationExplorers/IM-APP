# iOS Android 功能对齐与职责重构验证

日期：2026-11-17。分支：`codex/native-bootstrap`。本次先 fetch，随后从 `9cc3a5e` 快进至 `4da7eca8bc0e2fedcecf3ce82cd0c114c00589af`，保留工作区已有 iOS、音频和渲染修改。没有提交、推送、部署或发布。

同日后续已完成部分授权账号运行验证，见 [模拟器账号验证记录](account-runtime.md)。真实登录、SDK 同步、群历史/图片、引用草稿、申请角标/明细、邀请入口取消与重启登录恢复通过；后文“没有输入账号”指最初启动检查。另发现并修正模拟器运行构建关闭签名导致 Keychain `-34018` 的问题；最新本地签名编译日志为 `simulator-signed-build.log`。其余真实发送、审批、邀请提交和真机验收仍未完成。

## 远端差异与落地

| Android 提交 | 功能 | iOS 处理 |
| --- | --- | --- |
| `154c8f4` | 引用图片和视频展示 | 独立 MessageQuoteReference，兼容两种命名、空 element、JSON content 和嵌套 element；缩略图优先，排除发送者本机路径，保留签名参数 |
| `0a3a828` | 引用卡片与发送流程 | 保留原消息 ID，Outbox 先持久化及展示，再调用 forward-media/preserve；保护后的内容原子替换到未提交项，之后才调用 SDK；失败可显式重试，未知结果不自动重发；草稿持久化后解除输入锁，旧回调不能解锁新提交 |
| `4da7eca` | 群申请角标、邀请与成员管理 | 首页合并待审核申请和未读；只有免打扰消息时显示圆点；群详情每 5 秒、首页每 10 秒在前台可见期间对账；失败保留旧数、停止后拒绝迟到结果；群详情“＋”直接邀请，群成员页保留新增与原生操作菜单，管理员不能操作其他管理员，保留禁言档位与移除选项 |

对齐的是业务能力与约束。iOS 成员操作继续使用原生 action sheet，不复制 Android Compose 控件。后端仍是最终权限判断方。

选人页返回时会先触发父页自动加载、再执行选择回调。详情页与成员页跳过此次自动加载，避免抢占 perform 入口导致邀请提交被忽略；邀请完成后再刷新。

## 架构调整

- `QuoteMessagePreparation`：引用消息的发送前保护流程，不依赖 UIKit/SDK。
- `MessageQuoteReference`：引用展示值与遗留字段的集中映射。
- `PersistentOutbox.replaceUnsubmittedPayload`：仅允许 prepared/failed 的稳定 ID 内容修复，禁止 sending/uncertain 回退。
- `ComposerSubmissionGate`：按提交身份管理草稿持久化窗口，防止重复提交和迟到完成污染新草稿。
- `AccountMediaStore`：账号自有媒体路径、文件保护与后台大文件复制；不触碰 SDK 历史库。
- `NativeForwardDeliveryCoordinator`：转发提交、结果核对、图片缓存重绑，生命周期由账号 owner 管理。
- `ForwardSubmissionLedger` actor：后台串行日志读写，沿用旧 JSON 格式；退出等待 stop，禁止旧任务继续写入。
- `PendingJoinRequestMonitor`：可注入加载与等待的刷新状态，取消及代次检查在同一边界维护。
- `NativePendingJoinRequests`：UIKit 前后台生命周期适配。
- `NativeComposerQuoteView`、`NativeCountBadge`：独立可复用展示组件。
- 转发选择页面与消息菜单/文字选择工具从聊天控制器分离；页面消费类型化转发记录，不直接解码日志文件。
- iOS `AGENTS.md` 增加：涉及 OpenIM 时先查官方 iOS 文档，再核对固定版本头文件。

本次没有改变 SDK 单 owner、SDK 历史库所有权、账号隔离、Outbox 未知结果核对和 Release/Archive 门禁。现有巨型服务仍保留 SDK 生命周期、历史加载等职责，不能声称整个仓库已全面满足新规范；也没有做无关全库格式化。部分旧媒体同步写入入口、UIKit 废弃属性和 Swift 6 迁移警告仍需后续治理。

## SDK 文档核对

先查官方文档，旧地址已返回 404；从官方首页发现迁移后的有效路径，再读取正文。不是依赖 Android 方法名推测 iOS：

- https://docs.openim.io/sdk/ios/message/creating-messages/create-quote-message
- https://docs.openim.io/sdk/ios/message/sending-messages/send-message
- 本地固定版本：`OpenIMSDK 3.8.3-hotfix.15`，Core 来源以现有 Podfile/lock/自维护 podspec 为准，没有升级 SDK。
- 固定头文件：`IM-APP-ios/Pods/OpenIMSDK/OpenIMSDK/Interface/OIMManager+Message.h`；同时核对同目录 `.m` 实现及项目 `NativeOpenIMBridge.m`。
- 引用构造使用 `+[OIMMessageInfo createQuoteMessage:message:]`；构造本身不发送，后续经过项目 Outbox 调用实际 `sendMessage:...`。
- SDK success 按服务端接受处理，不当作对端已读或已到达；单聊 recvID 与群聊 groupID 不混用。
- 媒体副本保护是本项目业务后端的 `POST /forward-media/preserve`，不是虚构 SDK 方法。核对了现有服务端快照与群申请接口契约。

## 验证记录

- 工程静态检查：8 项通过，包括所有 App 源文件实际进入 build phase、共享样本及发布阻断。
- IMCore XCTest：153 项通过、0 失败；本轮新增 16 项有行为意义的回归用例。
- iOS Simulator Debug：`BUILD SUCCEEDED`，使用真实固定 SDK，无分发签名。
- iPhone arm64 Debug：`BUILD SUCCEEDED`，使用真实固定 SDK，`CODE_SIGNING_ALLOWED=NO`；这是设备架构编译链接，不是真机运行。
- 独立新建模拟器：iPhone 18 Pro / iOS 27.2，安装后启动成功，登录页截图为 `login-smoke.png`。没有输入账号，没有调用真实登录或发送消息；没有清理已有模拟器数据。
- Xcode：27.2（27B52）；部署下限保持 iOS 15。
- `git diff --check` 通过。

回归测试覆盖：旧字段及 JSON content 引用封面、签名 URL 保真、本机路径拒绝、受保护内容保留 ID、类型/原消息身份变化拒绝、保护失败传播、Outbox 禁止回退、账号媒体与符号链接边界、群角色矩阵、计数上限与去重、刷新单循环/失败/迟到、旧发送完成不解锁新提交、转发幂等键冲突/重启/损坏文件保全/旧 owner 停写。

## 待真实账号及 iPhone 回归

1. 与旧 uni-app / Android 互发引用图片、视频及 @ 引用；确认封面、正文、原消息定位和服务器副本保留。
2. 媒体保护接口失败后点击原气泡重试，确认使用同一 clientMsgID；断网与强杀后未知结果先核对。
3. 发送完成前继续编写下一条消息，确认旧 ACK 不清理新草稿，不重复提交。
4. 管理群出现新申请时检查首页与详情角标；审批后返回检查计数，后台/前台和退出切号检查旧结果不回写。
5. 群详情“＋”及成员页新增邀请，包括取消选择与确认选择；普通成员、管理员、群主分别验证可操作目标。
6. 转发提交后退出页面、切号、重启，检查旧批次保留、迟到写入拒绝及结果核对。
7. 锁屏、前后台、真机权限和媒体播放/保存；APNs 与覆盖升级迁移另行验收。

启动截图、核心规则测试与编译不能证明上述真实业务流程已通过。日志仍包含存量编译警告，没有将其忽略后声称“零警告”。
