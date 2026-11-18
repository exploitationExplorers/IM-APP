# Android 群申请修复对齐（2026-11-18）

## 对照范围与根因

基线 `08fbf23`，对照 Android `24ee6d3` 和 `0c5d0fc`。完成时再次 fetch origin，当前分支与远端同一提交，无新增待拉取提交。

| Android 修复 | iOS 核查与结果 |
| --- | --- |
| 按群号加入公开群，需审核时提交申请 | `NativeGroupsController.joinGroup` 已有相同格式校验、join POST 和审核分支；本次无需修改。未实际提交新入群申请。 |
| 申请业务通知、按群会话红点、接口对账 | 已复现缺失：原 iOS 只保留总数量，丢弃 groupConversationId，也未注册 SDK 业务通知监听。已修复。 |
| Compose 角标文字裁切 | iOS 使用居中 UILabel，没有同一 Compose 字体内边距问题；模拟器群详情数字 2 与首页数字 4 均完整显示。 |

因果链：服务端返回 count 与 groupConversationId → iOS PendingGroupJoinCount 只读取 groupId/count → 首页只绘制总角标 → 有申请的具体群无提醒；同时 ObjC 桥未注册 CustomBusinessListener，无法即时触发对账。这是 iOS 首次接入该业务链路时的遗漏；未追定更早引入提交。

修复保留一份包含总数量和群会话集合的快照；服务端计数为 0 时移除该群提醒。计数相同但申请转移到另一群时也通知界面。SDK 会话更新不覆盖独立业务快照；仅刷新受影响会话行。无内容时显示“[入群申请]”，正常消息摘要保留。红点代表尚未处理的申请，进入群后仍按服务端未处理状态对账。

SDK 通知只触发刷新，不创建聊天消息、不执行审核操作。复用原有可见页面轮询，前台恢复和同步完成主动对账；加载期间通知突发合并为一次后续刷新，停止后拒绝迟到结果。失败保留已知总数和红点。首页与群详情均接入该刷新来源，页面离开移除 observer、停止请求；后台不维持轮询。

## 官方文档与固定版本

修改前阅读 OpenIM 官方 iOS 自定义业务通知文档：
https://docs.openim.io/sdk/ios/message/receiving-messages/custom-business-listener

文档要求状态层持有 listener，结束会话移除，校验载荷，并区分业务通知与自定义聊天消息。官网样例回调参数为 NSString；本项目固定 OpenIMSDK `3.8.3-hotfix.15` 的 `Callbacker/OIMCallbacker.h:306` 声明 NSDictionary，`OIMCallbacker.m:662` 先解析 Core JSON 再在主队列交付。实现按固定头文件使用字典回调及 add/removeCustomBusinessListener，未修改 Pods。

业务载荷与服务端 `internal/service/group.go` 一致：key=group_join_request；data 可为字典或 JSON 字符串；兼容 camelCase/PascalCase。业务 API 的 groupConversationId 按服务端 `internal/im/client.go` 的 UUID 无连字符映射校验为 sg_ 加 32 位小写十六进制。

服务端通知是 online-only，离线错过通知时依赖前台接口对账恢复，不能据此宣称后台持续收取或 APNs 已验证。

## 验证

- 165 项 IMCore 测试通过，0 失败（原 159 项，新增 6 项）；完整输出见 core-tests.log。覆盖通知字典/JSON/字段别名、异常载荷、重复群计数、旧接口兼容、同总数换群、失败保留整份快照、刷新合并与停止后迟到响应。
- `python3 IM-APP-ios/scripts/verify_project.py`：8 项检查通过。
- `git diff --check`：通过。
- 固定依赖 Simulator Debug 本地签名编译通过；保留 CODE_SIGNING_ALLOWED=YES、CODE_SIGN_IDENTITY=-，以维持 Keychain 访问。见 build-result.log。编译仍存在原有并发隔离、Sendable 和 UIKit 弃用警告，未将其当成本次修复或无警告工程。
- 根据 oil-code-review 技能执行独立干净上下文只读五维审查：PASS；审查者亲自执行限定范围 diff 快测，未修改文件。

构建命令：

```bash
xcodebuild -workspace IM-APP-ios/IMNative.xcworkspace -scheme IMNative \
  -sdk iphonesimulator -configuration Debug \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath .native-cache/DerivedData \
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- build
```

## 模拟器复现与回归

设备 IM-iOS-Refactor-20261117 / iOS 27.2。使用已获授权的测试账号和已保存登录态，不在记录中保存凭据。覆盖安装保留数据，没有清 SDK 库。

1. 修复前：首页“初心帮”无申请红点，但群详情和入群申请列表已有 2 条待审核记录；底部有总数。
2. 修复后重启 App，自动恢复登录，SDK 已连接、本地可读、同步完成。首页“初心帮”和另一个有申请的群出现红点，VoiceOver 描述为“待审核入群申请”，底部总数 4。
3. 进入“初心帮”，历史消息正常；点击群标题进入详情，成员 17 人，入群申请角标 2 居中完整。
4. 打开入群申请列表，实际出现两条 pending 记录；未点击审批。逐级返回首页，红点与总数仍一致。

没有第二个申请账号，未实测新的入群申请经真实 SDK 推送到达；该分支只完成官方接口核对、实际 SDK 编译和可控刷新时序测试。没有发送消息、提交邀请或审批、改变群成员、执行发布。iPhone 真机、APNs、后台送达及 Release/Archive 未验证。

这是同一业务数据在 iOS 边界丢失的局部问题，已补行为回归测试；没有新增常驻规则或改动现有规范。
