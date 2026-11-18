# 授权测试账号模拟器验证

日期：2026-11-17。独立设备 `IM-iOS-Refactor-20261117`，iOS 27.2。使用用户提供并授权的测试账号；本文不记录密码、会话令牌或完整手机号。保留原运行模拟器的账号数据。测试设备保持登录并停留聊天首页。

## 已执行

- 业务密码登录、SDK 连接、本地历史可读与同步完成；首页状态实际显示“已连接 · 本地可读 · 同步完成”。
- 打开“初心帮”群，加载已有文本、图片、撤回和系统通知。部分系统通知仍显示通用占位文案，不能据此声称所有消息类型已对齐。
- 长按文字消息进入引用，确认发送者、正文、取消入口及输入提示；取消后恢复普通输入。
- 长按已有图片进入引用，确认缩略图、发送者、图片摘要；取消成功。没有实际发送引用消息。
- 群详情待审核角标显示 2，申请页实际列出两条 pending 记录；未执行审批。
- 群详情“＋”直接进入邀请好友页，当前候选列表为空；取消返回群详情成功。未提交邀请，也未证明邀请提交成功链路已通过。
- 结束 App 进程后重新启动，无需重新输入密码恢复聊天首页，SDK 再次连接并同步完成。

## 发现与处理

初次模拟器键盘输入将密码字母变成大写；用户指出后清空重填，并在输入框核对为小写。不能把此前登录失败归因于用户提供的凭据。

正确凭据登录和资料请求完成后，App 仍返回登录页。通过调试器在错误处理处确认 `NativeVaultError.unavailable`，在 `NativeSessionVault.load()` 确认 `SecItemCopyMatching` 返回 `-34018`。无签名构建缺少正常模拟器签名产物。改用以下命令重新构建、在独立设备覆盖安装（保留数据）后，真实登录与进程重启恢复均成功：

```sh
xcodebuild -workspace IM-APP-ios/IMNative.xcworkspace -scheme IMNative \
  -sdk iphonesimulator -configuration Debug \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath .native-cache/DerivedData \
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- build
```

`simulator-signed-build.log` 保存该次 `BUILD SUCCEEDED` 记录。同步修正 `IM-APP-ios/scripts/verify_on_mac.sh` 的模拟器构建签名参数及报告范围；保留 Keychain 安全存储、账号隔离、设备签名要求和发布门禁。

## 验证边界

没有向其他用户或群发送测试消息，没有审批、邀请、踢人或删除消息。实际引用发送/媒体保护、转发完成、断网未知结果、视频互通、角色权限完整矩阵、APNs、真机、覆盖升级尚未验证。核心测试数量沿用上轮已完成的 153 项；本次运行验证没有重跑并冒充新增测试结果。
