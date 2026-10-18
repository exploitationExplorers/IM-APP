# 现有线上 OSS 服务：新版构建与宝塔发布操作

适用分支：`feat/chat-image-speed`。后端 `8.154.44.197`，前端 `8.217.171.178`。

## 先看结论

- **旧入口停用**：不要再在 `deploy/` 执行裸 `docker compose up -d --build`，也不要整栈重启。
- **新入口**：`bash production.sh <阶段> <本次增量包目录>`。每次都保留“基础 Compose → 原 OSS 私密 override → 新版配置”的顺序，不再靠人手补参数。
- 仓库保存 OSS 参数映射、部署模板和程序，不保存 AK/SK。现网密钥、数据库连接、JWT、OpenIM secret 和**稳定媒体签名 key**沿用服务器原文件，不能重新生成或用模板覆盖。
- 群策略最终为默认全群开启：每群最近 168 小时且最多 500 条真实可见消息；超出任一条件即逻辑过期。安装阶段临时显式 `off`，不是改变产品默认值。
- Mongo 正文清理、OSS 文件删除均不启用；头像/收藏/转发副本不设生命周期。不清空、不恢复数据库，不删除旧 MinIO 卷。
- 当前代码已有本地测试，但完整 OpenIM/Kafka/并发与 iOS/Android 群清理验收仍待执行。**安装成功不能代替验收，全群开启必须放在最后。**

2026-10-18 已确认的一次故障：只加载基础 Compose 导致缺少 `OSS_ACCESS_KEY_ID`，API 重启循环。叠加原 `api.compose.json` 后，用户回传 `/health={"status":"ok"}`、`running / healthy`。这是原稳定服务恢复，**不表示本次群策略已上线**。

## 1. 文件放在哪台服务器

| 文件 | 所在位置 | 用途 |
| --- | --- | --- |
| 业务基础编排 | 后端 `/www/wwwroot/deploy/docker-compose.yml` | 网络、端口、依赖及 OSS 变量映射 |
| OpenIM 基础编排 | 后端 `/www/wwwroot/deploy/openim/docker-compose.yml` | 保持原服务拓扑 |
| 业务原 OSS 私密 override | 后端 `/root/im-app-oss-production/oss-production-bundle/private/api.compose.json` | 原凭据、稳定媒体签名 key、运行环境 |
| OpenIM 原 OSS 私密 override | 同目录 `openim.compose.json` | 原 OSS 镜像、环境和 third RPC 配置挂载 |
| 新增量包 | 后端 `/root/im-app-retention/visibility-release-本次标识/` | 二进制、052–055 SQL、新入口与覆盖层 |
| 新私密配置 | 增量包内 `private/retention.env`、`private/images.env` | 独立桥密钥、固定基础镜像及本次镜像名 |
| H5 | 前端宝塔网站的**实际站点根目录** | 不猜路径、不覆盖 `/testapp/`、下载文件或 Nginx 配置 |

原 OSS 两份 override 和 `openim-rpc-third.yml` 必须保留。名字带 `test` 的两个香港 OSS 桶目前承载正式前缀，不能按“测试文件”清空。

## 2. 本机准备（不会发布）

在 Windows `E:\Code\IM-APP`，核对当前分支和提交，再执行：

```powershell
git branch --show-current
git log -1 --oneline
node --test deploy/openim-retention/test-patch.cjs deploy/openim-retention/test-release.cjs
python -m unittest discover -s deploy/openim-retention -p 'test_production.py'
node deploy/openim-retention/build-release.cjs
```

构建会输出一个全新 `artifacts/visibility-release-*` 目录。包含三份 Linux/amd64 二进制、增量 SQL、Dockerfile、`production.sh`、部署模板与本文；**不包含任何密钥、H5、WGT**。只上传本次给出的增量包，不上传旧 `oss-production` 包，不执行旧的 `deploy-production-oss.py`。

如同步源码到服务器，同时更新 `deploy/production.sh`、`deploy/openim-retention/` 中本次脚本/模板及本文。`deploy/.env.example` 只是参考，**不能覆盖服务器 `.env`**。基础 Compose 的变量映射已经补齐，但它本身不是现网完整配置，也不是新的更新命令。现网基础 Compose 如有额外定制，先对比再合并，不能用仓库整份文件覆盖端口、密码和挂载。

## 3. 后端宝塔：只读盘点、准备新配置

1. 在后端宝塔「文件」新建 `/root/im-app-retention/`，上传本次 ZIP 并解压，保留 ZIP 内的 `visibility-release-*` 那一层目录。不要放到网站根目录。
2. 在宝塔终端 `cd` 到**实际解压目录**。下面命令均在这个目录执行；不要原样输入带“本次标识”的路径。
3. 执行以下三条，不启动服务、不迁移数据库：

```bash
sha256sum -c SHA256SUMS
bash production.sh inspect
python3 prepare-production.py prepare
```

盘点输出可以提供协助排查；不要发送完整 `docker inspect`、`config` 展开结果、私密文件或原始日志。

`prepare` 会核对原 OSS override 与运行镜像/环境、共享网络、二进制挂载、OpenIM 进程数，并在后端生成独立的 64 位十六进制桥密钥，保存于权限受限的 `private/`。**不会修改现有 AK/SK 或稳定签名 key，也不构建、不重启、不操作数据库。**

若已有专用灰度群，可用 `python3 prepare-production.py prepare --group-id 业务群UUID` 代替上面的 prepare。必须是带横线的小写业务 UUID，不能是 `sg_...` 会话 ID。未填时可在后端宝塔编辑新 `private/retention.env` 的 `RETENTION_CANARY_GROUP_ID`，其余项不动、不截图。

遇到镜像/环境变化、挂载遮挡或消息 RPC 不是一个进程时应停止并检查，不能删除检查代码绕过。当前模板针对已核实的单个 all-in-one `openim-api`；若还有独立消息 RPC/转存实例，必须逐一更新，不可只替换其中一个。

`private/` 已存在时 prepare 拒绝重新生成，避免同一批 API/OpenIM 使用不同密钥。后续步骤直接使用已生成文件。若准备过程失败，保留现场，不删 private 后盲目重试。

## 4. 后端：构建镜像，不重启

仍在新包目录：

```bash
bash production.sh build "$PWD"
```

这会基于盘点时固定的**现网 OSS 镜像**构建新覆盖层，只替换业务程序及消息 RPC/全部转存二进制。不拉官方基础镜像，不替换 OSS third RPC、API、网关或已有挂载配置，不重建数据库。

成功标记：`RETENTION_IMAGES_BUILT: services_not_restarted`。没有运行过 prepare、基础镜像不存在或编译包错误时必须停下，不使用 `latest` 或原始 OpenIM 镜像替代。

## 5. 后端：只执行 052–055 增量迁移

安排维护时段，保留已有备份并确认所需的近期备份可用；本流程不会自动导出或恢复备份。只操作 Docker 内的业务库 `imapp`，不是宝塔另外安装的数据库。

prepare 已检查库名。再只读确认连接身份：

```bash
docker exec im-app-postgres sh -c \
  'exec psql --no-psqlrc -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT current_database(), current_user;"'
```

确认是业务库后，在新包目录执行以下**完整一段**。每个 SQL 独立事务，锁超时两秒、语句超时十秒；任何一步失败立即停止，不自动杀连接、不继续后续部署：

```bash
bash <<'SH'
set -euo pipefail
for file in \
  migrations/052_media_preservation.sql \
  migrations/053_forward_media_preservation.sql \
  migrations/054_group_retention_plans.sql \
  migrations/055_group_retention_visibility.sql
do
  echo "Applying $file"
  {
    printf "BEGIN; SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='10s'; SET LOCAL search_path=public;\n"
    cat "$file"
    printf '\nCOMMIT;\n'
  } | docker exec -i im-app-postgres sh -c \
      'exec psql --no-psqlrc -X --set=ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
done
SH
```

新增列、表和索引，不删旧记录。禁止把 `MIGRATIONS_MODE` 改成 auto 来绕过缺表，禁止重跑全部历史 SQL。若新 API 报其他旧表缺列，先对照实际生产结构处理，不能猜测全量迁移。

## 6. 后端：按顺序更新两个应用，暂不开任务

这些操作会短暂中断 API/聊天连接，需维护窗口。**不会重启 PG/Mongo/Redis/Kafka/etcd/MinIO。**

```bash
# 先更新消息 RPC 和转存，保留现有 OSS third RPC
bash production.sh up-openim "$PWD"

# 待 OpenIM 就绪，再更新业务 API；安装覆盖层明确关闭群任务
bash production.sh up-api "$PWD"

curl --retry 10 --retry-connrefused --retry-delay 3 \
  --max-time 5 -fsS http://127.0.0.1:8080/health

bash production.sh verify "$PWD"
```

verify 校验正在运行的三份二进制 SHA256、桥 v2、正确 key 成功/错误 key=401、正文和对象清理关闭，以及 PG/Mongo 容器未重启。不发聊天、不建立清理快照，不推进边界。**这只是服务器能力检查，不是完整功能验收。**

若 OpenIM 尚未就绪，等待后只重试 verify，不反复执行 up。启动失败时保持现场，提供阶段、健康状态和脱敏错误，不重跑 OSS 初次切换脚本。

私有桥为容器内 `19093`，API 通过共享网络访问 `http://openim-api:19093`。不新增安全组规则，不发布 Docker 端口，不加 Nginx 公网反代。已有宿主机 `19093` 的 Kafka 映射和容器内桥不是同一端口空间，不要改 Kafka。

还要核对 Nginx 没有向公网代理 `/internal/retention/`。外部不可访问与容器内认证都要验收，不能只以健康接口成功判断安全。

## 7. 前端服务器：更新 H5

本轮仅改部署配置不需要额外前端修改；但如果现网仍未包含之前的群水位同步代码，必须同步发布当前分支 H5 和 App 资源，不能只上后端便开启清理。

在本机 `IM-APP-fronend`：

```powershell
npm run type-check
npm run test:unit
npm run build:h5
```

1. 在前端 `8.217.171.178` 宝塔「网站 → 正式域名 → 设置」确认真实站点根目录，保留旧 `index.html` 和资源。
2. 上传本次 `dist/build/h5/` 的内容：先传新增资源，最后替换 `index.html`。不要再套一层 `h5` 目录。
3. 不清空整个站点，不删除旧哈希资源、`/testapp/`、安装包、下载页、证书和原 Nginx 代理。
4. 浏览器强制刷新，确认登录、收发、媒体、收藏、转发正常。H5 使用同源 `/api/v1`，不要把后端 HTTP IP 写进 HTTPS 页面的请求地址。

## 8. iPhone / Android：WGT 内部验收，再发布目标渠道

- 本轮不换原生插件/权限，不重新签名 APK/IPA。先核对目标壳 appid、实际原生版本、当前资源版本和更新渠道。
- 保留目前已经验证可登录的 App API 地址；不要顺便变更域名或代理。内部资源用 `VITE_UPDATE_CHANNEL=canary`，客户版本按实际 `test/prod`；WGT 也能改变渠道，不能混发。
- 纯构建可用 `npm run pack:wgt -- --build --channel=canary`；会提升资源版本，但不上传、不发布。`pack:wgt:canary/customer` 自带 `--publish`，不是纯构建。
- 发布前参考前端 WGT 文档核对 `min-native` 与实际目标壳。内部渠道验收通过后才用明确客户渠道发布；不能因历史文档写了 100 就假设两端壳都为 100。
- 发布接口使用已验证可达的 **HTTPS** 网站入口和本机 Git 忽略的内部发布密钥文件，不把 key 放命令行/聊天，不通过公网 HTTP 传发布密钥。
- 真机两端都检查更新后的关于页版本，完成文字/图片/视频/语音/文件、收藏、转发、冷启动、离线重连、切账号和水位同步。H5 测试不能替代原生验收。

如果没有可接收 canary 的内部壳，先确认可用的内部测试分发方式，不能把未验收版本直接推给现有客户。WGT 不等于新 APK/IPA 下载包；本轮不替换现有下载页里的原生整包。

## 9. 验收通过后：单群灰度，再恢复全群默认策略

先在独立环境完成 `ACCEPTANCE.md`，包含 499/500/501 条、七天边界、转存积压和并发、缓存失效及 iOS/Android 同步。不要往正式业务群灌测试消息，也不要修改生产时间或手工造 applied 记录。

后端 `private/retention.env` 填入一个已授权的专用灰度群 `RETENTION_CANARY_GROUP_ID` 后：

```bash
bash production.sh canary "$PWD"
```

**开启后可能立即处理当日任务，不会等到明天。**程序每分钟轮询，以 UTC 日期去重每日任务；不是“北京时间午夜”的 cron。按当前北京时间，UTC 日界线对应每天 08:00。每群仍按滚动 168 小时、最多 500 条计算，不是自然周。

只有灰度确认无越界、两端升级验收完成、完整 OpenIM 验收通过，才执行：

```bash
bash production.sh enable "$PWD" --accept-full-group-retention
```

最终覆盖层显式设 `visibility_only`、`ALL_GROUPS=true`、名单为空，覆盖原文件可能遗留的 `off`。不启用旧收藏补偿/正文清理/OSS 文件删除。每次后续发布都沿用当前已确认的阶段；别把维护用 up-api 当成“保持全群开启”，它会显式关任务。

只读观察业务库：

```sql
BEGIN READ ONLY;
SELECT status, failure_code, count(*) FROM group_retention_jobs GROUP BY 1,2;
SELECT status, failure_code, count(*) FROM group_retention_applications GROUP BY 1,2;
SELECT count(*) AS groups_with_boundary, max(updated_at) FROM group_retention_visibility;
ROLLBACK;
```

`planned` 不是已清理；`applied` 才是 ACK 已提交。消息历史异常会安全拒绝并退避，不得手工改成功。

## 10. 止损与以后怎么更新

出现群过期问题，只停任务、保留新程序与单调边界：

```bash
bash production.sh disable "$PWD"
```

本次正文清理一直关闭。不要回退旧消息转存 allocator，不删除 visibility 表/Mongo fence/客户端 tombstone，不降低 min_seq；否则已过期历史可能复活。不要恢复数据库快照或删除 OSS 文件。

以后统一调用新 `production.sh`，指定**实际对应的增量包目录**，继续保留两份原 OSS override。不能再用裸 Compose、旧 OSS 切换脚本或 `docker compose down -v`。新包准备/构建与任务开启分阶段，保留旧包和固定镜像，不执行 Docker prune。

## 一次只做一步

第一次现场操作先完成第 3 节并回传 `inspect`/`prepare` 的安全输出。核对拓扑和配置后再构建、迁移、更新应用。本文后续命令不是让你一次性全部粘贴执行，尤其不要提前执行 canary/enable。
