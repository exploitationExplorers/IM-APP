# CDN 配置详细操作（香港桶 + 已备案域名）

> 前置：你已有**内地 ICP 备案域名**。目标：把香港桶 `yikeliao-188-hk-test`（cn-hongkong）的聊天媒体，经 Aliyun CDN 大陆节点加速，单价从 OSS 跨境 ~0.5–0.8/GB 降到 CDN ~0.2/GB，并用边缘缓存吃重复流量。
> 关联策略文档：`docs/OSS下行优化方案-最省钱.md`（方案①）。

---

## 0. 改动总览（两个桶 = 两个 CDN 域名）

> 一个 CDN 加速域名只能绑一个源站桶。你有两个香港桶，原本就是两个独立子域，因此建**两个 CDN 加速域名**，各自指向对应桶。

| 桶 | 客户端域名（现状） | CDN 子域（新建） | 源站 OSS 端点 | 使用方 | 改哪 |
|---|---|---|---|---|---|
| 聊天桶 `yikeliao-188-hk-test` | `oss-chat-test.易可聊.com` | `oss-chat.whs188.xin` | `yikeliao-188-hk-test.oss-cn-hongkong.aliyuncs.com` | **OpenIM** | 服务器 OpenIM 配置 |
| 业务桶 `yikeliao-188-business-hk-test` | `oss-business-test.易可聊.com` | `oss-business.whs188.xin` | `yikeliao-188-business-hk-test.oss-cn-hongkong.aliyuncs.com` | **IM-APP-server** | 本仓库 `deploy/.env` |

| 层 | 改什么 | 在哪改 | 是否本仓库 |
|---|---|---|---|
| CDN 控制台 ×2 | 两个加速域名，各配 私有桶回源 + HTTPS + 缓存 | Aliyun CDN 控制台 | 否 |
| DNS ×2 | 两个子域各加 CNAME | 域名解析控制台 | 否 |
| OpenIM 配置 | 对象存储公开域名 → `oss-chat.whs188.xin` | 服务器 OpenIM 配置 | 否 |
| IM-APP-server | `OSS_PUBLIC_BASE_URL` → `oss-business.whs188.xin` | `deploy/.env` 或 `deploy/docker-compose.yml:180` | ✅ 本仓库 |

**说明**：
- 聊天媒体由 OpenIM 生成签名 URL，域名来自 OpenIM「对象存储公开域名」→ 走 chat CDN
- 业务媒体（头像/文件等）由 IM-APP-server 的 `OSS_PUBLIC_BASE_URL` 生成 → 走 business CDN
- **上传（PUT/POST）不走 CDN**：OpenIM 上传 URL、IM-APP-server 的 `OSS_PUBLIC_UPLOAD_URL` 保持直连 OSS 端点（CDN 只加速 GET/下载）

---

## 1. CDN 控制台：添加加速域名

1. 登录 **CDN 控制台**（cdn.console.aliyun.com）→ **域名管理** → **添加域名**
2. **加速域名**：填你的已备案子域，例如 `oss-chat.<你的已备案域名>.com`
   - 若沿用 `oss-chat-test.易可聊.com` 且该域现已备案，也可直接用
3. **加速区域**：选 **中国大陆**（仅服务内地用户时最便宜；有海外用户选「全球」）
   - ⚠️ 选「中国大陆」会校验域名备案；你已备案，通过
4. **业务类型**：**图片小文件**
5. **源站信息**：
   - 源站类型：**OSS 域名**
   - 源站地址：选 `yikeliao-188-hk-test.oss-cn-hongkong.aliyuncs.com`（选 OSS 桶，区域香港）
   - 端口：**443**
   - 回源协议：**HTTPS**
6. 提交，等待 **CNAME 未配置 → 已配置** 状态变化

---

## 2. CDN 控制台：私有 Bucket 回源（必做，否则 403）

> 桶是私有的。CDN 回源 OSS 必须带鉴权，否则回源被拒。开启后 CDN 用自身 RAM 角色拉取，客户端 OSS 签名 URL 直接透传即可（不受 Host 绑定影响）。

1. 域名管理 → 你的域名 → **回源配置**
2. 开启 **私有 Bucket 回源** → 按提示**一键授权** CDN 用 RAM 角色读取私有 OSS
3. 确认状态：已开启

---

## 3. CDN 控制台：HTTPS

1. 域名管理 → 你的域名 → **HTTPS 配置** → 开启 HTTPS
2. 证书：
   - 上传你 **acme-client** 已签发的 `<CDN子域>` 证书（PEM 格式），或
   - 申请 **CDN 免费证书**（需域名在阿里云且已备案）
3. **强制跳转**：开启 HTTP → HTTPS
4. 注意：证书 CN/SAN 必须覆盖你的 CDN 子域

---

## 4. CDN 控制台：缓存配置（关键：省钱 + 安全）

1. **缓存过期时间**：
   - 类型「文件后缀」，值：`jpg,jpeg,png,gif,webp,avif,bmp` → 过期时间 **30 天**
   - 类型「文件后缀」，值：`mp4,mov,webm,m4a,mp3,amr` → 过期时间 **30 天**
   - （或全局设 30 天）
2. **过滤参数**：**关闭**（保留全部查询串，含 `x-oss-signature`、`Expires`）
   - ⚠️ 原因：聊天媒体私有。过滤参数会把第一个合法签名用户触发的缓存，暴露给任意无签名请求 → 私有图变公开读。保留签名参数才安全。
   - 仅在后续切「CDN URL 鉴权」架构时才改过滤参数。
3. **Range 回源**：开启（视频/大图分段回源，减少回源字节）
4. **自适应 WebP/AVIF**：**暂不开启**（额外计费，且与前端 `x-oss-process` 缩略图重复）

---

## 5. DNS：子域 CNAME 到 CDN

1. 在你的域名解析控制台，给 CDN 子域添加 **CNAME** 记录：
   - 主机记录：`oss-chat`（或你的子域前缀）
   - 记录值：CDN 控制台给出的加速域名（形如 `*.kunlun.com` / `*.w.kunlun.com`）
2. 等待生效（通常几分钟，最多几小时）
3. 验证：
   ```bash
   nslookup oss-chat.<你的已备案域名>.com
   # 应解析到 CDN 节点 IP；CDN 控制台域名状态变为「已启用」
   ```

---

## 6. 应用侧：把客户端域名指向 CDN

### 6.1 OpenIM 对象存储公开域名（服务器侧，不在本仓库）
1. 登录服务器（宝塔 / OpenIM 部署目录），找到 **openim-server 的对象存储配置**（公开域名 / callback 域名项）
2. 将公开域名改为：`https://oss-chat.<你的已备案域名>.com`
3. 重启 `openim-server` 使配置生效
4. 验证：发一条新图片，消息里的 URL host = CDN 子域

### 6.2 IM-APP-server（本仓库）
改 `deploy/.env` 或 `deploy/docker-compose.yml:180`：
```
OSS_PUBLIC_BASE_URL=https://oss-chat.<你的已备案域名>.com
```
然后重建：
```bash
cd deploy
docker compose up -d --build --force-recreate api
```
> 必须 `--force-recreate`，否则 compose 认为配置未变会跑旧容器。

### 6.3 过渡说明
- 已签发且仍缓存在 MongoDB / 客户端的旧 URL（最多 10min~1h）继续有效，自然过期后新 URL 全部走 CDN 域名，无需手动刷。

---

## 7. 验证

**CDN 命中**
```bash
# 第一次（回源）
curl -s -D - -o /dev/null "https://oss-chat.<域名>/<带签名路径含参数>" | grep -iE 'server|x-cache|http/'
# 第二次（应 HIT，Server 为 Tengine/CDN 边缘）
curl -s -D - -o /dev/null "https://oss-chat.<域名>/<同上>" | grep -iE 'server|x-cache'
```
- 期望：`Server: Tengine` 或 CDN 标识；第二次 `X-Cache: HIT`
- OSS 控制台「用量」看**回源流量下降**；CDN 控制台看命中率与下行

**真机**
- 聊天发图 / 刷历史消息，DevTools Network 看请求 host = CDN 子域、状态 200、尺寸正常
- 视频：列表不整段下载，点击流式播放

---

## 8. 回滚

- **CDN 控制台**：对应域名「停用」或删除加速域名；DNS CNAME 改回 OSS 端点（或保留域名、停回源）
- **应用侧**：OpenIM 公开域名 + `OSS_PUBLIC_BASE_URL` 改回原 OSS 域名，重启
- 客户端签名 URL 域名随配置自然切换，无感回退

---

## 9. 安全与反模式清单

- [x] 桶版本控制 = 未启用（此前已确认；若开启/暂停，先评审版本回收，勿关版本避检）
- [x] RAM 权限已含 `DeleteObject` + `GetBucketVersioning`（GC 用，`deploy/oss-production/ram-production-policy.json`）
- [ ] 缓存键**保留签名参数**，不过滤（防私有图变公开）
- [ ] Referer 白名单若开，需「允许空 Referer」（App 原生端无 Referer），且不作为安全依据
- [ ] 不开「去 OSS 签名」、不开自适应 WebP（省钱 + 安全）
- [ ] 不开海外 CDN 节点当降本手段（对内地用户不省钱）

---

## 10. 成本预期

| 阶段 | 措施 | 预期 |
|---|---|---|
| 现状 | HK 桶跨境直连 | 基准，最贵 |
| 本方案 | CDN 大陆节点 + 香港桶 | 单价 ~0.2/GB + 边缘缓存吃重复流量，月账单通常降 50%–90% |
| 叠加 | GC 激活 + 缩略图全量 + 视频流式 + Cache-Control | 进一步压体积，命中率更高 |

---

## 11. 落地状态与实战结论（2026-10-21 更新）

### 11.1 状态

| 桶 | CDN 域名 | CDN 配置 | 应用侧切换 | 结果 |
|---|---|---|---|---|
| 业务桶 `yikeliao-188-business-hk-test` | `oss-business.whs188.xin` | ✅ 完成（私有桶回源 + HTTPS + 强制跳转 + 30 天缓存） | ✅ `OSS_PUBLIC_BASE_URL` 已改 | ✅ **已生效**：新头像 URL `https://oss-business.whs188.xin/im-app-production/business/avatars/...jpg`（无签名），`curl` 得 `200` + `X-Cache: HIT TCP_MEM_HIT` + `Via: kunlun1.cn9614` |
| 聊天桶 `yikeliao-188-hk-test` | `oss-chat.whs188.xin` | ✅ 完成（探针对象实测 `200` + `X-Cache: HIT` + `Via: kunlun4.cn9614`） | ❌ **已回滚** | OpenIM v3.8.3 无法干净拆分上传/展示域名，见 11.3 |

### 11.2 生产环境改动位置（重要，与 §6.2 不同）

- **overlay 才是唯一生效位置**：`/root/im-app-oss-production/oss-production-bundle/private/api.compose.json`（不进 Git）。它作为最后一个 `-f` 叠加，**会覆盖 `.env`** —— overlay 里 `OSS_PUBLIC_BASE_URL` 原本是空串，导致在 `.env` 里填值无效。
- **重建必须用 `dc-api`**（基座 compose + overlay 的包装命令）：
  ```bash
  dc-api up -d --no-deps --no-build --pull never --force-recreate api
  ```
  裸 `docker compose up api` 会丢 overlay → OSS 值全空 → 容器无限重启（报错字段每次不一样，是 `infra/oss.go:41` 用 Go map 随机遍历导致的假象）。
- 服务器上的 `deploy/docker-compose.yml` 比仓库旧一大截（缺整段 OSS 映射），暂不同步，靠 overlay 兜底即可。
- GC 白名单同步：**必须**把新 CDN 域名加进 `MEDIA_SOURCE_URL_PREFIXES`（新老共 4 个前缀），否则 GC 认不出新域名下的对象。

### 11.3 聊天桶（OpenIM）为什么切不动

- 配置位置：`/root/im-app-oss-production/oss-production-bundle/private/openim-rpc-third.yml`（**ro 挂载**进 `openim-api`，改宿主机文件 + `docker restart openim-api` 生效）。
- 尝试：`bucketURL` → `https://oss-chat.whs188.xin` + `publicRead: true`。结果 **App 发图失败**（Network 里没有任何 `oss-chat` 请求）→ 已回滚为 `bucketURL=https://oss-chat-test.易可聊.com`、`publicRead: false`。
- 根因：OpenIM v3.8.3 的 `object.oss.bucketURL` **同时充当上传签名域名 + 展示域名**，改成 CDN 域名后上传 PUT 被打到 CDN（CDN 不转发 PUT）。且该版本 `publicRead` 行为不可靠（官方 issue #2598 同款）。
- 收益判断：chat 下载**本来就直连 OSS**，只有 302 经过 OpenIM，**CDN 收益远小于 business**（business 原来走 `oss-media` 代理，吃 ECS 带宽，已修）。
- 📌 **结论（2026-10-21 更新）**：一期已选定「nginx 网关」路线落地 —— **签名上传继续走 OSS，对外访问统一走 CDN**，详见 `docs/聊天桶CDN接入-nginx网关.md`（配置 `deploy/nginx/oss-chat-gateway.conf`、巡检 `deploy/verify-chat-gateway.sh`）。
- 收益重估：截图实测聊天桶当月 **170.93 GB / 154 万次请求**（几乎全是香港桶外网流出，≈1 元/GB → 月百元级），比业务桶 68 GB 大得多，**聊天桶才是流量成本大头**，一期收益 ≈ 65%。
- 二期仍备三个选项：① 升级 OpenIM 看是否已拆分上传/展示域名 ② 改 OpenIM 源码彻底拆分 ③ 保持 nginx 网关。

### 11.4 补充约束（踩过的坑）

- **打 CDN 的 URL 必须不带 OSS 签名**：CDN 私有桶回源会自带 `Authorization` 头，与 URL 里的 `Signature` 参数互斥 → OSS 返回 `400 InvalidArgument`。这与 `infra/oss.go FileURL(L111)` 天然一致（走 `PublicBaseURL` 返回的是无签名串）。
- `docker restart openim-api` 会让客户端 WS 断连，浏览器报 `network error (login errCode=10000)`，**刷新重登即可**，不是故障。
- 历史消息里的 `oss-media?key=&token=` 代理 URL 继续有效（`OSS_MEDIA_SIGNING_KEY` 未变），不需要迁移。

### 11.5 与 CDN 共存的两条硬规则（代码侧）

**① 对象元数据禁止出现 `private` / `no-cache` / `no-store`**

阿里云 CDN 把源站返回的这三个指令视为「不缓存」，且**优先级高于控制台任何缓存规则**——控制台配的 30 天会被推翻，所有请求回源：

| 源站 Cache-Control | CDN 行为 |
|---|---|
| `private, max-age=31536000, immutable` | ❌ 不缓存，全量回源 |
| `public, max-age=31536000, immutable` | ✅ 按 1 年原样缓存 |
| 无 Cache-Control | 跟随控制台规则（当前的 30 天后缀规则） |

> 只对 HTML 等动态内容才用 `private`；OSS 对象（UUID key + `x-oss-forbid-overwrite`）是天然不可变的，`public + immutable` 是最优解。

**② `x-oss-process` 可以穿透 CDN**，这是 CDN 模式下唯一的出图手段

- 实测：`?x-oss-process=image/resize,w_128/quality,q_70/format,webp` 走 CDN → `200 image/webp`，**1634 字节 vs 原图 7087 字节（省 77%）**
- ⚠️ 语法坑：质量参数必须写 `quality,q_70`；只写 `q_70` 会被 OSS 判为 **`400 InvalidArgument`**
- ⚠️ 架构坑：`OSS_PUBLIC_BASE_URL` 指向 CDN 后，业务图 URL 从「签名代理」变成「直链」，**原先靠服务端 `?variant=` 才能出图的逻辑会静默失效**（请求不再经过代理）。必须让前端对未签名的业务桶直链自行追加 `x-oss-process`（见 `IM-APP-fronend/src/utils/chatMediaUrl.ts` 的 `withPublicImageProcess`）
- CDN 缓存键保留参数，所以每种规格各自缓存一份，没问题
