# Chat / 大语言模型规则规格

> **用途：** 新增或修改 LLM 时对照，避免改 A 坏 B（展示管线、模型切换、联网、持久化、画布分镜联动）。  
> **代码真源：** `ChatPanel.tsx` · `utils/assistantMessageLayout.ts` · `utils/webSearchProbe.ts` · `server.js` `/aitop-llm-see` · `vite.config.ts`  
> **关联：** [SKILL 决策树](../.cursor/skills/flowgen-ai-studio/SKILL.md) · [MODEL-MEDIA-RULES-SPEC](./MODEL-MEDIA-RULES-SPEC.md)（画布 @ 与 Chat 分镜注入分离）

---

## 0. 架构：三层不要混

| 层 | 职责 | 主要文件 |
|----|------|----------|
| **模型注册 / 路由** | UI 可选模型、`normalizeModelId`、API `model` 名、fallback 链 | `utils/aitopChatModels.ts` · `ChatPanel.tsx`（`sendByModel` / `handleAitopLlmSend`） |
| **流式展示管线** | SSE 解析 → thinking / 联网过程 / 正文 / 表格；与模型无关 | `utils/assistantMessageLayout.ts` |
| **联网检索词** | 追问改写、fallback、二次总结触发 | `utils/webSearchProbe.ts` |

**铁律：** 加模型只动「注册/路由」分支；**不要**在 `sendByModel` 里复制一套 markdown 解析（统一走 `assistantMessageLayout`）。

---

## 1. 现有模型注册表

| UI `modelId` | 上游 API 名 | 通道 | 联网 | 深度思考 |
|--------------|-------------|------|------|----------|
| `gemini-3-pro` | `gemini-3.1-pro-preview:streamGenerateContent` | `/aitop-llm-see` | ✓ | ✓ |
| `claude-4.5` | `claude-sonnet-4-6` | `/aitop-llm-see` | ✓ | ✓ |
| `deepseek-v4-pro` | `deepseek-v4-pro-260425` | `/aitop-llm-see` | ✓ | ✓ |
| `doubao-seed-2.0` | `doubao-seed-2-0-pro-260215` | `/aitop-llm-see` | ✓ | ✓ |
| `qwen` | `Qwen3-VL-235B-A22B-Instruct` | `/api/v1/chat/completions` | ✗ | ✗ |

**兼容别名（持久化/旧数据）：** `gemini3pro` → `gemini-3-pro`；`claude45` → `claude-4.5`；未知 id → 默认 `claude-4.5`。

**Fallback 链（上游失败时，真源 `utils/aitopChatModels.ts`）：**

- 任一 AiTop 主模型 → `claude-4.5` → `gemini-3-pro` → `deepseek-v4-pro` → `doubao-seed-2.0` → `qwen`（跳过当前主模型）
- Qwen 主 → 无自动 fallback（VL 专用）

---

## 2. 新增 / 修改 LLM 必改清单

按顺序核对，**漏一项易回归**：

### 2.1 注册与路由

- [ ] `utils/aitopChatModels.ts`：`AITOP_CHAT_MODELS` 增加 `{ uiId, name, apiModelName, displayLabel, ... }`
- [ ] `AITOP_CHAT_FALLBACK_ORDER` 含新模型（Qwen 仍为末位 fallback）
- [ ] `ChatPanel.tsx`：`AI_MODELS = buildChatAiModelsForUi()` 自动含新项
- [ ] `sendByModel`：AiTop 模型统一走 `isAitopLlmUiModel` → `handleAitopLlmSend`（勿复制 Claude/Gemini 发送逻辑）
- [ ] 能力开关：联网 / 深度思考 / 图片输入 — `isQwenChatUiModel` 控制 disabled，发送 payload 一致
- [ ] 持久化：`PersistedCanvasChatV1.modelId` 读写走 `normalizeChatModelId`

### 2.2 代理与部署

- [ ] **Gemini/Claude 类：** `server.js` → `POST /aitop-llm-see`；`vite.config.ts` dev 同源代理
- [ ] **OpenAI 兼容类：** `server.js` / vite 对 `/api/v1/chat/completions` 代理（若新模型走此通道）
- [ ] 生产 Nginx：转发路径与 dev 一致

### 2.3 展示管线（通常不用改）

仅当新模型 SSE JSON 字段**不同**时，改 `ChatPanel` 流解析 + `normalizeAssistantStream`；否则只改路由。

### 2.4 测试（必跑）

| 场景 | 命令 |
|------|------|
| 日常改 Chat/LLM | `npm run test:chat-gate` |
| 改模型注册/切换/fallback | + `npm run test:llm-model-contract` |
| 发版 / 用户说发布 | gate + contract + `test:chat-all` + `test:llm`（需 localhost API） |

在 `scripts/llm-model-registry-contract-test.mjs` **加一条**新模型代表用例。

---

## 3. 禁止事项

- 禁止在 `ChatPanel` 内联解析 thinking/联网 markdown（用 `assistantMessageLayout`）
- 禁止改模型切换时清空用户消息（仅插入 meta 切换提示）
- 禁止 Qwen 路径 silently 开启联网（UI 已 disabled）
- 禁止 fallback 到 Qwen 时保留 thinking/webSearch 请求参数（已有 strip 逻辑）
- 禁止把 Chat 历史 `modelId` 与画布节点 `selectedModel`（生成模型）混用

---

## 4. 与画布 / 分镜的边界

| 能力 | Chat | 画布节点 |
|------|------|----------|
| 改节点 prompt / @ | `buildNodePromptUpdatePatch`（Chat 可写） | `NodeInspector` |
| 分镜表 spawn | `spawnStoryboardNodesFromTable` 回调 | `FlowEditor` |
| 生成模型 run | 不涉及 | `FlowEditor` + `aitop.ts` |

改 Chat 分镜 spawn **不**应动 `promptMediaRefs` / `panelRefPersistence`；改完跑 `test:chat-gate`，**不必**跑 `test:model-contract`（除非同时改了 @ 链路）。

---

## 5. 自动化覆盖

| 套件 | 覆盖 | 命令 |
|------|------|------|
| **test:chat-gate** | layout + pipeline + probe fallback + **§5.10 identity-contract** + 模型注册契约 | `npm run test:chat-gate` |
| **test:llm-chat-identity-contract** | 身份/问候关联网、probe 不串历史、tip 按需、源码防回退 | 含在 chat-gate |
| **test:llm-model-contract** | `AI_MODELS` / normalize / fallback / 代理路由存在 | `npm run test:llm-model-contract` |
| test:layout | assistantMessageLayout 单元 | 含在 chat-gate |
| test:chat-pipeline | 联网两轮 + 表格 + tip 剔除 | 含在 chat-gate |
| test:llm:probe | 联网检索词改写 + 问候不串历史 | `npm run test:llm:probe`（gate 离线） |
| **test:llm:four-mode** | 全 AiTop 模型 × 四模式（关/仅联网/仅思考/联网+思考）真实 API | `npm run test:llm:four-mode`（发版） |
| test:llm:chat-audit | 身份 live 冒烟（DeepSeek） | 发版可选 |
| test:llm | context + switch-matrix + combo（**需 API**） | `npm run test:llm` |
| test:chat-live / tricky:live | 真实 SSE 冒烟 | 发版可选 |

**仍未自动化：** 各模型真实多轮对话手感、图片上传 VL、MySQL chat-history 多端同步。

---

## 6. 三层测试金字塔（Chat 专用）

```
日常改 Chat/LLM  → npm run test:chat-gate           （~10s，纯离线，含 §5.10）
改模型注册/切换   → npm run test:llm-model-contract   （~1s，解析 ChatPanel）
发版 / 大版本     → chat-gate + llm-model-contract + test:chat-all + test:llm:four-mode + test:llm（API）
```

### 6.1 联网首轮与轻量句（2026-07-09 · 已验收 §5.10）

- **轻量句**（`isNonSearchableChatUtterance`）：问候、致谢、**身份元问题**（「你是哪个模型」等）即使 UI 开着联网，**本轮也不走 probe 首轮**。
- **身份 tip（按需）**：仅当 `isAssistantIdentityQuestion` 为真时，tip 注入当前 `displayLabel` 一句轻量说明；**普通问答不注入**，让上游按 API 自然回复。
- **probe**：非检索句禁止 LLM/历史拼接改写，避免上一轮话题污染。
- **切模型**：保留历史 + meta 提示；Qwen 关闭联网/思考；AiTop 模型保留开关状态（见 §3）。
- **门禁**：日常 `test:chat-gate`（含 `test:llm-chat-identity-contract`）；发版加 `test:llm:four-mode`。
- **冻结详情**：根目录 `skill.md` **§5.10**。

---

*文档版本：2026-07-09 · 与当前工作区同步*
