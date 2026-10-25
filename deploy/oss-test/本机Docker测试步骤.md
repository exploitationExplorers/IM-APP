# 本机 Docker Desktop：OSS 隔离测试操作手册

分支：`feat/chat-image-speed`。**本机测试栈已启动；下面的首次部署流程用于复现，不要重复初始化现有密码、数据卷、证书或构建产物。**

### 当前本机进度（2026-10-17）

- 23 个独立测试容器已启动（9 个数据服务 + 14 个应用服务）；业务 API、管理 API、HTTPS 网关健康。实际验证 PostgreSQL 为 `imapp_oss_test|im_oss_test`、81 张 public 表，包含本分支 051 的存储字段。PostgreSQL 应用角色无 superuser/createdb/createrole 权限；OpenIM 使用新 MongoDB `openim_oss_test`，没有导入线上数据。
- 两个香港测试桶已绑定下面的专用域名，Let's Encrypt 双域名证书到期时间为 2027-01-15 20:33（UTC+8）。证书、私钥和 ACME 账户资料仅保存在 ignored private 目录；当前为手动签发/部署，不会自动续签。
- 测试 `.env` 已更新到香港桶与自定义域名，保留全部原测试密码和 RAM 凭据；旧 runtime 仅在 private 内重命名备份，新 runtime 由生成器重新生成，没有手改摘要。
- 官方 OSS Go SDK v2 已对两个香港桶验证自定义域名 query 签名、header 签名及香港默认 endpoint 的只读 GET，随机不存在的测试 key 均返回 `404 NoSuchKey`。这验证读取鉴权，不代表 POST/PUT/分片上传已通过。
- OpenIM CNAME/MIME 签名的 3 项真实 SDK 离线契约测试、77 项 Node 部署/检查器/冒烟保护离线测试、4 项 Python 聊天冒烟安全测试、OpenIM scope tests/vet 通过。项目专用本地 CA 已安装并用真实 Edge 严格 HTTPS 验证，无须重复安装。
- WSL 内核的 Go 编译先卡在 `set_anon_vma_name` / `__vma_start_write`，增加测试专用 `GODEBUG=decoratemappings=0` 后仍出现 mmap 锁停滞，不能把该参数视作修复。最终使用 Windows Go 1.23.12 交叉编译相同锁定源码和补丁，完成 11 个静态 Linux 程序、ELF/hash 校验与测试镜像封装；业务/admin 镜像也已构建。不重启/清理 Docker，不影响其他项目。参数依据：[Go 官方 GODEBUG 文档](https://go.dev/doc/godebug#go-125)。
- 真实注册/登录、OpenIM user/token、后台登录与鉴权资料读取通过。`smoke-business.cjs` 实测通过未上传不可 ready、业务 OSS POST→完成确认→私有 capability 重定向读取，以及大小不符不可 ready；本次新增两个香港业务测试前缀对象，不删除对象。早先网络失败留下的 pending 任务保留在测试库。
- 用户将 Clash Verge 的四个 OSS 域名拆成独立前置 DIRECT 规则后，两个域名严格 HTTPS 恢复；`check-oss.cjs` 的 10 项匿名/CORS/签名只读检查全部通过。fake-IP 仍可能是 `198.18.*`，是否成功以真实 TLS/HTTP 检查为准，不据此修改 DNS、RAM 或证书。
- `smoke-h5.py` 已在真实测试应用通过 PC/移动端 Web 的下载入口→登录→聊天布局和管理登录页；只允许本地请求，不导出浏览器会话、HAR 或敏感日志。这些检查不代表聊天发图或 App 原生已通过；聊天媒体验收单独记录。
- 聊天实测发现本地 Nginx 的 `rewrite ... break` 跳过了后续 upstream `set`，导致 OpenIM HTTP 500；已将 `set` 前置，补齐两项回归测试，并仅对本测试网关执行 `nginx -t` / 热重载。直接 API 与网关均返回预期的 OpenIM JSON 鉴权错误，不再是 Nginx HTML 500；未修改生产网关。
- OpenIM 上传曾因 SDK 自动补 MIME 返回 `403 SignatureDoesNotMatch`，已在测试签名器对小文件 PUT/分片显式返回匹配的 Content-Type，保留显式 MIME；补齐真实签名契约红→绿测试，仅重建/重启本测试 third RPC。旧镜像及旧 third 二进制/manifest 已本地保留，当前 `artifacts/openim-linux` 的 11 个 ELF/hash 重新核验，后续封装不会退回旧签名器。网关另固定 `X-Request-Api` 为本地 HTTPS OpenIM 前缀，避免生成 Docker 内部 HTTP 媒体 URL。
- 23:38（UTC+8）验收：`smoke-chat-h5.py --write-test-objects --storage-only` 全部通过。PC/移动 Web 各发送一张合成图片，原图+独立缩略图真实 PUT 200，等待真实发送确认后，新上下文重登录可从历史读到本轮两条消息并显示私有图片（GET 200）。没有非许可主机访问或本地 HTTP/SDK 错误。证据为 [result.json](artifacts/browser-chat-verify/b4ea11103a6742c796bbd33219f7c4cd/result.json)，同目录有人工检查过的三张截图。浏览器观测到 4 个直传 key、3 个成功读取 key，不代表云端总对象数。
- **仍有未通过项：两端实时收消息回归。**发送端收到确认，但另一在线端在 60 秒内未显示新文字；冷重登可读取消息。尚未定位原因，本轮未修改前端实时消息逻辑。存储专项 `--storage-only` 不验证实时接收，因此不是完整聊天通过，也不构成上线批准。23 个容器仍运行，业务/管理/网关健康；不用再次初始化数据库、OSS 或证书。

应用启动并健康后，可显式重跑以下冒烟（会追加测试数据，不要无意义反复执行）：

```powershell
# 会在本地测试库创建测试数据，并新增两个香港业务测试前缀对象；不删除对象。
node E:\Code\IM-APP\deploy\oss-test\smoke-business.cjs --write-test-objects
# 依赖前一条已建立的本地账号。需受信任的本地 HTTPS；不关闭证书校验。
& 'E:\Code\IM-APP\deploy\oss-test\artifacts\verify-venv\Scripts\python.exe' E:\Code\IM-APP\deploy\oss-test\smoke-h5.py --local-only
# 聊天独立存储验收：会新建本地第二账号/好友、发测试图片并写聊天测试前缀。
# --storage-only 不验证实时收消息，不能将成功解释为完整聊天 E2E。
& 'E:\Code\IM-APP\deploy\oss-test\artifacts\verify-venv\Scripts\python.exe' E:\Code\IM-APP\deploy\oss-test\smoke-chat-h5.py --write-test-objects --storage-only
# 不联网的聊天冒烟安全测试（不依赖 Playwright）：
& 'E:\Code\IM-APP\deploy\oss-test\artifacts\verify-venv\Scripts\python.exe' E:\Code\IM-APP\deploy\oss-test\smoke_chat_h5_test.py
```

## 一、哪些需要你手动准备？

| 项目 | 要不要手动创建 | 说明 |
| --- | --- | --- |
| 测试 PostgreSQL / MongoDB / Redis / Kafka / etcd / 测试 MinIO | 不需要逐个创建 | `local.cjs infra-up` 创建独立容器和全新测试卷，不连接生产实例 |
| 业务库与用户 | 不需要执行 CREATE DATABASE | 新空卷首次启动自动创建 `imapp_oss_test` / `im_oss_test` |
| OpenIM 库与用户 | 不需要执行建库脚本 | 新 Mongo 实例初始化 `openim_oss_test` / `im_oss_test` |
| 业务表 / 管理表 | 不需要手动补表 | 启动器先补齐两个空共享配置表，再由业务 API 自动 migrations，健康后管理 API 再 migrations，包含本分支 051 |
| OSS 桶 / RAM 用户 | 已准备香港测试桶；RAM 复用 | `yikeliao-188-hk-test`、`yikeliao-188-business-hk-test`；现有 `im-app-oss`。原杭州桶保持不动 |
| OSS 凭据 | 需要本地填写 | 填已有 RAM 的 AK/SK；不发送聊天、不提交 Git、不填前端 |
| Docker Desktop 和本地可信证书 | 需要你安装 / 授权信任 | 只操作本机；不是申请新的生产域名或修改生产证书 |
| OSS CORS | 仅缺少测试 Origin 时手动追加 | 保留全部原规则，不修改 ACL、RAM、生命周期 |
| 原生测试壳 | 真机联调时另行准备 | 独立 AppID/包名/沙盒，不覆盖现有客户壳 |

业务与管理端共用**新的测试业务库**，并非各自创建互不一致的库。OpenIM 使用另一套测试 Mongo/Redis/Kafka/etcd。测试对象物理 key 固定在 `oss-test/business/` 与 `oss-test/chat/`，不开放删除。

## 二、准备本机工具与 Docker

1. 安装 / 打开 Docker Desktop，启用 WSL 2，切换 **Linux containers**。
2. 安装 Node.js 22.12+（或满足项目构建要求的较新 LTS）、Git，以及满足锁定 OpenIM 模块要求的 Go。本机 Windows Go 1.23.12 已完成配置核验和备用交叉编译；业务/admin Dockerfile 使用自己的 Go 工具链，不要求为本轮测试升级宿主 Go。
3. 建议为 Docker 预留 4+ CPU、12GB 左右内存、30GB+ 可用磁盘；内存不足时不要同时启动其他大型环境。镜像拉取需要网络，有些历史 Bitnami 镜像使用 `bitnamilegacy`，可用性仍需真实拉取验证；不要私自换成连接现有集群的镜像/配置。
4. 新开一个**不含生产配置的 PowerShell**，执行：

```powershell
Set-Location E:\Code\IM-APP
git branch --show-current
docker compose version
docker context show
docker context inspect desktop-linux --format '{{.Endpoints.docker.Host}}'
docker info --format '{{.OSType}}'
```

预期分支 `feat/chat-image-speed`，context `desktop-linux`，endpoint `npipe:////./pipe/dockerDesktopLinuxEngine`，系统 `linux`。不是这些值就停下检查；不要切到服务器 context 执行。脚本只允许这个本机 Desktop endpoint。

建议 Compose 2.39+。端口均绑定本机回环：数据库 `15433`，业务 Redis `16379`，OpenIM Redis `16380`，Mongo `27027`，两套 MinIO `19000/19001`、`19100/19101`，业务 API `18080`，管理 API `18090`，OpenIM `11001/11002`，HTTPS `18443/18444`。

还会创建测试专用 `172.30.187.0/24` 数据网与 `172.30.188.0/24` 应用出网网；数据库不接出网网。若和本机 VPN / 其他网络重叠，应停下调整模板、回调白名单与测试，不复用线上网络。

## 三、安装测试工具，保留已有测试密码

```powershell
npm --prefix E:\Code\IM-APP\deploy\oss-test ci --ignore-scripts --no-audit --no-fund
node E:\Code\IM-APP\deploy\oss-test\validate-config.cjs --example
```

只有 `E:\Code\IM-APP\deploy\oss-test\.env` **不存在**时，才执行：

```powershell
node E:\Code\IM-APP\deploy\oss-test\init-env.cjs
```

该文件此前若已生成，**直接保留**；初始化器会拒绝覆盖。它产生 16 份独立随机密码/密钥，OSS AK/SK 留空。不要重生成密码来解决已有数据卷的登录问题；初始化脚本只在新空卷上运行。

仅在本机编辑这个测试文件：

```powershell
notepad E:\Code\IM-APP\deploy\oss-test\.env
```

需要确认 / 填写以下项（无引号、无多余空格）：

```dotenv
TEST_PUBLIC_ORIGIN=https://localhost:18443
TEST_ADMIN_ORIGIN=https://localhost:18444
TEST_OSS_REGION=cn-hongkong
TEST_OSS_CHAT_BUCKET=yikeliao-188-hk-test
TEST_OSS_BUSINESS_BUCKET=yikeliao-188-business-hk-test
TEST_OSS_CHAT_ORIGIN=https://oss-chat-test.xn--jprz53bj9s.com
TEST_OSS_BUSINESS_ORIGIN=https://oss-business-test.xn--jprz53bj9s.com
TEST_OSS_CHAT_PREFIX=oss-test/chat/
TEST_OSS_BUSINESS_PREFIX=oss-test/business/
TEST_OSS_DELETE_ENABLED=false
TEST_OSS_ACCESS_KEY_ID=这里填已有RAM的AccessKeyID
TEST_OSS_ACCESS_KEY_SECRET=这里填已有RAM的AccessKeySecret
```

**旧测试文件需要只更新上面非敏感的 Origin、region、bucket 参数，增加两个 OSS Origin，保留所有随机密码与已有 AK/SK。** 其余键与 `.env.example` 对齐，不添加生产 DATABASE_URL 或短信参数。AccessKeySecret 若没有留存，应从你现有的安全凭据存储取得；控制台通常不能重新显示创建时的 secret，不要为此禁用或轮换线上正在使用的 key。

不要把现有 server/admin/front 的 `.env` 拷进测试目录。终端若有 `TEST_*`、`COMPOSE_*`、`DOCKER_HOST/CONTEXT` 覆盖，脚本会拒绝；前端构建也拒绝外部 `VITE_*`、`UNI_*` 覆盖。优先换干净终端，不输出这些变量的值。

## 四、本地 HTTPS 证书（仅本机）

私有业务媒体使用稳定 HTTPS capability URL，因此不能仅用 HTTP 网关假装完成读取测试。

1. 安装 mkcert。例如 Windows 允许使用 winget 时：`winget install --id FiloSottile.mkcert -e`。无法使用时从 mkcert 官方发行版安装。
2. 执行 `mkcert -install`，按本机提示授权信任开发 CA。这是本机系统信任变更，不是生产变更。
3. 创建本测试目录并签发证书；如果已有这两个文件，先确认用途，**不要覆盖现有证书**：

本机已有 `init-tls.cjs` 生成的专用 CA 时，信任的是该 CA，而不是 mkcert 默认 CA：在 PowerShell 执行 `$env:CAROOT='E:\Code\IM-APP\deploy\oss-test\private\tls\ca'`，再执行 `& 'E:\Code\IM-APP\deploy\oss-test\artifacts\tools\mkcert.exe' -install`，按系统提示授权，最后 `Remove-Item Env:CAROOT`。此步骤必须由用户明确授权信任，不通过关闭证书校验代替。

```powershell
New-Item -ItemType Directory -Force E:\Code\IM-APP\deploy\oss-test\private\tls | Out-Null
mkcert -cert-file E:\Code\IM-APP\deploy\oss-test\private\tls\localhost.pem -key-file E:\Code\IM-APP\deploy\oss-test\private\tls\localhost-key.pem localhost 127.0.0.1 ::1
```

私钥与测试配置均已被本目录忽略。不要提交、粘贴或上传开发 CA 的 `rootCA-key.pem`。脚本检查 localhost、证书有效期和证书/私钥匹配；浏览器是否信任还需你确认，不能通过“忽略证书错误”验收。

## 五、OSS 控制台只追加必要的测试跨域规则

分别打开两个香港测试 Bucket → 权限管理 / 跨域设置。不要修改原杭州桶：

1. 先查看并留存当前规则，保留生产 Origin、方法、Headers 和缓存配置。
2. 已允许以下 Origin 时不必新增；否则**追加规则**，不要覆盖现有规则：
   - `https://localhost:18443`（客户端）
   - `https://localhost:18444`（管理端如有直传）
   - 使用可选 Vite 调试时才加 `http://localhost:15173`、`http://localhost:15180`。
3. 测试规则允许 `GET`、`HEAD`、`POST`、`PUT`；请求头可允许 `*`，暴露头包含 `ETag`、`x-oss-request-id`、`x-oss-hash-crc64ecma`。OPTIONS 由 OSS 预检处理，不需要开放 DELETE。
4. 不修改桶 ACL / 公共读写，不替换 RAM 策略，不设置全桶 7 天生命周期，不运行全桶同步删除。

脚本不执行这些云控制台变更。同一 RAM 复用不是权限隔离，测试前缀还由业务和 patched OpenIM 强制保护。已有桶若公开读，本轮不会把它改成私有；不要误认为加了签名 URL 就改变了桶权限。

### 香港测试桶的域名与 RAM 核验

| 桶 | 精确签名 HTTPS Origin |
| --- | --- |
| `yikeliao-188-hk-test` | `https://oss-chat-test.xn--jprz53bj9s.com` |
| `yikeliao-188-business-hk-test` | `https://oss-business-test.xn--jprz53bj9s.com` |

RAM 继续复用原用户。若缺少香港桶的授权，在 RAM → 权限管理 → 权限策略 → 创建自定义策略 → JSON 编辑中使用本目录 `ram-hk-test-policy.json`，命名例如 `IMAppOSSHKTestUpload`，再在现有用户权限页追加附加该策略；**不替换原策略，不增加 FullAccess/删除权限，不新建或轮换 AK**。新增策略不能抵消其他策略的显式 Deny，也不会收窄原有权限。

执行只读检查（不会上传、删除或改云配置；只在测试前缀请求随机不存在的对象）：

```powershell
node E:\Code\IM-APP\deploy\oss-test\check-oss.cjs
```

逐项核对 HTTPS、两个 localhost Origin 的 CORS、RAM 签名 GET/HEAD。匿名读取返回 403 属于私有桶预期；**签名读取随机不存在的对象应返回 404**，403 不能算授权通过。证书域名不匹配或网络错误同样会令命令失败，不会跳过校验。默认 DNS 受 fake-IP 影响时，用公共 DoH 核对，不要据本机 TXT 查询失败删除现有 DNS。

### Clash Verge 与 OSS 直连

当前本机已正确设置，正常时无需重做。若开启 VPN 后 OSS TLS 超时，而 Docker Hub 可以访问：Clash Verge → 订阅 → 右键当前订阅 → 编辑规则，分别新增四条**前置**规则，类型 `DOMAIN`、策略 `DIRECT`：

| 单独一条规则的域名值 | 策略 |
| --- | --- |
| `oss-chat-test.xn--jprz53bj9s.com` | DIRECT |
| `oss-business-test.xn--jprz53bj9s.com` | DIRECT |
| `yikeliao-188-hk-test.oss-cn-hongkong.aliyuncs.com` | DIRECT |
| `yikeliao-188-business-hk-test.oss-cn-hongkong.aliyuncs.com` | DIRECT |

**一个域名框只填一个域名，不能用空格把四个域名塞进同一条 DOMAIN 规则。** 保存后使用 Rule/规则模式，仅关闭旧 OSS 连接再复测。不修改订阅 URL、全局 Docker 配置、桶/RAM/证书，不关闭 TLS 校验。Docker 镜像已缓存，日常启动不需要重新拉取。

## 六、生成完整测试应用配置并做离线检查

```powershell
node E:\Code\IM-APP\deploy\oss-test\validate-config.cjs
node E:\Code\IM-APP\deploy\oss-test\prepare-apps.cjs
node --test E:\Code\IM-APP\deploy\oss-test\*.test.cjs E:\Code\IM-APP\deploy\oss-test\openim-scope\patch-openim.test.cjs
```

`prepare-apps.cjs` 从 Go 校验过的模块缓存读取 **OpenIM v3.8.3-patch.15** 默认配置，并核对 third 源码指纹；必要时仅下载依赖，不修改模块缓存。生成：

- `private/runtime/business.env`、`admin.env`：只连接本测试实例，APP_ENV 显式为 oss-test；
- `private/runtime/openim/`：21 份完整所需 YAML，Mongo/Redis/Kafka/etcd、secret、webhooks 全部隔离，离线推送使用 dummy；
- `private/runtime/frontend.json`：仅本机公开地址，不含 AK/SK；
- `private/runtime/manifest.json`：版本、测试 env 与生成文件校验摘要，发现配置过期/手改时拒绝启动。

不会生成或启动 OpenIM crontask，不执行 7 天 / 500 条清理。媒体签名 key 由测试内部密钥经独立用途 HMAC 派生，须连同 `.env` 长期保留。配置已存在会拒绝覆盖，刷新流程见末尾。

77 个 Node 离线测试只用假凭据/模板，不读真实 `.env` 或运行数据服务。首次下载 Go 配置或 NPM 依赖需要网络；数据库、OSS 不会被这些用例访问。`check-oss.cjs` 是另外显式执行的联网只读检查，不属于离线测试。

## 七、让 Docker 自动创建测试空库

这一步才真正启动容器 / 创建本机测试卷，确认前面步骤通过后由你执行：

```powershell
node E:\Code\IM-APP\deploy\oss-test\local.cjs infra-up
```

首次新空卷自动完成：

- PostgreSQL 创建 `imapp_oss_test`，初始化管理员 `oss_test_admin`，应用角色 `im_oss_test`（无 superuser / createdb / createrole）；
- MongoDB 创建 `openim_oss_test` 的应用用户（不把 root 凭据交给 OpenIM）；
- 两套独立 Redis、Kafka、etcd，以及两个仅作后续迁移源的测试 MinIO。

业务表此时尚未创建。可执行以下**只读**核验，不输出密码：

```powershell
$dc = @('compose', '--project-name', 'im-app-oss-test', '--env-file', 'E:\Code\IM-APP\deploy\oss-test\.env', '-f', 'E:\Code\IM-APP\deploy\oss-test\compose.infra.yml')
& docker @dc exec -T postgres sh -c 'PGPASSWORD="$TEST_PG_APP_PASSWORD" psql -h 127.0.0.1 -U im_oss_test -d imapp_oss_test -Atc "select current_database(), current_user"'
```

预期：`imapp_oss_test|im_oss_test`。不要通过改到生产库绕过登录/健康检查失败。

## 八、构建隔离前端与应用镜像

若前端依赖未装，分别在项目安装（不更换 lockfile、不运行发布脚本）：

```powershell
Push-Location E:\Code\IM-APP\IM-APP-fronend
npm ci --no-audit --no-fund
Pop-Location
Push-Location E:\Code\IM-APP\IM-APP-system
npm ci --no-audit --no-fund
Pop-Location
```

只使用专用入口：

**当前本机镜像和前端产物已经完成，日常请跳过本节构建，直接执行下一节 `check` / `up`。** `up` 固定使用 `--no-build`，不会重复触发此前 WSL 编译停滞。

```powershell
node E:\Code\IM-APP\deploy\oss-test\frontend.cjs client-build
node E:\Code\IM-APP\deploy\oss-test\frontend.cjs admin-build
node E:\Code\IM-APP\deploy\oss-test\local.cjs build
node E:\Code\IM-APP\deploy\oss-test\local.cjs check
```

- H5 输出 `artifacts/front-h5`，管理端输出 `artifacts/admin-web`；不覆盖线上部署目录或原项目 dist。
- oss-test 模式不读取项目普通 dotenv，所有代理替换为本机测试入口，目标缺失立即失败；普通构建行为保持原样，**不要用普通 npm dev/build 来联调本测试环境**。
- OpenIM 镜像从锁定源码单独拷贝，打前缀安全补丁，并对私有 tools 副本启用 CNAME；镜像构建先测试真实 SDK 的自定义域名 GET/PUT/POST/分片/缩略图签名，再编译 11 个非 cron 程序。禁止修改 Go 模块缓存、只改 bucketURL 或替换已签名 host；不要使用未打补丁的上游镜像。
- 镜像构建上下文排除 `.env` / private；artifacts 仅白名单允许备用封装所需的 `openim-linux/openim-*` 二进制，其余产物不进入上下文。AK/SK 只在运行时只读配置中，不写前端/镜像构建参数。
- `check` 仅离线校验 23 个服务及配置、证书匹配、前端入口文件，不代表注册、聊天、上传已经成功。首次镜像构建/拉取可能较久。

WSL 出现上述内核编译停滞时，不要重复 `local.cjs build`、全局结束进程或重启 WSL/Docker。可使用专用 Windows 备用构建器：

```powershell
# 仅在需要首次构建且 artifacts/openim-linux 不存在时执行；已有产物会拒绝覆盖。
node E:\Code\IM-APP\deploy\oss-test\build-openim-host.cjs
```

它复制并核验锁定源码、应用同一前缀/CNAME 补丁、运行真实 SDK 离线契约测试，交叉编译 11 个静态 Linux/amd64 程序，验证 ELF/hash 后调用 `openim.prebuilt.Dockerfile` 封装同名测试镜像。业务/admin 镜像如仍缺失，只在通过隔离检查后用本测试 Compose 单独构建 `api admin`，不要再构建 `openim-api`。不跳过门禁，不采用未打补丁的上游镜像。

## 九、启动并访问（自动迁移只作用于测试库）

```powershell
node E:\Code\IM-APP\deploy\oss-test\local.cjs up
node E:\Code\IM-APP\deploy\oss-test\local.cjs ps
```

启动器先核对实际本机 PostgreSQL 容器标签、当前库和角色，再从管理迁移 007 的原始 DDL 提取 `app_configs` / `app_config_versions` 两张共享空表，解决业务 047 与管理迁移的首次建表依赖环；不修改生产迁移文件、不写入或更新已有行。随后业务服务执行完整 migrations；它健康后管理服务再执行其 migrations。OpenIM 使用独立配置，回调只发到测试业务 API。`--wait` 检查健康检查/容器运行状态；OpenIM RPC 的业务就绪仍需实际登录和消息验证。

- 客户端：[https://localhost:18443](https://localhost:18443)
- 管理前端：[https://localhost:18444](https://localhost:18444)
- 业务健康：[https://localhost:18443/health](https://localhost:18443/health)
- 管理健康：[https://localhost:18444/api/admin/v1/health](https://localhost:18444/api/admin/v1/health)

管理用户名 `oss_test_admin`，密码在本机测试 `.env` 的 `TEST_ADMIN_BOOTSTRAP_PASSWORD`，不会在终端输出。业务本地测试账号 `15013938612` / `asd.12345`；聊天冒烟会另建 `15013938613`，使用同一测试密码并建立本地好友关系。不要使用生产账号。本地开发验证码为 **246810**；真实短信签名/模板与第三方离线推送均禁用，不接生产回调。

日志只在本机看，分享前脱敏；不得输出完整 `docker compose config`（包含凭据）。测试网关关闭 query 访问日志，避免泄露媒体 capability / SDK token。

## 十、H5、管理端与 App 验收清单

先创建两个新测试用户与新群，不导入线上 token / 群 / 发布任务：

- H5 PC 与移动视口：头像、单聊/群聊原图与独立缩略图、语音、视频/封面、文件、表情上传/下载；签名 URL 不被替换；转发和重进页面仍正常。
- 冷缓存/刷新/退出重登：能重新获取媒体；业务私有媒体经过 HTTPS capability → 302 → OSS，Range、播放和续传单独验证。
- 管理端：列表、预览、审核、配置/用户修改只在新测试库出现；原线上后台内容不变。
- OSS 控制台按前缀查看新对象：聊天仅 `oss-test/chat/`，业务仅 `oss-test/business/`；前缀外不新增、不覆盖、不删除。
- OpenIM：真实消息同步、已读、撤回/转发和回调都需运行验证，不能只看容器 Running。
- 不发布 WGT、不执行旧对象迁移、不运行消息/对象清理。

原生资源可单独编译：

```powershell
node E:\Code\IM-APP\deploy\oss-test\frontend.cjs app-resources
```

输出 `artifacts/app-resources`，不会 pack/publish WGT；oss-test 包禁止自动/手动安装热更新。**这不是已签名的独立 APK/IPA，也没有自动改现有 manifest 的 AppID/包名。** 在单独测试壳/沙盒运行；不要把这些资源装进线上客户壳。

本阶段所有端口仅本机可见，手机上的 localhost 指手机本身。Android 可在独立调试壳中研究 `adb reverse tcp:18443 tcp:18443`，并配置对开发 CA 的应用级信任；这不代表 Android 默认会信任用户 CA。iOS/真实手机的 LAN 入口、证书 SAN 与信任、独立包名需另行配置和审核，当前脚本故意拒绝公网/LAN Origin。不得改成生产 API 让真机“先跑通”。App 必须继续检查 camelCase/PascalCase 媒体字段、原生上传/保存/转发；H5 或资源构建通过不等于真机通过。

可选 H5 开发调试（HTTPS 网关已运行后）：

```powershell
$env:NODE_EXTRA_CA_CERTS = 'E:\Code\IM-APP\deploy\oss-test\private\tls\ca\rootCA.pem'
node E:\Code\IM-APP\deploy\oss-test\frontend.cjs client-dev
# 另一干净终端同样配置开发CA，然后：
node E:\Code\IM-APP\deploy\oss-test\frontend.cjs admin-dev
```

对应 `127.0.0.1:15173/15180`，代理仍只连本机 HTTPS 测试网关。不要设置 `NODE_TLS_REJECT_UNAUTHORIZED=0` 或关闭代理证书校验。

## 十一、停止、重启和配置刷新

```powershell
node E:\Code\IM-APP\deploy\oss-test\local.cjs stop
# 重启时先检查，再 up；不会删除测试卷：
node E:\Code\IM-APP\deploy\oss-test\local.cjs check
node E:\Code\IM-APP\deploy\oss-test\local.cjs up
```

日常不使用 `down -v`、`docker system prune`、全局 stop、重建生产卷或全桶删除。

修改配置前先 `stop`。需要重新生成 runtime 时，在资源管理器内核对绝对路径 `E:\Code\IM-APP\deploy\oss-test\private\runtime`，将它**仅在同一 private 目录内**改名备份，再运行 `prepare-apps.cjs`、相应前端构建、`local.cjs check`；不要删除数据卷，不随意更换已有数据库密码。备份也含密钥，不上传或提交。不要手改生成的 env/YAML 后更新校验摘要来绕过检查。

## 十二、当前验证边界

已离线验证：77 项 Node 部署/检查器测试、4 项 Python 聊天冒烟安全测试、3 项真实 SDK CNAME/MIME 契约测试、业务/管理 Go tests+vet、客户端 26 项 Vitest、发布 helper 4 项测试、客户端和管理端 type-check、oss-test H5 / App 资源 / 管理端构建。原有前端结果属于前轮记录，本轮未更改前端媒体逻辑。

已知构建告警：旧静态 webp 缺失、原有动态/静态混合导入，管理端 chunk 较大。既有 `test:video-compat` 别名和 `test:notifications` 缺失文件问题另列，不算通过。

**已实测通过：**23 容器启动、新测试库建表/051、真实业务 OSS POST→确认→私有读取、缺失/大小不符拒绝 ready、业务与后台登录鉴权、PC/移动端 Web 登录布局；PC/移动 Web 聊天原图+独立缩略图 PUT、真实发送确认、新浏览器上下文重登录历史私有图片 GET。最后一项是 `--storage-only` 存储专项，不包含实时接收。

**已回归但未通过：**双端实时收新消息；发送确认后另一在线端 60 秒内未显示文字，冷重登可读，原因未定位。不能把容器 Running 或历史读取通过当成实时同步通过。

**仍未验收：**原图预览 UI、群聊、语音/视频/文件/转发、真正大文件多分片及中断恢复、兼容回滚、Android/iOS 真机。最近 7 天且每群最多 500 条的消息/对象清理本轮未实现/未执行。用户已完成香港测试桶/DNS/证书/RAM 的控制台配置，原杭州桶与线上服务未由本轮工具修改；这些结果不是生产迁移完成或上线批准。
