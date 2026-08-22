# 群容量与群已读独立测试脚本

完整的服务器部署、参数获取和逐步执行说明见：`../../docs/Linux服务器群聊测试脚本执行指南.md`。

这些脚本只通过公开业务 API 创建测试数据，不写业务迁移、不直接伪造 OpenIM 数据。服务器以 Linux Bash 脚本为主；同名 `.ps1` 仅保留给 Windows 本地调试。`prepare-im-users.sh` 会为每个 11 位手机号完成业务注册、调用 `/im/token` 触发 OpenIM `EnsureUser`，并确认拿到 OpenIM token；任何一层失败都会以非 0 退出。

Linux 服务器需安装 `bash`、`curl`、`jq`：

```bash
cd IM-APP-server/scripts/testdata
chmod +x ./*.sh
./prepare-im-users.sh 20 local-read
./verify-im-users.sh ../../.tmp/testdata/local-read/users.jsonl
./prepare-test-group.sh ../../.tmp/testdata/local-read/users.jsonl
```

容量测试中的 `AdminGroupId` 是管理后台群列表返回的内部 UUID：

```bash
./test-group-capacity.sh ../../.tmp/testdata/local-read/group.json \
  '<admin-access-token>' '<group-uuid>' 3
```

群已读测试需先从客户端拿到一条已发送群消息的 `conversationId` 和 `seq`：

```bash
./test-group-read.sh '<conversation-id>' '<group-public-id>' '<message-seq>' \
  '<sender-access-token>' '<reader-access-token>'
```

可通过环境变量覆盖地址：`BASE_URL`、`APP_BASE_URL`、`ADMIN_BASE_URL`；生成用户时还支持 `PHONE_PREFIX`、`TEST_PASSWORD`、`COUNT`、`BATCH`。

服务端测试环境需设置 `DEV_SMS_CODE`，短信接口才会返回 `devCode`。手机号由 `1990000` 加四位序号组成，固定为 11 位；重复执行时会登录已有账号，因此脚本可续跑。清单中含测试 token，只能放在已被 `.gitignore` 排除的 `.tmp` 目录，禁止提交。

容量脚本需要管理端 access token；已读脚本需要先由任意客户端发送一条群消息，把其 `conversationId` 和 `seq` 传入。脚本不负责清理，避免按号码范围误删真实数据。
