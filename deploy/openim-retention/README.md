# 群消息保留与 OSS 聊天文件定期回收

当前分支：`feat/chat-image-speed`。

## 本次版本

- 群逻辑保留默认开启：每群最近 168 小时且最多 1500 条真实可见消息（管理后台可改默认与按群覆盖）。
- 新增 OSS managed-v1 无引用聊天文件每日回收，部署全部校验通过后默认激活；北京时间 03:30，限量分批，不扫整桶。
- 头像/收藏/转发副本长期保留；单聊、永久保护及无法证明全部过期的引用不删除。
- 只管理新增 `im-app-production/chat/managed-v1/` 对象；旧聊天对象及 MinIO 保留，不做不安全的历史猜删。
- 上传能力缓冲至少 8 天，额外隔离至少 24 小时；7 天消息可见期不等于文件立即删除期限。
- Mongo 正文物理清理仍关闭，以免丢失回收证据。`19093` 的旧逻辑桥 `objectPurge=off` 仅描述该桥；新 GC 状态由私有 `19094` 单独提供。

**详细部署、RAM 操作、启停命令和边界见 [OBJECT-GC.md](OBJECT-GC.md)。**

```bash
# 上传并解压本次新包后，在后端宝塔的新包目录执行
sha256sum -c SHA256SUMS && python3 cleanup-production.py deploy
python3 cleanup-production.py status
```

脚本复用当前运行中的 OSS 镜像为基底，保留旧两份私密 override、凭据及媒体签名 key；更新业务 API 与 OpenIM msg/msgtransfer/third/user/group 五类二进制，验证所有运行中进程，不动数据服务/卷，不恢复数据库。不能再拿旧 visibility-release 包执行本次新命令。

## 本机测试与构建

```powershell
$env:GO_EXECUTABLE='D:\Program Files\Go\bin\go.exe'
node --test deploy/openim-retention/test-patch.cjs deploy/openim-retention/test-release.cjs
python -m unittest discover -s deploy/openim-retention -p 'test*.py'
python deploy/openim-retention/test-integration.py --build-linux
node deploy/openim-retention/build-release.cjs
```

基于固定 `OpenIM v3.8.3-patch.15` / `tools v0.0.50-alpha.106` 的一次性源副本；不修改 Go module cache。集成测试仅用独立本机回环 Mongo/Redis，新二进制 Linux/amd64 构建不含密钥/H5/WGT、不执行发布。产物为被 Git 忽略的 `artifacts/media-gc-release-*`。

完整 OpenIM/Kafka 与 iPhone/Android/H5 验收见 [ACCEPTANCE.md](ACCEPTANCE.md)。本次代码完成和本地测试通过，不等于已在线上开启，不等于实际 OSS 空间已经释放。正文清理的独立、默认关闭实现见 [BODY-PURGE.md](BODY-PURGE.md)。

前后端整体部署参见 [PRODUCTION.md](../PRODUCTION.md)。
