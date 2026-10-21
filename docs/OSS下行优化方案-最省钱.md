# OSS 下行流量优化（最省钱）操作文档

> 目标：在不降低图片/视频可用性的前提下，把 OSS 跨境下行账单砍到最低。
> 结论优先级：**① 开 CDN（降单价 + 边缘缓存吃重复流量）** 为主，**② GC 激活 + ③ 上传打 Cache-Control + ④ 缩略图全量 + ⑤ 视频流式** 为零成本降量手段。
> 本文含 Aliyun 控制台逐步操作 + 对应代码改动点。所有降量手段不花额外基础设施费。

---

## 0. 当前代码链路（基于 2026-10-20 代码分析）

| 媒体类型 | 写入方 | 存储位置 | 客户端访问方式 | 是否 CDN 重点 |
|---|---|---|---|---|
| 聊天图片/视频/语音/封面 | **OpenIM** | `yikeliao-188-hk-test` / `im-app-production/chat/managed-v1/` | OpenIM 用 `OSS_PUBLIC_BASE_URL=https://oss-chat-test.易可聊.com` 签发带时效 URL，客户端直拉该域名 | ✅ 流量大头，优先 |
| App 文件/语音/头像/收藏转发副本 | **IM-APP-server** | 同上桶其他前缀 | `handler/storage_media.go` → `ResolveMedia`(HMAC token) → `PresignGet(10min)` → 302 到 `PublicUploadURL`(=`bucket.oss-cn-hongkong.aliyuncs.com`) | ⏸ 体量小，二期 |

**关键代码位置**
- `IM-APP-server/internal/infra/oss.go`
  - `FileURL` (L111)：`PublicBaseURL` 非空时返回 `PublicBaseURL/key`（OpenIM 走这条）
  - `PresignGet` (L220)：生成 OSS V4 签名 GET URL，有效期 ≤ 1h（媒体链路默认 10min）
  - `PutObject` (L234) / `putArchive` (L264)：**当前不设置 `Cache-Control` 响应头** ← 需改
  - `NewOSS` (L74)：`signClient` 用 `PublicUploadURL` + `WithUseCName(true)` 签名
- `IM-APP-server/internal/handler/storage_media.go:21`：`Cache-Control: private, no-store` 仅作用于 302 跳转响应本身（不影响最终 OSS 对象缓存），OSS 对象是否缓存取决于**对象元数据里的 Cache-Control + CDN 缓存规则**
- `deploy/docker-compose.yml:180`：`OSS_PUBLIC_BASE_URL: ${OSS_PUBLIC_BASE_URL:-}`（OpenIM 聊天媒体域名来源）
- GC：`deploy/openim-retention/OBJECT-GC.md` + `PRODUCTION.md:18`，已部署 `media-gc-release-FwmrxL`，每日 03:30 回收无引用 `managed-v1`；RAM 权限见 `deploy/oss-production/ram-production-policy.json:40`（已含 `DeleteObject` + `GetBucketVersioning`）

**成本原理（概略单价，单位 元/GB，内地用户）**
| 出口 | 单价 | 说明 |
|---|---|---|
| OSS 香港跨境直连（现状） | ~0.5–0.8 | 最贵，且无缓存每字节都算 |
| OSS 内地直连 | ~0.5 | 迁桶才到这价，迁移成本高 |
| **CDN 边缘** | **~0.2** | 最便宜单价 + 重复流量被边缘吃掉 |

---

## 0.5 关键约束：域名未备案（直接影响方案①）

> **现状**：Bucket `yikeliao-188-hk-test` 在 **香港（cn-hongkong）**；自定义域名 `oss-chat-test.易可聊.com` **未在内地 ICP 备案**。
> **后果**：Aliyun CDN 的**中国大陆节点**要求加速域名已备案。未备案 → 该域名**无法接入 CDN 大陆节点**，方案①的原形式（HK bucket + 大陆 CDN 边缘）**当前不可执行**。
> 此前文档默认「域名已上线 = 已备案」是错误的，以此为准修订。

**未备案下的可行路径（详见第 8 节）**
- 想走 CDN 降单价 → 必须**先备案**（见 8.1），或改用**已备案的其他域名**的子域（见 8.2）
- 不想等备案 → **桶迁内地 cn-hangzhou**（见 8.3）拿到内地单价，且顺手修掉跨境 `ERR_CONNECTION_CLOSED`
- 既不想备案也不想迁移 → 只能做**降量手段**（方案②③④ + 客户端缓存），单价仍是 HK 跨境贵

---

## 1. 方案①：开通 CDN（核心，降单价）——Aliyun 控制台逐步操作

### 1.1 前提确认（先做完再开）
- [ ] **域名 `oss-chat-test.易可聊.com` 已 ICP 备案** ← ⚠️ 当前**未备案**，方案①原形式被阻断，先见第 8 节解锁
- [ ] 证书已就绪：acme-client 已签发该子域证书，导出 PEM 供 CDN 上传；或 CDN 控制台申请免费证书
- [ ] **桶版本控制 = 未启用**（此前 OSS 控制台截图已确认；若已开启/已暂停，**不要关闭或删历史版本**，先评审版本回收方案，否则 GC 拒绝激活）

### 1.2 步骤 A：OSS 控制台一键加速（推荐）
1. 登录 **OSS 控制台** → Bucket `yikeliao-188-hk-test` → **传输管理 → 域名管理**
2. 找到已绑定的自定义域名 `oss-chat-test.易可聊.com`（状态应为「已绑定」）→ 点击 **开通 CDN 加速**
3. 按引导完成：系统会自动把该子域名的 CNAME 目标从「OSS 端点」切换为「CDN 加速域名」
4. 等待 **CNAME 校验通过**（控制台显示「CDN 加速：已开启」）

### 1.3 步骤 B：CDN 控制台添加域名（若走独立入口）
1. **CDN 控制台** → **域名管理 → 添加域名**
2. 加速域名：`oss-chat-test.易可聊.com`
3. 业务类型：**图片小文件**
4. 源站类型：**OSS 域名** → 选择 `yikeliao-188-hk-test.oss-cn-hongkong.aliyuncs.com`
5. 端口：**443**（HTTPS）
6. 提交后，把该子域名的 DNS CNAME 改为控制台给出的 CDN 加速域名（如 `*.kunlun.com`）

### 1.4 私有 Bucket 回源（必做，否则 403）
> 桶是私有的，CDN 回源 OSS 必须带鉴权，否则回源被拒。
- CDN 控制台 → 对应域名 → **回源配置** → 开启 **私有 Bucket 回源** → 按提示一键授权 CDN 用 RAM 角色读取私有 OSS
- 客户端仍携带 OSS 签名 URL；CDN 透传查询串给 OSS 验签，同时用自身角色回源拉取

### 1.5 HTTPS
- **证书管理** → 上传 acme 导出的证书（或申请 CDN 免费证书）→ 绑定到该域名
- 开启 **强制 HTTPS 跳转**（HTTP → HTTPS）

### 1.6 缓存配置（关键：省钱 + 安全，二者都要）
- **缓存过期时间**：图片/音频/视频统一 **30 天**（TTL `2592000` 秒）
- **缓存键 / 过滤参数**：**关闭「过滤参数」**，保留全部查询串（含 `x-oss-signature`、`Expires`）
  - ⚠️ 原因：聊天媒体是私有内容。若过滤参数，第一个合法签名用户触发回源后，缓存会被任何无签名请求命中 → 私有图变公开读（安全洞）。保留签名参数才能保持鉴权。
  - 例外：仅当后续切换为「CDN URL 鉴权」架构（服务端改签 CDN 鉴权 URL）时，才改为过滤参数。当前阶段**保留**。
- **Range 回源**：开启（视频/大图分段回源，减少回源字节）

### 1.7 视频/大图边缘优化（先跳过，避免冤枉钱）
- **自适应 WebP/AVIF**：**暂不开启**。前端已用 `x-oss-process=image/resize` 做缩略图，CDN 再转码是额外计费且重复处理。

### 1.8 防盗链（谨慎）
- **Referer 白名单**：建议「**允许空 Referer**」+ 仅放行你的域名；否则 App 原生端请求常不带 Referer 会被整批拦截。Referer 可伪造，仅作辅助，不做安全依据。
- **不要**开启「去掉 OSS 签名」类选项——会破坏私有鉴权。

---

## 2. 方案②：上传打 Cache-Control（代码改动，零成本降重拉）

客户端/CDN 重复拉取同一对象时，若对象带 `Cache-Control: public, max-age=...`，浏览器与 CDN 边缘都不再回源。

### 2.1 服务端对象（语音/归档/头像/收藏转发副本）
改 `IM-APP-server/internal/infra/oss.go`：

`PutObject`（L241 附近）：
```go
_, err := o.client.PutObject(ctx, &oss.PutObjectRequest{
    Bucket: oss.Ptr(o.cfg.Bucket), Key: oss.Ptr(key), Body: body,
    ContentLength:  oss.Ptr(size),
    ContentType:    oss.Ptr(contentType),
    ForbidOverwrite: oss.Ptr("true"),
    CacheControl:   oss.Ptr("public, max-age=86400"), // 新增：不可变媒体长缓存
})
```

`putArchive`（L269 附近）同样加 `CacheControl: oss.Ptr("public, max-age=86400")`。

> 仅对内容不可变的对象生效（语音/归档/头像一经写入不再变）。聊天图片由 OpenIM 写入，见 2.2。

验证：`go build ./...` + `go test ./internal/infra/...`，确认 `oss_test.go` 中 `PutObject` 相关用例仍通过。

### 2.2 聊天图片/视频（OpenIM 侧写入）
OpenIM 上传到 OSS 时设置对象 `Cache-Control`，需在 **OpenIM 服务的存储配置**中指定上传响应头（键名以 OpenIM 版本文档为准，典型位于 `config.yaml` 的 object/内部上传段）。目标值：`public, max-age=86400`。
- 仅对**新上传**对象生效；历史对象可在 OSS 控制台对 `chat/managed-v1/` 批量「设置 HTTP 头」，或用生命周期规则补充。
- ⚠️ 批量改历史对象前先小范围抽样验证不影响已签名 URL 访问。

---

## 3. 方案③：激活媒体 GC（零成本降存储 + 堵死流量）
> 已部署，仅需激活 + 验收，不写新代码。

1. 后端宝塔进入 `IM-APP-server` 目录，执行 GC 激活（参考 `deploy/openim-retention/OBJECT-GC.md` 与 `PRODUCTION.md:18`）：
   ```
   cleanup-production.py enable
   ```
2. 验收（`deploy/openim-retention/ACCEPTANCE.md`）：
   - [ ] 桶版本控制 = 未开启过
   - [ ] RAM 删除权限仅限 `chat/managed-v1/*` 前缀
   - [ ] 激活探针通过，`active=true`、`scheduleEnabled=true`
   - [ ] 返回 `groupRetentionMode=visibility_only`，范围 `im-app-production/chat/managed-v1/`
3. 每日北京时间 **03:30** 自动跑；关闭用 `cleanup-production.py disable`（不回滚已删、不恢复过期消息）。

---

## 4. 方案④：缩略图全量 + 视频流式（能力已具备，验证发版）
- **缩略图**：`feat/chat-image-speed` 已实现 `thumbUrl`（见 `ChatBubble.vue`、`utils/chatMedia.ts`、`stampOutgoingPicture`）；确认 **H5 与 App 两端都已发布到该分支**。列表只拉缩略图，点开才拉原图。
- **视频流式**：`utils/chatMediaVideo.ts` + `pages/chat/video-viewer.vue` 走 Range 流式播放；确认列表**不预下载**整段视频，仅拉封面（poster）。
- 这两项不花钱，但能把单图/单视频字节压到最低，是降量主力。

---

## 5. 验证与回滚

**验证 CDN 生效**
```bash
# 第一次（回源）
curl -s -o /dev/null -w '%{http_code} %{time_total}\n' "https://oss-chat-test.易可聊.com/<签名URL路径含参数>"
# 第二次（应命中边缘缓存，Server 变 Tengine/CDN，X-Cache: HIT）
curl -s -D - -o /dev/null "https://oss-chat-test.易可聊.com/<同上>" | grep -iE 'server|x-cache'
```
- OSS 控制台「用量」看回源流量下降；CDN 控制台看命中率与下行流量。

**回滚**
- CDN 控制台对该域名「**停用**」或删除加速域名，DNS CNAME 自动/手动回 OSS 端点。客户端签名 URL 域名不变，无感回退。

---

## 6. 成本对照（预期）

| 阶段 | 措施 | 预期效果 |
|---|---|---|
| 现状 | OSS 香港跨境直连 | 基准，最贵 |
| +① CDN | 边缘缓存 + 0.2 单价 | 月账单通常降 50%–90%（取决于重复访问比） |
| +② Cache-Control | 降重拉 | CDN 命中率进一步提升 |
| +③ GC | 删无引用 managed-v1 | 降存储费 + 堵死死流量 |
| +④ 缩略图/视频流式 | 降单次字节 | 图片流量压到 1/10，视频仅拉封面 |

---

## 7. 明确不做（反模式 / 冤枉钱）
- ❌ **桶迁内地 cn-hangzhou**：迁移成本（数据搬迁 + key 重写 + 停机）极高，单价只从 0.5–0.8 降到 ~0.5，不如直接上 CDN
- ❌ **媒体代理 `OSS_MEDIA_PROXY_URL`**：流量引到 ECS 带宽（~0.8/GB）比 CDN 还贵 + 双重付费；仅为连通性兜底
- ❌ **短链 / Referer 白名单去签名**：对私有聊天媒体是安全坑，且省不了钱
- ❌ **CDN 自适应 WebP/AVIF**：额外计费，与 `x-oss-process` 缩略图重复
- ❌ **缓存键过滤参数**：私有图变公开（见 1.6）

---

## 8. 未备案下的修订执行顺序（最省钱现实路径）

域名未备案 → 大陆 CDN 不可用。按「投入/收益」重新排序：

### 8.1 路径 A：先备案，再走 CDN（长期最省钱，~2–3 周）
- 你们已有**内地服务器** `8.154.44.197`（杭州），满足备案「接入内地服务器」要求
- 步骤：域名实名认证 → 在阿里云备案系统提交（管局审核通常 10–20 天）→ 备案通过后把 `oss-chat-test.易可聊.com` 解析/接入 CDN 大陆节点
- 备案完成后执行原方案①（1.2–1.8），拿到 ~0.2/GB 单价 + 边缘缓存，**同时修掉跨境 `ERR_CONNECTION_CLOSED`**
- 这是「最省钱」的终态，但需要等待期

### 8.2 路径 B：借用已备案域名（若你们另有已备案域名）
- 若名下有其他**已备案域名**，取其子域（如 `cdn.xxx-已备案.com`）CNAME 到 CDN，OpenIM `OSS_PUBLIC_BASE_URL` 改为该子域
- 省去备案等待，其余同方案①
- 注意：该域名需与业务主体一致，避免备案主体不符风险

### 8.3 路径 C：桶迁内地 cn-hangzhou（免 CDN/免备案，降单价 + 修连通性）
- 把聊天桶迁到 `cn-hangzhou`（内地），OSS 内地下行单价 ~0.5/GB（低于 HK 跨境 0.5–0.8）
- **额外收益**：不再跨境 → 解决之前截图里 `ERR_CONNECTION_CLOSED` 的跨境链路问题
- 免备案做法：迁桶后**不用自定义域名**，OpenIM `OSS_PUBLIC_BASE_URL` 直接用 OSS 默认主机 `yikeliao-188-*.oss-cn-hangzhou.aliyuncs.com`（OSS 默认主机不需域名备案）
- 代价：一次性数据搬迁 + key 重写 + OpenIM 配置改指向 + GC/版本控制重新验收，工作量最大
- 迁桶后若仍想上 CDN，自定义域名绑定内地 bucket 仍需备案（回到 8.1）

### 8.4 路径 D：只降量，不降单价（当前立即可做，零成本）
- 在「未备案 + 不迁移」期间，唯一能省钱的是**压流量体积**（单价仍是 HK 跨境贵）：
  1. **方案③ GC 激活**：删无引用 managed-v1，降存储 + 堵死流量
  2. **方案④ 缩略图全量 + 视频仅封面流式**：单图/单视频字节压到最低
  3. **客户端缓存**：前端已有 `mediaCache.ts`（IndexedDB 200MiB）/ `mediaCacheH5.ts`，确认 `canary` 已开、缓存上限够用，避免重复拉取
  4. **方案② Cache-Control**：服务端 `PutObject`/`putArchive` 加 `public, max-age`（对象元数据，CDN 无关，浏览器也能缓存）
- 效果：把账单体量压到最小，但**单位价格不变**，省幅有限（不如 CDN/迁桶）

### 推荐组合
- **现在就做 8.4（零成本，立刻见效）** + **并行启动 8.1 备案（等 2–3 周解锁 CDN）**
- 若等不了备案且能接受一次性迁移 → 选 **8.3 迁桶**（既降单价又修连通性）
- 海外 CDN 节点（无备案可开）对**内地用户几乎不省钱**，不推荐作为降本手段
