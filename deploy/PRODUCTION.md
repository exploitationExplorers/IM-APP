# 现有线上 OSS 服务：新版宝塔发布

适用分支 `feat/chat-image-speed`，后端 `8.154.44.197`、前端 `8.217.171.178`。

## 本次后端最短流程

完整说明在源码仓库 `deploy/openim-retention/OBJECT-GC.md`；增量包内为 `OBJECT-GC.md`。

1. 按 `ram-chat-gc-policy.json` 给现有 RAM 用户追加新聊天 managed-v1 前缀删除权限和只读版本查询权限。保留旧授权和 AK/SK，业务桶不授权删除，聊天桶须从未开启版本控制。
2. 本地完成测试，执行 `node deploy/openim-retention/build-release.cjs`，上传生成的新 `media-gc-release-*` 包到后端宝塔 `/root/im-app-retention/` 并解压。
3. 在解压的新包目录执行：

```bash
sha256sum -c SHA256SUMS && python3 cleanup-production.py deploy
python3 cleanup-production.py status
```

默认打开全群“最近 72 小时 ∪ 最近 3000 条”并集逻辑策略（可由管理后台 system.limits / 单群覆盖调整），**可能立即处理当日旧任务**；受控 OSS GC 在全部运行进程 SHA/健康/私网/RAM/版本探针通过后自动激活，每日北京时间 03:30。头像、收藏、转发副本、单聊及永久保护保留；仅回收新 managed-v1 文件，旧对象不扫，Mongo 正文清理不启用。

脚本保留基础 Compose → 原 OSS 私密 override → 新版本覆盖层的顺序；以当前镜像叠加二进制，不回退原 OSS 配置。复用现有私有桥 key；不重新生成媒体签名 key。只重启两个应用容器，有短暂重连；不重启数据库/Redis/Kafka，不删卷，不导出/恢复数据库。不执行裸 `docker compose up -d --build`、整栈 down 或 prune。

日常管理：

```bash
python3 cleanup-production.py preview # 只读一批
python3 cleanup-production.py run     # 手动一批，最多50个
python3 cleanup-production.py disable
python3 cleanup-production.py enable
```

没有成功标记且状态 `active=true`，不能说线上已经开启。首次删除须等上传缓冲/引用过期/隔离期，不会立即清掉全部历史存储。失败时保留 private 及安全输出；不要覆盖已安装旧包，不要绕过二进制校验或恢复数据库。

## 前端与手机

此次 GC 改动不涉及前端缓存或原生插件，无须为它单独发 WGT。若之前的群水位同步尚未发布到客户端，仍需发布相应前端并做三端验收，不能把后端升级视作旧 App UI 已同步。以下构建/发布说明继续有效：

## 7. 前端服务器：更新 H5

本轮仅改部署配置不需要额外前端修改；但如果现网仍未包含之前的群水位同步代码，必须同步发布当前分支 H5 和 App 资源，不能只上后端便开启清理。

在本机 `IM-APP-fronend`：

```powershell
npm run type-check
npm run test:unit
npm run build:h5
```

1. 在前端 `8.217.171.178` 宝塔「网站 → 正式域名 → 设置」确认真实站点根目录，保留旧 `index.html` 和资源。
2. 上传本次 `dist/build/h5/` 的内容：先传新增资源，最后替换 `index.html`。不要再套一层 `h5` 目录。
3. 不清空整个站点，不删除旧哈希资源、`/testapp/`、安装包、下载页、证书和原 Nginx 代理。
4. 浏览器强制刷新，确认登录、收发、媒体、收藏、转发正常。H5 使用同源 `/api/v1`，不要把后端 HTTP IP 写进 HTTPS 页面的请求地址。

## 8. iPhone / Android：WGT 内部验收，再发布目标渠道

- 本轮不换原生插件/权限，不重新签名 APK/IPA。先核对目标壳 appid、实际原生版本、当前资源版本和更新渠道。
- 保留目前已经验证可登录的 App API 地址；不要顺便变更域名或代理。内部资源用 `VITE_UPDATE_CHANNEL=canary`，客户版本按实际 `test/prod`；WGT 也能改变渠道，不能混发。
- 纯构建可用 `npm run pack:wgt -- --build --channel=canary`；会提升资源版本，但不上传、不发布。`pack:wgt:canary/customer` 自带 `--publish`，不是纯构建。
- 发布前参考前端 WGT 文档核对 `min-native` 与实际目标壳。内部渠道验收通过后才用明确客户渠道发布；不能因历史文档写了 100 就假设两端壳都为 100。
- 发布接口使用已验证可达的 **HTTPS** 网站入口和本机 Git 忽略的内部发布密钥文件，不把 key 放命令行/聊天，不通过公网 HTTP 传发布密钥。
- 真机两端都检查更新后的关于页版本，完成文字/图片/视频/语音/文件、收藏、转发、冷启动、离线重连、切账号和水位同步。H5 测试不能替代原生验收。

如果没有可接收 canary 的内部壳，先确认可用的内部测试分发方式，不能把未验收版本直接推给现有客户。WGT 不等于新 APK/IPA 下载包；本轮不替换现有下载页里的原生整包。


## 验收与暂停

以新包 `ACCEPTANCE.md` 和 `OBJECT-GC.md` 的真实状态为准，完整 OpenIM/Kafka、自然时间回收和真机验收仍需执行。不要在正式群灌 501 条、改线上时钟或手改账本加速测试。

关闭任务不会恢复已经过期的消息或已经删除的文件。保留新引用保护程序，禁止回滚到未实现 managed-v1 围栏的旧写入进程；禁止清空账本、降低 min_seq、删除映射或 tombstone。出现问题先 `disable`，再依据安全输出诊断。
