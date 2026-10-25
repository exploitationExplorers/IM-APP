# iOS 上架分支工作

基线：feat/chat-image-speed @ 1b446d6；只在 feat/ios-app-store 工作。

- [x] 读取报告、核对分支及前后端实现。
- [x] 独立 App Store 构建：排除热更新/外部安装、调试页面，限定 HTTPS/WSS。
- [x] 隐私同意：独立首屏负责授权；公共协议组件负责链接和显式勾选；工具层负责阻止未同意时的网络与 SDK 初始化。
- [x] 移除明文密码，旧密码改为一次性内存；清理历史项。
- [x] 修复 iOS 相册权限、后台音频、默认头像和名称。
- [x] 隔离未接通的离线推送；核实注销、UGC、原生隐私清单等外部依赖。
- [x] 用户举报支持 9 张截图，使用后端现有 evidenceFileIds 字段。
- [x] 314 项单元测试、类型检查、H5/App/App Store 资源构建与产物检查；编译产物未同意冷启动验证通过。

待外部配置：正式隐私文本/运营主体，App Store ID，注销后端、UGC 审核服务、APNs 通道和最终 IPA 插件清单。

正式域名 HTTPS /health 已确认 200。原生 PrivacyInfo.xcprivacy 与严格 ATS Info.plist 按 DCloud 官方 nativeResources/ios 机制拷入商店输出；最终 IPA 仍须云打包后核查合并结果、插件数据声明及 iPhone 实机收发/权限流程。

`npm run build:ios-store` 会因缺少正式法律文本链接和 App Store ID 主动失败。资源编译与检查使用了未配置这些资料的候选产物，不能提交审核。后台注销接口不存在；用户清理/保留规则及 UGC 供应商资料已发起询问。没有改动或部署后端，没有发布 WGT/IPA，也没有合并回稳定分支。
