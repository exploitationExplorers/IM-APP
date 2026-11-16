# OpenIM Core 内存优化方案（修复 iOS 大账号同步闪退）

> 基线分支：`codex/native-bootstrap`（IM-APP 主仓库）
> Core 基线：`E:\Code\sdks\openim-sdk-core` @ `v3.8.3-patch.15`（与 iOS pod `3.8.3-hotfix.15` 精确对齐）
> 日期：2026-11-16 · 状态：**待确认后编码**

## 一、问题与证据链

**症状**：大账号（13987654321，万级会话/消息）iOS 首次同步分钟级卡顿 → 闪退 → 重装后从零开始死循环。Android 正常（库早已收敛，走增量同步）。

**决定性证据**（JetsamEvent-2026-11-16-101…，bug_type=298）：

| 证据 | 值 | 结论 |
|---|---|---|
| `largestProcess` | `Eggplant` | 被杀的就是我们的 App |
| `free` | 6237 页 ×16KB ≈ **97MB** | 全机内存濒临耗尽 |
| `compressorSize` | ≈ **2.7GB** | 内存已压缩 2.7GB 仍不够 |
| `compressions/decompressions` | 830万/417万 | 内存抖动（thrashing）16 秒后杀进程 |
| `EggplantNotificationExtension` 被杀 | 仅占 4.4MB | 系统已到无差别清场程度 |

**根因**（core 源码定位）：

```
core 不分页地同步大账号
  → Go 堆持续膨胀（全部会话 + JSON 序列化副本同时在内存）
  → iOS 内存压缩仍不够 → jetsam 杀进程
  → 同步版本号未落库 → 下次登录从头同步 → 死循环
```

## 二、根因代码锚点（已逐一核实）

| # | 位置 | 现状 | 问题 |
|---|---|---|---|
| 1 | `internal/conversation_msg/conversation_msg.go:39` | `conversationSyncLimit int64 = math.MaxInt64` | ⚠️ **实现阶段修正**：核读 `pkg/network/http_client.go` 的 `FetchAndInsertPagedData` 后发现该 limit 是「总条数上限」而非「页大小」，且空库全量路径本身就是**逐页插入**（每页插完即释放）——空库路径内存本来就是流式的。把它改成 200 反而会拉满一页就 break、**静默截断同步**。**结论：该项不改**，对照组群 1000/好友 10000 的语义是「总量保险丝」而非页大小 |
| 2 | `internal/conversation_msg/incremental_sync.go:59-78`（FullSyncer） | 空库走 `FullSync`（逐页流式，无问题）；**非空库走 `getAllConversationListFromServer`（server_api.go:60-62）一次性拉全部会话** | **真正的内存大户**。中途闪退后本地已有部分数据 → 下次登录落入 else 分支 → 一次性大请求 → 再次爆内存。**这是死循环的燃料** |
| 3 | `pkg/syncer/version_synchronizer.go:56-130` | 版本号只在整轮 `IncrementalSync` 成功后落库 | 中途被杀 = 白同步，进度无法续传（C2 的差集对账天然缓解，C3 二期） |
| 4 | `internal/interaction/msg_sync.go:41` | `SplitPullMsgNum = 100` | 消息批大小已合理（100/批流式），**暂不改**，加观测即可 |

## 三、改动清单（core，按序执行）

### C1. ~~会话全量分页限制~~（实现阶段取消，见第二节 #1 修正）

- 核读 `FetchAndInsertPagedData` 后确认：空库 FullSync 已逐页流式插入，`conversationSyncLimit` 是总条数保险丝；改为 200 会静默截断同步。**保持 `math.MaxInt64` 不动**。

### C2. 非空库的全量对账分批化（✅ 已实现，commit ee4469a）

- 文件：`incremental_sync.go` FullSyncer else 分支
- 改法（已落地）：
  1. `getAllConversationIDsFromServer`（`GetFullConversationIDs`）拉全量会话 ID（纯 ID 列表，万级仅几百 KB）；
  2. 按 **100/批**（`fullSyncReconcileBatchSize`）循环：`getConversationsByIDsFromServer` 批量拉该批会话 → 逐个 `GetConversation` 取本地行（`ErrRecordNotFound` 视为缺失，交给 Sync 走 insert）→ `conversationSyncer.Sync(server批, local批, skipDeletion=true)`；
  3. 每批处理完即释放，内存峰值恒定 ~1-2MB；
  4. 每批记录耗时日志（C4 埋点一并落地）。
- 效果：闪退重启后本地已有大半数据，重跑只做增量比对（网络往返同原方案，但每批内存恒定）→ **天然断点续传**，死循环消除。
- 验证：`go build ./...` + `go vet` 通过；`internal/conversation_msg`、`internal/interaction`、`pkg/network` 测试全过（`pkg/db` 与 `internal/third` 的失败为上游/环境固有问题：CGO sqlite 与硬编码 fixture 路径，与本次改动无关）。
- 说明：对账逻辑深度单测依赖 cgo sqlite 基建（Windows 本机 CGO_ENABLED=0 跑不了 db 测试），验证以真机集成为准。

### C3. 版本号分阶段落库（可选加固，二期）

- 文件：`version_synchronizer.go`
- 改法：FullSyncer 每页完成后将「已插入的 UIDList 增量」先行持久化（新增 `SaveVersionProgress`），被杀后从水位续跑。
- 说明：C2 落地后差集对账已近似续传，C3 收益递减，**放二期**，一期不做，控制风险。

### C4. 观测埋点

- 每页插入后打日志：`页号/条数/耗时/累计条数`（`log.ZDebug`，跟 core 现有日志风格一致）。
- 目的：真机验证时有数据支撑（页耗时、总页数），不再靠猜。

### 版本管理约定

- 在 `v3.8.3-patch.15` 上切分支 `yike/3.8.3-patch.15-memfix`，改完打自有 tag **`v3.8.3-yike.1`**（podspec/文件名均体现，避免与官方混淆）。
- core `go.mod` 要求 Go 1.22.7，本机 mise Go 1.25.0 可跑 `go build ./...` + `go test ./...` 验证编译与单测。

## 四、编译与分发（不需要本机 Mac）

1. `.github/workflows/native-checks.yml` 新增 job `ios-xcframework`（`macos-15`）：
   - `gomobile bind -target=ios -o OpenIMSDKCore.xcframework`（可先只出 `ios,iphonesimulator+iphoneos` 组合）；
   - 产物 + SHA256 上传 artifact，并附脚本推到 ECS nginx 静态目录（`https://<域名>/sdks/openim/3.8.3-yike.1/`）。
2. iOS 壳接入：fork `open-im-sdk-ios` 改 podspec 中 core 下载 URL 指向自有服务器（或 Podfile 用 `:podspec` 指向自维护 podspec），Podfile tag 锁 `3.8.3-yike.1`。
3. 出 iOS 原生测试包 → testapp 壳更新（**原生包，不是 wgt**）。
4. Android 侧暂用官方 `3.8.3-patch.10` 不动（其库已收敛无此问题），后续两端拉齐时再出 aar。

## 五、主仓库（codex/native-bootstrap）对齐事项

1. **前端修复移植**：`feat/chat-image-speed` 上已做的 4 项（setAppBackgroundStatus、列表预算耗尽返回本地、重登 120s 冷却、同步进度条/空态）需合入或 cherry-pick 到 `codex/native-bootstrap`（该分支已有 imSyncPending UX，移植时以其基线为准做适配）。
2. CI workflow 改动直接提交在 `codex/native-bootstrap`。
3. `contracts/native-bootstrap/v1/fixtures` 契约测试 + `IMCore` swift test 在换 SDK 后全量回归。

## 六、验收标准

| 场景 | 通过标准 |
|---|---|
| 13987654321 首次安装登录（全新库） | 同步可跑完（预计 5-15 分钟），全程不闪退，Xcode Instruments/进程内存峰值 < 300MB |
| 同步中途手动杀进程再打开 | 从差集续跑（日志可见「本地已有 N 条、仅需拉取 M 条」），不再从零开始 |
| 切后台再回前台 | 进度继续，不重置 |
| Android 回归 | 官方 SDK 未动，行为不变 |
| 契约回归 | `native-checks.yml` 全绿 + fixtures 校验通过 |

## 七、风险与回滚

| 风险 | 缓解 |
|---|---|
| C2 对账逻辑漏删「服务端已删会话」 | 保留原 `Sync` 的 delete 语义；单测覆盖三态（新增/更新/删除） |
| 自编 core 与服务端 v3.8.3 协议不兼容 | 基线就是 patch.15，无协议改动；上线前用测试账号跑收发/已读/撤回冒烟 |
| iOS 壳集成失败 | podspec 指向服务器 zip 与官方发布物同构，可随时切回官方 pod 版本（Podfile 一行回滚） |

## 八、执行顺序与进度

1. ✅ 落盘本方案（本文档）
2. ✅ core 切分支 `yike/3.8.3-patch.15-memfix` → C2 + C4 埋点 → `go build/vet/test` 通过 → commit `ee4469a` → tag **`v3.8.3-yike.1`**（C1 取消，见第二节修正）
3. ✅ CI workflow 落 `codex/native-bootstrap`：`.github/workflows/sdk-core-build.yml`（macos-15 + 官方 `make ios` 流程，产物 zip + sha256 传 artifact）
4. ⬜ 推送 core 分支/tag 到用户 fork → 触发 workflow → 下载 xcframework 上传 ECS 静态目录
5. ⬜ iOS 壳自维护 podspec 指向自有产物（tag `3.8.3-yike.1`）→ pod install → 出原生测试包
6. ⬜ 真机验收（第六节清单）→ 前端修复移植合流 → 全量回归
