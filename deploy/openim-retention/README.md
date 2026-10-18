# 群保留策略：私有 OpenIM 适配器与增量发布

## 当前交付边界

**群逻辑清理默认开启；Mongo 正文延迟清理仍默认关闭；不是 OSS 文件空间回收版本。尚未发布，真机验收待执行。**

- 规则：每群每日计算，保留最近 168 小时内且最多 500 条真实可见消息；超出任一限制即过期。单聊不参与。
- 已实现：可信快照、持久化任务/租约/重试、OpenIM 单调可见边界、已读范围校正、搜索/定位/最后消息过滤、业务水位接口、H5/App 水位同步、新收藏与转发/引用独立副本、旧收藏补偿 worker。
- `visibility_only` 请求本身不删除源消息/对象。独立 Mongo 正文 worker 需额外门禁，至少等待首次 ACK 后 24 小时；默认仍保留原消息。无论是否启用正文 worker，旧 MinIO/OSS 文件与对象映射均不删除。详见 `BODY-PURGE.md`。
- 业务端默认 `visibility_only`，未指定群时默认全群；可用 `off` 显式关闭。没有 `cleanup`/`apply` 开关；私有桥 URL/key 缺失、错误范围等配置会拒绝启动，不假装已开启。旧收藏补偿默认关闭。
- OSS 物理回收仍需跨会话引用、历史引用、上传在途及 OpenIM 去重映射的统一保护，尚未实现，禁止用整个桶的 7 天生命周期代替。

## 1. 固定版本及构建

基于 OpenIM `v3.8.3-patch.15` / protocol `v0.0.73-alpha.18`，私有协议为 `im-app-retention-visibility-v2`。

`patch-openim.cjs` 对 5 个原始上游文件校验 SHA256，所有输入通过后才写入。只处理一次性的源码副本，拒绝 Go module cache 和已打补丁的目录；不修改当前项目或运行容器。规则代码从业务后端复制，避免两份规则漂移。

在仓库根目录本地执行：

```powershell
node --test deploy/openim-retention/test-patch.cjs deploy/openim-retention/test-release.cjs
python deploy/openim-retention/test-integration.py --build-linux
node deploy/openim-retention/build-release.cjs
```

集成测试仅使用新建的本机回环 MongoDB/Redis，要求本机 Docker 已有 `mongo:6.0`、`redis:7-alpine`；不会拉镜像、读取 `.env`、连接现有数据库或重启任何已有容器。实际 Redis/rocks 缓存验证覆盖 ACK 后失效、序号分配缓存丢失后重建和最小序号不回退，不执行 `FLUSHDB/FLUSHALL`。构建产物在本目录被 Git 忽略的 `artifacts/visibility-release-<随机值>/`。构建不调用 Docker、不读取私有配置、不打包密钥、不上传或发布 WGT。

增量包包含 Linux/amd64 的 `im-server`、`openim-rpc-msg`、**`openim-msgtransfer`**、052–055 增量 DDL、覆盖层 Dockerfile、校验清单和验收文档。**必须同时更新消息 RPC 与所有消息转存实例**：上游转存进程申请新号段时会把 `min_seq` 重置为 0，漏更新会使历史重新出现。覆盖层不替换现有 OSS third RPC、OpenIM API、网关或配置。

`api.Dockerfile` 只带增量迁移且默认 `MIGRATIONS_MODE=verify`，不是新空库初始化镜像。包内未包含 H5/WGT；前端需独立验证、构建和发布，不能用旧包替代。

## 2. 私有桥配置与网络

仅给提供私有桥的消息 RPC 实例配置：

```dotenv
IM_APP_RETENTION_LISTEN=0.0.0.0:19093
IM_APP_RETENTION_KEY=<独立随机密钥，至少32字节>
```

- 两项都不配时，不监听端口，不创建 Mongo 元数据集合。只配一项或配置错误时拒绝启动。
- **不要开放安全组端口，不要发布 Docker `ports`，不要加公网 Nginx 反代。** 只允许业务后端通过受控容器网络访问。
- 只有同一个容器里的调用者才能使用 `127.0.0.1`；跨容器用服务名。不要把前后端服务器的公网 IP 填进私有桥配置。
- 一个进程/网络命名空间只能有一个该端口监听者；若实际部署有多个消息 RPC，须选择独立桥实例/独立网络命名空间，不可让同一容器多进程争抢同端口。
- 私有密钥与 RAM AK/SK、OpenIM secret、JWT、业务内部 key 分离，不写入 Git、聊天、截图或下载页。业务适配器禁用环境代理且拒绝重定向。
- Mongo 仅新增 `im_app_retention_receipts_v1` 收据集合，30 天 TTL 只清收据。收据绑定会话、精确边界及期限；授权同时检查 Mongo 时间，不依赖异步 TTL 删除。

默认启用的完整配置如下；须先部署私有桥、迁移并完成发布门禁，不能只复制模板而不填 URL/key：

```dotenv
GROUP_RETENTION_MODE=visibility_only
GROUP_RETENTION_ADAPTER_URL=http://<私有OpenIM服务名>:19093
GROUP_RETENTION_ADAPTER_KEY=<与桥相同的独立密钥>
GROUP_RETENTION_GROUP_IDS=
GROUP_RETENTION_ALL_GROUPS=true
FAVORITE_ARCHIVE_WORKER_ENABLED=false
```

逐步发布尚未准备好适配器时，必须临时显式设 `GROUP_RETENTION_MODE=off`；这属于操作者维护覆盖，不再是程序/模板/镜像默认值。已有 `.env`、进程或 Compose 中的 `off` 不会被新默认值覆盖。隔离测试/手机灰度时可显式收窄：

```dotenv
GROUP_RETENTION_MODE=visibility_only
GROUP_RETENTION_ADAPTER_URL=http://<私有OpenIM服务名>:19093
GROUP_RETENTION_ADAPTER_KEY=<与桥相同的独立密钥>
GROUP_RETENTION_GROUP_IDS=<单个专用测试群的业务UUID，带横线、小写>
GROUP_RETENTION_ALL_GROUPS=false
FAVORITE_ARCHIVE_WORKER_ENABLED=false
```

`visibility_only` 在两个范围变量都未配置时默认全群。`GROUP_RETENTION_GROUP_IDS` 最多 100 个唯一业务 UUID（逗号分隔，不是 `sg_` 会话 ID）；只配置名单而不配置 `ALL_GROUPS` 时，程序自动收窄为名单。模板/镜像显式设置了 `ALL_GROUPS=true`，灰度时须改成 `false`。两者冲突、名单无效、非法布尔值或显式 `false` 却没有名单时拒绝启动，不偷偷扩大范围。名单同时限制入队、规划领取、旧计划回填和应用领取。缩小范围/关闭任务不撤销已发布水位，不使旧历史复活。仅用于 OSS 冒烟、没有桥的 `deploy/oss-test` 脚手架单独显式设 `off`，不改变应用默认策略。

收藏 worker 每轮最多 20 条，单条复制失败不阻塞后续，整轮后等待一小时再扫失败项。成功进度在 `media_archived` 中，重启可重扫；失败记录不伪装成归档成功，不删除源文件。仅支持 OSS，沿用受限媒体源地址白名单和原有稳定签名密钥。

## 3. 私有接口与快照保证

接口仅接受专用 `Authorization: Bearer <key>`，响应 `Cache-Control: private, no-store`。不是面向手机的 API，不可把 key 发给客户端。

| 方法 | 静态路径 | 参数 | 作用 |
| --- | --- | --- | --- |
| GET | `/internal/retention/capabilities` | 无 | 核对 `protocol`、`mode=visibility_only` |
| GET | `/internal/retention/snapshot` | query `groupId=<32位小写hex>` | 只读消息内容，写入有限期边界收据 |
| POST | `/internal/retention/apply` | JSON `{snapshotId,conversationId,minVisibleSeq}` | 持收据推进全群最小可见序号；不删消息/对象 |

OpenAPI/Postman 见本目录的 `openapi.json`、`postman_collection.json`。GET 禁止请求体，POST 全部参数在 JSON 中，未知字段/额外参数拒绝。

快照固定当前水位，使用 Mongo 服务端时间。只统计已持久化、群身份匹配、类型已知的可见消息；展示通知算条数，隐藏控制、删除标记、非历史消息、置顶同步不算。尾部有未落库空洞、未知类型、可见消息无有效时间时拒绝该群，而不是猜测成功。

从新到旧证明 500 条真实可见消息后，可用 `overCountThrough` 概括更早的必定超额前缀，旧历史再多也不必全量装入内存；不能用 `maxSeq-500`。纯规则再次验证至少存在 500 条真实可见证据。`candidates`/数据库 `candidate_count` **只统计显式扫描候选**，不代表概括前缀的真实删除条数。概括前缀也不授权对象删除。

仍有安全限制：

- 尾部最多分类 20,000 个槽位，隐藏控制过多或尾部缺口会重试，8 次后阻塞该任务；下一日新任务仍会尝试。不是对所有历史异常的完整支持。
- 时间乱序导致过期消息夹在应保留消息中时，不能靠前缀边界准确清理，任务标记 `non_prefix`，不越过有效消息强删。
- 客户端离线只能遵守上次成功同步的水位；首次同步失败或永久停留旧版本不能保证完整 UI 失效。需在线恢复/升级及真机验收。
- 收据不是数据库全局事务快照。发布前仍须在完整 OpenIM 服务上验证并发发送、转存积压、重连和缓存失效。

## 4. 宝塔手动发布顺序（尚未执行）

**当前不能越过验收门禁直接开启全量清理。先完成独立环境和手机验收。**

1. 后端 `8.154.44.197`：只读确认当前业务/OpenIM 容器名、镜像 ID、挂载、启动命令、进程数量、可用空间。不要输出完整 `docker inspect`/环境变量；它们含密码和密钥。
2. 固定当前运行镜像的 ID/摘要及编排文件副本，保留旧卷。已有 OSS 切换完成，**不要重跑 `deploy-production-oss.py` 或旧 bundle**。不恢复任何备份到现有数据库。
3. 上传新的增量包到新目录；执行 `sha256sum -c SHA256SUMS`。核对 `bundle-manifest.json`，其中 `groupVisibility=enabled_by_default_all_groups`、`mongoBodyPurge=disabled_by_default`、`ossObjectPurge=false`、`deviceAcceptance=pending` 是真实策略/限制。旧包的逻辑清理默认值不同，不要用旧包代替。
4. 对业务 PostgreSQL 依次仅执行审核后的 052、053、054、055，单个文件事务并设置合理 `lock_timeout`，遇锁/DDL 故障就停，不自动杀生产连接。不要执行整个历史迁移目录，也不要改 Mongo 消息内容。新后端即使 worker 为 `off`，水位查询接口也要求 055 的 visibility 表。
5. 用当前**生产 OSS**业务/OpenIM 镜像作为 `BASE_IMAGE` 构建覆盖层。不要用原始官方镜像替代当前镜像，否则可能丢失已经上线的 OSS third RPC；核验目标二进制路径未被现有挂载遮挡。
6. 先在隔离服务验证镜像，更新所有消息转存实例和消息 RPC，后端 worker 继续 `off`。这是应用更新，不应重启 PostgreSQL/MongoDB/Redis/Kafka/etcd 或删除卷。
7. 从后端容器内核验私有桥 v2 和认证；从公网确认该端口与路径不可访问。保留 key 在受限配置文件，用脚本读取，不要把 key 拼进终端命令或截图。
8. 更新业务 API，保持 `MIGRATIONS_MODE=verify`、`SEED_DEMO=false`。核验原有登录、上传、发送、收藏、新转发接口及群水位 GET；数据为空时客户端仍应正常工作。
9. 前端 `8.217.171.178`：H5 在新版本目录构建验证后切换；App 用正确壳的 appid/版本生成独立 WGT，先内部渠道验证。**`pack:wgt:canary/customer` 会发布，不能当作纯构建命令。** 本构建脚本不执行它们。
10. 完成 `ACCEPTANCE.md`，先在隔离环境验证清理，再把 `GROUP_RETENTION_GROUP_IDS` 设为一个专用测试群，保持 `GROUP_RETENTION_ALL_GROUPS=false`；确认队列和应用没有越过群白名单后进行手机灰度。所有门禁通过后，才决定是否清空名单并显式开启全群调度。
11. 开启旧收藏补偿前确认源范围、OSS 权限和负载；观察失败项，不能把源已 404 的旧收藏当作已恢复。严禁给聊天桶根前缀设置 7 天自动删除。

当前文档不是无参数一键生产部署脚本。实际编排、镜像 ID、端口/挂载信息未重新核对前，不提供会重建生产容器的猜测命令。

### 本地浏览器基础回归

需要已有本地测试网关、独立本地账号、Python Playwright 和系统 Edge。不要使用普通 `npm run dev:h5` 的默认生产代理。Windows 示例：

```powershell
$env:NODE_EXTRA_CA_CERTS = 'E:\Code\IM-APP\deploy\oss-test\private\tls\ca\rootCA.pem'
node deploy/oss-test/frontend.cjs client-dev
# 另开终端，使用装有 Playwright 的 Python：
python deploy/openim-retention/verify-h5.py --local-only
```

CA 是本机开发公钥证书，不要使用 `rootCA-key.pem`，不要设置 `NODE_TLS_REJECT_UNAUTHORIZED=0`。本脚本严格限制 HTTP/WS 为本地测试地址，PC/手机 Web 分别从下载页进入登录，再打开已有会话，保存本地截图/结果；不发消息或读取生产账号。2026-10-18 两种视口基础回归通过，结果在 `artifacts/h5-verification/`。独立库没有示例账号/会话时应标失败，不可改用生产账号绕过。本脚本不覆盖群清理端到端或原生真机，后者仍执行 `ACCEPTANCE.md`。

## 5. 只读观察与止损

在明确选定的业务数据库中，只读事务执行：

```sql
BEGIN READ ONLY;
SELECT status, failure_code, count(*) FROM group_retention_jobs GROUP BY 1,2 ORDER BY 1,2;
SELECT status, failure_code, count(*) FROM group_retention_applications GROUP BY 1,2 ORDER BY 1,2;
SELECT count(*) AS groups_with_boundary, max(updated_at) AS latest_apply FROM group_retention_visibility;
SELECT count(*) AS unarchived_media FROM favorites
 WHERE msg_type IN ('image','video','file','voice') AND NOT media_archived;
ROLLBACK;
```

任务 `planned` 不等于已清理，`applied` 才表示适配器 ACK 并提交业务水位。部分群失败会进入独立退避，不阻塞其他群；版本/认证失败则不领任务。不要手工把失败任务改成 `applied`。

需要止损时将业务 `GROUP_RETENTION_MODE=off`、`FAVORITE_ARCHIVE_WORKER_ENABLED=false`。若曾开启独立正文 worker，还须关闭 `IM_APP_RETENTION_BODY_PURGE_ENABLED` 并清空其 scope/ACK，仅关闭业务 worker 不会停止已有 ACK 的正文待办。保持新 OpenIM 读写 fence、转存分配器、客户端 tombstone 与新表。**已应用水位后不能直接回滚到旧 OpenIM allocator，也不能删 visibility 表、Mongo fence 或客户端 tombstone**，否则旧消息可能再出现。不要降低 `min_seq`，不要还原数据库快照，更不要删 MinIO/OSS 原文件。
