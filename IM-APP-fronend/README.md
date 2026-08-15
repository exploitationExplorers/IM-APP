# IM-APP-fronend

UniApp Vue3 + TypeScript IM 客户端，对接 Go 业务后端。

## 启动

```bash
npm install
npm run dev:h5
```

### App 端（HBuilderX 运行到模拟器 / 真机）

H5 走 `@openim/client-sdk`，不需要原生插件。App 端 `openim-uniapp-polyfill` 会调用 `Tuoyun-OpenIMSDK`，**标准运行基座里没有这个插件**，聊天页会报 `Cannot read property 'initSDK' of undefined`。

按下面做一次即可：

1. 在 [DCloud 插件市场 · OpenIM SDK](https://ext.dcloud.net.cn/plugin?id=6577) 把插件绑定到本项目 appid（`__UNI__EC9D1AE`）。
2. HBuilderX 打开 `src/manifest.json` → **App 原生插件**，勾选 `Tuoyun-OpenIMSDK`。
3. 菜单 **运行 → 运行到手机或模拟器 → 制作自定义调试基座**，等云打包完成并安装到设备。
4. 之后运行选 **自定义调试基座**，不要再用标准基座。

没有自定义基座时，页面会提示「App 端缺少 OpenIM 原生插件」，会话列表会是空的。

`.env`：

```
VITE_API_BASE_URL=http://8.210.72.157:8080/api/v1
VITE_WS_BASE_URL=ws://8.210.72.157:8080/ws
```

改 `.env` 后需重启 `npm run dev:h5`。

## 联调

1. 启动后端（见 `../IM-APP-server/README.md`）
2. 确认 `.env` 中的 API / WS 地址指向后端
3. 重启前端 dev server

认证接口文档：[Apifox · 发送短信验证码](https://n317o23omi.apifox.cn/500428945e0)

联调要点：

- 请求需带 `countryCode`、`deviceId`
- 登录 / 注册成功返回 `accessToken` + `refreshToken`
- 开发环境发送验证码响应含 `devCode`（固定 `123456`）
- 短信登录不会为未注册号码静默建号，需先走注册
- 注册必须设置密码（至少 6 位）
- 演示账号：`13800138000` / `123456`

## 目录结构

```
src/
├── api/          # 按业务域拆分，直连 Go API
├── types/        # 按域拆分的类型定义
├── constants/    # 国家区号等常量
├── composables/  # 路由守卫等
├── stores/       # Pinia 状态
└── pages/        # 页面
```
