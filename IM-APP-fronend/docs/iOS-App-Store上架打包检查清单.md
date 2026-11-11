# iOS App Store 上架打包检查清单

给 Mac 打包同学用。**照着做，不要凭经验用普通 App 云打包。**

背景：易可聊曾因 Guideline **5.6**（开发者行为准则 / 隐藏功能）被拒。对 uni-app 来说，最常见原因是 IPA 里仍带 **wgt 热更新**（`plus.runtime.install`）。企业签 / 测试壳可以热更新；**上架包必须彻底去掉。**

> 拉 `feat/ios-app-store` 分支 ≠ 打出了商店包。  
> 只有走自定义平台 **`ios-store`**（编译宏 `APP-STORE=true`）才会去掉热更新和调试页。

---

## 0. 绝对不要做

- 不要用普通 `npm run build:app` / 默认「App」云打包去提审
- 不要「审核期服务端关掉热更新、过审后再开」——这正是 5.6 要打的
- 不要按审核 IP / 审核账号切换另一套功能
- 不要用上次被拒的同一 `versionCode` 重提（被拒包是 **1.0.164 / 262**，新包至少 **263+**）
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

**你只需要确认一件事：** `VITE_APP_STORE_ID` 是否已是 App Store Connect 里的纯数字 Apple ID。

若还是空的：直接改 `.env.ios-store` 填上（本分支只做上架，可以进仓库），或本机建 `.env.ios-store.local` 覆盖（勿提交）。

```env
VITE_APP_STORE_ID=1234567890
```

`npm run build:ios-store` 会校验上述项；不满足直接失败。后端下发给 SDK 的 `apiAddr` / `wsAddr` 也必须是 HTTPS / WSS。

---

## 3. 升版本（每次提审前）

`src/manifest.json` 当前商店壳目标为 **1.0.165（263）**（大于被拒的 262）。若 Connect 上已有更高 build，再往上加即可。

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

应能搜到商店更新路径（正常）：

```bash
rg -n "apps\\.apple\\.com" app-service.js
```

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
   - 选错平台 = 热更新代码又打回去 = 再次 5.6
6. 证书：App Store 分发证书 + 对应描述文件；Bundle ID 与 Connect 一致
7. 打包完成后下载 IPA，保留文件名与时间，方便对照 build

云打包会合并 `nativeResources/ios` 里的隐私清单与 ATS（`NSAllowsArbitraryLoads=false`）。若云打包日志提示未合并原生资源，不要上传。

### 备选：本地 Xcode

若团队走导出 Xcode 工程：同样只能基于 **`ios-store` 资源**，不要混入 `dist/build/app`。Archive → Upload to App Store Connect。

---

## 7. IPA 终检（上传前必做）

把 IPA 当 zip 解开，找到里面的 `app-service.js`（路径随 DCloud 包结构可能略有不同），再搜一次第 5 节关键词。

| 搜到 | 结论 |
|---|---|
| `runtime.install` / `.wgt` / `正在下载更新` / `pages/mine/debug` | **不合格，禁止上传** |
| 仅有 `apps.apple.com`、无热更新词 | 通过 |

也可装到 TestFlight / 内测机快速点一遍：

- [ ] 首次启动先出隐私同意页，未同意前不登录、不拉推送
- [ ] 「关于我们」点更新 → 跳转 App Store，**不会**弹「发现新版本 / 正在下载更新」
- [ ] 「通用」里**没有**「调试资讯」「重新选线」
- [ ] 能注册/登录、收发消息、加好友、进群（用下面审核账号）

---

## 8. App Store Connect

1. 上传新 build（`versionCode` ≥ 263）
2. 在 Resolution Center **先回复**上次 5.6（可英文），再点提交审核
3. **Notes for Review** 建议直接贴：

```text
This App Store build does NOT include any OTA / wgt / hot-update mechanism.
In-app update only opens the App Store product page. No plus.runtime.install.

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

We do not intentionally hide features from App Review. The previously submitted binary may have been packaged with a non-App-Store resource path that still contained an enterprise/test OTA (wgt) update mechanism.

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
| 开发 | 保证功能在 `feat/ios-app-store`；`.env.ios-store` 已填 `VITE_APP_STORE_ID`；版本号已升；给出审核演示账号 |
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
