# OpenIM 3.8.3 服务器 Webhook 启用步骤

## 1. 前提

Go 后端必须先部署为 OpenIM 容器能够访问的内网地址。以下值不能复用 `OPENIM_SECRET`：

```text
IM_INTERNAL_API_KEY=<独立随机值，只供内部运维接口>
OPENIM_WEBHOOK_SECRET=<独立随机值，只供回调路径>
OPENIM_WEBHOOK_ALLOW_CIDRS=<openim-server 容器实际出口IP/32>
LEGACY_CHAT_ENABLED=false
```

后端回调基址为：

```text
http://<Go后端内网地址>:8080/internal/openim/webhooks/<OPENIM_WEBHOOK_SECRET>
```

不要把上面的完整地址、两个独立密钥写到公开日志或提交到 Git。

## 2. 找到 OpenIM 实际配置挂载

在 `/opt/openim-docker` 执行：

```bash
docker inspect openim-server \
  --format '{{range .Mounts}}{{println .Source "->" .Destination}}{{end}}'

docker inspect openim-server \
  --format '{{range .NetworkSettings.Networks}}{{println .IPAddress}}{{end}}'

docker exec openim-server sh -c \
  'find /openim-server /etc/openim -name webhooks.yml -type f 2>/dev/null'
```

把第二条输出的容器 IP 以 `/32` 写入 Go 后端 `OPENIM_WEBHOOK_ALLOW_CIDRS`。编辑第一条显示的宿主机挂载源里的 `webhooks.yml`；不要只改容器临时文件。

## 3. 先验证容器到后端可达

替换下面三个占位值后执行。预期 HTTP 200 且 `nextCode=0`；测试发送者使用 `imAdmin`，不会依赖业务用户数据。

```bash
docker exec openim-server sh -c 'wget -qO- \
  --header="Content-Type: application/json" \
  --post-data='"'"'{"callbackCommand":"callbackBeforeSendSingleMsgCommand","sendID":"imAdmin","recvID":"imAdmin"}'"'"' \
  "http://<Go后端内网地址>:8080/internal/openim/webhooks/<OPENIM_WEBHOOK_SECRET>/callbackBeforeSendSingleMsgCommand?contenttype=json"'
```

如果返回 404，优先检查：后端 `OPENIM_WEBHOOK_SECRET`、容器出口 IP 白名单、地址是否能从容器访问。

## 4. 修改 OpenIM v3.8.3 的 `webhooks.yml`

保留文件其他配置，只修改 `url` 和以下五个开关：

```yaml
url: http://<Go后端内网地址>:8080/internal/openim/webhooks/<OPENIM_WEBHOOK_SECRET>

beforeSendSingleMsg:
  enable: true
  timeout: 5
  failedContinue: false
  allowedTypes: []
  deniedTypes: []

afterSendSingleMsg:
  enable: true
  timeout: 5
  attentionIds: []
  allowedTypes: []
  deniedTypes: []

beforeSendGroupMsg:
  enable: true
  timeout: 5
  failedContinue: false
  allowedTypes: []
  deniedTypes: []

afterSendGroupMsg:
  enable: true
  timeout: 5
  allowedTypes: []
  deniedTypes: []

afterRevokeMsg:
  enable: true
  timeout: 5
```

`failedContinue: false` 表示业务权限回调不可用时拒绝发送。必须先完成第 3 步再启用，避免因网络配置错误阻断全部消息。

## 5. 重启和验收

```bash
cd /opt/openim-docker
docker compose restart openim-server
docker compose ps openim-server
docker compose logs --tail=200 openim-server
```

随后按顺序验收：

1. 好友双方能发单聊，非好友或任一方向拉黑后拒绝。
2. 正常群成员能发群消息，非成员、被禁言成员、全员禁言下普通成员被拒绝。
3. 发送和撤回后，PostgreSQL `im_message_audit` 只增加元数据，不出现消息正文。
4. `GET /internal/im/health` 需携带 `X-Internal-API-Key`，并确认 `apiReachable=true`、`adminTokenAvailable=true`、`outboxDead=0`。

配置依据：OpenIM 3.8.3 会将 `webhooks.yml` 的 `url` 与具体 `callbackCommand` 拼接，后端已经注册这五个对应路径。
