# OSS 接入、兼容与测试验收

工作分支 `feat/chat-image-speed`。代码默认运行行为保持不变，**未连接生产、未发布 WGT、不执行删除**。截至 2026-10-17 23:38（UTC+8），本机 23 容器已启动，新测试库已执行业务/管理 migrations（81 表、含 051）。Clash 四条独立 DOMAIN/DIRECT 规则生效后，两个香港桶的严格 HTTPS、CORS 和签名读取检查，以及真实业务 OSS POST→完成确认→私有读取、未上传/大小不符拒绝 ready 均通过。PC/移动 Web 聊天图片原图与独立缩略图上传、真实发送确认、新上下文重登录历史私有图片读取也已通过。业务注册/登录、OpenIM 用户/token、后台登录/鉴权资料、PC/移动端 Web 登录布局及后台登录页已实测。当前 2 个业务测试用户，业务文件 1 ready / 6 pending；**两端实时收消息回归未通过，原因仍待定位**，完整聊天与 App 原生不计绿。下面早期记录只表示当时状态，最新结果见末尾与本机操作手册。

## 实现范围

| 链路 | 实现 | 保留行为 |
| --- | --- | --- |
| 业务 Go 服务 | MinIO / OSS 存储接口，官方 OSS Go SDK v2 `v1.6.1`，POST / PUT / HEAD / GET / 服务端语音上传 | 默认 OSS；MinIO 需显式配置 |
| 文件任务 | migration `051_file_storage_location.sql` 添加 provider / bucket；完成确认按任务所属存储处理 | 不改旧 key / URL；历史记录默认为 MinIO；仅新测试库已执行 migration |
| H5 / App 业务直传 | 服务端表单原样传递，H5 file 字段最后，App 保留 uni.uploadFile | 头像 / 举报 / 表情等仍走原接口；不引入浏览器 SDK 到原生端 |
| 聊天 OpenIM | 锁定版本的独立测试适配层，对物理 hash / 临时 / 分片 / 拷贝 key 加 `oss-test/chat/` | 不改消息协议、原图+独立缩略图和缓存；需要构建测试 third RPC，原镜像不会自动生效 |
| 媒体读取 | OSS URL 不改 host / 编码 / 签名；私有业务桶提供稳定 capability URL→10 分钟签名 GET | MinIO 同源代理保留；App 的 camelCase / PascalCase 解析未改动 |
| 发布包 | 返回 signed headers / provider，脚本对 OSS 失败禁止降级 MinIO | 旧 MinIO 发布兼容；本轮不运行发布脚本、不发布 WGT |
| 管理前后台 | 复用业务服务返回 URL；管理服务与业务服务使用同一个新测试库 | 不改无关管理上传协议，不修改生产 admin 配置 |

消息清理、历史文件复制、旧 OpenIM `engine=minio`→`ali-oss` 映射迁移 **不在本轮执行**。

## 业务配置与安全门禁

样例 [business.env.example](business.env.example) 是宿主回环测试参数，不能直接当成可用环境：需填入独立测试密码、测试入口与现有 RAM 凭据。
基础设施 [README](README.md) 创建的是独立实例，不是在现有生产 PostgreSQL 上加一个名称不同的库。

- 显式注入 `APP_ENV=oss-test` 后，不再读取现有业务目录 `.env`。请用干净进程/容器环境，不能继承生产变量。
- 启动前离线校验 PostgreSQL 库 `imapp_oss_test`、角色 `im_oss_test`、新实例地址及 DSN query；拒绝 host / dbname / user 等覆盖参数。
- 非空 Redis、MinIO、OpenIM 内部 API、Kafka 只能指规定的测试地址；真实短信必须关闭。未配置的 OpenIM / 队列只是禁用，**不代表聊天已可用**。
- `OSS_KEY_PREFIX` 测试时固定 `oss-test/business/`，签名和 HEAD/GET/PUT 都拒绝越界 key。直传 policy / 服务端 PUT 禁止覆盖已有对象，不提供桶管理或删除 API。
- `OSS_ACCESS_KEY_ID/SECRET` 复用现有 RAM，在服务器私密环境中填写，不发送到聊天/前端、不提交 Git。可选业务 `OSS_SESSION_TOKEN`；OpenIM 的限制见下节。
- 只启动基础设施不等于已完成业务测试。本仓库现已补齐本机应用 Compose、完整配置生成和前端测试模式；按 [本机 Docker 测试步骤](本机Docker测试步骤.md) 执行，不把生产应用 Compose 接过来。本机已运行应用栈及业务 OSS 冒烟，不代表全部聊天媒体/原生端到端已通过。

## 私有桶稳定读取

推荐填写 `OSS_MEDIA_PROXY_URL=https://<测试Origin>/api/v1/public/oss-media` 和独立且固定的 32 字符以上 `OSS_MEDIA_SIGNING_KEY`（可用随机 32 字节 hex）。
数据库保存稳定的 `key + HMAC token` URL，而不是会过期的 OSS 下载签名。GET 验证后 302 到 10 分钟签名地址，无须 JWT。

**这是持有链接即可读取的 capability 语义，与原公开媒体链接一致，不是群成员权限校验。** 不应在日志/工单中泄露 token；需要成员级访问控制时另做授权设计。
签名 key、代理 URL、bucket、prefix 必须持久保存；丢失或修改会使已保存链接失效。代理和原生媒体组件的 302、Range/续传要在真机验收。

业务服务已将该路由从 Gin 原始 URL 访问日志中排除；测试 Nginx / 网关也必须对这一精确路由关闭 query 日志（例如专用 location 配置 `access_log off`，或只记录 `$uri` 而不是 `$request_uri`），应用不会自动修改现有网关。

若已有可匿名读的媒体/CDN 域名，也可填 `OSS_PUBLIC_BASE_URL`，不可填私有桶裸地址后误认为它会自动公开。代码**不会修改桶 ACL**。
`OSS_PUBLIC_UPLOAD_URL` 是精确签名上传主机，不能在前端替换为 CDN 或内网地址。H5 跨域需要保留原有 CORS 规则，仅追加独立测试 Origin，单独核对变更。

## 聊天接入

详见 [openim-scope/README](openim-scope/README.md)。原生 `object.enable: oss` 不支持前缀；必须使用本目录补丁后的 **独立测试构建**，不能只改 YAML 后使用原始镜像写共享桶。
补丁校验版本、测试标记、Mongo 与 Redis 目标；prepare-apps 现已同时隔离其余服务的 Mongo、Redis、Kafka、etcd、secret 与回调，local 入口核对配置摘要、挂载、网络与构建。不能将离线校验等同于已运行/完整聊天验收。
香港测试接入还为固定 tools 源码的私有副本启用 CNAME，并固定测试桶/域名门禁；只改 `bucketURL` 不能修正 SDK 签名地址。实际 SDK 的 CNAME GET/PUT/POST/分片/图片参数及 MIME 契约共 3 项通过。真实 H5 小文件图片原图/独立缩略图 PUT、完成确认及历史私有 GET 已通过；尚未验证真正的大文件多分片及中断恢复。
真实上传曾返回 `403 SignatureDoesNotMatch`：客户端补充的 MIME 未进入 OSS V1 签名。测试补丁现在为没有显式 MIME 的 PUT/分片签入并返回 `application/octet-stream`，保留调用方显式 MIME，不改签名 URL/host、不放宽 RAM。契约用例在旧签名器实际失败、修复后通过；只重建本测试 third RPC，旧镜像及二进制保留。测试 Nginx 同时修正 upstream 的 `set`/`rewrite ... break` 顺序，并固定 `X-Request-Api` 为本机 HTTPS 媒体入口，未修改生产网关。
该上游 OSS 实现未正确传递 STS token，本轮聊天使用现有 RAM 长期密钥；不宣称 OpenIM 支持 STS。

## 兼容与回滚

1. 显式设置 `STORAGE_PROVIDER=minio`，旧 MinIO 链路继续使用原配置。未指定 provider 时默认 OSS，缺少必需 OSS 参数会在数据库访问前拒绝启动；旧部署升级前需按目标存储准备配置。
2. OSS 开启后只把新任务写到 OSS；文件任务完成确认固定 provider/bucket，旧任务仍用原 MinIO。未保留旧 MinIO 配置时明确报错，不把旧任务送进新桶。
3. 回滚新写入可改回 `STORAGE_PROVIDER=minio`，**保留 OSS 读配置、媒体签名 key 和解析路由**，已存在 OSS 文件 / pending 任务仍需读取。不能直接回滚到不支持 OSS 的旧二进制并期待新链接继续可读。
4. App 包记录保留原 download URL；OSS 上传失败不回退生产 MinIO、不发布记录。当前 pack-wgt 仍非完整测试环境启动器，不能用它自动发布来验证。
5. OpenIM 的旧对象映射按 engine 查询：保留旧 MinIO 本身不足以让历史逻辑 `/object/` 地址自动跨 engine 读取。第一轮使用空测试库；历史数据迁移/恢复与多 provider 读取另行验收。
6. 不开清理任务，不修改共享桶生命周期；OpenIM 临时对象清理默认禁用，可能残留测试对象。任何后续删除都需先核对测试引用及前缀。

## 验收清单

离线：Go tests/vet；OpenIM wrapper tests 与固定上游编译；前端 Vitest、type-check、ESLint、H5/App 构建；发布 helper 测试；测试数据栈反向检查。具体结果见下方记录。

独立测试环境验收清单（部分已执行，不能整体计绿）：

- 空测试库建表与 051 migration，业务/admin 共用新库；检查实际连接与用户，不能只看环境变量。
- OSS 凭据有效、无桶管理请求，上传实际 key 全在对应测试前缀。H5 CORS 预检/POST/PUT、App 原生 200/201/204、签名失败和超时。
- 业务头像、群头像、表情、举报附件、反馈图片、语音转码；创建→直传→确认，空包/大小不符/403 不得 ready。
- H5 + Android + iOS：图片原图/独立缩略图、语音、视频与独立封面、文件、转发、收藏、冷缓存与重登录、分片和重试。
- 旧 MinIO 资源与 pending 任务不改地址；OSS 新文件在改回 MinIO 后仍可读；私有解析过期刷新、下载、Range/续传。
- 只在测试 releases 验证包上传/读取和失败不发布，绝不使用客户热更新 channel/API。

### 早期离线验证记录（2026-10-17，非当前集成状态）

- Go 全量 tests / vet、前端 Vitest 22 项、type-check、发布 helper 4 项、数据栈 23 项反向检查通过。OSS OpenAPI YAML 和 Postman JSON 静态格式检查通过，没有发出接口请求。
- OpenIM 适配层 tests / vet 与打补丁后的固定上游 third RPC Windows/Linux amd64 编译通过；只生成本地测试产物，未运行二进制或制作/部署镜像。
- H5 / App 构建通过；静态 webp 资源已有未解析警告，App 有现存模块静态/动态混用提示。ESLint 为 0 errors / 186 warnings，没有把既有复杂度警告作为新增功能修复。
- 旧 `test:video-compat` 使用 Node 原生加载无法解析现有 `@/utils` 别名；旧 `test:notifications` 引用重构后缺失的 `friend-request.ts`，这两项不能计为通过。
- 无真实 OSS / 新库集成验证、无 Android/iOS 真机验收；以上不构成生产上线批准。

### 本机运行补充（2026-10-17 22:53，UTC+8）

- 75 项离线 Node 测试通过；严格 HTTPS 的 PC/移动端 Web 落地入口→登录→聊天布局、后台登录页通过。测试浏览器主动阻止可选 DCloud 推送资源和历史默认头像域名的请求，未借此访问线上业务 API。
- 业务与管理共用独立测试库，实际核对 81 张表、`files.storage_provider/storage_bucket` 以及应用角色无 superuser/createdb/createrole 权限。当前 1 个业务测试用户、1 个测试管理员；没有导入线上数据。
- 首次迁移发现业务 047 依赖管理 007 的两个配置表。测试启动器补齐两张空表后依次启动业务/admin，复用原始 DDL，实际数据库与角色双重门禁；没有修改线上迁移文件或数据。
- WSL 编译器卡在内核 `__vma_start_write`。关闭 Go 诊断标注后仍在 mmap 锁中停滞，故仅停止本任务两个构建客户端；未重启/清理 Docker。Windows 本机交叉编译 11 个静态 Linux 程序，应用相同的源码指纹/前缀/CNAME 补丁并运行 SDK 契约测试，验证 ELF/hash 后封装测试镜像成功。
- 本地业务注册/登录、OpenIM user/token、后台 health/login/me、未上传文件拒绝 ready 已通过。OSS 自定义域名当时被 Clash 解析为 `198.18.*`，本机 POST 和 curl TLS 连接超时；固定公网 IP 且保留 SNI/证书校验的只读排查也超时。不能据此判断 RAM/OSS 代码失败，不修改阿里云配置、不宣称上传成功。
- `smoke-business.cjs` 保留严格 TLS、目标主机/前缀、禁止覆盖、文件字段最后和显式写入开关；真实上传→确认→读取/大小不符、聊天图片/分片、语音/视频/转发、原生 App 及回滚仍待测试。

### 最新本机验收（2026-10-17 23:38，UTC+8）

- 网络阻塞已解除：Clash 四个独立前置 DOMAIN/DIRECT 规则生效，两桶 10 项严格 TLS/匿名私有桶/CORS/签名只读检查通过；无需再改桶、RAM、DNS 或证书。`198.18.*` fake-IP 本身不再作为失败判断。
- 业务 OSS 冒烟通过 POST 204→完成确认 ready→稳定 capability URL 302→私有 GET 200 且字节一致；未上传或大小不符不能 ready。仅写香港业务测试前缀，不删除对象。
- `smoke-chat-h5.py --write-test-objects --storage-only` 通过 PC/移动 Web 登录进房、各发送一张合成图片（原图+独立缩略图）、等待真实消息发送确认，再在新的浏览器上下文重登录读取本轮消息及历史图片。观察到 PUT 200、GET 200、4 个浏览器直传 key、3 个成功读取 key；这些是该次浏览器可观测计数，不是云端总对象数量。
- 聊天存储证据在 [result.json](artifacts/browser-chat-verify/b4ea11103a6742c796bbd33219f7c4cd/result.json)，同目录保存 PC 发图、移动 Web 发图和冷登录历史截图。未导出 token、签名链接、HAR 或浏览器会话；未出现非许可主机访问和本地 HTTP/SDK 错误。
- **实时收消息回归失败，不能计绿：**完整聊天模式中发送端收到确认，但另一在线端 60 秒内没有显示新文字；冷重登可读取已存消息。原因尚未定位，`--storage-only` 特意不验证实时接收，不能用其成功掩盖此项失败。本轮未修改前端实时消息逻辑。
- 77 项 Node 离线测试、4 项 Python 冒烟安全测试、3 项真实 SDK 离线签名契约及 H5 基础 3 项均通过；`local.cjs check` 与 23 个容器运行状态再次核验。没有重复导入数据或执行消息/对象清理。
- 未验范围：Android/iOS 原生、群聊、视频/语音/文件、原图预览与转发、大文件真实多分片/中断恢复、兼容回滚。最近 7 天且每群最多 500 条的清理未实现/未执行；以上不是生产迁移完成或上线批准。
