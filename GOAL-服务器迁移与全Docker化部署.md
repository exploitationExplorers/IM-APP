# GOAL：IM-APP 服务器迁移与全 Docker 化部署

> **源服务器**：`8.210.72.157`（旧，Alibaba Cloud，域名 `www.ke58.com` / `admin.ke58.com`）
> **目标服务器**：`8.154.44.197`（新，Ubuntu，**无域名，只有 IP，永久 HTTP**）
> **文档性质**：迁移执行蓝图。**请先通读第 3、5 章再动手**，第 3 章是本次迁移最大的坑。
> **编写日期**：2026-10-03

---

## 0. 一句话目标

把 `8.210.72.157` 上的 **IM-APP-server（Go 主后端）、IM-APP-admin（Go 管理后台）、IM-APP-system（管理后台前端）、OpenIM 独立栈、前端 H5** 全部**取数 → 搬 → 用 Docker 重建**到 `8.154.44.197`，只靠 IP 对外服务，前端只改「后端请求地址」不改业务代码。

---

## 1. 已确认的前提（你的选择）

| 项 | 结论 |
|---|---|
| 域名 | **彻底没有**，只能 IP。→ 无 HTTPS，全链路 HTTP |
| 迁移范围 | IM-APP-server 主后端 + 依赖；管理后台（IM-APP-admin + IM-APP-system）；OpenIM 独立栈 |
| 数据 | **全量搬迁**：PostgreSQL + MinIO 文件 + OpenIM MongoDB |
| 停机 | 可接受停机；**第一优先级是把旧服务器所有数据先弄下来**；前端最后再重新发布 |
| 部署形态 | 新服务器**全部 Docker**（旧服务器上管理后台是 systemd 二进制，这次要容器化） |
| 环境 | Ubuntu / Linux，命令由你在服务器上执行 |

---

## 2. 现状盘点

### 2.1 旧服务器服务拓扑（从仓库配置反推，**需用第 6 章「阶段 -1」实地核对**）

| 服务 | 端口(宿主) | 部署方式 | 目录 / 容器 |
|---|---|---|---|
| **Go 主后端** IM-APP-server | 8080 | Docker Compose | `/root/IM-APP/IM-APP-server`，容器 `im-app-api` |
| PostgreSQL（业务库 `im_app`） | 5433→5432 | Docker | `im-app-postgres`，卷 `im_pg_data` |
| Redis（业务缓存） | 6379 | Docker | `im-app-redis`，**无卷，数据不持久** |
| MinIO（业务对象存储，桶 `im-uploads`） | 9000 / 9001 | Docker | `im-app-minio`，卷 `im_minio_data` |
| Kafka（万人转发队列） | 9092 | Docker | `im-app-kafka`，卷 `im_kafka_data` |
| **Go 管理后台** IM-APP-admin | 8090 | **systemd 二进制**（`/opt/im-admin`） | 连同一个 PG 库 |
| **管理后台前端** IM-APP-system | — | nginx 静态托管 | dist 目录待勘查 |
| **前端 H5** IM-APP-fronend | — | nginx 静态托管 | dist 目录待勘查 |
| **OpenIM 独立栈** | 10001(WS) / 10002(API) | Docker Compose（**官方 openim-docker 栈**） | `/opt/openim-docker`，容器 `openim-server` |
| OpenIM MongoDB | 27017 | Docker | 库 `openim_v3` |
| OpenIM etcd / Kafka / MinIO / Redis | 2379 / 9092 / 10005 / 6380 | Docker | — |
| nginx（域名反代 + 静态） | 80 / 443 | 宿主安装 | `/etc/nginx` |

**旧域名反代规则（反推）**

| 前缀 | 目标 |
|---|---|
| `/api/`（含 `/api/v1`） | Go 主后端 `:8080` |
| `/api/admin/`、`/api/imapp/` | Go 管理后台 `:8090` |
| `/openim-api` | OpenIM API `:10002` |
| `/openim-ws` | OpenIM WS `:10001` |
| `/minio` | 业务 MinIO `:9000` |
| `/openim` | OpenIM MinIO `:9100` |

### 2.2 数据资产清单（**这些必须 100% 取下**）

| # | 资产 | 位置 | 丢失后果 | 优先级 |
|---|---|---|---|---|
| 1 | **业务 PG 库 `im_app`** | 卷 `im_pg_data` | 用户/群/好友/转发任务/管理后台全部数据没了 | ★★★ |
| 2 | **业务 MinIO 桶 `im-uploads`** | 卷 `im_minio_data` | 头像、聊天图片/视频/文件、**APK/wgt 发布包**全 404 | ★★★ |
| 3 | **OpenIM MongoDB `openim_v3`** | OpenIM 栈 mongo 卷 | 聊天消息、会话全丢 | ★★★ |
| 4 | **OpenIM 配置目录** | `/opt/openim-docker/`（`docker-compose.yml`、`.env`、**`webhooks.yml`**、各服务 conf） | 无法还原 webhook 对接与密钥 | ★★★ |
| 5 | 所有 `.env` | `/root/IM-APP/IM-APP-server/.env`、`/opt/im-admin/.env` | 密钥、阿里云 AK 丢失 | ★★★ |
| 6 | nginx 全量配置 | `nginx -T` 输出 | 反代规则靠猜 | ★★ |
| 7 | systemd 单元 | `/etc/systemd/system/im-admin.service` | — | ★ |
| 8 | 前端静态产物 | H5 dist、admin dist | 可从源码重新构建，非必须 | ★ |
| 9 | OpenIM Kafka / etcd / Redis | 各自卷 | 瞬时态，**可不迁**（以 Mongo 为准） | — |
| 10 | 业务 Redis | 无卷 | 已读游标、短信限流计数，可接受丢失 | — |

---

## 3. ★★★ 关键约束：域名失效带来的连锁反应（**必读**）

这一章决定「前端到底要不要改代码」。结论是：**H5 和 App 必须重新构建发布，App 还必须改打包配置**。

### 3.1 前端后端地址是**编译期**写死的，不是运行时读的

`IM-APP-fronend/.env`：

```bash
VITE_API_BASE_URL=https://www.ke58.com/api/v1
VITE_WS_BASE_URL=wss://www.ke58.com/openim-ws
```

`src/config.ts:4`：

```ts
let apiBaseUrl = env.VITE_API_BASE_URL || 'https://www.ke58.com/api/v1'
```

Vite 在 `npm run build:h5` / `uni build -p app-plus` 时把域名**内联进产物**。域名一死，已发布的 H5 与已安装的 App 全部指向死域名 → **改 `.env` 后必须重新构建**，改服务器上的文件没用。

> ⚠️ `src/config.ts:4` 那个 `|| 'https://www.ke58.com/api/v1'` 兜底值也要一起改。这是本次**唯一一处代码级改动**，它属于「后端请求地址」范畴，不涉及业务逻辑。

### 3.2 已安装的 App **会彻底失联，且无法自更新**

App 的更新检查接口是 `/public/app-release`（`src/api/app-release.ts:11`），走的就是 `APP_CONFIG.apiBaseUrl`。**域名死了 → 检查更新这一步本身就连不上 → 没有任何热更新通道能把新地址推给老 App。**

**连带后果：**

- 老 App 用户升级后**全部无法登录**，必须**手动重新安装新 APK**。
- 旧 APK 的下载页（挂在 `www.ke58.com` 上）**同样失效** → 新 APK 需要**新的分发渠道**（微信群/官网/二维码指向新 IP 的下载页）。
- iOS 若走 App Store，需重新提审；企业签需重签。

**→ 这是整个迁移中影响面最大的动作，请提前准备 APK 分发方案。**

### 3.3 只有 IP = 永久 HTTP = App 需要改打包配置（**当前配置打不开**）

`IM-APP-fronend/src/manifest.json` 现状：

- Android 段（第 29–52 行）：**无** `usesCleartextTraffic`
- iOS 段（第 54–61 行）：**无** `NSAppTransportSecurity` 例外

而 Android 9+ 默认**禁止明文 HTTP**，iOS ATS 默认**禁止 HTTP**。所以新包必须补上：

| 平台 | 需要加的东西 | 加在哪 |
|---|---|---|
| Android | `usesCleartextTraffic="true"`（或 network-security-config 白名单 `8.154.44.197`） | HBuilderX 打包界面 Android 权限/自定义节点，或原生离线打包的 `AndroidManifest.xml` |
| iOS | Info.plist 加 `NSAppTransportSecurity` → `NSAllowsArbitraryLoads=true`（或 `NSExceptionDomains` 精确放行 IP） | HBuilderX iOS 打包配置 / 原生离线打包 |

> 建议优先用「精确放行 `8.154.44.197`」而不是全局 `NSAllowsArbitraryLoads=true`——后者在 App Store 审核时会被追问，且安全面更大。

### 3.4 小程序端不可用

`mp-weixin` 要求 HTTPS + 备案域名（`src/manifest.json:117-122`）。只要 IP 就会**永久不可用**。若当前有微信小程序在跑，需要单独评估。

### 3.5 全链路明文的安全代价

HTTP 下 **登录短信验证码、JWT、聊天消息、管理后台密码全部明文过网**；旧配置里 `OPENIM_SECRET=openIM123`、`im123456`、`minioadmin123` 都是弱口令。本次迁移**必须顺手做最小安全加固**（见第 9 章），否则风险显著高于迁移前。

---

## 4. 目标架构

### 4.1 服务与端口清单（新服务器 `8.154.44.197`）

| 容器名 | 镜像 / 构建 | 对外端口 | 说明 |
|---|---|---|---|
| `im-nginx` | `nginx:alpine` | **80**、**8081** | 唯一对外入口 |
| `im-app-api` | build `IM-APP-server` | 仅 `127.0.0.1:8080` | 主后端 |
| `im-admin` | build `IM-APP-admin` | 仅 `127.0.0.1:8090` | 管理后台 API（**本次新容器化**） |
| `im-app-postgres` | `postgres:16-alpine` | 仅 `127.0.0.1:5433` | 业务库 |
| `im-app-redis` | `redis:7-alpine` | 仅 `127.0.0.1:6379` | 缓存 |
| `im-app-minio` | `minio/minio:latest` | 仅 `127.0.0.1:9000/9001` | 对象存储 |
| `im-app-kafka` | `apache/kafka:4.3.1` | 仅 `127.0.0.1:9092` | 转发队列 |
| `openim-api` | `openim/openim-server:v3.8.3-patch.16` | 仅 `127.0.0.1:10001/10002` | 聊天服务 |
| `openim-mongodb` | `mongo:6.0` | 仅 `127.0.0.1:27017` | 聊天库 |
| `openim-etcd` / `openim-kafka` / `openim-minio` / `openim-redis` | 见 `deploy/openim/docker-compose.yml` | 仅本机 | 从属 |

**关键改进**：除 `22 / 80 / 8081` 外的端口**全部只绑 `127.0.0.1`**，用 ufw 封外网。旧服务器把 `10002`、`5433`、`9000`、`9092` 直接暴露公网，本方案顺手修掉。客户端只经 nginx 的 `/openim-api`、`/openim-ws` 访问 OpenIM，不需要直连。

### 4.2 URL 映射对照表（前端要改的就这几行）

| 用途 | 旧地址 | 新地址 |
|---|---|---|
| 业务 API | `https://www.ke58.com/api/v1` | `http://8.154.44.197/api/v1` |
| OpenIM API（后端下发） | `https://www.ke58.com/openim-api` | `http://8.154.44.197/openim-api` |
| OpenIM WS（后端下发） | `wss://www.ke58.com/openim-ws` | `ws://8.154.44.197/openim-ws` |
| 业务 MinIO 文件 | `https://www.ke58.com/minio` | `http://8.154.44.197/minio` |
| OpenIM MinIO | `https://www.ke58.com/openim` | `http://8.154.44.197/openim` |
| 管理后台前端 | `https://admin.ke58.com` | `http://8.154.44.197:8081` |
| 管理后台 API | `https://admin.ke58.com/api` | `http://8.154.44.197:8081/api` |

> **为什么管理后台放 8081 而不是 `/admin/` 子路径**：`IM-APP-system/.env.production` 里 `VITE_PUBLIC_PATH=/`、产物资源写死绝对路径 `/assets/...`。放到子路径必须改基础路径并重新构建。给它一个独立端口，**前端一行都不用改**（其 `VITE_API_URL=/api` 本来就是相对路径，天然跟着走）。

### 4.3 新服务器目录规划

```
/opt/im-app/
├── docker-compose.yml              # 业务栈（含 nginx / im-admin）
├── .env                            # 业务栈变量（从旧 .env 改地址而来）
├── IM-APP-server/                  # 源码，用于 build im-app-api
├── IM-APP-admin/                   # 源码，用于 build im-admin
├── openim/
│   └── docker-compose.yml          # OpenIM 栈
├── nginx/
│   └── default.conf                # 两个 server block：80 + 8081
├── web/
│   ├── h5/                         # IM-APP-fronend H5 产物
│   └── admin/                      # IM-APP-system 产物
└── backup/                         # 旧服务器搬来的备份落地在此
```

---

## 5. 需要改动的文件与变量（逐条对着改）

### 5.0 先说清楚：哪些**完全不用动**

「只是换一台服务器而已」这句话对**一半**的配置成立。区分标准只有一条：
**这个值里有没有出现域名 `ke58.com` 或旧 IP `8.210.72.157`。** 没有 → 原样照搬；有 → 必须改。

**✅ 不用动的（原样照搬）**

| 配置 | 为什么不用动 |
|---|---|
| `ALIYUN_ACCESS_KEY_ID` / `ALIYUN_ACCESS_KEY_SECRET` | 阿里云短信是**纯出站调用**（`internal/service/sms_gateway.go:44` 请求 `dysmsapi.aliyuncs.com`），与服务器地址零绑定 |
| `SMS_SIGN_NAME` / `SMS_TEMPLATE_CODE` | 签名与模板绑的是**阿里云账号和企业资质**，不是服务器 |
| `SMS_REGION_ID` / `CAPTCHA_REGION_ID` | 只是 API 接入点区域，`cn-hangzhou` 照旧 |
| `JWT_SECRET`、PG 口令、`MINIO_ACCESS_KEY/SECRET_KEY`、`OPENIM_SECRET`、`IM_INTERNAL_API_KEY` 等所有密钥 | 迁服务器**不要求**换密钥（换不换是安全策略问题，见第 8 章，纯可选） |
| `KAFKA_*` / `FORWARD_*` / `GROUP_MEMBER_HARD_LIMIT` / `LEGACY_CHAT_ENABLED` / `SEED_DEMO` | 容器内服务名与业务调参，跟对外地址无关 |
| `OPENIM_ADMIN_USER` / `OPENIM_WEBHOOK_SECRET` / `OPENIM_SECRET` | 自建服务之间的共享密钥，新旧保持一致即可 |
| `IM-APP-system` 整个前端 | `VITE_API_URL=/api` 是相对路径，天然跟着 nginx 走，**不改也不用重新构建** |

> **阿里云短信唯一需要留意的**（大概率不涉及）：若该 AccessKey 在 RAM 里配过 **IP 白名单**（策略含 `acs:SourceIp` 条件），需把 `8.154.44.197` 加进去。默认创建的 AccessKey 无此限制，直接用。
>
> 另一件远期小事：国内短信签名若以「网站」为资质来源且绑的是 `ke58.com`，域名失效不会立刻让签名作废，但阿里云做资质复核时可能被追问。**不影响本次迁移**，记一笔即可。

**❌ 必须动的** —— 只有 5.1–5.10 里**带 `ke58.com` 或 `8.210.72.157`** 的地址类配置。少改一个，功能就会**静默坏掉**：CORS 被拦、OpenIM webhook 全 403、客户端拿到死域名。

---

### 5.1 `IM-APP-fronend/.env`（H5 + App 的地址源）

```bash
VITE_API_BASE_URL=http://8.154.44.197/api/v1
VITE_WS_BASE_URL=ws://8.154.44.197/openim-ws      # 实际未被 src 引用，见下
```

> `VITE_WS_BASE_URL` 全仓 `src` **无任何引用**；真正的 WS 地址由后端 `/im/token` 下发（`src/api/im.ts:8-12`）。改它只是保持文件一致，不影响功能。

### 5.2 `IM-APP-fronend/src/config.ts:4`（兜底默认值）

```ts
let apiBaseUrl = env.VITE_API_BASE_URL || 'http://8.154.44.197/api/v1'
```

> 不改的话，只要构建时 `.env` 缺失就静默回落到死域名，排查起来很痛。

### 5.3 `IM-APP-fronend/src/utils/debug-probe.ts`

第 47、58、66 行硬编码了 `https://www.ke58.com/health`、`/`、`/minio/` 探测地址 → 改为 `http://8.154.44.197`。**非阻塞项**，可第二轮再改。

### 5.4 `IM-APP-fronend/src/manifest.json`

- `versionCode` `142` → `143`、`versionName` `1.0.42` → `1.0.43`（打新包必须递增）
- Android/iOS 补明文 HTTP 配置（见 3.3）

### 5.5 `IM-APP-fronend/scripts/pack-wgt.cjs:22`

```js
const ORIGIN_PIN_IP = process.env.IM_APP_ORIGIN_IP || '8.154.44.197'
```

> wgt 发布脚本固定打源站 IP 绕过 CDN；旧 IP 必须换。

### 5.6 `IM-APP-system` —— **不用改，不用重新构建**

`VITE_API_URL=/api` 是相对路径，跟 nginx 8081 走即可。重新构建也无害，但**不是必须项**。

### 5.7 `IM-APP-server/.env`（重点）

```bash
OPENIM_API_URL=http://openim-api:10002          # 改：走共享网络服务名（原来填公网 IP）
OPENIM_PUBLIC_API_URL=http://8.154.44.197/openim-api
OPENIM_PUBLIC_WS_URL=ws://8.154.44.197/openim-ws
MINIO_EXTERNAL_ADDRESS=http://8.154.44.197/openim
MINIO_PUBLIC_URL=http://8.154.44.197/minio
CORS_ALLOW_ORIGINS=http://8.154.44.197
OPENIM_WEBHOOK_ALLOW_CIDRS=127.0.0.1/32,172.20.0.0/16   # 删掉 8.210.72.157/32
OPENIM_WEBHOOK_SECRET=<保持旧值不变>
OPENIM_SECRET=openIM123                          # 沿用；可换（见 8.2，须与 OpenIM 栈同步）
JWT_SECRET=im-local-dev-secret-change-me         # 沿用；可换（见 8.2）
IM_INTERNAL_API_KEY=change-me-internal-api-key   # 沿用；可换（见 8.2，须与 SERVER_INTERNAL_KEY 同步）
MINIO_SECRET_KEY=minioadmin123                   # 沿用；可换
# REDIS_URL / MINIO_ENDPOINT / KAFKA_BROKERS / FORWARD_* / 阿里云短信 —— 保持原值不动
```

### 5.8 `IM-APP-admin/.env`（本次改为容器内环境变量）

```bash
HTTP_ADDR=:8090
DATABASE_URL=postgres://im:im123456@postgres:5432/im_app?sslmode=disable   # 容器内服务名
ADMIN_JWT_SECRET=<沿用旧 /opt/im-admin/.env 里的 JWT_SECRET 值>
ADMIN_BOOTSTRAP_PASSWORD=<首次初始化超管密码；已有超管后自动跳过>
ADMIN_CORS_ORIGINS=http://8.154.44.197:8081
SERVER_BASE_URL=http://im-app-api:8080
SERVER_INTERNAL_KEY=change-me-internal-api-key      # 必须与 IM-APP-server 的 IM_INTERNAL_API_KEY 一致
GROUP_MEMBER_HARD_LIMIT=4000
```

> ⚠️ 该服务 `config.Load()` 从**当前工作目录**读 `.env`。容器化后由 compose 的 `environment:` 注入即可，**不要**把带密钥的 `.env` COPY 进镜像。

### 5.9 `IM-APP-server/docker-compose.yml` 需修改处

- `api.networks` 里的 `openim-docker_openim`（旧官方栈网络名）→ **删掉**，只用 `im-app-openim-net`。
- 新增 `im-admin` 与 `nginx` 两个服务。
- 所有 `ports` 加 `127.0.0.1:` 前缀。
- `postgres` 的 `./migrations/001_init.sql` 挂载 → **删掉**（我们是恢复 dump，不是初始化空库）。

### 5.10 OpenIM 栈 `deploy/openim/docker-compose.yml` 需修改处

- 把从属服务（mongo/redis/etcd/kafka/minio）**也加入 `im-app-openim-net`**，并加固定 `container_name: openim-xxx`，让 nginx 能解析 `openim-minio` 等名字。
- `IMENV_MINIO_EXTERNALADDRESS` → `http://8.154.44.197/openim`
- `IMENV_CALLBACK_URL` 保持 `http://im-app-api:8080/internal/openim/webhooks/<secret>`
- 所有 `ports` 加 `127.0.0.1:` 前缀。

---

## 6. 实施阶段

> 每阶段结束都有「✅ 验收」检查点，**通过再进下一阶段**。

### 阶段 -1：旧服务器现状勘查（只读，不改任何东西）

我的分析来自仓库配置，**不等于线上真实状态**。先跑这些把真实情况落成文件：

```bash
# 在旧服务器 8.210.72.157 执行
mkdir -p /root/migrate/backup && cd /root/migrate/backup

# 1) 所有容器（含已停止）
docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}' | tee 01-containers.txt

# 2) compose 项目及其目录
docker compose ls -a | tee 02-compose.txt

# 3) 网络 + 子网（webhook 白名单要用）
docker network ls | tee 03-networks.txt
for n in $(docker network ls -q); do
  docker network inspect $n --format '{{.Name}} | {{range .IPAM.Config}}{{.Subnet}}{{end}} | {{range $k,$v := .Containers}}{{$v.Name}} {{end}}'
done | tee -a 03-networks.txt

# 4) 数据卷及大小
docker volume ls | tee 04-volumes.txt
docker system df -v | tee 05-disk-usage.txt

# 5) nginx 全量配置
nginx -T > 06-nginx-full.conf 2>&1

# 6) systemd 自定义服务
systemctl list-units --type=service --all | grep -Ei 'im|admin|openim' | tee 07-systemd.txt
cat /etc/systemd/system/im-admin.service 2>/dev/null | tee 07-im-admin.service

# 7) 定位前端静态目录、管理后台程序
ls -la /opt /root /var/www 2>/dev/null | tee 08-dirs.txt
find /opt /root /var/www -maxdepth 3 -name index.html 2>/dev/null | tee -a 08-dirs.txt

# 8) OpenIM 配置目录整体留存
tar czf 09-openim-config.tar.gz -C /opt/openim-docker . 2>/dev/null

# 9) 磁盘余量（判断新服务器要多大盘）
df -h | tee 10-df.txt
```

**✅ 验收**：`01-containers.txt` 里的容器清单能和第 2.1 节对上（或能解释差异）；知道 H5 dist 和管理后台 dist 的确切路径。

---

### 阶段 0：旧服务器全量备份 ★ 你的第一优先级

**Step 0.1 — 在线逻辑备份（不停服务，先拿到最关键的逻辑数据）**

```bash
cd /root/migrate/backup

# --- PostgreSQL 业务库（含管理后台共用的表）---
docker exec -t im-app-postgres pg_dump -U im -d im_app -Fc -f /tmp/im_app.dump
docker cp im-app-postgres:/tmp/im_app.dump ./im_app.dump
docker exec -t im-app-postgres pg_dumpall -U im --globals-only > ./pg_globals.sql
ls -lh im_app.dump pg_globals.sql

# --- OpenIM MongoDB ---
# 先确认 mongo 容器名与网络（阶段 -1 的 01/03 文件）
MONGO_CT=$(docker ps --format '{{.Names}}' | grep -i mongo | head -1)
echo "mongo container = $MONGO_CT"
docker inspect "$MONGO_CT" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}'
# 用独立 tools 容器 dump（避免 mongo 镜像缺 mongodump 的问题）
docker run --rm --network "$(docker inspect "$MONGO_CT" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}')" \
  -v /root/migrate/backup:/backup mongo:6.0 \
  mongodump --uri="mongodb://root:openIM123@${MONGO_CT}:27017/?authSource=admin" \
            --archive=/backup/openim.archive --gzip
ls -lh openim.archive
```

> ⚠️ OpenIM Mongo 口令以 `/opt/openim-docker/.env` 里的 `MONGO_PASSWORD` 为准，不一定是 `openIM123`。

**Step 0.2 — 停服 + 卷级冷备（保证一致性）**

```bash
cd /root/migrate/backup

# 记下当前容器状态，方便回滚重启
docker ps --format '{{.Names}}' > stopped-containers.txt

# 停掉所有业务与 OpenIM 容器（保数据卷）
docker stop $(docker ps -q) 2>/dev/null || true
sleep 5

# 卷级打包（pg 走逻辑 dump，这里主要是 MinIO 对象与 Kafka/OpenIM 卷）
docker run --rm -v im_minio_data:/data:ro  -v /root/migrate/backup:/backup alpine \
  tar czf /backup/vol_im_minio_data.tar.gz -C /data .
docker run --rm -v im_pg_data:/data:ro     -v /root/migrate/backup:/backup alpine \
  tar czf /backup/vol_im_pg_data.tar.gz -C /data .
docker run --rm -v im_kafka_data:/data:ro  -v /root/migrate/backup:/backup alpine \
  tar czf /backup/vol_im_kafka_data.tar.gz -C /data .
```

> OpenIM 各卷名以阶段 -1 的 `04-volumes.txt` 为准，按同样方式逐个 tar。

**Step 0.3 — 打包配置与校验**

```bash
cd /root/migrate
tar czf backup/configs.tar.gz \
  /root/IM-APP/IM-APP-server/.env \
  /opt/im-admin/.env \
  /opt/openim-docker \
  /etc/nginx \
  /etc/systemd/system/im-admin.service 2>/dev/null

# 生成校验清单
cd /root/migrate/backup && sha256sum * > SHA256SUMS.txt && cat SHA256SUMS.txt
du -sh /root/migrate/backup
df -h /
```

**✅ 验收**：`im_app.dump`、`openim.archive`、`vol_im_minio_data.tar.gz`、`configs.tar.gz` 四个文件都存在且体积合理（非 0、非几十 KB 的异常小值）。`SHA256SUMS.txt` 已生成。

---

### 阶段 1：新服务器环境准备

```bash
# 在 8.154.44.197 执行（root 或 sudo）

# 1) 基础
apt update && apt upgrade -y
apt install -y curl wget vim htop ufw rsync ca-certificates gnupg

# 2) 时区
timedatectl set-timezone Asia/Shanghai && timedatectl

# 3) 文件句柄（OpenIM / Kafka 需要）
cat >> /etc/security/limits.conf <<'EOF'
* soft nofile 65535
* hard nofile 65535
EOF

# 4) Docker（国内加速脚本）
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker
docker version && docker compose version
```

**配置国内镜像加速**（新服务器拉 10+ 个镜像，不加会很慢）：

```bash
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'EOF'
{
  "registry-mirrors": [
    "https://docker.m.daocloud.io",
    "https://dockerproxy.com",
    "https://mirror.ccs.tencentyun.com"
  ],
  "log-driver": "json-file",
  "log-opts": { "max-size": "50m", "max-file": "3" }
}
EOF
systemctl restart docker && docker info | grep -A5 "Registry Mirrors"
```

**防火墙**（只放 22 / 80 / 8081）：

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 8081/tcp
ufw --force enable && ufw status verbose
```

> ⚠️ 放行 22 前确认你的 SSH 端口就是 22，否则会把自己锁在外面。

**✅ 验收**：`docker compose version` 有输出；`ufw status` 显示 22/80/8081 为 ALLOW。

---

### 阶段 2：数据搬运

推荐**服务器直连**（比经你本地中转快得多，尤其 MinIO 可能几个 GB）。

```bash
# --- 在新服务器执行：生成密钥并把公钥给旧服务器 ---
ssh-keygen -t ed25519 -N "" -f /root/.ssh/id_ed25519
cat /root/.ssh/id_ed25519.pub
# 把这行公钥追加到【旧服务器】的 /root/.ssh/authorized_keys

# --- 回到旧服务器：直接推到新服务器 ---
apt install -y rsync
mkdir -p /root/migrate
rsync -avzP --progress /root/migrate/backup/ root@8.154.44.197:/root/migrate/backup/
rsync -avzP --progress /root/migrate/backup/configs.tar.gz root@8.154.44.197:/root/migrate/
```

**方式 B（新服务器主动拉，反过来也行）**：`rsync -avzP root@8.210.72.157:/root/migrate/backup/ /root/migrate/backup/`

**方式 C（经你本地中转）**：用 `im001.pem` 分别 `scp -i im001.pem -r root@8.210.72.157:/root/migrate/backup ./` 下载后再上传到新服务器。慢，仅在前两种不通时用。

**✅ 验收**：

```bash
# 新服务器
cd /root/migrate/backup && sha256sum -c SHA256SUMS.txt
```

全部 `OK` 才算搬完。

---

### 阶段 3：新服务器目录与数据恢复

```bash
mkdir -p /opt/im-app/{nginx,web/h5,web/admin,openim,backup}
cd /opt/im-app

# 恢复配置文件作为基础（再按第 5 章改地址）
tar xzf /root/migrate/backup/configs.tar.gz -C /tmp/ 2>/dev/null
# nginx 旧配置只作参考（我们要写新的），先留着比对
```

**创建共享网络（★ 必须显式指定子网，与 webhook 白名单对齐）**

```bash
docker network create --subnet 172.20.0.0/16 im-app-openim-net
docker network inspect im-app-openim-net --format '{{range .IPAM.Config}}{{.Subnet}}{{end}}'
# 必须输出 172.20.0.0/16，否则改 .env 里的 OPENIM_WEBHOOK_ALLOW_CIDRS
```

**编排文件落地**（内容见附录 A / B）：

- `/opt/im-app/docker-compose.yml`
- `/opt/im-app/.env`
- `/opt/im-app/nginx/default.conf`
- `/opt/im-app/openim/docker-compose.yml`
- 源码：`IM-APP-server/` → `/opt/im-app/IM-APP-server/`；`IM-APP-admin/` → `/opt/im-app/IM-APP-admin/`

**恢复 PostgreSQL**

```bash
cd /opt/im-app
docker compose up -d postgres
sleep 15
docker compose exec -T postgres pg_isready -U im -d im_app

# 恢复业务库（先建空库 → 再 restore；dump 里已含 schema，不需要 001_init.sql）
docker cp /root/migrate/backup/im_app.dump im-app-postgres:/tmp/im_app.dump
docker compose exec -T postgres pg_restore -U im -d im_app --clean --if-exists --no-owner --no-privileges /tmp/im_app.dump

# 核对
docker compose exec -T postgres psql -U im -d im_app -c "\dt" | head -40
docker compose exec -T postgres psql -U im -d im_app -c "SELECT count(*) FROM users;"
```

> `--clean --if-exists` 让恢复可重复执行。若报 `role "im" already exists` 类错误可忽略（globals 已存在）。

**恢复 MinIO 业务桶**

```bash
docker compose up -d minio && sleep 10
docker volume rm im-app_im_minio_data 2>/dev/null || true   # 若已有空卷
docker volume create im-app_im_minio_data
docker run --rm -v im-app_im_minio_data:/data -v /root/migrate/backup:/backup alpine \
  sh -c 'cd /data && tar xzf /backup/vol_im_minio_data.tar.gz'
ls -la /opt/im-app  # 确认卷已填充
```

> 卷的最终前缀取决于 compose 项目名。用 `docker volume ls | grep minio` 确认实际名字后再执行。

**✅ 验收**：`users` 表行数与旧库一致；MinIO 卷内有 `im-uploads` 数据。

---

### 阶段 4：部署业务栈 + nginx

```bash
cd /opt/im-app
# 确认 .env 已按 5.7 改完地址
docker compose build api admin
docker compose up -d postgres redis minio kafka api admin nginx

docker compose ps
docker compose logs -f --tail=100 api      # 看到监听 :8080 / migrations applied 即正常
docker compose logs -f --tail=100 admin    # 看到 super admin ensured / listening :8090
```

**✅ 验收**

```bash
curl -s http://127.0.0.1:8080/health
curl -s http://127.0.0.1:8090/api/admin/v1/health
curl -s http://8.154.44.197/health
curl -s -o /dev/null -w '%{http_code}\n' http://8.154.44.197/api/v1/countries   # 走 nginx → api
curl -s -o /dev/null -w '%{http_code}\n' http://8.154.44.197:8081/              # 管理后台前端
```

---

### 阶段 5：部署 OpenIM 栈

```bash
cd /opt/im-app/openim
# compose 内容见附录 D（基于 IM-APP-server/deploy/openim/docker-compose.yml 修改）
docker compose up -d
docker compose ps
docker compose logs -f --tail=100 openim-api
```

**恢复 OpenIM MongoDB**（在 mongo 起来之后）：

```bash
docker run --rm --network im-app-openim-net \
  -v /root/migrate/backup:/backup mongo:6.0 \
  mongorestore --uri="mongodb://root:openIM123@openim-mongodb:27017/?authSource=admin" \
               --archive=/backup/openim.archive --gzip --drop
```

**迁移 webhook 配置（★ 最容易漏的一步）**

旧服务器 `/opt/openim-docker` 里的 `webhooks.yml`（已随 `configs.tar.gz` 打包）必须同步到新栈对应位置，且 URL 保持指向 `http://im-app-api:8080/internal/openim/webhooks/<OPENIM_WEBHOOK_SECRET>`。

```bash
# 1) 找到新栈里 openim-api 的配置挂载点
docker inspect openim-api --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{"\n"}}{{end}}'

# 2) 把旧 webhooks.yml 放到对应目录，确认 url 与五个开关正确
# 3) 重启生效
docker compose restart openim-api
```

**验证容器间连通（复刻旧文档的验收方式）**：

```bash
docker exec openim-api wget -qO- --post-data='{}' \
  "http://im-app-api:8080/internal/openim/webhooks/$OPENIM_WEBHOOK_SECRET/callbackTest" ; echo
# 期望 200 / nextCode=0（具体返回值以接口实现为准）
```

**✅ 验收**

```bash
curl -s -o /dev/null -w 'openim-api via nginx: %{http_code}\n' http://8.154.44.197/openim-api/health
curl -s -o /dev/null -w 'openim-ws via nginx: %{http_code}\n' \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' http://8.154.44.197/openim-ws
docker compose logs openim-api | grep -i webhook
```

---

### 阶段 6：部署前端（**最后做，符合你的要求**）

**6.1 管理后台前端（IM-APP-system）——零改动**

```bash
# 本地 Windows
cd E:\codeMoney\IM-APP\IM-APP-system
npm ci && npm run build

# 上传 dist 到新服务器
scp -r dist/* root@8.154.44.197:/opt/im-app/web/admin/
```

**6.2 H5（IM-APP-fronend）**

先改 `.env` + `src/config.ts:4`（见 5.1 / 5.2），再构建：

```bash
cd E:\codeMoney\IM-APP\IM-APP-fronend
# 确认 .env 已是 http://8.154.44.197/api/v1
npm run build:h5

scp -r dist/build/h5/* root@8.154.44.197:/opt/im-app/web/h5/
```

**6.3 App 重新打包（★ 见第 3.2 / 3.3 的强制要求）**

1. `src/manifest.json`：`versionCode` → `143`、`versionName` → `1.0.43`
2. 补 Android `usesCleartextTraffic` / iOS ATS 例外
3. HBuilderX 打 Android APK（必要时 iOS IPA）
4. **准备新的分发渠道**（旧下载页随域名一起死了）
5. 通过管理后台发布新版本记录：

```bash
cd E:\codeMoney\IM-APP\IM-APP-fronend
set IM_APP_ORIGIN_IP=8.154.44.197
npm run pack:wgt -- --build --publish --min-native=143 --changelog="迁移至新服务器"
```

**✅ 验收**：手机浏览器打开 `http://8.154.44.197` 能注册/登录/收发消息；`http://8.154.44.197:8081` 能用 admin 账号登录并拉到用户列表。

---

### 阶段 7：端到端验收清单

| # | 项 | 命令 / 操作 | 期望 |
|---|---|---|---|
| 1 | 主后端健康 | `curl http://8.154.44.197/health` | 200 |
| 2 | 管理后台健康 | `curl http://8.154.44.197:8081/api/admin/v1/health` | 200 |
| 3 | 用户数据完整 | `psql -c "SELECT count(*) FROM users;"` | 与旧库一致 |
| 4 | 历史图片可访问 | 浏览器打开一条老消息里的图片 URL | 正常显示 |
| 5 | H5 登录 | 手机浏览器 `http://8.154.44.197` | 能收短信、能登录 |
| 6 | H5 发消息 | 两个账号互发文字/图片 | 实时到达 |
| 7 | **App 登录** | 装新 APK | 能登录、能聊天 |
| 8 | **App 历史消息** | 打开迁移前的会话 | 消息与图片都在 |
| 9 | OpenIM webhook | `docker compose logs api \| grep -i webhook` | 有回调记录，无 403 |
| 10 | 群聊 | 建群/发群消息 | 正常 |
| 11 | 万人转发 | 触发一次转发 | 队列消费成功 |
| 12 | 管理后台改数据 | 禁言/改配置 | 生效（证明 `SERVER_BASE_URL` 通路对） |
| 13 | wgt 热更新 | 检查更新 | 能拉到新版本 |

> **第 12 项特别重要**：它验证 `IM-APP-admin → IM-APP-server` 的内部接口通路（`SERVER_BASE_URL` + `SERVER_INTERNAL_KEY`），这条链路旧服务器是 `http://localhost:8080`，容器化后改成 `http://im-app-api:8080`，最容易配错。

---

### 阶段 8：收尾

**8.1 端口与防火墙核对（属于迁移的一部分，必须做）**

```bash
# 确认非 80/8081 端口全部只绑 127.0.0.1
docker compose ps --format 'table {{.Service}}\t{{.Ports}}'
ss -tlnp | grep -E '5433|6379|9000|9001|9092|10001|10002|27017'
# 应全部是 127.0.0.1 开头

# 确认防火墙只放行了这三个口
ufw status verbose

# .env 含阿里云 AccessKey，收一下权限
chmod 600 /opt/im-app/.env
```

**8.2 密钥轮换（纯可选，不换不影响迁移）**

迁移本身**不需要**更换任何密钥，`JWT_SECRET` / 数据库口令 / `MINIO_SECRET_KEY` / `OPENIM_SECRET` 等原样搬即可。若哪天想换，注意这两组必须**成对同步**，否则会出现难查的静默故障：

- `IM_INTERNAL_API_KEY`（IM-APP-server）↔ `SERVER_INTERNAL_KEY`（IM-APP-admin）
- `OPENIM_SECRET`（IM-APP-server）↔ `IMENV_SHARE_SECRET`（OpenIM 栈）

**8.3 仓库清理（可第二轮做）**

- `im001.pem`（仓库根目录）是一把**已提交进 git 的私钥**；`IM-APP-server/.env`、`IM-APP-system/.env` 等含真实密钥的文件也在仓库里。与迁移无关，但值得记一笔。

---

## 7. 回滚方案

只要**旧服务器不销毁、数据不删**，回滚成本就很低：

1. 旧服务器恢复服务：`cd /root/IM-APP/IM-APP-server && docker compose up -d`（阶段 0.2 停的容器）
2. 旧服务器若已释放域名/入口，需把客户端指回旧地址——**App 又要重打包一次**。这是唯一的硬伤。
3. **因此建议：旧服务器至少保留 1–2 周再退订**，确认新服务器稳定后再释放。

---

## 8. 风险登记表

| # | 风险 | 影响 | 等级 | 应对 |
|---|---|---|---|---|
| 1 | 老 App 无法自更新，用户必须手动重装 | 用户流失、投诉 | **高** | 提前准备新 APK 分发渠道；旧渠道能用的先用 |
| 2 | App 未开明文 HTTP → 新包也连不上 | App 完全不可用 | **高** | 打包前必须补 Android/iOS 配置（3.3） |
| 3 | MinIO 卷打包/恢复出错 | 历史图片视频全 404 | **高** | 阶段 0 在线 dump + 停服冷备双份；阶段 7 第 4 项验 |
| 4 | OpenIM `webhooks.yml` 漏迁 | 消息审核/撤回/统计静默失效 | **中** | 阶段 5 显式迁移 + 阶段 7 第 9 项验 |
| 5 | 共享网络子网与 `WEBHOOK_ALLOW_CIDRS` 不符 | webhook 全 403 | **中** | 建网时显式 `--subnet 172.20.0.0/16` |
| 6 | `SERVER_INTERNAL_KEY` 与 `IM_INTERNAL_API_KEY` 不一致 | 管理后台改数据静默失败 | **中** | 阶段 7 第 12 项专门验 |
| 7 | 全链路明文 HTTP | 凭证/消息可被窃听 | **中** | 阶段 8 加固；长期考虑重新备案域名 |
| 8 | 迁移无迁移版本表、migrations 存在同号文件 | 新环境建表顺序异常 | **中** | 我们恢复的是 dump 不是重跑迁移，风险已规避；空库重来时需注意 |
| 9 | 镜像拉取受网络限制 | 部署卡住 | **中** | 阶段 1 配镜像加速 |
| 10 | 新服务器磁盘不足 | 恢复中断 | **中** | 阶段 -1 第 10 项先看旧盘占用，新盘 ≥ 旧盘 ×2 |
| 11 | 小程序端彻底不可用 | 功能缺失 | **低** | 需单独评估是否还要小程序 |
| 12 | 旧服务器 IP 若被回收 | 无法回滚 | **低** | 保留期内不做退订 |

---

## 9. 待你确认的开放问题

1. **`IM-APP-system` 的定位**：它是 Vue 管理后台**前端**，真正提供接口的是 `IM-APP-admin`（Go，8090）。我的方案把两个都包含进来了。如果你原本只想搬 `IM-APP-system`，管理后台会打不开——请确认这个理解正确。
2. **你说的「新后端全部在旧服务器搭建好了，再去重新发布前端」**：我按「新服务器搭好后端 → 最后重新发布前端」来编排（阶段 1–5 后端，阶段 6 前端）。如果你真的是想在**旧服务器**上先把 Docker 化验证一遍再搬，那阶段顺序要调整，请指出。
3. **App 的分发渠道**：新 APK 打算怎么发（微信群 / 官网 / 应用市场）？这决定第 3.2 节的具体动作。
4. **iOS 是否需要**：如果只有 Android，可以省掉 ATS 那一摊。
5. **新服务器规格**：CPU/内存/磁盘多少？OpenIM + Kafka + PG + MinIO 一套下来建议 **≥ 4C8G、≥ 100G 盘**。
6. **是否要顺手换弱口令**：第 8 章列了一批 `im123456` / `minioadmin123` / `openIM123`，换它们会连带影响多个文件，需要你点头。

---

## 附录 A：新服务器 `docker-compose.yml`（业务栈）

> 放在 `/opt/im-app/docker-compose.yml`。相对旧文件的变化：**新增 `admin` 与 `nginx`；所有端口绑 `127.0.0.1`；去掉 `openim-docker_openim` 外网；去掉 `001_init.sql` 挂载**。

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: im-app-postgres
    environment:
      POSTGRES_USER: im
      POSTGRES_PASSWORD: im123456     # ★ 阶段 8 建议更换
      POSTGRES_DB: im_app
    ports:
      - "127.0.0.1:5433:5432"
    volumes:
      - im_pg_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U im -d im_app"]
      interval: 5s
      timeout: 5s
      retries: 10
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    container_name: im-app-redis
    ports:
      - "127.0.0.1:6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5
    restart: unless-stopped

  minio:
    image: minio/minio:latest
    container_name: im-app-minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin123   # ★ 阶段 8 建议更换
      MINIO_API_CORS_ALLOW_ORIGIN: "*"
    ports:
      - "127.0.0.1:9000:9000"
      - "127.0.0.1:9001:9001"
    volumes:
      - im_minio_data:/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  kafka:
    image: apache/kafka:4.3.1
    container_name: im-app-kafka
    ports:
      - "127.0.0.1:9092:9092"
    environment:
      KAFKA_NODE_ID: 1
      KAFKA_PROCESS_ROLES: broker,controller
      KAFKA_LISTENERS: PLAINTEXT://:19092,PLAINTEXT_HOST://:9092,CONTROLLER://:9093
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:19092,PLAINTEXT_HOST://localhost:9092
      KAFKA_INTER_BROKER_LISTENER_NAME: PLAINTEXT
      KAFKA_CONTROLLER_LISTENER_NAMES: CONTROLLER
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT,PLAINTEXT_HOST:PLAINTEXT
      KAFKA_CONTROLLER_QUORUM_VOTERS: 1@kafka:9093
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
      KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR: 1
      KAFKA_TRANSACTION_STATE_LOG_MIN_ISR: 1
      KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS: 0
      KAFKA_NUM_PARTITIONS: 6
    volumes:
      - im_kafka_data:/var/lib/kafka/data
    restart: unless-stopped

  api:
    build: ./IM-APP-server
    container_name: im-app-api
    depends_on:
      postgres: { condition: service_healthy }
      redis:    { condition: service_healthy }
      kafka:    { condition: service_started }
    env_file: [.env]
    environment:
      HTTP_ADDR: ":8080"
      DATABASE_URL: postgres://im:im123456@postgres:5432/im_app?sslmode=disable
      REDIS_URL: redis://redis:6379/0
      MINIO_ENDPOINT: minio:9000
      MINIO_BUCKET: im-uploads
      MINIO_USE_SSL: "false"
      KAFKA_BROKERS: kafka:19092
      OPENIM_API_URL: http://openim-api:10002
    ports:
      - "127.0.0.1:8080:8080"
    networks: [default, im-app-openim-net]
    restart: unless-stopped

  admin:
    build: ./IM-APP-admin
    container_name: im-admin
    depends_on:
      postgres: { condition: service_healthy }
      api:      { condition: service_started }
    environment:
      HTTP_ADDR: ":8090"
      DATABASE_URL: postgres://im:im123456@postgres:5432/im_app?sslmode=disable
      GIN_MODE: release
      # 其余键从 .env 读取（见附录 C 的 ADMIN_* / SERVER_* 段）
    env_file: [.env]
    ports:
      - "127.0.0.1:8090:8090"
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    container_name: im-nginx
    depends_on: [api, admin]
    ports:
      - "80:80"
      - "8081:8081"
    volumes:
      - ./nginx/default.conf:/etc/nginx/conf.d/default.conf:ro
      - ./web/h5:/usr/share/nginx/html/h5:ro
      - ./web/admin:/usr/share/nginx/html/admin:ro
    networks: [default, im-app-openim-net]
    restart: unless-stopped

volumes:
  im_pg_data:
  im_minio_data:
  im_kafka_data:

networks:
  im-app-openim-net:
    external: true
```

> `admin` 服务的 `env_file: [.env]` 会注入 `ADMIN_*` / `SERVER_*`，与 `IM-APP-server` 共用同一个 `.env`（互不冲突的键名）。若你更想分开，可改成 `env_file: [./IM-APP-admin/.env]` 并单独维护。

---

## 附录 B：`nginx/default.conf`

```nginx
# ───────── :80 ── H5 客户端 + 业务 API + OpenIM + 对象存储 ─────────
server {
    listen 80 default_server;
    server_name _;
    root /usr/share/nginx/html/h5;
    index index.html;
    client_max_body_size 200m;

    # 业务 Go API
    location ^~ /api/ {
        proxy_pass http://im-app-api:8080;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }

    location = /health {
        proxy_pass http://im-app-api:8080/health;
    }

    # OpenIM WebSocket 网关（必须带 Upgrade 头，否则握手失败）
    location ^~ /openim-ws {
        proxy_pass http://openim-api:10001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host       $host;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    # OpenIM 管理 API
    location ^~ /openim-api/ {
        proxy_pass http://openim-api:10002/;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 业务 MinIO（预签名 URL 走这里）
    location ^~ /minio/ {
        proxy_pass http://minio:9000/;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # OpenIM MinIO
    location ^~ /openim/ {
        proxy_pass http://openim-minio:9000/;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    }

    # H5 SPA 回退
    location / {
        try_files $uri $uri/ /index.html;
    }
}

# ───────── :8081 ── 管理后台（前端 + API 同源，零跨域）─────────
server {
    listen 8081;
    server_name _;
    root /usr/share/nginx/html/admin;
    index index.html;
    client_max_body_size 200m;

    location ^~ /api/ {
        proxy_pass http://im-admin:8090;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

> `/openim-api/` 与 `/minio/` 的 `proxy_pass` 带了**尾部 `/`**（会剥掉前缀），而 `/api/` 不带（保留前缀）。这是从旧配置反推的语义，**首次部署后必须用阶段 4 的验收命令实测**，若 404 就去掉/加上尾部斜杠再试。

---

## 附录 C：`/opt/im-app/.env` 模板

```bash
# ===== 品牌/环境 =====
# IM-APP 生产配置（8.154.44.197，纯 IP，无 HTTPS）

# ===== OpenIM 对接 =====
OPENIM_API_URL=http://openim-api:10002
OPENIM_PUBLIC_API_URL=http://8.154.44.197/openim-api
OPENIM_PUBLIC_WS_URL=ws://8.154.44.197/openim-ws
OPENIM_SECRET=openIM123
OPENIM_ADMIN_USER=imAdmin
OPENIM_WEBHOOK_SECRET=<沿用旧值>
OPENIM_WEBHOOK_ALLOW_CIDRS=127.0.0.1/32,172.20.0.0/16
OPENIM_RECALL_WINDOW_SECONDS=120
IM_INTERNAL_API_KEY=change-me-internal-api-key

GROUP_MEMBER_HARD_LIMIT=4000

# ===== 认证与运行模式 =====
JWT_SECRET=im-local-dev-secret-change-me
DEV_SMS_CODE=
LEGACY_CHAT_ENABLED=false
SEED_DEMO=false
CORS_ALLOW_ORIGINS=http://8.154.44.197

# ===== 容器内部地址 =====
REDIS_URL=redis://redis:6379/0
MINIO_ENDPOINT=minio:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin123
MINIO_BUCKET=im-uploads
MINIO_USE_SSL=false
MINIO_PUBLIC_URL=http://8.154.44.197/minio
MINIO_PUBLIC_READ=true
MINIO_EXTERNAL_ADDRESS=http://8.154.44.197/openim

# ===== Kafka 万人转发 =====
KAFKA_BROKERS=kafka:19092
KAFKA_FORWARD_TOPIC=im-forward-tasks
KAFKA_FORWARD_GROUP_ID=im-forward-workers
FORWARD_WORKER_ENABLED=true
FORWARD_BATCH_SIZE=50
FORWARD_MAX_ATTEMPTS=8
FORWARD_CONCURRENCY=4
FORWARD_QPS=20
FORWARD_POLL_SECONDS=2
FORWARD_LOCK_SECONDS=300

# ===== 阿里云短信（沿用旧值）=====
ALIYUN_ACCESS_KEY_ID=<沿用>
ALIYUN_ACCESS_KEY_SECRET=<沿用>
SMS_SIGN_NAME=舞阳县旺鸿盛科技有限公司
SMS_TEMPLATE_CODE=SMS_337356265
SMS_REGION_ID=cn-hangzhou
CAPTCHA_REGION_ID=cn-hangzhou

# ===== 管理后台 IM-APP-admin =====
ADMIN_JWT_SECRET=<沿用旧 /opt/im-admin/.env 的 JWT_SECRET 值，保持已登录会话不失效>
ADMIN_BOOTSTRAP_PASSWORD=<首次初始化超管密码>
ADMIN_CORS_ORIGINS=http://8.154.44.197:8081
SERVER_BASE_URL=http://im-app-api:8080
SERVER_INTERNAL_KEY=change-me-internal-api-key
GIN_MODE=release
```

---

## 附录 D：OpenIM 栈 `openim/docker-compose.yml` 修改要点

以 `IM-APP-server/deploy/openim/docker-compose.yml` 为基线，落地到 `/opt/im-app/openim/docker-compose.yml`，改动：

1. **每个服务加固定 `container_name`**：`openim-mongodb`、`openim-redis`、`openim-etcd`、`openim-kafka`、`openim-minio`、`openim-api`（nginx 要靠这些名字解析）。
2. **所有服务加入 `im-app-openim-net`**（基线里只有 `openim-api` 在这个网络）。
3. **所有 `ports` 前加 `127.0.0.1:`**。
4. `IMENV_MINIO_EXTERNALADDRESS` → `http://8.154.44.197/openim`
5. `IMENV_SHARE_SECRET` 必须与业务 `.env` 的 `OPENIM_SECRET` 完全一致。
6. `IMENV_CALLBACK_URL` 保持 `http://im-app-api:8080/internal/openim/webhooks/<OPENIM_WEBHOOK_SECRET>`。

---

## 附：执行顺序速查

```
[旧服务器]  阶段-1 勘查 → 阶段0 备份（★第一优先级）
                    ↓
[新服务器]  阶段1 环境 → 阶段2 搬运 → 阶段3 目录+恢复数据
                    ↓
            阶段4 业务栈 → 阶段5 OpenIM → 阶段6 前端（最后）
                    ↓
            阶段7 验收 → 阶段8 加固
                    ↓
[旧服务器]  保留 1-2 周 → 确认稳定后释放
```
