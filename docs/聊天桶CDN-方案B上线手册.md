# 聊天桶切 CDN —— 方案 B 上线手册（AccessURL 直出 CDN 基址）

> 状态：**代码侧已完成（commit `055325e`），镜像尚未重建，生产仍是直连 OSS 原价**。
> 本文是「从代码完成 → 真正上线」的操作手册，分阶段执行，**每阶段都可停、都可回滚**。

---

## 0. 为什么是方案 B（一页纸结论）

### 0.1 被推翻的前提

曾经以为 `object.oss.bucketURL` 是「下载展示域名」，所以做了 nginx 网关方案 A。**这是错的**：

| 用途 | 代码位置 | 读的是谁 |
|---|---|---|
| **上传**（PartSize / AuthSign / InitiateFormData） | `tools@v0.0.50-alpha.106/s3/oss/oss.go` L170 / L176 / L397 | `o.bucketURL` |
| **下载**（AccessURL） | 同文件 ~L340-370 | `o.bucket.SignURL()` → SDK 的 **`Endpoint`** |

⇒ `bucketURL` **全篇只管上传**。把它改成网关域名，就算门禁不拦，也只是让**上传**绕道 ECS，**下载照样直连 OSS 原价，一分钱 CDN 收益都没有**。
⇒ 方案 A 出局（它还需要给 `oss-chat-test.易可聊.com` 新签 1 张证书，且让 ECS 变成下载单点）。

### 0.2 方案 B 做了什么

改的是 **patch 层的 `AccessURL`**，让它直接吐 CDN URL：

```
改前：https://oss-chat-test.易可聊.com/im-app-production/chat/<key>?OSSAccessKeyId=...&Expires=...&Signature=...
改后：https://oss-chat.whs188.xin/im-app-production/chat/<key>?x-oss-process=image/resize,m_lfit,w_360,h_360,format,webp
```

| 项 | 方案 A（网关，废弃） | **方案 B（当前）** |
|---|---|---|
| 新证书 | 需要 1 张 | **0 张**（CDN 域名已有证） |
| ECS 是否成为单点 | 是（下载全过 ECS） | **否**（客户端直连 CDN） |
| DNS 改动 | 需要 | **0** |
| `bucketURL` 是否要动 | 要（会触发门禁） | **一个字不改 → 门禁不触发** |
| 附带收益 | 无 | **URL 稳定无签名 → 浏览器缓存能命中 → 重复下载归零** |
| 代价 | — | 需重建 openim 镜像 |

### 0.3 门禁还在，但碰不到

`NewOSS()` 开头的硬门禁仍然钉死 `bucketURL == endpoint == https://oss-chat-test.xn--jprz53bj9s.com`。
方案 B **不碰 `bucketURL`**，所以在门禁内部改 `AccessURL` 完全合法。

---

## 1. 上线前必做检查（4 项，约 10 分钟）

### ① chat 桶的 CDN 私有回源是否生效

```bash
# 用真实存在的探针对象（不要留 <某个真实key> 这样的占位符）
curl -I "https://oss-chat.whs188.xin/im-app-production/chat/__deploy_probe/98b7c9b8bf564626a9221111c1cb53c2.bin"
```

**判读（关键，容易误判）**：

| 响应 | 含义 | 处置 |
|---|---|---|
| `200` + `X-Cache: HIT/MISS` | ✅ 链路全通 | 通过 |
| **`x-oss-cdn-auth: success`** + `404` | ✅ **私有回源授权已成立**，404 只是对象不存在 | **换真实 key 复验** |
| `403 AccessDenied` | ❌ 私有回源没开 → 上线后聊天图全挂 | **禁止上线**，先去 CDN 控制台开私有 Bucket 回源 |

> ⚠️ 占位符未替换时必然是 404 + `x-oss-cdn-auth: success`，**这是好消息不是坏消息** ——
> `x-oss-cdn-auth: success` 说明 CDN 已拿到回源授权并真的回源到 OSS 了，404 是 OSS 说"没这个对象"。
> 只有 **403** 才是「全挂级」风险信号。

**没把握 403 会不会出现时**，回滚预案是现成的：把 `IM_APP_CHAT_CDN_BASE` 置空 + 重启，代码侧会逐字节回退到今天的直连 OSS 行为。

### ② 上传链路回归（切 CDN 前后都必须过）

在 H5 随便发一张图，DevTools Network 确认：

```
PUT https://oss-chat-test.xn--jprz53bj9s.com/im-app-production%2Fchat%2Fmanaged-v1%2F...
→ 200 + Server: AliyunOSS
```

**方案 B 不碰上传**，这一项理论上不可能受影响；但每次动 openim 都必须确认一次。

### ③ CDN 控制台「过滤参数」必须是关闭

域名 `oss-chat.whs188.xin` → 缓存配置 → **过滤参数 = 关闭**。

原因：`x-oss-process=image/resize,...` 必须进缓存 key，否则 360px 和原图会共用一个缓存条目，缩略图彻底失效。

> **控制台位置（2026-10-21 截图确认）**：新版控制台「缓存配置」页签里**没有**这一项 —— 在左侧菜单「**性能优化**」里，功能名叫「**忽略参数**」。
> 注意文档提示：「自定义 Cachekey」与「忽略参数」冲突，两者同时配置时忽略参数失效 —— 若已配了自定义 Cachekey，参数策略要在里面配。

**30 秒实测判读**（用两个无关的普通参数，别用 `x-oss-process` 系列）：

```bash
curl -s -o /dev/null -D - "https://oss-chat.whs188.xin/im-app-production/chat/__deploy_probe/98b7c9b8bf564626a9221111c1cb53c2.bin?p=1" | grep -iE 'HTTP/|X-Cache'
curl -s -o /dev/null -D - "https://oss-chat.whs188.xin/im-app-production/chat/__deploy_probe/98b7c9b8bf564626a9221111c1cb53c2.bin?p=2" | grep -iE 'HTTP/|X-Cache'
```

- 第 2 条 `X-Cache: MISS` → 不同参数各占一个缓存条目 → **参数进了 key，过滤参数已关闭 ✅**（我们要的状态）
- 第 2 条 `X-Cache: HIT` → 参数被忽略 → **必须去性能优化里关掉「忽略参数」**

> ⚠️ **别用 `x-oss-process=...` 来做这个测试**（2026-10-21 踩过）：给 `.bin` 这类非图片对象加 `x-oss-process`，OSS 直接回 **400 Bad Request**，而 **4XX 默认不进 CDN 缓存** → 两条必然都是 MISS，判读完全失效。
> 这条 400 本身也印证了方案 B 的一道护栏：`scope.go` 的 `imageProcess()` 在 `opt == nil || opt.Image == nil` 时返回空串，**非图片对象（视频/语音/文件）的 AccessURL 根本不会带 `x-oss-process`**，只有调用方显式传了图片选项才加。

### ③-b 客户端缓存（Cache-Control）——「客户端跟随CDN缓存策略」必须开启

**根因定位（2026-10-21 实测 + 控制台截图）**：探针对象经 CDN 返回 200，但响应头**没有 `Cache-Control` / `Expires`**，只有 CDN 私有的 `X-Swift-CacheTime`（浏览器不认）。对应控制台「缓存过期时间」页签里那条 `/` 规则，**「客户端跟随CDN缓存策略」= 关闭** —— 这就是缺头的原因。

官方语义（阿里云文档）：**开启后，CDN 节点会将最终生效的缓存策略响应给客户端** —— 即 CDN 侧的 1 个月缓存时长会作为 `Cache-Control: max-age=2592000` 下发给浏览器。

修法（比手动加响应头更优，自动与 CDN 缓存时长联动）：

> 缓存配置 → 缓存过期时间 → 编辑 `/` 那条规则 → **「客户端跟随CDN缓存策略」→ 开启**

| | 关闭（现状） | 开启（目标） |
|---|---|---|
| 浏览器重复看图 | 每次发请求，靠 `ETag` 换 **304** | **连 304 都不发**，直接本地命中 |
| 方案 B 的收益 | **只剩「省回源」一半** | 完整 |

> 备选路径：同页签「修改出站响应头」手动添加 `Cache-Control: public, max-age=2592000`。仅当开关方案不生效时使用 —— 手动方案要在改 CDN 缓存时长时两边同步维护。

**两个生效细节（都容易踩）**：

1. 配置下发全网需 **3~5 分钟**（规则状态「成功」才算生效）。
2. **新策略只对新请求生效** —— 探针对象已被边缘按旧策略缓存（`Age: 38140`），直接重发会命中旧副本、看不到新头。验证时带个随机参数绕开旧缓存（前提是过滤参数已关闭，见 ③）：
   ```bash
   curl -s -o /dev/null -D - "https://oss-chat.whs188.xin/im-app-production/chat/__deploy_probe/98b7c9b8bf564626a9221111c1cb53c2.bin?bust=$(date +%s)" | grep -iE 'HTTP/|cache-control|X-Cache'
   # 期望：cache-control: public, max-age=2592000
   ```

### ④ 30 秒对照实验 —— 不做这条不要上线

这是判断「报障根因是不是 7 天签名过期」的唯一手段，也是决定这 1 小时值不值得花的依据：

| 操作 | 预期结果 |
|---|---|
| 转发**今天刚发**的图 | ✅ 成功 |
| 转发**7 天前**发的图 | ❌ 失败（卡「提交中」约 50s 后报错） |

- **符合预期** → 根因确认为 `internal/rpc/third/third.go:115` 的 `defaultExpire: time.Hour * 24 * 7`（硬编码），方案 B 方向正确。
- **新图也失败** → 根因不是过期，**停下来重新诊断**，不要上镜像。

---

## 2. 阶段 A：本机构建 release 包（只构建，不生效）

### 2.1 前置

- 干净的 Windows 环境 + Go（`GO_EXECUTABLE` 指向 `go.exe`）
- **三道 source hash 锁**（`thirdHash` / `s3Hash` / `ossHash`）要求 pinned 源码全新未改动 → 每次构建都会从 module cache 重新 `cpSync` 出一份 checkout，**不要手动去改 `Temp` 下的 checkout**。

### 2.2 命令

```powershell
$env:GO_EXECUTABLE='D:\Program Files\Go\bin\go.exe'
node --test deploy/openim-retention/test-patch.cjs deploy/openim-retention/test-release.cjs
node --test deploy/oss-production/openim-scope/patch-openim.test.cjs
node deploy/openim-retention/build-release.cjs
```

产物：`deploy/openim-retention/artifacts/media-gc-release-<id>/`（被 Git 忽略）。

> 时间大头在这一步：**15–40 分钟**（`go test` 4 个包 + 5 个 linux/amd64 二进制 `go build -trimpath`）。

### 2.3 上线前还要补的一处 compose 注入

CDN 基址是**环境变量**进容器（`os.Getenv("IM_APP_CHAT_CDN_BASE")`），光在 `.env` 里写值**不会**自动传给容器，必须在 compose 的 `environment` 里显式声明。

在 `deploy/openim-retention/openim.bridge.compose.json` 的 `environment` 中加一项：

```json
"IM_APP_CHAT_CDN_BASE": "${IM_APP_CHAT_CDN_BASE:-}"
```

`-` 默认值 = 空 → **默认不上线**，代码侧逐字节回退到直连 OSS。

---

## 3. 阶段 B：服务器部署（更新二进制，仍然不生效）

```bash
# 上传并解压新包后，在新包目录
sha256sum -c SHA256SUMS && python3 cleanup-production.py deploy
python3 cleanup-production.py status
```

```bash
# 服务器 /www/wwwroot/deploy/.env 追加（空值 = 不上线）
echo 'IM_APP_CHAT_CDN_BASE=' >> /www/wwwroot/deploy/.env
```

这一步做完，**生产行为与今天完全一致** —— 只是二进制换了新的。
停机窗口只有 `up-openim` 那 1 分钟（WS 断连，客户端刷新重登即可恢复，不是故障）。

---

## 4. 阶段 C：配 env 真正上线（可灰度、可秒级回退）

```bash
# 1) 填值
sed -i 's#^IM_APP_CHAT_CDN_BASE=.*#IM_APP_CHAT_CDN_BASE=https://oss-chat.whs188.xin#' /www/wwwroot/deploy/.env

# 2) 重建 openim 容器
source /root/im-app-retention/media-gc-release-<id>/compose-functions.sh
retention_openim up -d --no-deps --no-build --pull never --force-recreate openim-api
```

**不需要动 `bucketURL`** → 门禁不触发 → 上传链路零风险。

### 4.1 验收（3 条）

```bash
# ① 容器内 env 是否到位
docker exec openim-api env | grep IM_APP_CHAT_CDN_BASE

# ② 新发一张图，看返回的 URL host
#    期望 https://oss-chat.whs188.xin/... 且 URL 里没有 Signature/OSSAccessKeyId

# ③ 直连 CDN 取图
curl -I "https://oss-chat.whs188.xin/im-app-production/chat/<新图key>"
#    期望 200 + X-Cache + content-type: image/webp
```

### 4.2 回滚（秒级）

```bash
sed -i 's#^IM_APP_CHAT_CDN_BASE=.*#IM_APP_CHAT_CDN_BASE=#' /www/wwwroot/deploy/.env
retention_openim up -d --no-deps --no-build --pull never --force-recreate openim-api
```

二进制不用换，代码侧自动回退到签名直链。

---

## 5. ⚠️ 边界：方案 B 修不了老图

**这是上线前必须知道的**：

- 消息体里存的是**完整 URL 字符串**，方案 B 只影响**新生成**的 URL。
- 方案 B 上线后，**今天之前发的老图消息体里仍是 7 天前的签名 URL → 保存/转发照样 403**。
- 方案 B 的价值是「**从今往后不再产生新的过期 URL**」，不是「修好已有的」。

所以完整修复必须两件一起做：

| 层 | 动作 | 修的是 |
|---|---|---|
| 治本（防新增） | **方案 B**，CDN URL 永不过期 | 新图 |
| 治标（修存量） | 前端保存/转发时把签名 URL → `/object/<key>` 实时重签；服务端 `archive.copy` 对已知签名 host 改写到 CDN 域名 + 剥 query | 老图 |

> 服务端 `archive.copy` 那条还要求 `MEDIA_SOURCE_URL_PREFIXES`（`archive.go:101` 的 `allowed()`）里
> 包含 `https://oss-chat.whs188.xin/im-app-production/chat/` —— 该前缀**已经在**白名单里（business 桶切 CDN 时加过），
> 所以服务端改写这一条可以直接落地。

---

## 6. 时间账

| 阶段 | 耗时 | 是否停机 |
|---|---|---|
| 阶段 A 本机构建 | 15–40 min（大头） | 否 |
| 上传 release 包 | ~5 min | 否 |
| 阶段 B 部署 | ~5 min | WS 断连 1 min |
| 阶段 C 配 env + 重建 | ~2 min | WS 断连 1 min |
| 验收 | ~5 min | 否 |
| **合计** | **约 30–60 min** | **2 × 1 min** |

---

## 7. 相关文件索引

| 文件 | 作用 |
|---|---|
| `deploy/oss-production/openim-scope/scope.go` | AccessURL 改写 + `normalizeCDNBase` 空值回退 |
| `deploy/oss-production/openim-scope/patch-openim.cjs` | 注入 `os.Getenv("IM_APP_CHAT_CDN_BASE")` |
| `deploy/oss-production/openim-scope/scope_test.go` | go test（含空值回退与上传不受影响） |
| `deploy/oss-production/openim-scope/patch-openim.test.cjs` | 5 条跨文件契约测试 |
| `deploy/openim-retention/patch-object-gc.cjs:27` | GC 补丁锚点（`scopedoss.New(`），改签名必须同步 |
| `deploy/openim-retention/openim.bridge.compose.json` | openim 容器 env 注入点（待补） |
| `deploy/oss-production/deploy-production-oss.py` | 另一条注入路径（默认空） |
