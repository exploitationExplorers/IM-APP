# iOS 聊天角标与近期媒体缓存验证

2026-11-18，分支 `codex/native-bootstrap`。先提交原工作区 `cf866e0`，再将远端的 `0eeb68c` 和 `d59726d` 合入 `137dbdc`。

- `0eeb68c` 将入群审核和底部聊天未读分开。iOS 底部只显示普通会话的未读数。仅有免打扰未读时显示红点。群会话和详情继续显示各自的待审核提醒。
- `d59726d` 增加当前会话媒体预取。iOS 默认开启自动缓存和仅 Wi-Fi 两项设置。只处理当前聊天页已加载且可见的消息，不读取 SDK 数据库。每个会话最多选取 200 条近期媒体消息。私聊按消息时间保留最多 14 天，群聊最多 7 天。持久缓存合计上限 512 MiB。
- 图片缩略图和原图各限 16 MiB，语音限 32 MiB，视频封面限 16 MiB。视频和文件需有有效大小，分别限 20 MiB 和 5 MiB。媒体缓存按账号和环境区分，清理入口位于「我的 → 通用 → 清除缓存数据」。
- 模拟器复现聊天设置开关轨道拦截触摸。聊天和通知设置改用群详情已修复的共用开关。第三方签名与未知媒体路由保留原始参数和编码。

实现前查阅了 [OpenIM iOS 拉取更早的消息](https://docs.openim.io/sdk/ios/message/retrieving-messages/load-older-messages) 和 Apple 的 [NWPathMonitor](https://developer.apple.com/documentation/network/nwpathmonitor)、[allowsCellularAccess](https://developer.apple.com/documentation/foundation/urlsessionconfiguration/allowscellularaccess) 及 [URLSession 下载代理](https://developer.apple.com/documentation/foundation/urlsessiondownloaddelegate)。项目固定 OpenIMSDK `3.8.3-hotfix.15`，对应头文件提供 `videoSize` 和 `fileSize`。沿用现有消息加载链路，在桥接层传递大小。

`git diff --check`、8 项工程静态检查、172 项 IMCore 测试及签名 Debug 模拟器构建通过。回归包含时间窗口、状态过滤、大小、重复资源、账号隔离和签名保真。

使用 iOS 27.2 专用模拟器 `IM-iOS-Refactor-20261117` 覆盖安装 Debug。登录态恢复并完成同步。两个普通会话各有 2 条未读，底部显示 4，免打扰会话显示红点。实际切换两个缓存开关并恢复默认值。进入近期媒体会话后观察到 13 个 JPEG 资源写入持久缓存，打开图片时核对到了缓存访问时间更新。视频预览实际显示画面，本次样本未证实写入持久缓存。

专用模拟器的控制中心没有提供可用的网络开关。本次未证实断网后播放视频或语音、打开文件及 Wi-Fi 切换时的行为。清理入口未对测试账号实际执行缓存删除。
