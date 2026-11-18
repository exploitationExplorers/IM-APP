# 原生控制台诊断与回归（2026-11-17）

本轮通过本会话的 cua_repl 原生接口读取 Xcode 窗口、输入 LLDB 命令并操作 Device Hub 的 iPhone 18 Pro / iOS 27.2 模拟设备。没有使用浏览器截图冒充原生验证。首次 Xcode 连接超时，重试成功；旧 Simulator bundle ID 不存在，实际设备窗口由 Device Hub 承载。未修改后端或旧前端，未清理 SDK 库、缓存或登录资料，未提交或推送。

## 实际调用栈

在 ui7 进程的系统错误分支直接暂停后取得：

```
CA::Transaction::add_commit_handler + 528
UIViewController setNeedsStatusBarAppearanceUpdate + 268
UIViewController _updateSystemAppearanceWithRecursionBlock:action:
UIViewController setNeedsStatusBarAppearanceUpdate block
CA::Transaction::run_commit_handlers
CA::Context::commit_transaction
CA::Transaction::commit / flush
UIApplicationFlushCATransaction
```

此样本是 UIKit 状态栏更新在事务提交回调中再次注册处理器；不是 SDK 网络请求栈。项目 SampleMainViewController.refreshTab 原来在 SDK 通知、搜索、未读刷新和切页时均无条件请求状态栏更新。调用栈本身没有证明所有同文日志都由这一处造成。

```
CVPixelBufferCreate + 936
CMPhotoSurfacePoolCreatePixelBuffer
CMPhotoScaleAndRotateSessionTransformImage
CMPhotoDecompressionContainerCreateImageForIndex
ImageIO AppleJPEGReadPlugin copyIOSurfaceImp
AppleJPEGReadPlugin createImageBlockSetWithHardwareDecode
CoreGraphics CGContextDrawImage
ImageIO IIOImageSource::createThumbnailAtIndex
CGImageSourceCreateThumbnailAtIndexEx
NativeImageCache.decode bitmap (NativeMedia.swift:262)
NativeImageCache.cachedImage
NativeRemoteImageView.load
```

实际命中后台 cooperative executor 的头像 JPEG 缩略图解码。继续执行后在 NativeMedia.swift:264 暂停，证明通过 first 非空校验并成功构造 UIImage；LLDB 查询 first.width=192、first.height=256。系统硬件路径缓冲失败后有成功回退，不能把该日志直接当作图片丢失或 App 崩溃。本轮未引入私有 ImageIO 解码开关，未改写图片 URL 或清理缓存。证据只包含必要符号和尺寸，不复制 LLDB 自动展示的账号、媒体地址或本地私密路径。

## ui8 修改

- refreshTab 不再无条件请求状态栏样式更新；selectTab 仅在 preferredStatusBarStyle 真正改变时请求。
- 会话表格隐藏或尚未入窗时更新数据并 reloadData，不强制计算可见行布局。此前控制台有 SampleMainViewController 的 UITableView 离窗布局警告。
- 修订号 20261117-ui8。保留先前 ui7 音频修复，未扩大改动到媒体解析、SDK owner 或发布门禁。

## 实际验证

- 工程静态检查 8 项通过；git diff --check 通过。
- Xcode 对现有 IMNative.xcworkspace / IMNative Scheme / iPhone 18 Pro 执行 Run，成功编译并启动 ui8 新进程。
- ui8 首次启动控制台仍有 1 条 handler 与 JPEG 像素缓冲日志；没有宣称全部消失。
- 清空控制台显示（不改变日志开关）后，执行通讯录四次辅助功能滚动、切回聊天、进入群聊、两次上翻历史、返回聊天。随后完整 Console 值中 handler=0、UITableView 离窗布局=0、音频主线程阻塞警告=0、JPEG pixel buffer 日志=1（504×378 RGBA）。
- 本轮没有录音、试听、发送消息、相册保存、真机、性能基准或全量页面回归；未将此前 137 项核心测试写为本轮重跑。未保留用户聊天截图或完整原始日志。

剩余 JPEG 警告定位到此模拟 runtime 的系统 JPEG/CMPhoto 解码路径，仍待真机及其他 runtime 对照，不能据此直接认定所有系统版本均正常。启动时单条 handler 的具体入口尚未独立捕获。
