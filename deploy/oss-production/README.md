# 现有正式服务接入 OSS

> **本目录是首次 OSS 切换的历史工具，不是日常更新入口。** 下述上传包/部署命令仅记录当时流程，不在已安装群保留/managed-v1 引用保护的服务器上重跑。当前更新和定时回收见 [PRODUCTION.md](../PRODUCTION.md) 及 [OBJECT-GC.md](../openim-retention/OBJECT-GC.md)；必须保留首次切换生成的私密 override、凭据和稳定签名 key。

2026-10-18：用户已授权在现有正式服务和数据库接入 OSS，旧记录和 MinIO 文件保留，新上传使用 OSS；优先完成新上传，接受旧聊天图片暂时无法解析。本次不安排数据库恢复或额外恢复演练，暂停的 staging 环境不参与部署。

## 当前状态

- 后端 `8.154.44.197` 的只读盘点和在线备份已经完成。
- 已有备份：`/root/im-app-oss-production/backups/20261018T052055Z-acf70ebb`。PostgreSQL 为事务一致性导出；MongoDB standalone 为在线逻辑导出，不是统一时间点快照。保留现有文件，部署脚本不会执行备份或恢复。
- 正式对象前缀 RAM 权限、正式网站来源的 OSS CORS 已验证。
- 业务 API、固定版本 OpenIM 第三方 RPC 已编译为 Linux amd64，部署包校验完成。盘点、备份、部署及补验脚本共 28 项离线测试通过；业务 Go 测试、OSS 适配测试、本机隔离 OpenIM 签名上传/完成/读取验证通过。
- 正式部署及服务器补验已完成。初次 OpenIM 就绪检查超时，随后服务器诊断确认两个应用容器运行、OpenIM 引擎为 OSS、管理员认证成功、`minPartSize=1048576`；用户在后端执行补验脚本，返回 `IM_APP_PRODUCTION_OSS_DEPLOY_OK`，聊天签名上传/完成/读取和业务公开媒体读取全部通过。补验没有重启服务或恢复数据库。**H5 与 App 原生端实际功能验收仍待完成。**

## 本次上传与执行

本机部署包：

```text
E:\Code\IM-APP\deploy\oss-production\artifacts\im-app-oss-production-20261018.zip
```

大小约 60 MiB，SHA256：

```text
621f44fcf26ce9cf953fd0bfe7c6ea0fb6ad3bed2d18f244baa01ab2280ad0fc
```

1. 打开 **后端 `8.154.44.197`** 宝塔，进入「文件」中的 `/root/im-app-oss-production/`。
2. 上传这个 ZIP，然后解压到当前目录。包中已包含 `oss-production-bundle` 这一层目录，不要再次套同名目录。
3. 确认脚本路径为 `/root/im-app-oss-production/oss-production-bundle/deploy-production-oss.py`。
4. 在同一台后端的宝塔终端执行：

   ```bash
   python3 /root/im-app-oss-production/oss-production-bundle/deploy-production-oss.py deploy
   ```

5. 返回终端阶段和最终结果。成功标记是 `IM_APP_PRODUCTION_OSS_DEPLOY_OK`；随后继续手机验收。若失败，保留现场，按错误代码定位；脚本不会自动回滚，也不要删除状态后反复执行。

包内 `oss.private.json` 包含 RAM 密钥和永久媒体签名 key。部署包只放在上述 root 私密目录，不放网站目录、不提交 Git、不发聊天。保存该签名 key，后续更新不能重新生成，否则已有稳定业务媒体链接会失效。

## 就绪检查超时后的补验

若部署已到 `update_openim_application_only`，随后只读检查确认 OpenIM 已就绪，使用独立的 `verify-production-oss.py` 补验，不重跑初始部署命令。把本目录该文件上传至后端 `/tmp/verify-production-oss.py`，执行：

```bash
python3 /tmp/verify-production-oss.py
```

脚本校验原部署包、部署阶段、新应用镜像和运行配置、数据容器身份及启动时间，随后执行聊天签名上传/完成/读取、业务公开媒体读取。只写少量新检查对象和一条新的 OpenIM 文件映射，不重启服务或执行数据库迁移。全部检查通过后才将私密状态原子更新为 `server_upload_checks_passed` 并输出 `IM_APP_PRODUCTION_OSS_DEPLOY_OK`；失败时保留原状态。已完成的部署也可使用该脚本重新验证。

2026-10-18，用户返回的正式服务器补验结果：

```text
IM_APP_PRODUCTION_OSS_VERIFY_BEGIN
step=verify_openim_signed_upload_complete_and_read
chat=signed_upload_complete_and_read_passed
step=verify_business_public_media
IM_APP_PRODUCTION_OSS_DEPLOY_OK
business=public_media_read_passed; chat=signed_upload_complete_and_read_passed
service_restarts=none; database_restores=none; frontend_native_acceptance=pending
```

## 部署变更

- 复用现有 Compose 项目与配置，仅为 `api`、`openim-api` 增加私密 override。业务项目为 `im-app`，原文件 `/www/wwwroot/deploy/docker-compose.yml`；聊天项目为 `openim`，原文件 `/www/wwwroot/deploy/openim/docker-compose.yml`。当前业务 Kafka 是 `apache/kafka:4.3.1`，不覆盖整份生产 Compose。
- 基于盘点的原生产镜像构建两份本地 overlay，仅替换业务二进制及 migrations 目录、OpenIM 第三方 RPC 二进制。不拉取基础镜像。
- 事务执行 `051_file_storage_location.sql`，只为 `files` 增加 `storage_provider`、`storage_bucket`。设置 2 秒加锁超时、10 秒语句超时，不重跑历史 SQL。
- 业务 API 使用 `APP_ENV=oss-production`、`MIGRATIONS_MODE=verify`、`SEED_DEMO=false`。启动仅核对必需列；新上传默认 OSS，旧业务记录和任务按原 MinIO 存储解释。
- OpenIM 固定 `v3.8.3-patch.15`，新上传引擎为 OSS，物理对象限定正式聊天前缀，保留相对逻辑对象名。生产适配拒绝对象删除、分片终止及过期元数据清理。本轮没有添加旧 `engine=minio` 映射回退读取，部分旧聊天媒体可能暂时无法显示。
- 只重建业务 API 和 OpenIM 应用容器，客户端可能短暂重连。数据库、MinIO、Redis、Kafka、etcd 等容器不重建；原 MinIO 卷和旧路由保留。不启用群消息“7 天且最多 500 条”清理，不改桶生命周期。
- 部署会写入少量新的 OSS 检查对象，并通过 OpenIM 管理员建立一条新文件映射验证上传，不发送聊天消息。

## 正式对象位置

| 用途 | 桶 | HTTPS 域名 | 对象前缀 |
| --- | --- | --- | --- |
| 聊天 | `yikeliao-188-hk-test` | `https://oss-chat-test.xn--jprz53bj9s.com` | `im-app-production/chat/` |
| 业务 | `yikeliao-188-business-hk-test` | `https://oss-business-test.xn--jprz53bj9s.com` | `im-app-production/business/` |

这些名称虽然带 `test`，本次接入后正式前缀承载正式新文件，应持续保留域名、证书和对象。本次仅复用 RAM 凭据，不使用本机测试数据库或应用凭据。

## 验收与后续维护

服务器成功标记表示业务公开媒体读取、OpenIM 签名上传/完成/读取检查通过，不等于手机功能验收通过。部署后用受控账号分别检查 H5 和 App 原生端：头像或业务图片、聊天图片、语音、视频、文件、转发与收藏、冷启动后读取、实时收发。App 原生端仍需真机测试；本机 H5 或 SDK 检查不能替代。

| 验收范围 | 当前结果 |
| --- | --- |
| 正式聊天签名上传、完成、读取 | 通过 |
| 正式业务公开媒体读取 | 通过 |
| 数据容器身份及启动时间保留 | 通过 |
| H5 实际发送、接收、媒体查看 | 待用户验证 |
| Android 原生端实际功能 | 待用户真机验证 |
| iOS 原生端实际功能 | 待用户真机验证 |

本次包不含新的 APK、IPA、WGT 或 H5 构建，不变更客户端发布渠道。先验证当前客户端连接现有服务后的新上传行为，出现客户端兼容问题再按具体结果修复和发布。

部署后的持久配置和状态位于：

```text
/root/im-app-oss-production/oss-production-bundle/private/
  api.compose.json
  openim.compose.json
  openim-rpc-third.yml
  deployment-state.private.json
```

后续 Compose 更新必须同时传入原 Compose 和对应的私密 override；直接使用原 Compose 可能恢复旧镜像/存储配置。准确参数保存在私密状态文件的 `compose` 字段中，包含原项目名、env-file 和配置路径。

失败时只提供终端阶段与错误代码，不公开私密状态、日志、配置、备份或压缩包。脚本没有自动回滚入口；需要根据已执行阶段处理。业务若需回退上传目标，应继续使用支持 OSS 的新二进制、verify 模式和原签名 key，将新上传切为 MinIO。不要直接启动旧业务二进制，它可能重跑全量历史迁移。OpenIM 回退旧镜像后，新 OSS 映射的读取也需要另行处理。

## 本机验证与构建

```powershell
python -m unittest discover -s deploy/oss-production -p 'test_*.py'
node deploy/oss-production/build-bundle.cjs
node deploy/oss-production/finalize-bundle.cjs
```

构建脚本拒绝覆盖已有输出目录和 ZIP；重打包应保留已生成的正式媒体签名 key，不要清除 `private/oss.production.json`。源码、测试可以提交，`private/` 和 `artifacts/` 受本目录 `.gitignore` 排除。
