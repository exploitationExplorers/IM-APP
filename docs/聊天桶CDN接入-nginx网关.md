# 聊天桶 CDN 接入：nginx 网关方案（一期）

> 目标一句话：**签名上传继续走 OSS，对外访问统一走 CDN。**
> 不需要动 OpenIM 源码，不需要重建 openim 镜像，回滚只要改一行 + restart。
> 配套 nginx 配置：`deploy/nginx/oss-chat-gateway.conf`
> 配套巡检脚本：`deploy/verify-chat-gateway.sh`
> 背景与业务桶章节：`docs/CDN配置-香港桶-详细操作.md` §11

---

## ⛔ 2026-10-21 20:20 重要更正（先读这段，再决定要不要按本文操作）

本文的网关路线**方向有误，已不再推荐**。两个原因：

1. **`bucketURL` 只管上传，下载根本不经过它。**
   `tools@v0.0.50-alpha.106/s3/oss/oss.go` 里 `o.bucketURL` 全篇只用 3 处，
   全是上传（`PartSize` / `AuthSign` / `InitiateFormData`）。
   **下载走 `AccessURL` → `o.bucket.SignURL()`，用的是 SDK 的 `Endpoint`**（被门禁钉死为
   `oss-chat-test.易可聊.com`），完全不读 `bucketURL`。
   ⇒ 把 `bucketURL` 切成网关域名，就算门禁不拦，**也只是让上传绕道 ECS，下载照样直连 OSS 原价**，
   一分钱 CDN 收益都拿不到。

2. **网关方案要新增一张域名证书 + 让 ECS 成为聊天媒体的单点**（ECS 挂 = 聊天图全挂）。

### ✅ 改用方案 B：改 `AccessURL` 让它直接吐 CDN URL

让 OpenIM 返回给客户端的下载地址直接变成
`https://oss-chat.whs188.xin/im-app-production/chat/<key>?x-oss-process=image/resize,m_lfit,w_360,h_360,format,webp`。

| | 网关方案（本文） | **方案 B（推荐）** |
|---|---|---|
| 新证书 | 需要 1 张 | **0 张** |
| ECS 单点 | 有 | **无**（一次跳转都不过 ECS） |
| DNS 改动 | 需要 | **无** |
| 动 `bucketURL` | 需要 | **不需要**（门禁不会触发） |
| 重建 openim 镜像 | 不需要 | **需要** |

**代码已完成**（`deploy/oss-production/openim-scope/`，单测全绿）：
- `scope.go`：`New()` 第 3 个参数为 CDN 基址；`normalizeCDNBase()` 校验；
  `AccessURL()` 输出「CDN 基址 + 物理 key + 图片处理参数」
- 🔑 **安全兜底**：CDN 基址为空（或纯空白）时，`AccessURL` **逐字节回退**到上游的签名直链，
  行为与不打补丁时完全一致 —— 少配一个环境变量不会让 `openim-rpc-third` 起不来
- **上传链路不受影响**：`PresignedPutObject` / `AuthSign` / `FormData` 仍走上游签名直链（有单测锁定）

**上线方式**：给 `openim-api`（及 `openim-rpc-third`）容器加环境变量

```bash
IM_APP_CHAT_CDN_BASE=https://oss-chat.whs188.xin
```

**没配 / 配置错了会自动回退到今天的直连 OSS 行为**，属于可灰度、可秒级回退的改动。

---

## 0. 为什么必须加一层网关

### 落地进度（2026-10-21 16:00）

| 步骤 | 状态 |
|---|---|
| DNS A 记录 `oss-chat-gw` → `8.154.44.197` | ✅ 已加 |
| 免费证书 `oss-chat.whs188.xin`（含 www SAN，至 2027-01-22） | ✅ 已签发 |
| 免费证书 `oss-business.whs188.xin`（含 www SAN，至 2027-01-22） | ✅ 已签发 |
| 免费证书实例 `instance-cpgq2lkw81`（给 `oss-chat-gw`） | ⏳ 待申请（要补填域名并提交） |
| OSS 桶绑定 `oss-chat-gw.whs188.xin` | ⏳ 验证中：已加 `_dnsauth.oss-chat-gw` TXT（16:16），但首次验证报 `NeedVerifyDomainOwnership`（0018-00001115）——**弹窗每次打开会重新生成 token，要用「复制值」里当前那个值更新 TXT 再验** |
| CDN `oss-chat.whs188.xin` 复核（私有桶回源/缓存/HTTPS 绑证书） | ❓ 待核对 |
| nginx 网关上线 | ❌ 未做 |
| OpenIM 切 `bucketURL` | ❌ 未做 |


OpenIM v3.8.3 只有 `object.oss.bucketURL` **一个**字段，同时当「上传签名域名」和「下载展示域名」。而 CDN 域名不能当 `bucketURL`：

| 阻塞点 | 后果 |
|---|---|
| CDN 不转发 PUT/POST | 改了就**发不了图/视频**（2026-10-21 上午实测已回滚过一次） |
| 带 `Signature` 的 URL 走 CDN 私有桶回源 | OSS 返回 `400 InvalidArgument`（CDN 会自带 `Authorization` 头，与 `Signature` 参数互斥） |
| CDN 域名的 CNAME 锁死指向 kunlun 边缘 | 一个域名不可能既走 CDN 又落到 OSS/nginx |

结论：**加一个网关域名承担 `bucketURL`，由它按「是否写请求 / 是否带签名」把流量分两条腿。**

```
              ┌────────────────────── 上传 + 签名直 Oss 请求 ─────────────────┐
              │                                                              │
客户端 ──→ oss-chat-gw.whs188.xin (A → ECS 8.154.44.197, nginx) ──→ yikeliao-188-hk-test.oss-cn-hongkong.aliyuncs.com
              │                                                          (私桶)
              └── GET/HEAD（剥掉 OSS 签名参数）── 302 ──→ oss-chat.whs188.xin (CDN, 已配好)
                                                              │
                                                              └─ 回源鉴权 ──→ ↑ 同一个桶
```

**成本收益**：聊天桶当月 **170.93 GB / 154 万次请求**，几乎全是香港桶外网流出（≈1 元/GB，月度百元级）。切 CDN 后 ≈ **0.34 元/GB**，按 90% 命中率算约 **58 元/月，省 ~65%**。是当前全链路最大的一笔可省成本。

---

## 1. 前置检查（先跑一遍，确认现状）

```bash
# 1) OpenIM 当前配置（只读）
docker exec openim-api cat /openim/etc/openim-rpc-third.yml 2>/dev/null | grep -A6 "oss:" | grep -E "bucketURL|publicRead|endpoint"

# 2) 现网 chat 域名解析参照（网关域名要照着这个套路配）
dig +short oss-chat-test.xn--jprz53bj9s.com
dig +short oss-chat.whs188.xin

# 3) nginx 配置目录 / 现有证书路径
nginx -V 2>&1 | tr ' ' '\n' | grep -m1 "^--conf-path"
grep -rn "include" /etc/nginx/nginx.conf | grep -E "conf.d|vhost"
grep -rl "whs188.xin" /www/server/panel/vhost/nginx/*.conf 2>/dev/null | xargs grep -m1 ssl_certificate
```

期望输出：现有 `bucketURL=https://oss-chat-test.易可聊.com`、`publicRead: false`（回滚后的正确状态）。

---

## 2. 步骤一：DNS（新增一条 A 记录，1 分钟）

| 主机记录 | 类型 | 记录值 |
|---|---|---|
| `oss-chat-gw` | A | `8.154.44.197` |

> 不是买新域名，主域 `whs188.xin` 已备案，**子域名无需单独备案**，也不需要新增证书（复用 `*.whs188.xin` 通配符）。

验证：

```bash
dig +short oss-chat-gw.whs188.xin    # 期望 8.154.44.197
```

---

## 3. 步骤二：OSS 桶绑定网关域名（必做）

路径：OSS 控制台 → 桶 `yikeliao-188-hk-test` → **传输管理 → 域名管理 → 绑定域名** → 填 `oss-chat-gw.whs188.xin`。

- 因为 A 记录指向 ECS 而不是 OSS 的 CNAME，控制台可能提示「未检测到 CNAME / 归属校验」，按提示加一条 TXT 记录完成校验即可；
- TLS 证书**不用**在 OSS 上配（由 nginx 提供）；
- 不绑定的后果：`bucketURL` 换过去以后 → 透传时 Host 不被识别 → `SignatureDoesNotMatch` / `Bucket not found`，**发图直接挂**。

---

## 4. 步骤三：CDN 域名复核（`oss-chat.whs188.xin` 你已建好，核对 4 项）

| 配置项 | 要求 | 为什么 |
|---|---|---|
| **私有 Bucket 回源** | ✅ 必须开启 | 桶是私有的，没它 CDN 回源 403。开了之后 `Authorization` 由 CDN 自己签，因此**客户端 URL 必须无签名**——这正是网关要剥掉签名的原因 |
| **回源地址** | OSS 源站 `yikeliao-188-hk-test`，回源 Host = OSS endpoint | 别写错成桶的另一域名 |
| **缓存策略** | 图片/视频后缀 + 全部路径，**缓存 1 年**，权重最低兜底 | 对象 key 是 UUID + `x-oss-forbid-overwrite`，天然不可变 |
| **HTTPS** | 开启 + 强制跳转 | 与已配好的一致 |

⚠️ 不要再回头把业务桶那套 `q_70` 之类语法套这里；聊天图的缩放走 **OpenIM `/object/<key>?type=image&width=&format=`**（302 到 `bucketURL`），不经 `x-oss-process`。

⚠️ **忽略参数**：不用开。网关已经把签名剥干净，剩下来到 CDN 的 URL 参数很少且稳定；开了反而可能把有语义的参数搞丢。

---

## 5. 证书：只为网关域名拿一张（三种方式选一）

⚠️ 先说结论：**阿里云免费 DV 证书只支持单域名、不支持通配符**（每自然年 20 张额度，免费用不完）。下面的决策按「只覆盖 `oss-chat-gw.whs188.xin`」为准。

| 方案 | 成本 | 有效期 | 适用场景 | 推荐度 |
|---|---|---|---|---|
| **A. 阿里云免费 DV 单域名** | 0 元 | ~3 个月（需手动重签） | 只需要网关这一个域名 | ⭐⭐⭐ 最快：两条 CDN 域名已经在 CDN 控制台单独配过证书，本机只缺网关这一张 |
| **B. Let's Encrypt 通配符（acme.sh + DNS API）** | 0 元 | 90 天，**自动续期** | 以后还会加 `xxx-gw` 之类子域名 | ⭐⭐⭐⭐ 一劳永逸 |
| C. 阿里云付费 DV / OV 通配符 | ￥几百~2000+/年 | 按年 | 有商务/审计要求 | ⭐⭐ 非必需 |

### A. 阿里云免费 DV 单域名（2 分钟）

1. 数字证书管理服务 → SSL 证书 → **免费证书 → 创建证书** → 域名填 `oss-chat-gw.whs188.xin`
2. 验证方式选 **DNS**（控制台自动帮你加一条 `_dnsauth` TXT；若域名在别的账号，就手动去那边加）
3. 签发后**下载 nginx 版**（得到 `xxx.pem` / `xxx.key`）→ 传到服务器：

```bash
mkdir -p /www/server/panel/vhost/cert/oss-chat-gw
# fullchain -> cert.pem, 私钥 -> key.pem
nginx -t && nginx -s reload
```

### B. Let's Encrypt 通配符 `*.whs188.xin`（推荐，零成本 + 自动续期）

```bash
# 1) 在阿里云 RAM 里新建一个「只带 AliyunDNSFullAccess」的子用户，拿它的 AK（不要复用 OSS/CDN 的 AK）
# 2) 装 acme.sh 并签发（DNS-01 自动加删 TXT，不需要放行任何端口）
curl https://get.acme.sh | sh -s email=admin@whs188.xin
source ~/.bashrc
export Ali_Key="<RAM子用户ID>" Ali_Secret="<RAM子用户Secret>"
acme.sh --set-default-ca --server letsencrypt
acme.sh --issue --dns dns_ali -d whs188.xin -d '*.whs188.xin' --dnssleep 60

# 3) 装到固定路径 + 自动 reload（装完自带 cron，每 60 天自动续）
acme.sh --install-cert -d whs188.xin \
  --key-file       /www/server/panel/vhost/cert/whs188.xin/privkey.pem \
  --fullchain-file /www/server/panel/vhost/cert/whs188.xin/fullchain.pem \
  --reloadcmd      "nginx -s reload"
```

要点：

- 通配符 `*.whs188.xin` **不覆盖裸域** `whs188.xin`，所以上面把根域一起签了；
- CDN 侧域名（`oss-chat.whs188.xin` / `oss-business.whs188.xin`）若也想用同一张通配符，到 **CDN 控制台 → 证书管理 → 上传自有证书**（fullchain + key）再绑定即可，CDN 的免费证书同样不支持通配；
- 若域名账号与 CDN 账号不同也没关系，DNS-01 只要在**域名所在的解析账号**上有写权限即可。

---

## 6. 步骤四：上 nginx 网关

```bash
# 建议路径（宝塔）
mkdir -p /www/server/panel/vhost/nginx
cp /www/wwwroot/deploy/nginx/oss-chat-gateway.conf /www/server/panel/vhost/nginx/oss-chat-gw.conf

# 非宝塔标准 nginx
# cp /www/wwwroot/deploy/nginx/oss-chat-gateway.conf /etc/nginx/conf.d/oss-chat-gateway.conf

# ⚠️ 从 Windows 传上来的文件必须去 CRLF，否则 nginx -t 报 unknown directive
sed -i 's/\r$//' /www/server/panel/vhost/nginx/oss-chat-gw.conf

# 改证书路径（第 6 节之外唯一需要手改的地方）
#   ssl_certificate     → 现有 whs188.xin 的 fullchain.pem
#   ssl_certificate_key → 现有 whs188.xin 的 privkey.pem

nginx -t && nginx -s reload
```

配置逻辑（详见文件内注释）：

| 请求特征 | 处理 |
|---|---|
| **PUT / POST / DELETE**（所有非 GET/HEAD） | `limit_except` 里 `proxy_pass` 直连 OSS，**保留原始 Host** |
| **GET/HEAD 且 URL 带 OSS 签名参数** | 剥掉全部 query（`302 → https://oss-chat.whs188.xin$uri`），交 CDN |
| **GET/HEAD 无签名** | 原样 `302 → https://oss-chat.whs188.xin$request_uri` |

两个易踩的点已在文件里处理：

- `proxy_set_header Host $host;` —— **不能**改成 OSS endpoint，V4 签名把 Host 计入签名串，改了就验签失败；
- `resolver` + `set $oss_endpoint` 变量式 `proxy_pass` —— OSS 域名 IP 会轮换，写死会导致某天连不上。

---

## 7. 步骤五：OpenIM 切换 `bucketURL`

```bash
cp /root/im-app-oss-production/oss-production-bundle/private/openim-rpc-third.yml \
   /root/openim-rpc-third.yml.bak-$(date +%Y%m%d-%H%M%S)

sed -i 's#bucketURL: .*#bucketURL: https://oss-chat-gw.whs188.xin#' \
  /root/im-app-oss-production/oss-production-bundle/private/openim-rpc-third.yml

grep -A6 "oss:" /root/im-app-oss-production/oss-production-bundle/private/openim-rpc-third.yml | grep -E "bucketURL|publicRead"

docker restart openim-api
docker logs --since 5m openim-api 2>&1 | grep -iE "panic|error|SignatureDoesNotMatch" | head
```

`publicRead` 保持 `false`。重启会让已连接客户端 WS 断开，浏览器报 `network error (login errCode=10000)` 属**预期**，刷新重登即可。

---

## 8. 验收清单（按顺序打勾）

```bash
cd /www/wwwroot/deploy && bash verify-chat-gateway.sh              # 巡检（只读）
CHAT_KEY=path/to/known-object.jpg bash verify-chat-gateway.sh      # 带已知对象 key 做全链路
```

| # | 验收项 | 期望 | 判定依据 |
|---|---|---|---|
| 1 | 网关健康检查 | `GET /gw-health` → `200 ok` | nginx 起来了、TLS 正常 |
| 2 | **上传回归（最关键）** | 真机发一张图 → `PUT https://oss-chat-gw.whs188.xin/...` → **200，`Server: AliyunOSS`** | DevTools Network；失败立刻回滚第 6 节 |
| 3 | 下载走 CDN | 浏览器打开 `https://oss-chat-gw.whs188.xin/<key>` → **302** → `https://oss-chat.whs188.xin/<key>` → **200 + `X-Cache: HIT` + `Via: kunlun*`，第二次 `Age` 递增** | DevTools / curl |
| 4 | 签名剥离 | 带 `?OSSAccessKeyId=&Expires=&Signature=` 的 URL 打网关 → 302 目标**不带任何 query** | curl `-I` 看 `Location` |
| 5 | OpenIM 无回源报错 | `docker logs --since 10m openim-api` 无 `SignatureDoesNotMatch / InvalidArgument / 403` | 见 §10 排障表 |
| 6 | **历史消息回归（次日必查）** | 老聊天图片照样能看 | 见 §11 说明 |
| 7 | 成本见效 | 3–7 天后：OSS 桶「数据监控」里**外网流出曲线塌陷、CDN 回源曲线升起**；月度下行量从 170 GB 高位下滑 | 阿里云控制台 |

---

## 9. 回滚（30 秒，和上次回滚一模一样）

```bash
cp /root/openim-rpc-third.yml.bak-<时间戳> \
   /root/im-app-oss-production/oss-production-bundle/private/openim-rpc-third.yml
docker restart openim-api
```

只回滚这一处即可（nginx 网关留着无害，没人再请求它）。

---

## 10. 排障对照表

| 现象 | 根因 | 处理 |
|---|---|---|
| 发图失败，Network 里没有 `oss-chat-gw` 请求 | `bucketURL` 没生效 / openim-api 没重启成功 | `docker exec openim-api grep bucketURL /openim/etc/openim-rpc-third.yml` |
| PUT → `SignatureDoesNotMatch` | **网关域名没绑到 OSS 桶**，或 Host 被改写了 | 补齐 §3；确认 `proxy_set_header Host $host;` |
| PUT → `400 / 411` | `proxy_request_buffering off` 与 OSS chunked 交互问题 | 改成 `on` 再 reload |
| 下载 403 | CDN「私有 Bucket 回源」没开 | §4 第 1 项 |
| 下载 400 `InvalidArgument` | URL 里还带 `Signature` 就打到 CDN 了 | 检查 `$oss_signed` map 是否漏了某个签名参数名 |
| 请求偶尔全部失败 | OSS endpoint IP 轮换 | 确认配置里 `resolver` + 变量式 `proxy_pass` 在用，不要写死 IP |
| `nginx -t` 报 unknown directive | 文件有 CRLF / `map` 被放进了 `server{}` | `sed -i 's/\r$//'`；`map` 必须在 http 上下文 |

---

## 11. 已知副作用（认了再上）

1. **签名被剥离**：网关把 OSS 签名剥掉后交 CDN，**任何拿到该 URL 的人可以长期拉取**（不再有过期时间）。聊天图的 key 是随机 UUID、且接收方本来就持有该 URL，实际风险可控；若要收紧，二期可在 CDN 侧开 **URL 鉴权**（届时客户端必须能自行签名，属于前端改造，另议）。
2. **只对「新 URL」生效**：消息体里存的是 OpenIM 生成时的完整 URL，**历史消息里的 `oss-chat-test.易可聊.com` 直链不会被改写**，会继续吃 OSS 外网流出（且这些链接本身也可能已过签名有效期）。建议：**先上线观察 3–7 天**，再看是否需要用迁移脚本改写历史 URL。
3. **nginx 成新单点**：网关挂了 = 新消息图全都发不了。备份方案就是 §9 秒级回滚到直连 OSS。
4. **ECS 出网带宽**：只承担 上传数据 + 302 前的握手，**图片内容本体由 CDN 边缘返给客户端**，不吃 ECS 带宽。

---

## 12. 二期（彻底方案）

改 OpenIM 源码，把 `object.oss` 拆成 `bucketURL`（上传签名）和 `publicURL`（展示）两个字段，从此不需要网关跳一次 302、也不需要绑第三方域名到桶上。代价是要重建 openim 镜像，必须保住已有的 **retention bridge 定制**（见 `deploy/openim-retention/`）。在一期收益验证之后排期。

---

## 13. 附录：阿里云控制台逐项点击清单（2026-10-21 实操版本）

### A. 给 `oss-chat-gw.whs188.xin` 申请免费证书

1. 控制台顶部搜索框输 `SSL证书` → 进 **数字证书管理服务**
2. 左侧：**证书管理 → SSL 证书管理**；顶部 tab 选 **个人测试证书（原免费证书）**
3. 列表里找 `instance-cpgq2lkw81` 那行 → 右侧点 **申请**（不是「创建证书」）
4. 申请表单：
   - 证书类型：**免费 DV / 单域名**（默认）
   - 域名：`oss-chat-gw.whs188.xin`（自动生成 `www.` SAN，保留即可）
   - 验证方式：**手工 DNS 验证**（跨账号只能手写 TXT；同账号可选自动 DNS 验证）
   - CSR：**系统自动生成**（别选上传）
   - 联系人按默认 → 勾协议 → 提交审核
5. 状态变「待完善挑战认证」后，页面给出 **主机记录 `_dnsauth.oss-chat-gw` + 记录值** → 点到复制
6. 切到**域名账号** → 云解析 DNS → `whs188.xin` → **把已有的 `_dnsauth.oss-chat-gw` 那条 TXT 的记录值改成第 5 步复制的值**（别新增，避免多值干扰）→ 等 2 分钟
7. 回到证书控制台点 **验证/校验证书** → 数分钟后状态变成 **已签发**
8. 点 **下载** → 服务器类型选 **Nginx** → 得到 `xxx.pem`（含中间链）+ `xxx.key`
9. 传到 ECS：`/www/server/panel/vhost/cert/oss-chat-gw/fullchain.pem`、`privkey.pem`

> 改 TXT 后建议用命令行核对（控制台表格会把值截断，肉眼对不出最后几位）：
> `nslookup -type=TXT _dnsauth.oss-chat-gw.whs188.xin dns9.hichina.com`

### B. CDN 控制台复核 `oss-chat.whs188.xin`

1. 搜索 `CDN` → **CDN 控制台** → 左侧 **域名管理** → 点域名 `oss-chat.whs188.xin`
2. **回源配置**
   - 源站信息：OSS 域名 `yikeliao-188-hk-test...`（已填就不用动）
   - ⚠️ **私有 Bucket 回源 / OSS私有Bucket回源：开启**（不开的话下载一定 403）；弹出 RAM 授权就点「同意/校验」
   - 回源 Host：保持「回源站点域名 / 默认」
   - 保存
3. **缓存配置**（左侧「缓存配置」或「性能优化 → 缓存配置」）
   - 新增规则：**文件后缀** = `jpg,jpeg,png,gif,webp,bmp,mp4,mov,m4a,mp3`，**过期时间 = 1 年（31536000 秒）**
   - 再兜底一条「全部文件」→ 1 年，权重最低
   - ⚠️ **不要勾「忽略 URL 参数 / 参数过滤」** —— 聊天图预览以后可能用 `x-oss-process`，忽略参数会让不同尺寸共用一份缓存，返回错误尺寸
4. **HTTPS 配置**
   - HTTPS 证书 → 选择已有证书 `oss-chat.whs188.xin`（列表里没有就先在**这个账号**申请同一域名，或走 §5B 上传自有证书）
   - **强制跳转 HTTPS：开启**；HTTP/2：开启
5. **OSS 侧」CDN 缓存自动刷新**：回到 OSS → chat 桶 → 域名管理 → `oss-chat.whs188.xin` 那行 → 点「未开启」→ 开启并勾 **删除时刷新 + 覆盖上传时刷新**（GC 删对象后边缘立即清缓存）

### C. ECS：`nginx` 网关上线

> 下面所有 `/www/...`、`/root/...` 路径都是 **ECS 服务器（8.154.44.197）上的路径**，不是本地电脑，也不是 Windows 路径。
>
> `oss-chat-gateway.conf` 里只有两行需要按实际位置改：
>
> | 配置项 | 含义 | 常见位置 |
> |---|---|---|
> | `ssl_certificate` | 证书 fullchain（含中间 CA 链） | 宝塔：`/www/server/panel/vhost/cert/oss-chat-gw/fullchain.pem`；非宝塔：`/etc/nginx/ssl/oss-chat-gw/fullchain.pem` |
> | `ssl_certificate_key` | 私钥（**绝不能提交到 Git**） | 同一目录下 `privkey.pem` |

```bash
# 1) 建目录并放证书（宝塔就用下面的路径，非宝塔改成 /etc/nginx/ssl/oss-chat-gw）
mkdir -p /www/server/panel/vhost/cert/oss-chat-gw
# fullchain.pem / privkey.pem 放进去 —— 用宝塔「文件」管理器上传，或 scp/sftp 传上来

# 2) 核对证书签名到域名
openssl x509 -in /www/server/panel/vhost/cert/oss-chat-gw/fullchain.pem -noout -subject -dates
#    期望 subject 里有 oss-chat-gw.whs188.xin，notAfter = 2027-01-22 左右（免费 DV 92 天）

# 3) 上配置
cp /www/wwwroot/deploy/nginx/oss-chat-gateway.conf /www/server/panel/vhost/nginx/oss-chat-gw.conf
sed -i 's/\r$//' /www/server/panel/vhost/nginx/oss-chat-gw.conf
# 改 ssl_certificate / ssl_certificate_key 两行为上面两个文件
nginx -t && nginx -s reload
curl -i https://oss-chat-gw.whs188.xin/gw-health        # 期望 200 ok
```

### D. ECS：切换 OpenIM `bucketURL`

```bash
cp /root/im-app-oss-production/oss-production-bundle/private/openim-rpc-third.yml \
   /root/openim-rpc-third.yml.bak-$(date +%Y%m%d-%H%M)
sed -i 's#bucketURL: .*#bucketURL: https://oss-chat-gw.whs188.xin#' \
  /root/im-app-oss-production/oss-production-bundle/private/openim-rpc-third.yml
docker restart openim-api
bash /www/wwwroot/deploy/verify-chat-gateway.sh
```

最后一步必须是**真机发一张图**，Network 里确认 `PUT https://oss-chat-gw.whs188.xin/...` = `200` + `Server: AliyunOSS`。
