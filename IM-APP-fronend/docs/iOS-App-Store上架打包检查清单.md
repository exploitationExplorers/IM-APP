# iOS App Store 上架打包检查清单

给 Mac 打包同学用。**照着做，不要凭经验用普通 App 云打包。**

Apple 的 5.6 拒审反馈指出应用存在审核时疑似隐藏的功能。旧代码用普通 `app-plus` 可以编出更新安装代码和调试页。上架分支现已删除更新安装实现，并拦截普通 App 发布构建。要核实某次提交包含哪些功能，请检查当时上传的 IPA。

> 自定义平台 **`ios-store`** 启用首次启动隐私授权、商店原生桥并移除调试页。`npm run build:app` 在本分支也使用商店构建入口。

---

## 0. 绝对不要做

- 云打包请选择「iOS App Store」对应的商店资源
- 不要「审核期服务端关掉热更新、过审后再开」——这正是 5.6 要打的
- 不要按审核 IP / 审核账号切换另一套功能
- `versionCode` 必须高于 App Store Connect 同一版本最近上传的构建号
- 不要把 `.env.ios-store.local` 提交进 Git

---

## 1. 环境准备（Mac）

```bash
git fetch
git checkout feat/ios-app-store
git pull
cd IM-APP-fronend
npm ci
```

确认 Node 能跑项目脚本。HBuilderX 需已登录 DCloud 账号，且本项目 appid `__UNI__EC9D1AE` 已绑定 **Tuoyun-OpenIMSDK** 原生插件（`src/manifest.json` → App 原生插件勾选）。

---

## 2. 环境变量（本分支已尽量配好）

`IM-APP-fronend/.env.ios-store` **已提交**，包含：

- `VITE_DISTRIBUTION=app-store`
- 正式 HTTPS/WSS API 与 OpenIM 地址
- 公网法律页：`/static/legal/privacy.html`、`/static/legal/agreement.html`

`VITE_APP_STORE_ID` 可留空。填入 App Store Connect 的纯数字 Apple ID 后，「关于我们」会显示官方商品页链接。

```env
VITE_APP_STORE_ID=1234567890
```

`npm run build:ios-store` 会校验上述项；不满足直接失败。后端下发给 SDK 的 `apiAddr` / `wsAddr` 也必须是 HTTPS / WSS。

---

## 3. 升版本（每次提审前）

`src/manifest.json` 当前为 **1.0.165（264）**。若 Connect 上同一版本已有 264 或更高构建号，改为更高的数字再构建。

App Store Connect 的审核记录确认，2026 年 11 月 17 日收到 5.6 反馈的构建为 **1.0.165（263）**。仓库现存的 `项目发布/ios/app.ipa` 是 **1.0.73（173）**，其中已确认包含 WGT 安装代码、自建更新接口和调试页。构建 263 是否包含这些代码仍待检查原包。

商店壳版本号**不要**跟着企业签 wgt 的版本跑。

---

## 4. 打商店资源（唯一正确命令）

在 `IM-APP-fronend` 目录：

```bash
npm run build:ios-store
```

成功时末尾应看到：

```text
App Store 资源检查通过；原生云打包后仍须检查最终 IPA 的 ATS、隐私清单及插件。
```

产物目录：

```text
dist/build/ios-store/
  app-service.js
  app-config-service.js
  manifest.json
  nativeResources/ios/PrivacyInfo.xcprivacy
  nativeResources/ios/Info.plist
  pages/ ...
```

任一失败 → **停，不要去云打包。**

脚本会拦截的问题包括：产物里出现 `runtime.install`、`.wgt`、「正在下载更新」、调试页、占位协议文案、明文测试 IP；首次启动入口不是隐私同意页；缺少隐私清单等。

---

## 5. 资源自检（云打包前 30 秒）

在 Mac 上对产物再搜一遍：

```bash
cd IM-APP-fronend/dist/build/ios-store
rg -n "runtime\\.install|\\.wgt|正在下载更新|正在安装|pages/mine/debug|/public/app-release|useLegacyAppUpdate|8\\.154\\.44\\.197" app-service.js app-config-service.js || true
```

期望：**无任何命中。**

版本显示来自包内版本配置。「关于我们」的商店链接只在配置了数字 Apple ID 时显示。

再确认：

```bash
test -f nativeResources/ios/PrivacyInfo.xcprivacy && test -f nativeResources/ios/Info.plist && echo OK
ls pages/mine/debug 2>/dev/null && echo "FAIL: debug page still present" || echo "debug page absent OK"
```

---

## 6. 用这份资源出 IPA

### 推荐：HBuilderX 云打包（App Store 发行）

1. 用 HBuilderX 打开本前端工程（指向含上述产物的项目）
2. 确认原生插件 **Tuoyun-OpenIMSDK** 已勾选
3. **发行 → 原生 App-云打包**
4. 平台选 **iOS**，用途选 **App Store / 正式版**（不要选 Ad Hoc / 企业签当提审包）
5. **必须走自定义平台「iOS App Store」**（对应 `package.json` → `uni-app.scripts.ios-store`，会定义 `APP-STORE`）  
   - 若界面只能选默认 App / app-plus：**先停**，改用下面「CLI 已产出资源」路径，或让会配自定义平台的人一起看  
   - 本分支会阻止普通 App 发布构建。签出 IPA 后运行下方检查，确认云打包使用了本次资源。
6. 证书：App Store 分发证书 + 对应描述文件；Bundle ID 与 Connect 一致
7. 打包完成后下载 IPA，保留文件名与时间，方便对照 build

云打包会合并 `nativeResources/ios` 里的隐私清单与 ATS（`NSAllowsArbitraryLoads=false`）。若云打包日志提示未合并原生资源，不要上传。

### 备选：本地 Xcode

若团队走导出 Xcode 工程：同样只能基于 **`ios-store` 资源**，不要混入 `dist/build/app`。Archive → Upload to App Store Connect。

---

## 7. IPA 终检（上传前必做）

需要找回构建 263 时，可在 App Store Connect 的「分发 → App 审核」中点击 `1.0.165 (263)` 核对上传时间和构建信息。构建详情页提供元数据和 dSYM 调试符号，原始 IPA 需向当时打包的人索取。 [Apple 构建详情说明](https://developer.apple.com/help/app-store-connect/manage-builds/view-builds-and-metadata/)

- HBuilderX 云打包可在原打包 Mac 的「发行 → 查看云打包状态」查找对应记录。下载链接过期时，可查当时保存的 `.ipa` 或下载目录。
- Xcode 打包可在原打包 Mac 的「Window → Organizer → Archives」查找 `1.0.165 (263)`。优先取当时导出的 `.ipa`，也可用对应的 `.xcarchive` 检查归档内容。

在 `IM-APP-fronend` 目录使用 Python 3 检查签出的 IPA：

```bash
npm run verify:ios-ipa -- "/path/to/app.ipa"
```

脚本会检查首次启动路由、更新安装代码、嵌入的更新包、调试页和主应用的隐私清单、ATS，并输出实际 Bundle ID、版本和构建号。将输出和 App Store Connect 中本次选中的构建核对。

也可装到 TestFlight / 内测机快速点一遍：

- [ ] 首次启动先出隐私同意页，未同意前不登录、不拉推送
- [ ] 「关于我们」显示本地版本。若配置了 Apple ID，点击链接可到官方商品页。
- [ ] 「通用」里**没有**「调试资讯」「重新选线」
- [ ] 能注册/登录、收发消息、加好友、进群（用下面审核账号）

---

## 8. App Store Connect

1. 上传构建号高于 Connect 同一版本最近记录的 IPA
2. 在 Resolution Center **先回复**上次 5.6（可英文），再点提交审核
3. **Notes for Review** 建议直接贴：

```text
This App Store build does NOT include any OTA / wgt / hot-update mechanism.
App updates are distributed through the App Store.

App name: 易可聊
Main features (all visible, none hidden for review):
1) Phone registration / login (country code + local number)
2) Add friends by public ID / QR (NOT by phone number search)
3) Create / join groups, group revoke
4) 1:1 and group chat (text / image / video / voice / file)
5) Forward messages; profile avatar & nickname edit
6) Account deletion in Me → Profile

Demo account:
Country code: +86
Phone: <填审核专用号>
SMS code / password: <填>
(If SMS is rate-limited, use password login.)

Please contact us in Resolution Center if any screen looks unexpected.
```

4. 准备好审核员能登录的账号（建议专用号，别用会触发风控的测试号）

### Resolution Center 回复模板（5.6）

```text
Hello App Review team,

Thank you for the feedback on Guideline 5.6.

We investigated the app's distribution paths after your feedback. We identified a legacy direct-distribution build path that could package an in-app resource updater. The new build removes that updater from the App Store branch.

For the new build:
- All in-app hot-update / wgt / plus.runtime.install code has been removed from the App Store distribution target
- App Store builds only update via the App Store
- Debug-only pages are not included
- All user-facing features listed in the review notes are available with the demo account

We are submitting a new build with these remediations. Please let us know if you need any additional information.

Best regards
```

---

## 9. 分工核对表（Windows 开发 ↔ Mac 打包）

| 谁 | 做什么 |
|---|---|
| 开发 | 在 `feat/ios-app-store` 核对下一构建号，并准备能访问完整功能的审核账号 |
| Mac | pull 最新分支 → `npm run build:ios-store` → 资源自检 → **自定义平台 ios-store** 云打包 → IPA 终检 → 上传 + 贴审核备注 + 回 Resolution Center |
| 双方 | 确认这次 IPA **不是**企业签那条热更新链路打出来的 |

打完后请回传这三样，方便复查：

1. `npm run build:ios-store` 终端末尾截图  
2. 对 `dist/build/ios-store/app-service.js` 的关键词搜索结果（应为空）  
3. IPA 文件名、`versionName` / `versionCode`、上传时间

---

## 10. 和本仓库其它发布的关系

| 渠道 | 命令 / 方式 | 热更新 |
|---|---|---|
| 企业签 / 客户测试壳 | 普通 App 包 + `pack:wgt:*` | 可以 |
| **App Store** | **仅** `build:ios-store` + 商店云打包 | **禁止** |

企业签热更新说明见：[wgt热更新发布.md](./wgt热更新发布.md)。那份文档的流程**不要**用在本次提审包上。
