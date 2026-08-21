# uni-app wgt 热更新开发计划

目标：客户装一次测试 APK 之后，日常前端 bug 修复只发 `.wgt`，打开 App 自动更新并重启，不再每次重下安装包。

## 背景

uni-app 安装包分成两层：

| 层 | 内容 | 更新方式 |
|---|---|---|
| 原生壳 | 系统权限、相机、OpenIM 原生插件 `Tuoyun-OpenIMSDK` | 必须重打 APK / IPA |
| 前端资源 | 页面、逻辑、样式 | 打 `.wgt` 热更新 |

当前联调痛点是每次修 bug 都走「云打包 → 发 APK → 客户卸载重装」。绝大多数业务缺陷只动前端资源，应走 wgt。

H5 不能替代客户真机验收：App 聊天走原生 OpenIM 插件，H5 走 `@openim/client-sdk`，扫码、推送、文件选择行为也不一致。

## 方案

```
开发改代码
  → 提升 manifest versionCode
  → 打 wgt（zip dist/build/app-plus）
  → 预签名 PUT 上传 MinIO
  → 写入 app_releases
客户打开 App
  → GET 检查更新（无需登录）
  → 下载 wgt / 原生包
  → plus.runtime.install + restart
```

版本用两套数字：

- `nativeVersion`：安装包壳的 `versionCode`，客户不重装 APK 就不会变。
- `wgtVersion`：当前运行的资源包 `versionCode`，热更新成功后会变成新 wgt 的值。

服务端按 `platform + channel` 取最新已发布记录：

1. 最新包是 `apk` / `ipa`，且 `versionCode > nativeVersion` → 整包更新。
2. 最新包是 `wgt`，且 `versionCode > wgtVersion`，且客户 `nativeVersion >= minNativeVersion` → 热更新。
3. 最新 wgt 要求的壳比客户现有壳新 → 回退到最新原生包；没有原生包则提示无可用更新。
4. 其余 → 已是最新。

`minNativeVersion` 在发布 wgt 时写入。未传则取同平台同渠道最新原生包的 `versionCode`；还没有原生包记录时为 `0`。

渠道：`test`（发给客户的测试包）/ `prod`（正式包）。客户端打包时写入 `VITE_UPDATE_CHANNEL`，互不串包。

## 范围

本次做：

- 检查更新、下载安装 wgt、必要时提示整包更新
- 内部密钥发布接口 + 本地打包/发布脚本
- 启动自动检查 +「关于我们」手动检查
- 仅 App 端生效，H5 跳过

本次不做：

- 管理后台 UI（后台尚未立项）
- iOS 商店 / TestFlight 发布流
- 差分包、灰度百分比、按用户放量
- 原生插件、权限、运行时变更后的自动拆包判断（这类必须人工打 APK）

## 接口

前缀与现有规范一致：查询用 GET + query；写入用 POST + JSON；新接口不用 `/:id`。

### 客户端（无需 JWT）

`GET /api/v1/public/app-release`

Query：`platform=android|ios`、`channel=test|prod`、`nativeVersion`、`wgtVersion`

响应：

```json
{
  "hasUpdate": true,
  "updateType": "wgt",
  "versionName": "1.0.12",
  "versionCode": 112,
  "minNativeVersion": 100,
  "downloadUrl": "https://www.ke58.com/minio/im-uploads/app-releases/...",
  "changelog": "修复聊天气泡错位",
  "forceUpdate": false
}
```

`updateType`：`none` | `wgt` | `native`。检查失败或 MinIO 未配置时视为无更新，不打断启动。按 IP 限流。

### 发布（内部密钥，管理后台未就绪前给脚本用）

Header：`X-Internal-API-Key`

1. `POST /api/v1/admin/app-releases/uploads`  
   Body：`platform`、`packageType`（`wgt|apk|ipa`）、`fileName`  
   返回 MinIO 预签名 PUT：`uploadUrl`、`objectKey`、`fileUrl`。对象键固定 `app-releases/{platform}/{uuid}.{ext}`。单文件上限 200MB。内网仍可用 `/internal/admin/app-releases/uploads`。

2. `POST /api/v1/admin/app-releases`  
   Body：`platform`、`channel`、`versionName`、`versionCode`、`packageType`、`objectKey`、`changelog`、`forceUpdate`、可选 `minNativeVersion`  
   校验对象存在、`versionCode` 大于当前最大版本，写入 `app_releases`。

文件不经业务服务转发，只走 MinIO 预签名。

## 数据

`app_releases`：

- `platform` / `channel` / `version_name` / `version_code`
- `package_type`：`wgt` | `apk` | `ipa`
- `min_native_version`
- `download_url` / `object_key`
- `changelog` / `force_update` / `published`
- 唯一约束：`(platform, channel, version_code)`

启动时 `RequireColumns` 带上该表。

## 客户端

- `src/api/app-release.ts`、`src/composables/useAppUpdate.ts`（`uni.showModal` 全局弹窗，因 App.vue 的 template 不会盖到页面上）
- `App.vue` 启动与回到前台检查；非 App 端跳过；网络失败静默
- 关于我们：展示当前 wgt 版本，点击「检查更新」
- 强制更新不可关闭；非强制可稍后
- 下载进度展示，安装成功后 `plus.runtime.restart()`
- Android 整包走 `plus.runtime.install`；iOS 整包打开 `downloadUrl`
- `APP_CONFIG.updateChannel` 读 `VITE_UPDATE_CHANNEL`，默认 `test`

## 发布脚本

`IM-APP-fronend/scripts/pack-wgt.cjs`：

```text
npm run pack:wgt
npm run pack:wgt -- --build
npm run pack:wgt -- --build --publish --min-native=100
```

1. 可选：`versionCode + 1` 写回 `src/manifest.json`，再 `uni build -p app-plus`
2. 把 `dist/build/app-plus` 打成 zip，扩展名改为 `.wgt`，输出到 `unpackage/release/`
3. `--publish` 时读 `IM_INTERNAL_API_KEY` 和 API 根地址，上传并创建发布记录

日常：改完前端 → `npm run pack:wgt -- --build --publish --min-native=100`。  
`min-native` 必须等于客户手里那只 APK 的 `versionCode`。换原生插件、权限、运行时后先打新 APK 发给客户，再把后续 wgt 的 `--min-native` 改成新壳版本。

## 任务拆分

1. 迁移 + model / repository / service / handler，注册公开检查接口和内部发布接口；MinIO 增加 `PresignPut`
2. 前端检查更新、安装重启、启动与关于页接入
3. 打包发布脚本和 npm scripts
4. 同步 `api-contract.md`、`architecture.md`；`unpackage/release/` 不入库
5. `go build ./...`、`go vet ./...`、`npm run type-check`

## 验收

- 客户只装一次 APK（例如 `versionCode=100`）
- 发布 `versionCode=101` 的 wgt 后，再打开 App 出现更新弹窗，下载安装重启后关于页版本变为 101
- 再发 102，无需重装 APK
- 发布 `apk` 且 `versionCode` 更大时，提示整包更新而不是装 wgt
- wgt 的 `minNativeVersion` 大于客户壳版本时，不装该 wgt
- H5 启动不检查、不弹窗
- 无发布记录或检查接口失败时，App 正常进入，无报错弹窗
- 未带内部密钥不能发布

## 风险

- wgt 不能更新原生插件。OpenIM 插件、新权限、uni-app 运行时变更必须重打 APK。
- 客户必须杀进程或重启后才加载新资源；安装成功后脚本主动 `restart`。
- 测试包渠道必须是 `test`，避免正式包误拉测试 wgt。
