# oil-dev 技能集成

2026-11-17 按用户确认的方案，仅引入 oil-bug-fix（0.1.1）、oil-code-review（0.4.0）、oil-explore（0.4.0）。目录为项目 `.agents/skills/`，不修改全局技能或个人偏好。下个会话轮次可发现这些技能；可用 `$oil-bug-fix`、`$oil-code-review`、`$oil-explore` 显式调用，也保留按任务自动匹配。

来源：oil-oil/oil-dev-skills，提交 `a31f9876a4b02d816ec3a8727ac42108314fa989`；已与固定提交下载内容逐文件核对。上游正文、引用和辅助脚本原样保留，各目录补存上游 MIT LICENSE；文件 SHA-256 见 [来源清单](oil-dev-skills-source.json)。未安装 plan、govern、delegate，未执行外部 CLI 委托。

项目验证入口、高风险路径、跨端红线及流程适配统一放在根目录 [AGENTS.md](../AGENTS.md) 的 oil-dev 小节，避免复制平台规范。上游默认高风险类别仍适用，目录清单不是穷举；高风险标记要求更强验证，不自动增加确认流程。发布、部署及依赖升级不属于测试授权。

更新时先下载候选提交到临时目录，审阅 SKILL.md、引用与脚本差异；确认后用明确提交更新项目副本、许可证和来源清单，并重新验证格式和两个只读采集入口。不要自动跟随 main 覆盖本地文件。

验证：三个 SKILL.md 通过 quick_validate；repo_map 和 review_helper 在本仓库运行成功，均识别 AGENTS.md 中快测、门禁与风险路径。仅安装技能与调整规范，不需执行业务构建；未修改上游辅助脚本，不重复运行其开发回归测试。
