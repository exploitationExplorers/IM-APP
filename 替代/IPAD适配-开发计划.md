# iPad 适配开发计划（通用 App 三栏分栏布局）

> 目标：让「易可聊」iOS App 在 iPad 上以**通用 App（原生分辨率）**运行，并复用已有的 H5 桌面三栏布局（左导航 + 中会话列表 + 右聊天窗口），达到类似 H5 网页版（微信网页版 / Telegram Web 风格）的分栏体验，而非当前 iPhone 兼容模式下的 1/3 小窗。

---

## 1. 现状分析（关键发现）

项目**早已写好一套完整的 H5 桌面分栏布局**，但被显式排除在 App 端之外：

- `composables/useDesktopLayout.ts` 第 8–19 行：`readDesktop()` 要求 `uni.getSystemInfoSync().uniPlatform === 'web'`，App 端（`app-plus` / `ios`）直接返回 `false` → `isDesktop` 永远为 `false`，整套桌面分支不渲染。
- **但** uni-app 的非 nvue `.vue` 页面在 App 端是 **webview 渲染**，有 `document` / `window` / `html` / `body`，`desktop.scss` 的 web CSS 与 `ImDesktopSidebar` / `ChatRoom` 等组件都能正常渲染。所以 App 端**不是不能跑分栏，而是被代码主动关掉了**。

桌面分栏实现已自包含，几乎零架构改动即可复用：

- `pages/chat/index.vue`：
  - 第 11 行 `import ChatRoom from '@/pages/chat/room.vue'` —— 聊天详情是**作为子组件内嵌**进列表页右栏（不是独立跳转页）。
  - 第 579–599 行：桌面模式下 `openConversation` 不 `navigateTo`，而是 `selectedConv = item`，右栏渲染 `<ChatRoom>`。
  - 第 818 行 `watchEffect` 自动选中首条可用会话；列表列宽度可拖拽（`useDesktopListResize`）。
- `pages/contacts/index.vue`、`pages/mine/index.vue` 同理已写好 `isDesktop` 分支。
- `components/desktop/ImDesktopSidebar.vue`（左深蓝导航）、`ImDesktopListResizer.vue`（可拖拽分隔条）、`styles/desktop.scss` 全部就绪。
- `App.vue` 已 `import '@/styles/desktop.scss'`，样式在 App 端也打进包。

**当前 iPad 是 1/3 小窗的双重根因：**
1. 打包未勾选「支持 iPad」→ iPhone-only 兼容模式，窗口被锁到 iPhone 最大逻辑尺寸（约 430pt），放再大也只约 1/3 屏；
2. 代码层 `isDesktop` 在 App 端不触发 → 即使放大也只显示手机单列。

---

## 2. 方案（两步，最小侵入）

### 步骤 A：打包层 —— 做成通用 App（代码层即可配，无需手勾）
- 在 `manifest.json` 的 `app-plus.distribute.ios` 下新增 `"devices": "universal"`，App 在 iPad 以原生全分辨率运行（`UIDeviceFamily` 含 `2`，无黑边）。
- **这是分栏铺满的前提**：不配则仍是 1/3 小窗，分栏毫无意义。
- 已查证可静态配置（uni-app 官方），直接写入仓库，打包时无需额外勾选。

### 步骤 B：代码层 —— 放开 App 端桌面判定
1. **`composables/useDesktopLayout.ts`**
   - 放宽 `isH5Web()`：App 端（`app-plus` / `ios`）且为平板设备也返回 `true`。
   - 判定改为「设备维度」：
     - web 端：`window.innerWidth >= DESKTOP_BREAKPOINT`（960）不变；
     - App 端：用 `uni.getWindowInfo().windowWidth`（或 `deviceType === 'pad'`）`>= 768`（平板最小宽度，**iPhone 最大约 430，不会误触发**）。
   - 注意 `DESKTOP_BREAKPOINT = 960` 对 iPad 竖屏（768 / 834）偏小，故 App 端单独用 768 阈值，保证横竖屏都进分栏。
2. **`styles/desktop.scss`**
   - 将 `@media (min-width: 960px)`（第 3 行）包裹的样式——隐藏 `.tabbar`（`display:none`）、设 `html.im-desktop page` / `uni-page-body` 100% 高度 / `overflow:hidden`——**移出 media query，改为纯 `.im-desktop` class 驱动**。否则 iPad 竖屏（< 960）下 tabbar 不隐藏、高度不对，与左侧栏冲突。
   - App 端 webview 有 `html` / `body`，class 驱动样式同样生效。
   - 其余 `.im-desktop-*` 类本身不依赖 media query，无需改。
3. **`pages/chat/room.vue`（必改）**
   - 桌面模式右栏内嵌渲染时，需**隐藏手机端「返回」按钮 / 顶部返回导航**（右栏已无返回需求，列表在左栏）。
   - 引入 `useDesktopLayout` 判断 `isDesktop`，隐藏返回相关 UI。
4. **`pages/contacts/index.vue` / `pages/mine/index.vue`**
   - 桌面分支已存在，验证联系人详情 / 我的页面在 iPad 右栏正确渲染；必要时微调尺寸。

---

## 3. 边界 case / 风险

- **子页面**（`group/detail`、`profile`、`friend-detail`、`add-group` 等）：桌面模式点击后 `navigateTo` 在 iPad 通用 App 下会**全屏覆盖**（与 H5 行为一致）。可接受，列为后续优化（右栏化），本期不强制。
- **横竖屏旋转**：iPad 旋转触发 `resize`，`useDesktopLayout` 会 refresh；阈值 768 保证横竖都进桌面，无「旋转退出分栏」问题。
- **软键盘**：`room` 内嵌聊天输入，实测键盘弹起不挤压布局（`pages/chat/room` 已配 `app-plus.softinputMode=adjustResize`）。
- **`room.vue` 组件形态**：作为 `<ChatRoom>` 内嵌时，其 `onLoad` / `onShow` 等页面生命周期不会触发（组件用 `onMounted`），需确认聊天加载 / 监听逻辑在组件形态下正常（H5 桌面端已验证可跑，App 端同理）。

---

## 4. 验证清单（iPad 真机）

- [ ] 竖屏 + 横屏均进入三栏布局，无 1/3 小窗
- [ ] 左深蓝导航可切换 聊天 / 通讯录 / 我的
- [ ] 中点会话，右栏显示聊天；发文字 / 图片 / 语音 / 文件正常
- [ ] 列表列可拖拽调宽
- [ ] 手机端 tabbar 已隐藏，无重复导航
- [ ] `room` 内嵌无「返回」按钮残留
- [ ] 通讯录详情、我的页面在右栏正确显示
- [ ] 注销 / 群发 / 清聊天等既有功能在 iPad 不崩

---

## 5. 改动文件清单

| 文件 | 改动性质 | 说明 |
|---|---|---|
| `composables/useDesktopLayout.ts` | 修改判定 | 放开 App 端平板进入桌面模式（web 768 阈值） |
| `styles/desktop.scss` | 修改样式 | `@media(min-width:960px)` 内样式改为 `.im-desktop` class 驱动 |
| `pages/chat/room.vue` | 修改 | 桌面模式隐藏返回按钮 / 顶栏 |
| `pages/contacts/index.vue` | 验证 / 微调 | 确认桌面分支在 App 端正确 |
| `pages/mine/index.vue` | 验证 / 微调 | 确认桌面分支在 App 端正确 |

> 代码层改动集中在 2–3 个文件，均为最小侵入；无需新增页面或重写布局。

---

## 6. 待确认 / 已知项

1. ✅ **`manifest.json` 可静态配置「支持 iPad」**（已查证 uni-app 官方）：在 `app-plus.distribute.ios` 节点下新增 `"devices": "universal"`（取值 `'iphone' | 'ipad' | 'universal'`，默认 `auto`）。设为 `universal` 即通用 App，iPad 以原生分辨率全屏运行，无黑边。**无需每次打包手勾**，直接写入仓库。
2. 子页面 iPad 行为是否本期一并右栏化？默认**否**（全屏覆盖可接受，降低范围与风险）。
3. **横竖屏分栏策略（待用户拍板）**：建议阈值 768 → iPad 竖屏（768/834）与横屏均进三栏；若仅横屏分栏则阈值 960（竖屏仍为手机放大单列）。推荐 768（横竖一致体验）。
