# UI 锚点（H5）

uni-app 控件不一定有稳定 `data-testid`，优先用 **可见文案** + snapshot `ref`。

## 路由

| 页面 | Hash |
|---|---|
| 下载落地 | `/#/` 或 `/#/pages/download/index` |
| 登录 | `/#/pages/auth/sign-in` |
| 会话列表 | `/#/pages/chat/index` |
| 聊天室（移动端跳转） | `/#/pages/chat/room?...` |
| 聊天设置 | `/#/pages/mine/chat-settings` |

## 文案 / class

| 目标 | 锚点 |
|---|---|
| 进登录 | 文案 `开启聊天快捷版`；勿点含 `立即下载` 的 pill |
| 登录按钮 | 按钮文案 `登录` |
| 手机号 | placeholder 随区号（中国大陆常为手机号提示）；`input type=number` |
| 密码 | placeholder `请输入密码` |
| 会话列表项 | 会话标题文本；PC 上 `ConversationItem` |
| 消息列表 | `.msg-list` / `.room .msg-list` |
| 输入框 | `.composer-row .input-wrap textarea` / placeholder `输入消息` |
| 发送 | 文案 `传送`（有输入时出现） |
| 回车发送开关 | 设置页文案 `回车键送出消息` + `ImSwitch` |
| PC 桌面根 | `html.im-desktop` |
| 移动端 Tab | 底部「聊天 / 通讯录 / 我的」一类 Tab |

## CDP 小抄

确认桌面模式：

```js
document.documentElement.classList.contains('im-desktop')
```

消息列表是否贴底：

```js
(() => {
  const root = document.querySelector('.room .msg-list');
  const node = root?.querySelector('.uni-scroll-view') || root;
  if (!node) return { ok: false, reason: 'no-msg-list' };
  const gap = node.scrollHeight - node.scrollTop - node.clientHeight;
  return { ok: gap < 80, gap, scrollTop: node.scrollTop, scrollHeight: node.scrollHeight };
})()
```

输入框是否滚到末行：

```js
(() => {
  const el = document.querySelector('.composer-row textarea');
  if (!el) return { ok: false };
  const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
  return { ok: gap < 24, gap, scrollTop: el.scrollTop };
})()
```

回车发送开关是否持久：

```js
(() => {
  const raw = localStorage.getItem('im_chat_settings_v1')
    || localStorage.getItem('im_chat_settings_v1_json');
  if (!raw) return { enterToSend: null };
  const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return { enterToSend: !!obj.enterToSend };
})()
```

> uni 可能把设置存在自有 storage 而非 `localStorage`；若为 null，以设置页 UI 开关为准。
