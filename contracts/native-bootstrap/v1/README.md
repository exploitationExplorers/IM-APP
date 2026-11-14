# 原生启动阶段的既有接口契约

此目录冻结当前 Go 服务已经提供的认证接口，不新增路由，不要求部署后端。所有 fixture 为合成数据，`example.invalid` 不是真实服务地址，不能用于登录。

- Android 使用 `platformId=2`，iOS 使用 `platformId=1`；旧客户端省略字段时的默认值 `5` 保持不变。
- 业务用户 ID 与 OpenIM 用户 ID 分开保存。样本刻意使用不同 ID，测试必须能发现错误混用。
- 业务登录成功、获取 IM Token、SDK 登录成功、本地库可读、同步完成是不同步骤。
- 真实聊天通过原生 OpenIM SDK adapter 接入；固定客户端版本与仓库服务版本已经核对来源，真实账号互通仍需验收。本地样例不作为真实消息或送达结果。

`im-runtime.contract.json` 记录本轮平台 2 / 1 的按需 Token、精确 HTTPS / WSS 地址升级和发送状态约束。业务认证 helper 仍只执行登录 / 资料请求；随后独立的聊天控制器为真实 SDK 登录申请一次 IM Token。连接、本地可读、云端同步分别显示，普通断线不重新签发 Token 或自动清库。

官方依赖：Android `io.openim:android-sdk:3.8.3.5` + `io.openim:core-sdk:3.8.3-patch10`；iOS `OpenIMSDK` / `OpenIMSDKCore 3.8.3-hotfix.15`。SDK API 证据及历史游标能力边界见 `.workflow/scratch/20261113-native-sdk/research.md`。这些固定版本是接入依据，同系列补丁不等于已经验证现网兼容。

- 用户现已授权使用既有后端，普通登录默认采用 `runtime-endpoints.json` 中已验证的 HTTPS 入口，无需先配置隐藏地址；只有用户点击登录才发认证请求。构建与单测仍只用本地合成数据，不自动登录生产或发短信。
- 业务登录 helper 调用 `POST /auth/login` 与 `GET /me`，成功显示真实账号资料；真实 SDK 的后续 Token 与连接流程独立执行，业务认证成功不标记消息库或同步就绪。

在仓库根目录运行 `python contracts/native-bootstrap/v1/verify_contract.py`，检查契约与现有 Go 路由、请求 DTO、响应结构一致。该检查读取源码，不启动服务或访问数据库。
