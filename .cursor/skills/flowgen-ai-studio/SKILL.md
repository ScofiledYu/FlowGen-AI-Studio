---
name: flowgen-ai-studio
description: >-
  FlowGen AI Studio 功能架构、修改禁区与回归测试清单。修改 FlowEditor、NodeInspector、
  模型运行、@引用（面板下拉↔创意描述↔发模型 plan）、首尾帧、多图参考主图运行后恢复、
  面板换图后 @资产 解析、面板本地媒体 IndexedDB 持久化、MySQL workspace gzip 压缩保存、
  画布暂停刷新、批量运行进度条 UI、选择运行/全部运行/定时批量、Node Details、下载/代理、
  中键拖放/Inspector 锚定/MiniMap、多图生成数、分镜、Chat/LLM 注册、主图=参考槽去重、
  Backdrop 缩放、preload 日志、Node Details ←→ 整份历史、项目持久化或 server.js 前必读。
---

# FlowGen AI Studio — 项目 Skill

> **注意：** 本项目标准说明书已迁移至**项目根目录 `skill.md`**。该文件包含本 Skill 的全部内容，并额外补充了「模块稳定性分级（S/A/B/C）」、核心数据结构字段说明、关键函数入参/出参/调用示例。后续修改代码前，**优先以根目录 `skill.md` 为准**，并同步更新本副本。

## 决策树（Agent 先读此节，~1 分钟）

**第 0 步 — 完成前机械门禁（比读本 skill 更重要）：**

```bash
npm run test:gate                    # 日常改画布/面板/API ~20s
npm run test:model-contract          # 改 @/面板/API 时
npm run test:chat-gate               # 日常改 Chat/LLM ~12s（含 §5.10.4 display-contract）
npm run test:llm-model-contract      # 改 LLM 注册/切换时
npm run test:delivery-all            # 发版（媒体）
npm run test:chat-all && npm run test:llm && npm run test:llm:four-mode   # 发版（Chat，需 API）
```

未全绿 **不得** 声称改完。规则见 `.cursor/rules/regression-gate.mdc` · 自动构建启动规则见 `.cursor/rules/auto-build-and-run.mdc` · 规格见 `docs/MODEL-MEDIA-RULES-SPEC.md` · `docs/LLM-CHAT-RULES-SPEC.md`。

**第 0.5 步 — 已验收勿改（2026-07-07/08/09/10/13，详见根目录 `skill.md` §5.8 + §5.9 + §5.10 + §5.11 + §5.12 + §5.13）：**

- **四大域冻结（§5.9）**：模型 UI 面板 / 生成结果 / 拖拽 / Node Details — 改任一项须 `npm run test:gate` 全绿（44 步，含 `all-models-three-requirements` + `four-mention-all-models` + **`asset-mention-details-recovery`（§5.8.5）** + **`banana-run-gp-at-mention` §8–§9 / `promptRerunCanonical`（§5.8.7）** + **`20260713-export-json-main-image`（§5.13）**）
- **§5.8.5 @资产+gp空 Details（S级·已验收）**：`resolveProjectAssetUrlFromTokenKey` row.url 回退；Nano/image2 gp 空 Details 仅 @；四模型 fixture — 只在本节门禁下改 bug
- **§5.8.7 二次运行 prompt 不写回（S级·已验收）**：`handleNodeRun` canonical 仅进 run 快照；Seedance 运行中/收尾不写 `refTab.prompt`；六模型 Inspector 保持用户原文 — 只在本节门禁下改 bug
- **Chat 身份/联网/tip（§5.10）**：问候/身份问关联网；probe 不串历史；身份 tip 按需；日常 `test:chat-gate`（含 identity-contract）；发版加 `test:llm:four-mode`
- **发版交付冻结（§5.11）**：preload 默认开；主图=参考槽时展示不丢图 + sync 用 `shouldDedupePanelRefsAgainstMainForSync`；Backdrop 手柄须 `pointer-events-auto` + resizer CSS
- **Node Details ←→ 整份历史（§5.12）**：`buildNodeDetailsPreviewFromGeneratedThumb` + `previewActiveThumbId` 锁；**禁止**只换预览 URL / 历史态被 live MOV sync 覆盖
- **导出 JSON 跨机器主图 hydrate（§5.13·S级）**：`hydrateNodeImagePreviewFromPersisted` 已持久化 COS 主预览勿清空；仅空 preview / 非持久化 / preview=面板首参考槽时走 IDB — 只在本节门禁下改 bug
- **可灵3.0 Omni 四 tab**：主图四 tab **共用**；仅参考图/顶栏视频/首尾帧按 tab 隔离 → 只动 `utils/klingOmniTabPanelIsolation.ts` + `switchKlingOmniTab`；**禁止**按 tab 拆主图
- **image2 切模型主图**：只动 `utils/image2PanelRefs.ts`（`image2MainPatchOnModelSwitch`）+ 相关 strip 规则
- **各模型首尾帧/主图/参考 IDB 隔离**（SD2.0 两型号除外）：只动 `utils/localNodeMediaStore.ts` + `handleModelChange` 快照
- **Inspector 中键/Shift 框选拖入去重（§5.8.4·S级）**：`referenceElementIds` / `klingOmni*ReferenceElementIds` + `canvas:{nodeId}` + `nodeDataRef` 读 eids + 单次 `onUpdate` + `inspectorReferenceDropQueue`；**禁止**回退为仅 URL 去重或读 React `data` prop

**第 1 步 — 我改的是哪一类？**

| 用户现象 / 任务 | 只允许优先动 | 必加回归用例位置 | gate 外必跑 |
|----------------|-------------|-----------------|------------|
| 属性面板格子/对齐/首帧 UI | `NodeInspector.tsx`、`firstFramePanel.ts` | `first-frame-panel-default-fill-test.ts` | — |
| 面板保留未@槽 / Details 仅@引用 / 运行后新图可@ | `referencedMediaRun.ts` `promptMediaRefs.ts` `nodeDetailsPreview.ts` | `panel-partial-ref-matrix-test.ts` + `model-media-contract-test.ts` | — |
| **gp 空 + @资产+@图片n Details 少一张（banana-问题4·§5.8.5 S级）** | **仅** `promptMediaRefs.ts` `resolveProjectAssetUrlFromTokenKey`、`referencedMediaRun.ts` `pickStillImageRecovery*`、`nodeDetailsPreview.ts` `buildStillImageGenNodeDetails*` | `20260710-asset-mention-details-recovery-test.ts` + fixtures banana-源/问题4 + `projectAssetUrlFromTokenKey.test.ts` | `test:gate` 第 43 步 |
| **二次运行创意描述 @ 引用被 rewrite（§5.8.7·S级）** | **仅** `FlowEditor.tsx` `handleNodeRun`（不写回 `promptCanonPatch`）；Seedance 参考生运行中/收尾不写 canonical prompt | `20260710-banana-run-gp-at-mention-test.ts` §8–§9 + `promptRerunCanonical.test.ts` | `test:gate` 第 42 步 + vitest |
| 面板主图格 × 创意描述 / 运行后画布=参考图 | `referencedMediaRun.ts` `shouldShowPanelMainImageSlot` | `panel-main-slot-prompt-test.ts` + `ggggttt-panel-preview-test.ts` | — |
| Seedance 参考生 gp stale / 面板重复主图 / Details 三态（444444） | `runRecovery.ts` `referencedMediaRun.ts` `FlowEditor` spawn | `444444-panel-details-verify-test.ts` + `runRecovery.test.ts` + `panelMainSlotPrompt.test.ts` | — |
| Omni 指令 @主视频（imagePreview=PNG，900788） | `promptMediaRefs.ts` `NodeInspector.tsx` | `omniMainVideoLabel.test.ts` + `node-details-simulation-test.ts` §11p + `model-media-contract-test.ts` | — |
| Omni 视频参考 tab Details 视频角标（990） | `nodeDetailsPreview.ts` `FlowEditor.tsx` | `referenceVideoDetail.test.ts` + `node-details-simulation-test.ts` §11q + `model-media-contract-test.ts` | — |
| 定时批量「定时」角标逐节点清除 | `FlowEditor.tsx` `batchRunQueue.ts` | `batch-run-schedule-test.ts` §8 | — |
| Node Details 标签/参考图与面板不一致 | `nodeDetailsPreview.ts`、`FlowEditor` previewParams | `node-details-simulation-test.ts` §11k–§11n | `test:model-contract` |
| **Node Details ←→ 只换视频不换整份（§5.12 已验收）** | **仅** `utils/generatedThumbKeyboardNav.ts`、`FlowEditor` previewActiveThumbId / createPreviewNodeFromThumbnail、`CustomNode` preview 事件 | `generatedThumbKeyboardNav.test.ts` | `test:gate` |
| Seedance 参考生 Details 模式/参考视频误显示 | `referencedMediaRun.ts`、`nodeDetailsPreview.ts`、`FlowEditor` gp/spawn/Details | `node-details-simulation-test.ts` §11d–§11f、`444444-panel-details-verify-test.ts`、`model-media-contract-test.ts`、`seedanceReferenceDetails.test.ts` | — |
| 运行/upload/API 入参与 @ 不一致 | `referencedMediaRun.ts`、`FlowEditor` run 段 | `i2v-pipeline-matrix-test.ts` | `test:model-contract` + `test:delivery` |
| 刷新后单节点进度条丢失 | `runRecovery.ts`、`FlowEditor` appendRunTaskId、`useAiTopRunRecovery.ts` | `src/test/utils/runRecovery.test.ts` | — |
| OUTPUT/MOV 无法拖入参考图/尾帧 / 刷新后用户媒体丢失 | `NodeInspector.tsx` 面板 effect、`panelRefPersistence.ts` `sanitizeOutputLikeNodeDataOnLoad` | `panel-ref-media-simulation-test.ts` §129、`first-frame-panel-default-fill-test.ts` §9 | — |
| OUTPUT/MOV 首帧图抖动（restore↔clear 循环） | `NodeInspector.tsx` seedance `useEffect` 守卫、`panelRefPersistence.ts` `sanitizeOutputNodeFramePanelPatch` | `first-frame-panel-default-fill-test.ts` §8 | — |
| 创意描述粘贴/@ 下拉/扫描 | `NodeInspector.tsx`、`promptMediaRefs.ts` | `prompt-edit-matrix` / `prompt-asset-scan` | — |
| spawn 输出节点 / generationParams | `FlowEditor` spawn 段 | `panel-refs` + `project-json-details` | `test:model-contract` |
| Chat / LLM 展示 / 联网 / 思考块 | `assistantMessageLayout.ts`、`webSearchProbe.ts` | `chat-pipeline-regression-test.ts` | `test:chat-gate` |
| **Chat 身份/联网/tip（§5.10 已验收）** | `webSearchProbe.ts`、`ChatPanel` tip/轻量句 | `llm-chat-identity-contract-test.mjs` | `test:chat-gate` |
| **Chat 展示/模式开关（§5.10.4 已验收）** | `assistantMessageLayout.ts` flatten/strip/recover/parse；`ChatPanel` compose/guard/rawFallback | `llm-chat-display-contract-test.mjs` + `assistant-message-layout-test.ts` | `test:chat-gate` |
| Backdrop 组名/缩放后误编辑 | `BackdropNode.tsx`、`utils/backdropLabel.ts` | `src/test/utils/backdropLabel.test.ts` | — |
| **Backdrop 创建后四角无法鼠标缩放（§5.11.3）** | `BackdropNode.tsx` 手柄 `pointer-events-auto`、`index.tsx` resizer CSS、`backdropLabel.ts` | `backdropLabel.test.ts`（`backdropResizeHandleNeedsPointerEventsAuto`） | `test:gate` |
| **运行后主图=参考槽同 URL 丢图 / sync 清空槽（§5.11.2）** | `referencedMediaRun.ts`（`shouldDedupePanelRefsAgainstMainForSync`）、`NodeInspector` 展示去重 | `20260709-seedance-main-dup-ref-panel-test.ts` + `20260709-all-models-main-dup-ref-panel-test.ts` | `test:gate` |
| **各模型 preload 控制台日志被关掉（§5.11.1）** | `services/aitop.ts` `isPreloadDebugEnabled`（默认 `!== false`） | —（勿改默认关） | — |
| 刷新后本地参考图/主图丢失 | `utils/hydratePanelReferenceLocalRefs.ts`、`utils/localNodeMediaStore.ts`、`FlowEditor.tsx` hydrate | `hydratePanelReferenceLocalRefs.test.ts` + `panel-ref-media-simulation-test.ts` | — |
| 链式 OUTPUT 生成后 INPUT 画布被 outputUrl 覆盖 / 面板空但 Details 有 gp（oooopppp） | `hydratePersistedNodePreviews.ts` `nodeDetailsPreview.ts` | `test:oooopppp-panel` | `test:gate` |
| **导出 JSON 跨机器 INPUT 主图 EMPTY（§5.13）** | **仅** `utils/hydratePersistedNodePreviews.ts` `hydrateNodeImagePreviewFromPersisted` | `20260713-export-json-main-image-persist-test.ts` + fixture `20260713-export-json-main-image-persist.json` + vitest `hydratePersistedNodePreviews.test.ts` | `test:gate` 第 44 步 |
| Omni video tab 恢复 spawn 后 gp 缺 referenceImages/MOV（89908111222） | `runRecovery.ts` `FlowEditor` spawn/recovery | `test:89908111222-omni-recovery` | `test:gate` |
| 多图/多条生成数量解析错误 | `utils/panelGenerateCount.ts` `utils/multiGenerateTasks.ts` `FlowEditor` run | `src/test/utils/panelGenerateCount.test.ts` | `test:gate` |
| image2 运行后参考图丢失 / 主图覆盖参考槽（778990） | `utils/image2PanelRefs.ts` `utils/referencedMediaRun.ts` `buildPanelImagePreviewPatchAfterRun` | `test:778990-cat-church` | `test:gate` |
| **image2 切模型主图消失/裂图（已验收 §5.8.2）** | **仅** `utils/image2PanelRefs.ts` `hydratePanelReferenceLocalRefs.ts` `NodeInspector` image2 分支 | `image2-panel-refs-test.ts` + `panel-switch-broken-urls-test.ts` | `test:gate` |
| **Omni 四 tab 参考/首尾帧串数据或切 tab 丢主图（已验收 §5.8.1）** | **仅** `utils/klingOmniTabPanelIsolation.ts` `NodeInspector.switchKlingOmniTab` `localNodeMediaStore` Omni ref/frame 键 | `kling-omni-tab-isolation-test.ts` + `klingOmniTabPanelIsolation.test.ts` | `test:gate` |
| **各模型尾帧/主图/参考被覆盖（已验收 §5.8.3）** | **仅** `utils/localNodeMediaStore.ts` `modelSwitchPanelIsolation.ts` `handleModelChange` 首尾帧快照 | `frame-model-switch-isolation-test.ts` | `test:gate` |
| **Shift+框选中键重复拖入多槽 / 本地 1 张双槽（已验收 §5.8.4）** | **仅** `inspectorReferenceDropQueue.ts` `referenceImageSlotLabels.ts` `NodeInspector` 拖入路径 `referencedMediaRun.buildOmniMultiApiImageList` | `test:2026070802-omni-panel-dedup` + `omniPanelInspectorDropDedup.test.ts` + `panel-dedup-same-element` | `test:gate` |
| 下载到 openApi 中间链而非成品 COS | `utils/generatedOutputUrl.ts` `utils/taskStatusImageUrl.ts` `utils/taskStatusMediaUrl.mjs` | `test:download-url-ranking` | `test:gate` |
| 画布/资产库中键拖放到参考槽 | `utils/middleButtonMediaDrag.ts` `utils/canvasMiddleDrag.ts` `utils/inspectorMediaDrop.ts` | vitest：`middleButtonMediaDrag` `canvasMiddleDrag*` `inspectorMediaDrop` `panelRefInspectorDropLabel` | — |
| Shift 多选时 Inspector 不应切换 | `utils/inspectorAnchorSelection.ts` `utils/inspectorAnchorSession.ts` | vitest：`inspectorAnchorSelection` `inspectorAnchorSession` | — |
| MiniMap 缩放/纵向工程显示异常 | `utils/flowgenMiniMapLayout.ts` `components/flowgen/FlowgenMiniMap.tsx` | vitest：`flowgenMiniMapLayout`；烟测 `minimap-*-smoke.mjs` | — |
| Seedance 2.0 高质量↔急速切换丢 tab 配置 | `utils/seedance20ModelSwitch.ts` `NodeInspector.tsx` | vitest：`seedance20ModelSwitch` | `test:gate` |
| 新增/改 LLM 模型注册 | `utils/aitopChatModels.ts`（`AITOP_CHAT_MODELS`）；`ChatPanel.tsx` 仅 UI 路由 | `llm-model-registry-contract-test.mjs` | `test:chat-gate`（已含 llm-model-contract） |
| MySQL / workspace 保存 | `server/flowgen/*`、`persistSanitize.mjs` | `workspace-codec` | `persist-sanitize-test.mjs` |

**第 2 步 — 三态铁律 + 面板/Details/@ 产品规则（2026-07-03，取代旧「运行后 prune 未@槽」）：**

| 层 | 规则 |
|----|------|
| **面板（源 INPUT/PROCESSOR + 用户手动编辑的 OUTPUT/MOV）** | 运行后**保留全部**已拖入参考图/视频/音频/首尾帧；**不因创意描述未 @ 而裁剪或清空槽位** |
| **generationParams / Node Details（OUTPUT/MOV）** | **仅**含当次运行创意描述 **@ 引用**到的素材；禁止用当前面板态补齐 Details/API 快照 |
| **@ 下拉** | 只列**当前面板已有**槽（含运行后新拖入）；禁止合并全资产库 |
| **API / 上传** | 仅 `collectReferencedMediaFromPrompt` plan 中实际 @ 到的 token |

三态存储仍分离：

1. **面板态** → Inspector 编辑用（`NodeData` 顶层、`seedanceTabConfigs`…）
2. **运行快照** → `generationParams`（spawn 时写入 OUTPUT/MOV）
3. **Node Details** → OUTPUT/MOV **只读快照**，勿用面板 fallback 冒充 API 入参

**第 3 步 — 禁止事项：**

- 禁止一次 PR 同时改「面板清空 + spawn + load hydrate + Details 标签」除非用户明确要求
- 禁止在 `NodeInspector` 内定义新子组件（用模块级 + `React.memo`）
- 禁止 OUTPUT/MOV 把 `generationParams.referenceImages` / 首尾帧 URL 写回面板参考格（**2026-06 产品规则更新：一律不写回，含 `@图片n` 场景**）

**第 4 步 — 细节与历史：** 下文 § 架构、§ 不变量、§ 开发记录。

**发版：** 用户说「发布 / 发版 / 上线」时，Agent 必须自动跑 **媒体** `test:gate`（已含 model-contract） → `test:project-json-details` → `test:delivery-all` → `npm run build`，以及 **Chat** `test:chat-gate`（已含 llm-model-contract） → `test:chat-all` → `test:llm`（API 可用时），并汇报每步结果（见 `.cursor/rules/regression-gate.mdc` · 发版门禁）。发版前另跑 `npm run test:deploy-files` 核对运行时文件与 `FLOWGEN_JWT_SECRET`（见根目录 `skill.md` §11.1）。

---

## 何时使用

- 修改画布、属性面板、模型运行、Node Details、下载、分镜、Chat、认证、服务端路由
- 用户报告「改 A 坏了 B」或需要理解数据流
- **任何上述修改完成前：`npm run test:gate`**

## 架构速览

```
index.tsx → App.tsx (#/ hash 路由)
  ├─ Login / Projects / Admin → services/flowgenApi.ts → /flowgen-api
  └─ Workspace → FlowEditor.tsx（核心 monolith ~15k 行）
       ├─ ReactFlow: CustomNode / ChainFolder / Backdrop
       ├─ NodeInspector.tsx（模型面板 ~7k 行）
       ├─ Sidebar → ChatPanel + 分镜条
       ├─ Node Details 弹窗（utils/nodeDetailsPreview.ts）
       └─ services/aitop.ts → server.js 代理 → AITOP API
```

**生产入口：** `npm run build` → `npm start`（`server.js`，默认 3001）
- `npm run build` 前自动执行 `prebuild` 脚本链（ChatPanel 中文化/字符串修正），勿手动跳过；若 `prebuild` 失败需修复脚本或文件内容，否则 dist 中文化不一致
**开发：** `npm run dev:full` = Vite + `server/flowgenApiOnly.mjs`

---

## 修改前检查清单

```
- [ ] 明确改的是「面板态」还是「运行快照 generationParams」还是「Node Details 展示」
- [ ] 是否影响创意描述：粘贴 / @ 下拉 / 扫描 @素材 / tab prompt 同步（见 §9）
- [ ] 是否影响「选择运行 / 全部运行 / 定时」队列收集或快照（`utils/batchRunQueue.ts`）
- [ ] 改运行后面板主图：是否动 `panelMainImageUrl` / `buildPanelImagePreviewPatchAfterRun` / NodeInspector `nodeId` restore（见 §12）
- [ ] 改 workspace 保存 / MySQL：gzip 编解码、503/413 分级、重试 + 安全 rollback（见 §13）
- [ ] 是否影响 blob/data/COS/代理 URL 优先级
- [ ] 是否影响面板本地媒体持久化（`referenceImageLocalRefs` / `imageLocalRef` / IndexedDB）
- [ ] 是否影响多图生成数（`panelGenerateCount`）或并行轮询（`multiGenerateTasks`）
- [ ] 是否影响画布中键拖放 / 资产库拖放 / Inspector 槽（`middleButtonMediaDrag`、`canvasMiddleDrag`、`inspectorMediaDrop`）
- [ ] 是否影响 Shift 多选 Inspector 锚定（`inspectorAnchorSelection`）
- [ ] 是否影响 MiniMap 布局（`flowgenMiniMapLayout`、`FlowgenMiniMap`）
- [ ] 是否影响 Seedance 2.0 高质量/急速切换（`seedance20ModelSwitch`）
- [ ] 是否影响 image2 成品像素探测（`probeRemoteImageDimensions` / `outputImageSize`）
- [ ] 是否需在 server.js 与 vite.config.ts 同步（proxy、download-task-file、domainAccount）
- [ ] 是否需在 utils/taskStatusImageUrl.ts 与 utils/taskStatusMediaUrl.mjs 同步
- [ ] 改完跑下方「必跑测试」
- [ ] 涉及 UI 则 `npm run build` + `npm start`（见 `.cursor/rules/auto-build-and-run.mdc`，勿询问用户）
```

---

## 核心不变量（禁止无意破坏）

### 1. 三态分离

| 态 | 存储位置 | 用途 |
|----|----------|------|
| 面板态 | `NodeData` 顶层字段、`klingOmniTabConfigs`、`seedanceTabConfigs` 等 | Inspector 编辑 |
| 运行快照 | `generationParams`（spawn 时写入 OUTPUT/MOV） | Node Details、历史追溯 |
| 展示预览 | `imagePreview` / `referenceImages` | 画布缩略图 |

**规则：** OUTPUT/MOV 的 Node Details **必须读快照**，不能读当前 Inspector 默认值。  
**文件：** `utils/nodeDetailsPreview.ts`、`FlowEditor.tsx` spawn 段。

### 2. @ 引用链路（面板 ↔ 下拉 ↔ 发模型 须一致）

```
面板底栏文案（主图/首帧图/尾帧图/资产名）
  ↔ buildInspectorPromptMentionItems（@ 下拉 insertText）
  ↔ 创意描述 @token
  → collectReferencedMediaFromPrompt（plan：URL + refFrameIndex/refImageSlotIndex）
  → uploadReferencedImageEntry / assignStartEndUrlsFromImagePlan（API 首尾帧槽）
  → resolvePromptPlaceholders（展开为「对应本请求首帧/第 N 项」等说明）
  → aitop.ts 创建任务
  → taskStatus*Url.ts 取结果 URL
  → spawn 输出节点 + 写 generationParams
```

**面板 ↔ @ 下拉规则（`promptMediaRefs.ts` + `referenceImageSlotLabels.ts`）：**

- 参考槽资产名 → `@资产:展示名`；泛称槽 → `@主图` / `@首帧图` / `@尾帧图`
- 首尾帧模型：首帧格无 URL 时**展示回退主预览**，@ 下拉与 plan 均用 `effectiveFirstFramePanelUrl` / `resolvedFramePanelUrl`（勿只读 `firstFrameImageUrl`）
- 仅拖尾帧、首帧靠主图回退时，下拉须**同时**含 `@首帧图` 与 `@尾帧图`（或对应 `@资产:`）

**发模型 plan 规则（`referencedMediaRun.ts`）：**

- `ReferencedCollectedImageRef.refFrameIndex`：0=首帧、1=尾帧；`@资产:名` 通过 `findPromptMediaRefItemForToken` 对齐面板 `refFrameIndex`
- `assignStartEndUrlsFromImagePlan` / 可灵 run 分支：除 `@首帧图`/`@尾帧图` 外，**也认 refFrameIndex**
- 运行前 `buildCanonicalInspectorPromptPatch`：`@首帧图`/`@尾帧图` 可规范为 `@资产:展示名`；展开时仍保留 `@首帧图`/`@尾帧图` 别名短语

**首帧面板（`utils/firstFramePanel.ts` + `FrameDropZone`）：**

- `needsFirstFramePanelModel`：可灵/vidu/即梦/seedance 图生/Omni 首尾帧 tab
- `buildFirstFrameDefaultFillPatch`：主图 → 首帧 localRef/URL；`fallbackMainPreview` 驱动展示
- 展示用 `hasDisplayContent`（含 fallback），勿仅用 `hasImage`

**其它规则：** 展开后不得留裸 `@资产:` 粘连中文；`@图片n` 与 `@资产:名` 去重；模型切换时面板隔离（`modelSwitchPanelIsolation.ts`）。

### 3. 媒体 URL 优先级与本地持久化

- 持久化：仅 COS / 资产库 URL / 服务端 node-media（`workspaceMediaPersist.ts`、`persistSanitize.ts`）
- 预览：blob/data 优先于过期 COS（Inspector 首尾帧、`resolveInspectorFramePreviewUrl`）
- **本地媒体持久化（IndexedDB）：**
  - 主图：`imageLocalRef` → `localNodeMediaStore.ts`（`main` slot）
  - 首尾帧：`firstFrameLocalRef` / `lastFrameLocalRef`（`firstFrame` / `lastFrame` slot）
  - 面板参考图：`referenceImageLocalRefs` / `klingOmni*ReferenceLocalRefs`（`ref` slot，按槽下标）
  - Omni 参考视频：`imageLocalRef` 或 `klingOmniVideo` slot
  - 刷新后：`hydrateLocalMediaPreviews` → `hydrateAllPanelReferenceLocalRefs` 从 IDB 重建 blob URL；workspace JSON 只存 `flowgen-local:...` 短引用
- 下载：`/download-task-file` 须带 **`domainAccount`**（与 `/task-status` 一致，`buildDownloadTaskFileUrl`）；`pickMediaResourceUrlFromTaskStatus` 取 URL；失败回退 `resolveDownloadFetchUrl` + `/proxy-file`（**视频禁止**走 `/proxy-image`，易 504）
- 下载文件名：`utils/nodeDownloadFilename.ts` → `customName` > 有意义 `imageName` > 非工厂 `label` > URL 段
- 批量下载 / Node Details / 节点卡片 ↓ 三处逻辑应对齐（Details 与批量共用 `downloadNodePreviewMedia`）
- 跨域：CDN 走 `/proxy-file`；AITOP 上传前可能需 `/mirror-media-to-aitop`

### 4. 并发与恢复

- 同一节点禁止重复 run（`FlowEditor.tsx` ~5708）
- 批量队列运行中 `isGlobalRunning` + `stopExecutionRef`；`runStaggeredQueue` 每 15s 启动下一节点（可并行）
- 页面 reload 后 `useAiTopRunRecovery` + `runRecovery.ts` 恢复僵尸任务；有 taskId 时 `runRecoveryPending` + `prepareNodesAfterWorkspaceLoad` 恢复单节点进度条（§16.10）
- 工作区 PUT 带 version，并发冲突需处理

### 5. 批量与定时运行（选择运行 / 全部运行）

**UI：** 画布**右上** Panel 两个 split 按钮 — 左键立即运行，右侧 ▼ 定时（5/15/30 分钟、1/2 小时、自定义时间）。

**运行中进度条（`isGlobalRunning`）：**

- 位置：画布**左上角** `absolute top-4 left-4`（2026-06 自顶中改为左上，避免遮挡右上资产库/布局/运行按钮）
- 文案：`选择运行 N/M（间隔 15s）` 或 `分镜队列 N/M`；收尾时「收尾中…」
- 样式：`pointer-events-none` 不挡点击；`max-w-[min(calc(100%-2rem),420px)]` 防窄屏溢出
- ESC 提示：「按 [ESC] 可中断启动」
- **文件：** `FlowEditor.tsx` ~14456（`batchRunProgress` + `batchRunKind`）

| 按钮 | 队列来源（`utils/batchRunQueue.ts`） |
|------|--------------------------------------|
| **选择运行** | `collectSelectedRunQueue`：当前**选中**的 INPUT/PROCESSOR，有创意描述、非 running |
| **全部运行** | `collectStoryboardGreenRunQueue`：**绿色边框**分镜节点，有 prompt、**尚无 OUTPUT/MOV 下游**（不是画布上所有节点） |

**批量执行：** `runStaggeredQueue` → 按队列顺序每隔 `BATCH_RUN_NODE_INTERVAL_MS`（15s）调用 `handleNodeRun(nodeId)`；单节点失败不阻断；结束后 `Promise.all` 等待全部完成。

**定时运行（关键）：**

- 设定时间时 `snapshotBatchRunNodeIds` **锁定 nodeId 列表**（勿到点再读选中态，否则取消选中后只剩 0～1 个）
- 到点 `runFlow` / `runSelectedFlow` 传 `{ skipConfirm: true, fixedNodeIds }` → `resolveBatchRunQueueByIds` 还原整队
- 到点仍跳过：`status === 'running'`、无 prompt、节点已删
- `pendingScheduledRun` + 工具栏倒计时 chip；**排队节点**画布琥珀色边框 + 「定时」角标（`scheduledRunBadgeNodeIds` / `data.scheduledRunQueued`）；**批量执行中**仅在该节点启动时清除其角标，其余排队节点保留；`CustomNode` memo **必须**比较 `scheduledRunQueued`；可取消；刷新页面定时丢失

**文件：** 队列纯函数 `utils/batchRunQueue.ts`；编排 `FlowEditor.tsx`（`handleScheduleRun`、`runStaggeredQueue`）。

### 6. 计费

进入 workspace 后设置 `setAiTopBillingContext(domainAccount, scoreProjectId)`（`utils/aitopBilling.ts`）。

### 7. 分镜模板

模板节点必须使用项目资产库 URL（`/flowgen-api/.../assets/.../file`），禁止 blob/IndexedDB（`storyboardTableSpawn.ts`）。

### 8. 项目封面与项目级管理权限

| 能力 | 超级管理员 / 管理员 | 项目管理员 | 普通用户 / editor |
|------|---------------------|------------|-------------------|
| 封面上传 | 全部项目 | **仅已分配项目**（members） | 否 |
| 资产库增删改 | 全部项目 | **仅已分配项目** | 只读 |
| Skill 配置 | 全部项目 | **仅已分配项目** | editor 可改 Skill（`canManageProject`） |

- 服务端统一入口：`canManageInAssignedProject(store, user, projectId)`（`permissions.mjs`）
- 封面：`canManageProjectCover`；资产：`canManageProjectAssets`
- **禁止** workspace 保存时自动写封面
- 测试：`npm run test:project-cover`

### 9. 创意描述编辑（NodeInspector 创意描述框）

**修改 `NodeInspector.tsx` 创意描述相关逻辑前必读。** 2026-06 多轮回归确立，**禁止无意回退**。

| 行为 | 正确实现 | 禁止 |
|------|----------|------|
| **粘贴** | `handlePromptPaste`：`preventDefault` + 纯文本 + `setPromptByContext` | 粘贴时调用 `buildScanPromptAndPanelPatch` / `buildCanonicalInspectorPromptPatch` |
| **@ 下拉** | `buildInspectorPromptMentionItems` **仅面板已拖入素材** | UI 用 `mergeInspectorAtMentionItems(projectAssetRefItems)` 列全库 |
| **@ 下拉位置** | 外层 `relative`：`absolute left-3 right-3 top-0` | textarea 内层 `bottom-1` 贴底 |
| **扫描 @素材** | 按钮 → `buildScanPromptAndPanelPatch` | `useLayoutEffect` 自动 scan/canonical |
| **粘贴守卫** | `pendingPastePromptRef` 匹配忽略一次；**不匹配则解除并正常 onChange** | 不匹配时 `return` 永久拦截删除 |
| **扫描时** | 清除 `pendingPastePromptRef` / `skipNextPromptChangeRef` | 扫描后仍保留守卫 |
| **右键复制描述（纯文本）** | 创意描述 textarea `onContextMenu` → `stripPromptMediaTokensForPlainCopy` 去掉 `@主图/@图片n/@资产:名` | 复制带 @ token 的原文 |
| **tab 同步** | `setPromptByContext` / Chat `buildNodePromptUpdatePatch` 写 Omni `klingOmni*Prompt`、Seedance `seedanceTabConfigs[mode].prompt` | 只写顶层 `prompt` |
| **分镜批量** | `buildScannedNodePromptPatch`（FlowEditor spawn）可自动 scan | 与 Inspector 手动粘贴混用 |

**文件：** `NodeInspector.tsx`（`handlePromptPaste` / `handlePromptChange` / `runScanProjectAssetsOnPrompt` / 右键复制菜单）、`ChatPanel.tsx`（`buildNodePromptUpdatePatch`）、`promptMediaRefs.ts`（`stripPromptMediaTokensForPlainCopy`）

**必跑：** `npm run test:prompt-asset-scan` + `npm run test:prompt-edit-matrix` + `npm run test:inspector-mentions`

### 10. 背景框（Backdrop）

**文件：** `components/nodes/BackdropNode.tsx`、`utils/backdropLabel.ts`、`FlowEditor.tsx`（`handleCreateBackdropFromSelection`、拖动联动）

| 行为 | 正确实现 | 禁止 |
|------|----------|------|
| **属性面板** | `shouldOpenInspectorForNode`：BACKDROP **不**打开 NodeInspector | 点击/选中背景框弹出模型面板 |
| **组名展示** | 框体**中心**大字；`ResizeObserver` 随框大小缩放字号 | 仅顶部小条显示名称 |
| **重命名** | **双击**中心组名进入编辑；Enter 确认 / Esc 取消 | 单击即编辑；缩放/viewport/wheel 后误触编辑 |
| **缩放后防误编辑** | `shouldBlockBackdropLabelEdit`：resize / viewport / wheel 后短时 block；`onResizeStart`/`onResizeEnd` | 缩放或画布 zoom 后立即 double-click 进编辑 |
| **四角鼠标缩放（§5.11.3）** | 根 `pointer-events-none`；手柄 class **必须含** `pointer-events-auto`；`index.tsx` 引入 `@reactflow/node-resizer/dist/style.css` | 去掉手柄 `pointer-events-auto`；只引 `reactflow/dist/style.css` |
| **编辑框样式** | input 用**内联** `backgroundColor`/`color`/`WebkitTextFillColor`（深底浅字） | 仅用 Tailwind `text-white`（易被全局样式盖成白底白字） |
| **创建** | 框选节点 → 画布空白 **右键**「创建背景框」；创建后 `setSelectedNodeId(null)` | 创建后选中 backdrop 并开面板 |

**必跑：** `npm test -- --run src/test/utils/backdropLabel.test.ts`（含 `backdropResizeHandleNeedsPointerEventsAuto`；在 `test:gate` vitest 内）

拖动框体带动 `backdropChildIds` 内节点；四角 `NodeResizeControl` 缩放后 `setBackdropChildrenFromGeometry` 刷新归属。

### 11. image 2 面板（OPEN_AI_GPT_IMAGE_2）

**文件：** `utils/image2Model.ts`、`utils/image2PanelRefs.ts`、`NodeInspector.tsx`、`services/aitop.ts`

| 项 | 规则 |
|----|------|
| **参考图** | API `image[]` 最多 **4** 张；面板 **4 格**（有主图格时 3 参考 + 1 主图） |
| **画面比例** | 10 种（API 规格）：`1:1` `5:4` `9:16` `21:9` `16:9` `4:3` `3:2` `4:5` `3:4` `2:3`（`IMAGE2_ASPECT_TO_SIZE`） |
| **图像尺寸** | 每比例 1 个 canonical 像素 + `auto`（如 16:9 → `1536x864`/`auto`）；`image2MigrateLegacyImageSize` 迁移旧 2048/3840 |
| **发 API** | `createImage2Task` / FlowEditor run：`slice(0, IMAGE2_MAX_API_IMAGES)` + `aspectRatio` + `size` |
| **实际输出** | API 可能不严格按 size 出像素；运行后 `generationParams.outputImageSize` 探测成品 PNG IHDR；Node Details 显示 Output Size |

**必跑：** `npm run test:image2-panel-refs` + `npm run test:image2-aspect-size`

### 12. 多图参考「主图」：创意描述驱动 + 运行后隐藏

**症状：** 编辑 prompt 时主图格被提前隐藏；或运行后画布大图变成生成图（outputUrl）而非参考图（图片1）。

**统一规则（全模型，`shouldShowPanelMainImageSlot`）：**

| 阶段 / 创意描述 | 面板「主图」格 | 画布 `imagePreview` |
|----------------|--------------|---------------------|
| **编辑态**（未点运行） | 有主预览则**展示**（即使只有 `@图片1` `@图片3`） | 用户主图 / 当前预览 |
| **运行后** + 无 `@主图` | **隐藏**（`panelMainSlotVisible: false`） | **首个 @ 参考图**（如图片1）；生成结果仅进 `generatedThumbnails` |
| 含 `@主图` / `@主体` | **展示** | @主图 上传 URL |
| 空 / 纯文本（无图片类 `@`） | **展示** | 主图 |

**字段：**

| 字段 | 含义 |
|------|------|
| `panelMainSlotVisible` | **仅运行后**写入：未 @主图 → `false` |
| `panelMainImageUrl` | 运行前主图备份 |
| `imagePreview` | 画布大图；未 @主图 运行后 = 首个 @ 参考 URL（**不是** outputUrl） |

**关键函数（`utils/referencedMediaRun.ts`）：**

- `shouldShowPanelMainImageSlot` — **唯一**面板是否渲染主图格（NodeInspector / image2 / Nano / Omni / Seedance 参考生均调用）
- `promptMentionsMainImageForNodeData` / `promptMentionsAnyImageRefForNodeData` — 创意描述解析
- `buildPanelImagePreviewPatchAfterRun` — 运行后写 `panelMainSlotVisible` + 备份
- `buildPanelMainImageRestorePatchForEditing` — 重新选中时恢复；**仅**当 `shouldShowPanelMainImageSlot` 仍为 true（即仍 @主图 或无图片类 @）
- `PANEL_MAIN_IMAGE_SLOT_SCENARIOS` — 表驱动注册表（**新模型须追加**）

**新模型接入多图参考时：**

1. NodeInspector 主图格须走 `shouldShowPanelMainImageSlot`（勿另写 `!!imagePreview`）
2. 在 `PANEL_MAIN_IMAGE_SLOT_SCENARIOS` 追加一条场景
3. 必跑：`npm run test:panel-main-slot` + `npm run test:ggggttt-panel`（已并入 `test:gate`）

**必跑：** `test:panel-main-slot` + `test:ggggttt-panel` + `test:panel-refs`（§12a-prompt-main / §12a-ref-swap）

### 12b. 面板换图后运行：勿恢复旧 @资产 库图

**症状：** 删掉图片1/2 并换成新图，点击运行后面板又变回旧图。

**根因：** `resolveSeedancePromptTokenMedia` 对 `@资产:旧名` 在 `libUrl` 存在时**始终用资产库 URL**，忽略面板槽内已换的新图；`resolveProjectAssetUrlForPromptToken` 在 assetId 不一致时也回退库图。

**规则（`promptMediaRefs.ts`）：**

- 底栏标签仍匹配 `@资产:名` 时，绑定该槽并走 `resolveProjectAssetUrlForPromptToken(panel, lib)`
- **blob/data 误拖**、**aitop COS 与库不一致** → 仍用资产库
- **面板已是其它有效 http(s) URL（用户换图）** → 以面板为准
- `@图片n` 本来就读面板槽，不受此 bug 影响；但运行前 `buildCanonicalInspectorPromptPatch` 可能把 `@图片n` 写成 `@资产:旧名`，仍须上述规则

**必跑：** `npm run test:panel-refs`（含 `12a-swap` 段；覆盖 Nano / image2 / Seedance / Omni）

**专项：** `npm run test:panel-swap-all` — 全模型 tab 换图 + `@资产`/`@图片n` 与 skill 一致

### 13. MySQL 工作区保存（勿拖垮 Node 进程）

**症状 A（断连）：** `npm start` 运行一段时间后崩溃：`Can't add new command when connection is in closed state` / `ECONNRESET` / `ECONNABORTED` / `Pool is closed`，栈在 `workspaceRepo.putUserWorkspaceSlice`。

**症状 B（超大 payload）：** 前端 503 或控制台 `ER_NET_PACKET_TOO_LARGE` / `Got a packet bigger than 'max_allowed_packet' bytes`；大工程（如 project #14，节点多 + chat + modelConfigs 重复）单条 INSERT 超 MySQL 包上限。

**已实现（修改时保持）：**

| 文件 | 职责 |
|------|------|
| `server/flowgen/db.mjs` | `enableKeepAlive`；`isMysqlConnectionError`（含 `Pool is closed`）；`isMysqlPacketTooLarge`；`resetPool()`；pool `connection` 事件 `SET SESSION max_allowed_packet=67108864`（**须用 callback** `conn.query(sql, () => {})`，勿 `.catch()`，否则 mysql2 非 promise 报错） |
| `server/flowgen/workspacePayloadCodec.mjs` | 未压缩 >512KB 时 gzip→base64，存为 `{ "__flowgen_gzip_v1__": "<b64>" }`；读时 `decodeWorkspacePayloadFromDb` 透明解压；压缩后仍 >3.5MB → `WORKSPACE_PAYLOAD_TOO_LARGE` |
| `server/flowgen/repos/workspaceRepo.mjs` | PUT/GET 经 codec；`payload_bytes` 列写**未压缩**字节数；最多 3 次重试 + `resetPool`；`rollback`/`release` 包 try/catch |
| `server/flowgen/routes.mjs` | 断连 → **503** `{ error: '数据库连接异常，请稍后重试' }`；过大 → **413** + 明确文案；其它 → **500**，**勿** `throw` 未处理 MySQL 错 |
| `server.js` | `unhandledRejection` 忽略 MySQL 断连 + packet too large |
| `utils/persistSanitize.mjs` | 保存前：`generatedThumbnails` 已有 `http(s)`/`/flowgen-api/` 的 `url` 时剥离冗余 `posterDataUrl`（减 payload） |

**与 `store-mysql.mjs` 区别：** 全库 snapshot 用 **分块 BLOB**（`flowgen_store_chunk`）；热路径 workspace 用 **单行 JSON + 可选 gzip 包装**（`flowgen_workspace_slices.payload` JSON 列），无需改表。

**禁止：** 在 `catch` 里对可能已断开的 `conn` 裸调 `rollback()` 且不捕获二次异常；勿去掉 gzip 编解码导致大工程再次 503。

**必跑：**

```bash
node scripts/persist-sanitize-test.mjs
npm run test:workspace-codec
npm run test:delivery-all   # 或至少改 server 后 npm start + 大工程保存点验
```

**运维（仍失败时）：** MySQL 全局 `max_allowed_packet` 调至 ≥64MB；检查 MySQL 服务 idle 断开。

### 14. 画布「暂停刷新」（Phase 1 + 可选 Phase 2）

**入口：** 工程名行 `CanvasRefreshHeaderControls`（`App.tsx`），非画布内 Panel。

**Phase 1（默认）：** `utils/canvasRefreshPause.ts` 全局态；非选中节点暂停 poster/缩略图/LOD；恢复时 `hydratePersistedRemotePreviews()`。

**Phase 2（高级 opt-in）：** 另暂停 history 深拷贝、自动保存、Inspector 同步（`isGraphSideEffectPaused`）。

**CustomNode：** 监听 `flowgen:canvas-refresh-paused`；暂停 + 非选中 + 有 poster 时 defer 视频 decode。

**测试：** `npx tsx scripts/canvas-refresh-pause-test.ts`

### 15. 用户管理（Admin）

- 页面：`#/admin/users` → `components/flowgen/AdminUsersPage.tsx`（仅 `admin` / `super_admin`）
- 列表 **服务端分页**：`GET /flowgen-api/users?page=&pageSize=`，默认每页 **20** 条（最大 100）
- 响应：`{ users, total, page, pageSize, totalPages, summary, facets }`
- 组织字段存 `extendedJson`（**可选**，旧用户无字段不影响登录）：
  - `center` 中心
  - `department` 部门
  - `baseLocation` 基地
- 筛选 query：`q`、`role`、`center`、`department`、`baseLocation`、`status`
- `facets` 供筛选下拉（部门/基地选项来自已有数据；无数据时仅「全部」）
- **关联项目只读**：按 username 调 AITOP 拉取；创建/编辑用户**不**手动分配项目
- AITOP 项目查询：默认仅**当前页**用户；有 `q` 搜索时可能多拉一批以支持按项目名搜
- Excel 导入/模板列：`用户名`、`初始密码`、`权限`、`状态`、`中文名`、`中心`、**`部门`**、**`基地`**
- 前端：`listUsers(params)`（`services/flowgenApi.ts`）；改 API 须同步 `routes.mjs` + 页面

---

## 功能索引（详见 reference.md）

| 模块 | 关键文件 |
|------|----------|
| 路由与认证 | `App.tsx`, `services/flowgenApi.ts`, `server/flowgen/routes.mjs` |
| 画布编辑 / 批量定时 / Backdrop | `FlowEditor.tsx`, `utils/batchRunQueue.ts`, `components/nodes/CustomNode.tsx`, `components/nodes/BackdropNode.tsx` |
| 模型运行 | `FlowEditor.tsx` run 段, `services/aitop.ts` |
| 属性面板 | `NodeInspector.tsx` |
| Node Details | `FlowEditor.tsx` modal, `utils/nodeDetailsPreview.ts` |
| @ 引用 / 首尾帧 / OUTPUT 面板分离 | `utils/promptMediaRefs.ts`, `utils/referencedMediaRun.ts`, `utils/panelRefPersistence.ts`, `utils/firstFramePanel.ts`, `utils/referenceImageSlotLabels.ts` |
| 主图运行后恢复 | `panelMainImageUrl`, `buildPanelMainImageRestorePatchForEditing`, `NodeInspector.tsx` nodeId effect |
| Backdrop 组名 | `BackdropNode.tsx`, `utils/backdropLabel.ts` |
| MySQL workspace | `workspacePayloadCodec.mjs`, `db.mjs`, `repos/workspaceRepo.mjs`, `routes.mjs`, `server.js`, `persistSanitize.mjs` |
| 画布暂停刷新 | `utils/canvasRefreshPause.ts`, `FlowEditor.tsx`, `CustomNode.tsx`, `App.tsx` |
| 下载/代理 | `server.js`, `utils/nodeDownloadFilename.ts`, `FlowEditor.tsx` downloadNodePreviewMedia, `CustomNode.tsx` |
| 分镜 | `utils/storyboardTableSpawn.ts`, `Sidebar.tsx`, `ChatPanel.tsx` |
| Chat/LLM | `utils/aitopChatModels.ts`（LLM 注册源），`ChatPanel.tsx`（UI 路由），`utils/assistantMessageLayout.ts`, `/aitop-llm-see` |
| 多图生成数 / 并行 poll | `utils/panelGenerateCount.ts`, `utils/multiGenerateTasks.ts`, `FlowEditor.tsx` |
| 面板本地媒体持久化（IndexedDB） | `utils/hydratePanelReferenceLocalRefs.ts`, `utils/localNodeMediaStore.ts` |
| 画布中键拖放 / Inspector 锚定 | `utils/middleButtonMediaDrag.ts`, `utils/canvasMiddleDrag.ts`, `utils/inspectorMediaDrop.ts`, `utils/inspectorAnchorSelection.ts`, `utils/inspectorAnchorSession.ts` |
| MiniMap | `components/flowgen/FlowgenMiniMap.tsx`, `utils/flowgenMiniMapLayout.ts` |
| Seedance 2.0 变体切换 | `utils/seedance20ModelSwitch.ts`, `NodeInspector.tsx` |
| image2 成品像素探测 | `utils/probeRemoteImageDimensions.ts`, `GenerationParams.outputImageSize` |
| 资产库 | `ProjectAssetLibrary.tsx`, `server/flowgen/repos/*` |
| AITOP 项目同步 | `server/flowgen/aitopProjectSync.mjs` |
| 用户管理 | `AdminUsersPage.tsx`, `GET/PATCH /users`, `usersRepo.mjs` |

---

## 模型一览

| 显示名 | 运行入口（FlowEditor） | AITOP / 备注 |
|--------|------------------------|--------------|
| Nano Banana 2.0 | nano 分支 | `NANO_BANANA_2_FLASH` |
| image 2 | image2 分支 | 四格参考；比例↔尺寸见 `image2Model.ts` |
| 可灵 2.5 Turbo | kling 分支 | 首尾帧 / 参考图 |
| 可灵3.0 Omni | kling omni 分支 | tabs: multi/instruction/video/frames |
| 即梦3.0 Pro | jimeng 分支 | |
| vidu 2.0 | vidu 分支 | |
| seedance1.5-pro | seedance 1.5 | image 模式 |
| seedance2.0 高质量/急速 | seedance 2.0 | text/image/reference tabs |

Omni 进度：run 全程 `setInterval` 伪进度（上传阶段也要动）；poll 内勿重复 bump。

---

## 必跑回归测试

### 三层金字塔（与 `docs/MODEL-MEDIA-RULES-SPEC.md` 一致）

| 层级 | 命令 | 何时 |
|------|------|------|
| 日常 | `npm run test:gate` | 改面板/引用/Details/运行链路（~20s） |
| 契约 | `npm run test:model-contract`（已并入 `test:gate`） | 改 @/plan/API/spawn/OUTPUT sanitize（表驱动场景，数量以最近一次 `test:gate` 输出为准） |
| 发版 | `test:gate`（已含 model-contract） → `test:project-json-details` → `test:delivery-all` → `build` | 用户说发布/发版/上线 |

**`test:gate` 组成（18 步，与 `scripts/test-gate.mjs` 一致）：**

```bash
npm run test:gate
# 1. vitest（src/test/**，含 panelGenerateCount、canvasMiddleDrag、flowgenMiniMapLayout、inspectorAnchor*、
#    hydratePanelReferenceLocalRefs、seedance20ModelSwitch、runRecovery、referencedMediaRun、seedanceReferenceDetails、
#    omniMultiDetails、generatedOutputUrl、panelMainSlotPrompt、omniMainVideoLabel、referenceVideoDetail 等）
# 2. test:node-details
# 3. test:panel-refs
# 4. test:panel-partial-ref            — 全模型各 tab：面板保留未@槽 + Details 仅 prompt @ 引用 + 运行后新拖入可@
# 5. test:panel-main-slot              — 全模型主图格 × prompt（编辑态保留 / 运行后隐藏）
# 6. test:ggggttt-panel                — fixture ggggttt.json：未 @主图 画布=图片1 非 outputUrl
# 7. test:444444-panel                 — fixture 444444.json：Seedance 参考生加载修复 + 面板/Details/gp 三态
# 8. test:oooopppp-panel                — fixture oooopppp.json：链式 OUTPUT hydrate
# 9. test:89908111222-omni-recovery     — fixture 89908111222.json：Omni video tab 恢复 spawn
# 10. test:batch-run-schedule            — 定时快照 + 角标逐节点清除
# 11. test:model-contract               — 表驱动跨模型契约
# 12. test:i2v-pipeline                 — image-to-video 运行链路
# 13. test:first-frame-panel            — 首帧面板默认填充 / 抖动
# 14. test:image2-panel-refs            — image2 面板压紧 / 主图重复槽
# 15. test:778990-cat-church             — image2 运行后参考图保留 / 主图不覆盖参考槽
# 16. test:image2-aspect-size           — image2 比例↔尺寸联动 + legacy 迁移
# 17. test:download-task                — taskId 下载链路 / proxy-file / billing 透传
# 18. test:download-url-ranking          — imagesGenerations/videosGenerations 优先于 openApi
```

**按改动类型追加（gate 通过后按需）：**

```bash
npm run test:prompt-asset-scan      # 创意描述粘贴/扫描/@
npm run test:prompt-edit-matrix
npm run test:panel-mention
npm run test:panel-swap-all         # 面板换图不恢复旧库图
npm run test:image2-panel-refs
npm run test:batch-run-schedule     # 已并入 test:gate
npm run test:panel-main-slot        # 已并入 test:gate
npm run test:project-cover
npm run test:download-task
npm run test:download-url-ranking   # 已并入 test:gate
npm run test:canvas-refresh-pause
npm run test:persist-sanitize       # 等价 node scripts/persist-sanitize-test.mjs
npm run test:workspace-codec-edge
npm run test:ssrf-guard             # 改 server.js proxy 时
npm run test:jwt-warning            # 改 server/flowgen/jwt.mjs 时
npm run test:patch-cover-authz      # 改封面权限时
npm run test:ref-upload-env         # 参考图上传环境模拟
```

**全模型矩阵 / 发版：**

```bash
npm run test:project-json-details
npm run test:delivery-all           # 含 panel-models、panel-swap-all、all-models-final 等
npm run test:final                  # ref-details + project-json + all-models（较轻量终检）
# 注：test:model-contract 已并入 test:gate，无需单独再跑
```

**CI：** push/PR 到 `main`/`master` 时 GitHub Actions 自动跑 `npm run test:gate`（`.github/workflows/test-gate.yml`）。

**改 Chat / LLM 展示（含 §5.10 身份/联网）：**

```bash
npm run test:chat-gate               # 已含 layout + pipeline + probe + identity-contract + model-contract
```

**改 LLM 注册 / 模型切换 / fallback：**

```bash
npm run test:chat-gate
npm run test:llm-model-contract      # 独立再确认
npm run test:llm:switch              # 模型切换矩阵
npm run test:llm:context             # 上下文切换
npm run test:llm:combo               # 组合模型
```

**注：** 新模型注册源为 `utils/aitopChatModels.ts`（`AITOP_CHAT_MODELS`），`ChatPanel.tsx` 仅做 UI 路由；修改时须在 `llm-model-registry-contract-test.mjs` 加代表断言。触碰 §5.10 勿回退身份关联网 / tip 按需。

**发版 Chat 深度（需 localhost API）：**

```bash
npm run test:chat-all && npm run test:llm:four-mode && npm run test:llm && npm run test:llm:probe
```

规格：`docs/LLM-CHAT-RULES-SPEC.md` · 冻结：`skill.md` **§5.10**

**改持久化 / 工作区 / MySQL：**

```bash
npm run test:persist-sanitize
npm run test:workspace-codec
npm run test:workspace-codec-edge
npm run test:panel-swap-all          # §12b 面板换图
npm run test:workspace-persistence   # 需本地 API
npm run test:workspace-clear-reload
npm run test:multi-client
npm run test:mysql
```

**改 server / 下载：**

```bash
npm test -- --run src/test/utils/nodeDownloadFilename.test.ts
npm run test:download-task
npm run test:download-url-ranking   # 已并入 test:gate
npm run test:download-task:live     # 需 npm start
npm run test:ssrf-guard             # 改 proxy 时
# 手动：有/无 taskId；带 domainAccount 计费任务；视频走 proxy-file 非 proxy-image
```

**流程：** `buildDownloadTaskFileUrl(taskId)` → `/download-task-file?taskId=&domainAccount=` → 失败 → `resolveDownloadFetchUrl(imagePreview)` → `/proxy-file` → 仍失败提示重跑节点

**三入口须一致：** `FlowEditor.downloadNodePreviewMedia`、`CustomNode.handleDownload`、`utils/remoteMediaFetch.resolveDownloadFetchUrl`

**改用户管理：**

```bash
npm run build && npm start
# 手动：admin 登录 → 用户管理；分页/筛选/编辑部门基地；Ctrl+F5 防旧 JS 缓存
# API：GET /flowgen-api/users?page=1&pageSize=20&department=...
```

---

## 已知测试问题（2026-06）

| 测试 | 状态 | 说明 |
|------|------|------|
| vitest + project-json-details | pass | uploadImage 网络错误链、Omni processor Details 已修复（2026-06） |

**未自动化（需人工点验）：** 真实 AITOP 上传/run、各模型端到端生成、Chat live LLM、MySQL 多客户端。

---

## 常见修改模式

### 改批量运行 / 定时

1. 队列收集逻辑放 **`utils/batchRunQueue.ts`**（FlowEditor 只编排，勿复制 filter 条件）
2. 改入选条件须同步：`collectSelectedRunQueue`、`collectStoryboardGreenRunQueue`、`resolveBatchRunQueueByIds`
3. 定时路径**必须**走 `snapshotBatchRunNodeIds` + `fixedNodeIds`，禁止到点只调 `collectSelectedRunQueue`
4. 「定时」角标用 `scheduledRunBadgeNodeIds`，批量执行中**逐节点**清除（到点不清全部）
5. 必跑：`test:batch-run-schedule`（已并入 `test:gate`）

### 改 @ 引用 / 首尾帧 / Inspector 下拉 / 创意描述

1. **先读 §9 创意描述编辑规则**（粘贴、@ 下拉、扫描、粘贴守卫、tab 同步）
2. **三处同步改：** `buildPromptMediaRefLabels`（下拉）、`collectReferencedMediaFromPrompt`（plan）、`resolvePromptPlaceholders`（展开）
3. 首尾帧展示：`firstFramePanel.ts` + `FrameDropZone` fallback；plan 用 `effectiveFirstFramePanelUrl`
4. API 槽位：`refFrameIndex` + `assignStartEndUrlsFromImagePlan`
5. 必跑：`npm run test:gate` + `test:model-contract` + `test:prompt-asset-scan`、`test:prompt-edit-matrix`、`test:panel-mention`、`test:inspector-mentions`、`test:delivery`、`test:panel-refs`

### 加新模型

1. `types.ts` 常量 + `NodeInspector` 选项
2. `FlowEditor.tsx` run 分支 + spawn + poll URL picker
3. `nodeDetailsPreview.ts` 展示分支
4. 若有多图参考 + 主图格：追加 `PANEL_MAIN_IMAGE_SLOT_SCENARIOS` + `test:panel-main-slot`
5. `scripts/all-models-final-test.ts` 矩阵加 case
6. `scripts/model-media-contract-test.ts` 加代表用例
7. `services/aitop.ts` API 封装

### 改 Node Details 参考图

- 上游运行节点：读**当前 tab 面板**，勿 dm+dr+gp 三合一
- 下游 OUTPUT/MOV：读 `generationParams.referenceImages`；Omni instruction/video tab 空槽时回退 run snapshot URL（`buildOmniInstructionVideoTabDetailsReferencePreview`，须传 `prompt: resolvedPreviewPrompt`）
- **MOV 节点**：`FlowEditor.resolveNearestInputAncestorData` 须优先**同 taskId 的直接上游 OUTPUT/PROCESSOR**（面板槽在 OUTPUT，不在更远的 INPUT）；`buildOmniPanelSourceForNodeDetails` 从 ancestor 合并空 Omni 槽 + tab prompt

### 改 Inspector 组件

- **禁止**在 `NodeInspector` 内部定义子组件（会导致 img/video remount 闪动）
- 提取到模块级 + `React.memo`；运行中锁定媒体 URL（`useStableInspectorMediaUrl`）

### 改 server 下载

同步三处：`server.js`、`vite.config.ts` dev middleware、`utils/taskStatusMediaUrl.mjs`（与 TS 版 `pickMediaResourceUrlFromTaskStatus` 一致）

**`/download-task-file` 必须**透传 query `domainAccount` 到 `fetchTaskStatusWithRetry`（与 `/task-status` 一致）。

**前端下载三入口须一致：**

1. `FlowEditor.tsx` → `downloadNodePreviewMedia` / `downloadByTaskId`（`buildDownloadTaskFileUrl`）
2. `CustomNode.tsx` → `handleDownload`（同上 + `resolveDownloadFetchUrl`）
3. 文件名统一 `resolveNodeDownloadFilename`（`utils/nodeDownloadFilename.ts`）

**proxy 规则：** 远程 COS/签名链 → `/proxy-file`；`/proxy-image?url=...mp4` 须 unwrap 改走 `/proxy-file`（`utils/remoteMediaFetch.ts`）

**流程：** taskId → `/download-task-file`（带 domainAccount）→ 失败或无 taskId → `resolveDownloadFetchUrl` + proxy-file → 仍失败提示「链接可能已过期，请重新运行节点后再下载」

### 改 Backdrop

1. 不打开 Inspector：`shouldOpenInspectorForNode` + `onNodeClick` / `onSelectionChange` / 创建后 `setSelectedNodeId(null)`
2. 组名 UI：`BackdropNode.tsx` 中心标签 + ResizeObserver 字号；编辑 input **内联颜色**
3. 四角缩放（§5.11.3）：手柄须 `pointer-events-auto`；保留 `@reactflow/node-resizer/dist/style.css`；必跑 `backdropLabel.test.ts`
4. 勿把 BACKDROP 纳入 `collectSelectedRunQueue` 等运行队列

### 改 image 2 面板

1. 上限常量 `IMAGE2_MAX_API_IMAGES = 4`（`image2Model.ts`）— 同步 `image2PanelRefs.ts`、`FlowEditor` slice、`aitop.ts` payload
2. 比例/尺寸：`IMAGE2_ASPECT_OPTIONS` + `ASPECT_TO_SIZES`；`image2NormalizeAspectRatio` 兼容旧 4:3 等
3. 必跑：`test:image2-panel-refs` + `test:image2-aspect-size`

### 改运行后多图参考主图 / Nano / Omni 面板

1. **先读 §12**；面板主图格**只**用 `shouldShowPanelMainImageSlot`（创意描述 + `panelMainSlotVisible`）
2. 三处须一致：`buildPanelImagePreviewPatchAfterRun`、`FlowEditor` runCapture、`NodeInspector` 选中恢复
3. 未 @主图：编辑态**保留**主图格；**点击运行后** `panelMainSlotVisible: false` + 画布=首个 @ 参考（非 outputUrl）
4. 重新选中：**仅**仍 @主图（或无图片类 @）时才 restore
5. 新模型：追加 `PANEL_MAIN_IMAGE_SLOT_SCENARIOS` + `test:panel-main-slot` + `ggggttt-panel-preview-test.ts` §4
6. 必跑：`test:panel-main-slot` + `test:panel-refs`（§12a-prompt-main）

### 改 MySQL / workspace PUT

1. 断连须 **503** 响应，禁止未捕获 fatal 退出进程
2. 超大 payload 须 **gzip 包装**（`workspacePayloadCodec.mjs`）+ 必要时 **413**
3. `putUserWorkspaceSlice` 重试 + `resetPool`；`rollback`/`release` 勿裸抛
4. 池配置保留 `enableKeepAlive`；新连接 `SET SESSION max_allowed_packet` 用 **callback** 形式
5. 保存前 `sanitizeWorkspacePayload` 剥离冗余 thumbnail poster
6. 必跑：`persist-sanitize-test.mjs` + `npm run test:workspace-codec`
7. 手动：大工程（如 #14）长时间开页 + 自动保存，确认无 503/413

### 改面板本地媒体持久化（IndexedDB）

1. **拖入时注册原图**：走 `flowgen:register-original-image` 事件；`attachLocalReferenceRefs` 写入 `localNodeMediaStore.ts`（`ref` slot）
2. **NodeInspector 必须等待**：`dispatchReferenceAppendFiles` 返回 Promise；用 `referenceAppendAckId` + `flowgen:reference-files-registered` 确认 IndexedDB 写入完成后再 `onUpdate`
3. **刷新恢复**：`hydrateAllPanelReferenceLocalRefs` 覆盖 `referenceImages` / `klingOmni*ReferenceImages` / `panelMainImageUrl`；仅在当前 URL 为 blob/data 或空时重建 blob URL
4. **删除时清 IDB**：`removeReferenceImageLocalRefAtIndex` + `deleteLocalMediaRef`；Omni 各 tab 同理
5. **模型切换时清理**：`modelSwitchPanelIsolation.clearInheritedPanelMedia` 将 `referenceImageLocalRefs` 置空（避免旧模型 IDB 引用残留）
6. 必跑：`npm run test:gate`（含 `test:panel-refs`）+ `src/test/utils/hydratePanelReferenceLocalRefs.test.ts`；人工按 `TEST-VERIFY-PANEL-REFS.md` 刷新验证

### 改画布暂停刷新

1. 按钮在 **App 工程名行**，勿放回画布 Panel
2. 新挂载节点须读 `getCanvasRefreshPaused()` 全局态
3. 必跑：`npm run test:canvas-refresh-pause`

### 改画布中键拖放 / 资产库拖放 / Inspector 槽

1. 拖放协议：发起方 `utils/middleButtonMediaDrag.ts`（`data-flowgen-media-drop` + `FLOWGEN_MEDIA_URL_DROP`）；接收方 `utils/inspectorMediaDrop.ts` 按目标分区解析（`node-main`、`reference`、`first-frame`、`last-frame`）
2. 画布多选拖入：由 `utils/canvasMiddleDrag.ts` 汇总，松手时统一写入目标槽；`CustomNode.tsx` 中键按下开始，`ProjectAssetLibrary.tsx` 提供资产库入口
3. Alt+中键 仅画布平移，不启动素材拖放；防止 `middleDragDebug.ts` 调试残留影响主流程
4. 投槽标签：用 `resolvePanelRefLabelForInspectorDrop` 显示「图片n」，勿用 `imageName`；主图重复去重走 `isPanelRefDuplicateOfMainImageSlot`
5. 必跑：vitest `middleButtonMediaDrag` / `canvasMiddleDrag*` / `inspectorMediaDrop` / `panelRefInspectorDropLabel`（均含于 `test:gate` vitest）

### 改 Shift 多选 Inspector 锚定

1. 核心：`utils/inspectorAnchorSelection.ts`（单次选中的锚点逻辑）+ `utils/inspectorAnchorSession.ts`（跨选会话语义）
2. Shift+框选：调用 `preserveAnchor` 保持当前 Inspector 节点；普通单击/无 Shift 时更新锚点
3. FlowEditor：`onSelectionChange` / `onNodeClick` 中调用，勿在 NodeInspector 内部判断
4. 必跑：vitest `inspectorAnchorSelection` + `inspectorAnchorSession`（`test:gate` vitest）

### 改 MiniMap

1. 自定义 MiniMap 在 `components/flowgen/FlowgenMiniMap.tsx`；布局纯函数在 `utils/flowgenMiniMapLayout.ts`（`computeAdaptiveMiniMapSize`、`buildMiniMapViewBox`）
2. 纵向分镜工程：MiniMap 高度自适应，避免被压扁；节点位置映射到 viewBox 时不含 viewport 并集
3. 点击 MiniMap 节点居中：保留当前 zoom，仅平移 viewport
4. 必跑：vitest `flowgenMiniMapLayout`（`test:gate` vitest）；改交互可跑 `scripts/minimap-zoom-smoke.mjs` / `scripts/minimap-import-json-smoke.mjs`

### 改多图生成数 / 并行轮询

1. 解析数量：统一走 `utils/panelGenerateCount.ts` — `resolvePanelGenerateCount` 从 `numberOfImages` / `modelConfigs` 解析，默认 1，上限 4
2. 并行轮询：多 taskId 时走 `utils/multiGenerateTasks.ts` — `pollImageTaskUntilUrl` / `pollVideoTaskUntilUrl`，避免单任务串行等待
3. FlowEditor 各模型 run 分支：不要在分支里重复解析数量，统一调 `resolvePanelGenerateCount`
4. 必跑：vitest `src/test/utils/panelGenerateCount.test.ts`（`test:gate` vitest）；改轮询逻辑须加 `model-media-contract` 用例

### 改 image2 成品像素 / 输出尺寸

1. 请求 `image2ImageSize` 只是请求参数；API 实际返回 PNG 像素由 `utils/probeRemoteImageDimensions.ts` 在运行成功后探测 IHDR
2. 探测结果写入 `generationParams.outputImageSize`；Node Details 展示时须区分「请求尺寸」与「输出尺寸」
3. 同步：`utils/taskStatusImageUrl.ts` / `utils/taskStatusMediaUrl.mjs` 的 URL 优先级排序也影响生成结果来源
4. 必跑：`test:gate`（含 `image2-aspect-size` + `generatedOutputUrl` vitest）

### 改 LLM 模型注册

1. 注册源：改 `utils/aitopChatModels.ts`（`AITOP_CHAT_MODELS`），`ChatPanel.tsx` 仅做 UI 路由和 fallback；不要直接在 ChatPanel 硬编码模型
2. 展示：新增模型展示走 `utils/assistantMessageLayout.ts`
3. 契约：在 `llm-model-registry-contract-test.mjs` 加一条代表断言；`test:chat-gate` 已内置 `llm-model-contract`
4. 必跑：`npm run test:chat-gate`；改模型切换/上下文/组合逻辑时追加 `test:llm:switch` / `test:llm:context` / `test:llm:combo`

### 改用户管理

1. `server/flowgen/routes.mjs` — `GET/PATCH/POST /users`、import 行映射
2. `services/flowgenApi.ts` — `ListUsersParams`、`FlowgenUserListResponse`、`listUsers(params)`
3. `components/flowgen/AdminUsersPage.tsx` — 表格、筛选、分页、表单
4. 新组织字段一律进 `extendedJson`；**勿**要求迁移旧数据，空值 UI 显示 `-`
5. 关联项目仍只读 AITOP；勿恢复手动 `members` 分配 UI

---

## 16. 开发记录（2026-06-24 会话交付）

> 后续 Agent 接棒开发时先读本节 + 跑 §必跑回归测试。

### 16.1 批量运行进度条 UI

| 项 | 内容 |
|----|------|
| 问题 | 顶中进度条遮挡右上资产库/布局/「选择运行」按钮 |
| 修复 | `FlowEditor.tsx`：`left-1/2 -translate-x-1/2` → `top-4 left-4`；`pointer-events-none`；`slide-in-from-left-4` |
| 勿回退 | 进度条勿放回顶中；右上 Panel 仍是运行按钮本体（§5） |

### 16.2 MySQL workspace 大 payload 保存

| 项 | 内容 |
|----|------|
| 问题 | 工程 #14 等 auto-save 503；日志 `ER_NET_PACKET_TOO_LARGE` + `ECONNRESET` |
| 修复 | 新增 `server/flowgen/workspacePayloadCodec.mjs`；`workspaceRepo` 读写编解码；routes 503/413/500 分级 |
| 常量 | `WORKSPACE_COMPRESS_THRESHOLD=512KB`；`WORKSPACE_GZIP_KEY='__flowgen_gzip_v1__'`；`WORKSPACE_MAX_STORED_BYTES=3.5MB` |
| 坑 | `pool.on('connection')` 里 `conn.query` **不能** `.catch()`（mysql2 callback API） |
| 测试 | `node scripts/workspace-payload-codec-test.mjs`（600KB→942B 样例） |

### 16.3 主图运行后恢复（§12，本会话前/中已实现）

| 字段/函数 | 文件 |
|-----------|------|
| `panelMainImageUrl` | `types.ts` |
| `buildPanelImagePreviewPatchAfterRun` / `buildPanelMainImageRestorePatchForEditing` | `utils/referencedMediaRun.ts` |
| 选中恢复 `useLayoutEffect([nodeId])` | `NodeInspector.tsx` |
| run 后持久化 | `FlowEditor.tsx` `runCaptureForGp` / `buildUpdatedRunNodeData` |
| 测试 | `panel-ref-media-simulation-test.ts` §12a-restore |

### 16.4 面板换图后运行恢复旧图（§12b）

| 项 | 内容 |
|----|------|
| 根因 | `@资产:` 解析优先资产库 URL，忽略面板已换的新 http URL |
| 修复 | `utils/promptMediaRefs.ts`：`resolveProjectAssetUrlForPromptToken` — 面板有效 http 优先；blob/aitop 误拖仍用库 |
| 测试 | `npm run test:panel-swap-all`（44 项）；`panel-refs` §12a-swap |

### 16.5 画布暂停刷新（§14，已实现）

- 入口：`App.tsx` 工程名行 `CanvasRefreshHeaderControls`
- 测试：`npm run test:canvas-refresh-pause`（32 项）

### 16.8 Chat / LLM 规则与契约（2026-06）

| 项 | 内容 |
|----|------|
| 规格 | `docs/LLM-CHAT-RULES-SPEC.md` |
| 离线门禁 | `npm run test:chat-gate`（layout + pipeline + probe fallback + 注册契约） |
| 模型注册契约 | `npm run test:llm-model-contract` |
| 发版 API 套 | `test:chat-all` + `test:llm` + `test:llm:probe` |

**加新 LLM：** 只动 `ChatPanel` 注册/路由；展示走 `assistantMessageLayout`；契约测试加一条。

### 16.7 全模型媒体规则与契约测试（2026-06）

| 项 | 内容 |
|----|------|
| 规格 | `docs/MODEL-MEDIA-RULES-SPEC.md`（三态分离、分模型矩阵、OUTPUT 专项） |
| 核心文件 | `utils/panelRefPersistence.ts`（OUTPUT 面板 sanitize、spawn 快照） |
| 契约测试 | `scripts/model-media-contract-test.ts` → `npm run test:model-contract`（表驱动场景；断言数以最近一次 `test:gate` 输出为准） |
| 规则 | `.cursor/rules/regression-gate.mdc`（日常 gate / 发版全套） |
| CI | `.github/workflows/test-gate.yml`（push/PR 跑 gate） |

**产品规则（2026-07-03）：**

- **源节点面板**：运行后保留全部拖入槽；`mergeAndPrunePanelReferenceImagesAfterUpload` **只写回 @ 槽的上传 URL，不裁剪未 @ 槽**（函数名保留历史）。
- **OUTPUT/MOV spawn**：仍不继承 prompt/参考/首尾帧；用户**手动拖入后可编辑并持久化**（§16.12）。
- **Node Details**：OUTPUT/MOV **只读 `generationParams`**，张数/标签 = 当次 prompt @ 顺序，**不得**用当前面板补齐。
- **运行后再拖图**：新槽须出现在 `@` 下拉（`buildInspectorPromptMentionItems`）。

**废止：** 运行后 `prunePanelReferenceImagesToPromptRefs` 清空未 @ 槽；此前「仅 @ 到的槽写回面板」规则。

**门禁：** `npm run test:panel-partial-ref`（已并入 `test:gate`）+ `test:model-contract`。

### 16.9 Node Details 参考图标签与 API 顺序对齐（2026-06，image2 / Seedance 参考生）

| 项 | 内容 |
|----|------|
| 症状 | 多参考图 + `@资产:` 与 `@图片n` 混排时，Node Details 底栏标签/缩略图与创意描述 @ 顺序不一致（与 image2「大牙错配」同类） |
| 根因 | API 上传顺序按 **prompt @ 顺序**；面板槽按 **referenceImages 物理下标**；用面板槽重建 Details 再对 gp URL 池会错配 |
| 修复 | `buildSeedanceReferenceDetailsFromSnapshot`：prompt 图片 token 数 ≥ API 张数时 **以 prompt 推断标签顺序为准**；`buildImageGenOutputReferenceDetailsFromSnapshot` 复用同逻辑 |
| FlowEditor | Seedance 参考生：有 `generationParams.referenceImages` 快照时 **所有节点类型** 走 snapshot 路径（不仅 OUTPUT/MOV） |
| 测试 | `model-media-contract-test.ts`：`image 2·@资产:大牙+@图片1`、`seedance2.0 参考生·@资产:大牙+@图片1`；面板序误存 gp 时仍对齐 prompt |

**勿回退：** OUTPUT/MOV Details 禁止 `buildNodeDetailsReferencePreview(panelSource, urlPool)` 冒充 API 入参（有 gp 快照时）。

### 16.11 OUTPUT/MOV 节点不继承创意描述与参考（2026-06 产品规则更新）

| 项 | 内容 |
|----|------|
| 症状 | 生成的 OUTPUT/MOV 节点面板仍显示源节点的创意描述、参考图/视频/音频、首尾帧，观感混乱 |
| 新规则 | OUTPUT/MOV 面板**一律不继承**创意描述（prompt/negativePrompt/klingOmni*Prompt/seedanceTabConfigs prompt）与任何参考（referenceImages/referenceMovs/referenceAudios/klingOmni*ReferenceImages/jimengImages/首尾帧） |
| 保留 | 生成结果 `imagePreview` / `videoPosterDataUrl` / `imageName` / `selectedModel` / 模型配置（aspectRatio/resolution/numberOfImages/quality 等） / `generationParams` 快照（Node Details 只读） |
| 文件 | `FlowEditor.tsx`：`OUTPUT_NODE_INHERIT_KEYS` 白名单瘦身；spawn 段 newNode.data 不再写 prompt/refs/modelConfigs |
| | `utils/panelRefPersistence.ts`：`sanitizeOutputNodePanelReferenceImages` 一律返回 `[]`（**仅用于 spawn / 契约测试**）；`sanitizeOutputNodeFramePanelPatch` 清所有 OUTPUT/MOV 首尾帧；`outputNodePanelReferenceImagesFromRun` 一律返回 `[]` |
| | **运行时/加载时不再 sanitize 参考图与首尾帧**（§16.12）：NodeInspector 面板 effect 不再调用 sanitize；`sanitizeOutputLikeNodeDataOnLoad` 为 no-op |
| 废止 | 此前「prompt 含 `@图片n` 时 OUTPUT 面板保留对应参考」规则；`shouldPreserveSeedanceReferencePanelBeforePromptRefs` 不再影响 OUTPUT sanitize（函数保留供编辑态 helper） |
| 测试 | `model-media-contract-test.ts`：`outputPanelRefsEmpty: true` / `spawnPanelRefCount: 0`；`panel-ref-media-simulation-test.ts` §12h/§128 更新为面板参考格为空 |
| 勿回退 | OUTPUT/MOV 面板不得再写回 prompt/refs/首尾帧；Node Details 仍读 `generationParams` 快照 |

### 16.10 刷新后单节点运行进度条恢复（2026-06）

| 项 | 内容 |
|----|------|
| 症状 | 节点 running 中 F5 刷新后进度条消失、状态变 idle，任务仍在 AiTop 侧跑 |
| 对比 20260615 | 旧版 `normalizeNodeRunStateForPersist` **一律**清 running/progress，无 `prepareNodesAfterWorkspaceLoad`，taskId 落盘靠 900ms 防抖易丢失 |
| 修复 | `types.ts`：`runRecoveryPending` / `runRecoveryProgress` |
| | `runRecovery.ts`：持久化时保留 recovery 标记；`prepareNodesAfterWorkspaceLoad` 加载后标回 `running` + 恢复 progress；**下游 OUTPUT 已有同 taskId 成片时一律收尾 completed**（勿用 `nodeHasRecoveredMediaOutput` 阻断，否则源节点已有 thumbnails 时会卡 6%） |
| | `useAiTopRunRecovery.ts`：`runRecoveryPending && running` 也触发轮询；**`isNodeLiveRunActive` 跳过本页 live poll**；**`postLoadPrepDoneRef` 仅首次 hydration 跑 prepare**，避免 effect 重入覆盖 running 态 |
| 测试 | `src/test/utils/runRecovery.test.ts`（vitest / test:gate 内） |
| **仍不恢复** | 左上角 **批量/分镜队列** 进度（`batchRunProgress` 未持久化）；taskId **创建前** 刷新无法恢复；**定时批量** 刷新仍丢失（§5） |

**对比 20260615 缺失项（当前版已补）：** `model-media-contract-test.ts` 全模型契约；`buildSeedanceReferenceDetailsFromSnapshot`；run recovery 字段与 force persist。

### 16.12 OUTPUT/MOV 用户拖入参考图保留 + 首帧抖动修复（2026-06）

| 项 | 内容 |
|----|------|
| 症状 A | 生成的 OUTPUT/MOV 节点切换 seedance2.0 参考生/图生后**无法拖入参考图或尾帧**（拖入后不显示） |
| 根因 A | `sanitizeOutputNodePanelReferenceImages` / `sanitizeOutputNodeFramePanelPatch` 被 NodeInspector 面板 effect 每帧调用，用户拖入后立即被清空 |
| 修复 A | 继承参考/首尾帧仅在 **spawn** 时为空；运行时/加载时不再 sanitize：面板 effect 移除 `sanitizeOutputNodePanelReferenceImages` 与 `sanitizeOutputNodeFramePanelPatch`；`effectivePanelReferenceImages` 对 OUTPUT/MOV 用 `data.referenceImages`；`sanitizeOutputLikeNodeDataOnLoad` 改为 no-op |
| 症状 B | seedance2.0 图生视频模式 OUTPUT 节点首帧灰色标签条**抖动** |
| 根因 B | `sanitizeOutputNodeFramePanelPatch` 清空首尾帧 ↔ seedance `useEffect`(line ~1149) 从 `seedanceTabConfigs.image` 恢复首帧 → restore↔clear 循环 |
| 修复 B | 该 `useEffect` 加 `nodeType === OUTPUT/MOV` 守卫跳过恢复（首尾帧由 sanitize 清空，产品规则不继承） |
| 文件 | `NodeInspector.tsx`：面板 effect / `effectivePanelReferenceImages` / image2 压紧 effect / seedance `useEffect` 守卫；`panelRefPersistence.ts`：`sanitizeOutputLikeNodeDataOnLoad` 仅清首尾帧 |
| 测试 | `panel-ref-media-simulation-test.ts` **§129**（用户拖入参考图/尾帧加载后不丢失）；`first-frame-panel-default-fill-test.ts` **§8**（seedance 首帧不抖动）、**§9**（尾帧 load 保留） |
| 勿回退 | OUTPUT/MOV 面板**不得**在运行时/加载时清空用户手动添加的参考图/首尾帧；继承的清空仅发生在 spawn |

### 16.13 image2-aspect-size 测试与 gate 一致化（2026-06）

| 项 | 内容 |
|----|------|
| 问题 | `image2-model-aspect-size-test.ts` 期望 `compactImage2PanelReferences` 保留同主图 URL 参考槽，与 `image2-panel-refs-test.ts`（gate 内）「压紧时去掉主图重复首槽」矛盾 |
| 修复 | 统一为 gate 行为（主图占格时移除同 URL 首槽）；修正 `image2PanelRefs.ts` 误导注释 |
| 测试 | `test:image2-aspect-size` 12/12 通过 |

### 16.6 本会话全量回归结果（交付前已跑）

| 套件 | 结果（以最近一次执行日志为准） |
|------|---------------------------------|
| vitest (test:gate) | 通过（含面板/运行/锚定/中键拖放/MiniMap/LLM 等 vitest） |
| test:delivery-all | 通过 |
| test:panel-refs | 通过（含 §129 及后续） |
| test:node-details | 通过 |
| test:project-json-details | 通过 |
| test:panel-swap-all | 通过 |
| test:panel-models | 通过 |
| test:first-frame-panel | 通过 |
| test:image2-panel-refs | 通过 |
| test:image2-aspect-size | 通过 |
| test:i2v-pipeline | 通过 |
| test:batch-run-schedule | 通过 |
| test:canvas-refresh-pause | 通过 |
| test:prompt-asset-scan | 通过 |
| test:prompt-edit-matrix | 通过 |
| test:inspector-mentions | 通过 |
| test:panel-mention | 通过 |
| test:download-task | 通过 |
| test:download-url-ranking | 通过 |
| test:chat-gate | 通过 |
| test:llm-model-contract | 通过 |
| test:chat-all | 通过 |
| persist-sanitize + workspace-codec + codec-edge | 通过 |
| ssrf-guard / jwt-warning / patch-cover-authz | 通过 |
| project-cover / storyboard-spawn | 通过 |
| npm run build | 成功 |

**仍须人工点验：** 真实 AITOP run、工程 #14 长时间保存、批量运行进度条位置、换图/主图恢复 UI、面板刷新后本地图。

### 16.14 Seedance 2.0 参考生 Node Details 模式/参考视频（2026-06-30）

| 项 | 内容 |
|----|------|
| 症状 A | 参考生运行后 Node Details 显示「文生视频 + 0 张参考图」（gp 模式取自 stale `runStartDataSnapshot.text`） |
| 修复 A | `runCaptureForGp.seedanceGenerationMode` + `stageRunPersistPatch`；`buildGenerationParamsFromRunSnapshot` / `mergeRecoveryGenerationParamsFromRunNode` 优先 runCapture |
| 症状 B | 纯图参考生（仅 `@主图`+`@图片n`）OUTPUT Details 出现 **REFERENCE VIDEOS (1)**（生成/链路视频误回填） |
| 根因 B | `mergeSeedancePanelReferenceMovsAfterUpload` plan 无视频仍保留面板历史 `referenceMovs`；OUTPUT Details 从上游 BFS 回填视频 |
| 修复 B | plan 无 `@视频` → `referenceMovs=[]`；`seedanceReferenceMovsForOutputDetails` 仅信 `gp.referenceMovs`；recovery 勿从面板 `referenceMovs` 回填 |
| 文件 | `utils/referencedMediaRun.ts`、`utils/nodeDetailsPreview.ts`、`utils/runRecovery.ts`、`FlowEditor.tsx` |
| 测试 | `node-details-simulation-test.ts` §11d–§11f；`model-media-contract-test.ts`「@主图+@图片3 纯图无参考视频」；vitest `referencedMediaRun.test.ts` + `seedanceReferenceDetails.test.ts` + `runRecovery.test.ts` |
| 勿回退 | OUTPUT 参考生 Details 禁止 upstream/ancestor 回填 Reference Videos；纯图 run 禁止写入 stale panel `referenceMovs` |

### 16.15 生成完成后 Source URL 须为 AiTop COS（2026-06-30）

| 项 | 内容 |
|----|------|
| 症状 | 生图/生视频后 Node Details「Source URL」仍显示 `blob: (本地文件名)`，参考图已是 aitop COS |
| 根因 | spawn 未写 `generationParams.outputUrl`；Details 回退 `imagePreview` blob；任务状态 picker 可能先命中 blob |
| 修复 | `utils/generatedOutputUrl.ts`：`outputUrl` 快照 + `resolveNodeDetailsSourceUrl`；轮询 `pickImage/VideoResourceUrlFromTaskStatus` 优先 AiTop/https；hydrate 用 gp.outputUrl 补 OUTPUT preview |
| 测试 | `src/test/utils/generatedOutputUrl.test.ts`；`node-details-simulation-test.ts` §12；`model-media-contract` gpOutputUrlAitop |
| 勿回退 | 已生成（有 taskId/outputUrl）的 Details 禁止展示 blob/data 作为 Source URL |

### 16.16 image2 比例/尺寸对齐 OPEN_AI_GPT_IMAGE_2 规格（2026-07-01）

| 项 | 内容 |
|----|------|
| 症状 | image2 仅支持 5 比例 + 旧清晰度（2048/3840）；API 实际支持 10 比例 + 各比例 1 像素 + auto |
| 修复 | `utils/image2Model.ts`：`IMAGE2_ASPECT_TO_SIZE` 10 比例（1:1/5:4/9:16/21:9/16:9/4:3/3:2/4:5/3:4/2:3）；`image2MigrateLegacyImageSize`（2048x1152→1536x864 等）；NodeInspector 下拉自动跟随；`createImage2Task` 同时发 `aspectRatio` |
| 测试 | `test:image2-aspect-size` 21/21；`test:image2-panel-refs` 12/12 |
| 勿回退 | 不要再退回「每比例多档清晰度」UI；旧项目 legacy 尺寸加载时自动迁移到 canonical |

### 16.17 下载成品 URL 优先级（imagesGenerations/videosGenerations > openApi）（2026-07-01）

| 项 | 内容 |
|----|------|
| 症状 | image2 选 1536x864 下载得到 1376x768（openApi 中间链）；视频下载拿到 openApi poster |
| 根因 | 下载链路**优先 taskId** → `pickMediaResourceUrlFromTaskStatus` 命中 `openApi` resourceUrl（中间/预览链），而非 `imagesGenerations`/`videosGenerations` 成品 |
| 修复 | `utils/generatedOutputUrl.ts`：`rankAitopPersistableResultUrl`（imagesGenerations=300 > videosGenerations=280 > 其它=100 > openApi=50）；`resolvePreferredNodeDownloadUrl`（优先 gp.outputUrl / imagePreview，再回退 taskId）；`utils/taskStatusMediaUrl.mjs` + `taskStatusImageUrl.ts` 同步统一排序；`FlowEditor.downloadNodePreviewMedia` + `CustomNode.handleDownload` 优先 preferredUrl |
| 测试 | `scripts/download-result-url-ranking-test.ts` 12/12；`src/test/utils/generatedOutputUrl.test.ts` 10/10；`download-task-simulation-test.ts` 18/18 |
| 勿回退 | 下载不得优先 taskId 返回的 openApi 链；客户端发的 size 是请求参数，实际 PNG 像素由 API 决定（Node Details 可显示 `outputImageSize` 与请求 `image2ImageSize` 区分） |

### 16.18 Omni 视频 @资产-only 面板去重 / Details 标签（2026-07-01）

| 项 | 内容 |
|----|------|
| 症状 | `把@资产:美女中的角色按照@视频1…` 场景：面板主图=美女 + 参考格又显示一张「图片1」（同一张 COS 上传）；Node Details 标签误为「图片1」或长串 |
| 根因 | `@资产:` 用贪婪正则 `[^\s@]+` 把「美女中的角色按照」整段当资产名；旧 `isDuplicateOfMainImagePreview` 只比 URL，flowgen 资产 URL（/flowgen-api/.../file）≠ COS 上传 URL，去重失败 |
| 修复 | `utils/referenceImageSlotLabels.ts`：`isOmniAssetMainUploadRefDuplicate` + `isPanelRefDuplicateOfMainImageSlot`；用 `matchAllPromptMediaTokens` 解析 token；`filterPanelReferenceDisplayEntriesExcludingMainPreview` 接收完整节点上下文。`utils/nodeDetailsPreview.ts`：`inferOmniAssetPromptReferenceDetailLabels` + `applyOmniAssetLabelsToDetailsReferencePreview`（@资产-only 时 Details 标签=资产名） |
| 测试 | `panel-ref-media-simulation-test.ts` §130；`node-details-simulation-test.ts` §10d（5554443332211 场景：Details 标签=美女） |
| 勿回退 | @资产: 解析必须用 `matchAllPromptMediaTokens`（带项目资产库），不得退回贪婪正则；主图格已显示时同素材 COS 上传不得再占参考格 |

### 16.19 Omni MOV/OUTPUT 刷新后 Details 参考图错位（2026-07-01）

| 项 | 内容 |
|----|------|
| 症状 | `99999966666.json` 等：刷新后最后 MOV 节点 Details 仍显示 stale gp 猫/羊（3 张）或标签「图片1+图片2」，与 Inspector 主图+图片1 不一致 |
| 根因 | ① `resolveNearestInputAncestorData` 跳过 OUTPUT 找到 INPUT，MOV 读不到同 run 的 Omni 面板槽；② MOV 无 `klingOmni*Prompt`，video tab 无法识别 `@主图`；③ `restoreOmniMultiPanelFromSnapshot` 把 OUTPUT 生成结果 `imagePreview` 误当 `@主图` |
| 修复 | `FlowEditor.tsx`：同 taskId 直接上游优先。`buildOmniPanelSourceForNodeDetails`：ancestor 合并空槽 + `resolvedPrompt` 写入 tab 字段。`buildOmniInstructionVideoTabDetailsReferencePreview`：新增 `prompt` 参数。`restoreOmniMultiPanelFromSnapshot`：`@主图` 且 imagePreview 不在快照时用 `firstFrameImageUrl`/sourceRefs[0] |
| 测试 | `node-details-simulation-test.ts` §11n（99999966666 MOV multi + video）；§11k–§11m 仍覆盖 uuuuu/tttttt 刷新场景；`test:node-details` 步（已并入 `test:gate`） |
| 勿回退 | MOV Details 不得只 BFS 到 INPUT；不得用生成结果 URL 顶替 gp/API 主图；video tab builder 必须能读到 gp.prompt |

### 16.20 Omni 旧 MOV taskId≠ancestor：不 merge INPUT 参考图（2026-07-02）

| 项 | 内容 |
|----|------|
| 症状 | `0702.json` 旧 MOV `node_5`（task 1467947）仍连在新 OUTPUT 下；Details 出现 3 张图，混入 image2 INPUT 的狮/风格图 |
| 根因 | 同 task 直接上游对不上时 BFS 到 INPUT；`buildOmniPanelSourceForNodeDetails` 无 task 校验即 merge `referenceImages`/Omni 槽 |
| 修复 | `ancestorOmniPanelMergeAllowedForDetails`：仅 preview 与 ancestor **双方 taskId 非空且相等** 时 merge；`@主图` 回退亦不用 mismatched ancestor `imagePreview` |
| 测试 | `node-details-simulation-test.ts` §11o（0702 node_5）；§11n 同 run MOV 仍绿 |
| 勿回退 | 旧 MOV Details 应只读**该次** `generationParams.referenceImages`，不得借无关 INPUT 面板补槽 |

### 16.21 Seedance 参考生 刷新后 gp stale / 面板重复主图 / Details 三态（2026-07-03 · 444444）

| 项 | 内容 |
|----|------|
| 症状 | `444444.json`：面板/API 已是 `[主图,图片3]` 正确 URL，但 `generationParams` 仍留 image2 狐狸/猫 stale URL；刷新后面板出现**两个主图**；Node Details 标签/URL 与面板不一致 |
| 根因 | ① `mergeRecoveryGenerationParamsFromRunNode` 优先 stale gp.referenceImages；② 运行成功写 gp 时用 panel snapshot 而非 API 快照；③ 紧凑 API 含「主图」标签时 `shouldShowPanelMainImageSlot` 未隐藏独立主图格 |
| 修复 | `runRecovery.ts`：`applyWorkspaceSeedanceReferenceGpRepair` + `repairSeedanceReferenceGenerationParamsFromPanel` 于 `prepareNodesAfterWorkspaceLoad`；recovery 优先 panel/tab refs；`referencedMediaRun.ts`：`seedanceReferenceCompactRefsIncludeMainLabel`；`FlowEditor` spawn 用 API snapshot refs |
| 测试 | **`test:444444-panel`**（fixture `scripts/fixtures/444444.json`，19 条）；vitest `runRecovery.test.ts`「repairs stale seedance gp」；`panelMainSlotPrompt.test.ts` 444444 主图格；`node-details-simulation-test.ts` §11d–§11e；**已并入 `test:gate`** |
| 勿回退 | 加载后 gp.referenceImages 必须与面板/API 一致；紧凑参考生含主图标签时不得再渲染独立主图格 + 参考格主图 duplicate |

### 16.22 Omni 指令 @主视频（imagePreview=PNG 截帧 · 900788）

| 项 | 内容 |
|----|------|
| 症状 | 指令变换 tab 创意描述 `@主视频`，`imagePreview` 为 PNG 截帧、`klingOmniInstructionVideoUrl` 为 mp4；属性面板与 Node Details 显示 **视频1** 而非 **主视频** |
| 根因 | `isMainVideo` 仅当 `imagePreview === displayUrl` 且为视频 URL；`buildPromptMediaRefLabels` 顶栏槽走 `nextVideo()` → 视频1 |
| 修复 | `promptMediaRefs.ts`：`resolveOmniTabBoundVideoUrl` / `isOmniTabVideoMainVideoReference` / `@主视频` token 从 instruction 槽解析；`NodeInspector` 顶栏预览；`FlowEditor` Details Reference Videos 角标 |
| 测试 | vitest `omniMainVideoLabel.test.ts`；`node-details-simulation-test.ts` §11p；`model-media-contract-test.ts`「instruction·@主视频 PNG截帧」；**vitest + node-details + model-contract 均在 `test:gate`** |
| 勿回退 | `@主视频` 须绑定 `klingOmni*VideoUrl`，不得要求 imagePreview 本身为 mp4 |

### 16.23 Omni 视频参考 tab Details 参考视频角标（2026-07-03 · 990）

| 项 | 内容 |
|----|------|
| 症状 | 视频参考 tab prompt `@视频1`，Node Details Reference Videos 角标仅显示泛化「视频」，与 @ 下拉/面板 **视频1** 不一致 |
| 根因 | Details 视频区未像参考图一样走 `buildReferenceVideoDetailItems` 标签解析 |
| 修复 | `nodeDetailsPreview.ts`：`buildReferenceVideoDetailItems` + `buildNodeDetailsVideoLabelSource`；`FlowEditor` `referenceVideoDetailItems` 渲染 |
| 测试 | vitest `referenceVideoDetail.test.ts`；`node-details-simulation-test.ts` §11q；`model-media-contract-test.ts`「video·@视频1 Details 标签」；**vitest + node-details + model-contract 均在 `test:gate`** |
| 勿回退 | Reference Videos 角标须与 prompt `@视频n` / `@主视频` 对齐，不得固定写「视频」 |

### 16.24 面板本地参考图刷新后丢失（2026-07-03）

| 项 | 内容 |
|----|------|
| 症状 | 拖入面板的本地图片（压缩后的 data URL / blob）刷新后消失；`imagePreview` 有 `imageLocalRef` 备份但 `referenceImages` 没有 |
| 根因 | ① `sanitizePersistValueDeep` 会剥离 `data:` / `blob:`；② `NodeInspector` 触发 `flowgen:register-original-image` 写入 IndexedDB 是异步事件，**未等待完成**就 `onUpdate`，快速刷新时 IndexedDB 可能尚未落盘 |
| 修复 | `types.ts` 增加 `referenceImageLocalRefs` / `klingOmni*ReferenceLocalRefs`；`utils/hydratePanelReferenceLocalRefs.ts` 负责刷新后从 IndexedDB 恢复；`localNodeMediaStore.ts` 扩展 `ref` slot；`FlowEditor.attachLocalReferenceRefs` 写入完成触发 `flowgen:reference-files-registered`；`NodeInspector.dispatchReferenceAppendFiles` 返回 Promise 等待写入完成后再 `onUpdate` |
| 规则 | 面板本地图片仅当前浏览器 IndexedDB 可见；换浏览器/清缓存会丢失；运行上传后的 https COS 链接不受此影响 |
| 测试 | `src/test/utils/hydratePanelReferenceLocalRefs.test.ts`；`test:panel-refs` §129 及后续；人工按 `TEST-VERIFY-PANEL-REFS.md` 验证 |
| 勿回退 | 拖入参考图后必须等 IndexedDB 写入完成才更新节点状态；恢复逻辑须覆盖 `referenceImages`、`klingOmniMultiReferenceImages`、`klingOmniInstructionReferenceImages`、`klingOmniVideoReferenceImages` 及 `panelMainImageUrl` |

---

### 16.25 项目标准说明书整理与稳定性分级（2026-07-06）

|| 项 | 内容 |
||----|------|
|| 动作 | 按用户规则在项目根目录新建 `skill.md`；将本 Skill 与 `reference.md` 内容整合为项目唯一标准说明书 |
|| 新增 | 模块稳定性分级（S/A/B/C）：S级为 `types.ts` 核心字段、`promptMediaRefs.ts`、`referencedMediaRun.ts`、`referenceImageSlotLabels.ts`、`firstFramePanel.ts`、`panelRefPersistence.ts`、`hydratePanelReferenceLocalRefs.ts`、`runRecovery.ts`、`generatedOutputUrl.ts`/`taskStatus*Url`、`image2Model.ts`、`backdropLabel.ts`、`batchRunQueue.ts` 等；A级为 `FlowEditor.tsx`、`NodeInspector.tsx`、`services/aitop.ts`、服务端核心；B级为交互/Chat/用户管理；C级为样式/实验功能 |
|| 新增 | 核心数据结构 `NodeData` / `GenerationParams` 字段说明与稳定性标记；关键函数入参/出参/调用示例 |
|| 更新 | 本 SKILL.md 顶部增加指向根目录 `skill.md` 的提示；后续修改以根目录文件为准 |
|| 风险 | 根目录 skill.md 与本副本需保持同步；新增/修改功能后必须两边同步更新 |

### 16.26 image2 @图片1 误用主图原图上传（2026-07-06 · 780）

|| 项 | 内容 |
||----|------|
|| 症状 | image2 未 @主图，运行后面板「图片1」被错误替换成主图，用户拖入的干草/狼/别的被挤到图片2/图片3 |
|| 根因 | `utils/referencedMediaRun.ts` `useMainForStartWhenNoFirstFrameFile` 用 `START_FRAME_REF_TOKENS.has(entry.token)` 触发，集合含 `@图片1`/`@图片`；image2 `@图片1` 槽位无 original File 时错误 fallback 到 `ctx.originals.main` 上传 |
|| 修复 | 增加 `entry.refFrameIndex === 0` 条件；image2 `@图片1` refFrameIndex=undefined 不触发，首尾帧模型 `@图片1` refFrameIndex=0 仍保留 |
|| 文件 | `utils/referencedMediaRun.ts` line 866-870 |
|| 测试 | `scripts/780-image2-main-overwrite-ref-test.ts`（11 断言）；`test:gate` 全绿 |
|| 勿回退 | image2/Nano/Omni multi 等多图参考模型 `@图片1` 不得 fallback 主图原图 |

### 16.27 已验收·勿改契约写入 skill（2026-07-07）

| 项 | 内容 |
|----|------|
| 用户确认 | Omni 四 tab、image2 切模型主图、各模型面板 IDB 隔离 **功能 OK** |
| 文档 | 根目录 `skill.md` **§5.8**（勿改契约 + Agent 自检）；模块 **§6.1.7b/6.1.7c** |
| Omni §5.8.1 | 主图四 tab **共用**；仅参考图/顶栏视频/首尾帧 per-tab；`klingOmniTabPanelIsolation.ts` + `switchKlingOmniTab` |
| image2 §5.8.2 | 切模型保留主图；`image2MainPatchOnModelSwitch` + hydrate 主图 blob 规则 |
| 模型 IDB §5.8.3 | per-model 首尾帧/主图/参考；Seedance2.0 急速↔高质量共用 |
| **调试约束** | 改面板/切模型/tab 前必读 §5.8；**禁止**按 tab 拆 Omni 主图、禁止 image2 无快照清空主图、禁止顺手 refactor 已验收模块 |
| 必跑 | Omni：`kling-omni-tab-isolation-test.ts`；image2：`image2-panel-refs-test.ts`；模型：`frame-model-switch-isolation-test.ts`；均须 `test:gate` 全绿 |

---

## 17. 画布交互：Inspector 锚定 / 中键拖放 / MiniMap

**Inspector 锚定（Shift 多选）：** `utils/inspectorAnchorSelection.ts` + `utils/inspectorAnchorSession.ts` — Shift 框选时保持当前 Inspector 节点（`preserveAnchor`），普通单击才切换。`FlowEditor.tsx` `onSelectionChange` / `onNodeClick` 调用。必跑 vitest：`inspectorAnchorSelection` / `inspectorAnchorSession`。

**中键拖放：** `utils/middleButtonMediaDrag.ts` 发起；`utils/canvasMiddleDrag.ts` 汇总画布多选预览；`utils/inspectorMediaDrop.ts` 解析 HTML5 drop 的 `data-flowgen-media-drop` 分区（`node-main` / `reference` / `first-frame` / `last-frame` 等）。Alt+中键 = 画布平移，不启动素材拖放。画布投参考槽标签用 `resolvePanelRefLabelForInspectorDrop`（显示「图片n」），同 URL 主图格用 `isPanelRefDuplicateOfMainImageSlot` 拦截。

**Inspector 参考拖入去重（§5.8.4·S级·已验收）：** Shift+框选中键重复拖入须用 `canvas:{nodeId}` 写入 `referenceElementIds` / `klingOmni*ReferenceElementIds`；串行队列 `utils/inspectorReferenceDropQueue.ts`；读 `nodeDataRef.current`（`getStandardRefElementIds` / `getKlingOmniRefElementIds`）；单次 `onUpdate` 合并 images+eids+labels。必跑：`npm run test:2026070802-omni-panel-dedup` + vitest `omniPanelInspectorDropDedup.test.ts`（已并入 `test:gate`）。

**MiniMap：** `components/flowgen/FlowgenMiniMap.tsx` + `utils/flowgenMiniMapLayout.ts`；纵向分镜工程用 `computeAdaptiveMiniMapSize` 自适应高度；点击节点居中时保留当前 zoom。必跑 vitest：`flowgenMiniMapLayout`；改布局可跑 `npx node scripts/minimap-zoom-smoke.mjs` / `minimap-import-json-smoke.mjs`。

---

## 18. 多图生成数与 image2 成品像素

**多图生成数：** `utils/panelGenerateCount.ts` — `resolvePanelGenerateCount(data)` 从 `numberOfImages` 或 `modelConfigs` 解析，默认 1，上限 4。`utils/multiGenerateTasks.ts` — 多 taskId 并行轮询：`pollImageTaskUntilUrl` / `pollVideoTaskUntilUrl`。必跑 vitest：`src/test/utils/panelGenerateCount.test.ts`（含于 `test:gate`）。

**image2 实际像素：** 运行成功后调用 `utils/probeRemoteImageDimensions.ts` 探测成品 PNG IHDR → `generationParams.outputImageSize`。Node Details 展示「Output Size」与请求 `image2ImageSize` 区分。改此逻辑须跑 `test:gate`（含 `image2-aspect-size` + `generatedOutputUrl` vitest）。

---

## 附加文档

- 详细逻辑与数据流：[reference.md](reference.md)
- **全模型媒体规则规格：** [docs/MODEL-MEDIA-RULES-SPEC.md](../../../docs/MODEL-MEDIA-RULES-SPEC.md)
- **Chat / LLM 规则规格：** [docs/LLM-CHAT-RULES-SPEC.md](../../../docs/LLM-CHAT-RULES-SPEC.md)
- 部署（运维文档，非 skill 范围）：见 `docs/` 目录 · `服务器部署文件清单.md`
- 自动构建规则：`.cursor/rules/auto-build-and-run.mdc`
- 回归门禁：`.cursor/rules/regression-gate.mdc`

---

## 19. 2026-07-09 Chat 轻量问候误联网 + 四模式验收

详见根目录 `skill.md` **§5.10**（S 级已验收）+ **§10.46–§10.50**。要点：

- 问候/身份元问题即使开着联网也不走 probe 首轮
- 身份 tip **仅身份问注入**；普通问答按 API 自然回复
- 日常门禁：`npm run test:chat-gate`（含 `test:llm-chat-identity-contract`）
- 发版加跑：`npm run test:llm:four-mode`

---

## 20. 2026-07-09/10 发版交付冻结（preload / 主图=参考槽 / Backdrop 缩放）

详见根目录 `skill.md` **§5.11**（S 级已验收）。要点：

| 项 | 勿回退 | 必跑 |
|----|--------|------|
| preload 控制台 | `isPreloadDebugEnabled` 默认 `!== false` | 勿改默认关 |
| 主图=参考槽 | 展示：仅主图格实际展示时去重；sync：`shouldDedupePanelRefsAgainstMainForSync` | gate 第 34–35 步 |
| Backdrop 缩放 | 手柄 `pointer-events-auto` + `@reactflow/node-resizer/dist/style.css` | `backdropLabel.test.ts` |

---

## 21. 2026-07-10 Node Details ← → 整份 Generated Outputs 历史

详见根目录 `skill.md` **§5.12**（S 级已验收）。要点：

| 项 | 勿回退 | 必跑 |
|----|--------|------|
| 整份快照重建 | `buildNodeDetailsPreviewFromGeneratedThumb`（gp→prompt/refs/参数） | `generatedThumbKeyboardNav.test.ts` |
| 历史锁 | `previewActiveThumbId` 有值时禁止 live sync 覆盖 | 同上 + `test:gate` |
| 键盘 | 捕获阶段 ←→；输入框不抢；视频聚焦仍可切 | 同上 |
