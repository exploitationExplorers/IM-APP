# 聊天媒体存储迁移阿里云 OSS 方案

> **2026-10-18 最新决定：用户已明确授权在现有正式服务和数据库接入 OSS，旧数据、旧文件保留，新上传使用 OSS。** 当前执行依据改为[正式环境增量接入步骤](../deploy/oss-production/README.md)；下文“必须独立测试库”和历史全量复制/清理属于早期方案，本次不执行。staging 搭建暂停，已创建空测试资源保留。正式接入仍需先盘点实际镜像/表结构、备份及验证 OpenIM 兼容读取；此决定不代表已部署或已验收。

日期：2026-10-17。分析与后续修改基线：**`feat/chat-image-speed`，提交 `eefb713`**。此版本已核对包含前端重构、ESLint 9、独立缩略图、媒体缓存及 `canary` 发布渠道；替代早期按 `main@7cf95f7` 作出的基线判断。

本文交付前后端改造方案及独立测试数据栈模板；OSS 运行时代码适配、测试服务部署、数据复制及生产切换属于后续实施。仓库配置可以证明预期部署方式，线上实际镜像、桶、对象数量和原生插件版本仍需实施前盘点。

**最新环境约束：涉及数据的数据库、OpenIM、缓存、队列与数据卷新建，禁止测试读写线上数据；不会干扰线上运行的资源可以复用，不要求所有资源重建。OSS 两桶和 RAM 按用户要求复用现有资源，测试对象必须使用受控前缀；服务器、镜像、域名证书等在端口、目录、缓存及资源容量安全的前提下可以复用。** 资源边界、部署模板和接入顺序见第 13 节。现有客户的 `test` 更新渠道属于线上使用渠道，不能作为本次数据库测试环境使用。

## 1. 结论与实施范围

项目有两套独立对象存储：聊天媒体通过 OpenIM 的对象服务写入 OpenIM MinIO；头像、举报图、表情、网页转码语音和 App 安装包等通过业务服务写入业务 MinIO。仅修改业务服务的 `MINIO_*` 配置，无法迁移聊天图片。

推荐保留 OpenIM 的消息协议和 SDK 上传能力，将其服务端存储引擎切到原生支持的 OSS；业务服务抽象存储接口，增加 OSS 实现。两条链路分阶段切换，共同完成历史数据迁移。

第一阶段保持现有客户端 API 和图片可展示的访问方式。聊天消息继续保存稳定的 `/object/<name>` 地址，业务图片保存稳定的媒体域名 URL。禁止把几分钟后到期的 OSS 签名 URL 固化进消息、头像或转发快照。

新增并已确认的保留要求：**每天自动清理群聊记录，每个群仅保留最近 7 天内的最新 500 条，超过任一限制即纳入清理。** 具体执行、客户端同步和媒体文件回收见第 12 节。

| 对象范围 | 现有写入方 | 目标 | 切换要求 |
| --- | --- | --- | --- |
| 聊天图片、原生语音、视频及封面、文件 | H5 / App 的 OpenIM SDK | OpenIM OSS 引擎 | 对象内容、对象映射和缓存一起迁移 |
| 头像、举报图、表情 | 业务上传任务 + 客户端直传 | 业务 OSS 适配器 | 保持创建任务、表单上传、完成确认协议 |
| H5 录音转码结果 | 业务后端 | 业务 OSS 适配器 | 保留转码过程，替换服务端写入实现 |
| APK / IPA / WGT 等发布文件 | 后台及业务后端 | 业务 OSS 适配器 | 保留 PUT 签名、文件大小检查和下载能力 |
| 历史消息、收藏、转发快照中的媒体链接 | 各自数据库及客户端缓存 | 原地址持续可读 | 优先兼容旧地址，避免批量改写消息正文 |

## 2. 当前聊天图片链路

入口是 [room.vue](../IM-APP-fronend/src/pages/chat/room.vue)，聊天状态与占位消息由 [chat.ts](../IM-APP-fronend/src/stores/chat.ts) 管理，实际 SDK 调用集中在 [openim.ts](../IM-APP-fronend/src/utils/openim.ts)。

### 2.1 H5

```text
选图 / 粘贴 / 拖入图片
  → chatStore.sendImage()
  → sendImageMessage()
  → prepareImageFile()：必要时压缩、转 JPEG
  → 上传原图，同时测量尺寸并尝试生成缩略图
  → 原图及独立缩略图分别经 OpenIM UploadFile 上传
  → CreateImageMessageByURL：原图 / 大图 + 独立 snapshotPicture
  → SendMessageNotOss
  → 接收端列表优先缩略图，预览使用原图
  → /object/<name> 经 OpenIM 解析，302 到对象存储资源
```

`SendMessageNotOss` 表示文件已上传、发送时跳过 SDK 再次上传；方法名不限定底层使用哪家对象存储。存储切到 OSS 后，此方法仍适用。

H5 的 `prepareImageFile()` 在图片格式可用且体积未超限时会直接返回原文件；否则按配置缩放并尝试 JPEG 编码。聊天入口传入的 `maxBytes: 2_000_000` 是触发预处理的阈值，并非所有结果必定小于 2 MB 的硬保证。当前分支已通过 `h5ThumbnailFile()` 生成独立缩略图，并在上传成功后写入 `snapshotPicture`；生成或上传失败会回退原图。OSS 适配须保留这套图片提速逻辑，不能退回三种图片全部共用原图的早期实现。

### 2.2 App 原生

```text
选图
  → materializeAppLocalImage()：处理 content://、沙盒路径等
  → 并行生成 / 上传独立缩略图、读取图片尺寸
  → CreateImageMessageFromFullPath
  → stampOutgoingPicture()：写回尺寸和已上传缩略图
  → SendMessage：原生 SDK 读取文件、上传并发送
  → FullPath 分支失败时：UploadFile → ByURL → SendMessageNotOss
```

App 当前优先由原生 SDK 自行上传，H5 则先上传再按 URL 构造消息。服务端切换 OSS 能覆盖两条链路，但必须使用实际安装包测试原生插件，不能用 H5 成功代替 App 验收。清单中的 `Tuoyun-OpenIMSDK` 插件名称不能证明已安装二进制的具体版本。

图片解析已有 `pictureElem` / `PictureElem` 的兼容处理；后续如调整消息构造、缩略图或转发，需同时覆盖 `sourcePicture` / `SourcePicture`、`url` / `Url` / `URL` 等原生字段差异。视频、语音和文件同理，不能统一假设 camelCase。

当前 `stampOutgoingPicture()` 直接读取 camelCase，独立缩略图在部分 PascalCase 原生桥响应上是否能保留仍需专项验证；不要把该分支已有字段兼容视作每个构造函数均已覆盖。缩略图先于原图发送的上传顺序还会产生“上传完成但消息发送失败”的孤立缩略图，须纳入宽限期回收。

### 2.3 重构分支的缓存与界面边界

[ChatBubble.vue](../IM-APP-fronend/src/components/ChatBubble.vue) 已按 `thumbUrl → content → imageFallbacks` 选择列表图片；[mediaCache.ts](../IM-APP-fronend/src/utils/mediaCache.ts) 只在 `canary` 启用图片 / 封面缓存，单文件上限 4 MiB、总量上限 200 MiB。[mediaCacheH5.ts](../IM-APP-fronend/src/utils/mediaCacheH5.ts) 使用 IndexedDB `im-media-cache`，原生缓存写在 `_doc/media_cache`，当前 key 按完整 URL 计算。

因此 OSS 必须继续向消息提供稳定逻辑 URL；不能将每次变化的短期签名地址当作缓存主键。测试与线上使用不同 H5 Origin、不同原生 App 身份 / 沙盒，避免复用 token、媒体缓存或 OpenIM 本地库。若测试壳必须复用同一包身份，则需额外实现环境命名空间和清理旧登录态，未完成前不切换该壳到测试后端。

[constants/chat.ts](../IM-APP-fronend/src/constants/chat.ts) 的 200 / 300 / 400 条窗口是内存与渲染优化参数，不是服务端 500 条保留策略，不能互相替代。本轮存储改造不扩大页面职责：房间负责编排，`openim.ts` 负责 SDK 协议，上传工具负责业务直传，`ChatBubble` 与媒体缓存负责展示及本地命中。

### 2.4 文件实际存在哪里

[deploy/openim/docker-compose.yml](../deploy/openim/docker-compose.yml) 声明的 OpenIM 镜像是 `openim/openim-server:v3.8.3-patch.15`，存储节点是 `openim-minio`，现有对外路径使用 `/openim/`。

[Nginx 配置](../deploy/baota/im-app.conf) 中三条路径用途不同：

| 路径 | 当前上游 | 用途 |
| --- | --- | --- |
| `/minio/` | 业务 MinIO | 业务对象及其旧链接 |
| `/openim/` | OpenIM MinIO | OpenIM 对象直链、部分签名上传路径 |
| `/object/` | OpenIM API | 按逻辑对象名解析并重定向到实际对象 |

`/object/<user>/<filename>` 是逻辑地址，不能直接当作桶内 key。实际对象由 OpenIM 映射到哈希等存储 key。当前版本上游 API 会根据请求及 `X-Request-Api` 生成 `/object/` URL；仓库 Nginx 注释中的“SDK 自己拼接”说明不宜作为修改依据，应以目标镜像的实际响应为准。

## 3. 当前业务上传链路

前端实现见 [file-upload.ts](../IM-APP-fronend/src/utils/file-upload.ts) 和 [file.ts](../IM-APP-fronend/src/api/file.ts)。后端实现见 [file.go](../IM-APP-server/internal/handler/file.go)、[minio.go](../IM-APP-server/internal/infra/minio.go) 及 [文件仓储](../IM-APP-server/internal/repository/file.go)。

```text
POST /api/v1/files/uploads，JSON 元数据
  → 生成 pending 文件记录、formUrl、formData
  → H5 fetch + FormData / App uni.uploadFile 直传存储
  → POST /api/v1/files/uploads/complete，JSON { fileId }
  → 后端检查对象存在，标记 ready
  → 业务通过 fileId 关联头像、表情或举报图片
```

现有业务桶默认是 `im-uploads`；key 常见为 `uploads/<user>/<uuid>.<ext>`、`users/<user>/<uuid>.<ext>`、`voices/<user>/<uuid>.<ext>` 和 `app-releases/...`。`files` 表保存 `object_key` 和完整 `url`，没有明确的存储 provider 字段。H5 转码语音直接写入 `voices/...`，App 发布文件也有独立记录，因此迁移清单不能只依赖 `files` 表。

当前 `Complete` 只判断对象能否查询到，没有完整校验声明大小、实际大小和内容类型；`ObjectStat` 返回大小但 `ObjectExists` 未检查非空。业务 POST 策略目前限制 1～20 MiB，发布文件另走 PUT，最大 200 MiB。迁移时保留不同用途的限制，不能将 20 MiB 策略直接套给安装包。

当前服务在 MinIO 初始化失败时会降级为未配置存储，部分上传接口还会返回开发占位 URL。实施时须调整为：生产环境显式配置 OSS 后，初始化失败应启动失败或返回明确不可用，不得把假地址当成成功上传。

## 4. 目标架构及配置

### 4.1 OpenIM：使用内置 OSS 引擎

已核对 `v3.8.3-patch.15` 上游配置和源码：`config/openim-rpc-third.yml` 支持 `object.enable: oss`，对应 `oss.endpoint`、`bucket`、`bucketURL`、`accessKeyID`、`accessKeySecret`、`sessionToken` 和 `publicRead`。

以下仅展示要修改的配置片段，不是可直接覆盖完整文件的成品：

```yaml
object:
  enable: oss
  oss:
    endpoint: https://oss-<region>.aliyuncs.com
    bucket: <chat-bucket>
    bucketURL: https://<chat-bucket>.oss-<region>.aliyuncs.com
    accessKeyID: <由部署密钥注入>
    accessKeySecret: <由部署密钥注入>
    sessionToken: ""
    publicRead: false
```

实施时从当前实际镜像导出完整 `openim-rpc-third.yml`，保留 RPC / Prometheus 等字段，仅改对象存储段，再单文件只读挂载到 `/openim-server/config/openim-rpc-third.yml`。密钥配置文件不入库。不能用上述片段遮盖整份配置，也不能挂载整个 `config/` 目录覆盖镜像内其他配置。

`endpoint` 为地域服务地址，`bucketURL` 为桶或已配置的域名地址；两者不可混填。初期使用公网 HTTPS 完成跨端直传验证，内网端点仅在确认返回给客户端的所有上传地址仍为公网可达后再启用。

保留 `/object/` 路由和服务端解析，读取时签发短时 OSS 地址；聊天消息始终保存稳定逻辑地址。Nginx 需要明确传递可信的外部 API 基址，避免 TLS 在反代终止后 OpenIM 生成 HTTP 地址，并阻止客户端覆盖该可信头。

OSS 私有桶只能约束存储源站的匿名访问。若 `/object/` 仍可匿名解析，持有逻辑 URL 的用户仍可能读取资源；本次切换不自动增加会话成员授权，不能将“私有桶”宣传为已实现聊天访问权限隔离。

### 4.2 业务服务：增加 OSS 适配器

引入 `ObjectStorage` 接口，让文件 handler、语音 handler、App 发布服务依赖接口。保留 MinIO 实现便于分批上线与回滚，新增基于阿里云官方 Go SDK 的 OSS 实现，锁定依赖版本。

至少覆盖现有能力：`Available`、`PresignPost`、`PresignPut`、`PresignGet`、`PutObject`、`ObjectStat` 和稳定资源地址生成。`ObjectStat` 应返回可区分“不存在 / 无权限 / 超时”的错误，完成确认还需校验非空、大小上限及业务声明，避免将服务故障误报为用户未上传。

业务配置已在本轮接入（默认使用 OSS，可显式选择 MinIO）；完整测试样例及私有桶读取配置见 [business.env.example](../deploy/oss-test/business.env.example)：

```dotenv
STORAGE_PROVIDER=oss
OSS_REGION=<region>
OSS_ENDPOINT=https://oss-<region>.aliyuncs.com
OSS_BUCKET=<business-bucket>
OSS_PUBLIC_UPLOAD_URL=https://<business-bucket>.oss-<region>.aliyuncs.com
OSS_PUBLIC_BASE_URL=https://<media-domain>
OSS_KEY_PREFIX=oss-test/business/
# 私有桶不填 PUBLIC_BASE_URL 时，改用稳定解析入口：
OSS_MEDIA_PROXY_URL=https://<test-origin>/api/v1/public/oss-media
OSS_MEDIA_SIGNING_KEY=<独立且持久保存的32字符以上随机密钥>
OSS_ACCESS_KEY_ID=<由部署密钥注入>
OSS_ACCESS_KEY_SECRET=<由部署密钥注入>
```

上传地址用于签名和字节传输，资源域名用于最终展示；不能把 CDN 展示域名直接替换进已签好的上传 URL。OSS 常用虚拟主机式地址，不沿用 MinIO 的 `/<bucket>/<key>` 拼接规则。

业务首期延续现有匿名展示资源的访问语义，使用独立媒体桶或域名，保持私有写入。直接 URL 方案需要相应对象可匿名读；如采用私有桶，则必须先实现稳定的媒体解析入口或 CDN 授权回源，完成浏览器、原生图片组件和下载组件的验证，再切换读策略。最终读取方式在资源准备阶段确定并记录，不能直接向业务字段写入短期签名链接。

业务接口继续返回 `file`、`formUrl`、`formData`、`uploadUrl` 和 `expiresIn`；客户端把服务端返回的所有表单字段原样上传，文件字段保持 `file`，以兼容 OSS 的签名字段。业务 JSON 接口保持静态路由、POST JSON 及 GET query 规则；multipart 直传发生在 OSS，不新增业务侧 multipart 上传接口。已有 `/files/voice` 的转码协议本轮保留，不借机重构接口。

为支持历史文件和 pending 任务，新增明确的存储位置元数据，例如 `storage_provider`、`storage_bucket`；旧记录回填到原 MinIO 位置，新任务固定到创建时的存储位置。完成确认必须根据任务所属存储查询对象，不能随全局开关变化。语音、发布文件等独立记录也须覆盖，不能只修改 `files` 表。

### 4.3 前端改动边界

首期继续用 OpenIM SDK 上传聊天媒体，无须引入前端 OSS AccessKey 或另建聊天上传协议。后端存储调整是否可以完全免发版，需由实际 H5 SDK 与已安装原生桥联调确认。

重点验证 [chatMedia.ts](../IM-APP-fronend/src/utils/chatMedia.ts) 的 `h5PublicMediaUrl()`，以及 `openim.ts` 的 `rewriteH5StorageUrl()` / `installH5StorageProxy()`：新的 OSS 地址必须使用 HTTPS，并原样保留签名 query、header、host 和编码。旧代码针对 HTTP `/object/`、`/openim/`、`/minio/` 的同源改写不能误伤 OSS。

如需修改消息解析或构造，使用当前分支的 `isApp()` 等平台工具及 uni-app 条件编译，保留 App FullPath 与 URL 两条路径，兼容两种字段命名，同时检查转发规范化 [forwardSnapshot.ts](../IM-APP-fronend/src/utils/forwardSnapshot.ts)。小程序如仍为发布目标，还要配置 upload / download 合法域名。

### 4.4 管理后台与发布链路

[IM-APP-system](../IM-APP-system/package.json) 是 Vue 管理后台前端，[IM-APP-admin](../IM-APP-admin/cmd/admin/main.go) 是 Go 管理后台服务；后者与业务服务直接共用业务表。测试时两者必须一起连接新建的 `imapp_oss_test`，不能将业务与管理端任意一个留在线上库，否则举报、用户、群及文件信息会不一致。

管理服务的 `SERVER_BASE_URL` 和内部鉴权密钥也必须属于测试业务服务。后台对文件的修改、发布包和清理任务由业务服务封装存储能力，前端不持有 AK/SK，管理后台不再另建一套 OSS 签名实现。举报附件、头像与媒体预览、导出结果链接都需要检查稳定地址和读取权限。

管理前端当前 `vite.config.ts` 的 `/api` 代理硬编码线上管理服务，必须先增加显式测试环境配置和拒绝线上回退的校验，再登录或提交后台表单。`src/api/modules/upload.ts` 仍有模板接口 `/imapp/file/upload/img` 与 `/video`，Go 管理路由中未发现对应上传实现；先核对实际调用者，不能仅替换域名便宣称后台上传已接入。

发布脚本 [pack-wgt.cjs](../IM-APP-fronend/scripts/pack-wgt.cjs) 会读取前端和业务服务的 `.env`；签名 PUT 失败后，还可能携带旧 MinIO 配置回退到默认线上源站。OSS 改造需按 provider 调用返回的上传协议，OSS 错误不回退到生产 MinIO；测试发布要求显式测试 API、测试内部密钥及共享业务桶的测试前缀，缺配置立即失败。测试验收前不运行带 `--publish` 的现有快捷命令。

`canary` 是发布渠道维度，测试环境是服务 / 数据维度，两者分别配置。测试壳的更新检查和 WGT 发布记录均写入测试 API 与测试数据库，不为验证新分支而更新线上服务或线上 `app_releases`。第一版测试原生包使用独立应用标识和沙盒，确认 OpenIM 插件授权、iOS 签名与 WGT AppID 匹配后再发给内部设备。

## 5. 历史数据迁移

### 5.1 先生成清单和可恢复备份

本节涉及线上盘点和备份的操作属于后续生产迁移步骤，当前阶段先以测试新数据和导入测试存储的脱敏副本演练。不得为搭测试库直接让迁移工具连接生产并写入映射、缓存或清理水位。生产备份如需读取，使用单独只读导出过程，恢复时先改写资源地址并阻断线上副作用。

分别盘点业务 MinIO 与 OpenIM MinIO 的桶、key、数量、总大小和 Content-Type，导出 PostgreSQL 中的资源引用，以及 OpenIM MongoDB 中的对象映射。记录正在上传的业务任务、SDK 分片上传和转发队列状态。

迁移清单至少包含：来源 provider、bucket、key、逻辑 name、目标 bucket/key、size、校验和、复制状态、元数据变更状态、失败原因和批次号。复制与元数据变更分别记录，支持重试、断点续传和按批次恢复。迁移日志不记录访问密钥或完整签名链接。

备份 PostgreSQL、OpenIM MongoDB 对象与消息相关数据、Nginx / Compose / OpenIM 配置以及迁移清单，并在测试环境验证恢复。数据卷和旧桶保留到回滚窗口结束。

### 5.2 业务存储

1. 按原 key 复制对象，保留 Content-Type、下载文件名等必要元数据；迁移范围来自桶清单和业务引用的并集。
2. 用实际字节数和可用的内容校验和校验复制结果。不同存储及分片方式的 ETag 不保证等于 MD5，不能只比较 ETag 字符串。
3. 新增资源使用新媒体域名；历史 URL 暂时保持可用。旧 `/minio/<bucket>/<key>` 先继续读旧 MinIO，待源文件校验通过再转为 OSS 兼容读取。
4. 旧地址兼容必须正确转换桶名和 key，并支持现有访问策略。私有 OSS 需要服务端签名 / 代理，不能直接匿名反代后期待读取成功。保留查询参数、Content-Type、Range、缓存与下载响应头。
5. 如需更新数据库 URL，按资源引用清单分表、分批处理，保存逐条旧值；同时检查用户 / 群头像、表情、举报、收藏、转发快照、语音结果和发布文件。不要只更新 `files.url`，也不要全库盲目替换 IP。

### 5.3 OpenIM：迁移内容和对象映射

上游 `Object` 模型含 `name`、`hash`、`engine`、`key` 等字段，`AccessURL` 按当前 `Engine()` 与 name 查找。配置选择项为 `oss`，但该实现的 `Engine()` / 元数据值实际是 **`ali-oss`**，不能写成 `oss`。从 `minio` 切换后，仅保留 `engine=minio` 的旧映射不能保证被找到。单纯复制桶，或只保留旧 MinIO 容器，都不足以保证 `/object/` 历史地址可用。

按以下顺序实施：

1. 在测试环境审阅并演练同版本上游 `tools/s3` 迁移工具，核对其复制对象、转换映射、失败恢复、缓存处理和执行期间是否要求服务停写；命令参数以该版本源码和 README 为准，不凭工具名称推断具备 dry-run 或回滚功能。
2. 若工具不能满足清单、幂等和恢复要求，编写受控迁移脚本。保持逻辑 name 不变，准确记录目标 key、hash 与 engine。先复制并校验内容，再调整映射；不得先全量改 engine。
3. 元数据处理前检查实际 MongoDB 集合与索引，确认是保留两份引擎映射还是转换原记录。所有变更都保存前值和批次，不能假定重复 name 一定被允许。
4. 按目标版本的实际缓存 key 规则处理对象名缓存、对象签名 / 哈希去重缓存，避免命中旧地址或误判文件已存在。只清理相关缓存，不清空整个 Redis。
5. 保留 `/object/` 路由并验证旧 name 能解析到已迁移对象。历史直链 `/openim/<bucket>/<key>` 继续保留单独兼容读取；其行为不同于 `/object/`。

稳定 name 保持不变后，历史消息、引用消息、收藏和转发快照可以继续使用原 `/object/` URL，首期无需批量修改聊天消息正文。

## 6. 分阶段上线步骤

**以下生产切换阶段以第 13 节的独立测试数据环境验收通过为前提，本轮不会执行生产切换。** 新库、测试 OpenIM 和共享 OSS 内测试前缀的读写边界均完成验收前，不启动针对线上数据的 migration、回收 worker 或发布任务。

| 阶段 | 操作 | 进入下一阶段的条件 |
| --- | --- | --- |
| 0. 盘点与资源准备 | 确认实际镜像 / 原生桥、现有两套 OSS 桶、RAM 授权、容量、HTTPS 入口和备份；不再要求新建 OSS / RAM | 存储读取策略、测试前缀边界、迁移清单、恢复方式明确 |
| 1. 测试环境适配 | 实现业务存储接口、OSS 适配和位置元数据；部署 OpenIM OSS 配置；检查跨端签名上传 | H5 与实际 App 新媒体上传、显示和下载通过 |
| 2. 历史数据演练 | 用数据库与文件副本演练复制、映射转换、缓存处理及回滚，测量复制与冻结耗时 | 旧消息冷启动可读，回滚后新旧资源均可读 |
| 3. 全量预复制 | 在线复制历史对象，保留原桶；记录起始水位和失败清单 | 大部分数据已复制，最后增量可在窗口内完成 |
| 4. 业务存储切换 | 暂停创建上传任务，处理存量 pending，补最后增量，切新任务到 OSS，保留历史读 | 新旧任务位置正确，头像 / 语音 / 发布下载通过 |
| 5. OpenIM 切换窗口 | 冻结媒体写入，排空或取消分片上传和媒体转发，补增量，更新映射及相关缓存，启用 OSS | 存量映射无缺失，H5 / App 全链路冒烟通过 |
| 6. 观察与退出 | 恢复写入，观察上传失败、403 / 404、转发与回调；再决定旧存储下线 | 回滚窗口结束、数据与访问日志验证完成 |

OpenIM 是单一当前对象引擎，首期采用预复制加短时停写窗口。冻结必须覆盖旧 App、离线重连客户端和队列消费者，不能只靠 H5 按钮禁用。实际部署若无法单独关闭媒体写入，应安排维护窗口暂停相关服务，并把文本消息可能受影响的范围写入执行单。

冻结后不再接受旧凭证完成新写入，确认存量传输结束并做最终核对。业务表单凭证有效期目前为 15 分钟；OpenIM 原生上传和分片会话有效期需另行确认。切换前签出的链接和正在传输的对象不能遗漏。

OpenIM 不宜仅按客户端灰度：共享映射与引擎切换会影响所有客户端。先在隔离测试环境验证，生产按服务端窗口一致切换；业务上传任务则可按明确的 provider 逐步切流。

上线观察至少覆盖一个完整业务高峰，建议保留 7～14 天回滚窗口，最终期限由流量和存储成本确定。期间保留旧桶、备份、旧地址兼容路由和迁移清单。

## 7. 回滚方案

回滚目标包括切换后新上传的文件，不能只恢复切换前的数据库快照。生产放量前必须验证两种情况：

| 回滚时机 | 操作 |
| --- | --- |
| OSS 尚未放开新写入 | 恢复配置及本批对象映射前值，处理相关缓存，恢复 MinIO 写入；验证旧资源 |
| OSS 已接收新写入 | 先冻结写入，按迁移水位反向复制新增 OSS 对象至 MinIO，建立对应映射并校验，再切引擎；业务根据记录位置继续读取或批量迁回 |

对于 OpenIM，若首期不做 OSS→MinIO 持续反向同步，则放量后回滚需要反向补数据的维护窗口，不能承诺仅改开关立即回滚。需根据演练吞吐量估算该窗口；如业务要求分钟级回滚，必须在上线前实现增量反向同步并验证映射一致性。

对于业务资源，保留 provider 元数据及 OSS 读能力，允许回滚写入到 MinIO 后继续读已在 OSS 的对象。生产出现错误时优先停止新增写入、保留证据并按清单恢复，避免全库还原覆盖切换后的消息和业务操作。

触发回滚的指标包括新媒体持续上传失败、历史资源出现新增 404、原生端发送状态异常或转发持续失败。具体阈值按现网基线在执行单中填写，测试环境须实际触发并走通一次。

## 8. 实施文件清单与工作包

| 工作包 | 主要文件 / 交付物 |
| --- | --- |
| 业务存储接口与 OSS 实现 | [infra](../IM-APP-server/internal/infra)、[config.go](../IM-APP-server/internal/config/config.go)、[main.go](../IM-APP-server/cmd/server/main.go)、锁定的 Go 依赖 |
| 文件 / 语音 / 发布服务改造 | [文件 handler](../IM-APP-server/internal/handler/file.go)、[语音 handler](../IM-APP-server/internal/handler/voice.go)、[app_release.go](../IM-APP-server/internal/service/app_release.go) |
| 存储位置与校验 | [文件模型](../IM-APP-server/internal/models/file.go)、[文件仓储](../IM-APP-server/internal/repository/file.go)、新增数据库 migration 及独立资源记录适配 |
| 部署及配置模板 | [业务 Compose](../deploy/docker-compose.yml)、[OpenIM Compose](../deploy/openim/docker-compose.yml)、两份 `.env.example`、OpenIM 完整配置模板、[Nginx](../deploy/baota/im-app.conf) |
| 跨端必要修正 | [openim.ts](../IM-APP-fronend/src/utils/openim.ts)、[chatMedia.ts](../IM-APP-fronend/src/utils/chatMedia.ts)、[file-upload.ts](../IM-APP-fronend/src/utils/file-upload.ts)、转发兼容测试 |
| 重构分支接入与缓存 | 前端 `config.ts`、`vite.config.ts`、`env.d.ts`、`mediaCache.ts`、`mediaCacheH5.ts`、`ChatBubble.vue`，保留独立缩略图与原图预览 |
| 管理后台与发布隔离 | 管理前端代理 / API 基址、Go 管理后台数据库与内部 API 配置、`pack-wgt.cjs` 取消测试路径的生产回退 |
| 迁移与恢复工具 | 全量 / 增量复制、对象清单、元数据批次日志、反向迁移与验证报告 |
| 群聊保留任务 | 每群 7 天且最多 500 条的计算、每日调度、分布式任务锁、清理水位、客户端同步、执行记录 |
| 媒体回收任务 | OpenIM 原生上传等全链路媒体引用索引、无引用对象复核、宽限期、对象及映射清理、空间核对 |
| 接口和操作文档 | [OpenAPI](../IM-APP-server/docs/openapi.yaml)、相关 Postman 集合、部署执行单及回滚记录 |

仓库还有 [本地业务 Compose](../IM-APP-server/docker-compose.yml) 和 [另一份 OpenIM 部署配置](../IM-APP-server/deploy/openim/docker-compose.yml)。先确定生产实际使用入口；仍在使用的配置同步适配，历史入口明确标识，避免只更新一份文件导致环境不一致。

建议按“存储接口与位置元数据 → 业务 OSS → OpenIM 配置与演练 → 数据迁移 / 回滚工具 → 跨端验证与部署说明”拆成可独立审查的提交。完成演练后再给出生产窗口和迁移耗时，当前尚无线上容量数据，不能据此承诺固定工期。

## 9. 验证与验收

| 验证对象 | 必须覆盖的场景 |
| --- | --- |
| H5 PC 与移动浏览器 | 选图、粘贴、拖入、预处理大图、预览、保存；HTTPS 下无混合内容 / CORS / 签名错误 |
| Android App | 相册、`content://`、沙盒路径、华为设备；FullPath 发送及 URL 降级；正确成功回调、重试和进度 |
| iOS App | 相册、HEIC、拍照、预览与保存；跨端收发，不依赖浏览器能力 |
| 图片协议 | camelCase / PascalCase；原图、大图、缩略图字段；转发 / 引用 / 收藏和二次转发 |
| 其他媒体 | 视频与封面、App 语音、H5 转码语音、普通文件、APK / WGT 上传与下载、Range 请求 |
| 历史资源 | 切换前图片、历史 `/object/` 和 MinIO 直链；清缓存重启客户端、跨账号接收、冷读与冷 CDN |
| 异常和恢复 | 过期凭证、空文件、越限文件、错误 Content-Type、断网重试、重复确认、OSS 不可用、跨切换 pending、双向回滚 |
| 群聊每日清理 | 500 / 501 条、7 天边界、序号空洞、清理期间新消息、离线重连、任务重试、共享媒体及收藏 / 转发保护 |

OSS CORS 仅放行实际 H5 来源；按业务 POST / PUT 和 OpenIM 实际分片请求设置方法与请求头，暴露 SDK 需要读取的 ETag 等响应头。CORS 不代替存储权限；RAM 凭证限定到所需桶 / 前缀与分片操作，AK/SK 仅存服务端。签名上传接口需保留鉴权、用途枚举、大小限制和用户 key 隔离。

验收证据应包括：迁移清单全量数量 / 字节校验、失败项归零或逐项解释、内容校验结果、历史逻辑 name 解析结果、原生设备日志、H5 网络记录和回滚演练报告。抽样覆盖全部关键媒体类型，并包含未被本地缓存掩盖的旧对象。

改动需执行 Go 对应单元 / 集成测试、前端类型检查、H5 和 App 构建、图片 / 视频协议与转发兼容测试；H5 使用项目本地验证流程，App 在实际 Android / iOS 安装包上验收。本轮代码及离线验证进展见第 14 节，尚未运行 OSS 端到端测试。

## 10. 实施前需要补齐的信息

### 10.1 已确认的资源与准备状态

以下来自用户提供的 OSS / RAM 控制台截图和配置反馈；尚未通过服务端签名调用或 H5 / App 上传验证。

| 项目 | 当前值 / 状态 |
| --- | --- |
| OSS 地域 | 华东 1（杭州），`cn-hangzhou` |
| 聊天媒体 Bucket | `yikeliao-188`，标准存储 |
| 业务文件 Bucket | `yikeliao-188-business`，标准存储 |
| 标准公网 Endpoint | `https://oss-cn-hangzhou.aliyuncs.com` |
| 聊天桶标准 HTTPS 地址 | `https://yikeliao-188.oss-cn-hangzhou.aliyuncs.com` |
| 业务桶标准 HTTPS 地址 | `https://yikeliao-188-business.oss-cn-hangzhou.aliyuncs.com` |
| H5 Origin | `https://www.xn--jprz53bj9s.com`，不包含 `/#/pages/contacts/index` 等路由 |
| 两桶版本控制 | 用户截图显示未开启 |
| RAM 用户 | `im-app-oss` 已创建；AccessKey 创建及指定桶策略绑定仍待确认 |
| CORS | 用户已反馈保存；按两桶同规则准备，实际跨域请求仍待联调 |
| Bucket 读策略 | 已建议先私有；实际 ACL / 策略和业务稳定读取方案仍待核对 |
| 开发基线 | 已确定 `feat/chat-image-speed@eefb713`，包含 ESLint `^9.39.5`、Vitest 和媒体缓存改造 |

已给出的 CORS 配置为：来源使用上述 H5 Origin；方法 `GET` / `HEAD` / `POST` / `PUT` / `DELETE`；允许请求头 `*`；暴露 `ETag`、`x-oss-request-id`；预检缓存 600 秒；不使用跨域 Cookie 凭证。CORS 保存不代表 RAM 授权、对象读取权限或端到端上传已经验证。

用户已指定并确认当前工作区在 `feat/chat-image-speed`。后续变更直接在该分支完成；原基于旧 main 的 `codex/feature-oss-migration` 不再作为本次基线，也不进行强制重置或推送。按最新要求，**复用 `yikeliao-188`、`yikeliao-188-business` 两桶及现有 `im-app-oss` RAM，不新增 OSS 桶或 RAM 用户**。数据库等有状态数据资源单独新建，其他资源以“不读写线上数据、不干扰线上运行”为复用判断标准。

AccessKey ID / Secret 由用户保存在服务端私密配置中，不记录到本文。准备完成后需核对现有 RAM 策略绑定、签名表单 / 分片上传、HEAD 查询及读取能力；**受控删除默认关闭，仅在运行时保护验证通过后，对测试库关联且物理 key 位于允许测试前缀内的对象试验，绝不操作已有业务对象。** 不为测试替换共享 RAM 策略或轮换共享密钥。

### 10.2 仍需核对的信息

| 信息 | 用途 |
| --- | --- |
| AccessKey 创建与授权状态、两桶实际 ACL | 完成服务端鉴权与对象访问验证 |
| 测试部署入口及宿主资源容量 | 可以复用现有服务器、域名证书；测试使用独立端口 / 目录 / Origin，确保不冲突、不覆盖线上资源 |
| 共享 OSS 的测试物理 key 前缀 | 业务 `oss-test/business/`、聊天 `oss-test/chat/`；须确认 OpenIM 能真正隔离物理 key 和去重命名空间 |
| 自定义媒体域名是否启用 | 当前可先用已知 OSS HTTPS 地址联调，再确定最终展示地址 |
| 业务资源公开读 / 私有源站方案 | 确定 URL 生命周期和历史兼容实现 |
| 实际服务镜像 digest、SDK 和原生桥版本 | 确认配置路径及跨端签名协议 |
| 两套 MinIO 数据量、对象量及网络带宽 | 估算预复制和最终冻结时间 |
| 实际部署入口、域名及现网错误率 | 生成准确执行单和回滚阈值 |
| 可接受的维护窗口与回滚时间 | 决定是否追加持续反向同步 |
| 群聊每日清理的执行时刻、媒体回收宽限期 | 保留规则已确定为 7 天且最多 500 条；执行时刻和物理回收时机在实施单中固定 |

这些信息可在配置与测试环境适配期间补齐。密钥通过部署环境或密钥管理系统配置，不写进本文、源码或提交记录。

## 11. 版本核对依据

本方案结合仓库源码与以下已核对的 OpenIM `v3.8.3-patch.15` 上游源码制定。实施以实际运行镜像为准，避免升级版本后继续套用旧配置。

- [对象存储配置](https://github.com/openimsdk/open-im-server/blob/v3.8.3-patch.15/config/openim-rpc-third.yml)：原生支持 `oss`。
- [Third 服务初始化](https://github.com/openimsdk/open-im-server/blob/v3.8.3-patch.15/internal/rpc/third/third.go)：根据 `object.enable` 选择存储实现。
- [对象解析与引擎查找](https://github.com/openimsdk/open-im-server/blob/v3.8.3-patch.15/pkg/common/storage/controller/s3.go)：使用当前引擎查 name，并维护相关缓存。
- [对象数据模型](https://github.com/openimsdk/open-im-server/blob/v3.8.3-patch.15/pkg/common/storage/model/object.go)及[MongoDB 存储](https://github.com/openimsdk/open-im-server/blob/v3.8.3-patch.15/pkg/common/storage/database/mgo/object.go)：引擎、逻辑名及实际 key 的关系。
- [对象 API](https://github.com/openimsdk/open-im-server/blob/v3.8.3-patch.15/internal/api/third.go)：外部 URL 基址生成及读取重定向。
- [同版本存储迁移工具](https://github.com/openimsdk/open-im-server/tree/v3.8.3-patch.15/tools/s3)：已确认目录存在，具体迁移与恢复行为须实施时审阅演练。

## 12. 新增要求：群聊每日自动清理

### 12.1 已确认的保留规则

规则作用于**每个群的共享聊天历史**，每天运行一次清理任务。仅对群聊生效，单聊、头像、表情及发布安装包不纳入本规则。收藏和已转发到其他会话的独立副本沿用各自现有保留方式，不因源群记录过期而自动删除。

每批以可信服务端时间 `T` 和该群已提交的消息水位为固定快照，保留条件为：

```text
保留消息 = 发送时间 >= T - 7 × 24 小时
          且在该群快照中按服务端 seq 排序属于最新 500 条

清理消息 = 超过 7 天的消息，或排在最新 500 条之外的消息
```

例如：最近 7 天有 1,000 条，则只保留最新 500 条；总计只有 100 条，但其中 80 条超过 7 天，则只保留剩余 20 条；全都超过 7 天则可以清空。不能因“不满 500 条”而继续保留超龄消息。

“最多 500 条”是每日任务完成后的结果；两次每日清理之间可暂时超过 500 条。如以后要求发送后立即维持上限，需要追加实时裁剪，不属于当前已确认的每日执行频率。

计数以实际存在且用户可见的聊天记录为准，包括可展示的群系统通知；已删除记录、不可展示的控制消息不计数。用实际消息定位第 500 条，不能简单计算 `maxSeq - 500`，因为撤回、删除和控制消息会造成序号空洞。时间边界使用服务端记录，不采信客户端自报时间。

建议在 `Asia/Shanghai` 每天 03:00 运行，执行时刻保留为部署配置，正式上线执行单再固定。7 天按滚动 168 小时计算，不按自然日零点截断。

### 12.2 后端清理及跨端同步

现有 [ClearConversationMessages](../IM-APP-server/internal/im/client.go#L994) 只清除指定用户的服务端漫游历史并同步该用户设备；它不具备按群统一保留 500 条 / 7 天的语义。已有 `isMsgDestruct` 等会话设置，也不能直接证明具备全群按条数清理和物理回收能力。

后续实现步骤：

1. 核对实际 OpenIM 版本支持的管理员历史范围清理接口、群级 `minSeq` 机制和同步事件。若缺少必要能力，需针对该版本扩展服务端并完整测试，不能先用业务 SQL 或 MongoDB 删除消息绕过 OpenIM 状态维护。
2. 服务端定时任务采用分布式锁 / 租约，按群分批处理，持久化任务快照、策略版本、清理范围和进度；大群限速，失败可重试，重复执行保持幂等。
3. 计算清理范围后，在实际删除前以最新引用状态复核；通过服务端受支持的路径更新消息可见范围、相关索引和必要状态。清理不依据单个管理员的已读位置，也不能只清业务审计表来冒充清理聊天历史。
4. 给 H5 和 App 同步每群的保留水位或明确失效消息范围；清除 SDK 本地缓存与页面已加载记录，更新会话最后消息和必要的未读展示。离线设备下次连接先对齐水位再拉历史，避免旧消息重新出现。不能将清理当作用户已读，或粗暴归零全部未读。
5. 若需要新增业务配置或水位查询接口，遵守静态路由、GET query / POST JSON 和鉴权规则；原生 SDK 方法、桥字段及通知能力需按平台核对。

实施前需明确 OpenIM 的物理历史清理机制：只提高 `minSeq` 或隐藏记录，未必立即减少 MongoDB / Redis 占用。应验证过期数据实际回收，并单独说明数据库文件、备份和索引占用的变化；不能以客户端看不见消息代替存储空间释放。已导出或保存在系统相册的用户文件不属于 App 可统一清理的缓存。

### 12.3 OSS 媒体回收

删除聊天记录后，将相关媒体纳入待回收清单。只有确认不存在任何有效引用且超过回收宽限期，才删除实际对象。**不能直接配置“整个聊天桶的对象创建满 7 天就删除”**：旧图片可能仍被新消息、收藏或其他群使用，OpenIM 也可能按哈希复用同一物理对象。

回收前至少检查：未过期的各会话消息、有效收藏、已成功转发副本、队列中的转发任务、引用消息快照、头像 / 表情等独立用途，以及进行中的上传和迁移。业务 `files` 表不能覆盖 OpenIM 原生上传，需为这些链路建立引用记录和补偿扫描；引用数据不完整或检查失败时跳过物理删除，不能把未知状态当作零引用。

以实际 provider / bucket / key 做共享对象引用判断，同时保留逻辑 name 到对象的映射。只要任一逻辑名仍有有效用途，物理对象就继续保留。内容地址复用场景还要在回收前处理可重新上传 / 去重路径，避免哈希缓存把后续上传错误地指向已删除对象。

建议采用“标记待回收 → 宽限期内可取消 → 再次核验并短时锁定回收资格 → 删除对象及处理失效映射 / 缓存”的流程。引用新增与删除须通过受控协调机制消除竞态，不能仅凭几分钟前的零引用扫描执行删除。宽限期建议 24～72 小时，在部署执行单中确定；存在新的有效引用时撤销回收资格。OSS 生命周期仅用于已确认可回收的前缀 / 标签或废弃分片，并根据实际访问路径验证规则。

如果 Bucket 开启版本控制，删除对象可能只生成删除标记，旧版本仍计费；需配套设置非当前版本和废弃分片的清理策略，并符合回滚保留期。统计消息删除数量、候选媒体、受保护媒体、实际删除字节及失败项，分别呈现逻辑清理和实际空间 / 费用回收结果。

### 12.4 与迁移、备份和验收的关系

数据迁移与回滚演练期间暂停消息破坏性清理和媒体物理回收；迁移清单中的对象不被并行删除。需要减少迁移体积时，可先运行只读清理预览生成候选，再依据最终启用的保留策略完成经过备份的独立清理；不能在复制过程中擅自省略对象，尤其不能省略仍被收藏 / 转发引用的媒体。

生产清理先输出候选及数量完成演练，再逐批启用。删除后的恢复依赖备份和宽限期，并非关闭定时任务就能恢复；备份保留与旧 MinIO 下线时间需同时考虑迁移回滚和清理误删的恢复需求。

验收包括：7 天内 500 / 501 条、发送时间恰好位于边界、跨群隔离、系统通知、撤回序号空洞、任务执行期间继续发消息、多实例并发、任务宕机后续跑、离线设备重连、收藏和跨群转发共享文件、重复上传去重、迁移冻结以及 OSS 版本控制后的实际空间变化。

本节为新增设计要求，尚未实现清理任务，也未执行任何消息或对象删除。

## 13. 测试数据隔离、资源复用与前后台实施顺序

### 13.1 资源隔离清单

不要求为本次测试全部购买或新建资源。服务器、基础镜像和可覆盖测试入口的域名证书可以复用，但有状态数据要使用新库、新实例 / 数据卷，测试应用使用独立进程、端口、网络和目录。复用线上宿主机前检查剩余 CPU / 内存 / 磁盘，并为测试设置资源额度；若余量不足则改用其他宿主机，不能以“容器不同”为由忽略运行影响。当前不直接修改线上 Compose、Nginx 站点或数据库。

| 资源 | 测试环境要求 | 本轮交付 / 状态 |
| --- | --- | --- |
| 开发与发布基线 | `feat/chat-image-speed@eefb713` | 已核对，后续原图 / 缩略图优化保留 |
| Docker 项目 | `im-app-oss-test`，不与生产 Compose 合并 | 新增独立基础设施模板 |
| PostgreSQL | 独立实例，新库 `imapp_oss_test`，新应用角色 `im_oss_test` | 新空卷初始化时自动建库和角色；尚未启动 |
| 管理后台数据库 | 与测试业务服务共用 `imapp_oss_test`，不共用线上表 | 管理 / 业务 migrations 先后执行，模板未启动应用 |
| OpenIM MongoDB | 独立实例，新库 / authSource `openim_oss_test`，新应用账号 | 新空卷初始化时创建数据库用户；尚未启动 |
| 业务 Redis | 独立实例和密码，新数据卷，DB 0 | 不以生产 Redis 换 DB 编号代替实例隔离 |
| OpenIM Redis | 第二个测试实例和密码 | OpenIM 游标、token、对象缓存与线上完全分离 |
| 业务 Kafka | 测试独立 broker，topic / consumer group 使用 `_oss_test` 后缀 | 模板提供独立 broker，不挂生产队列 |
| OpenIM Kafka | 独立测试 broker | 不复用业务 Kafka 或生产消息 topic |
| OpenIM etcd | 独立测试实例与卷 | 禁止加入生产服务发现集群 |
| OpenIM 服务 | 独立 API / WS / RPC 节点，测试 admin、secret、回调 | 待从目标镜像完整配置生成；不只改 MongoDB 名称 |
| 迁移源 MinIO | 两个空测试实例 / 桶，仅放合成或脱敏对象 | 模板提供 `minio-source` / `openim-minio-source` |
| 目标聊天 OSS | 复用 `yikeliao-188`，测试物理 key 为 `oss-test/chat/` | 不新建桶，物理 key 适配层及固定上游编译通过，未部署联调 |
| 目标业务 OSS | 复用 `yikeliao-188-business`，测试物理 key 使用 `oss-test/business/` | 不新建桶，业务读写已强制校验，历史迁移工具另行实现 |
| RAM 与密钥 | 复用现有 `im-app-oss`，密钥只填服务端私密配置 | 不新建身份，不改现有策略或轮换密钥；不视为权限隔离 |
| 服务器 / 镜像 / 证书 | 无运行干扰时可复用，不强制新建 | 核对容量、资源限制、证书覆盖范围和端口冲突 |
| H5 / 管理页面 | 测试 Origin / HTTPS 入口和静态目录独立 | 可用现有域名的独立测试端口，不强制新域名；不覆盖线上 H5 或 `/admin/` |
| 原生客户端 | 内部独立 App / 沙盒、测试 API + `canary` | 不向客户 `test` / `prod` 或线上 `canary` 发布 |
| JWT / 内部 API / webhook | 全新随机密钥及独立管理员密码 | 本地初始化脚本生成，禁止复用线上 `.env` |
| 短信 / 通知 / 第三方回调 | 测试桩或明确测试账号，禁止向真实用户发短信 / 推送 | 应用部署时关闭生产凭据，先验证出站调用 |
| 清理与迁移 worker | 新测试库 + 明确的共享桶 / 测试物理 key 前缀允许清单 | 启用前校验环境身份，默认仅预览、不删除，拒绝前缀外对象 |
| 备份、日志和监控 | 测试独立路径 / 索引 / 标签，不混入生产巡检告警 | 后续应用部署与执行单同步实现 |

数据库等数据服务以新实例、凭据和网络边界保证隔离，不依赖 `_test` 命名本身；测试 OpenIM webhook 只回调测试业务服务，不能将测试账户注册到生产 OpenIM。OSS / RAM 是用户明确允许的共享例外：同一 RAM 凭据不能提供云端权限隔离，必须在应用和迁移 / 回收工具中强制执行物理 key 前缀检查，不能宣称已实现独立桶同等的安全边界。

共享 OSS 的接入要求：

1. 业务对象统一使用 `oss-test/business/`；本轮已覆盖上传、完成确认、读取与发布包的实际 key 校验，禁止覆盖；不提供删除能力。未来分片/迁移/回收工具也必须校验，不因存储接口已接入而跳过门禁。
2. 已确认固定 OpenIM 版本不支持物理 key 前缀，新增测试适配层覆盖 hash、临时对象、分片和复制源/目标；Mongo/Redis 独立隔离去重。原镜像仅加环境变量不会生效，必须构建测试 third RPC；部署联调未通过前，不启动共享聊天桶的写入、迁移或删除。
3. 测试删除默认关闭；启用后也只能处理测试库关联且位于允许前缀内的对象。禁止全桶同步删除、全桶 7 天生命周期或覆盖已有对象；测试清单不能收录前缀外的生产文件。
4. 不因测试替换共享桶 ACL、RAM 策略或轮换密钥。确需 H5 跨域时，仅追加测试 Origin 并保留原 CORS 规则，单独核对变更；共享 OSS 的请求量与费用也要限速监控。

### 13.2 已新增的基础设施模板

目录：[deploy/oss-test](../deploy/oss-test/README.md)。模板包含 PostgreSQL、两套 Redis、MongoDB、两套 Kafka、etcd 和两套迁移源 MinIO，共 9 个独立数据服务；不启动业务 API、管理后台或 OpenIM 应用，也不访问阿里云 OSS。

所有数据卷由 `im-app-oss-test` 项目创建，网络为测试专用 internal bridge；无外部生产网络、固定生产容器名或生产数据目录挂载。用于检查的数据库 / MinIO 端口仅绑定回环的新端口。应用层后续接入测试网络，访问 OSS 的出口另行配置，不能为省事加入生产共享网络。

初始化入口 [init-env.cjs](../deploy/oss-test/init-env.cjs) 只读取模板并新建测试 `.env`，为测试数据服务和应用密钥独立生成随机值，OSS 凭据留空由部署者填入现有 RAM 的值；已存在文件不会覆盖。真实测试配置、私密文件和测试产物由目录内 `.gitignore` 排除。它不创建云资源、启动容器或连接数据库。

[validate-config.cjs](../deploy/oss-test/validate-config.cjs) 只渲染配置并检查项目、数据库名、网络、卷、端口和挂载；拒绝终端中可能覆盖测试文件的 `TEST_*` / `COMPOSE_*` 变量，不输出密钥、不执行 `up` / `exec` / migration。[反向测试](../deploy/oss-test/isolation.test.cjs) 验证生产资源名、外部卷 / 网络、不安全端口、挂载和重复凭据均被拒绝。模板已通过离线 Compose 渲染；本机 Docker Linux Engine 当前未运行，因此尚未创建实际测试库或验证服务健康。

### 13.3 应用连接与启动顺序

后续为测试应用单独提供配置文件和 Compose，引用本测试项目，不读取开发者原有前后端 `.env`；启动器拒绝混用 `COMPOSE_FILE`、生产 Docker context 和生产环境变量。程序内增加显式环境校验，测试模式缺连接参数时立即停止，不能使用线上 IP、默认数据库或生产 MinIO 作为兜底。

测试业务服务配置要点：

```text
DATABASE_URL  → PostgreSQL 测试实例 / imapp_oss_test / im_oss_test
REDIS_URL     → 测试业务 redis:6379 / 独立密码 / DB 0
OPENIM_API_URL → 测试 OpenIM 内部 API
OPENIM_PUBLIC_API_URL / OPENIM_PUBLIC_WS_URL → 独立测试站点
IM_INTERNAL_API_KEY / JWT_SECRET / OPENIM_SECRET / webhook secret → 测试专用
KAFKA_BROKERS → 测试业务 kafka:19092
KAFKA_FORWARD_TOPIC → im-forward-tasks_oss_test
KAFKA_FORWARD_GROUP_ID → im-forward-workers_oss_test
SEED_DEMO=false，生产短信 / 推送凭据为空
```

测试管理服务连接同一测试 PostgreSQL，`SERVER_BASE_URL` 仅为测试业务 API，`SERVER_INTERNAL_KEY` 与测试业务内部密钥一致，`ADMIN_JWT_SECRET` 使用独立测试值。不能采用生产主库只读副本代替测试库，因为测试 migrations、管理员操作和迁移任务都需要写入。

OpenIM 配置需从固定镜像导出完整文件，分别修改 MongoDB 的 database / authSource / 用户、Redis 密码、Kafka、etcd、secret、webhooks 和 OSS 对象引擎。需要单文件挂载哪些配置、哪些环境变量可可靠覆盖，均以固定镜像实际加载结果为准，不能凭变量名称推测已生效。

启动顺序为：基础设施健康 → 测试业务服务执行当前分支全部 migrations（含 051 存储位置）→ 测试管理后台执行其 migrations → 测试 OpenIM 及回调联通 → 创建新的测试用户 / 群 → 接入测试 H5 / 原生 App。业务服务已支持 OpenIM 不可用时排队同步，因此初始化时可先完成数据库建表；服务最终就绪必须等测试 OpenIM 注册和回调通过。每一步核验连接目标和环境标记，自动迁移发生在真正提供业务服务之前。

### 13.4 前端与后台需要先做的环境改造

| 位置 | 当前风险 | 测试模式的目标行为 |
| --- | --- | --- |
| 客户端 `vite.config.ts` | 多条 `/api`、`/object`、`/openim*` 代理硬编码线上 | 测试专用 mode 和显式代理目标；不连接生产，缺测试目标时启动失败 |
| 客户端 `.env.canary.example` / `config.ts` | canary 样例 API 仍为线上 IP，App 有线上默认值 | 独立测试 env 和入口，测试壳只接受测试地址；H5 同源代理指测试网关 |
| H5 SDK 地址改写 | API / WS 可能被重写到当前源站 | 使用独立测试 Origin，`/openim-api`、`/openim-ws`、`/object` 全部反代测试服务 |
| 管理端 `vite.config.ts` / API base | `/api` 指向线上管理服务 | 独立测试代理和页面标识，所有增删改查都走测试 admin |
| `pack-wgt.cjs` | 从普通 `.env` 取密钥，失败后回退线上 MinIO | 测试专用显式配置、目标环境校验、OSS 错误不回退生产、发布到测试 releases |
| 本地 token / OpenIM 库 / 媒体缓存 | 包名或 Origin 相同时可能读取旧登录态和缓存 | 测试域名与 App 沙盒隔离；必要时追加环境命名空间和旧数据迁移 |
| 测试壳自动更新 | channel 与 API 地址若不匹配会串数据 | 同时核对测试 API、canary、AppID、签名及更新检查响应来源 |

生产页面的 Origin `https://www.xn--jprz53bj9s.com` 不承载本轮测试页面；可以复用域名及适用的证书，通过不同测试端口形成不同 Origin，也可使用已有测试域名。共享桶如需补充 CORS，只追加测试 Origin（和确需的本机调试 Origin）并保留原规则；不通过覆盖线上代理或部署目录做联调。

### 13.5 新库与旧数据的使用规则

测试库先从当前分支 migrations 创建空 schema，然后使用专门测试账号、测试群和合成图片覆盖主要场景。通过新数据验证后，再导入脱敏样本演练历史对象迁移。

业务表、OpenIM MongoDB 和媒体对象的恢复须作为一个对应样本批次处理，保持引用一致。恢复后改写 API、媒体链接、头像、callback、发布下载地址和对象映射，删除或禁用旧 token、推送 token、旧管理员、旧发布记录，以及同步 outbox / 转发队列等可触发副作用的数据。先保持 worker 和定时任务停用，检查数据服务均为测试实例、OSS 物理 key 均落在允许测试前缀内再逐项开放。数据库凭据及网络不能连接生产实例；共享 OSS 凭据的前缀外操作由应用和工具强制拒绝，只靠文本地址替换不构成隔离证明。

本轮不运行生产 `CREATE DATABASE`、不修改生产表结构，也不恢复线上整库到当前开发进程。测试基础设施启动后创建的新数据库与数据卷完全属于新实例；实际创建完成必须以连接测试实例查询 `current_database()` 和应用角色的结果为证。

### 13.6 实施批次与验收门禁

| 批次 | 交付 | 完成判断 |
| --- | --- | --- |
| A：数据隔离与安全复用 | 新数据库等有状态数据栈；复用现有 OSS / RAM，核对测试入口及宿主容量，增加应用启动和物理 key 前缀校验 | 不读写线上数据、不覆盖已有对象；同机部署无端口 / 目录冲突且资源有余量 |
| B：业务 OSS | 存储接口、位置元数据、官方 OSS SDK、POST / PUT / HEAD、稳定读取、明确失败 | 新库创建任务→直传→确认完成，头像 / 举报 / 表情 / 语音 / 包下载通过 |
| C：OpenIM OSS | 测试对象引擎配置、原图 / 缩略图协议、缓存兼容、完整回调 | H5 和 Android / iOS 新包收发、冷缓存及转发通过 |
| D：后台与热更新 | 测试后台预览 / 操作、测试发布记录、脚本移除生产回退 | 上传失败即失败；客户原包和生产 releases 不发生变化 |
| E：迁移与恢复 | 测试 MinIO→共享 OSS 测试前缀→反向恢复，映射 / 缓存 / pending 任务校验 | 历史逻辑地址和独立缩略图均可读，新增 OSS 测试数据可恢复，前缀外对象不变 |
| F：自动清理 | 全群保留规则、跨端失效同步、引用保护及物理回收 | 7 天 / 500 条边界、离线重连、共享媒体、任务续跑与回滚演练通过 |

本轮已完成方案、数据栈准备文件及第 14 节所列代码，不等于 A～F 全部完成。后续测试报告要分别列出已落地文件、真实创建的资源和未完成项。验收时至少跑前端 ESLint / type-check / Vitest / H5 与 App 构建，业务和管理服务 Go 测试，真实 OSS 签名上传与新库集成；开发分支既有失败与新增失败分别记录，不借迁移批量格式化其他模块。

只有全部测试门禁通过后，才编制针对生产的独立部署单，列出代码版本、镜像、数据库变更、备份、冻结窗口和回滚步骤。测试阶段不发布客户 WGT、不替换现有 APK / IPA、不重启线上应用，也不提前开启生产清理。

## 14. 本轮接入进展（2026-10-17）

按最新要求，优先完成前后端接入，**不执行历史迁移和清理**。接入手册及验收边界见 [OSS接入与验收](../deploy/oss-test/OSS接入与验收.md)。

- Go 业务服务：新增 ObjectStorage / OSS，默认使用 OSS，MinIO 需显式选择。新增 051 additive migration 保存文件任务 provider/bucket，不重写旧地址；语音和发布包走同一存储层。OSS 必需配置缺失会在数据库访问前停止；旧部署升级时若继续使用 MinIO，必须设置 STORAGE_PROVIDER=minio。
- H5/App：表单字段与 URL/签名原样透传；原生继续 uni.uploadFile；旧 MinIO 代理、重构后的独立缩略图和媒体缓存保留。包上传收到 OSS 响应后失败禁止回退 MinIO，不发布记录。
- 私有桶：业务 URL 持久化为 HMAC capability 解析入口，302 到短期 GET；这不是会话成员授权，稳定密钥和测试代理仍需部署及真机验证。
- 聊天：固定 OpenIM v3.8.3-patch.15 无原生前缀，新增测试物理 key wrapper、版本校验补丁和独立构建步骤；相对元数据 key 保持不变，所有 OSS 操作加测试物理前缀，删除默认关闭。已编译固定上游 third RPC，但未部署镜像。
- 测试模式：显式 APP_ENV=oss-test 不读普通业务/管理 .env，校验独立数据目标及禁止真实短信；已补齐本机测试应用 Compose、管理/客户端 oss-test 代理和 OpenIM 配置，尚未启动部署。
- Go tests/vet、前端 Vitest/type-check、H5/App 构建、发布 helper 和数据栈反向检查通过；lint 为 0 errors、186 warnings。旧视频 Node 测试别名、通知测试的已移除文件导入仍失败，单列记录。
- **未完成/未执行**：真实测试库启动/建表、新库+OSS 端到端、Android/iOS 真机、旧 OpenIM engine 迁移、多 provider 历史解析、生产切换、7天且最多500条清理。不得把本轮离线通过当作上线许可。

## 15. 本机 Docker Desktop 测试交付（2026-10-17 补充）

用户已选择在本机 Docker Desktop 先验证隔离。详细流程见 [本机 Docker 测试步骤](../deploy/oss-test/本机Docker测试步骤.md)。

- 无需手写建库 SQL：新的 PostgreSQL / Mongo 空卷初始化时自动建测试库及最小应用用户；业务和管理 migrations 依次仅写新测试业务库。
- 提供 9 个数据容器 + 14 个应用容器的独立文件、只读配置挂载和本机 HTTPS 网关；共享 OSS/RAM 继续复用，物理测试前缀及禁止删除保持不变。
- OpenIM 配置从校验过的固定源码读取，11 个非 cron 二进制使用独立 patched 镜像；不调用 mage 全量启动、不启动 crontask、不用普通上游镜像写共享桶。
- 客户端和管理前端显式 oss-test mode：不读普通 dotenv、不代理生产、独立静态输出；App 使用显式本地 HTTPS API，禁止热更新。独立原生壳、真机地址/信任仍单独准备。
- 管理端新增 test env 与数据库/内部 API 启动前门禁，保留非测试运行行为；local 入口只允许本机 Desktop Linux context，不提供清卷/发布/云删除动作。
- 已通过部署隔离测试 53 项、客户端 Vitest 26 项、发布 helper 4 项、业务/管理 Go tests+vet、客户端/管理 type-check 和 oss-test H5/App资源/管理端构建。尚未实际构建整个容器栈、建表或上传 OSS；不据此批准生产切换。

部署者仍需手动：打开 Docker Desktop、在 ignored 测试 .env 填已有 AK/SK、信任并签发本机开发证书、必要时仅追加 Bucket 测试 CORS，然后显式执行手册中的创建/启动命令。本轮未运行这些有状态操作。
