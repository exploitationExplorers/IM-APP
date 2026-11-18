# Xcode 控制台音频警告修复（2026-11-17）

用户反馈登录、进入群聊时刷屏，且从未录音。截图有两类内容：重复的 `cannot add handler to 0 from 0 - dropping`，以及 `AVAudioSession_iOS.mm:978` 提示主线程同步启停可能导致 UI 无响应。

## 定位与修改

聊天页 `viewWillDisappear`、取消语音，以及群发页退出等路径原来无条件同步执行 `AVAudioSession.setActive(false)`，即使页面从未使用音频。录音和试听的启用也在主线程上进行。这些代码与截图的音频性能警告吻合；并不能证明截图中另一条 handler 日志也来自这里。

- 新增共享 `AudioSessionCoordinator` actor，后台串行执行配置与启停；不在 MainActor 上执行系统音频切换。
- 每次音频使用以 UUID 标识 owner。没有申请过会话的页面不触发停用；旧 owner 的迟到清理不能停掉新 owner 音频。
- 页面退出、取消或松开手指时取消待完成启动，权限/激活回调返回后再次检查页面和操作状态。
- 试听完成、出错或准备发送时停止播放器并释放该页面音频。更换录音/试听用途时先释放前次租约。
- 客户端修订号更新为 `20261117-ui7`。没有修改后端、SDK 版本、签名、登录和本地聊天库；没有压制控制台日志。

## 验证

- Swift IMCore：137 项测试通过，0 失败；新增 6 项覆盖空闲释放、后台线程、重复释放、旧 owner、启动前取消、激活中取消和激活失败（部分测试覆盖多个分支）。使用假驱动验证切换，不在测试中采集麦克风。
- 工程静态检查：8 项通过；`git diff --check` 通过。
- Simulator / iPhone Debug 无签名构建通过，两个二进制均含 ui7 标记；摘要见 `result.json`。本次编译仍有原有弃用/并发警告，不宣称编译零警告。
- Xcode 首次编译受 SwiftPM 清单诊断缓存权限限制，获准标准编译缓存写入后完成构建。CoreSimulatorService 和统一日志读取仍受当前工具沙箱限制；没有把这些工具错误当成 App 错误。

## 尚未验证

没有在本轮直接操作原生模拟器，不能证明运行时警告已经全部消失。已安装包的修订号见 `result.json`，构建完成不等于已安装或已启动新进程。

`cannot add handler…` 没有线程、调用栈或系统组件名。当前源代码、App 与 OpenIM 二进制未找到该文本；单凭字符串不能确定责任模块。未通过关闭系统日志或删除 SDK/用户数据处理它。

在 Xcode 打开 `IM-APP-ios/IMNative.xcworkspace`，停止旧进程后重新 Run；在“我的 → 通用 → 调试资讯”确认 ui7。清空控制台显示后，仅登录并反复进出群聊；再分别验证录音、取消、试听、退出页面和快速松手。检查是否仍出现音频主线程警告，以及 handler 日志是否伴随卡顿、崩溃或功能失败。涉及真实消息发送需使用明确的测试对象。

本次改动尚未提交或推送。

## 依据

已核对本机 Xcode 官方 SDK 的 `AVFAudio.framework/Headers/AVAudioSession.h`（Activation 分类）：音频激活是耗时操作，停用前必须先停止播放器和录音 I/O；新系统也提供异步激活/停用 API。本次保留 iOS 15 兼容性，将现有同步 API 移到后台串行执行。

官方文档入口：`https://developer.apple.com/documentation/avfaudio/avaudiosession`。文档网页在当前检索中未返回可用正文，本次方法签名和可用性以本机 SDK 头文件与实际编译为依据。没有找到可据以确认 handler 日志来源的官方说明。
