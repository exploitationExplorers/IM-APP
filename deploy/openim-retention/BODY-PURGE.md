# 群消息正文延迟清理（默认关闭）

## 状态与范围

本模块已实现并在一次性本机 MongoDB 上验证，但**未部署、未在生产启用、未完成手机验收**。

它只清理 OpenIM `msg` 集合中已应用群保留边界以下的消息正文/槽位元数据，不删除消息文档骨架，不删除用户、群、单聊、收藏记录、OSS/MinIO 对象或 OpenIM 文件映射。头像/收藏/转发副本完全不在访问范围内。

消息按“168 小时且最多实际可见 500 条”的规则先做逻辑过期。正文清理是在逻辑 ACK 后至少 **24 小时**的独立阶段，不代表到期立即回收。Mongo 可复用清出的存储页，**不保证宿主机磁盘占用立即下降**；不要因此手工压缩/重建线上库。

**这不是 OSS 图片空间回收功能。** 图片二进制仍保留，不能拿这里的成功数充当 OSS 删除数。

## 发布门禁

全部满足前保持关闭：

1. 使用当前 OSS 生产镜像作为基底；同时更新消息 RPC 与**所有**转存进程。旧写入进程不认识槽位 fence，仍可重新写入正文。
2. 先在完全独立环境验证完整 OpenIM：Kafka 转存积压、并发发送、进程重启、Redis 失效、引用/收藏及客户端同步。当前测试覆盖真实转存 controller + Mongo，并非完整 Kafka/网关/手机链路。
3. H5/iPhone/Android 的确切版本通过验收。源消息逻辑过期不影响内嵌引用；新收藏/转发必须已经复制成功。
4. 仅在一个专用测试群灰度，确认私有桥不可从公网访问。不能使用真实生产群批量造数。
5. 保存当前镜像和编排配置，了解此操作不可通过关闭开关恢复正文；不要覆盖恢复旧数据库。

## 配置

默认覆盖层强制给出：

```dotenv
IM_APP_RETENTION_BODY_PURGE_ENABLED=false
IM_APP_RETENTION_BODY_PURGE_GROUP_IDS=
IM_APP_RETENTION_BODY_PURGE_ACK=
```

开关关闭时，另外两项也必须清空。配置不完整/错误会拒绝启动，而不是悄悄扩大范围。

验收通过后，仅在**提供私有桥的消息 RPC 实例**配置，以下是示意，不应直接复制到生产启动：

```dotenv
IM_APP_RETENTION_BODY_PURGE_ENABLED=true
IM_APP_RETENTION_BODY_PURGE_GROUP_IDS=<专用测试群OpenIM ID，32位小写hex，不带sg_>
IM_APP_RETENTION_BODY_PURGE_ACK=all-writers-patched-and-accepted
```

- 最多 100 个唯一群 ID，逗号分隔；不支持 `all`、通配符或隐式全群。
- 这里是 OpenIM 32 位 ID；业务 `GROUP_RETENTION_GROUP_IDS` 使用带横线的 UUID，两者勿混淆。
- `ACK` 是操作者确认门禁已通过，**不是程序自动证明所有旧进程已经更新**。
- 仍要求私有桥原有监听/key 配置。只配置正文开关、没有私有桥时拒绝启动。
- 逻辑 worker 与正文 worker 各自独立。仅关闭业务 `GROUP_RETENTION_MODE` **不会停止**已经 ACK 的正文待办；需同时关闭本开关。
- 私有 capabilities 额外返回 `bodyPurge=off|mongo_bodies_only`、`objectPurge=off`。没有开放删除 API，也不能通过传 JSON 打开开关。

## 持久化及并发保证

1. 私有收据通过认证和精确边界校验后，先持久化单调 `min_seq` 并使缓存失效，然后用 Mongo `$currentDate` 记录首次 `applied_at`。重复 ACK 不刷新时间。
2. 每分钟最多选择 5 个已等待 24 小时的允许群收据；每个收据最多处理 10 个文档（每文档固定 100 槽位）。按最后尝试时间轮转，坏群不会一直占满队列前部。
3. 再次检查群白名单和 Mongo 持久化 `min_seq >= receipt.boundary`。不是拿 `max_seq-500` 或对象创建时间当删除依据。
4. 文档内原子 `$set` 过期槽位为空模型，并 `$max` 推进 `im_app_purged_slots`。保留数组布局、有效尾部、文档和唯一 `doc_id`；**不用 `$pull`**。
5. 缺失文档也建立空骨架，阻止很晚才首次落库的旧序号重新创建内容。普通转存的 Create/duplicate-key 重试及消息 RPC 写入均通过同文档 fence，过期写入按成功无改动处理，不陷入重试死循环。
6. 单个文档成功后才以 `$max` 提交 `seq.im_app_body_purged_before`（上游的 `SeqConversationName` 实际集合名为 `seq`）。崩溃后有限重试，不能回退进度或越过尚未清理的块。管理员原有文档销毁路径也保留 fence。
7. 完成收据标记 `body_done=true/body_done_at`；收据仍沿用原 30 天 TTL。未处理完的旧收据如果过期，会等待后续有效收据接续持久化游标，不通过失效预览强行清理。
8. 群引用的源 seq 已低于边界时保留嵌入快照，不把找不到源误判为用户撤回。原始 OSS 文件和所有对象映射不动。

fence、群进度和客户端水位均不可手工删除。**启用后不能回退到不认识 fence 的旧转存/RPC 二进制**；应回滚配置、保留新读写保护，不能降低 `min_seq` 或恢复旧库覆盖现有数据。

## 验证与观察

```shell
node --test deploy/openim-retention/test-patch.cjs deploy/openim-retention/test-release.cjs
python deploy/openim-retention/test-integration.py --build-linux
```

测试使用全新回环 MongoDB/Redis，不读取 `.env`、不接入生产、不操作现有卷。覆盖首次/重复 ACK、24 小时缓冲、名单外旧收据、边界不匹配、部分文档、缺失文档、续跑、失败群轮转、原生结构引用，以及真实转存 controller 的并发落库/重放。并发 fence 场景额外连续执行 5 次，消息 RPC 与转存均构建 Linux/amd64。

观察仅在明确选定的目标 Mongo 数据库内只读查询，勿输出消息正文/凭据：

```javascript
db.im_app_retention_receipts_v1.countDocuments({applied_at: {$exists: true}, body_done: true})
db.im_app_retention_receipts_v1.countDocuments({applied_at: {$exists: true}, body_done: {$ne: true}})
db.seq.find(
  {conversation_id: "sg_<测试群32hex>"},
  {_id: 0, conversation_id: 1, min_seq: 1, im_app_body_purged_before: 1}
)
```

第二个数包含仍在缓冲期内的收据，不等于全部失败数。`im_app_body_purged_before` 是序号边界，不是实际删除条数；空槽/隐藏控制不能算作释放的媒体数量。

## OSS 原文件为什么仍保留

旧客户端、已投递的嵌套引用、单聊复用、上传签名仍在有效期内、OpenIM 按 MD5 去重的多个逻辑文件名，都可能指向相同物理 key。当前生产 third RPC 也明确禁止对象删除。安全回收还需要覆盖所有写入入口的引用/在途协议和去重映射协调；不能用一次扫描、共享 PostgreSQL 锁或桶根 7 天生命周期替代。

因此本模块不解除生产 OSS 删除限制，不替换现有 third RPC，不发布 WGT，不修改 OSS 生命周期。
