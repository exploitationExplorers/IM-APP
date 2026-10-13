---
name: im-h5-verify
description: >-
  Automates local H5 verification for the IM uni-app (PC desktop layout and
  mobile web viewport) via cursor-ide-browser MCP. Use after frontend chat/UI
  fixes, when the user asks to 本地验证 / 回归验证 / 测一下 H5 / verify on PC or
  mobile web, or after changing room.vue composer/scroll/settings. Does not
  cover App 原生 — that stays manual.
---

# IM H5 本地自动化验证

改完前端功能点后，用 **cursor-ide-browser** 在本地 H5 上立刻回归。  
**App 原生不在本 skill 范围**，报告里写「需人工验 App」。

## 前置

1. H5 已起：`IM-APP-fronend` 下 `npm run dev:h5`，默认 [http://localhost:5173/](http://localhost:5173/)
2. 后端 / OpenIM 可达（否则登录或进会话会失败；失败时如实报告，不要假绿）
3. 只用本 skill 里的**本地测试账号**，不要用生产号

端口被占用时先确认实际 URL，再改下面的 `BASE`。

## 本地测试账号（ verbatim ）

| 项 | 值 |
|---|---|
| 手机号 | `15013938612` |
| 密码 | `asd.12345`（刚好 9 位） |
| 区号 | 默认 `+86`（登录页已带，一般不用改） |

## 必走入口（不要跳过）

落地页是下载页，**必须先点「开启聊天快捷版」** 才会进登录页：

1. `browser_navigate` → `{BASE}/#/`（或 `{BASE}/#/pages/download/index`）
2. `browser_lock` → `lock`
3. `browser_snapshot`，点文案 **开启聊天快捷版**（class 约 `pill-lite`，勿点「立即下载」）
4. 等到登录页：可见「账号密码登录」「登录」按钮
5. 填手机号、密码 → 点「登录」
6. 等到会话列表：PC 有左侧栏 + 会话列；移动端有底部 Tab

已登录时可直接进 `#/pages/chat/index`；若仍停在下载页，再点一次「开启聊天快捷版」。

## 视口：PC vs 移动端 Web

桌面布局断点：`DESKTOP_BREAKPOINT = 960`（`useDesktopLayout.ts`）。

每轮功能验证至少跑 **两种视口**（同一浏览器 tab 内用 CDP 切换）：

| 模式 | CDP `Emulation.setDeviceMetricsOverride` | 期望 UI |
|---|---|---|
| PC | `width: 1280, height: 800, deviceScaleFactor: 1, mobile: false` | `.im-desktop` / 三栏（侧栏+会话列表+聊天） |
| 移动端 Web | `width: 390, height: 844, deviceScaleFactor: 2, mobile: true` | 单列 + 底部 `ImTabBar`，无桌面三栏 |

回合结束前调用 `Emulation.clearDeviceMetricsOverride`。  
**不要**用 CDP `Input.*`；点击/输入用 `browser_click` / `browser_fill` / `browser_type` / `browser_press_key`。

## Agent 工作流

```
Task Progress:
- [ ] 确认 H5 可达
- [ ] 开启聊天快捷版 → 登录
- [ ] 识别本次要验的功能点（用户说明或 git diff）
- [ ] PC 视口跑对应用例
- [ ] 移动端 Web 视口跑对应用例
- [ ] 截图证据 + 通过/失败表
- [ ] 标明 App 原生需人工
- [ ] browser_lock unlock
```

1. 对照 [checklists.md](checklists.md) 选对应用例；新功能先把用例补进该文件再跑。
2. 选择器与文案锚点见 [selectors.md](selectors.md)。
3. 交互：先 `browser_snapshot` 拿 `ref`，再点/填；断言靠 snapshot + `browser_take_screenshot` + 必要时 `browser_cdp` `Runtime.evaluate`。
4. 同一失败动作最多重试 1 次（换 snapshot/假设）；4 次仍卡住则停，报告阻塞点。
5. 结束务必 `browser_lock` → `unlock`。

## 断言原则

- **通过**：可见状态符合预期（例如最新消息在视口底部、输入框光标行可见、开关保持）。
- **失败**：附截图路径 + 实际现象 + 最可能相关文件（如 `pages/chat/room.vue`）。
- 不因「大概可以」标绿；拿不到证据就标 **blocked**。

## 报告模板（回复用户用）

```markdown
## H5 验证结果
- 环境：http://localhost:5173/ （PC / 移动端 Web）
- 账号：15013938612
- 范围：<功能点列表>

| 用例 | PC | 移动端 Web | 说明 |
|---|---|---|---|
| … | pass/fail | pass/fail | … |

App 原生：未测（需人工）
```

## 不要做的事

- 不把本流程当成 App 真机 / 华为机验证
- 不点「立即下载」、不改测试账号密码文件以外的密钥
- 不跳过「开启聊天快捷版」直接假设已在登录页（除非 snapshot 已证明在登录/会话页）
