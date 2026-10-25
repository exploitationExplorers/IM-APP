# OpenIM 聊天 OSS 测试适配层（非生产构建）

锁定上游 `openimsdk/open-im-server v3.8.3-patch.15`、`openimsdk/tools v0.0.50-alpha.106`。
该版本原生 OSS 没有 key 前缀选项；仅改 `object.enable: oss` 或消息 name **不能隔离共享桶**。

该版本构造器也没有传入 SDK `UseCname`：只改 `bucketURL` 不会修正下载/PUT/HEAD/COPY 的主机。本测试补丁另外校验 tools OSS 源码指纹，将整个 tools 模块复制到传入的独立测试源码目录 `oss-test-tools`，仅在副本启用 CNAME，并通过 go.mod replace 使用副本。构造器只接受下面的私有香港测试桶/域名；不修改模块缓存或线上代码。

真实 H5 验证还发现 OSS V1 的 Content-Type 签名不一致：上游小文件预签名 PUT 未返回该 header，而 Web SDK 会自行补入图片 MIME，实际 OSS 返回 `403 SignatureDoesNotMatch`。测试补丁对缺省 PUT 和 multipart part 显式签入并返回 `application/octet-stream`，保留调用方已有 MIME、不修改调用方选项；H5 与 App 接收同一签名 header，不改 URL/host，也不通过放宽 RAM 或关闭校验绕过。原生桥仍须真机验证是否原样应用这些 header。

本适配层覆盖全部 `s3.Interface` 的物理 key 操作，包括 hash、临时对象、分片、签名、复制源与目标。
Mongo / Redis 内保留相对 key，返回给客户端的已签名 URL、header、policy 原样传递；元数据 engine 仍为 **`ali-oss`**（配置选择项才是 `oss`）。
依赖独立测试 Mongo / Redis 隔离去重；不能给生产库或生产镜像打这个补丁。

## 离线检查与构建

```powershell
# 当前目录 deploy/oss-test/openim-scope；只运行本地测试，不发云请求
go test ./...
node --test patch-openim.test.cjs

# 独立下载/复制出的可写上游源码，禁止填写生产 checkout 路径
node patch-openim.cjs <独立测试源码路径> --check
node patch-openim.cjs <独立测试源码路径> --apply
# 在该源码目录执行；先 go mod tidy，再只编译，不执行二进制
go build -o <测试产物目录>/openim-rpc-third ./cmd/openim-rpc/openim-rpc-third
```

补丁校验原始 third.go 和 tools OSS 文件的 SHA256，遇到其他版本或重复应用会拒绝。`--check` 不写测试源码（必要时下载已校验模块）；`--apply` 只改传入的测试源码、私有 tools 副本及 go.mod，不会启动 OpenIM 或访问 OSS。
校验的是上游原始 LF 文件；Windows checkout 不要自动转为 CRLF（可用固定 tag 的 Go 模块源码副本，或对测试 checkout 禁用 autocrlf）。
构建时本模块目录须保留在 go.mod replace 指向的位置。部署阶段应把编译好的第三方 RPC 二进制装入**独立测试镜像**，不覆盖生产镜像；本目录不自动执行这一操作。

## 仅测试进程的运行配置

```dotenv
IM_APP_ENV=oss-test
IM_APP_OSS_TEST_PREFIX=oss-test/chat/
IM_APP_OSS_TEST_DELETE_ENABLED=false
```

使用完整且独立的 OpenIM 配置目录，`openim-rpc-third.yml` 的 `object` 部分设置：

```yaml
object:
  enable: oss
  oss:
    endpoint: https://oss-chat-test.xn--jprz53bj9s.com
    bucket: yikeliao-188-hk-test
    bucketURL: https://oss-chat-test.xn--jprz53bj9s.com
    accessKeyID: "<仅在本地填写现有 RAM 凭据>"
    accessKeySecret: "<仅在本地填写>"
    sessionToken: ""
    publicRead: false
```

该上游 OSS 构造器没有正确注入 STS token，本轮只采用现有 RAM 长期密钥，不宣称支持 OpenIM STS。业务服务 OSS 则支持 session token。
使用 HTTPS 公网 bucketURL，不签内网 URL 后替换 host。保留 `publicRead: false`，不修改共享桶 ACL。

补丁把 `contracts/oss_test.go.in` 放入私有 tools 的实际 OSS 包；在独立 OpenIM 源码目录执行 `go test github.com/openimsdk/tools/s3/oss`。3 项契约测试只用假凭据，检查 SDK 原生签名的精确 host、canonical bucket/key/MIME、表单 policy、分片 header、图片参数和危险配置拒绝，不发云请求。新增 MIME 回归在旧签名器复现失败，在新签名器通过；镜像构建也必须执行这一步。务必确认 go.mod 的 tools replace 指向当前私有副本，出现 `[no test files]` 不能计为通过。

Mongo 必须使用 `openim_oss_test` 库、同名 authSource、`im_oss_test` 用户、空 URI 和独立服务地址 `openim-mongodb:27017`（宿主验证可用 `127.0.0.1:27027`）；Redis 为独立 `openim-redis:6379`（或 `127.0.0.1:16380`）且配置密码。补丁在 third.Start 访问数据库前检查这些条件；**不是所有 OpenIM 服务的完整启动门禁**。
其余 RPC/API/WS 的 Mongo、Redis、Kafka、etcd、secret、webhook、域名仍须全部改到测试环境，不能只改 third。

## 安全边界与待验收

- 只允许固定 `oss-test/chat/` 前缀，拒绝空/越界/重复前缀和编码路径。
- DeleteObject / AbortMultipartUpload 默认返回禁用错误；上传完成时上游忽略临时对象清理错误，因此测试临时对象可能残留。禁止给整个共享桶加清理生命周期。
- 显式允许清理后也只处理该前缀，但上线清理仍需独立的引用检查与变更审批，本轮不实现/启动。
- 同前缀内保留上游 hash 复用和拷贝行为，不保证测试对象不可覆盖；**不能触及前缀外已有生产对象**。同 RAM 权限不是云端硬隔离。
- 单元测试与真实上游编译不能代替联调：H5/App 图片原图+独立缩略图、语音、视频封面、文件、转发、断点分片与过期后读取仍需在独立测试环境验证。
- 切换前已有 MinIO 消息和对象不迁移、不改 URL；不要把导入 MinIO 元数据直接改成 ali-oss。历史消息/收藏跨 provider 的解析和迁移另行验收。
