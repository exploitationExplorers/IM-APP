# iOS 免打扰、表情添加与交互回归

日期：2026-11-18。基线：`08fbf23`，分支：`codex/native-bootstrap`。本轮未提交或推送。

## Android 对照与修复依据

- `IM-APP-android/.../UniParityUI.kt` 会话行在时间下显示“免打扰”；iOS 原先缺少该提示，本次补齐并为角标预留空间。
- Android `NativeChatUI.addSticker` 在准备开始就设置 preparing，原图准备在 Dispatchers.IO 执行；`ChatController.addSticker` 在 businessIO 上传并登记表情。Android 同样需要上传和业务确认，不能仅凭代码认定任何网络下都秒完成。
- iOS 原路径同步读取并拼装上传 Data，且只有最终通知。现将原图验证/读取和 multipart 拼装移到后台，复用精确原图缓存；不使用缩略图冒充原图，不改写未知签名。按准备、上传、确认上传、加入表情包显示阶段进度。
- 表情登记成功后将本地原图种入当前账号/环境的图像缓存，避免面板再次下载刚上传的文件。缓存写入携带开始时的 mutationEpoch，取消、退出账号和迟到回写均有检查。
- 原有业务列表把 spinner 放在 table.backgroundView，已有内容时难以看见。现在操作与加载共用明确的浮层；离开页面移除，仍在执行的业务任务返回页面时恢复提示。聊天页返回时取消页面操作并移除提示。
- SDK 设置成功后只查询和合并当前会话；群/好友详情直接更新对应设置行，避免重新加载全部会话和整页业务信息。回写核对账号代次，并保留等待期间更新的 SDK 事件。

## 模拟器额外复现的开关缺陷

在旧构建的群详情，点击免打扰蓝色轨道中心无效果；点击轨道左侧留白可以保存并切为关闭。`NativeParityToggle` 内的装饰 track 是默认可交互 UIView，命中它时外层 UIControl 收不到 touchUpInside。

修复将 track.isUserInteractionEnabled 设为 false，让完整轨道的触摸交给 UIControl。该共用控件同时覆盖免打扰、置顶等业务开关。未修改 SDK 设置语义。

## OpenIM 官方文档与固定 SDK

核对的官方 iOS 文档：

- https://docs.openim.io/sdk/ios/conversation/managing-conversations/set-message-receive-option
- https://docs.openim.io/sdk/ios/conversation/managing-conversations/pin-conversation

免打扰使用 setConversationRecvMessageOpt，0 为正常接收，2 为接收消息但不通知。置顶使用 pinConversation:isPinned。两者成功后合并当前会话、监听 onConversationChanged，并可按当前会话查询校准。本项目 Podfile.lock 固定 OpenIMSDK `3.8.3-hotfix.15`，正式 `OIMManager+Conversation.h` 与上述 selector 一致；继续复用现有桥，未修改 Pods 或升级依赖。

表情包登记使用项目业务 API `/files/uploads` → 对象存储 → `/files/uploads/complete` → `/stickers`，不是 OpenIM 自带的“收藏表情”接口。上传请求继续隔离业务 Authorization，保持原始二进制和表单签名值。

## 已执行的模拟器回归

设备：Xcode Device Hub 的 `IM-iOS-Refactor-20261117`，iOS 27.2。覆盖安装本地签名 Debug App，保留 SDK 数据和已授权测试账号登录态，未保存账号凭据到本记录。以下均实际操作，没有用 mock 替代 SDK。

| 流程 | 结果 |
| --- | --- |
| 启动恢复 | 已连接、本地可读、同步完成 |
| 免打扰 UI | 首页时间下显示“免打扰”，摘要正常；聊天菜单、群详情状态一致 |
| 免打扰切换 | 聊天菜单关闭/开启；修复后群详情轨道中心点击能保存。最终恢复开启 |
| 置顶切换 | 群详情轨道中心开启后再关闭，状态保存；最终恢复关闭 |
| 群详情 | 群标题可以打开详情，成员和设置加载完成 |
| 表情添加 | 图片长按 → 加入表情包，实际看到旋转指示和“正在上传表情…”；完成后浮层消失，表情面板显示新增图片 |
| 表情发送 | 从面板发送新增图片，聊天最新消息显示图片和成功勾号；普通文字、emoji 发送也已验证 |
| 操作中返回 | 上传提示出现时点击返回，首页无残留浮层；重进群聊可继续浏览 |
| 历史滚动 | 修复构建上向上/向下翻历史及“最新”跳转正常；文字、图片、时间和撤回提示未见错位；表情面板开合保留上滑位置 |

操作中返回仅表示取消页面后续工作，不声称撤回已被服务端接受的上传或登记。没有执行删除聊天、审批、移除成员或解散群。

上一轮群申请对齐记录见 `../ios-android-join-parity-20261118/README.md`，保留该轮改动。本轮服务端待处理申请数已变化，没有重复制造申请或执行审批。

## 性能证据与边界

修复前对真实聊天历史上下滚动采样 30 秒，主线程栈出现 NativeMessageCell.dimensions 的文本 boundingRect 和 layoutSubviews 内日期格式化。现同一次配置/宽度缓存测量结果，媒体尺寸变化时失效；时间在配置时格式化。未发现可证明的长期主线程死锁。

最终构建再次滚动检查无明显布局回归。另一次 15 秒进程采样以主线程空闲栈为主，未覆盖足够活跃滚动样本，不能用来计算前后帧率或耗时收益。本轮不宣称全部卡顿消失或性能提升百分比。原图首次下载、对象存储上传及服务端登记仍受网络和文件大小影响；没有 Android 真机同文件同网络基准，不能宣称比 Android 快或固定秒完成。

## 工程验证

- IMCore：168 项测试，0 失败。新增对象存储编码测试覆盖二进制原样、multipart 字段/签名、PUT、业务认证隔离及 CRLF 注入拒绝。现有群申请行为测试也通过。
- `python3 IM-APP-ios/scripts/verify_project.py`：8 项检查通过。
- `git diff --check`：通过；临时 IMStickerProbe/IMRenderProbe 已移除。
- Simulator Debug 本地签名构建：BUILD SUCCEEDED。保留 CODE_SIGNING_ALLOWED=YES、CODE_SIGN_IDENTITY=-。
- 根据 oil-code-review 技能执行独立只读五维审查及增量复审：PASS。返回页面时恢复 working 提示的建议已落实。
- 工程仍有既存 UIKit 弃用和 Swift 并发隔离警告；本轮未解除 Release/Archive 门禁。未验证真机、后台推送、发布包或完整端到端网络故障矩阵。

精简构建/测试证据见 `checks.log`。含聊天和模拟器路径的原始性能/诊断日志不纳入仓库。
