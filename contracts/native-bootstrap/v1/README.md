# 原生启动阶段的既有接口契约

此目录冻结当前 Go 服务已经提供的认证接口，不新增路由，不要求部署后端。所有 fixture 为合成数据，`example.invalid` 不是真实服务地址，不能用于登录。

- Android 使用 `platformId=2`，iOS 使用 `platformId=1`；旧客户端省略字段时的默认值 `5` 保持不变。
- 业务用户 ID 与 OpenIM 用户 ID 分开保存。样本刻意使用不同 ID，测试必须能发现错误混用。
- 业务登录成功、获取 IM Token、SDK 登录成功、本地库可读、同步完成是不同步骤。
- 真正的聊天历史和收发后续走经过兼容性验证的 OpenIM SDK；本地样例不作为真实消息或送达结果。
- 用户现已授权使用既有后端，普通登录默认采用 `runtime-endpoints.json` 中已验证的 HTTPS 入口，无需先配置隐藏地址；只有用户点击登录才发认证请求。构建与单测仍只用本地合成数据，不自动登录生产或发短信。
- 业务登录调用 `POST /auth/login` 与 `GET /me`，成功显示真实账号资料；当前 SDK 尚未接入，登录不申请未使用的 IM Token，也不标记消息库或同步就绪。

在仓库根目录运行 `python contracts/native-bootstrap/v1/verify_contract.py`，检查契约与现有 Go 路由、请求 DTO、响应结构一致。该检查读取源码，不启动服务或访问数据库。
