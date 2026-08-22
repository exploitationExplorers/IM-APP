# Linux 服务器群聊测试脚本执行指南

本文用于在 Linux 测试服务器上执行群人数上限、测试用户注册和群消息已读回归脚本。

脚本只调用业务公开 API，不直接写数据库，也不会自动删除测试用户或群。生成的清单包含登录 token，只能用于测试环境。

## 一、进入脚本目录

先进入部署后的服务端项目目录。请把 `/data/IM-APP` 替换成服务器上的真实项目路径：

```bash
cd /data/IM-APP/IM-APP-server/scripts/testdata
pwd
ls -la
```

目录中应当包含：

```text
prepare-im-users.sh
verify-im-users.sh
prepare-test-group.sh
test-group-capacity.sh
test-group-read.sh
testdata-common.sh
```

赋予执行权限并检查脚本语法：

```bash
chmod +x ./*.sh
bash -n ./*.sh
```

`bash -n` 没有任何输出且退出码为 `0`，表示语法检查通过：

```bash
echo $?
```

## 二、安装依赖

脚本需要 `bash`、`curl` 和 `jq`。

Ubuntu、Debian：

```bash
sudo apt-get update
sudo apt-get install -y bash curl jq
```

CentOS、Rocky Linux、AlmaLinux：

```bash
sudo dnf install -y bash curl jq
```

检查版本：

```bash
bash --version | head -n 1
curl --version | head -n 1
jq --version
```

## 三、确认服务地址

默认业务接口地址为：

```text
http://127.0.0.1:8080
```

默认管理后台接口地址为：

```text
http://127.0.0.1:8081
```

如果服务使用其他地址，通过环境变量覆盖：

```bash
export BASE_URL='http://127.0.0.1:8080'
export APP_BASE_URL='http://127.0.0.1:8080'
export ADMIN_BASE_URL='http://127.0.0.1:8081'
```

先确认服务能够访问。具体健康检查路径以服务器部署配置为准，也可以直接检查端口：

```bash
curl -I "$BASE_URL"
curl -I "$ADMIN_BASE_URL"
```

如果业务服务运行在 Docker 容器中，但脚本在宿主机执行，地址应填写宿主机映射端口；如果脚本也在容器内执行，应填写容器网络中的服务名和端口。

## 四、开启测试短信验证码

创建新用户时，测试环境的业务服务必须配置 `DEV_SMS_CODE`，短信接口才会返回 `devCode`。

例如：

```bash
export DEV_SMS_CODE='123456'
```

注意：仅在当前终端执行 `export` 不会修改已经运行的服务进程。必须把变量配置到业务服务的启动环境中，然后重启业务服务。

本项目的 `docker-compose.yml` 已经把 `DEV_SMS_CODE` 传给 `api` 服务。使用 Docker Compose 部署时，在 `IM-APP-server/.env` 中设置：

```dotenv
DEV_SMS_CODE=123456
```

然后重新创建 API 服务：

```bash
cd /data/IM-APP/IM-APP-server
docker compose up -d --force-recreate api
docker compose logs --tail=100 api
```

不要在生产环境开启固定验证码。

## 五、创建并注册 OpenIM 测试用户

下面创建 20 个测试用户，批次目录名为 `local-read`：

```bash
./prepare-im-users.sh 20 local-read
```

脚本生成的手机号格式为：

```text
19900000000
19900000001
19900000002
...
```

手机号固定为 11 位。脚本会依次完成：

1. 业务用户注册；已有用户则自动登录。
2. 调用 `/api/v1/im/token`。
3. 触发 OpenIM 用户注册或同步。
4. 验证 OpenIM userId 和 token。
5. 将结果写入 JSONL 清单。

默认清单位置：

```text
IM-APP-server/.tmp/testdata/local-read/users.jsonl
```

从当前脚本目录查看：

```bash
jq -c '{phone,userId,imUserId,openIMTokenVerified}' \
  ../../.tmp/testdata/local-read/users.jsonl
```

重复执行同一批次时，已经写入清单的手机号会显示 `SKIP`，不会重复追加。

如果要调整密码或手机号前缀：

```bash
export TEST_PASSWORD='Test123456!'
export PHONE_PREFIX='1980000'
./prepare-im-users.sh 20 another-batch
```

`PHONE_PREFIX` 必须为 7 位数字，因为脚本会在后面追加四位序号。

## 六、验证业务用户和 OpenIM 用户

执行：

```bash
./verify-im-users.sh ../../.tmp/testdata/local-read/users.jsonl
```

每个用户都应输出一行 `OK`：

```text
OK 19900000000 im_user_xxx
OK 19900000001 im_user_xxx
```

任意用户登录失败、OpenIM token 获取失败或 OpenIM userId 不匹配，脚本都会以非 `0` 状态退出。

## 七、创建测试群

至少需要先准备 3 个测试用户。执行：

```bash
./prepare-test-group.sh \
  ../../.tmp/testdata/local-read/users.jsonl \
  '群容量与已读测试群'
```

第一个测试用户是群主，第二、第三个测试用户作为初始成员。

生成文件：

```text
IM-APP-server/.tmp/testdata/local-read/group.json
```

查看群和测试用户信息：

```bash
jq '{group:.group,owner:{phone:.owner.phone,userId:.owner.userId},userCount:(.users|length)}' \
  ../../.tmp/testdata/local-read/group.json
```

## 八、执行群人数上限测试

容量测试至少需要 4 个测试用户，因为前三个用户已经用于创建群，第四个用户用于测试达到上限后是否还能加入。

### 1. 获取管理后台 token

先登录管理后台，取得管理端 access token。不要使用普通 App 用户 token。

将 token 放入当前终端变量，避免直接写进脚本：

```bash
read -rsp '请输入管理后台 access token: ' ADMIN_TOKEN
echo
export ADMIN_TOKEN
```

### 2. 获取管理后台群 UUID

参数 `admin_group_uuid` 是管理后台群列表接口返回的内部 UUID，不是 OpenIM groupID，也不是 App 页面展示的群公开 ID。

可以从管理后台群列表页面或对应管理端接口响应中获取。

设置变量：

```bash
export ADMIN_GROUP_UUID='替换成管理后台群UUID'
```

### 3. 执行容量边界测试

把该群人数上限设置为 3，然后让第四个用户尝试加入：

```bash
./test-group-capacity.sh \
  ../../.tmp/testdata/local-read/group.json \
  "$ADMIN_TOKEN" \
  "$ADMIN_GROUP_UUID" \
  3
```

预期输出：

```text
PASS：达到上限后新增成员被拒绝，现有成员未被移除。
```

该测试会修改这个测试群的单群人数上限配置，不会修改全局默认值。

## 九、执行群消息已读测试

已读测试需要两个测试账号：发送者和阅读者。还需要一条已经发送成功的群消息的 `conversationId` 和 `seq`。

### 1. 在客户端发送测试消息

1. 使用清单中的群主账号登录 App 或 H5。
2. 打开刚创建的测试群。
3. 发送一条普通文字消息。
4. 从客户端调试日志或消息对象中取得该消息的 `conversationId` 和正整数 `seq`。
5. 保持阅读者账号暂时不要打开这个群，便于观察已读游标变化。

查看清单中前两个用户的 token：

```bash
jq -r 'select(input_line_number <= 2) | [.phone,.accessToken] | @tsv' \
  ../../.tmp/testdata/local-read/users.jsonl
```

也可以用下面的命令直接载入变量：

```bash
USERS_FILE='../../.tmp/testdata/local-read/users.jsonl'
export SENDER_TOKEN="$(sed -n '1p' "$USERS_FILE" | jq -r '.accessToken')"
export READER_TOKEN="$(sed -n '2p' "$USERS_FILE" | jq -r '.accessToken')"
```

### 2. 准备群公开 ID

从 `group.json` 读取群公开 ID。业务建群接口的 `group.id` 就是客户端使用的群公开 ID，不是数据库内部 UUID：

```bash
jq '.group' ../../.tmp/testdata/local-read/group.json
export GROUP_PUBLIC_ID="$(jq -r '.group.id' ../../.tmp/testdata/local-read/group.json)"
```

### 3. 执行已读测试

填写客户端取得的会话 ID 和消息 seq：

```bash
export CONVERSATION_ID='替换成OpenIM会话ID'
export MESSAGE_SEQ='替换成消息seq'

./test-group-read.sh \
  "$CONVERSATION_ID" \
  "$GROUP_PUBLIC_ID" \
  "$MESSAGE_SEQ" \
  "$SENDER_TOKEN" \
  "$READER_TOKEN"
```

脚本会完成：

1. 使用发送者 token 查询测试前的 `maxOtherReadSeq`。
2. 使用阅读者 token 标记群会话已读。
3. 上报阅读者的 OpenIM 已读游标。
4. 再使用发送者 token查询 `maxOtherReadSeq`。
5. 验证最大已读游标不小于测试消息 seq。

预期输出示例：

```text
PASS：before=0, reader=123, after=123
```

这表示至少一名其他群成员已经读到该消息，发送者界面应从单勾更新为双勾。

## 十、一次完整执行示例

以下命令可按顺序执行。管理后台 token、群 UUID、会话 ID 和消息 seq 仍需替换成真实值：

```bash
cd /data/IM-APP/IM-APP-server/scripts/testdata
chmod +x ./*.sh
bash -n ./*.sh

export BASE_URL='http://127.0.0.1:8080'
export APP_BASE_URL='http://127.0.0.1:8080'
export ADMIN_BASE_URL='http://127.0.0.1:8081'

./prepare-im-users.sh 20 local-read
./verify-im-users.sh ../../.tmp/testdata/local-read/users.jsonl
./prepare-test-group.sh ../../.tmp/testdata/local-read/users.jsonl '群容量与已读测试群'

read -rsp '请输入管理后台 access token: ' ADMIN_TOKEN
echo
ADMIN_GROUP_UUID='替换成管理后台群UUID'
./test-group-capacity.sh ../../.tmp/testdata/local-read/group.json \
  "$ADMIN_TOKEN" "$ADMIN_GROUP_UUID" 3

USERS_FILE='../../.tmp/testdata/local-read/users.jsonl'
SENDER_TOKEN="$(sed -n '1p' "$USERS_FILE" | jq -r '.accessToken')"
READER_TOKEN="$(sed -n '2p' "$USERS_FILE" | jq -r '.accessToken')"
GROUP_PUBLIC_ID="$(jq -r '.group.id' ../../.tmp/testdata/local-read/group.json)"
CONVERSATION_ID='替换成OpenIM会话ID'
MESSAGE_SEQ='替换成消息seq'

./test-group-read.sh "$CONVERSATION_ID" "$GROUP_PUBLIC_ID" "$MESSAGE_SEQ" \
  "$SENDER_TOKEN" "$READER_TOKEN"
```

## 十一、常见问题

### `Permission denied`

执行：

```bash
chmod +x ./*.sh
```

也可以直接使用 Bash 执行：

```bash
bash ./prepare-im-users.sh 20 local-read
```

### `/usr/bin/env: 'bash\r': No such file or directory`

说明脚本被转换成了 Windows CRLF 换行。仓库已经通过 `.gitattributes` 固定 `.sh` 为 LF；如果服务器上的旧文件仍有问题，可以执行：

```bash
sed -i 's/\r$//' ./*.sh
```

### `缺少 jq` 或 `缺少 curl`

按本文“安装依赖”章节安装后重试。

### 短信接口没有返回 `devCode`

确认业务服务进程的启动环境中已经配置 `DEV_SMS_CODE`，并且服务已经重启。不要只在执行脚本的终端中设置。

### `API failed` 或连接被拒绝

检查：

```bash
echo "$BASE_URL"
echo "$ADMIN_BASE_URL"
ss -lntp | grep -E ':8080|:8081'
```

同时检查反向代理路径、Docker 端口映射和服务日志。

### 容量测试意外加群成功

重点检查：

1. `ADMIN_GROUP_UUID` 是否为管理后台内部群 UUID。
2. 测试群当前成员数是否已经等于设置的上限。
3. 管理端人数上限更新接口是否返回成功。
4. App 服务和管理服务是否连接同一套数据库。

### 已读测试失败

重点检查：

1. `MESSAGE_SEQ` 必须是发送成功后的正整数 seq，不能传本地占位消息的 `0`。
2. `CONVERSATION_ID` 必须与这条群消息属于同一会话。
3. 发送者和阅读者必须是不同用户。
4. 阅读者必须仍是该群成员。
5. App 服务必须能访问 OpenIM，阅读者 token 必须能正常获取 OpenIM token。

## 十二、安全与清理

- `users.jsonl` 和 `group.json` 包含测试 token，不要提交 Git，不要发送到聊天群。
- 不要在生产环境开启固定短信验证码。
- 不要把管理后台 token 写死到脚本或文档。
- 脚本不会自动删除用户和群，测试结束后请通过管理后台删除测试群，并按现有测试数据清理流程处理测试账号。
- 清理前必须核对具体群 ID 和用户 ID，不要按宽泛手机号范围直接批量删除。
