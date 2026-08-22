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
