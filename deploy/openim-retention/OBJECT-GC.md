# 聊天文件定期回收：部署与操作

适用：`feat/chat-image-speed`，后端宝塔 `8.154.44.197`。这是**新增量包**的说明，不要修改或覆盖已经安装的 `visibility-release-nk72gh`。

## 默认行为与实际边界

| 项目 | 新版默认值 |
| --- | --- |
| 群消息策略 | 开启；每群最近 168 小时且最多 500 条真实可见消息，任一超限就逻辑过期 |
| OSS 聊天文件回收 | 部署校验成功后自动开启；每天北京时间 03:30 执行 |
| Mongo 消息正文物理清理 | 仍关闭，保留消息证据，不能据此宣称数据库磁盘已释放 |
| 头像、收藏、业务转发副本 | 长期保留，不进入聊天 GC 范围 |
| 旧聊天对象和 MinIO | 保留；没有可靠历史引用账本，禁止仅凭文件年龄删除 |

本次仅管理部署后新上传的 `im-app-production/chat/managed-v1/` 文件。它不是一次全桶历史清空工具，不能立即回收之前所有聊天文件。不要给整桶或 `chat/` 添加“7 天自动删除”生命周期。

保留规则的 **7 天是消息可见期，不是文件删除期限**。上传签名最长有效 7 天，因此每次上传/完成/映射发布后至少保留 8 天；证明所有群引用过期后还需要至少 24 小时隔离，且相关逻辑清理 ACK 至少已满 24 小时。没有消息引用的中断上传同样经过缓冲期。第一天删除数为 0 通常正常。

所有群引用必须找到真实落库消息且低于已 ACK 的保留边界。任一其他群还可见、存在未落库/失败发送、元数据缺失、跨群重复证据不明确，均保留。单聊、头像、收藏、业务转发/引用和原生用户收藏命令登记为永久保护；目前不自动解除永久保护，即使后来取消收藏，也可能多保留源文件，以安全优先。

业务归档复制前先保护源文件；原有 `forwards/` 写入白名单遗漏已修复。识别递归 JSON、字符串化快照、camelCase/PascalCase，不要求修改原生 SDK 或前端缓存。

## 一、阿里云只需补一次 RAM 权限

使用现有 RAM 用户和 AK/SK，不创建新数据库、不换密钥、不修改原有授权。

1. 阿里云 RAM → 权限管理 → 权限策略 → 创建权限策略 → JSON。
2. 复制本包 `ram-chat-gc-policy.json`，命名例如 `im-app-chat-managed-gc`。
3. 给**当前线上聊天 OSS 密钥所属的 RAM 用户**附加此策略；保留旧策略。
4. 新增权限只有：
   - `oss:DeleteObject`，限聊天桶 `yikeliao-188-hk-test/im-app-production/chat/managed-v1/*`。
   - `oss:GetBucketVersioning`，限同一个聊天桶，只读检查版本控制。
5. OSS → 聊天桶 → 版本控制：应为从未开启的未启用状态。若是“已开启”或“已暂停”，**不要关闭或删除历史版本来绕过检查**，先另行评审版本回收方案。

不授予删除整个桶、删除业务桶、删除头像/收藏、删除原聊天前缀的权限。已有更宽的 RAM 权限不会自动被此 Allow 策略收窄，应由账号管理员检查；程序仍严格限制新前缀。请勿把 AK/SK 发到聊天或放进包中。

激活前，程序只对自己新生成的零字节 `managed-v1/openim/temp/gc-probe/随机ID` 做写入/删除探针；不使用真实用户对象试删。每次实际删除前再次只读检查桶版本控制；异常则停止该对象，不扩大删除范围。

## 二、本机验证与构建

在 Windows 仓库根目录：

```powershell
$env:GO_EXECUTABLE='D:\Program Files\Go\bin\go.exe' # 当前电脑；其他电脑可不设置
node --test deploy/openim-retention/test-patch.cjs deploy/openim-retention/test-release.cjs
python -m unittest discover -s deploy/openim-retention -p 'test*.py'
python deploy/openim-retention/test-integration.py --build-linux
node deploy/openim-retention/build-release.cjs
```

集成测试只创建一次性本机回环 Mongo/Redis，禁止指向现有业务数据库。构建产生 `artifacts/media-gc-release-本次标识/`。包含业务 API 与五类 OpenIM 二进制、052–055 幂等增量迁移、脚本、校验清单；不含密钥、H5、WGT。不要把之前生成的旧包当本次新包。

## 三、宝塔后端部署：一条主命令

先在宝塔文件管理上传并解压**新包**到 `/root/im-app-retention/media-gc-release-本次标识/`，再在后端终端执行（目录名换成实际值）：

```bash
cd /root/im-app-retention/media-gc-release-本次标识
sha256sum -c SHA256SUMS && python3 cleanup-production.py deploy
```

脚本顺序：检查包和原 OSS 配置 → 生成/复用独立私有桥密钥并记录当前镜像 → 暂停已有 GC → 幂等执行 052–055 → 基于**当前运行镜像**本地叠加二进制 → 仅重建 OpenIM 应用容器 → 等待全部进程 → 仅重建业务 API → 校验全部运行中二进制 SHA、业务引用保护和私有端口 → OSS 权限/版本探针 → 自动激活每日 GC。

只重启 `openim-api`、`im-app-api` 两个应用容器，会短暂重连；**不承诺零停机**。PostgreSQL、Mongo、Redis、Kafka、数据卷、原 OSS 配置/稳定媒体签名 key 不重启、不替换、不恢复。原 OSS override 保持叠加，不能裸跑基础 Compose。

成功标记：

```text
IM_APP_CHAT_CLEANUP_DEPLOY_OK: group_policy_on; managed_GC_on; schedule=03:30_Asia/Shanghai
```

正常完整部署应返回此标记，并且状态为 `active=true`、`scheduleEnabled=true`、`groupRetentionMode=visibility_only`。若按下文用 `enable` 补完中断部署，该命令只输出状态，不输出 `DEPLOY_OK`；须以其校验成功退出及上述状态共同确认开启。**本地测试通过、构建成功、应用健康，均不能单独代替部署和激活检查。**

若 RAM 探针失败：应用可能已经更新、群逻辑策略已开，但物理 GC 尚未成功激活。不要恢复数据库或反复重启；补权限后执行下方 `enable`。如拓扑或二进制校验失败，保留 `private/` 和输出，先诊断，禁止跳过校验。

## 四、日常只用这些短命令

在新包目录执行：

```bash
python3 cleanup-production.py status   # 查看开关、对象状态、最后一批结果
python3 cleanup-production.py preview  # 只读预览一批，不改对象或 GC 元数据
python3 cleanup-production.py run      # 手动执行一批，最多 50 个
python3 cleanup-production.py disable  # 暂停群逻辑任务及 OSS GC，保留全部引用保护
python3 cleanup-production.py enable   # 校验后重新开启两者
```

无需另加宝塔计划任务或 cron，调度在第三方存储 RPC 内部；每天最多 10 批、每批最多 50 个、最长 45 秒，批间暂停 5 秒，避免无界扫桶。`run` 响应中的 `deletedBytes` 是本批成功删除的当前对象字节。状态里的 `lastRun` 是**最后一批**，不是全历史累计；当前 Mongo 聚合结构中的同一字节字段名为 `bytes`。本方案拒绝版本化桶，仍须以 OSS 用量/账单的延迟统计核对实际空间变化。

`preview`/`run` 会先验证当前版本与引用保护；未激活 GC 时拒绝运行。暂停不恢复已经过期的历史消息，也不能恢复已经删除的二进制文件。只暂停物理回收可用 `disable-gc`，不停止群逻辑策略。

私有 `19093`、`19094` 都不得发布到宿主机、安全组或公网 Nginx。不添加任何公网清理接口。

## 五、验收与故障边界

本机测试不是生产手机验收。部署后用专用测试群在 H5、iPhone、Android 检查：发文字/新图/视频/语音/文件，重复内容上传，设置头像，收藏，单条转发、引用、合并转发，跨群共用文件，退出重进及离线重连；长期副本仍可打开，有效群/单聊不受影响。

不要在正式群批量造 501 条，也不要改线上时间、Mongo `candidate_at`、边界或引用账本来加速验收。过期/隔离/物理删除时钟通过隔离集成测试模拟；真实环境按自然时间复核。

`deleting` 长时间不减少，表示删除超时/崩溃/权限变化后的不确定状态。为防止暂停旧进程误删重新上传的新一代对象，**不会自动解锁后重删**。先停 GC，保留记录并由开发排查；不要手工清空集合、删除映射或回滚到未实现引用保护的旧镜像。旧文件全量迁移回收、自动释放永久保护、失效删除人工恢复工具不在本次交付范围。

发布这批后端改动不需要发布 WGT；但若手机仍未安装之前群水位同步的前端版本，须另行发布前端并验收，不能宣称旧 App 的本地消息已自动同步。

## 六、已上线记录与中断部署的补完

用户已在后端宝塔完成 `media-gc-release-FwmrxL` 的安装，并返回 `cleanup-production.py enable` 成功状态：`active=true`、`scheduleEnabled=true`、`groupRetentionMode=visibility_only`，范围为 `im-app-production/chat/managed-v1/`，`legacyDeletion=false`。当时有 28 条 `open` 管理记录，`deleted=0`、`lastRunAt=null`。这证明开关/版本校验/激活探针已通过，**不证明自然时间调度已执行、真实用户文件已删除或真机验收完成**。

此次 `PRIVATE_KEY_MISMATCH` 的只读诊断确认：OpenIM 已加载新覆盖层、五类进程齐全、桥密钥与本包 `private/retention.env` 一致；业务 API 仍只加载基础 Compose 和原 OSS override，缺少桥密钥。不是 RAM AK/SK 错误，不应换密钥或删除 `private/`。

仅在**已确认是上述中断阶段、原 deploy 进程已结束**后，在同一发布目录补执行：

```bash
python3 cleanup-production.py enable
```

它只更新业务 API（会短暂重连），保留 OpenIM 与数据服务，然后校验全部运行中二进制、引用保护和 OSS 权限，通过后激活 GC。若两端实际密钥都有值但不同、OpenIM 未就绪或版本不符，先保留现场诊断，不能把这个命令当作绕过检查的通用修复。首次 OSS 切换脚本、裸 Compose 和缺少当前覆盖层的旧 `dc-api` 均不用于补完本次更新。

后续先 `status`，再可运行只读 `preview`。若主动执行 `run`，它会**真实删除已符合条件的对象**；`lastRunAt` 有时间只表示执行过，实际回收须同时核对 `deleted`/字节统计及 OSS 对象，不以容量暂未下降或首日 `deleted=0` 判定失败。不要修改线上时间、引用账本或消息边界来催删。
