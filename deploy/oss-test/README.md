# OSS 迁移独立测试数据栈

开发分支：`feat/chat-image-speed`。完整前后端方案见[聊天媒体存储迁移阿里云 OSS 方案](../../docs/聊天媒体存储迁移阿里云OSS方案.md)，尤其第 13 节。

**本目录是限定 localhost/Docker Desktop、禁用 App 热更新的本机测试套件。公网测试、手机安装及 WGT 分发需另行准备独立的线上测试环境；相关部署工作已暂停，本套件不能直接改域名后部署到公网。**

本目录提供 **9 个独立数据服务 + 14 个应用服务（共 23 个容器）** 的本机 Docker Desktop 测试文件。`compose.infra.yml` 只定义数据栈，`compose.apps.yml` 增加业务/管理 API、11 个独立 OpenIM 服务及 HTTPS 网关；两套前端使用显式 oss-test 模式构建。不连接线上数据库，不创建 OSS 桶，不执行消息清理或发布 WGT。

**从这里操作：[本机 Docker 测试详细步骤](本机Docker测试步骤.md)。** 包括自动建库、已有 OSS 凭据填写、本地证书、CORS、前后端构建/启动、验收和停止流程。数据库无需手动创建；完整本地栈已启动，真实业务 OSS 上传→确认→私有读取，以及 PC/移动 Web 聊天图片上传→发送确认→冷登录历史私有读取已通过；两端实时收消息回归尚未通过，不代表完整聊天验收通过。

**本轮应用代码接入已补充：**业务 OSS 存储层、H5/App 上传兼容、私有媒体解析、包上传失败保护、锁定 OpenIM 版本的测试物理 key 适配层，以及本机应用部署文件与启动门禁。配置、兼容/回滚边界及验证结果见 [OSS接入与验收](OSS接入与验收.md)；文件完成不代表容器及完整测试应用栈已运行就绪。

**当前实际配置：**原杭州桶 `yikeliao-188`、`yikeliao-188-business` 保持不动；因域名接入条件，用户已另建香港测试桶 `yikeliao-188-hk-test`、`yikeliao-188-business-hk-test` 并配置专用 HTTPS 域名。RAM 继续使用现有 `im-app-oss`；数据库、OpenIM、缓存、队列等独立新建。测试对象限定在测试前缀内，不运行删除。新模板/启动校验拒绝切回原杭州桶。

2026-10-17 23:38（UTC+8）本机状态：23 个测试容器已启动，PostgreSQL 为独立库 `imapp_oss_test`、应用角色 `im_oss_test`，81 张 public 表，包含 051 的存储字段；当前 2 个本地业务测试账号和 1 个测试管理员，无生产数据。77 项离线 Node 测试、4 项 Python 聊天冒烟安全测试、3 项真实 SDK CNAME/MIME 离线契约通过；两个香港桶 10 项严格 HTTPS/CORS/签名只读检查、真实业务 OSS POST→完成确认→私有读取、未上传/大小不符不可 ready 均通过。业务注册/登录、OpenIM 用户/token、后台登录鉴权资料、严格 HTTPS 下 PC/移动端 Web 登录布局和后台登录页通过。聊天存储专项通过 PC/移动 Web 各发一张图片（原图与独立缩略图 PUT 200）、真实发送确认及新浏览器上下文重登录后的历史图片读取（GET 200）。测试网关 upstream 初始化顺序及 HTTPS 媒体入口已修复；测试 OpenIM 签名器补齐匹配的 Content-Type，仅重建 third RPC，未改线上。OpenIM 已由 Windows 交叉编译、验证 ELF/hash 后封装（WSL 内核编译卡住的备用方案）。测试业务文件 1 ready / 6 pending（含故意缺失/大小不符和早先失败任务），全部是业务测试桶/前缀。**实时双端收消息回归仍失败：发送确认后另一在线端未在 60 秒内显示新消息，冷重登可读；原因未定位，不以存储专项代替完整聊天验收。** App 原生、大文件真实多分片和其他媒体仍待验，不执行删除。最新边界和证据见详细手册。

## 资源与地址

| 服务 | Docker 测试网络内地址 | 宿主回环检查地址 | 持久化 |
| --- | --- | --- | --- |
| PostgreSQL | `postgres:5432`，库 `imapp_oss_test`，用户 `im_oss_test` | `127.0.0.1:15433` | 新测试卷 |
| 业务 Redis | `redis:6379`，DB 0，独立密码 | `127.0.0.1:16379` | 新测试卷 |
| OpenIM MongoDB | `openim-mongodb:27017`，库 / authSource `openim_oss_test`，用户 `im_oss_test` | `127.0.0.1:27027` | 新测试卷 |
| OpenIM Redis | `openim-redis:6379`，独立密码 | `127.0.0.1:16380` | 新测试卷 |
| OpenIM etcd | `openim-etcd:2379` | 不发布 | 新测试卷 |
| 业务 Kafka | `kafka:19092` | 不发布 | 新测试卷 |
| OpenIM Kafka | `openim-kafka:9092` | 不发布 | 新测试卷 |
| 业务迁移源 MinIO | `minio-source:9000`，桶 `im-uploads-oss-test` | API `127.0.0.1:19000`，控制台 `:19001` | 新测试卷 |
| OpenIM 迁移源 MinIO | `openim-minio-source:9000`，桶 `openim-oss-test` | API `127.0.0.1:19100`，控制台 `:19101` | 新测试卷 |

Docker 项目固定为 `im-app-oss-test`，卷和网络使用项目名前缀；没有生产固定容器名、外部生产网络或生产目录挂载。数据网络为 internal bridge，后续应用访问 OSS 需要额外配置测试出口。回环端口仅用于当前宿主检查，手机不能使用手机自身的 `127.0.0.1` 访问它们。

业务后端和管理后端要**共用这个新的测试业务库**，因为存在共享业务表；与生产数据库隔离，不是把业务与管理端拆到互不一致的两个库。PostgreSQL 新建应用角色不授予超级用户、建库或建角色权限。MongoDB 使用专用测试库角色，不将 root 凭据提供给 OpenIM。

## 离线准备与检查

以下命令从 `E:/Code/IM-APP` 执行。先确认当前 Git 分支及 Docker context 是预期目标；服务器 / Docker Engine 可以在端口、目录和资源容量不影响线上时复用，不强制新增服务器。必须使用本测试项目的新数据服务和数据卷。配置检查不启动服务，也不会连接 Docker 数据服务。

```powershell
node deploy/oss-test/validate-config.cjs --example
node deploy/oss-test/init-env.cjs
node deploy/oss-test/validate-config.cjs
node --test deploy/oss-test/isolation.test.cjs
```

初始化脚本为测试基础设施及应用密码 / 密钥生成独立随机值，写入本目录被忽略的 `.env`，不读取线上 `.env` 或进程中的应用密钥；重复运行会拒绝覆盖。不要将该文件提交或发到聊天中。模板已固定香港测试桶与专用 HTTPS 域名，OSS AK/SK 由部署者在本地填入现有 RAM 凭据，不要求新增或轮换密钥。

`--example` 仅检查资源模板，不接受它作为实际凭据。正常检查还会拒绝占位密码、重复密码、外部卷 / 网络、生产端口和目录挂载。检查前须清除当前终端的 `TEST_*` / `COMPOSE_*` 环境变量，避免 Compose 用它们覆盖指定的测试 `.env`；执行 `up` 时也保持这个约束。反向测试只渲染模板并构造错误配置，不启动容器、不使用真实凭据。请勿将包含实际密钥的完整 `docker compose config` 输出粘贴到聊天或日志。

## 在测试 Docker Engine 上创建基础设施

**先执行上面的检查，并确认目标 Docker context。** 以下为可重复的手工启动命令；当前本机数据栈已执行成功，其他机器仍须自行检查。必须是本机 Docker Desktop Linux context。使用专用包装器，不与现有生产 Compose 合并，不复用生产 `.env`，不使用 `down -v`。

```powershell
docker context show
node deploy/oss-test/local.cjs infra-up
docker compose --project-name im-app-oss-test --env-file deploy/oss-test/.env -f deploy/oss-test/compose.infra.yml ps
```

新空卷首次启动时，PostgreSQL 自动创建 `imapp_oss_test`，初始化脚本再创建应用角色；MongoDB 初始化脚本创建 `openim_oss_test` 应用用户。数据库此时还没有业务 schema，业务与管理 migrations 由后续测试应用部署依次执行，不连接生产补表。

**只执行 infra-up 的停点是创建并确认测试空库，不代表完整测试环境已经就绪。** 应用 Compose、生成器和安全入口现已补齐；继续应用阶段请按详细手册操作，不借用生产启动命令。

在测试容器内检查 PostgreSQL 的数据库和应用用户，不打印密码：

```powershell
docker compose --project-name im-app-oss-test --env-file deploy/oss-test/.env -f deploy/oss-test/compose.infra.yml exec -T postgres sh -c 'PGPASSWORD="$TEST_PG_APP_PASSWORD" psql -h 127.0.0.1 -U im_oss_test -d imapp_oss_test -Atc "select current_database(), current_user"'
```

预期输出 `imapp_oss_test|im_oss_test`。若实例未初始化成功，应检查对应测试服务日志；不要改指生产实例来绕过错误。初始化只对新空卷生效，不能通过重新生成 `.env` 为现有卷自动轮换密码。

## 应用测试文件

本机应用部署和前端模式已经补齐并启动；原生独立测试壳仍需手工准备：

- `prepare-apps.cjs` 生成独立业务/管理参数及锁定版本的 21 份完整 OpenIM YAML、测试回调、独立 secret 和配置完整性摘要。
- `compose.apps.yml` + `openim.Dockerfile` 仅构建/运行 11 个非 cron OpenIM 程序，必须包含本目录物理 key 安全补丁。
- `nginx.conf` 提供 `https://localhost:18443/18444` 两个独立 Origin 和测试静态目录；证书在 ignored private 中手动准备，不修改生产证书。
- `frontend.cjs` 显式选择 oss-test 模式，不读项目普通 dotenv、不继承线上代理；H5/管理构建和 App 资源分别输出本目录 ignored artifacts。App 热更新禁用，不发布资源。
- `local.cjs` 限定 Desktop Linux context、项目名、数据服务、新卷、回环端口、构建上下文、挂载和测试前缀；`check` 离线检查，`infra-up/build/up/ps/stop` 必须显式执行。
- `bootstrap-shared.cjs` 在测试 `up` 前，从管理 007 的原始 DDL 提取两个共享配置表，实际校验当前库/角色后建空表，解决业务 047 与管理迁移的首次建库顺序环；不修改生产 migrations，不更新已有行。
- WSL 编译器卡在内核映射锁时，可用 `build-openim-host.cjs`（仅 Windows）固定源码/应用补丁/运行 OSS 契约测试，交叉编译 11 个静态 Linux 程序并核验 ELF/hash，再由 `openim.prebuilt.Dockerfile` 封装同名测试镜像；不使用来源不明的镜像或跳过前缀补丁。
- 使用两个香港测试 OSS 桶、复用 RAM；业务对象使用 `oss-test/business/`，聊天对象使用 `oss-test/chat/`。数据栈的 `TEST_*` 不会自动映射为应用参数；业务使用 `OSS_KEY_PREFIX`，测试 OpenIM 构建使用 `IM_APP_OSS_TEST_PREFIX` 等，具体见接入手册和 openim-scope/README。
- 测试后台 / 业务服务共用本测试库，所有 JWT、内部 API 密钥和管理员密码采用测试值。
- OSS 上传失败已禁止发布 helper 回退生产 MinIO；本机测试入口不执行发布脚本，原生测试壳仍须独立应用标识/沙盒。
- 第一轮使用新测试数据，短信 / 推送等副作用关闭；导入脱敏副本时先禁用旧任务、token 和发布记录。

## 共用 OSS 的接入门禁

- 业务适配器已对实际 key 加前缀，覆盖上传、确认与读取并禁止覆盖；不暴露删除能力。历史迁移、分片与回收工具仍待单独实现，不能因有存储接口就绕过这些门禁。
- 已核对 OpenIM v3.8.3-patch.15 使用 hash 物理 key、没有原生前缀配置；新增 openim-scope 覆盖全部物理存储操作，必须构建独立测试 third RPC。原始镜像不识别这些测试变量；当前仅香港测试桶前缀完成 H5 图片写读专项，不因此开放原杭州桶写入、历史迁移或删除，App 仍须单独联调。
- 禁止对共享桶执行全桶同步删除、全桶 7 天生命周期、ACL / RAM 策略替换或密钥轮换。确需 H5 跨域时，仅追加测试 Origin 并保留原 CORS 规则，另列变更单。
- 复用同一 RAM 密钥不构成云端权限隔离，测试前缀必须由应用和工具强制校验，不能只靠操作约定。validate-config 检查数据栈，local 检查完整应用，运行时保护由业务服务/测试 OpenIM 适配层实现；尚不代表真实部署和端到端验证已完成。

镜像版本沿用仓库现有系列以减少环境变化；上线前还须固定镜像 digest、检查拉取可用性和测试宿主资源。当前仅本机隔离栈及上述业务/聊天图片存储专项通过，未在服务器建库或修改线上；实时收消息回归未通过，完整媒体流程及原生真机尚未验收。
