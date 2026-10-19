# IM-APP 部署方案（后端 + 前端）

> **历史基线说明，不作为当前现网更新执行单。** 本文基于下列旧 HEAD/版本编写；后续已增加 managed-v1 引用保护及定时 OSS 回收，不能只套用本文旧二进制清单或基础 Compose。当前操作以 [生产部署说明](../deploy/PRODUCTION.md) 和 [聊天文件回收说明](../deploy/openim-retention/OBJECT-GC.md) 为准，保留原 OSS override 和当前发布配置。

> 适用分支：`feat/chat-image-speed`（HEAD `41b4892`）
> 编写依据：仓库内 `deploy/docker-compose.yml`、`deploy/openim/docker-compose.yml`、`deploy/baota/im-app.conf`、`deploy/PRODUCTION.md`、`deploy/production.sh`、`deploy/oss-production/`、`deploy/openim-retention/`、`IM-APP-server/Dockerfile`、`IM-APP-admin/Dockerfile`、`IM-APP-fronend/package.json|manifest.json|.env`、`IM-APP-system/.env.production`
> 当前客户端版本：`1.0.131 (231)`，AppID `__UNI__EC9D1AE`

---

## 0. 结论先行

| 问题 | 结论 |
|---|---|
| 后端怎么部署 | **不要裸跑 `docker compose up -d --build`**（会因缺 OSS 变量导致 API 重启循环，2026-10-18 已真实踩过）。必须走 `production.sh` / `oss-production` 的分层叠加流程，或至少 `--env-file` 补齐后再 `up` |
| 前后端是一台还是两台 | 支持两种拓扑，**当前生产是前后端分离**：前端 A（香港 `8.217.171.178`）+ 后端 B（杭州 `8.154.44.197`）。单机拓扑（H5 与 API 同机）也在仓库里，用 `deploy/baota/im-app.conf` |
| 前端要不要在服务器上构建 | **不要**。`VITE_*` 是 Vite **构建期内联**，改服务器文件无效。H5/App/admin 全部本机构建后只传产物 |
| 本分支特有的部署前提 | ① 需要 **ffmpeg**（语音转码）；② 需要 **定制 OpenIM 二进制**（`openim-rpc-third` 转存、`openim-rpc-msg`、`openim-msgtransfer` 群保留 fence）；③ 需要手工执行 **migrations 052–055**；④ OSS 模式变量必填 |
| 最容易翻车的三处 | ① 三组密钥「必须同值」；② nginx 前缀剥离方向 / `/object/` 上游；③ 镜像 build 了但容器没 recreate（跑的还是旧镜像） |

---

## 1. 架构拓扑

### 1.1 生产形态（推荐，当前线上）

```
                     ┌──────────────── 前端 A  8.217.171.178（香港，CentOS 7）
  用户浏览器/App ──► │  nginx :443/:80
                     │   ├─ /                → H5 静态  /www/wwwroot/yikeliao.com
                     │   ├─ /testapp/        → 下载页（APK / manifest.plist）
                     │   ├─ /app.apk         → Android 整包
                     │   └─ 反代 ──────────┐
                     └──────────────────────┼──────────────────────────────
                                            │  HTTP（跨地域，Host 固定写后端 IP）
                     ┌──────────────────────▼──────────────────────────────
                     │  后端 B  8.154.44.197（杭州，Ubuntu）
                     │  宝塔 nginx :80 / :8081（唯一公网入口，无 443）
                     │   ├─ /api/        → 127.0.0.1:8080（业务 API，不剥前缀）
                     │   ├─ /openim-ws  → 127.0.0.1:10001（WS Upgrade）
                     │   ├─ /openim-api/→ 127.0.0.1:10002（剥前缀）
                     │   ├─ /minio/     → 127.0.0.1:9000 （剥前缀，Host $host）
                     │   ├─ /openim/    → 127.0.0.1:9100 （剥前缀）
                     │   ├─ /object/    → 127.0.0.1:10002（不剥前缀）
                     │   └─ :8081/api/ → 127.0.0.1:8090（管理后台，不剥前缀）
                     │
                     │  Docker 业务栈（project=im-app）+ OpenIM 栈（project=openim）
                     └─────────────────────────────────────────────────────
```

### 1.2 容器清单

**业务栈** `deploy/docker-compose.yml`（project `im-app`）

| 服务 | 容器名 | 镜像 | 宿主端口 | 说明 |
|---|---|---|---|---|
| postgres | `im-app-postgres` | `postgres:16-alpine` | `127.0.0.1:5433` | 业务库 `imapp` |
| redis | `im-app-redis` | `redis:7-alpine` | `127.0.0.1:6379` | 会话/限流 |
| minio | `im-app-minio` | `bitnamilegacy/minio:latest` | `127.0.0.1:9000/9001` | 旧对象存储（OSS 模式下降级备用） |
| kafka | `im-app-kafka` | `apache/kafka:4.3.1` | `127.0.0.1:9092` | 消息转发队列 |
| api | `im-app-api` | `build: ../IM-APP-server` | `127.0.0.1:8080` | 业务 Go 后端 |
| admin | `im-admin` | `build: ../IM-APP-admin` | `127.0.0.1:8090` | 管理后台后端 |

**OpenIM 栈** `deploy/openim/docker-compose.yml`（project `openim`）

| 服务 | 容器名 | 镜像 | 端口 |
|---|---|---|---|
| mongodb | `openim-mongodb` | `mongo:6.0` | 内网 27017 |
| redis | `openim-redis` | `redis:7-alpine` | 内网 |
| etcd | `openim-etcd` | `bitnamilegacy/etcd:3.5` | 内网 |
| kafka | `openim-kafka` | `bitnamilegacy/kafka:3.6` | 内网 |
| minio | `openim-minio` | `bitnamilegacy/minio:latest` | `127.0.0.1:9100`（经 `/openim/`） |
| openim-api | `openim-api` | `openim/openim-server:v3.8.3-patch.15` | `10001`（WS）、`10002`（API）、`19093`（保留私有桥，**不发布**） |

> 合计 12 个容器（+ 宝塔 nginx 在宿主）。全部业务端口只绑 `127.0.0.1`，公网只经过 nginx。

### 1.3 网络

| 项 | 值 |
|---|---|
| 共享网络（业务 ↔ OpenIM） | `im-app-openim-net`，子网 `172.20.0.0/16` |
| 创建命令（仅首次） | `docker network create --subnet 172.20.0.0/16 im-app-openim-net` |
| **必须联动** | `OPENIM_WEBHOOK_ALLOW_CIDRS` 必须包含 `172.20.0.0/16`，否则 webhook 全 401 |

---

## 2. 服务器准备（每台只做一次）

```bash
# 基础
apt update && apt install -y curl git ca-certificates     # B：Ubuntu；A：yum install（CentOS 7）
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

# 共享网络（仅后端 B）
docker network create --subnet 172.20.0.0/16 im-app-openim-net

# 目录规划（后端 B）
mkdir -p /www/wwwroot/deploy/{openim,web/h5,web/admin,baota,scripts}
# 前端 A
mkdir -p /www/wwwroot/yikeliao.com
```

**安全组**：仅放行 `22`、`80`、`443`（A）；B 只需 `80`（+ 内部访问 A 的放行规则）。**不要**对外开 `5433/6379/9000/9092/8080/8090/10001/10002/19093`。

**必做系统项**

| 项 | 原因 |
|---|---|
| 时区 `Asia/Shanghai` | 群保留按 UTC 日期分片，日志对时容易误判 |
| Docker 日志轮转 `max-size=100m, max-file=3` | 否则 `*-json.log` 撑爆磁盘（`deploy/scripts/trim-docker-logs.sh` 只是兜底） |
| `.gitattributes` 保证 `*.sh eol=lf` | Windows 检出后 CRLF 会让服务器 bash 报 `\r` 错误 |

---

## 3. 后端部署

### 3.1 两种模式先选一种

| 模式 | 适用 | 入口脚本 | 特点 |
|---|---|---|---|
| **A. 首次全量 / 存储切换** | 新机器、或从 MinIO 切到 OSS | `deploy/oss-production/`（zip 包） | 产出 `im-server` + `openim-rpc-third` + `migrations/` + overlay Dockerfile，脚本带状态机与校验 |
| **B. 日常增量发布** | 已上线，只更新 api / OpenIM 二进制 | `deploy/production.sh` | `inspect → prepare → build → up-openim → up-api`，全程只重建目标容器，**不动数据服务** |

> ⚠️ `production.sh` 有硬守卫：必须 `root` 且 `hostname == izbp15qkzomsmdhdmtx27dz`。换机器要改脚本或走模式 A。

### 3.2 环境变量（`/www/wwwroot/deploy/.env`，**不入库**）

基线来自 `deploy/.env.example`，但**不能用它覆盖现网 `.env`**（现网有端口/密码/密钥定制）。必填分组：

| 组 | 变量 | 备注 |
|---|---|---|
| 公网地址 | `OPENIM_PUBLIC_API_URL`、`OPENIM_PUBLIC_WS_URL`、`MINIO_PUBLIC_URL`、`MINIO_EXTERNAL_ADDRESS`、`CORS_ALLOW_ORIGINS` | 指向 nginx 前缀，不是容器端口 |
| 容器内互联 | `OPENIM_API_URL=http://openim-api:10002`、`KAFKA_BROKERS=kafka:19092`、`SERVER_BASE_URL=http://api:8080` | 走共享网络 |
| **密钥三连（必须同值）** | `IM_INTERNAL_API_KEY == SERVER_INTERNAL_KEY`<br>`OPENIM_SECRET == OpenIM 栈 IMENV_SHARE_SECRET`<br>`OPENIM_WEBHOOK_SECRET == webhooks.yml URL 路径段` | 配错都是**静默故障**：后台改数据全失败 / 调 OpenIM 全 401 / 撤回全 404 |
| 存储（OSS 模式） | `STORAGE_PROVIDER=oss`、`OSS_REGION/ENDPOINT/BUCKET/ACCESS_KEY_ID/ACCESS_KEY_SECRET`、`OSS_KEY_PREFIX`、`OSS_PUBLIC_UPLOAD_URL`、`OSS_MEDIA_PROXY_URL`、`OSS_MEDIA_SIGNING_KEY`、`MEDIA_SOURCE_URL_PREFIXES` | **缺任一 OSS 变量，API 在监听端口前就退出 → 整站 502**；`OSS_MEDIA_SIGNING_KEY` 不可再生 |
| 迁移 | `APP_ENV=oss-production` + `MIGRATIONS_MODE=verify` + `SEED_DEMO=false` | 生产强制 verify；**禁止**改 `auto` 绕过缺列 |
| 管理端 | `ADMIN_JWT_SECRET`（≥32 字符）、`ADMIN_CORS_ORIGINS`、`ADMIN_BOOTSTRAP_USERNAME/PASSWORD` | 短于 32 字符 release 模式拒绝启动；`BOOTSTRAP_PASSWORD` 仅空库首次生效 |
| 群保留 | `GROUP_RETENTION_MODE=visibility_only`、`GROUP_RETENTION_ALL_GROUPS`、`GROUP_RETENTION_ADAPTER_URL/KEY` | 私有桥地址 `http://openim-api:19093`，**不要**对外发布 |
| 短信 | `ALIYUN_ACCESS_KEY_ID/SECRET`、`SMS_SIGN_NAME`、`SMS_TEMPLATE_CODE` | 节流类变量**不要写行内注释**（解析器不剥离，整行失效） |

### 3.3 启动顺序

```
1) 数据服务（postgres / redis / kafka / minio）      ← 只起一次，之后发布不重启
2) OpenIM 栈（mongo / redis / etcd / kafka / minio / openim-api）
3) 数据库迁移（052–055）—— verify 模式必须人工先执行
4) 业务 api（依赖 openim-api 与私有桥就绪）
5) admin 后端（依赖业务表已存在，否则 log.Fatalf）
6) nginx 配置落盘 + reload
7) 前端静态产物上传
```

API 进程内启动顺序（`cmd/server/main.go`）：
`配置校验 → OSS 本地校验 → db.Connect(10s) → RunStartupMigrations(verify=跳过) → RequireColumns(缺列直接退出) → SeedDemo → Redis(失败降级) → Storage(OSS 失败 Fatal) → 监听`

### 3.4 首次部署（模式 A，OSS 包）

```bash
# 1. 上传并解包（本地 → 服务器）
scp deploy/oss-production/artifacts/im-app-oss-production-<tag>.zip root@8.154.44.197:/root/
ssh root@8.154.44.197
mkdir -p /root/im-app-oss-production && cd /root/im-app-oss-production
unzip -q /root/im-app-oss-production-<tag>.zip

# 2. 校验包完整性
sha256sum -c <(python3 -c "
import json;m=json.load(open('oss-production-bundle/bundle-manifest.json'))
[print(f\"{v}  oss-production-bundle/{k}\") for k,v in m['files'].items()]")

# 3. 部署（脚本自带备份 + 状态机 + 校验）
python3 oss-production-bundle/deploy-production-oss.py deploy
# 成功标记：IM_APP_PRODUCTION_OSS_DEPLOY_OK
```

阶段机：`building → add_two_file_storage_columns → update_business_api_only → update_openim_application_only → server_upload_checks_passed`

> 脚本**没有自动回滚**，失败保留现场。先跑 `backup-production-oss.py`（PG 用事务一致性导出，Mongo 是逻辑导出）。

### 3.5 日常发布（模式 B，增量）

```bash
# 0. 先看现状
bash production.sh inspect /www/wwwroot/deploy

# 1. 打包（本地）→ 上传 /root/im-app-retention/<release>/

# 2. 准备（校验基础镜像 digest、生成 private/images.env）
bash production.sh prepare /www/wwwroot/deploy

# 3. 构建 overlay 镜像（离线，不拉基础镜像）
bash production.sh build /www/wwwroot/deploy
#   → 输出 RETENTION_IMAGES_BUILT: services_not_restarted

# 4. 先 OpenIM，再业务 API（顺序不能反）
bash production.sh up-openim /www/wwwroot/deploy
bash production.sh up-api   /www/wwwroot/deploy

# 5. 校验
bash production.sh verify /www/wwwroot/deploy
```

**只改业务代码（最常见的日常）可以简化为：**

```bash
cd /www/wwwroot/deploy
docker compose --env-file .env up -d --build --force-recreate api
```

`--force-recreate` 不能省 —— 只 build 不 recreate，容器会继续跑旧镜像（本分支已真实踩过：镜像 55 分钟前就 build 好了，容器还是 10 小时前的）。

### 3.6 健康检查与验证

```bash
curl -fsS http://127.0.0.1:8080/health                       # {"status":"ok"}
curl -fsS http://127.0.0.1:8090/api/admin/v1/health          # {"code":0,...}
docker exec im-app-api sh -c 'ffmpeg -version | head -n1'    # ffmpeg version 6.x
docker ps --format '{{.Names}}\t{{.Status}}' | sort
```

**数据服务不变性校验**（发布后必做，确认没误重启）：

```bash
docker inspect -f '{{.Name}} {{.Id}} {{.State.StartedAt}}' \
  im-app-postgres openim-mongodb im-app-minio openim-minio
```

### 3.7 数据库迁移（本分支关键）

`IM-APP-server/migrations/` 共 **62** 个，本分支新增：

| 文件 | 内容 |
|---|---|
| `051_file_storage_location.sql` | 文件存储位置（OSS 切换） |
| `052_media_preservation.sql` | 媒体归档标记 |
| `053_forward_media_preservation.sql` | 转发媒体归档 |
| `054_group_retention_plans.sql` | 群保留计划 |
| `055_group_retention_visibility.sql` | 群可见性保留（`min_visible_seq` / `revision`） |

`RequireColumns` 会校验 18 组表列，缺列直接 `log.Fatalf`，提示 `required migrations include 052 through 055`。

```bash
# 首次（空库/新机器）：临时 auto 跑一次，然后立刻改回 verify
MIGRATIONS_MODE=auto docker compose --env-file .env up -d api   # 仅首次！

# 已有库：手工执行
docker exec -i im-app-postgres psql -U im -d imapp < IM-APP-server/migrations/052_media_preservation.sql
# ...053 054 055 依次执行
```

`IM-APP-admin/migrations/` 共 **10** 个（`001`–`009` + `015`），admin 启动时自动执行；**必须在业务表已存在之后**启动，否则报 `relation "users" does not exist` 并退出。

---

## 4. 前端部署

### 4.1 三端构成

| 端 | 目录 | 技术栈 | 产物 |
|---|---|---|---|
| H5 用户端 | `IM-APP-fronend` | uni-app + Vue3 + Vite5 + TS | `dist/build/h5/` |
| App（Android/iOS） | 同上 | uni-app `app-plus` | 资源 `dist/build/app/`；热更新 `unpackage/release/im-<code>.wgt`；整包 HBuilderX 云打包 |
| 管理后台前端 | `IM-APP-system` | Vue3 + Vite + Element Plus | `dist/` |
| 管理后台后端 | `IM-APP-admin` | Go + Gin | 容器 `im-admin:8090` |

### 4.2 环境变量（**编译期内联**）

`IM-APP-fronend/.env`

| 变量 | 生产值 | 说明 |
|---|---|---|
| `VITE_API_BASE_URL` | `http://<后端域名或IP>/api/v1` | **仅 App 生效**；H5 被 `#ifdef H5` 强制改成同源 `/api/v1` |
| `VITE_WS_BASE_URL` | — | 死变量，实际由后端 `POST /api/v1/im/token` 下发 `wsAddr` |
| `VITE_UPDATE_CHANNEL` | `test`（客户）/ `canary`（内部） | 决定查哪个渠道的更新 |
| `VITE_MEDIA_CACHE` | 不设（默认开） | 设 `off` 可关本地媒体缓存 |

`IM-APP-system/.env.production`：`VITE_PUBLIC_PATH=/`、`VITE_API_URL=/api`（**不要写绝对地址**，否则 CORS）。

> 改完 `.env` 必须**重新构建再上传**；改服务器上的文件没有任何作用。

### 4.3 H5 构建与发布（原子切换）

```bash
cd IM-APP-fronend
npm ci                 # 必须真跑，postinstall 有两个必需补丁
npm run type-check
npm run test:unit
npm run build:h5       # → dist/build/h5/
```

发布原则（`deploy/PRODUCTION.md`）：

1. 先在 A 机建**版本化目录**（如 `/www/wwwroot/yikeliao.com/releases/20261019-1/`）
2. 先传 `assets/`（新的哈希资源），**最后替换 `index.html`**
3. 切换站点根（软链或 rename），**旧资源保留至少一个版本**
4. 不清空整站，不删 `app.apk`、`/testapp/`、证书、nginx 配置
5. `index.html` **不长缓存**（`Cache-Control: no-cache`），`/assets/` 长缓存 immutable

> 产物必须是站点根，**不能挂子路径**：`index.html` 里写死 `/assets/...` 绝对路径。

### 4.4 管理后台

```bash
cd IM-APP-system
npm ci && npm run build      # → dist/
# 上传到 B 机 /www/wwwroot/deploy/web/admin
```

必须独占 `:8081` 站点根（`VITE_PUBLIC_PATH=/`），不能挂 `/admin/` 子路径。

### 4.5 App 整包（APK/IPA）

HBuilderX → **发行 → 原生 App-云打包**，必须勾选 `Tuoyun-OpenIMSDK` 原生插件（绑定 AppID `__UNI__EC9D1AE`）。

- 标准基座没有该插件 → 报 `Cannot read property 'initSDK' of undefined`
- **wgt 不能新增原生模块/权限/插件**；改 `app-plus.modules`、相机/录音/扫码/播放器权限必须重打整包

### 4.6 wgt 热更新

```bash
# 内部验收（升版本 + 构建 + 发布到 canary）
npm run pack:wgt:canary -- --changelog="更新说明"

# 客户渠道（test）
npm run pack:wgt:customer -- --changelog="更新说明"

# 只构建不发（排查用）
npm run pack:wgt -- --build --channel=canary
```

| 规则 | 说明 |
|---|---|
| 版本 bump | `--build` 时 `versionCode +1`、`versionName` 末段 +1，自动写回 `src/manifest.json` |
| 必带 `--build` | 否则可能把旧 `dist/build/app` 打进包（历史坑） |
| 校验 | 发布前读**包内** `manifest.json` 与参数比对，不一致直接报错 |
| `--min-native` | 必须 ≤ 目标壳的 `versionCode`；当前客户壳基线 `100`，**每次按实际壳版本填** |
| 双端 | 脚本逐平台串行写 android/ios 两条记录，**不是原子**；只成功一端要按缺失端重试 |
| 渠道 | `canary` / `test` / `prod`；`canary` 只隔离渠道，**不隔离 API/数据库** |
| 回滚 | 只能发**更高 versionCode** 的已知良好包，不能降级 |

发布后验证：完全划掉 App → 重开应弹更新 → 安装后「关于我们」版本号正确。

### 4.7 下载页

`testapp/` → 线上 `/testapp/`：Android 走相对 `app.apk`，iOS 走 `itms-services://...manifest.plist`（需 HTTPS + 合法签名）。

---

## 5. nginx 配置

### 5.1 后端 B：`deploy/baota/im-app.conf`

```bash
cp /www/wwwroot/deploy/baota/im-app.conf /www/server/panel/vhost/nginx/im-app.conf
nginx -t && nginx -s reload
```

> ★ 宝塔不认仓库里这份，改完必须重新 `cp` 再 reload；宝塔「网站」页面也看不到该站点。

| location | 上游 | 前缀 | 关键点 |
|---|---|---|---|
| `= /health` | `127.0.0.1:8080` | — | 精确匹配 |
| `^~ /api/` | `127.0.0.1:8080` | **不剥** | 后端路由本身是 `/api/v1/...`，`read_timeout 300s` |
| `^~ /openim-ws` | `127.0.0.1:10001` | 保留 | `Upgrade`/`Connection upgrade`，读写超时 3600s |
| `^~ /openim-api/` | `127.0.0.1:10002` | **剥** | `rewrite ^/openim-api/(.*)$ /$1 break` |
| `^~ /minio/` | `127.0.0.1:9000` | **剥** | ★ `Host $host`，写成默认 `$proxy_host` → `SignatureDoesNotMatch` |
| `^~ /openim/` | `127.0.0.1:9100` | **剥** | `Host $host` |
| `^~ /object/` | **`127.0.0.1:10002`** | **不剥** | ★ 上游不是 MinIO；指错只 404，且缺这条会落到 SPA 回退 → 500 |
| `^~ /assets/` | 静态 | — | `expires 30d` + `immutable` |
| `/` | — | — | `try_files $uri $uri/ /index.html` |

`:8081` server：root `web/admin`，`/api/` → `127.0.0.1:8090`（不剥），其余同上。

`client_max_body_size 200m`（两处），与发布接口 200 MiB 上限对齐。

### 5.2 前端 A：`nginx/yikeliao.com.conf`

- 站点根 `/www/wwwroot/yikeliao.com`（**不是** `deploy/web/h5`）
- 反代到 B 时 `proxy_set_header Host 8.154.44.197`（**不要写 `$host`**，B 的 `server_name` 只有 IP）
- 前缀剥离全部在 B 做，A 只透传
- 必须补 `location ^~ /object/`，否则聊天图片 500

---

## 6. 发布门禁与验收

### 6.1 构建门禁（每次发布前）

```bash
cd IM-APP-fronend && npm run type-check && npm run test:unit && npm run build:h5
cd IM-APP-system  && npm run type-check && npm run build
cd IM-APP-server  && go build ./... && go vet ./...
```

### 6.2 冒烟清单

| # | 项 | 判定 |
|---|---|---|
| 1 | `GET /health` | `{"status":"ok"}` |
| 2 | `GET /api/v1/files`（无 token） | **401**（路由在，鉴权正常） |
| 3 | `POST /api/v1/files/voice`（无 token） | **401**（转码路由已上线；404=旧镜像） |
| 4 | 登录 → 私聊收发文字 | 秒达，无红叹号 |
| 5 | 群聊收发 + 群设置（公开/私密切换） | 生效且可回切 |
| 6 | 发图片（安卓 H5 + iOS App） | 双方都能看到，iOS 不白块 |
| 7 | 发语音（安卓 H5 录 → iOS 播） | 能播（走 `/files/voice` 转码） |
| 8 | 消息转发（单/多目标） | 到达且不重复 |
| 9 | 收藏 / 群公告 / 已读 | 正常 |
| 10 | 管理后台 `:8081` | 登录、用户/群/举报列表可用 |
| 11 | `docker inspect` 数据服务 | `StartedAt` 未变（发布没误重启） |

### 6.3 发布后 10 分钟内观察

```bash
docker logs --since 10m im-app-api 2>&1 | grep -iE 'error|fatal|panic' | head -20
docker logs --since 10m openim-api 2>&1 | grep -iE 'error|fatal' | head -20
tail -n 50 /www/wwwlogs/im-app-h5.error.log
```

---

## 7. 回滚

| 层 | 手段 | 注意 |
|---|---|---|
| 业务 api | 用上一版镜像 tag 重新 `up -d`：`docker tag im-app-api:last-good im-app-api:latest && docker compose up -d --force-recreate api` | 镜像 tag 规则：`20261018-<8hex>` / `<commit12>-<8hex>`，发布前记下当前 ID |
| OpenIM | 同上，回退 `im-app-retention-openim:<tag>` | 回退旧二进制**不要**同时回退迁移 |
| 数据库 | **只能向前**，不自动回滚 | 发布前必须 PG 备份；禁止恢复快照/降 `min_seq`/删 visibility 表 |
| H5 | 站点根切回上一版本目录（保留旧目录） | 不要删旧哈希资源 |
| admin 前端 | 同上 | — |
| wgt | 发**更高 versionCode** 的已知良好包 | 不能降级 |

---

## 8. 已知坑 Top 10

1. **密钥三同值**（`IM_INTERNAL_API_KEY`/`SERVER_INTERNAL_KEY`、`OPENIM_SECRET`/`IMENV_SHARE_SECRET`、`OPENIM_WEBHOOK_SECRET`/`webhooks.yml` 路径）—— 错了是静默故障，最难查。
2. **裸跑 `docker compose up -d --build`** 会缺 OSS override → `OSS_ACCESS_KEY_ID` 缺失 → API 重启循环 → 整站 502。必须带 `--env-file .env` 且保留原 override。
3. **build 了不 recreate** → 容器跑旧镜像（`docker inspect` 对比镜像 ID）。
4. **`/minio/` 的 `Host`** 必须是 `$host`，否则预签名 `SignatureDoesNotMatch`。
5. **`/object/` 上游必须是 OpenIM API（10002）**，不是 MinIO（9100）。
6. **H5 不能挂子路径**、**admin 不能挂子路径**（都是 `/assets/` 绝对路径）。
7. **wgt 必带 `--build`**，否则打旧产物；发布前脚本会校验包内版本。
8. **alpine 装 ffmpeg 慢**（实测 782s，111 个依赖包）—— 建议 Dockerfile 换国内 alpine 源。
9. **`ADMIN_JWT_SECRET` < 32 字符** release 模式直接拒绝启动。
10. **`MIGRATIONS_MODE=auto` 不能长期开**，生产必须 `verify` + 人工执行迁移。

---

## 9. 命令速查

```bash
# ── 后端（B 机）
cd /www/wwwroot/deploy
docker compose --env-file .env ps
docker compose --env-file .env up -d --build --force-recreate api
docker compose --env-file .env logs -f --tail=100 api
curl -fsS http://127.0.0.1:8080/health
docker exec im-app-api sh -c 'ffmpeg -version|head -n1'

# ── 镜像新旧对比
docker inspect im-app-api --format '{{.Image}}'
docker images --format '{{.Repository}}:{{.Tag}}  {{.ID}}  {{.CreatedSince}}' | grep -i im

# ── OpenIM
cd /www/wwwroot/deploy/openim && docker compose ps

# ── nginx
cp /www/wwwroot/deploy/baota/im-app.conf /www/server/panel/vhost/nginx/im-app.conf
nginx -t && nginx -s reload
tail -f /www/wwwlogs/im-app-h5.error.log

# ── 前端（本机）
cd IM-APP-fronend && npm run build:h5 && npm run pack:wgt:canary -- --changelog="..."
cd IM-APP-system  && npm run build
```

---

## 附录 A：本分支部署与脚本的对应关系

| 场景 | 用什么 | 不要用什么 |
|---|---|---|
| 新机器首次部署 | `deploy/oss-production/*.zip` + `deploy-production-oss.py` | `docker compose up -d --build` 整栈 |
| 日常后端发布 | `deploy/production.sh`（inspect/prepare/build/up-openim/up-api） | 手改容器、`docker restart` |
| 只改业务 api | `docker compose up -d --build --force-recreate api` | 只 `build` 不 `up` |
| H5 发布 | 版本化目录 + 原子切换 | 直接覆盖整站、清空 assets |
| App 热更新 | `pack:wgt:canary` / `pack:wgt:customer` | 手动改 manifest 后 `--publish` |
| 本机隔离测试 | `deploy/oss-test/` | 把 oss-test 当公网环境 |

## 附录 B：待确认项（方案落地前需拍板）

1. **前端是否仍在 A 机（8.217.171.178）**？近期现场排查发现过 `8.210.72.157` 上也有 `IM-APP-frontend/dist/build/h5`，两台并存需确认哪台是线上入口。
2. **OSS 是否已全量切换**（`STORAGE_PROVIDER=oss`）？若仍双轨（MinIO 兜底），发布流程要保留 `/minio/`、`/openim/` 两条反代。
3. **群保留策略是否开启**（`GROUP_RETENTION_ALL_GROUPS`）？开启后需确认私有桥 `19093` 健康，且 nginx **没有**把 `/internal/retention/` 暴露到公网。
4. **客户壳基线 versionCode** 究竟是 `100` 还是更高？直接决定 `--min-native`。
