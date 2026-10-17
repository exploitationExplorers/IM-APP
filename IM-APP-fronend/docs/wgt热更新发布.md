# wgt 热更新发布（给改完前端的同学）

客户已经装过带热更新检查的测试 APK。之后只改页面、逻辑、样式时，**不要再打 APK**，发 `.wgt` 即可。客户打开 App 会弹「发现新版本」，点更新后自动安装并重启。

方案背景见仓库根目录 [plan.md](../../plan.md)。本文只写操作。

## 什么时候能发 wgt，什么时候必须重打 APK

| 改了什么 | 怎么发 |
|---|---|
| 页面、接口调用、文案、样式、发视频/图片的前端逻辑 | **发 wgt** |
| 原生模块（Camera、录音、扫码）、`Tuoyun-OpenIMSDK`、App 权限、`manifest.json` 里 `app-plus.modules` | **必须重打 APK** 发给客户，wgt 加不进去 |
| 只改了 Go 后端 | 部署 `im-app-api`，**不用发 wgt** |

当前客户测试壳：`versionCode = 100`（关于页可能仍显示 1.0.0，那是壳的名字；热更新看的是资源包 versionCode）。后续所有 wgt 都加 `--min-native=100`，直到你们发出新 APK。

## 发之前

1. **先合代码再打包**。不要在过期分支上单独发。把修复合进当前要发给客户的分支（一般是最新 `main`），再在那份代码上打 wgt。两个人同时发会抢 `versionCode`，后发的会报「该版本号已发布」。
2. 本机在 `IM-APP-fronend/` 下已 `npm install`。
3. `IM-APP-fronend/.env` 有 `VITE_API_BASE_URL=http://8.154.44.197/api/v1`（新服务器纯 IP、无域名，永久 HTTP，不要写 https）。
4. `IM-APP-server/.env` 里的 `IM_INTERNAL_API_KEY` 与**线上服务器** `.env` 一致（脚本用它调发布接口）。
5. 本机有 **Python 3**（`py -3` 或 `python`）。Windows 自带的 `tar` 打出来的 zip 带 `./` 前缀，安装会成功但版本不生效。

不要用 HBuilderX 单独导出一份 wgt 再手动上传，容易和 `src/manifest.json` 版本对不上。

## 日常命令（这个分支只发内部 canary）

客户手机上的测试壳渠道是 `test`。本分支的优化还没验收，**不要**用默认命令发给客户。

在 `IM-APP-fronend/` 目录，只更新自己的内部壳：

```bash
npm run pack:wgt:canary -- --changelog=这里写自己能看懂的说明
```

发给客户必须另写渠道，并且先在 canary 真机冷启动过：

```bash
npm run pack:wgt:customer -- --changelog=客户能看懂的更新说明
```

`pack:wgt:customer` 会先打出醒目警告。没装 `VITE_UPDATE_CHANNEL=canary` 的内部壳之前，canary 包没有手机会收到，客户壳也不会变。门禁见 [测试环境与发布门禁.md](./测试环境与发布门禁.md)。

脚本会：

1. 把 `src/manifest.json` 的 `versionCode + 1`（例如 102 → 103）
2. 执行 `uni build -p app-plus`
3. 把构建产物里的版本写成和新 `versionCode` 一致（这一步必须有，否则又会出现「安装成功但关于页还是旧版本」）
4. 打成 `unpackage/release/im-xxx.wgt`（根目录就是 `manifest.json`，不要套一层文件夹）
5. 上传到线上并**同时写入 android + ios 两条发布记录**（同一份 wgt；企业签 iOS 也能热更新）

看到类似输出即成功：

```text
已提升版本: 1.0.3 (103)
wgt 校验通过: __UNI__EC9D1AE 1.0.3 (103)
已发布 android wgt 1.0.3 (103)
已发布 ios wgt 1.0.3 (103)
```

> 企业签 / 不上架的 iOS **可以**走 wgt，和安卓同一套检查更新代码。只有上架 App Store 才受苹果审核限制。  
> `--min-native` 必须 ≤ 客户手里那只 IPA/APK 壳的 `versionCode`；iOS 壳若比 100 旧，把数字改小或问客户关于页/打包时的壳版本。

`changelog` 会出现在客户手机的更新弹窗里，写人话，不要写分支名。

## 客户怎么验收

1. 完全划掉 App（不要只切后台）
2. 再打开，应弹出新版本（版本号要等于你刚发布的，例如 v1.0.3）
3. 点「立即更新」，等下载、安装、自动重启
4. **关于我们**里的版本变成新号，且不再弹更新

若弹窗版本是新的、装完关于页仍是旧的：多半又打进了旧资源，不要用 `--no-bump --file=旧wgt` 重发；按上面命令重新 `--build --publish`。

## 常见情况

**只改了前端，后端没动**  
发 wgt 即可，不用部署 Go。

**前端 + 后端都改了**  
先部署线上 `im-app-api`，再发 wgt。只发 wgt 换不了服务端逻辑。

**命令报 `该版本号已发布`**  
说明这个 `versionCode` 已经在线上。不要改数字硬发。拉最新 `src/manifest.json` 再执行带 `--build` 的命令，让脚本自动 +1。

**命令报 `fetch failed` / 证书错误**  
用仓库里当前的 `scripts/pack-wgt.cjs`，不要用旧脚本。源站 IP 固定为 `8.154.44.197`（见脚本的 `ORIGIN_PIN_IP`），源站 IP 变了就改环境变量 `IM_APP_ORIGIN_IP`。

**命令报 `wgt 内是 1.0.x，不能按 … 发布`**  
构建产物版本和 manifest 不一致，脚本在拦错误包。确认用的是带 `syncDistWidgetVersion` 的最新脚本，并且加了 `--build`。

**客户一直提示更新，装完还是旧版**  
历史坑：发布记录写了新版本，但包里面仍是 1.0.0。现在脚本发布前会校验包内版本，不要绕过。

**装完热更新群聊视频仍是黑块**  
确认日志里 `使用构建产物目录` 指向的是刚编出来的 `dist/build/app`（不是过期的 `app-plus`）。脚本已按目录修改时间自动选最新产物。

## 不要做

- 不要对已发布的号用 `--no-bump` 再发一次。
- 不要把 `unpackage/release/*.wgt`、`dist/`、`.env` 提交进 git。
- 不要把 `--min-native` 改成比客户 APK 更大的数，否则客户检测不到这次 wgt。
- 不要在 H5 里验收热更新；只有真机 App 会检查。

## 可选参数

```bash
# 只编译并打 wgt，不上传（给自己看包）
npm run pack:wgt -- --build

# 强制更新，只给内部壳。发给客户时把 canary 换成 customer 脚本
npm run pack:wgt:canary -- --force --changelog=必须更新

# 正式渠道（只有将来的 prod 壳会收到）
npm run pack:wgt -- --build --publish --channel=prod --min-native=100 --changelog=…

# 只发一端（一般不用；默认已是 android,ios）
npm run pack:wgt -- --build --publish --platform=ios --min-native=100 --changelog=…
```

换新 APK / IPA 之后：把文档和命令里的 `--min-native=100` 改成新壳的 `versionCode`。
