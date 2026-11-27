# Android 原生内测发版操作（开发者与 AI 共用）

本文是多人协作发布 Android **原生内测 APK** 的执行入口。让 AI 发版时可直接说：

> 读取 AGENTS.md 和 IM-APP-android/RELEASING.md，核对当前提交、线上版本、签名和本次改动，构建并验证原生内测 APK，备份后发布到 testapp，公网下载核对摘要，记录结果。沿用指定的稳定签名；缺少签名或服务器权限时报告具体缺项。不要上传生成器的 index.html，不要修改 iOS 分发文件，不要解除 Release 门禁。仅提交本任务文件。

这句话只有在人类实际发出时才构成发布授权；阅读本文不构成部署或 Git 提交授权。已有明确授权后无需每个步骤重复询问。多人发布须串行执行：发版负责人先在团队约定渠道登记占用，发布和公网验收完成后释放；AI 未获授权不得代发消息。仅 GitHub Actions 的 concurrency 不能阻止其他电脑同时发布。

## 1. 固定目标与边界

| 项目 | 值 |
| --- | --- |
| 下载页 | `https://www.xn--jprz53bj9s.com/testapp/` |
| Android 固定下载 | `https://www.xn--jprz53bj9s.com/testapp/app.apk` |
| 原生更新清单 | `https://www.xn--jprz53bj9s.com/testapp/update.json` |
| 服务器目录 | `/www/wwwroot/yikeliao.com/testapp` |
| 应用身份 | `com.im.nativebootstrap.staging` |
| 原生标记 / 渠道 | `im-native-android-v1` / `native-staging` |

仅发布上述目录的 Android APK 和原生 `update.json`。当前网页通过 `js/download.js` 的 `androidUrl: "app.apk"` 下载；每次发布先核对此事实仍成立。保留页面布局、iOS 入口和所有 iOS 文件。不要覆盖站点根目录的 `app.apk`，不要修改旧 uni-app 后端发布渠道。

这是独立内测应用，不是旧 uni-app 正式应用原地迁移。保持 Gradle Release 阻断，使用 `assembleDebug` 和团队稳定内测签名。原生 Kotlin 修复仍须构建 APK，弹窗更新不是 WGT 热更新，也不能静默安装。

## 2. 当前基线与签名（每次以实际线上文件为准）

2026-11-20 已发布：`0.3.10-autoload` / `versionCode=14`。

**当前线上（2026-11-23 20:14 发布 v18）**：`0.3.14-smooth` / `versionCode=18`，**双架构包**（`arm64-v8a,armeabi-v7a`，构建传 `-PNATIVE_ABIS=arm64-v8a,armeabi-v7a`）54,023,627 字节，APK SHA-256 `09de4d645749c5a4be102bcbaaa53973ccc039faa5b8a22f60e41fbdd08c034a`，稳定签名（§2.1，`1bd20049…`）。发布编号 `20261123T121254Z-507aadd`，源码提交 `507aadd`。本次为聊天室巨型 Composable 拆分（P0-1），无功能改动。

**历史 v17（2026-11-20 20:51）**：`0.3.13-autoload` / `versionCode=17`，arm64-only 31,173,990 字节，SHA-256 `a14dd01eb2c9a1fd9db0ca3996b586a64a0f405d13dafe48c5b961a09e8831c9`，发布编号 `20261120T124713Z-78d5432`。

- **APK 下载已全量走阿里云 CDN**：对象在业务桶 `im-app-production/business/apk/`（对象元数据 `Cache-Control: public, max-age=31536000, immutable`），边缘命中实测 ~45MB/s（对比 nginx 跨境直连 ~100KB/s）。`update.json` 的 `downloadUrl` 与下载页 `app.apk` 固定入口（nginx 现有 `location =` 块内 `return 302`）均指向 `https://oss-business.whs188.xin/im-app-production/business/apk/native-0.3.14-smooth-18-09de4d645749.apk`。
- 新版本发布时：APK 先经香港前端服务器（8.217.171.178，与 OSS 同地域）PUT 到 OSS 上述前缀（RAM 密钥在宝塔后端服务器 `/www/wwwroot/deploy/.env`，只允许该前缀）；`prepare_distribution.py` 的 `--base-url` 用 CDN 目录 `https://oss-business.whs188.xin/im-app-production/business/apk/`，再按 §5 流程只替换线上 `update.json`，版本化 APK 本身不必再传 nginx 服务器。
- ⚠️ nginx 陷阱（v18 实测补充）：vhost conf 行尾是 CRLF 且**已存在** `location = /testapp/app.apk` 缓存块，块内**有两条** `return 302`（中间夹注释）。改固定入口跳转必须在现有块内**替换全部 return 行**，不能再插同名 location（duplicate location 会使 `nginx -t` 失败并触发回滚），也不要只断言一条 return 就中止（v18 曾因此中断在半发布态，已用 `fix_302_v18.sh` 收敛）。
- 回滚链：`update.json.bak-20261123T121254Z-507aadd` 为 v17 清单；`xn--jprz53bj9s.com.conf.bak-20261123T121254Z-507aadd-v18` 为 v17 nginx 配置；v16/v17 版本化包与 `app.apk.bak-20261120T104818Z-78d5432`（v14 包）均保留。

**历史（2026-11-20 19:05 v16）**：`0.3.12-autoload` / `versionCode=16`，签名更换见 §2.1；APK SHA-256 `557b00d4645f89e1f7a1f2c92f3265b0f95e155ad15e7e70d042b9517703ae09`，97,796,768 字节（全 ABI），备份 `app.apk.bak-20261120T104818Z-78d5432`（旧 v14 包）。该次为**首次上线 `update.json`**，此前无清单。

- APK SHA-256：`922f969b2f1a5cc93b6f6f22d23a56b5c9f384b4a71bffb5f959c9b81604d56a`
- 从 APK v2 签名块读取的证书 SHA-256：`6d03e74ca9768f53fdf6f58e5fbe8d9ba4bbe0d9cad600d780d60fbbddd8ee18`
- 此次已公网完整下载核对文件摘要，但当时 Mac 无 JDK / SDK，未执行 apksigner 或真机安装。下一位发布者必须用 `apksigner verify --verbose --print-certs` 核对线上包，不能将解析指纹视为完整签名验证。
- 旧文档记载的 `b796…` 证书属于另一批签名，不得直接沿用。不能新建一把 debug key 替代；签名不同会导致覆盖安装失败。私钥不能从 APK 还原，须向本批打包负责人安全获取并集中保管。
- 版本 14 的 `NATIVE_UPDATE_MANIFEST_URL` 与 `NATIVE_DOWNLOAD_PAGE_URL` 均为空，因此它不会自动检查更新。用户必须先从固定下载页手动安装一次带更新入口、同证书且更高版本号的包，此后才能收到弹窗。

工程已设置上述测试站为默认更新地址，环境变量或 Gradle 属性可以覆盖，显式空值会关闭入口。发版时仍建议显式传入地址，检查是否有同名 Gradle 属性覆盖环境变量。

### 2.1 签名更换（2026-11-20 起，v16 生效）

线上 v14 的私钥经确认已不可获得（打包机 `D:/jiedan/IM/.native-cache/android/debug.keystore` 不存在），覆盖升级在物理上已无解，因此自 `0.3.12-autoload` / `versionCode=16` 起改为团队自行生成、集中保管的稳定签名：

- keystore：`E:/keys/imapp/native-staging.p12`（PKCS12，alias `native-staging`，RSA 2048，有效期 10000 天）
- 证书 SHA-256：`1bd20049f8f9ce120cc7e5a84825e2b54de0592f0423d82ba9c679e117069c3e`
- 口令不入 Git，存于同目录 `README-签名说明.txt`；必须另备份到密码管理器与离线介质，私钥再丢就等于签名第二次断裂。
- 迁移代价：v14/v15 升级到 v16 必须先卸载旧版，覆盖安装会报 `INSTALL_FAILED_UPDATE_INCOMPATIBLE`。v16 之后同一把钥匙可平滑覆盖升级，不再需要卸载。
- 不需要改 `app/build.gradle.kts`：四个 `NATIVE_ANDROID_*` 环境变量走的就是外部签名通道，只需把 keystore 路径与口令换成上面这把。
- 从 v16 起，`prepare_distribution.py` 的 `--expected-certificate-sha256` 用 `1bd20049…`；第 2 节里 `6d03e74c…` 的旧基线只用于解释历史包，不得再作为期望值。

## 3. 一次性准备

构建机需 JDK 17、Android SDK platform 34 / build-tools 34.0.0、工程固定 Gradle 8.4、Python 3；依赖以仓库 Gradle 配置为准。Windows 可用 `IM-APP-android/build.ps1`，Mac/Linux 使用工程 Gradle wrapper。没有工具时明确报告，不声称编译通过。

由凭据管理方式注入以下环境变量，禁止写进 Git、文档、日志、网页或 AI 最终回复：

```text
NATIVE_ANDROID_KEYSTORE=<本批稳定 keystore 的绝对路径>
NATIVE_ANDROID_STORE_PASSWORD=<秘密>
NATIVE_ANDROID_KEY_ALIAS=<alias>
NATIVE_ANDROID_KEY_PASSWORD=<秘密>
```

自动上传优先使用运维预先配置、已核验主机指纹的 SSH 主机别名，例如 `im-frontend-staging`，并限定可写目录。本文示例别名不代表已经配置。宝塔账号不是 SSH 账号；不要猜 root 密码、关闭主机指纹校验或自动扩大权限。没有 SSH 时可在已授权宝塔文件管理中上传临时文件，使用目录终端执行同样的摘要核对与原子替换。面板口令从团队凭据管理处取得，不复制进本文或仓库。

## 4. 构建和准备分发文件

先执行 `git status --short`，明确本次源代码提交与未提交变更；不要把别人的工作一起打包提交。读取线上 `update.json`，并下载当前 `app.apk`，用 SDK 工具核对版本、包名、签名。清单存在时必须与当前包身份一致；仅 HTTP 404 可作为尚无清单，超时、TLS 错误、403/500 不能当首次发布。使用正常 TLS 校验，不能加 `-k`。

修改 `app/build.gradle.kts` 的 `versionCode`、`versionName`，版本号必须高于线上 APK 与清单中较大的版本号。回退代码也要发布更高 `versionCode`。更新 `docs/原生内测更新说明.md`，然后构建。以下 Bash 命令从仓库根目录运行（签名变量须事先安全注入）：

```bash
export NATIVE_DOWNLOAD_PAGE_URL='https://www.xn--jprz53bj9s.com/testapp/'
export NATIVE_UPDATE_MANIFEST_URL="${NATIVE_DOWNLOAD_PAGE_URL}update.json"
python3 -m unittest discover -s scripts/native/tests -p test_distribution.py
(cd IM-APP-android && ./gradlew --no-daemon :app:testDebugUnitTest :app:assembleDebug :app:lintDebug)
```

Windows PowerShell 对应入口（执行后检查 `$LASTEXITCODE`，非零立即停止）：

```powershell
$env:NATIVE_DOWNLOAD_PAGE_URL = 'https://www.xn--jprz53bj9s.com/testapp/'
$env:NATIVE_UPDATE_MANIFEST_URL = $env:NATIVE_DOWNLOAD_PAGE_URL + 'update.json'
./IM-APP-android/build.ps1 -Tasks @(':app:testDebugUnitTest', ':app:assembleDebug', ':app:lintDebug')
```

检查产物 `IM-APP-android/app/build/outputs/apk/debug/app-debug.apk`。用 `aapt dump badging` 核对包名/版本，用 `apksigner verify --verbose --print-certs` 核对真实签名；确认 APK 中编入两个正确更新地址（可用 Android Studio APK Analyzer / DEX 查看器检查 BuildConfig 和调用路径），并在真机「关于我们 → 检查更新」验证请求到目标清单。不得只搜索任意 URL 字符串就认定功能已启用。

**ABI 过滤按版本取值**：v17（2026-11-20）因香港服务器跨境直连仅 ~100KB/s，用 `-PNATIVE_ABIS=arm64-v8a` 瘦身到 ~32MB；v18（2026-11-23）起 APK 已全量走 CDN（边缘 ~45MB/s），改回 `-PNATIVE_ABIS=arm64-v8a,armeabi-v7a` 补回 32 位真机兼容（54MB）。不带该参数构建会产出全 ABI 包（含模拟器架构）；发布前用 `aapt` 或解包确认 `lib/` 架构集合符合本次计划。

用既有生成器核验并生成独立文件，避免手写清单导致 SHA/大小/签名错误。示例 Bash：

```bash
python3 scripts/native/prepare_distribution.py \
  --apk IM-APP-android/app/build/outputs/apk/debug/app-debug.apk \
  --base-url 'https://oss-business.whs188.xin/im-app-production/business/apk/' \
  --out .native-cache/distribution/site \
  --aapt "$ANDROID_HOME/build-tools/34.0.0/aapt" \
  --apksigner "$ANDROID_HOME/build-tools/34.0.0/apksigner" \
  --expected-certificate-sha256 1bd20049f8f9ce120cc7e5a84825e2b54de0592f0423d82ba9c679e117069c3e \
  --changelog-file docs/原生内测更新说明.md
```

上面的指纹须先经本次线上包签名验证确认；若真实结果不同，停止调查，不自动改成新证书。若已有清单，额外传 `--previous-manifest <刚从线上下载的旧清单路径>`，生成器会拒绝签名变化、同版本与降版。第一次没有清单时，也要自行与线上 versionCode 14（或已更新的实际版本）比较。Windows 使用实际 SDK 工具 `.exe` / `.bat` 路径。

输出为版本化 `native-*.apk`、`update.json`、`index.html`、`_headers`。**本服务器只上传前两者，并维护固定 app.apk；不能把输出整个目录同步到 testapp。** 生成的页面不包含当前 iOS 企业分发流程，覆盖会破坏已有页面。Nginx 不会自动识别 `_headers`。

## 5. 自动上传与原子发布

AI 可通过 `scp` 上传两个文件到已授权主机，或通过宝塔上传，不需要逐个拖文件。使用本次唯一编号（建议 UTC 时间加 Git 短 SHA），例如 `20261120T080000Z-abc1234`，所有临时文件以该编号命名。不要直接上传覆盖线上 `app.apk` 或 `update.json`。

严格按以下步骤编排，任何校验失败立即停止，保留当前可用版本：

1. 获取团队发布占用后，重新读取线上清单与 APK 元数据，确认未被其他人更新；服务器端另用 `flock` 对整个切换阶段互斥，锁文件放 `/www/wwwroot/yikeliao.com/.android-testapp-publish.lock`。SSH 锁持有期间完成线上版本复查、备份和以下全部切换；宝塔操作也必须用同一锁。
2. 上传版本化 APK 的临时文件 `<native文件名>.<本次编号>.upload` 和清单 `update.json.<本次编号>.upload` 到 testapp。先对本机文件计算 SHA-256，服务器用 `sha256sum` 对比。解析清单，校验 downloadUrl 就是本次固定 HTTPS 基址加版本化 APK 文件名，包名/渠道/版本/签名/大小/摘要全部匹配。本机文件和线上文件比较用完整 64 位摘要。
3. 为线上 `app.apk` 和已有 `update.json` 创建带编号的独立备份，不覆盖历史备份；保存旧摘要和元数据供回滚。当前没有清单则记录 absent，不伪造旧清单。再次比较发版前读取的线上摘要，变化则停止并重新核对，防止并发覆盖。
4. 将 APK 临时文件设为 `0644`，在同一目录用 `mv` 原子改名为清单指定的版本化文件名；文件已存在时只允许摘要相同，摘要不同立即停止，不覆盖不可变版本文件。
5. 从公网 HTTPS 下载该版本化 APK，验证完整 SHA-256、文件大小；网络或 TLS 失败时保持旧清单和固定入口。此步骤可由有正常 TLS 环境的构建电脑完成，不需要降低服务器 TLS 校验要求。
6. 从版本化 APK 复制到同目录 `app.apk.<本次编号>.tmp`，设为 `0644`，核对摘要，再 `mv` 原子替换 `app.apk`。网页仍指向 `app.apk`，不需改 HTML 或 iOS 文件。
7. 最后将已校验的清单临时文件设为 `0644`，同目录 `mv` 原子替换 `update.json`。该步骤后已安装带更新入口的 App 才会发现新版本；清单始终指向不可变版本化 APK，避免发布窗口下载到另一包。
8. 公网重新读取固定 `app.apk` 和 `update.json`，核对完整摘要与字段，再释放服务器锁与团队占用。失败时执行下一节回滚或报告明确阻塞，不能只看“上传成功”。

自动化应使用远端脚本的 `set -euo pipefail`、`flock` 和显式失败退出；不要把多条命令逐个异步发送到终端，不要用 `rsync --delete` 同步整个 testapp。上传、备份、替换、验证均限定为上述文件。不得把 shell 退出成功等同于真机升级成功。

### 缓存

每次验收检查实际响应头：目录页、`index.html`、`update.json` 和固定 `app.apk` 不应长期缓存，建议 `Cache-Control: no-store`；版本化 APK 可长期 immutable。若 CDN/Nginx 已缓存旧 `app.apk`，先按运维流程刷新该精确 URL，再重测原 URL，不能仅用随机查询参数证明用户能拿到新包。变更 Nginx 前读取现有站点配置、备份、`nginx -t` 通过后再 reload；不要覆盖整份虚拟主机配置。缓存配置和凭据初始化属于一次性运维准备，不要每次发版重复修改。

## 6. 验收与回滚

发布后至少记录：Git 提交及本地改动范围、APK 版本/包名/证书、APK 完整 SHA-256/字节数、发布时间、备份文件、线上清单、验证命令结果。禁止记录密码和私钥。

- 公网完整下载固定 APK 与版本化 APK，摘要等于构建产物。
- 真机同证书低版本 → 高版本，验证启动弹窗、手动检查、下载校验、安装权限返回、覆盖安装和账号/聊天数据保留。版本 14 首次需要手动下载安装带入口版本。
- 按本次改动验证相关登录、聊天、媒体等真实流程；只执行过单测就只报告单测通过。
- `git diff --check`；若提交，逐路径暂存本次文件，检查暂存 diff，不提交 APK、keystore、密码、iOS 无关改动或别人的工作。

仅服务器发布出错、尚未安装新版本时，可在同一发布锁内，将旧清单和旧固定 APK 从备份分别复制到临时文件再原子恢复；首次发布清单失败时只撤下本次新建清单（先保存副本），恢复到此前无清单状态。保留版本化 APK 和备份，避免中断已有下载。已经安装新版本的用户不能依靠降低清单版本降级；需要恢复代码后打同证书且更高 versionCode 的修复包。

## 7. 可复用 CI 与实际自动化状态

仓库已有 `.github/workflows/native-distribution.yml`，支持手动触发、固定签名构建、测试、Lint、生成分发产物。配置仓库 Secrets：`NATIVE_ANDROID_KEYSTORE_BASE64`、`NATIVE_ANDROID_STORE_PASSWORD`、`NATIVE_ANDROID_KEY_ALIAS`、`NATIVE_ANDROID_KEY_PASSWORD`；Variable：`NATIVE_ANDROID_CERT_SHA256`。它们必须属于本批已安装内测包的签名。

触发时 `distribution_base_url` 使用本测试站地址，`deploy_to_github_pages=false`，iOS 两个链接输入留空。当前工作流**只准备 artifact，不会上传宝塔服务器**。下载 artifact 后按第 5 节发布两个文件及固定 APK，不能将整个 artifact 覆盖线上目录。后续可在具备受控 SSH 凭据的 CI runner 中实现第 5 节的上传及持锁发布步骤；未配置和实测前，不声称已经全自动发版。不要选择 GitHub Pages 来替代当前 testapp 站点。

目前默认更新地址修改只通过 diff 格式检查，分发生成器 5 项 Python 测试通过；Mac 缺构建环境，未完成本次 Gradle 编译或真机更新验收。后续接手 AI 需完成这些检查，不得把本文当成通过凭证。
