# 原生 UI 还原契约

唯一视觉来源为本仓库 `IM-APP-fronend/` 当前 uni-app 页面。保留“易可聊”品牌、页面结构、原图、颜色、文案和操作。竞品 APK 仅可用于架构研究，不作为替换本项目 UI 的依据。

首轮覆盖登录、底部导航、会话列表、文本聊天；通讯录和我的仅实现原有外观骨架及样例入口，其他业务页逐页登记验收。主要页面使用 Compose / UIKit 原生控件，不通过 WebView 承载旧 uni-app 页面。

## 尺寸与样式来源

- `rpx` 按当前逻辑视口宽度除以 750 换算为 Android dp / iOS point；原样式 `px` 按逻辑尺寸实现。系统字体缩放与无障碍属于独立适配测试，不能为追求截图一致禁用。
- 登录样式以 `auth.scss` 最后导入的 `auth-modern.scss` 为准，不能只读取旧基础样式。
- 安全区域使用原生系统 Insets；状态栏、键盘与底部手势区分别验证，避免把 Web 高度直接照搬成固定屏高。
- 名称、尺寸及颜色参见 `tokens.json`，详细来源与实现状态参见 `docs/原生UI复用与验收-20261112.md`。

## 素材同步

```powershell
node scripts/native/sync_ui_assets.mjs
python -X utf8 scripts/native/verify_ui_parity.py
```

同步脚本使用本机 Edge 将旧版实际使用的 SVG 原图转为透明 PNG，不下载工具。Android 输出到 `drawable-nodpi`，iOS 输出到 `Assets.xcassets`。Logo 下采样到 168 × 168，用于 56 逻辑像素显示；减少反复解码 2134 × 2134 原图的开销。其余原 PNG 和法律 HTML 按字节复制。`asset-source-manifest.json` 记录源与输出 SHA-256、转换方式及双端目标。

校验器仅验证资产来源、双端副本和资源接线；通过不代表 UI 运行、像素一致、业务完成或真机性能通过。当前样例数据应持续明确标注“本地样例、不发送”，不能伪造已读、同步完成或送达状态。
