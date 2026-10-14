# 提示词：基于豆包（Larus/Flow）逆向架构的 Agent 学习项目实现规格

> 用法：把本文**整份**丢给另一个仓库里的 AI Coding Agent，让它按本规格从零实现一个「学习用 AI Agent App」。  
> 目标：按豆包同类架构学习 Agent（会话 / Block 流式消息 / Tool / Workflow / Trace / **Lynx 动态卡片**），技术栈尽量对齐，**不是**复刻品牌、资源、包名、私有协议或商业后端。  
> 约束：自研品牌与 UI；模型 API 用公开兼容接口（OpenAI-compatible / 自建）；禁止照搬 APK 内资源、密钥、域名、签名与闭源 so。  
> Lynx 说明：ByteDance 已开源 Lynx 引擎与 ReactLynx 工具链（Apache-2.0，见 https://lynxjs.org 、https://github.com/lynx-family/lynx ）。**必须使用开源 Lynx**，不要用 WebView 凑合代替主路径。

---

## 0. 你（实现 AI）的角色与完成标准

你是全栈实现者。请在**新仓库**中交付一个可运行的「Agent 学习 App」，让使用者理解豆包类产品的分层，而不是像素级克隆。

**完成标准（必须全部满足）：**

1. 能注册/登录（可简化为本地账号或单用户 demo）。
2. 能创建「Bot 会话」，发送消息后看到**流式**回复。
3. 回复以 **Block 列表**渲染，至少支持：`thinking` / `text` / `tool` / `code` / `error`。
4. Agent 能发起至少 3 种 Tool（见后文），Tool 执行过程以 `tool` block 实时展示状态（pending → running → done/failed）。
5. 有 Agent Trace 面板：展示本轮 intention → tool_calls → 结果摘要 → 最终回答；**Trace 至少有一版用 Lynx 卡片渲染**（对齐豆包 `agentTracePanel` 思路）。
6. 有「技能/指令」入口（轻量 Instruction）：预设 prompt 模板可一键注入。
7. 至少 2 种消息 Block 用 **Lynx 模板**渲染（推荐：`tool`、`trace`；`text`/`thinking` 可用原生 View）。
8. README 用中文写清：架构图、目录、如何跑、Lynx 集成方式、与豆包架构的对应关系表。
9. 代码注释只写意图与约束，不粘贴任何来自 APK 的混淆类名实现细节当「官方源码」。

**明确不做：**

- 不做抖音电商/直播/支付/飞书完整套件/Dora 硬件。
- **不要跳过 Lynx**；但不必复刻豆包内部的 GeckoX 私有分发后台——用本地/自建模板包即可（见 §1.4）。
- 不连接豆包/字节私有 API，不使用逆向出的域名、appKey、证书。
- 不复制豆包图标、文案、动画资源、包名 `com.larus.nova`。

---

## 1. 背景：从 APK（REA）观察到的真实产品形态

以下内容来自对某 `base.apk`（包名 `com.larus.nova`，内部代号 **Larus / Flow**，产品即豆包）的静态分析，仅作**架构学习参考**。

### 1.1 产品一句话

> **Bot 会话壳 + 流式多 Block 消息 + Agent/Tool 运行时 + Lynx 动态卡片**

它不是「IM + 塞个 ChatGPT」，而是「以对话为 UI 的 Agent 操作系统」。

### 1.2 观察到的客户端技术栈（学习项目应对齐）

| 层级 | 豆包侧观察到的技术 | 本学习项目必须/建议 |
|---|---|---|
| 客户端壳 | 原生 Android（Kotlin/Java），AGP 7.4.x | **必须：Kotlin Android 宿主**（可同时开 Lynx for Web 调试） |
| 主 UI | 原生 View + DataBinding；部分 Compose/KMP | 原生 View/Compose 做壳：会话列表、输入栏、导航 |
| 对话列表 | `MessageAdapter` + Block Holder 注册表 | `blockType → Renderer`；部分 Renderer 内嵌 `LynxView` |
| 动态卡片 | **Lynx** + Gecko 离线包 + React 模板 | **必须：开源 Lynx + ReactLynx（Rspeedy）** 自建模板 |
| 模板分发 | GeckoX 频道/`res.zst` 热更新 | **自建轻量 Template Store**（本地 assets + HTTP zip）；不强制 GeckoX |
| JS 桥 | `callNativeAsync` / Apps API / XBridge 类能力 | Lynx NativeModules：`AgentBridge`（发消息、调 tool 状态、打开 Trace） |
| 本地 IM/会话管道 | 自研 Omni IM（JNI） | 自建 WS/SSE 会话层（学习重点在 Agent，不必复刻 Omni JNI） |
| Agent 相关包线索 | `agents` / `flowskill` / `instruction` / `uaigc` | 自研：`agent` / `skills` / `tools` |
| 网络 | Cronet 系 | OkHttp / Ktor（可接受；Cronet 非必须） |
| 存储 | WCDB/SQLCipher、Keva | Room/SQLite + DataStore（可接受） |
| 可观测 | AppLog / APM / Lynx Trace 面板 | 自研 trace API + **Lynx Trace 卡片** |
| RTC/硬件 | ByteRTC、Dora | **不做** |

### 1.4 为什么以前有人会「先不做 Lynx」，以及本规格为什么改成必做

- **以前跳过的原因只有成本**：Lynx 宿主集成 + 模板构建 + NativeModules 桥，会拉长 Phase A；与「先跑通 Agent 循环」抢时间。  
- **不是因为不能用**：Lynx / ReactLynx / Rspeedy 已开源（Apache-2.0）。豆包 APK 里也能看到 `liblynx*.so`、`lynx_core.js`、`agentTracePanel`、`doubao-apps-*.template.js` 等 Lynx 产物形态。  
- **本规格改为必做**：你要的是「架构与技术栈和豆包一类产品对齐」的学习项目，动态卡片层就应该是 Lynx，而不是 WebView 替代品。  
- **仍不必 100% 对齐的部分**：豆包的 **GeckoX 私有离线包管道**、AnnieX 业务封装、Apps 支付/蓝牙等巨型 JS API——用「Rspeedy 构建模板 + 自建 TemplateProvider」即可表达同一架构思想。

### 1.3 关键模块热度（便于你排优先级）

按 DEX 符号密度，客户端大致重心：

1. **对话主路径** `bmhome.chat.*`（最高优）
2. **IM/消息模型** `im.bean.message.block.*` + Omni JNI
3. **AIGC 创作** `uaigc.*`（学习项目可二期）
4. **硬件 Dora**（学习项目不做）
5. **agents / flowskill / instruction**（Agent 学习核心，要做）

---

## 2. 目标架构（请按此实现）

```text
┌──────────────────────────────────────────────────────────────────┐
│  Android Host (Kotlin)                                            │
│  Home/BotList → ChatScreen → InputBar / Skill                     │
│       │                                                           │
│       ├─ Native Renderers: thinking / text / code / error         │
│       └─ LynxView Renderers: tool card / trace panel / ask_user   │
│              ↑ template from TemplateProvider (assets or HTTP)    │
│              ↑ NativeModules: AgentBridge / Clipboard / Http      │
└───────────────────────────────┬──────────────────────────────────┘
                                │ WS / SSE / HTTP
┌───────────────────────────────▼──────────────────────────────────┐
│  API Gateway (BFF)                                                │
│  auth · bots · conversations · messages · skills · traces · tpl  │
└───────────────────────────────┬──────────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────────┐
│  Agent Runtime                                                    │
│  Orchestrator → LLM loop → Tool Registry                          │
│  Block Stream Publisher（thinking/text/tool/artifact）            │
└──────────────────────────────────────────────────────────────────┘

并行前端工程（模板）：
  packages/lynx-cards/   # ReactLynx + Rspeedy 构建 tool/trace 等卡片
```

### 2.1 领域模型（必须建表或等价存储）

```text
User
Bot                    # 助手人格：system_prompt、默认 tools、头像
Conversation           # user ↔ bot
Message                # 一条逻辑消息（用户或助手）
MessageBlock           # 消息内多块：type/payload/status/order_index
Skill / Instruction    # 可注入的提示模板或工具偏好
AgentRun               # 一轮 Agent 执行
AgentTraceSpan         # run 内步骤：llm_call / tool_call / tool_result
ToolDefinition         # name、json_schema、executor
```

### 2.2 消息必须是 Block 数组（对齐豆包思路）

一则助手回复 **禁止**只存一个 `content: string`。请存：

```json
{
  "messageId": "m_xxx",
  "role": "assistant",
  "status": "streaming|tooling|done|error",
  "blocks": [
    { "id": "b1", "type": "thinking", "status": "done", "text": "先拆解用户目标…" },
    { "id": "b2", "type": "tool", "status": "running", "name": "web_search", "input": {}, "output": null },
    { "id": "b3", "type": "text", "status": "streaming", "text": "根据搜索结果…" },
    { "id": "b4", "type": "code", "status": "done", "language": "python", "text": "print(1)" }
  ]
}
```

**MVP 必做 BlockType：**

| type | 用途 | 渲染层 |
|---|---|---|
| `thinking` | 思考过程（可折叠） | 原生 View |
| `text` | 最终/中间自然语言（支持 delta 追加） | 原生 View |
| `tool` | 工具调用过程卡片 | **Lynx 模板（必做）** |
| `code` | 代码块 | 原生或 Lynx |
| `error` | 错误 | 原生 View |
| `quick_reply` | 快捷追问按钮（可选但推荐） | 原生或 Lynx |
| `trace`（面板数据） | Agent 轨迹 | **Lynx 模板（必做）** |

**进阶 BlockType（二期，名称可自定，概念对齐）：**

- `artifact`（文件/长文产物）
- `search_result`（搜索结果列表）
- `task_card`（多步任务进度）
- `ask_user`（Agent 反问表单）
- `image` / `gen_image`

豆包侧曾出现的 Block 概念（仅作灵感，不要抄类名当依赖）：  
`ThinkingBlock`、`GenericToolBlock`、`TextBlock`、`CodeBlock`、`TaskCardBlock`、`Search*Block`、`ArtifactBlock`、`InteractionAskBlock`、`LynxBlock`、`QuickReplyBlock`、`LoadingBlock`。

---

## 3. 运行时流程（必须按此状态机实现）

### 3.1 用户发送主路径

```text
1. Client: 本地乐观插入 user message + assistant placeholder(status=streaming, blocks=[loading/thinking])
2. POST /api/v1/conversations/{id}/messages  (或 WS 发送)
3. Server: 创建 AgentRun
4. Orchestrator:
   a. 组装 messages（system=Bot+Skill, history, user）
   b. 调 LLM（stream）
   c. 若返回 tool_calls → 发 tool block(running) → 执行 Tool → tool block(done) → 把 tool result 塞回 messages → 再调 LLM
   d. 流式 text/thinking deltas 通过 SSE/WS 推给 Client
   e. 结束：status=done，写 AgentTraceSpan
5. Client: 按 block id 增量 patch UI（不要整表重刷）
```

### 3.2 Agent 循环伪代码（请实现等价物）

```text
run(user_message):
  emit thinking(optional)
  messages = build_context()
  for step in 1..max_steps:
    chunk_stream = llm.chat(messages, tools=registry.schemas(), stream=true)
    for event in chunk_stream:
      if event.thinking: emit/patch thinking block
      if event.text_delta: emit/patch text block
      if event.tool_calls: pending_tools = event.tool_calls
    if not pending_tools: break
    for call in pending_tools:
      emit tool block(running, name, args)
      result = tools.execute(call)
      emit tool block(done|failed, result)
      messages.append(tool_result)
  finalize message status=done
  persist trace
```

### 3.3 与豆包模块的概念对应（写进 README）

| 豆包线索 | 本项目模块 |
|---|---|
| `ChatActivity` + `MessageAdapter` | `ChatScreen` + `BlockRendererRegistry` |
| `ChatSender` / `ChatReceiver` / `ChatRepo` | `MessageService` + realtime publisher |
| `BotRepo` / `BotModel` | `Bot` 实体 + Bot 配置页 |
| `instruction` | `Skill` / Instruction 模板 |
| `flowskill` / TaskSkill | `AgentRun` 任务模式（二期：多步 task_card） |
| `agents`（Agents.md / WebFetch / WorkExperience） | `skills/agents.md` + `tools/web_fetch` + 可选 memory |
| `AgentTrace*` + Lynx Trace 面板 | `packages/lynx-cards/trace` + `LynxTracePanel` |
| `LynxBlock` / `SpringLynxBlock` / Apps 模板 | `LynxBlockRenderer` + TemplateProvider |
| `uaigc` | 二期图像生成 tool |
| Omni `DispatchCommand` / `AIJobSchedule` | 二期：定时任务 Agent |

### 3.4 Lynx 集成规格（必做，对齐豆包动态卡片层）

**官方资源（实现时以官网为准）：**

- 引擎：https://github.com/lynx-family/lynx  
- 前端栈：https://github.com/lynx-family/lynx-stack（ReactLynx、Rspeedy）  
- 文档：https://lynxjs.org  

**宿主侧（Android Kotlin）：**

1. 集成开源 Lynx Android SDK（版本写进 README，建议跟官方稳定 release）。  
2. `BlockRendererRegistry` 对 `tool` / `trace` 走 `LynxBlockRenderer`：创建 `LynxView`，加载对应 template bundle。  
3. 实现 `TemplateProvider`：  
   - 开发期：从 `assets/lynx/{cardName}/` 读 Rspeedy 构建产物；  
   - 进阶：`GET /api/v1/templates/{name}?v=` 拉 zip 并缓存（**自建**，不要依赖 GeckoX）。  
4. 注册 NativeModules `AgentBridge`，至少提供：  
   - `getBlockData(blockId)` / 订阅 block 更新（或由宿主 `updateData` 推入）  
   - `retryTool(blockId)`  
   - `openUrl(url)`  
   - `copyText(text)`  
5. 流式更新：SSE `block_upsert` 到达后，对已挂载的 LynxView 调用数据更新（等价于豆包对 Lynx card 的 data patch），**禁止**每次 delta 都 destroy/recreate LynxView。

**模板侧（ReactLynx）：**

1. 仓库内 `packages/lynx-cards/`，用 Rspeedy 分别构建：  
   - `tool-card`：展示 tool name、args、status、耗时、结果摘要、重试按钮  
   - `trace-panel`：时间线（llm_call / tool_call / tool_result）  
2. 卡片只负责 UI；业务状态以 data 从宿主注入。  
3. 可用 Lynx for Web 在浏览器里先调卡片，再嵌进 Android。

**与豆包的差异（诚实写进 README）：**

| 豆包 | 本学习项目 |
|---|---|
| Lynx + 内部 AnnieX/业务组件库 | 开源 Lynx + 自研卡片 |
| GeckoX 频道热更新 | assets + 可选自建 HTTP 模板包 |
| 巨型 Apps JS API | 精简 `AgentBridge` 即可 |

---

## 4. 必须实现的 Tool（学习 Agent 的关键）

用 **JSON Schema** 注册，LLM function-calling / tools 协议调用。

### 4.1 MVP Tools（≥3）

1. **`web_search`**  
   - 输入：`query`  
   - 输出：标题/链接/摘要列表  
   - 可用：Brave/SerpAPI/自建 mock（无 key 时用 fixture）

2. **`http_fetch`**（对齐「LocalWebFetch」思路）  
   - 输入：`url`  
   - 输出：抽取的正文（截断到 N 字符）  
   - 注意：SSRF 防护（禁内网 IP）

3. **`calculator`** 或 **`json_query`**  
   - 演示确定性 tool，便于测循环

### 4.2 推荐加的学习 Tools

4. **`memory_upsert` / `memory_search`**：简单向量或关键词记忆  
5. **`ask_user`**：发出 `ask_user` block，暂停 run，等用户回答后继续  
6. **`create_artifact`**：把长结果存成可下载 artifact  

每个 tool 执行都必须：写 `AgentTraceSpan` + 推送 `tool` block 状态变化。

---

## 5. API 合同（请实现，路径可微调但语义保持）

统一响应：`{ "code": 0, "message": "ok", "data": {} }`

```text
POST   /api/v1/auth/login
GET    /api/v1/bots
POST   /api/v1/bots                     # demo 可预置 1 个
POST   /api/v1/conversations             # { botId }
GET    /api/v1/conversations/{id}/messages
POST   /api/v1/conversations/{id}/messages
       body: { "text": "...", "skillId": null, "clientMsgId": "..." }
GET    /api/v1/conversations/{id}/events # SSE：block_patch / message_status / run_status
POST   /api/v1/conversations/{id}/cancel # 取消当前 AgentRun
GET    /api/v1/skills
POST   /api/v1/skills
GET    /api/v1/runs/{runId}/trace
GET    /api/v1/tools                     # 列出已注册 tools
```

**SSE 事件示例：**

```text
event: block_upsert
data: {"messageId":"m1","block":{"id":"b2","type":"tool","status":"running","name":"web_search"}}

event: block_delta
data: {"messageId":"m1","blockId":"b3","type":"text","delta":"你好"}

event: message_status
data: {"messageId":"m1","status":"done"}
```

幂等：同一 `clientMsgId` 重复提交不得创建第二个 AgentRun。

---

## 6. 技术选型（对齐豆包栈；实现 AI 不要擅自换成 RN/Flutter 壳）

| 层级 | 选型 | 说明 |
|---|---|---|
| App 宿主 | **Kotlin + Android** | 对齐豆包原生壳 |
| 动态 UI | **Lynx + ReactLynx + Rspeedy** | 开源，必做 |
| 卡片语言 | TypeScript/React（ReactLynx） | 对齐豆包模板形态 |
| BFF / Agent Runtime | TypeScript (Hono/Fastify/Nest) **或** Python (FastAPI) | 服务端 Agent；勿把 LLM 循环只放在端上 |
| DB | SQLite / PostgreSQL | 学习可用 SQLite |
| LLM | OpenAI-compatible | `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` |
| 实时 | SSE 优先 | block 增量推送 |
| 模板调试 | Lynx for Web | 可先 Web 调卡片再嵌 Android |

**Agent Runtime 必须在服务端**；Android/Lynx 只负责渲染与桥接。

---

## 7. 目录结构建议

```text
/
  apps/android/             # Kotlin 宿主：Chat、LynxView 嵌入、AgentBridge
  packages/lynx-cards/      # ReactLynx 卡片：tool-card、trace-panel
  packages/shared/          # Block/DTO 类型（TS，供卡片与 BFF 共用）
  services/api/             # BFF + Agent Runtime + template 静态/下载
    src/
      modules/bots/
      modules/chat/
      modules/agent/
        orchestrator.*
        tool_registry.*
        tools/
      modules/trace/
      modules/templates/
  docs/architecture.md
  README.md
  .env.example
```

---

## 8. UI 信息架构（学习向，自创视觉）

1. **左侧/列表**：Bot 列表 + 会话历史  
2. **中间**：Chat  
   - 上方消息：按 block 渲染（thinking 默认折叠）  
   - 下方输入：文本框 + 技能选择 + 发送 + 停止  
3. **右侧或抽屉**：Trace（时间线：LLM / Tool / 耗时）  
4. **设置页**：模型配置、Tool 开关、system prompt

视觉要求：清晰、可学习；不要仿豆包品牌色与图标。

---

## 9. 分阶段交付（实现 AI 按阶段提交）

### Phase A — Android 壳 + 能聊

- Kotlin Chat 页 + Bot/Conversation  
- 原生 text block + 假流式或真流式 text  
- 接入 Lynx SDK（先显示一个 Hello Lynx 卡片证明集成成功）

### Phase B — 真流式 + Thinking

- SSE `block_delta` / `block_upsert`  
- thinking + text（原生）

### Phase C — Tool Loop + Lynx tool-card（核心）

- tool registry + ≥3 tools  
- `tool` block 用 **ReactLynx tool-card** 渲染，支持 running→done 数据 patch  
- max_steps、超时、取消、AgentBridge.retryTool

### Phase D — Skills + Lynx Trace

- Instruction/Skill 注入  
- **Lynx trace-panel**  
- clientMsgId 幂等  
- TemplateProvider（assets；可选 HTTP）

### Phase E（进阶，仍保持 Lynx）

- `ask_user` Lynx 表单卡片  
- artifact / search_result 卡片  
- memory  
- 定时 Agent Job  
- 模板热更新（自建，非 GeckoX）

---

## 10. 测试要求

1. 单元测试：Orchestrator 在 mock LLM 下走完「1 次 tool_call → 最终 text」。  
2. 集成测试：POST message 后 SSE 依次收到 thinking → tool → text → done。  
3. 手工脚本：README 里给出 curl + 预期事件序。  
4. 安全：`http_fetch` 拒绝 `127.0.0.1` / `10.0.0.0/8` 等。

---

## 11. README 必须包含的对照表（请原样结构填写）

| 学习点 | 豆包架构线索 | 本仓库实现位置 |
|---|---|---|
| Bot 会话 | BotModel / Conversation | … |
| 多 Block 消息 | message.block.* | … |
| 发送管线 | ChatSender / ChatRepo | … |
| Agent 循环 | SuperAgent / ToolCall / Workflow 概念 | … |
| 技能 | instruction / flowskill | … |
| 追踪 | AgentTrace* | … |
| 动态卡片引擎 | Lynx（开源） | apps/android + lynx-family SDK |
| 卡片业务模板 | React 模板 / agentTracePanel / Apps | packages/lynx-cards（ReactLynx） |
| 模板分发 | GeckoX | TemplateProvider（assets/HTTP，自建） |

---

## 12. 环境变量模板

```env
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=
LLM_MODEL=gpt-4o-mini
AGENT_MAX_STEPS=8
AGENT_TOOL_TIMEOUT_MS=30000
DATABASE_URL=sqlite://./data/agent.db
# 可选搜索
BRAVE_API_KEY=
```

---

## 13. 给你（实现 AI）的执行指令

1. 先创建仓库骨架与 `docs/architecture.md`（含架构图）。  
2. 按 Phase A→D 顺序实现，每阶段可运行。  
3. 任何时候都不要引入豆包/字节私有 SDK、域名、资源。  
4. 不确定产品细节时，优先选择**更简单且能讲清 Agent 原理**的实现。  
5. 完成后用中文总结：用户如何通过本项目理解「对话 UI = Agent 操作系统」。

---

## 附录 A — 豆包客户端分层速记（供讲解，勿当 SDK）

```text
NovaApplication
  → init tasks（账号/日志/AB/IMSDK/…）
  → MainActivity（Home/Bot/会话列表）
  → ChatActivity
       Input(ICoreInputAbility / Instruction / Skill)
       → ChatSender
       → IM SDK / 网络
       ← 流式 Message(blocks[])
       → MessageAdapter / BlockProviders 渲染
       → AgentTrace 面板（Lynx 模板在正式 App 中出现）
```

## 附录 B — Agent 相关能力地图（学习范围勾选）

- [x] 对话式 Agent  
- [x] Tool Calling 循环  
- [x] 流式 Block UI  
- [x] Skill/Instruction  
- [x] Trace  
- [ ] 多 Agent 协作（可选）  
- [ ] 定时 Job Agent（可选）  
- [x] Lynx 动态卡片（tool / trace）  
- [ ] GUI/浏览器操作型 Agent（可选，复杂度高）  
- [ ] 端侧硬件 Agent（不做）  
- [ ] 电商/直播/支付（不做）

---

**一句话目标：**  
用 **Kotlin 宿主 + 开源 Lynx 卡片 + 服务端 Agent Runtime**，做出一个「能看见 Agent 在想什么、在调什么工具、如何把结果拼成 Block/Lynx 卡片」的学习项目——对齐豆包类产品的架构精髓。
