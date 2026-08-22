# 群容量与群已读独立测试脚本

这些脚本只通过公开业务 API 创建测试数据，不写业务迁移、不直接伪造 OpenIM 数据。`prepare-im-users.ps1` 会为每个 11 位手机号完成业务注册、调用 `/im/token` 触发 OpenIM `EnsureUser`，并确认拿到 OpenIM token；任何一层失败都会以非 0 退出。

```powershell
./prepare-im-users.ps1 -Count 20 -Batch local-read
./verify-im-users.ps1 -Manifest ../../.tmp/testdata/local-read/users.jsonl
./prepare-test-group.ps1 -Manifest ../../.tmp/testdata/local-read/users.jsonl
```

容量测试中的 `AdminGroupId` 是管理后台群列表返回的内部 UUID：

```powershell
./test-group-capacity.ps1 -GroupFile ../../.tmp/testdata/local-read/group.json `
  -AdminToken '<admin-access-token>' -AdminGroupId '<group-uuid>' -MaxMembers 3
```

服务端测试环境需设置 `DEV_SMS_CODE`，短信接口才会返回 `devCode`。手机号由 `1990000` 加四位序号组成，固定为 11 位；重复执行时会登录已有账号，因此脚本可续跑。清单中含测试 token，只能放在已被 `.gitignore` 排除的 `.tmp` 目录，禁止提交。

容量脚本需要管理端 access token；已读脚本需要先由任意客户端发送一条群消息，把其 `conversationId` 和 `seq` 传入。脚本不负责清理，避免按号码范围误删真实数据。
