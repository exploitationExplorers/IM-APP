# API 开发规则

以下规则适用于本仓库所有新增接口和被改造的现有接口。

## 路由与参数

1. 查询接口只能使用 `GET`。
2. `GET` 的业务参数必须放在 URL query 中，例如 `GET /api/v1/files?fileId=xxx`。
3. 新增或改造的接口禁止使用动态路径参数，例如 `/:id`、`/{id}`。
4. 新增或改造的写操作统一使用 `POST`，包括创建、修改、删除、清空、启停、确认等操作。
5. `POST` 的全部业务参数必须放在 `application/json` 请求体中，不得放在 query 或动态路径中。
6. 鉴权信息继续放在请求头中，不属于业务参数。

## 命名示例

- 查询单个文件：`GET /api/v1/files?fileId=xxx`
- 清空会话消息：`POST /api/v1/im/conversation-messages/clear`，请求体为 `{"peerType":"c2c","peerId":"xxx"}`
- 完成文件上传：`POST /api/v1/files/uploads/complete`，请求体为 `{"fileId":"xxx"}`

## 实现要求

1. 路由必须使用静态路径。
2. Handler 必须校验必填字段、枚举值和请求体格式。
3. OpenAPI、Postman 集合和测试必须与实际路由同步更新。
4. 不得为了兼容而继续注册旧的动态路径写接口；确需兼容必须由用户明确批准。
