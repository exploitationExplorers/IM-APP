# 前端（IM-APP-fronend）开发准则

> 面向「front 前端项目」的生成与修改。改任何前端代码前先读这一段。

生成或修改 **IM-APP-fronend（front 前端）** 相关代码时，**不能只关注 H5 平台下的改动，必须同步考虑并兼容 App 原生端**。

## 关键背景

- 该项目是 uni-app，同一份代码运行于 **H5、App 原生、小程序** 等多种平台。
- OpenIM App 原生桥在部分版本使用 **PascalCase** 字段（如 `VideoElem`、`VideoUrl`、`SnapshotUrl`），与 Web SDK 的 camelCase（`videoElem`、`videoUrl`）不同。
- **H5 下验证通过的改动，不代表 App 端可用**；反之亦然。两条平台链路必须同时走通。

## 必须做到

1. 解析 / 构造消息字段（尤其是视频、图片、语音、文件等媒体消息）时，同时兼容 camelCase 与 PascalCase 两种字段命名。
2. 涉及跨端能力（媒体保存、转发、缩略图、已读游标、SDK 方法调用）时，分平台分支处理（如 `isAppPlatform`），不要默认只按 H5 实现。
3. 改动后必须检查对 App 端的影响：H5 客户端 SDK 存在的方法 App 原生桥可能不存在，App 原生桥存在的方法 H5 也可能没有，缺一不可。
4. 不要把只在 H5 验证过的逻辑当作通用正确实现，也不要把 App 端修复当成 H5 无关。

## 参考实现

- `IM-APP-fronend/src/utils/chatMedia.ts` — 视频消息元数据解析（兼容两种命名）
- `IM-APP-fronend/src/utils/forwardSnapshot.ts` — 转发快照规范化
- `IM-APP-fronend/src/utils/openim.ts` — SDK 方法按平台分支（`isAppPlatform`）


## oil-dev 项目开发约定

本节适用于本仓库的 oil-bug-fix、oil-code-review、oil-explore。技能安装在 `.agents/skills/`，适配与来源见 [集成记录](docs/oil-dev-skills集成.md)。本节补充上游流程；与既有业务规则冲突时，以用户指示和适用目录规范为准。

- 快测：`git diff --check`
- 门禁：`git diff --check`
- 高风险目录：`IM-APP-ios/Packages/IMCore/`、`IM-APP-ios/IMNative/NativeIMService*`、`IM-APP-ios/IMNative/NativeOpenIM*`、`IM-APP-ios/IMNative/NativeMedia.swift`、`IM-APP-ios/IMNative/NativeConversationViewController.swift`、`IM-APP-fronend/src/utils/openim*`、`IM-APP-fronend/src/stores/`、`IM-APP-server/internal/`、`IM-APP-server/migrations/`、`IM-APP-ios/IMNative.xcodeproj/`、`IM-APP-ios/Podfile*`
- 禁改目录：`原型/`、`IM-APP-ios/Pods/`、`IM-APP-ios/vendor/`、`IM-APP-fronend/node_modules/`

上述公共快测仅检查 diff 格式，不能代替业务验收；门禁必须再按受影响模块选择以下真实入口。先读相应脚本，避免把发布、依赖更新或线上操作当测试。

| 模块 | 当次验证入口 | 边界 |
| --- | --- | --- |
| iOS 工程 | `python3 IM-APP-ios/scripts/verify_project.py` | 工程引用和配置检查，不代表运行验收 |
| IMCore | `swift test --package-path IM-APP-ios/Packages/IMCore`；局部可加 `--filter <实际测试名>` | 纯规则测试不替代 UIKit / SDK 集成 |
| iOS UI / 桥接 | 固定依赖的 Xcode Debug 编译及受影响模拟器流程；桥接关键行为需真机 | 按 docs/iOS原生开发代码与架构规范.md 执行，不等合并前才编译 |
| uni-app | 在 IM-APP-fronend 执行 `npm run type-check`、`npm run test:unit -- <实际测试文件>` | 涉及媒体命名时另跑 `npm run test:video-compat`；按风险跑 build:h5 与 build:app，H5 验证不等于原生通过 |
| Go | 在 IM-APP-server 执行 `go test ./<受影响包路径>`，并发变更按需 `go test -race ./<受影响包路径>` | 包路径从实际代码确定；集成测试先核对环境，禁止连接生产库代替隔离测试 |

### 执行范围与授权

1. 先复现并追因果链，无法复现时区分证据与推断。全仓搜索同类问题是只读排查；仅在当前任务授权范围内修复，其余报告位置与风险，不自动重构或扩展功能。
2. 已有授权持续有效，不因技能中的确认步骤重复询问。高风险标记要求加强审查与验证，不自动等于需要再次批准；真实破坏性操作、对外发布或新增授权仍按当前会话要求处理。
3. oil-explore 保持只读；oil-code-review 默认只读。独立审查或故障止损可使用宿主原生只读子 Agent，遵守宿主工具和模型权限；不自动调用外部 CLI、安装 oil-delegate 或传递私密代码。未授权的付费或外部服务调用不包含在技能授权中。
4. oil-plan、oil-govern、oil-delegate 当前未安装，相关衔接由宿主按本仓库规范完成；不因为缺少可选技能中止原任务或自行安装其他技能。
5. SDK 单 owner、SDK 历史库所有权、Outbox 先持久化、发送未知结果先核对、账号隔离、消息 camelCase/PascalCase 兼容和未知签名 URL 保真，继续以既有平台规范为准。禁止清库修故障，禁止把 Web SDK 方法推定为原生能力。
6. 构建、运行、真机、测试和性能结论仅报告实际执行结果；必要验证在本次变更中完成，不以“重测仅合并前做”延后高风险检查。无关重测不重复运行。
7. 不解除 Release / Archive 门禁，不因技能流程自动提交、推送或部署。新增常驻规则需有本次任务或既有明确授权；本次集成已获用户授权。
