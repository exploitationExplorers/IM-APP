# 群标题入口与媒体连接复用（2026-11-18）

## 根因与范围

模拟器在“初心帮”点击标题无响应。iOS `heading` 是未绑定动作的 UILabel，而 Android `NativeChatUI.kt` 的标题 Column 调用 `callbacks.onOpenDetails`。现有 iOS `openDetails` 只在更多菜单中可达。修复将标题绑定到同一路由，补充无障碍按钮语义；多选状态不跳转，加载期间防重复，页面离开取消请求并在导航前核对页面及账号仍有效。

图片对照发现：Android `MediaHttp.images` 使用共享 OkHttpClient；iOS `NativeBoundedDownload` 为每个下载实例创建 URLSession 并在请求完成后失效，导致同域连接不能复用。共同下载器用于头像、聊天图、预览及文件；在此源头统一改为无 Cookie、无凭据存储、无 URLCache 的共享 ephemeral 会话，每个 task 保持独立 delegate、大小限制、取消及 HTTPS 跳转检查。已有图片缓存、降采样和账号缓存键不变。

这是已确认的一项额外开销，不是对所有图片慢的完整归因。当前模拟器历史图片已有缓存，未清理用户缓存；没有生产 CDN 冷缓存前后耗时或 Android 真机同网对照，不能宣称固定提速比例。

## 文档核对

- OpenIM：https://docs.openim.io/sdk/ios/message/creating-messages/create-image-message-by-url
- Apple：https://developer.apple.com/documentation/foundation/urlsessiontask/delegate （官方 JSON 元数据确认 iOS 15.0 引入，与项目最低版本一致）

官方图片结构区分 sourcePicture 原图、bigPicture 大图、snapshotPicture 缩略图；已核对固定 OpenIMSDK 3.8.3-hotfix.15 的 `Model/OIMPictureElem.h`。现有聊天气泡已优先 thumbnail，缩略图按列表规格处理，无需用原图替代或修改 SDK。官方文档通过 curl 读取，网页搜索工具未返回正文。

## 可重复对照

`transport-fixture.py` 仅监听本机并返回 1024 字节假数据。before/after Swift 探针提取实际 NativeBoundedDownload 实现；仅在临时探针内将 HTTPS 条件改成 HTTP 以访问本机 fixture，生产代码仍限制 HTTPS。因此该探针验证连接复用、大小限制和取消隔离，不验证 TLS/重定向。

运行 fixture 后，用 `xcrun swiftc -parse-as-library transport-before.swift -o /tmp/im-transport-before` 和对应 after 文件编译，再运行两个可执行文件。修复前四个请求 reused 均 false；修复后首次 false，后续三次 true。after 同时验证超限响应拒绝、取消请求报错且其他请求仍成功，详见 transport-after.log。公开站点的 URLSession 探针曾超时，因此没有将其作为性能数据。

## 验证结果

- 159 项 IMCore 测试通过，0 失败，见 core-tests.log。
- 8 项工程检查通过，git diff --check 通过。
- Simulator Debug 本地签名构建成功，见 simulator-build.log。
- 独立模拟器 IM-iOS-Refactor-20261117 / iOS 27.2 保留账号与数据安装新构建；SDK 已连接且同步完成。
- 点击“初心帮”标题打开群组详情，实际显示成员（17 人）、头像、群名称和公告；返回后聊天历史图片、头像正常，输入框可用。

没有发送消息或修改群数据，未测试 iPhone 真机、生产发布或弱网下提速。未解除 Release/Archive 门禁。没有新增常驻规则或自动检查；建议后续在媒体性能验收中加入连接复用和 CDN 冷/热缓存采样，是否加入长期门禁另行决定。
