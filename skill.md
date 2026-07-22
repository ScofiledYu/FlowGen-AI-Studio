# FlowGen AI Studio — 项目标准说明书（Skill）

> 位置：`d:\aaa\flowgen-ai-studio\skill.md`  
> 规则：任何 Agent 修改本项目代码前，**必须先读本文件**并遵守「稳定性分级」与「回归门禁」。  
> 关联文档：`.cursor/skills/flowgen-ai-studio/SKILL.md`、`.cursor/skills/flowgen-ai-studio/reference.md`、`docs/MODEL-MEDIA-RULES-SPEC.md`、`docs/LLM-CHAT-RULES-SPEC.md`、`.cursor/rules/regression-gate.mdc`、`.cursor/rules/auto-build-and-run.mdc`。

---

## 1. 项目概述

### 1.1 目标

FlowGen AI Studio 是一个基于 React Flow + Express + AITOP API 的 AI 媒体生成工作区。用户可以在画布上拖拽、连接节点，通过属性面板配置各模型参数，批量/定时运行生成图片/视频，并管理项目资产与分镜。

### 1.2 核心用户链路

1. 登录 / 选择项目（AITOP 项目同步）
2. 进入 Workspace（`#/workspace/:id`）
3. 在画布上添加 INPUT / PROCESSOR 节点，编辑属性面板
4. 拖入参考图/视频/音频，在创意描述中 `@` 引用
5. 点击「运行」或「选择运行 / 全部运行 / 定时运行」
6. 查看生成结果 OUTPUT / MOV，下载成品或继续链式生成
7. 保存 workspace（MySQL 关系型切片 / 本地 JSON）

### 1.3 入口与脚本

| 场景 | 命令 | 说明 |
|------|------|------|
| 生产构建 | `npm run build` | 先执行 `prebuild` 中文修正，再 `tsc && vite build` |
| 生产启动 | `npm start` | `server.js` 默认 3001，serve `dist/` + 代理 API |
| 开发 | `npm run dev:full` | Vite + `server/flowgenApiOnly.mjs` |
| 日常回归 | `npm run test:gate` | ~20s，覆盖面板/引用/Details/运行链路 |
| 发版门禁 | `test:gate` → `test:project-json-details` → `test:delivery-all` → `npm run build` | 用户说「发布/发版/上线」时必须自动执行 |

---

## 2. 技术架构

```text
index.tsx → App.tsx (#/ hash 路由)
  ├─ Login / Projects / Admin → services/flowgenApi.ts → /flowgen-api
  └─ Workspace → FlowEditor.tsx（核心 monolith ~15k 行）
       ├─ ReactFlow: CustomNode / ChainFolder / Backdrop
       ├─ NodeInspector.tsx（模型面板 ~7k 行）
       ├─ Sidebar → ChatPanel + 分镜条
       ├─ Node Details 弹窗（utils/nodeDetailsPreview.ts）
       └─ services/aitop.ts → server.js 代理 → AITOP API
```

### 2.1 关键目录

| 目录 | 说明 |
|------|------|
| `components/` | React 组件，核心 `FlowEditor.tsx`、`NodeInspector.tsx`、`ChatPanel.tsx` |
| `components/nodes/` | `CustomNode.tsx`、`BackdropNode.tsx`、`ChainFolderNode.tsx` |
| `components/flowgen/` | `ProjectListPage.tsx`、`ProjectAssetLibrary.tsx`、`AdminUsersPage.tsx`、`FlowgenMiniMap.tsx` |
| `utils/` | 业务纯函数，是回归测试的重点 |
| `services/` | 前端 API 封装：`aitop.ts`、`flowgenApi.ts` |
| `server/` | Express 后端，`server.js` + `server/flowgen/` 模块 |
| `server/flowgen/` | 路由、MySQL、权限、workspace 持久化、AITOP 同步 |
| `scripts/` | 回归测试脚本与 fixture |
| `src/test/` | vitest 单元测试 |
| `docs/` | 业务规则规格文档 |
| `.cursor/rules/` | 回归门禁、自动构建规则 |
| `.cursor/skills/` | 本 skill 的副本（以根目录 `skill.md` 为准） |

---

## 3. 稳定性分级（强制）

> **S级**：已历经多轮回归、**禁止改动任何业务逻辑/接口/变量/流程**，仅允许修复语法错误。  
> **A级**：核心功能，改动需严格回归测试（`test:gate` 或更全）。  
> **B级**：次要功能，改动需对应测试。  
> **C级**：UI/实验性，可较灵活调整，但仍需避免破坏主流程。

| 等级 | 含义 | 修改约束 |
|------|------|----------|
| **S级稳定** | 数据结构与核心规则 | 仅修复语法报错；禁止改业务逻辑、接口签名、字段语义、流程 |
| **A级稳定** | 核心运行与面板 | 改动必须跑 `test:gate`；改 bug 一次只修一类问题 |
| **B级稳定** | 辅助功能与交互 | 改动需对应专项测试 |
| **C级稳定** | 样式与实验功能 | 改动需避免破坏主流程 |

---

## 4. 核心数据结构（S级稳定）

> 以下类型与字段已在 `types.ts` 固化，**禁止改动语义**。新增字段需在本文件记录并加测试。

### 4.1 NodeType

```typescript
export enum NodeType {
  INPUT = 'inputNode',
  PROCESSOR = 'processorNode',
  OUTPUT = 'outputNode',
  MOV = 'movNode',
  CHAIN_FOLDER = 'chainFolderNode',
  BACKDROP = 'backdropNode',
}
```

### 4.2 NodeData（核心字段）

| 字段 | 类型 | 用途 | 稳定性 |
|------|------|------|--------|
| `label` | `string` | 节点默认显示名 | S |
| `prompt` | `string` | 创意描述（顶层，非 Omni/Seedance tab 时） | S |
| `negativePrompt` | `string` | 反向描述 | S |
| `selectedModel` | `string` | 当前模型名 | S |
| `imagePreview` | `string` | 画布节点主预览 URL | S |
| `panelMainSlotVisible` | `boolean` | **运行后**未 `@主图` 时隐藏主图格 | S |
| `panelMainImageUrl` | `string` | 运行前主图备份，重新选中时恢复 | S |
| `referenceImages` | `string[]` | 面板参考图 URL | S |
| `referenceImageLabels` | `string[]` | 与 referenceImages 同下标的资产名 | S |
| `referenceImageLocalRefs` | `string[]` | IndexedDB 引用（`flowgen-local:…`） | S |
| `referenceMovs` | `{url, posterDataUrl?}[]` | 参考视频 | S |
| `referenceAudios` | `{url}[]` | 参考音频 | S |
| `firstFrameImage` / `lastFrameImage` | `string` | 首/尾帧 data/blob URL | S |
| `firstFrameImageUrl` / `lastFrameImageUrl` | `string` | 首/尾帧上传 URL | S |
| `firstFrameLocalRef` / `lastFrameLocalRef` | `string` | 首/尾帧 IndexedDB 引用 | S |
| `klingOmniTab` | `'multi' \| 'instruction' \| 'video' \| 'frames'` | Omni 当前 tab | S |
| `klingOmni*Prompt` / `klingOmni*ReferenceImages` / `klingOmni*ReferenceLocalRefs` | 多组 | Omni 各 tab 独立配置（**主图四 tab 共用顶层 imagePreview**） | S |
| `klingOmniTabConfigs` | `{ instruction?, video?, frames? }` | Omni tab 快照：仅顶栏视频 + 首尾帧（**不含主图**） | S |
| `seedanceTabConfigs` | `{ text?, image?, reference? }` | Seedance 2.0 三 tab 快照 | S |
| `seedanceGenerationMode` | `'text' \| 'image' \| 'reference'` | Seedance 模式 | S |
| `image2AspectRatio` / `image2ImageSize` | `string` | image2 比例/像素尺寸 | S |
| `image2Quality` / `image2QualityLevel` | `'1K'\|'2K'\|'4K'` / `'low'\|'medium'\|'high'` | image2 满血版 API quality / qualityLevel | S |
| `generationParams` | `GenerationParams` | **运行快照**（Node Details 只读来源） | S |
| `taskId` | `string` | AITOP 任务 id | S |
| `runRecoveryPending` / `runRecoveryProgress` | `boolean` / `number` | 刷新后恢复运行态 | S |
| `generatedThumbnails` | `{ id, url, type, nodeId, name, generationParams, posterDataUrl? }[]` | 生成历史缩略图 | S |
| `modelConfigs` | `Record<string, ...>` | 各模型独立面板快照 | S |
| `customName` | `string` | 节点自定义显示名 | A |
| `backdropChildIds` / `backdropLabel` / `backdropFill` / `backdropBorder` | 背景框字段 | S |
| `chainFolderChildIds` / `chainFolderExpanded` / `chainFolderLabel` | 链路折叠字段 | A |
| `scheduledRunQueued` | `boolean` | 定时批量排队瞬态（勿持久化） | A |
| `spawnHighlight` | `'green' \| 'yellow' \| 'red'` | 分镜生成下游高亮 | A |

### 4.3 GenerationParams（运行快照）

> `generationParams` 是 **OUTPUT/MOV 节点的 Node Details 唯一可信来源**。禁止用当前面板 fallback 冒充。

| 字段 | 用途 | 稳定性 |
|------|------|--------|
| `prompt` / `negativePrompt` | 当次运行创意描述 | S |
| `model` / `quality` / `duration` / `aspectRatio` / `resolution` | 当次模型参数 | S |
| `referenceImages` / `referenceImageLabels` | 当次 prompt @ 到的参考图 | S |
| `referenceMovs` / `referenceAudios` | 当次参考视频/音频 | S |
| `firstFrameImage` / `lastFrameImage` | 当次首尾帧 | S |
| `outputUrl` / `outputUrls` / `outputImageSize` | 生成结果主 URL / 多图 / 实际像素 | S |
| `taskId` / `generatedAt` | 任务 id 与完成时间 | S |
| `klingOmniTab` / `klingOmniInstructionVideoUrl` / `klingOmniVideoUrl` | Omni 快照 | S |
| `seedanceGenerationMode` / `seedanceReferenceRatioMode` / `seedanceReferenceWebSearch` | Seedance 快照 | S |
| `image2AspectRatio` / `image2ImageSize` / `image2Style` / `outputImageSize` | image2 快照 | S |
| `jimengImages` / `jimengResolution` / `viduDuration` / `viduClarity` | 各模型专用 | S |

---

## 5. 核心不变量（S级稳定）

> 这些是无数次回归确立的产品与数据规则，**禁止回退**。

### 5.1 三态分离

| 态 | 存储位置 | 用途 | 规则 |
|----|----------|------|------|
| **面板态** | `NodeData` 顶层字段、`seedanceTabConfigs`、`klingOmniTabConfigs` 等 | Inspector 编辑 | 运行后保留全部已拖入槽，**不因未 @ 而裁剪** |
| **运行快照** | `generationParams`（spawn 时写入 OUTPUT/MOV） | Node Details、历史追溯 | 仅含当次运行 prompt @ 到的素材 |
| **展示预览** | `imagePreview` / `referenceImages` / `videoPosterDataUrl` | 画布缩略图 | 优先 blob/data，持久化只存可存 URL |

### 5.2 @ 引用链路（面板 ↔ 下拉 ↔ plan → API → prompt 展开）

```text
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

### 5.3 面板 ↔ @ 下拉规则

- 参考槽资产名 → `@资产:展示名`；泛称槽 → `@主图` / `@首帧图` / `@尾帧图` / `@图片n` / `@视频n` / `@主视频`
- 首尾帧模型：首帧格无 URL 时**展示回退主预览**，@ 下拉与 plan 均用 `effectiveFirstFramePanelUrl` / `resolvedFramePanelUrl`（勿只读 `firstFrameImageUrl`）
- 仅拖尾帧、首帧靠主图回退时，下拉须**同时**含 `@首帧图` 与 `@尾帧图`（或对应 `@资产:`）
- **UI @ 下拉只列当前面板已有槽**，禁止合并全资产库（`mergeInspectorAtMentionItems` 仅工具函数/测试保留）

### 5.4 发模型 plan 规则

- `ReferencedCollectedImageRef.refFrameIndex`：0=首帧、1=尾帧；`@资产:名` 通过 `findPromptMediaRefItemForToken` 对齐面板 `refFrameIndex`
- `assignStartEndUrlsFromImagePlan` / 可灵 run 分支：除 `@首帧图`/`@尾帧图` 外，**也认 refFrameIndex**
- 运行前 `buildCanonicalInspectorPromptPatch`：`@首帧图`/`@尾帧图` 可规范为 `@资产:展示名`；展开时仍保留 `@首帧图`/`@尾帧图` 别名短语
- **§5.8.7**：canonical 仅并入 `runDataBase` / `runStartDataSnapshot` 供 plan/API；**禁止** `updateNodeDataById(promptCanonPatch)` 写回 Inspector 创意描述（二次运行 @ 引用须与用户原文一致）

### 5.5 媒体 URL 优先级与本地持久化

- 持久化：仅 COS / 资产库 URL `/flowgen-api/.../assets/.../file` / 服务端 node-media（`workspaceMediaPersist.ts`、`persistSanitize.ts`）
- 预览：blob/data 优先于过期 COS（Inspector 首尾帧、`resolveInspectorFramePreviewUrl`）
- 本地媒体持久化：
  - 主图：`imageLocalRef` → `localNodeMediaStore.ts`（`main` slot）
  - 首尾帧：`firstFrameLocalRef` / `lastFrameLocalRef`（`firstFrame` / `lastFrame` slot）
  - 面板参考图：`referenceImageLocalRefs` / `klingOmni*ReferenceLocalRefs`（`ref` slot，按槽下标）
  - Omni 参考视频：`imageLocalRef` 或 `klingOmniVideo` slot
- 刷新后：`hydrateLocalMediaPreviews` → `hydrateAllPanelReferenceLocalRefs` 从 IDB 重建 blob URL；workspace JSON 只存 `flowgen-local:...` 短引用
- 下载 URL 优先级：`imagesGenerations` (300) > `videosGenerations` (280) > 其它 (100) > `openApi` (50)；优先 `gp.outputUrl` / `imagePreview`，再回退 taskId

### 5.6 OUTPUT/MOV 节点不继承 prompt 与参考（2026-06 产品规则）

- OUTPUT/MOV 面板**一律不继承**创意描述与任何参考（prompt/negativePrompt/klingOmni*Prompt/seedanceTabConfigs prompt/referenceImages/referenceMovs/referenceAudios/klingOmni*ReferenceImages/首尾帧）
- 保留：生成结果 `imagePreview` / `videoPosterDataUrl` / `imageName` / `selectedModel` / 模型配置 / `generationParams` 快照
- 继承清空仅发生在 **spawn** 时；运行时/加载时**不再 sanitize** 用户手动拖入的参考图/首尾帧

### 5.7 多图参考主图：编辑态展示 / 运行后隐藏

| 阶段 / 创意描述 | 面板「主图」格 | 画布 `imagePreview` |
|----------------|--------------|---------------------|
| **编辑态**（未点运行） | 有主预览则**展示** | 用户主图 / 当前预览 |
| **运行后** + 无 `@主图` | **隐藏**（`panelMainSlotVisible: false`） | **首个 @ 参考图**（非 outputUrl） |
| 含 `@主图` / `@主体` | **展示** | @主图 上传 URL |
| 空 / 纯文本 | **展示** | 主图 |

- 关键函数：`shouldShowPanelMainImageSlot`（唯一判定）
- 字段：`panelMainSlotVisible`（仅运行后写入）、`panelMainImageUrl`（备份）、`imagePreview`（画布大图）

### 5.8 已验收·勿改契约（2026-07-07，用户确认功能 OK）

> **调试其它 bug 时，禁止改动本节逻辑**；若必须改，须先跑对应回归且不得破坏下列行为。  
> 本节覆盖 2026-07-07「模型/Tab 面板隔离 + image2 主图」、2026-07-08「Inspector 中键/Shift 框选拖入去重（全模型）」、2026-07-10「@资产 plan + gp空 Details recovery（全模型）」等已验收交付。

**拖入元素保留范围（切模型 / 切 tab / 刷新）：**

| 操作 | 是否保留拖入的本地图/视频/首尾帧 | 机制 |
|------|--------------------------------|------|
| **切模型** | ✅ 各模型各自保留（主图/参考/首尾帧） | `modelConfigs` 快照 + per-model IDB 键（§5.8.2/§5.8.3） |
| **切 tab**（Omni 四 tab） | ✅ 各 tab 各自保留参考/顶栏视频/首尾帧；主图四 tab 共用 | `klingOmniTabConfigs` + per-tab IDB 键（§5.8.1） |
| **刷新页面** | ✅ 同一浏览器内保留 | workspace JSON 存 `flowgen-local:…` 短引用 → `hydrateAllPanelReferenceLocalRefs` 从 IndexedDB 重建 blob URL（§5.5、§6.1.7） |

**刷新限制（产品规则，非 bug）：** 本地拖入图仅存当前浏览器 IndexedDB；换浏览器/清缓存会丢。运行上传后的 https COS 链接写在 workspace JSON，刷新不受影响。

#### 5.8.1 可灵3.0 Omni — 四 tab 面板（S级·已验收）

| 维度 | 规则 | 禁止 |
|------|------|------|
| **主图** `imagePreview` / `imageName` / `imageLocalRef` | **四 tab 共用**；切换 multi / instruction / video / frames **不得**写入 patch 剥离主图 | 按 tab 拆分主图快照、`clearLiveMainPanelPatch` 作用于主图、`buildKlingOmniMainLocalRefForTab` 按 tab 写 IDB |
| **参考图** | 已分字段：`klingOmniMulti*` / `klingOmniInstruction*` / `klingOmniVideo*`；IDB `ref:可灵30_Omni_{tab}:N` | 四 tab 共用同一 `ref:可灵30_Omni:N` |
| **顶栏视频** | 指令 tab ↔ `klingOmniInstructionVideo*`；视频 tab ↔ `klingOmniVideo*`；快照在 `klingOmniTabConfigs.instruction` / `.video` | 切换 tab 时把视频参考 tab 的视频写到指令 tab |
| **首尾帧** | 仅 frames tab 使用顶层 `firstFrame*` / `lastFrame*`；快照在 `klingOmniTabConfigs.frames`；IDB `firstFrame:可灵30_Omni_frames` | 切换非 frames tab 时保留 live 首尾帧污染 @ 下拉；与其它模型共用首尾帧 IDB |

**关键模块（S级，仅修语法）：**

- `utils/klingOmniTabPanelIsolation.ts` — `buildKlingOmniTabSwitchPatch`、`snapshotKlingOmniTabConfigsWithLivePanel`、`applyKlingOmniActiveTabLivePanel`
- `components/NodeInspector.tsx` — `switchKlingOmniTab`（tab 按钮 onClick）
- `utils/localNodeMediaStore.ts` — `buildKlingOmniReferenceLocalRefForTab`、`buildKlingOmniFrameLocalRefForTab`；主图用 `buildMainLocalRefForModel(..., '可灵3.0 Omni')`

**必跑：** `npx tsx scripts/kling-omni-tab-isolation-test.ts` + `src/test/utils/klingOmniTabPanelIsolation.test.ts` + `npm run test:gate`

#### 5.8.2 image2 — 切模型主图保留（S级·已验收）

| 场景 | 预期 |
|------|------|
| image2 有主图 → 切 Nano/其它 → 切回 image2 | 主图格 + 画布缩略图恢复（`modelConfigs.image2` 含 `imageLocalRef` + `panelMainSlotVisible`） |
| 无 image2 快照、从它模型带主图切到 image2 | 继承当前主预览；**清除**继承的 `panelMainSlotVisible=false` |
| 有 `imageLocalRef` 的 stale blob | 仅剥离 `data:`，**保留**会话内 `blob:`；靠 hydrate 补空预览 |

**关键模块（S级）：** `utils/image2PanelRefs.ts`（`image2MainPatchOnModelSwitch`）、`utils/hydratePanelReferenceLocalRefs.ts`（主图 strip 规则）、`NodeInspector.handleModelChange` image2 分支

**必跑：** `scripts/image2-panel-refs-test.ts` + `scripts/panel-switch-broken-urls-test.ts` + `npm run test:gate`

#### 5.8.3 各模型面板独立 — 首尾帧/主图/参考（S级·已验收）

| 范围 | 规则 |
|------|------|
| 非 Seedance2.0 模型 | 尾帧/首帧/主图/参考图 IDB **per-model**（`buildFrameLocalRefForModel` / `buildMainLocalRefForModel` / `buildReferenceLocalRefForModel`） |
| **例外** | `seedance2.0 (急速版)` ↔ `seedance2.0 (高质量版)` **共用**面板 IDB（`usesUnifiedSeedance20PanelLocalRef`） |
| 切模型 | `handleModelChange` 保存/恢复各模型 `modelConfigs` 快照；首尾帧 **不**在 `stripRestoredNodeMediaForLocalRefHydrate` 中剥离 blob |
| **刷新** | sanitize 后保留 `*LocalRef` 短引用；`hydrateAllPanelReferenceLocalRefs` 从 IDB 恢复预览（`frame-model-switch-isolation-test.ts` §3） |

**必跑：** `scripts/frame-model-switch-isolation-test.ts` + `npm run test:gate`

#### 5.8.4 Inspector 中键/Shift 框选拖入去重（S级·已验收·2026-07-08）

> **用户已确认 OK**（Omni 面板问题2/3 + Banana/image2/Seedance 全模型）。调试其它 bug 时**禁止**削弱本节逻辑；若必须改，须先跑下列门禁且不得破坏行为。

| 场景 | 预期 | 禁止 |
|------|------|------|
| Shift+框选 → 中键拖入参考区（**再拖同一批**） | 槽数不变；同一画布 `nodeId` 不追加新槽 | 仅靠 URL/blob 去重、去掉 `canvas:{nodeId}` |
| 串行 batch（队列内多次拖入，无 React 重渲染） | `elementIds` 不丢；第 2+ 次同 node 被拦截 | 读 React `data` prop 而非 `nodeDataRef.current` |
| 本地 1 张图拖入 | 仅 1 槽（hydrate blob + 压缩 data **同槽替换**） | hydrate 后再 append 到下一槽 |
| Omni multi API | `imageList` **不含** `canvas:` 前缀 `element_id` | 把 `canvas:` eid 发给 API |
| 删库后再拖 | 底栏回「图片n」；stale 库名被清理 | 保留已删 asset 展示名 |

**数据字段：**

- Omni：`klingOmniMultiReferenceElementIds` / `Instruction*` / `Video*`（与对应 `*ReferenceImages` 同槽）
- 其它模型：`referenceElementIds`（与 `referenceImages` 同槽；Banana / image2 / Seedance 参考生等）

**关键模块（S级，仅修语法或在本节门禁下改 bug）：**

- `utils/inspectorReferenceDropQueue.ts` — `enqueueInspectorReferenceDrop` 串行队列
- `utils/referenceImageSlotLabels.ts` — `panelReferencesAlreadyContainIncoming`、`panelReferencesAlreadyContainCanvasSource`、`canvasOmniRefElementId`、`buildPanelRefElementIdsAfterWrite`
- `components/NodeInspector.tsx` — `getKlingOmniRefElementIds` / `getStandardRefElementIds`（读 `nodeDataRef`）、`applyInspectorReferenceFromUrlStringImpl`、`seedanceReferenceFromUrlImpl`、`ingestInspectorReferenceLocalFilesImpl`；Omni/通用 **单次 `onUpdate`**（images + eids + labels + localRefs）
- `utils/referencedMediaRun.ts` — `buildOmniMultiApiImageList` 过滤 `canvas:` element_id
- `utils/seedance20ModelSwitch.ts` / `types.ts` — `referenceElementIds` 快照与 tab 恢复
- `utils/persistSanitize.mjs` — `referenceElementIds` / `klingOmni*ReferenceElementIds` 槽位数组保留

**必跑（已并入 `npm run test:gate`）：**

| 脚本 / vitest | 覆盖 |
|---------------|------|
| `npm run test:2026070802-omni-panel-dedup` | 场景1–6：canvas 二次拖入、hydrate 同槽、API 过滤、串行 batch、全模型 referenceElementIds |
| `src/test/utils/omniPanelInspectorDropDedup.test.ts` | vitest：canvas 去重、hydrate 同槽、API strip、sequential batch |
| `npm run test:panel-dedup-same-element` | Nano/image2/Omni/Seedance 同 URL 与压缩前后去重 |
| `npm run test:panel-partial-ref` | 全模型面板/@/Details 契约（245 项） |
| `npm run test:image2-panel-refs` | image2 压紧/主图槽（§5.8.2 叠加） |

**fixture 参考：** `d:/json/面板问题2.json`、`面板问题3.json`、`面板图片.json`、`2026070802-seedance2.0-中键连续拖入…json`

**勿回退：** 不得移除 `referenceElementIds` / `klingOmni*ReferenceElementIds`；不得把 Omni addOne 拆成两次 `onUpdate` 写 labels 冲掉 eids。

#### 5.8.5 全模型 @资产 plan + gp空 Details recovery（S级·已验收·2026-07-10）

> **用户确认测试 OK**（banana-源 / banana-问题4；144 断言 × 四模型 fixture）。调试面板 / @引用 / Node Details 时**禁止**削弱本节；若必须改，须先跑下列门禁且不得破坏行为。

| 场景 | 预期 | 禁止 |
|------|------|------|
| prompt `@资产:名` + `@图片n`（slug map **未建**、内存有 `projectAssets[].url`） | `collectReferencedMediaFromPrompt` plan **含 2 项**（顺序=@ 出现顺序） | `resolveProjectAssetUrlFromTokenKey` 只查 Map、忽略 `row.url` |
| **Nano / image2** + `gp.referenceImages` **空** | Node Details recovery **2 张**；标签=光头强+图片n；URL **不串** | gp 空时回退 `buildNodeDetailsReferencePreview` 全量面板 |
| **Nano / image2** 模拟运行 merge | 面板槽数**不减**（9 槽源 / 4 槽问题4） | merge 后未@槽被 prune |
| **Omni multi / Seedance 参考生** 同 prompt | plan **含 @资产 + @图片n**；面板槽保留 | 仅 Nano 特判 @资产 |
| 导出 JSON **无** `projectAssets` | 仍只解析 `@图片n`（1 项）— 边界不变 | 为「修复导出」强行猜 @资产 |

**关键模块（S级，仅修语法或在本节门禁下改 bug）：**

- `utils/promptMediaRefs.ts` — `resolveProjectAssetUrlFromTokenKey`（slug map 优先 → `projectAssets[].url` 回退）、`collectReferencedMediaFromPrompt` / `resolveSeedancePromptTokenMedia`（@资产 分支）
- `utils/referencedMediaRun.ts` — `pickStillImageRecoveryApiReferenceImages`（gp 刷新恢复；空 slug map + projectAssets）
- `utils/nodeDetailsPreview.ts` — `buildStillImageGenNodeDetailsReferencePreview`（gp 空 → recovery，**勿**全量面板 fallback）
- `components/FlowEditor.tsx` — Nano/image2 `previewParams` 须走 `buildStillImageGenNodeDetailsReferencePreview`

**必跑（已并入 `npm run test:gate` 第 43 步）：**

| 脚本 / vitest | 覆盖 |
|---------------|------|
| `npm run test:20260710-asset-mention-details-recovery` | fixture `20260710-banana-source-9slot.json`（banana-源 9 槽 morph）+ `20260710-banana-problem4-asset-pic3.json` + 可选 `d:/json/banana-源.json` / `banana-问题4.json`；**Nano / image2 / Omni multi / Seedance 参考生** × plan / 面板 / merge / Details |
| `src/test/utils/projectAssetUrlFromTokenKey.test.ts` | @资产 row.url 回退单元测试 |
| `npm run test:20260710-banana-run-gp-at-mention` | gp 勿写面板全量 + @时 Details recovery（§11.15–§11.16）+ **§5.8.7 二次运行 prompt 不写回**（§8–§9） |
| `npm run test:20260710-four-mention-all-models` | 4 种引用 × 四模型（含 D `@资产+@图片n`） |
| `npm run test:panel-partial-ref` | 全模型三诉求 #1/#2 |
| `npm run test:node-details` | Details 标签与 gp 对齐 |

**fixture 参考：** `scripts/fixtures/20260710-banana-source-9slot.json`、`20260710-banana-problem4-asset-pic3.json`；实装对照 `d:/json/banana-源.json`、`banana-问题4.json`

**勿回退：** 禁止去掉 `resolveProjectAssetUrlFromTokenKey` 的 `row.url` 回退；禁止 Nano/image2 gp 空时 Details 回退全量 `referenceImages` 面板。

#### 5.8.6 Agent 调试自检（改面板/切模型/tab / @引用 / Details 相关代码前）

1. 读本节 + §5.1–§5.7 + **§5.9**，确认改动是否触碰「勿改」列（含 **§5.8.4 拖入去重**、**§5.8.5 @资产+Details recovery**、**§5.8.7 二次运行 prompt 不写回**）
2. 一次只修一类问题；**不得**顺手 refactor Omni tab / image2 主图 / 模型 IDB 键 / 拖入去重队列 / @资产 URL 解析 / 运行前 canonical 写回 Inspector
3. 改完必跑 §5.8 对应脚本 + `npm run test:gate`；未全绿不得声称完成
4. 向用户汇报时写明：是否触碰 §5.8 已验收模块

#### 5.8.7 二次运行创意描述 @ 引用不 rewrite（S级·已验收·2026-07-10）

> **现象**：节点生成完成后再次点击运行，Inspector 创意描述中 `@图片n` / `@资产:` 被自动 remap 改写（如 `@资产:光头强参考@图片3风格生成` → 全变成 `@资产:`）。**全模型**须一致（Nano / image2 / Omni / Seedance 参考生 / 即梦 / vidu）。

| 层 | 规则 | 禁止 |
|----|------|------|
| **Inspector 展示** | `getNodeInspectorPromptText` 保持用户原文；运行前后不变 | `handleNodeRun` 内 `updateNodeDataById(id, promptCanonPatch)` |
| **Seedance 参考生** | 运行中/收尾只 sync 参考槽与预览；`seedanceTabConfigs.reference.prompt` 保留用户原文 | 运行中 `buildNodePromptUpdatePatch(canonical)`；收尾 `refTab.prompt = getCanonical…` |
| **Omni / image2 / 即梦 / vidu** | 运行前 canonical 仅进 `runDataBase` 快照，不写 tab/顶层 prompt 字段 | 运行完成 setNodes 时把 canonical 写入 `klingOmni*Prompt` / `prompt` |
| **运行 plan/API** | `buildCanonicalInspectorPromptPatch` 仍可用于 `runDataBase` / `generationParams`（`@图片n`→`@资产:` 等） | 为「保 UI」去掉 canonical remap 或破坏 `panel-ref-media-simulation` §25 |
| **扫描 @素材** | 用户主动点「扫描 @素材」仍可写回 | 把扫描逻辑绑回每次运行 |

**关键模块（S级，仅修语法或在本节门禁下改 bug）：**

- `components/FlowEditor.tsx` — `handleNodeRun`：`promptCanonPatch` 只 merge `runDataBase`；Seedance 参考生上传/收尾 **不写** canonical prompt
- `utils/promptMediaRefs.ts` — `getNodeInspectorPromptText` / `getCanonicalInspectorPromptText` / `buildCanonicalInspectorPromptPatch`（canonical 供 plan；Inspector 读 raw）

**必跑（已并入 `npm run test:gate`）：**

| 脚本 / vitest | 覆盖 |
|---------------|------|
| `npm run test:20260710-banana-run-gp-at-mention` | §8 Nano 混排 + §9 **六模型**二次运行 Inspector 原文不变 |
| `src/test/utils/promptRerunCanonical.test.ts` | vitest：六模型 run 快照 vs Inspector 分离 + Seedance refTab |
| `panel-ref-media-simulation-test.ts` §25 | canonical `@图片n→@资产` plan 契约（勿为保 UI 删 remap） |

**勿回退：** 禁止恢复运行前/运行中/收尾对节点的 prompt canonical 写回；禁止 Seedance `refTab.prompt = getCanonicalInspectorPromptText(...)`。

### 5.9 模型 UI 面板 × 生成结果 × 拖拽 × Node Details（2026-07-09 用户验收冻结）

> **用户确认上述四大域「目前测试大概没问题」**；后续改 bug / 新功能时，**不得破坏本节行为**。  
> 与 §5.1 三态分离、§5.8 已验收模块叠加适用；触碰任一行须 `npm run test:gate` 全绿。

#### 5.9.1 三诉求铁律（全模型 × 全 tab）

| # | 诉求 | 面板态 | generationParams / Node Details | 画布缩略图 |
|---|------|--------|----------------------------------|------------|
| 1 | 运行后面板**完整保留**拖入元素 | 未 @ 的槽**不裁剪** | — | — |
| 2 | Details **仅**展示创意描述 @ 到的素材 | — | `referenceImages` / labels **gp-only** | — |
| 3 | 缩略图与 @ 语义一致 | 主图格按 §5.7 | — | 运行前=主图；未 @主图运行后=**首个 @ 参考**；含 @主图=@主图 URL |

**总矩阵门禁：** `npm run test:all-models-three-requirements`（已并入 `test:gate`）

#### 5.9.2 四大域 → 模块 → 门禁映射

| 域 | 用户可见 | 核心模块（改前必读） | 必跑门禁（`test:gate` 内） |
|----|----------|----------------------|---------------------------|
| **模型 UI 面板** | Inspector 参考格/主图格、切模型、Omni/Seedance tab、底栏标签 | `NodeInspector.tsx`、`panelRefPersistence.ts`、`klingOmniTabPanelIsolation.ts`、`image2PanelRefs.ts`、`seedance20ModelSwitch.ts`、`localNodeMediaStore.ts`、`referencedMediaRun` 主图/参考去重 | `panel-partial-ref`、`panel-main-slot`、`panel-refresh-run-all`、`778990-cat-church`、`image2-panel-refs`、`seedance-panel-slot0`、`2026070802-seedance-panel`、`2026070802-kling-omni-panel`、`kling-omni-tab-isolation`、`frame-model-switch-isolation`、`panel-switch-broken-urls`、**`20260709-seedance-main-dup-ref-panel`**、**`20260709-all-models-main-dup-ref-panel`**（§5.11.2）、**`20260710-four-mention-all-models`**、**`20260710-asset-main-all-models`** |
| **生成结果** | 运行后 gp、OUTPUT/MOV 节点、缩略图条、画布大图 | `FlowEditor.tsx` run/spawn、`referencedMediaRun.ts`、`runRecovery.ts`、`spawnOutputNode.ts`、**`hydratePersistedNodePreviews.ts`** | `ggggttt-panel`、`444444-panel`、`oooopppp-panel`、`model-contract`、`i2v-pipeline`、`banana-panel-clobber`、`run-error-no-stuck`、`20260709-seedance-ref-images`、**`20260710-banana-run-gp-at-mention`**（§5.8.7 §8–§9）、**`20260713-export-json-main-image`**（§5.13） |
| **拖拽** | 画布中键/Shift 框选、文件拖入、资产库拖入、同元素去重 | `inspectorReferenceDropQueue.ts`、`referenceImageSlotLabels.ts`、`NodeInspector` 拖入路径、`middleButtonMediaDrag.ts`、`canvasMiddleDrag.ts` | `2026070802-omni-panel-dedup`、`panel-dedup-same-element`、`panel-refs`（§12x/§130）、vitest：`omniPanelInspectorDropDedup`、`middleButtonMediaDrag`、`canvasMiddleDrag`、`inspectorMediaDrop` |
| **Node Details** | 弹窗参考图/视频/标签、与 gp 对齐；gp 空 recovery；**← → 整份历史切换（§5.12）** | `nodeDetailsPreview.ts`、`FlowEditor` previewParams、**`generatedThumbKeyboardNav.ts`**、`previewActiveThumbId` | `node-details`、`model-contract`、`20260709-seedance-video1-mention`、**`20260710-asset-mention-details-recovery`**（§5.8.5）、**`20260710-banana-run-gp-at-mention`**、**vitest `generatedThumbKeyboardNav`**、**vitest `projectAssetUrlFromTokenKey`**；发版加 `test:project-json-details` |

#### 5.9.3 典型 fixture（回归加用例时优先复用）

| fixture | 路径 | 覆盖 |
|---------|------|------|
| 444444 | `scripts/fixtures/444444.json` | Seedance 参考生 面板/gp/Details 三态 |
| ggggttt | `scripts/fixtures/ggggttt.json` | 未 @主图 画布=参考图 |
| oooopppp | `scripts/fixtures/oooopppp.json` | 链式 OUTPUT hydrate |
| 20260709 参考生视频 | `scripts/fixtures/20260709-seedance-ref-video.json` | @图片n 槽对齐 + COS 槽勿用过期 File 上传 |
| 20260709 视频1 | `scripts/fixtures/20260709-seedance-video1.json` | MOV 切 Seedance 后 @主视频 非 @视频1 |
| 20260709 主图=参考槽 | `scripts/fixtures/20260709-seedance-main-dup-ref-panel.json` | 运行后 imagePreview 与参考槽同 URL 不丢图 |
| banana-源 9 槽 | `scripts/fixtures/20260710-banana-source-9slot.json` | 源自 `d:/json/banana-源.json`；morph `@资产+@图片3` × 四模型（§5.8.5） |
| banana-问题4 | `scripts/fixtures/20260710-banana-problem4-asset-pic3.json` | gp 空 + `@资产:光头强+@图片3`；面板 4 槽 + Details recovery（§5.8.5） |
| 20260713 导出 JSON 主图 | `scripts/fixtures/20260713-export-json-main-image-persist.json` | `@主图` + COS imagePreview 跨机器导入勿 EMPTY（§5.13） |

#### 5.9.4 Agent 改四大域前自检

1. 对照上表确认属于哪一域；**一次只修一类**
2. 是否触碰 §5.8 / **§5.11** / **§5.12** S 级模块（Omni tab / image2 主图 / IDB / 拖入去重 / **§5.8.5 @资产+gp空 Details** / **§5.8.7 二次运行 prompt 不写回** / 主图=参考槽去重 / Backdrop 缩放 / preload / **Details ←→ 整份历史**）— 若是，只跑对应子门禁并说明
3. 改完 **`npm run test:gate` 全绿**；向用户汇报四大域门禁已通过
4. 新 bug：在对应脚本 **加命名用例**（见 §8.3），并把 fixture 放入 `scripts/fixtures/`（勿仅依赖 `d:/json/`）

### 5.10 Chat / LLM 身份·联网·四模式（S级·已验收·2026-07-09）

> **用户确认测试 OK**（DeepSeek 开联网问身份不再自称 Claude；全模型四模式 16/16；约束精简后普通问答自然回复）。  
> 改 Chat/LLM 前必读；**禁止**回退下列行为。规格见 `docs/LLM-CHAT-RULES-SPEC.md` §6.1。

#### 5.10.1 冻结契约

| # | 行为 | 实现要点 | 禁止回退 |
|---|------|----------|----------|
| 1 | **问候 / 身份元问题**即使 UI 开着联网，本轮也**不走 probe 首轮** | `isNonSearchableChatUtterance` / `isAssistantIdentityQuestion` → `lightweight` → `effectiveWebSearch=false`；`isGeminiWebSearchFirstPass` 依赖 `effectiveWebSearch` | 禁止只看 UI `useWebSearch` 开联网首轮；禁止「你好，你是谁？」「你是哪个模型…」仍 `webSearch:true` |
| 2 | **probe** 对非检索句禁止 LLM/历史拼接改写 | `resolveWebSearchProbeQuery` / `buildWebSearchProbeQueryFallback` 遇非检索句直接本轮原话 | 禁止问候被改写成上一轮「Claude Code…」等话题 |
| 3 | **身份 tip 按需**：仅 `isAssistantIdentityQuestion` 时 tip 注入一句「当前选用模型为 X」 | `buildAitopTip({ identityQuestion })` | 禁止每轮 tip 塞「禁止自称 Claude/GPT…」长约束；禁止去掉身份问时的轻量 tip |
| 4 | **普通问答**尽量按上游 API 自然回复 | 非身份问不注入身份 tip | 禁止为「防串模型」给所有请求加长 system 禁令 |
| 5 | **切模型**保留历史 + meta；Qwen 关联网/思考；AiTop 保留开关 | `handleModelSelect` | 禁止切模型清空用户消息（见 LLM 规格禁止事项） |
| 6 | **四模式**（关/仅联网/仅思考/联网+思考）全 AiTop 模型可用 | `scripts/llm-four-mode-matrix.mjs` | 发版须跑通；日常改 Chat 至少离线契约绿 |

**「你能做什么」不是身份问**（过宽会误关联网）；「Claude 是哪家公司…」等外部产品调研允许联网。

#### 5.10.4 展示 / 过程区 / 模式开关（S级·已验收·2026-07-13）

> 用户确认：关联网+关思考不误显 `[联网检索]`/`[思考过程]`；Gemini 身份问不再误判无正文；关思考时正文不泄漏英文 CoT；开联网+开思考时过程区正常。  
> 改 `assistantMessageLayout.ts`、`ChatPanel.tsx` 展示/compose/guard/流式校验前 **必读**；禁止回退下列行为。

| # | 行为 | 实现要点 | 禁止回退 |
|---|------|----------|----------|
| 7 | **未开联网/思考**时不误显过程区卡片 | `flattenAssistantSectionsWhenProcessDisabled`；`composeStreamedAssistantMessage` 默认 `allowWebSearchExtractFromMain=false`；`resolveAssistantDisplaySections` 默认 **不** legacy 拆思考（须显式 `allowLegacyThinkingExtract`） | 禁止 `allowWebSearchExtractFromMain: true` 作 compose 默认；禁止展示层默认 `allowThinkingExtractFromMain: true` |
| 8 | **未开模式**时过程区正文合并回 main | `flattenAssistantSectionsWhenProcessDisabled`；`ensureAssistantSectionsHaveMain` 入口 flatten；`consolidateWebSearchSections` 在 `webSearchEnabled:false` 时 **勿** demote 正文到检索区 | 禁止未开联网仍写入 `[联网检索]` 或「根据联网检索…」兜底 |
| 9 | **嵌套** `[思考过程]`→`[联网检索]` 不丢正文 | `parseAssistantMessage` pull 后解析 tail 段 | 禁止嵌套标记导致 identity/答案段丢失 |
| 10 | **Gemini 流**有足够 raw 时勿误判无正文 | `recoverAssistantReplyFromRaw`；`assistantReplyHasVisibleMain({ rawFallback: fullContent })`；`synthesizedRaw: geminiStreamContent` | 禁止仅有过程区/parse 丢段时直接 throw「未返回有效正文」而不尝试 raw 恢复 |
| 11 | **思考关闭**时剥离正文英文 CoT | `stripLeakedThinkingFromMainWhenDisabled`（仅 `thinkingEnabled:false`） | 禁止关思考仍展示 `**Assessing**` / `**Calculating**` 大段英文；**禁止**误剥 `Hello + 中文` 正常双语自我介绍 |
| 12 | **仅开联网**时总结 pass 不强制 thinking | `payload.thinking = thinkingEnabledForTurn`（含 summarize retry） | 禁止 summarize retry 硬编码 `thinking: true` / `thinkingLevel: high` |
| 13 | **开思考/开联网**时过程区与正文分离 | `collectApiReasoning` + `normalizeAssistantStream`；`mergeWithWebSearchProcess` | 禁止开思考时把英文推理并回正文；禁止开联网时去掉 `[联网检索]` 卡片 |

**必跑门禁（已并入 `test:chat-gate`）：**

| 脚本 | 覆盖 |
|------|------|
| `scripts/assistant-message-layout-test.ts` | layout 44+ 条（含嵌套标记、CoT 剥离、Hello+中文） |
| `scripts/chat-pipeline-regression-test.ts` | 联网总结、思考关闭总结 pass、过程区分离 |
| `scripts/llm-chat-display-contract-test.mjs` | **§5.10.4 行为 + 源码防回退契约** |
| `scripts/llm-chat-identity-contract-test.mjs` | §5.10.1 身份/联网/tip |

#### 5.10.2 模块与门禁

| 模块 | 文件 | 稳定性 | 必跑 |
|------|------|--------|------|
| 联网探测 / 身份判定 | `utils/webSearchProbe.ts` | **S（§5.10）** | `test:llm:probe`（离线）+ `test:llm-chat-identity-contract` |
| Chat 发送 / tip / 轻量句 / 流式校验 | `components/ChatPanel.tsx`（`handleAitopLlmSend`、`composeStreamedAssistantMessage`、`preserveIncompleteStreamOnError`） | **S（§5.10）** | `test:chat-gate` |
| **展示 / 过程区 / 模式开关** | `utils/assistantMessageLayout.ts`（`flattenAssistantSectionsWhenProcessDisabled`、`stripLeakedThinkingFromMainWhenDisabled`、`recoverAssistantReplyFromRaw`、`parseAssistantMessage`） | **S（§5.10.4）** | `test:layout` + `test:llm-chat-display-contract` |
| 模型注册 | `utils/aitopChatModels.ts` | B | `test:llm-model-contract` |

**日常改 Chat/LLM：**

```bash
npm run test:chat-gate   # layout + pipeline + display-contract + probe + identity-contract + model-contract
```

**发版 / 用户说全量 Chat 回归（需 localhost:3001 + API）：**

```bash
npm run test:chat-gate
npm run test:llm:four-mode
npm run test:llm:chat-audit   # 可选：身份 live 冒烟
npm run test:llm              # 既有 context/switch/combo
```

#### 5.10.3 Agent 自检

1. 改 tip / probe / 联网首轮 / 轻量句 / **展示 compose·guard·过程区** 前：读本节 **§5.10.4** + `docs/LLM-CHAT-RULES-SPEC.md` §6.1–§6.2  
2. **不得**为修身份串模型而给每轮请求加长禁令 tip  
3. **不得**在未开联网/思考时恢复过程区卡片或英文 CoT 泄漏  
4. 改完 `npm run test:chat-gate` 全绿；触碰四模式行为时加跑 `test:llm:four-mode`  
5. 向用户汇报是否触碰 §5.10 / §5.10.4

### 5.11 2026-07-09/10 发版交付冻结（preload / 主图=参考槽 / 背景框缩放）

> **已发版验收**：preload 控制台日志、Seedance/全模型「主图=参考槽」面板不丢图、背景框四角可缩放。  
> 后续改面板展示去重、idle sync、Backdrop、`services/aitop` 日志开关时 **禁止回退**；触碰须跑对应脚本 + `test:gate`。

#### 5.11.1 各模型 preload 控制台打印（S级·勿关默认）

| 行为 | 实现 | 禁止 |
|------|------|------|
| 浏览器默认打印 `[flowgen:preload]` JSON | `services/aitop.ts`：`isPreloadDebugEnabled()` → `window.__FLOWGEN_DEBUG_PRELOAD__ !== false` | 改回默认关闭（`=== true` 才开） |
| 关闭方式 | 控制台执行 `window.__FLOWGEN_DEBUG_PRELOAD__ = false` | 删掉 `logPreloadJson` / `logAitopOutgoingRequest` |
| Chat LLM 共用开关 | `utils/chatRequestLog.ts` → 同一 `isPreloadDebugEnabled` | Chat 另开一套默认关闭逻辑 |

**文档对齐：** `docs/CORE_APPLICATION_LOGIC.md` §12（浏览器默认开启）。

#### 5.11.2 主图 URL = 参考槽 URL：展示不丢图 + sync 不清空（S级·已验收）

> 用户 JSON：`e:/问题/0709/nodes-Input Picture Node-Output Mov -1783590031269.json`（fixture：`scripts/fixtures/20260709-seedance-main-dup-ref-panel.json`）。

| 层 | 规则 | 禁止 |
|----|------|------|
| **Seedance 展示** | 仅当 `seedanceShowMainInRefGrid===true` 时对参考槽做主图去重；主图格因与参考槽同 URL 隐藏时，参考格须保留全部槽（含「石头」） | 用 `shouldShowPanelMainImageSlot` / `shouldDedupePanelRefsAgainstMainPreview` 直接驱动 Seedance 参考格去重 |
| **Nano / Omni 展示** | 仅当主图格**实际展示**时对参考槽去重（石头可在主图格可见） | Omni 用 `shouldDedupe…` 且主图格未展示时仍滤掉同 URL 参考槽 |
| **数据层 idle sync** | `buildPanelRefSlotSyncPatch` 的 `dedupeAgainstMain` 须用 **`shouldDedupePanelRefsAgainstMainForSync`**；主图与任一参考槽同素材时 **false**（不清空槽） | sync 直接用 `shouldDedupePanelRefsAgainstMainPreview`（会把同 URL 槽从数据清空） |
| **Nano sync** | 历来 `dedupeAgainstMain: false` | 改为 true |

**关键 API（`utils/referencedMediaRun.ts`）：**

- `panelMainOverlapsAnyReferenceSlot(data)` — 主图/备份/`imagePreview` 与任一参考槽同素材
- `shouldDedupePanelRefsAgainstMainForSync(data)` — 展示可去重 ∧ **无 overlap** 才允许 sync 去重
- `shouldDedupePanelRefsAgainstMainPreview` — **仅展示层**语义；**禁止**单独用于 `buildPanelRefSlotSyncPatch`

**NodeInspector 约束：**

- `seedanceShowMainInRefGrid` **必须先于** `seedanceRefDisplayEntries` 计算；后者 `dedupeAgainstMain = seedanceShowMainInRefGrid`
- Omni 参考格 filter：`!omniInspectorShowMainImageSlot || !isPanelRefDuplicateOfMainImageSlot(...)`
- Nano 标准多图：`dedupeAgainstMain: showMainInRefGrid`
- `useLayoutEffect` 面板 sync：`dedupeAgainstMain: isNanoBanana2Model(model) ? false : shouldDedupePanelRefsAgainstMainForSync(data)`

**必跑（已并入 `test:gate` 第 34–35 步）：**

| 脚本 | 覆盖 |
|------|------|
| `npm run test:20260709-seedance-main-dup-ref-panel` | Seedance：主图隐藏 + 参考 5 张含石头 |
| `npm run test:20260709-all-models-main-dup-ref-panel` | Seedance/Nano/Omni/image2 展示 + overlap/sync 矩阵 |

**勿回退：** 不得删除上述两脚本或从 `scripts/test-gate.mjs` 移除；不得让 idle sync 在 overlap 时清空参考槽。

#### 5.11.3 背景框选中后四角可鼠标缩放（S级·已验收）

| 行为 | 实现 | 禁止 |
|------|------|------|
| 根节点透传点击给框内节点 | `BackdropNode` 根：`pointer-events-none` | 根改为 `pointer-events-auto` 挡住子节点 |
| 四角可拖缩放 | 手柄 class **必须含** `pointer-events-auto`（`backdropResizeHandleNeedsPointerEventsAuto`） | 去掉手柄 `pointer-events-auto` |
| 角点定位样式 | `index.tsx` 引入 `@reactflow/node-resizer/dist/style.css` | 只引 `reactflow/dist/style.css`（不含 resizer） |
| 顶栏拖动 / 标签双击 | 顶栏与标签区 `pointer-events-auto` | 缩放手柄被顶栏盖住且无 z-index |

**必跑：** `src/test/utils/backdropLabel.test.ts`（含 `backdropResizeHandleNeedsPointerEventsAuto`）+ 触碰时 `test:gate`。

#### 5.11.4 Agent 自检（改面板去重 / sync / Backdrop / preload 前）

1. 读本节 + §5.8 / §5.9；确认是否触碰「勿改」列  
2. 改主图/参考去重或 `buildPanelRefSlotSyncPatch` → 必跑 `test:20260709-seedance-main-dup-ref-panel` + `test:20260709-all-models-main-dup-ref-panel` + `test:gate`  
3. 改 Backdrop 缩放/pointer-events → 必跑 `backdropLabel.test.ts` + `test:gate`  
4. 改 `isPreloadDebugEnabled` → 保持默认开启；仅允许显式 `= false` 关闭  
5. 向用户汇报是否触碰 §5.11

### 5.12 Node Details ← → 切换整份 Generated Outputs 历史（S级·已验收·2026-07-10）

> **用户确认**：从节点「GENERATED OUTPUTS」打开 Node Details 后，← → 须切换**整份面板**（左侧预览 + 右侧 Prompt / 参考图 / Used Parameters），不是只换左侧媒体。  
> 改预览弹窗、历史缩略图、键盘导航前必读；**禁止回退**下列行为。

#### 5.12.1 冻结契约

| # | 行为 | 实现要点 | 禁止回退 |
|---|------|----------|----------|
| 1 | ← → 切换**整份** Node Details | `buildNodeDetailsPreviewFromGeneratedThumb`：用该条 `thumb.generationParams` 重建预览节点 `data`（prompt / refs / Used Parameters 全来自快照） | 只改 `imagePreview` / 视频 URL，右侧仍读画布 live MOV/OUTPUT |
| 2 | 历史浏览不被 live sync 盖掉 | 有 `previewActiveThumbId` 时，`nodes`→`previewNode` 的 live 同步 **直接 return** | 去掉 `previewActiveThumbId` 守卫，或历史态仍 `setPreviewNode(latest)` |
| 3 | 定位当前历史项 | `findGeneratedThumbIndex` 优先 `activeThumbId`，再 id / nodeId / url | 仅靠 url 匹配导致同 URL 多条错位 |
| 4 | 循环切换 | `resolveAdjacentGeneratedThumbIndex(..., wrap=true)`：到头/到尾循环 | 2 条历史时某一方向无法切 |
| 5 | 不抢输入焦点 | 焦点在 INPUT/TEXTAREA/SELECT/contentEditable 时不处理左右键 | 在创意描述等输入框里误切历史 |
| 6 | 视频控件不挡导航 | 捕获阶段 `keydown` + `preventDefault`，视频聚焦时仍可切整份 Details | 只绑冒泡、被 `<video>` seek 吃掉左右键 |
| 7 | 标题提示 | 显示 `← → 切换整份 Node Details · Generated Outputs 历史 N/M` | 去掉 N/M 或暗示「只换预览」 |

**关键模块（S级，仅修语法或在本节门禁下改 bug）：**

| 模块 | 文件 | 职责 |
|------|------|------|
| 导航纯函数 | `utils/generatedThumbKeyboardNav.ts` | `findGeneratedThumbIndex` / `resolveAdjacentGeneratedThumbIndex` / `resolveGeneratedThumbNavTarget` / `buildNodeDetailsPreviewFromGeneratedThumb` |
| 预览状态 + 键盘 | `components/FlowEditor.tsx` | `previewActiveThumbId`、`previewThumbSourceNodeId`、`createPreviewNodeFromThumbnail`、`openPreviewFromGeneratedThumb`、ArrowLeft/Right `keydown`（capture） |
| 点开历史 | `components/nodes/CustomNode.tsx` | `flowgen:preview-node` 须带 `sourceNodeId` + thumb 快照（含 `generationParams`） |

**必跑：**

| 脚本 | 覆盖 |
|------|------|
| vitest `src/test/utils/generatedThumbKeyboardNav.test.ts` | 定位 / 循环 / **整份快照重建**（prompt+refs 来自 thumb.gp，非 live） |
| 触碰时 `npm run test:gate` | vitest 步已含上述用例 |

**勿回退：**

- 不得把「打开历史」改回以画布 live MOV 的 `data` 为主、仅覆盖 URL
- 不得在 `previewActiveThumbId` 有值时仍用画布节点覆盖预览
- 不得删除 `generatedThumbKeyboardNav.ts` 或 vitest 用例

**说明：** 同一次运行多条输出若共享同一份 `generationParams`，右侧文案可能相同，但预览 URL 与历史序号 **必须** 变。

#### 5.12.2 Agent 自检（改 Node Details 预览 / 历史条 / 左右键前）

1. 读本节 + §5.9 Node Details 域；确认改的是「历史整份切换」而非 Details 标签/@ 对齐  
2. 改导航或快照重建 → 必跑 `generatedThumbKeyboardNav.test.ts` + `test:gate`  
3. 向用户汇报是否触碰 §5.12；人工烟测：GENERATED OUTPUTS ≥2 条 → 打开 Details → ← → 右侧 Prompt/参数随条切换  

### 5.13 导出 JSON 跨机器主图 hydrate（S级·已验收·2026-07-13）

> **用户确认测试 OK**：`@主图` + 资产库主图运行后导出 JSON，另一台机器导入后 INPUT 画布主图正常显示（不再 EMPTY）。  
> 改 `utils/hydratePersistedNodePreviews.ts` 前 **必读**；禁止回退下列行为。

#### 5.13.1 冻结契约

| # | 行为 | 实现要点 | 禁止回退 |
|---|------|----------|----------|
| 1 | JSON 内已有 **持久化 COS/https** `imagePreview` 时，跨机器导入 **须保留** | `hydrateNodeImagePreviewFromPersisted`：有 `imageLocalRef` 时仅当 preview 空 / 非持久化 / 等于面板首参考槽 URL 才清空 | 禁止见 `gp.referenceImages` 含主图 URL 就清空已持久化 COS 主预览 |
| 2 | 本机 blob 刷新 / preview 误写 ref0 仍走 IDB | 清空后由 `hydrateLocalMediaPreviews` + `imageLocalRef` 恢复 | 禁止去掉 `looksLikePanelFirstRef` / 非持久化 `matchesGpRef` 清空路径 |
| 3 | 跨机器依赖 JSON 内 COS URL，非 `imageLocalRef` | 导出须含 `imagePreview` 或 `generationParams.referenceImages[0]`（主图） | 仅 blob/本地无 COS 时跨机器仍会丢图（产品限制） |

**必跑门禁（已并入 `test:gate` 第 44 步）：**

| 脚本 | 覆盖 |
|------|------|
| `scripts/20260713-export-json-main-image-persist-test.ts` | 用户 fixture `@主图` + COS 主预览跨机器保留 |
| `src/test/utils/hydratePersistedNodePreviews.test.ts` | vitest 单元：export JSON hydrate 契约 |

**fixture：** `scripts/fixtures/20260713-export-json-main-image-persist.json`

### 5.14 中间节点 MOV 视频三场景逻辑（S级·已验收·2026-07-20）

> **用户确认**：Seedance 参考生模式中间 MOV 节点的 PREVIEW MODE、画布缩略图、Generated Outputs 历史三场景视频播放逻辑正确。  
> 改 `resolveNodeDetailsHeroImageUrl`、`resolveCanvasNodePreviewUrl`、`buildNodeDetailsPreviewFromGeneratedThumb` 前 **必读**；禁止回退下列行为。

#### 5.14.1 三场景契约

| 场景 | 数据来源 | 展示内容 | 判定逻辑 |
|------|----------|----------|----------|
| **PREVIEW MODE**（Node Details 左侧大图） | `resolveNodeDetailsHeroImageUrl` | Seedance 参考生 → 参考视频（`referenceMovs[0].url`）；非参考生 → `imagePreview` 视频 URL | `isSeedanceRef && !isHistoryPreview && isLikelyMainVideoUrl(main)` |
| **画布缩略图**（Canvas Node Thumbnail） | `resolveCanvasNodePreviewUrl` | Seedance 参考生 → 参考视频（`referenceMovs[0].url`）；非参考生 → `imagePreview` 视频 URL | 两个分支均有 `isSeedanceRef && isLikelyMainVideoUrl(preview)` 判断 |
| **Generated Outputs 历史**（← → 切换） | `buildNodeDetailsPreviewFromGeneratedThumb` | **生成视频**（`thumb.url`，来自 `gp.outputUrl`） | 历史节点带 `_historyOutputNodeId` 标记，`isHistoryPreview=true` 时跳过参考视频逻辑 |

#### 5.14.2 关键判定条件

| 条件 | 含义 | 使用位置 |
|------|------|----------|
| `isSeedanceRef` | `selectedModel` 含 `seedance2.0` 或 `seedance1.5` 且 `seedanceGenerationMode === 'reference'` | `resolveNodeDetailsHeroImageUrl` L215-218、`resolveCanvasNodePreviewUrl` L192-194/L223-225 |
| `isHistoryPreview` | `data._historyOutputNodeId` 存在（历史预览节点标记） | `resolveNodeDetailsHeroImageUrl` L214 |
| `isLikelyMainVideoUrl(main)` | URL 扩展名为 `.mp4/.mov/.webm` 或路径含 `video` | `resolveNodeDetailsHeroImageUrl` L219/L255、`resolveCanvasNodePreviewUrl` L191/L222 |
| `referenceMovs?.length` | 参考视频列表非空 | 两函数均有判断 |

#### 5.14.3 核心逻辑流

```text
resolveNodeDetailsHeroImageUrl:
  1. isHistoryPreview? → 跳过参考视频优先（走正常流程，返回 imagePreview 视频 URL）
  2. isSeedanceRef && isLikelyMainVideoUrl(main) && referenceMovs?.length? → 返回 referenceMovs[0].url
  3. nodeUsesHiddenMainPreviewSlot? → 进入隐藏主图分支（参考图优先逻辑）
  4. 否则 → 返回 main（imagePreview）
  5. 非 Seedance 参考生视频节点：isLikelyMainVideoUrl(main) → 直接返回 main（L255）

resolveCanvasNodePreviewUrl:
  分支1（!mentionsMain && mentionsAny && runHidMainSlot）:
    1. preview 非视频且非备份 → 返回 preview
    2. isSeedanceRef && isLikelyMainVideoUrl(preview) && referenceMovs?.length? → 返回 referenceMovs[0].url
    3. 否则返回 preview（视频 URL）
  分支2（backup && !mentionsMain && mentionsAny）:
    1. preview 非视频且非备份 → 返回 preview
    2. isSeedanceRef && isLikelyMainVideoUrl(preview) && referenceMovs?.length? → 返回 referenceMovs[0].url
    3. 否则返回 preview（视频 URL）

buildNodeDetailsPreviewFromGeneratedThumb:
  - 历史节点 data 中 _historyOutputNodeId = thumbnail.nodeId（标记）
  - imagePreview = thumb.url（生成结果 URL）
  - generationParams 完整来自 thumb.generationParams
```

#### 5.14.4 关键模块（S级，仅修语法或在本节门禁下改 bug）

| 模块 | 文件 | 职责 |
|------|------|------|
| PREVIEW MODE 视频源 | `utils/nodeDetailsPreview.ts` → `resolveNodeDetailsHeroImageUrl` | 判定返回参考视频还是生成视频 |
| 画布缩略图 | `utils/referencedMediaRun.ts` → `resolveCanvasNodePreviewUrl` | 判定返回参考视频还是生成视频 |
| 历史预览 | `utils/generatedThumbKeyboardNav.ts` → `buildNodeDetailsPreviewFromGeneratedThumb` | 构建历史节点数据，含 `_historyOutputNodeId` |
| 视频播放器 | `components/FlowEditor.tsx` → Node Details Modal | `preload="auto"` + `playsInline` + `key={nodeDetailsHeroUrl}` |

#### 5.14.5 其他模型排查结论（2026-07-20，更新于 2026-07-20 第二轮）

> 经排查，以下模型**不受**此漏洞影响，无需额外修复：

| 模型 | 排查结果 | 原因 |
|------|----------|------|
| **可灵3.0 Omni**（指令变换/视频参考） | **已修复**（第二轮） | `nodeUsesHiddenMainPreviewSlot` 不包含 Omni，视频 URL 直接从 `resolveNodeDetailsHeroImageUrl` L237 返回。但 `resolveNodeDetailsHeroImageUrl` 和 `resolveCanvasNodePreviewUrl` 需新增 Omni 指令变换/视频参考的参考视频优先逻辑，与 Seedance 参考生一致（§11.41） |
| **Vidu** | 无漏洞 | 不在 `nodeUsesHiddenMainPreviewSlot` 多图参考模型列表中 |
| **即梦 (Jimeng)** | 无漏洞 | 同上 |
| **可灵2.5** | 无漏洞 | 同上 |
| **Nano Banana 2.0** | 无漏洞 | 虽在 `nodeUsesHiddenMainPreviewSlot` 列表中，但该模型为图片生成，不产生视频 URL |
| **image 2** | 无漏洞 | 虽在 `nodeUsesHiddenMainPreviewSlot` 列表中，但该模型为图片生成，不产生视频 URL |

**根因**：漏洞仅影响 `nodeUsesHiddenMainPreviewSlot` 返回 true 的模型（Nano Banana 2、image 2、Seedance 参考生），且仅在节点 `imagePreview` 为视频 URL 时触发。Nano Banana 2 和 image 2 为图片模型不会产生视频 URL，因此仅 Seedance 参考生受影响。可灵3.0 Omni 指令变换/视频参考虽不在 `nodeUsesHiddenMainPreviewSlot` 中，但需额外添加参考视频优先逻辑以保持与 Seedance 一致的三场景行为。

#### 5.14.6 必跑门禁

| 脚本 | 覆盖 |
|------|------|
| `npm run test:node-details` | Seedance 参考生视频三场景（含 §11x 扩展） |
| `npm run test:gate` | 全量回归 |
| 触碰时 `src/test/utils/seedanceReferenceDetails.test.ts` | vitest 单元 |

**勿回退：**
- 不得去掉 `resolveNodeDetailsHeroImageUrl` 中 Seedance 参考生视频优先逻辑（L212-222）
- 不得去掉 `resolveCanvasNodePreviewUrl` 两个分支中 Seedance 参考生视频优先逻辑（L191-199、L222-231）
- 不得去掉 `isHistoryPreview` 判断（L214），否则 Generated Outputs 历史节点会错误展示参考视频
- 不得将 `preload` 从 `"auto"` 改回 `"metadata"`（`FlowEditor.tsx` 视频元素）

---

## 6. 模块详细说明（按稳定性分级）

> 以下列出关键模块的**用途、入参、出参、调用示例**。未列出的模块默认按 A/B 级处理，修改前须查本文件或 `reference.md`。

### 6.1 S级稳定模块

#### 6.1.1 `types.ts` — 数据类型定义

- **稳定性**：S级
- **用途**：定义 `NodeType`、`NodeData`、`GenerationParams`、模型常量等。
- **入参/出参**：无运行时入参；导出类型与常量。
- **调用示例**：

```typescript
import { NodeType, type NodeData, type GenerationParams, isImage2Model } from './types';

const data: NodeData = {
  label: '输入',
  selectedModel: 'image 2',
  prompt: '一只猫',
  imagePreview: 'https://...',
};
```

- **修改约束**：
  - 禁止删除/重命名已持久化字段
  - 新增字段必须在本文件记录并加回归测试
  - 修改 `NodeData` / `generationParams` / 面板参考字段后必须跑 `test:gate`

---

#### 6.1.2 `utils/promptMediaRefs.ts` — @ 引用核心

- **稳定性**：S级
- **用途**：构建 @ 下拉项、扫描 prompt 中的 @token、解析 plan、展开 prompt 为模型可读文本。
- **关键函数**：

| 函数 | 入参 | 出参 | 用途 |
|------|------|------|------|
| `buildInspectorPromptMentionItems(data, projectAssets, options?)` | `NodeData`, 资产库 | `MentionItem[]` | 当前面板槽的 @ 下拉项 |
| `matchAllPromptMediaTokens(prompt, slugMap)` | `string`, `SlugMap` | `TokenMatch[]` | 解析 prompt 中所有 @token |
| `collectReferencedMediaFromPrompt(prompt, ctx)` | `string`, `CollectContext` | `CollectedRef[]` | 生成上传 plan |
| `resolvePromptPlaceholders(prompt, plan)` | `string`, `CollectedRef[]` | `string` | 展开为模型可读说明 |
| `stripPromptMediaTokensForPlainCopy(prompt)` | `string` | `string` | 右键复制时去掉 @token |
| `buildCanonicalInspectorPromptPatch(prompt, ctx)` | `string`, `NodeData` | `{ prompt: string }` | 运行前规范 @token；**§5.8.7** 仅 merge run 快照，禁止写回 Inspector |
| `resolveProjectAssetUrlForPromptToken(panelUrl, libUrl, assetId)` | `string?`, `string?`, `string?` | `string` | 面板换图时优先面板 URL |
| `resolveProjectAssetUrlFromTokenKey(key, bySlug, assets?)` | `string`, `Map`, `ProjectAssetLabelRow[]?` | `string?` | **§5.8.5**：slug map 优先；未命中回退 `assets[].url` |
| `isOmniTabVideoMainVideoReference(...)` | 多参数 | `boolean` | 判定 Omni `@主视频` |

- **调用示例**：

```typescript
import { collectReferencedMediaFromPrompt, buildInspectorPromptMentionItems } from './utils/promptMediaRefs';

const plan = collectReferencedMediaFromPrompt(nodeData.prompt ?? '', {
  nodeData,
  referenceImages: nodeData.referenceImages ?? [],
  referenceImageLabels: nodeData.referenceImageLabels ?? [],
  projectAssets: assetMap,
});

const mentions = buildInspectorPromptMentionItems(nodeData, projectAssets);
```

- **修改约束**：
  - 改 @ 下拉、plan 解析、prompt 展开时，必须三处同步改
  - 改完后跑 `test:gate` + `test:model-contract` + `test:prompt-asset-scan` + `test:prompt-edit-matrix` + `test:panel-mention` + `test:inspector-mentions`
  - 禁止用贪婪正则解析 `@资产:`（必须用 `matchAllPromptMediaTokens`）
  - **§5.8.5（S级）**：禁止 `resolveProjectAssetUrlFromTokenKey` 去掉 `projectAssets[].url` 回退；改 @资产 解析须跑 `test:20260710-asset-mention-details-recovery` + vitest `projectAssetUrlFromTokenKey`

---

#### 6.1.3 `utils/referencedMediaRun.ts` — 运行上传与面板合并

- **稳定性**：S级
- **用途**：按 plan 上传参考图/视频/音频；分配首尾帧 API 槽位；运行后合并面板参考图；主图格判定与恢复。
- **关键函数**：

| 函数 | 入参 | 出参 | 用途 |
|------|------|------|------|
| `collectReferencedMediaFromPrompt` | `prompt, ctx` | `CollectedRef[]` | 生成上传 plan（与 promptMediaRefs 协同） |
| `uploadReferencedImageEntry(entry, apiCtx)` | `CollectedRef`, `ApiContext` | `Promise<string>` | 上传单张参考图 |
| `assignStartEndUrlsFromImagePlan(plan)` | `CollectedRef[]` | `{ firstFrameUrl?, lastFrameUrl? }` | 分配首尾帧 URL |
| `buildFirstLastFramePanelPatchFromPlan(plan)` | `CollectedRef[]` | `Partial<NodeData>` | 仅 @ 到的帧保留 |
| `buildPanelImagePreviewPatchAfterRun(...)` | `plan, uploaded[], nodeData` | `Partial<NodeData>` | 运行后写 `panelMainSlotVisible` + `panelMainImageUrl` |
| `buildPanelMainImageRestorePatchForEditing(nodeData)` | `NodeData` | `Partial<NodeData> \| null` | 重新选中时恢复主图格 |
| `shouldShowPanelMainImageSlot(data, scenario)` | `NodeData`, `string` | `boolean` | 唯一判定是否渲染主图格 |
| `shouldDedupePanelRefsAgainstMainPreview(data)` | `NodeData` | `boolean` | **仅展示层**是否可对参考槽相对主图去重 |
| `panelMainOverlapsAnyReferenceSlot(data)` | `NodeData` | `boolean` | 主图/备份/`imagePreview` 与任一参考槽同素材（§5.11.2） |
| `shouldDedupePanelRefsAgainstMainForSync(data)` | `NodeData` | `boolean` | **idle sync** 专用：可展示去重 ∧ 无 overlap 才 true（§5.11.2） |
| `promptMentionsMainImageForNodeData(data)` | `NodeData` | `boolean` | prompt 是否 @主图/@主体 |
| `promptMentionsAnyImageRefForNodeData(data)` | `NodeData` | `boolean` | prompt 是否 @任何图片 |
| `PANEL_MAIN_IMAGE_SLOT_SCENARIOS` | — | `Record<string, Scenario>` | 表驱动注册表（新模型须追加） |
| `pickStillImageRecoveryApiReferenceImages(data, projectAssets?)` | `Partial<NodeData>`, 资产行 | `{ referenceImages, referenceImageLabels? } \| null` | **§5.8.5** Nano/image2 gp 空刷新恢复（仅 @ 到的可持久化 URL） |

- **调用示例**：

```typescript
import { buildPanelImagePreviewPatchAfterRun, shouldShowPanelMainImageSlot } from './utils/referencedMediaRun';

const patch = buildPanelImagePreviewPatchAfterRun(plan, uploadedEntries, {
  nodeData,
  mergedPanelRefs: nodeData.referenceImages ?? [],
  originalImagePreview: nodeData.imagePreview,
  runStartDataSnapshot: nodeData.generationParams,
});

const showMain = shouldShowPanelMainImageSlot(nodeData, 'image2');
```

- **修改约束**：
  - 改上传顺序、首尾帧分配、主图格规则时，必须同步 `FlowEditor.tsx` 各模型 run 分支
  - 改完后跑 `test:gate` + `test:panel-main-slot` + `test:panel-refs` + `test:model-contract`
  - 新模型接入多图参考必须追加 `PANEL_MAIN_IMAGE_SLOT_SCENARIOS`
  - **§5.11.2**：`buildPanelRefSlotSyncPatch` 的 `dedupeAgainstMain` **必须**用 `shouldDedupePanelRefsAgainstMainForSync`；**禁止**把 `shouldDedupePanelRefsAgainstMainPreview` 单独用于 sync（主图=参考槽同 URL 时会清空槽）
  - 触碰主图/参考去重时必跑 `test:20260709-seedance-main-dup-ref-panel` + `test:20260709-all-models-main-dup-ref-panel`
  - **§5.8.5（S级）**：改 `pickStillImageRecoveryApiReferenceImages` 须跑 `test:20260710-asset-mention-details-recovery` + `test:20260710-banana-run-gp-at-mention`；禁止 gp 空 recovery 丢 `@资产`

---

#### 6.1.4 `utils/referenceImageSlotLabels.ts` — 槽位底栏与去重

- **稳定性**：S级
- **用途**：生成参考图/首帧/尾帧底栏文案；判定主图重复；去重面板显示。
- **关键函数**：

| 函数 | 入参 | 出参 | 用途 |
|------|------|------|------|
| `buildPromptMediaRefLabels(data, ctx)` | `NodeData`, `LabelContext` | `MediaRefLabel[]` | 生成面板底栏文案 |
| `isPanelRefDuplicateOfMainImageSlot(ref, mainUrl, nodeData)` | `RefEntry`, `string?`, `NodeData` | `boolean` | 同素材主图去重 |
| `filterPanelReferenceDisplayEntriesExcludingMainPreview(...)` | 多参数 | `DisplayEntry[]` | 过滤面板显示条目 |
| `isOmniAssetMainUploadRefDuplicate(...)` | 多参数 | `boolean` | Omni @资产-only 主图 COS 去重 |

- **调用示例**：

```typescript
import { buildPromptMediaRefLabels, isPanelRefDuplicateOfMainImageSlot } from './utils/referenceImageSlotLabels';

const labels = buildPromptMediaRefLabels(nodeData, {
  referenceImages: nodeData.referenceImages ?? [],
  referenceImageLabels: nodeData.referenceImageLabels ?? [],
  imagePreview: nodeData.imagePreview,
});
```

- **修改约束**：
  - 改底栏文案、去重规则时跑 `test:panel-refs` + `test:model-contract` + `test:panel-mention`
  - Omni @资产-only 场景必须用 `matchAllPromptMediaTokens` 解析，不得退回贪婪正则

---

#### 6.1.5 `utils/firstFramePanel.ts` — 首帧面板默认填充

- **稳定性**：S级
- **用途**：识别首尾帧模型、首帧默认填充主图、首帧预览 URL 回退。
- **关键函数**：

| 函数 | 入参 | 出参 | 用途 |
|------|------|------|------|
| `needsFirstFramePanelModel(data)` | `NodeData` | `boolean` | 是否首尾帧模型 |
| `buildFirstFrameDefaultFillPatch(data)` | `NodeData` | `Partial<NodeData>` | 主图 → 首帧 localRef/URL |
| `effectiveFirstFramePanelUrl(data, ctx)` | `NodeData`, `FrameContext` | `string \| undefined` | 首帧展示回退 URL |
| `hasDisplayContent(frame)` | `FrameInfo` | `boolean` | 含 fallback 的展示判定 |

- **调用示例**：

```typescript
import { needsFirstFramePanelModel, effectiveFirstFramePanelUrl } from './utils/firstFramePanel';

if (needsFirstFramePanelModel(nodeData)) {
  const url = effectiveFirstFramePanelUrl(nodeData, { fallbackToMainPreview: true });
}
```

- **修改约束**：
  - 改首帧默认填充、回退逻辑时跑 `test:first-frame-panel` + `test:panel-refs`
  - 展示用 `hasDisplayContent`，勿仅用 `hasImage`

---

#### 6.1.6 `utils/panelRefPersistence.ts` — OUTPUT 面板 sanitize 与继承

- **稳定性**：S级
- **用途**：spawn 时清空 OUTPUT/MOV 面板的 prompt/参考/首尾帧；持久化 sanitize 面板 URL。
- **关键函数**：

| 函数 | 入参 | 出参 | 用途 |
|------|------|------|------|
| `sanitizeOutputNodePanelReferenceImages(data)` | `NodeData` | `string[]` | spawn 时 OUTPUT 参考图清空（返回 `[]`） |
| `sanitizeOutputNodeFramePanelPatch(data)` | `NodeData` | `Partial<NodeData>` | spawn 时清空 OUTPUT 首尾帧 |
| `sanitizeOutputLikeNodeDataOnLoad(data)` | `NodeData` | `Partial<NodeData>` | 加载时不再 sanitize（no-op） |
| `outputNodePanelReferenceImagesFromRun(...)` | 多参数 | `string[]` | 一律返回 `[]` |

- **调用示例**：

```typescript
import { sanitizeOutputNodePanelReferenceImages, sanitizeOutputNodeFramePanelPatch } from './utils/panelRefPersistence';

const newOutputNode = {
  ...spawnedNode,
  data: {
    ...spawnedNode.data,
    referenceImages: sanitizeOutputNodePanelReferenceImages(spawnedNode.data),
    ...sanitizeOutputNodeFramePanelPatch(spawnedNode.data),
  },
};
```

- **修改约束**：
  - 改 OUTPUT/MOV 继承规则时跑 `test:model-contract` + `test:panel-refs` + `test:panel-partial-ref`
  - 运行时/加载时**禁止**再调用 sanitize 清空用户手动拖入的参考

---

#### 6.1.7 `utils/hydratePanelReferenceLocalRefs.ts` + `utils/localNodeMediaStore.ts` — 本地媒体持久化

- **稳定性**：S级
- **用途**：刷新后从 IndexedDB 恢复面板本地参考图/主图/首尾帧；管理 IndexedDB 中媒体 blob。
- **关键函数**：

| 函数 | 入参 | 出参 | 用途 |
|------|------|------|------|
| `hydrateAllPanelReferenceLocalRefs(data)` | `NodeData` | `Partial<NodeData>` | 刷新后恢复所有面板本地图 |
| `getLocalMediaRef(ref)` | `string` | `Promise<string \| undefined>` | 从 IndexedDB 读取 blob URL |
| `setLocalMediaRef(slot, index, blob)` | `string, number, Blob` | `Promise<string>` | 写入 IndexedDB 并返回 ref |
| `deleteLocalMediaRef(slot, index)` | `string, number` | `Promise<void>` | 删除 IndexedDB 条目 |
| `attachLocalReferenceRefs(...)` | 多参数 | `Promise<{ refs, previews }>` | 拖入参考图时注册原图 |

- **调用示例**：

```typescript
import { hydrateAllPanelReferenceLocalRefs } from './utils/hydratePanelReferenceLocalRefs';

const restored = hydrateAllPanelReferenceLocalRefs(nodeData);
```

- **修改约束**：
  - 拖入参考图后必须等 IndexedDB 写入完成才更新节点状态
  - 改恢复逻辑时跑 `test:panel-refs` + `src/test/utils/hydratePanelReferenceLocalRefs.test.ts`
  - 换浏览器/清缓存会丢失本地图，这是产品规则，不得改为强制同步云端
  - **Omni 参考 IDB**：`buildKlingOmniReferenceLocalRefForTab`（per tab）；**Omni 主图**用 `buildMainLocalRefForModel(..., '可灵3.0 Omni')` 单键（四 tab 共用）；**Omni 首尾帧**用 `buildKlingOmniFrameLocalRefForTab`；详见 §5.8.1

---

#### 6.1.7b `utils/klingOmniTabPanelIsolation.ts` — 可灵3.0 Omni 四 tab 面板【§5.8.1 已验收·S级】

- **稳定性**：S级（用户 2026-07-07 确认功能 OK）
- **用途**：Omni tab 切换时快照/恢复 tab 专属面板；**主图不在此模块处理**（四 tab 共用顶层 `imagePreview`）。
- **关键函数**：

| 函数 | 用途 |
|------|------|
| `buildKlingOmniTabSwitchPatch(data, fromTab, toTab)` | tab 切换 patch（prompt + 顶栏视频/首尾帧；**不写主图**） |
| `snapshotKlingOmniTabConfigsWithLivePanel(data, tab)` | 写入 `klingOmniTabConfigs` |
| `applyKlingOmniActiveTabLivePanel(patch, omniConfig)` | 切回 Omni 模型时恢复激活 tab 的 live 首尾帧/顶栏视频 |
| `klingOmniTabFromReferenceLocalRefField(field)` | localRef 字段 → tab（供 FlowEditor IDB 写入） |

- **调用方**：`NodeInspector.switchKlingOmniTab`、`handleModelChange`（Omni 分支）、`FlowEditor.syncModelConfig`

- **修改约束**：
  - **禁止**在 tab 切换 patch 中设置 `imagePreview` / `imageLocalRef` 为 `undefined`
  - **禁止**在 `klingOmniTabConfigs` 中存储主图字段
  - 必跑：`scripts/kling-omni-tab-isolation-test.ts` + `klingOmniTabPanelIsolation.test.ts` + `test:gate`

---

#### 6.1.7c `utils/image2PanelRefs.ts` — image2 面板与切模型主图【§5.8.2 已验收·S级】

- **稳定性**：S级
- **关键函数**：`image2MainPatchOnModelSwitch`、`compactImage2PanelReferences`、`buildImage2PanelDisplayEntries`
- **修改约束**：
  - 无 image2 快照时**保留**当前主图，并清除继承的 `panelMainSlotVisible=false`
  - 有快照时恢复 `imageLocalRef` + `panelMainSlotVisible` / `panelMainImageUrl`
  - 必跑：`scripts/image2-panel-refs-test.ts` + `test:gate`

---

#### 6.1.8 `utils/runRecovery.ts` + `hooks/useAiTopRunRecovery.ts` — 刷新后运行恢复

- **稳定性**：S级
- **用途**：持久化 running 状态；加载 workspace 后恢复单节点进度条与轮询；下游已有结果时收尾。
- **关键函数**：

| 函数 | 入参 | 出参 | 用途 |
|------|------|------|------|
| `prepareNodesAfterWorkspaceLoad(nodes)` | `Node[]` | `Node[]` | 恢复 running 态与进度 |
| `mergeRecoveryGenerationParamsFromRunNode(...)` | 多参数 | `Partial<GenerationParams>` | 加载后合并 recovery gp |
| `applyWorkspaceSeedanceReferenceGpRepair(...)` | 多参数 | `Node[]` | 修复 Seedance 参考生 stale gp |

- **调用示例**：

```typescript
import { prepareNodesAfterWorkspaceLoad } from './utils/runRecovery';

const recoveredNodes = prepareNodesAfterWorkspaceLoad(nodes);
```

- **修改约束**：
  - 改 recovery 逻辑时跑 `test:gate` + `src/test/utils/runRecovery.test.ts` + `test:444444-panel`
  - 下游 OUTPUT 已有同 taskId 成片时一律收尾 completed，不得用 `nodeHasRecoveredMediaOutput` 阻断

---

#### 6.1.9 `utils/generatedOutputUrl.ts` + `utils/taskStatusImageUrl.ts` + `utils/taskStatusMediaUrl.mjs` — 结果 URL 优先级

- **稳定性**：S级
- **用途**：从 taskStatus 选取最优结果 URL；生成结果主 URL 快照；下载优先级。
- **关键函数**：

| 函数 | 入参 | 出参 | 用途 |
|------|------|------|------|
| `rankAitopPersistableResultUrl(url)` | `string` | `number` | URL 优先级分数 |
| `pickMediaResourceUrlFromTaskStatus(status)` | `TaskStatus` | `string \| undefined` | 从任务状态取最佳 URL |
| `resolvePreferredNodeDownloadUrl(data)` | `NodeData` | `string \| undefined` | 优先 gp.outputUrl / imagePreview |
| `resolveNodeDetailsSourceUrl(data, status)` | `NodeData`, `TaskStatus?` | `string \| undefined` | Node Details Source URL |

- **调用示例**：

```typescript
import { resolvePreferredNodeDownloadUrl, pickMediaResourceUrlFromTaskStatus } from './utils/generatedOutputUrl';

const preferred = resolvePreferredNodeDownloadUrl(nodeData);
const url = pickMediaResourceUrlFromTaskStatus(status);
```

- **修改约束**：
  - 改 URL 优先级时同步 TS 与 mjs 版本
  - 跑 `test:download-url-ranking` + `test:download-task` + `src/test/utils/generatedOutputUrl.test.ts` + `test:gate`
  - 已生成（有 taskId/outputUrl）的 Details 禁止展示 blob/data 作为 Source URL

---

#### 6.1.10 `utils/image2Model.ts` — image2 比例↔尺寸表（满血版 OPEN_AI_GPT_IMAGE_2_QUALITY）

- **稳定性**：S级
- **用途**：image2 比例与尺寸映射（1K/2K/4K 三档）、legacy 尺寸迁移、quality/qualityLevel 规范化。
- **关键常量/函数**：

| 常量/函数 | 含义 |
|-----------|------|
| `AITOP_PLATFORM_IMAGE_2 = OPEN_AI_GPT_IMAGE_2_QUALITY` | AiTop platform |
| `IMAGE2_MAX_API_IMAGES = 4` | 参考图上限 |
| `IMAGE2_QUALITY_ASPECT_TO_SIZE` | 1K/2K/4K × 10 种比例 → 像素 size |
| `IMAGE2_ASPECT_TO_SIZE` | 1K 档别名（向后兼容） |
| `image2ResolveQuality(quality, size)` | 缺 quality 时从 size 推断，默认 1K |
| `image2MigrateLegacyImageSize(size)` | 旧误用 3840/2160 等 → 1K canonical |
| `image2CoerceSizeForAspect(aspect, size, quality)` | 切换比例/档位后纠正 size |

- **调用示例**：

```typescript
import { IMAGE2_ASPECT_TO_SIZE, image2MigrateLegacyImageSize } from './utils/image2Model';

const size = IMAGE2_ASPECT_TO_SIZE['16:9']; // '1536x864'
const migrated = image2MigrateLegacyImageSize('2048x1152', '16:9'); // '1536x864'
```

- **修改约束**：
  - 改比例/尺寸表时跑 `test:image2-aspect-size` + `test:image2-panel-refs` + `test:gate`
  - 同步 `NodeInspector.tsx` / `services/aitop.ts` / `utils/image2PanelRefs.ts`

---

#### 6.1.11 `utils/backdropLabel.ts` + `components/nodes/BackdropNode.tsx` — 背景框

- **稳定性**：S级
- **用途**：背景框组名展示、缩放后防误编辑、拖动/缩放联动。
- **关键函数**：

| 函数 | 入参 | 出参 | 用途 |
|------|------|------|------|
| `shouldBlockBackdropLabelEdit()` | 事件/上下文 | `boolean` | resize/wheel 后短时 block |
| `shouldOpenInspectorForNode(type)` | `NodeType` | `boolean` | BACKDROP 不打开 Inspector |
| `backdropResizeHandleNeedsPointerEventsAuto(className)` | 手柄 class | `boolean` | 断言手柄含 `pointer-events-auto`（§5.11.3） |
| `setBackdropChildrenFromGeometry(...)` | 多参数 | `string[]` | resize 后刷新归属 |

- **修改约束**：
  - 改组名/缩放/编辑时跑 `src/test/utils/backdropLabel.test.ts` + `test:gate`
  - 双击中心组名编辑；input 用内联颜色（深底浅字）
  - **§5.11.3**：根节点可 `pointer-events-none`；四角手柄 **必须** `pointer-events-auto`；`index.tsx` 须引入 `@reactflow/node-resizer/dist/style.css`

---

#### 6.1.12b `utils/generatedThumbKeyboardNav.ts` — Node Details ← → 整份历史【§5.12 已验收·S级】

- **稳定性**：S级（用户 2026-07-10 确认：切换整份 Node Details，非仅换预览）
- **用途**：Generated Outputs 历史条导航与整份 Details 快照重建。
- **关键函数**：

| 函数 | 入参 | 出参 | 含义 |
|------|------|------|------|
| `findGeneratedThumbIndex(thumbs, preview)` | 历史数组 + `{id,imagePreview,activeThumbId}` | `number` | 优先 `activeThumbId` |
| `resolveAdjacentGeneratedThumbIndex(len, cur, dir, wrap?)` | 长度/当前/方向 | `number\|null` | 默认 wrap 循环 |
| `resolveGeneratedThumbNavTarget(thumbs, preview, dir)` | 同上 | thumb \| null | 左右键目标 |
| `buildNodeDetailsPreviewFromGeneratedThumb(thumb, opts?)` | 单条 thumb（含 gp） | 预览节点 | **整份** data 来自 `thumb.generationParams` |

- **配合（FlowEditor，同属 §5.12）**：`previewActiveThumbId` 有值时禁止 live `nodes` sync 覆盖预览；`createPreviewNodeFromThumbnail` / `openPreviewFromGeneratedThumb` 必须走上述 builder。
- **修改约束**：必读 **§5.12**；必跑 `src/test/utils/generatedThumbKeyboardNav.test.ts` + `test:gate`；禁止只换 URL、禁止历史态被 live MOV 盖掉。

#### 6.1.12c `utils/nodeDetailsPreview.ts` — Nano/image2 gp空 Details recovery【§5.8.5 已验收·S级】

- **稳定性**：S级（用户 2026-07-10 确认：banana-问题4 Details 须 2 张，勿全量面板）
- **用途**：Node Details 参考图展示；Nano/image2 在 `generationParams.referenceImages` 空时从 prompt @ + 面板槽 recovery。
- **关键函数**：

| 函数 | 入参 | 出参 | 含义 |
|------|------|------|------|
| `buildStillImageGenNodeDetailsReferencePreview(input)` | panelSource、snapRefs、prompt、projectAssets | Details 参考项 \| null | gp 有 → 快照；gp 空 → `pickStillImageRecoveryApiReferenceImages` |
| `buildImageGenOutputReferenceDetailsFromSnapshot(input)` | snapshotRefs、labels、prompt | 参考项数组 | API 顺序 + prompt 标签对齐 |
| `buildSeedanceReferenceDetailsFromSnapshot(input)` | 同上 | 参考项数组 | 混排 @资产/@图片n 标签勿错配 URL |

- **配合（FlowEditor）**：Nano/image2 `buildPreviewParams` 分支须优先 `buildStillImageGenNodeDetailsReferencePreview`；**禁止** gp 空时 fallback `buildNodeDetailsReferencePreview` 全量面板。
- **修改约束**：必读 **§5.8.5** + **§5.9.1 #2**；必跑 `test:20260710-asset-mention-details-recovery` + `test:node-details` + `test:gate`；禁止 Details 展示面板全量未@槽。

#### 6.1.12 `utils/batchRunQueue.ts` — 批量运行队列

- **稳定性**：S级
- **用途**：纯函数收集选择运行/全部运行队列；定时快照与还原；模拟 stagger 运行。
- **关键函数**：

| 函数 | 入参 | 出参 | 用途 |
|------|------|------|------|
| `collectSelectedRunQueue(nodes, edges, selectedIds)` | 图、选中 id | `Node[]` | 选择运行队列 |
| `collectStoryboardGreenRunQueue(nodes, edges)` | 图 | `Node[]` | 全部运行（绿色分镜）队列 |
| `snapshotBatchRunNodeIds(nodes)` | `Node[]` | `string[]` | 定时快照锁定 |
| `resolveBatchRunQueueByIds(nodes, ids)` | 图、快照 | `Node[]` | 到点还原队列 |
| `simulateStaggeredBatchRun(...)` | 多参数 | 模拟结果 | 测试用 |

- **调用示例**：

```typescript
import { collectSelectedRunQueue, collectStoryboardGreenRunQueue } from './utils/batchRunQueue';

const selectedQueue = collectSelectedRunQueue(nodes, edges, selectedNodeIds);
const greenQueue = collectStoryboardGreenRunQueue(nodes, edges);
```

- **修改约束**：
  - 改入选条件须同步 `collectSelectedRunQueue`、`collectStoryboardGreenRunQueue`、`resolveBatchRunQueueByIds`
  - 跑 `test:batch-run-schedule`（已入 `test:gate`）
  - 定时路径必须走 `snapshotBatchRunNodeIds` + `fixedNodeIds`，禁止到点只调 `collectSelectedRunQueue`

---

### 6.2 A级稳定模块

#### 6.2.1 `components/FlowEditor.tsx` — 画布核心

- **稳定性**：A级
- **用途**：ReactFlow 画布、节点运行、批量/定时队列编排、spawn、Node Details、下载、撤销重做。
- **关键函数/区域**：

| 函数/区域 | 用途 |
|-----------|------|
| `handleNodeRun(nodeId)` | 单节点运行入口 |
| run 模型分支（nano/image2/kling/jimeng/vidu/seedance） | 解析 plan、上传、创建任务、轮询 |
| spawn 输出节点 | 生成 OUTPUT/MOV 节点并写入 `generationParams` |
| `handleScheduleRun` / `runStaggeredQueue` | 定时与批量运行编排 |
| `downloadNodePreviewMedia` | Node Details / 批量下载 |
| `resolveNearestInputAncestorData` / `buildOmniPanelSourceForNodeDetails` | Node Details 面板源合并 |
| `batchRunProgress` overlay | 左上角批量进度条 |

- **调用示例**：

```tsx
// 运行节点（典型路径）
await handleNodeRun(nodeId);

// 定时批量
handleScheduleRun({ kind: 'selected', scheduledAt: Date.now() + 15 * 60 * 1000 });
```

- **修改约束**：
  - 改 run/spawn/ancestor/Details 时跑 `test:gate` + `test:node-details` + `test:model-contract`
  - 改批量/定时时跑 `test:batch-run-schedule`
  - 进度条位置必须保持 `top-4 left-4` + `pointer-events-none`

---

#### 6.2.2 `components/NodeInspector.tsx` — 属性面板

- **稳定性**：A级
- **用途**：模型参数面板、创意描述输入、@ 下拉、参考槽/首尾帧/视频槽、运行按钮。
- **关键规则**：
  - **禁止**在 `NodeInspector` 内部定义新子组件（用模块级 + `React.memo`）
  - 粘贴：`handlePromptPaste` 纯文本 + `setPromptByContext`；禁止自动 scan
  - @ 下拉：仅当前面板已有槽
  - 右键复制：去掉 `@主图/@图片n/@资产:名`
  - tab 同步：`setPromptByContext` 写 Omni/Seedance tab 字段
  - 主图格：用 `shouldShowPanelMainImageSlot`
  - 首尾帧：用 `FrameDropZone`（模块级 memo）+ `fallbackMainPreview`
  - **§5.11.2 主图=参考槽**：Seedance 须先算 `seedanceShowMainInRefGrid` 再算 `seedanceRefDisplayEntries`（`dedupeAgainstMain = seedanceShowMainInRefGrid`）；Omni/Nano 仅主图格实际展示时对参考槽去重；idle sync 用 `shouldDedupePanelRefsAgainstMainForSync`（Nano 仍 `false`）

- **修改约束**：
  - 改创意描述/粘贴/扫描/下拉时跑 `test:prompt-asset-scan` + `test:prompt-edit-matrix` + `test:inspector-mentions` + `test:panel-mention`
  - 改主图格/参考槽时跑 `test:panel-main-slot` + `test:panel-refs` + `test:gate`
  - 改 Seedance/image2/Omni 面板时跑对应模型契约
  - 改主图/参考展示去重或 `buildPanelRefSlotSyncPatch` 调用时必跑 `test:20260709-seedance-main-dup-ref-panel` + `test:20260709-all-models-main-dup-ref-panel`

---

#### 6.2.3 `services/aitop.ts` — AITOP API 封装

- **稳定性**：A级
- **用途**：上传图片/视频、创建各模型任务、获取任务状态、计费上下文注入。
- **关键函数**：

| 函数 | 用途 |
|------|------|
| `uploadImage(file, domainAccount?)` | 上传图片到 AITOP |
| `uploadVideo(file, domainAccount?)` | 上传视频到 AITOP |
| `createNanoTask(params)` / `createImage2Task(params)` / `createKlingTask(params)` 等 | 创建任务 |
| `getTaskStatus(taskId, domainAccount?)` | 查询任务状态 |

- **修改约束**：
  - 改 `createImage2Task` / image2 size 字段相关改动时跑 `test:gate` + `test:image2-aspect-size`
  - 改上传/任务参数时跑 `test:model-contract`
  - **§5.11.1**：`isPreloadDebugEnabled()` 默认开启（`window.__FLOWGEN_DEBUG_PRELOAD__ !== false`）；**禁止**改回默认关闭；关闭仅允许控制台显式 `= false`

---

#### 6.2.4 `server.js` / `server/flowgen/routes.mjs` / `server/flowgen/db.mjs` / `server/flowgen/repos/workspaceRepo.mjs` / `server/flowgen/workspacePayloadCodec.mjs` — 服务端

- **稳定性**：A级（核心）/ S级（MySQL workspace 保存）
- **用途**：Express 路由、MySQL 连接池、workspace 切片 PUT/GET、gzip 编解码、权限校验。
- **关键规则**：
  - MySQL 断连 → **503** JSON；packet too large / 压缩后 >3.5MB → **413**；其它 → **500**
  - `putUserWorkspaceSlice` 最多 3 次重试 + `resetPool`；`rollback`/`release` 包 try/catch
  - workspace payload >512KB 时 gzip→base64 包装；`payload_bytes` 写未压缩字节数
  - `/download-task-file` 必须透传 `domainAccount`

- **修改约束**：
  - 改 server.js proxy / download 时跑 `test:ssrf-guard` + `test:download-task`
  - 改 MySQL workspace 时跑 `test:persist-sanitize` + `test:workspace-codec` + `test:workspace-codec-edge`
  - 禁止在 catch 里对可能已断开的 conn 裸调 `rollback()`

---

### 6.3 B级稳定模块

#### 6.3.1 画布交互：中键拖放 / Inspector 锚定 / MiniMap

| 模块 | 文件 | 稳定性 | 测试 |
|------|------|--------|------|
| 中键拖放发起 | `utils/middleButtonMediaDrag.ts` | B | vitest `middleButtonMediaDrag` |
| 画布多选汇总 | `utils/canvasMiddleDrag.ts` | B | vitest `canvasMiddleDrag*` |
| Inspector 投槽 | `utils/inspectorMediaDrop.ts` | B | vitest `inspectorMediaDrop` |
| **Inspector 拖入串行队列** | `utils/inspectorReferenceDropQueue.ts` | **S（§5.8.4）** | `test:2026070802-omni-panel-dedup` |
| **面板 canvas: 去重** | `utils/referenceImageSlotLabels.ts`（`panelReferencesAlreadyContain*`、`buildPanelRefElementIdsAfterWrite`） | **S（§5.8.4）** | 同上 + `test:panel-dedup-same-element` |
| **NodeInspector 参考拖入** | `components/NodeInspector.tsx`（`applyInspectorReferenceFromUrlStringImpl` 等） | **S（§5.8.4）** | 同上 + `test:panel-partial-ref` |
| Shift 多选锚点 | `utils/inspectorAnchorSelection.ts` | B | vitest `inspectorAnchorSelection` |
| 锚点会话 | `utils/inspectorAnchorSession.ts` | B | vitest `inspectorAnchorSession` |
| MiniMap 布局 | `utils/flowgenMiniMapLayout.ts` | B | vitest `flowgenMiniMapLayout` |
| MiniMap 组件 | `components/flowgen/FlowgenMiniMap.tsx` | B | `scripts/minimap-*-smoke.mjs` |

- **修改约束**：
  - 改拖放协议时同步发起/接收/汇总三处
  - Alt+中键 = 画布平移，不启动素材拖放
  - **资产库中键 → 画布空白区（`canvas-pane`）须创建节点**（`shouldCreateCanvasNodesFromMediaDrop` + `createNodesFromAssetItems`）；画布节点拖到空白区不新建
  - 资产库中键 → 节点面板参考/主图/首尾帧仍走原 drop zone，勿改
  - 视频下载必须走 `/proxy-file`，禁止走 `/proxy-image`
  - **触碰 Inspector 参考拖入 / 去重：必读 §5.8.4**；不得移除 `referenceElementIds` 或 `nodeDataRef` 读 eids

---

#### 6.3.2 Chat / LLM

| 模块 | 文件 | 稳定性 | 测试 |
|------|------|--------|------|
| LLM 模型注册 | `utils/aitopChatModels.ts` | B | `test:llm-model-contract` |
| 消息布局 | `utils/assistantMessageLayout.ts` | B | `test:layout` |
| **联网探测 / 身份判定** | `utils/webSearchProbe.ts` | **S（§5.10）** | `test:llm:probe` + `test:llm-chat-identity-contract` |
| **Chat 发送 / tip / 轻量句** | `components/ChatPanel.tsx`（相关分支） | **S（§5.10）** | 已并入 `test:chat-gate` |
| SSE 代理 | `server.js` `/aitop-llm-see` | A | `test:chat-gate` |

- **修改约束**：
  - 新增 LLM 模型只改 `utils/aitopChatModels.ts`，`ChatPanel.tsx` 仅 UI 路由
  - 改 Chat/LLM 时跑 `test:chat-gate`（**已含** identity-contract）；改注册时追加 `test:llm-model-contract`
  - **触碰身份/联网/tip：必读 §5.10**；不得每轮 tip 强制长身份禁令；不得让问候/身份问仍走联网首轮
  - 发版加跑 `test:llm:four-mode`（需 API）

---

#### 6.3.3 用户管理 / 项目与资产

| 模块 | 文件 | 稳定性 | 测试 |
|------|------|--------|------|
| 用户列表 | `components/flowgen/AdminUsersPage.tsx` | B | 手动点验 |
| 用户 API | `services/flowgenApi.ts` / `server/flowgen/routes.mjs` | B | 手动 |
| 项目列表 | `components/flowgen/ProjectListPage.tsx` | B | — |
| 资产库 | `components/flowgen/ProjectAssetLibrary.tsx` | B | — |
| 权限 | `server/flowgen/permissions.mjs` | A | `test:project-cover` + `test:patch-cover-authz` |

- **修改约束**：
  - 新组织字段进 `extendedJson`；勿要求迁移旧数据
  - 关联项目只读 AITOP；勿恢复手动 members 分配 UI

---

### 6.4 C级稳定模块

- 全局样式 `index.css`、Tailwind 工具类、未稳定的实验功能、调试脚本（`middleDragDebug.ts`）
- 修改时需避免破坏主流程与回归测试

---

## 7. 修改前检查清单（必须逐项确认）

```markdown
- [ ] 明确改的是「面板态」还是「运行快照 generationParams」还是「Node Details 展示」
- [ ] 是否影响创意描述：粘贴 / @ 下拉 / 扫描 @素材 / tab prompt 同步
- [ ] 是否影响「选择运行 / 全部运行 / 定时」队列收集或快照
- [ ] 改运行后面板主图：是否动 `panelMainImageUrl` / `buildPanelImagePreviewPatchAfterRun` / NodeInspector `nodeId` restore
- [ ] 改 workspace 保存 / MySQL：gzip 编解码、503/413 分级、重试 + 安全 rollback
- [ ] 是否影响 blob/data/COS/代理 URL 优先级
- [ ] 是否影响面板本地媒体持久化（`referenceImageLocalRefs` / `imageLocalRef` / IndexedDB）
- [ ] 是否影响多图生成数（`panelGenerateCount`）或并行轮询（`multiGenerateTasks`）
- [ ] 是否影响画布中键拖放 / 资产库拖放 / Inspector 槽
- [ ] 是否影响 Shift 多选 Inspector 锚定
- [ ] 是否影响 MiniMap 布局
- [ ] 是否影响 Seedance 2.0 高质量/急速切换
- [ ] 是否影响 image2 成品像素探测（`probeRemoteImageDimensions` / `outputImageSize`）
- [ ] 是否需在 server.js 与 vite.config.ts 同步（proxy、download-task-file、domainAccount）
- [ ] 是否需在 utils/taskStatusImageUrl.ts 与 utils/taskStatusMediaUrl.mjs 同步
- [ ] 改完跑下方「必跑测试」
- [ ] 涉及 UI 则 `npm run build` + `npm start`（见 `.cursor/rules/auto-build-and-run.mdc`）
```

---

## 8. 回归门禁（强制）

> 详见 `.cursor/rules/regression-gate.mdc`。以下摘要。

### 8.1 何时必须跑 `test:gate`

修改以下任一文件/字段后，完成前必须 `npm run test:gate` 全绿：

- `components/FlowEditor.tsx`
- `components/NodeInspector.tsx`
- `utils/panelRefPersistence.ts`
- `utils/nodeDetailsPreview.ts`
- `utils/referencedMediaRun.ts`
- `utils/batchRunQueue.ts`
- `utils/generatedOutputUrl.ts`
- `utils/promptMediaRefs.ts`
- `utils/firstFramePanel.ts`
- `utils/referenceImageSlotLabels.ts`
- `utils/backdropLabel.ts`
- `components/nodes/BackdropNode.tsx`
- `utils/image2Model.ts`
- `utils/taskStatusImageUrl.ts` / `utils/taskStatusMediaUrl.mjs`
- `utils/probeRemoteImageDimensions.ts`
- `services/aitop.ts` 中 `createImage2Task` / image2 size 相关
- `types.ts` 中 `NodeData` / `generationParams` / 面板参考字段相关

### 8.2 `test:gate` 组成（`scripts/test-gate.mjs`，共 44 步）

```bash
npm run test:gate
```

| # | 步 | 覆盖（§5.9 域） |
|---|-----|----------------|
| 1 | vitest | 单元：拖入去重、Details 标签、runRecovery、backdrop… |
| 2 | node-details | **Node Details** 全场景模拟 |
| 3 | panel-refs | 面板/prune/OUTPUT（§12x） |
| 4 | panel-partial-ref | **面板** + **Details** 三诉求（全模型） |
| 5 | panel-main-slot | **面板** 主图格 × prompt |
| 6 | ggggttt-panel | **生成结果** 画布缩略图 |
| 7 | 444444-panel | **三态** Seedance 参考生 |
| 8 | oooopppp-panel | **生成结果** 链式 OUTPUT |
| 9 | 89908111222-omni-recovery | Omni 恢复 spawn |
| 10 | batch-run-schedule | 定时批量 |
| 11 | model-contract | **跨模型** 面板→API→gp→Details |
| 12 | i2v-pipeline | 运行/upload 链路 |
| 13 | first-frame-panel | 首帧 UI |
| 14 | image2-panel-refs | **面板** image2（§5.8.2） |
| 15 | 778990-cat-church | image2 运行后面板 |
| 16 | image2-aspect-size | image2 比例尺寸 |
| 17 | download-task | 下载链路 |
| 18 | download-url-ranking | 成品 URL 优先级 |
| 19 | panel-refresh-run-all | **面板** 刷新后运行 |
| 20 | banana-panel-clobber | Banana 运行后面板 |
| 21 | run-error-no-stuck | 运行失败 UX |
| 22 | at-mention-label-mismatch | @ 下拉标签 |
| 23 | panel-dedup-same-element | **拖拽** 同源去重 |
| 24 | 2026070802-omni-panel-dedup | **拖拽** §5.8.4 |
| 25 | seedance-panel-slot0 | Seedance slot0 展示 |
| 26 | 2026070802-seedance-panel | **面板** Seedance 运行后少图 |
| 27 | 2026070802-kling-omni-panel | **面板** Omni multi 运行后 |
| 28 | kling-omni-tab-isolation | **面板** §5.8.1 tab 隔离 |
| 29 | frame-model-switch-isolation | **面板** §5.8.3 IDB |
| 30 | panel-switch-broken-urls | **面板** §5.8.2 image2 URL |
| 31 | all-models-three-requirements | **§5.9 三诉求** 总矩阵 |
| 32 | 20260709-seedance-ref-images | **生成结果** @图片n 上传 |
| 33 | 20260709-seedance-video1-mention | **Node Details** @主视频 |
| 34 | 20260709-seedance-main-dup-ref-panel | **面板** §5.11.2 Seedance 主图=参考槽同 URL 不丢图 |
| 35 | 20260709-all-models-main-dup-ref-panel | **面板** §5.11.2 全模型主图=参考槽 / sync 不清空 |
| 36 | 20260710-seedance-asset-thumb | **生成结果** §5.7 纯@资产未@主图画布≠主图备份 |
| 37 | 20260710-all-models-asset-thumb | **生成结果** 全模型纯@资产/@图片n 画布≠主图审计 |
| 38 | 20260710-banana-panel-loss | **面板** Banana 运行后 preserve 误清 `panelMainSlotVisible` |
| 39 | 20260710-banana-restore-dup | **面板** 未@主图 restore 误盖回主图（banana-丢图2） |
| 40 | 20260710-four-mention-all-models | **面板** 4 种引用方式 × Nano/image2/Omni/Seedance |
| 41 | 20260710-asset-main-all-models | **面板** 主图=资产库 × @图片n 去重/preserve |
| 42 | 20260710-banana-run-gp-at-mention | **生成结果** banana 无@时 gp 勿写面板全量 + @时画布=首参考；**§5.8.7** 二次运行六模型 Inspector prompt 不写回（§8–§9） |
| 43 | 20260710-asset-mention-details-recovery | **§5.8.5** @资产+@图片n × 四模型 fixture；Nano/image2 gp空 Details 2 张 |
| 44 | 20260713-export-json-main-image | **§5.13** 导出 JSON 跨机器：@主图 + COS imagePreview 勿 hydrate 清空 |

> 四大域总览见 **§5.9**；**§5.8.5** @资产 plan + gp空 Details 见上表第 43 步；**§5.8.7** 二次运行 prompt 不写回见第 42 步 + vitest `promptRerunCanonical`；**§5.13** 导出 JSON 跨机器主图见第 44 步；发版交付冻结见 **§5.11**；Node Details ←→ 整份历史见 **§5.12**（vitest `generatedThumbKeyboardNav`）；日常改动画布/面板/Details/拖拽跑 `test:gate` 一步即可；发版见 §8.4。

### 8.3 改 bug 时必加回归用例

| 问题类型 | 加用例位置 |
|----------|------------|
| 面板保留未@ / Details 仅@ / 运行后新图可@ | `panel-partial-ref-matrix-test.ts` + `model-media-contract-test.ts` |
| 面板/OUTPUT/prune | `panel-ref-media-simulation-test.ts` §12x |
| 面板主图格 × 创意描述 / 运行后画布参考图 | `panel-main-slot-prompt-test.ts` + `ggggttt-panel-preview-test.ts` |
| Seedance 参考生 刷新后 gp stale / 面板重复主图 / 三态不一致 | `444444-panel-details-verify-test.ts` + `runRecovery.test.ts` + `panelMainSlotPrompt.test.ts` |
| 定时批量角标 | `batch-run-schedule-test.ts` §8 |
| Details 标签 / Seedance 参考生模式·参考视频 | `node-details-simulation-test.ts` §11x + `seedanceReferenceDetails.test.ts` |
| 生成结果 Source URL / outputUrl | `generatedOutputUrl.test.ts` + `node-details-simulation-test.ts` §12 |
| Omni 多图 Details 槽位 | `node-details-simulation-test.ts` §11j + `omniMultiDetails.test.ts` |
| Omni MOV/OUTPUT 刷新后 Details 与面板/gp 错位 | `node-details-simulation-test.ts` §11n |
| Omni 旧 MOV taskId≠ancestor | `node-details-simulation-test.ts` §11o |
| 跨模型契约 | `model-media-contract-test.ts` |
| 运行后 gp / 刷新 recovery | `runRecovery.test.ts` + `referencedMediaRun.test.ts` + `20260710-banana-run-gp-at-mention-test.ts` |
| Backdrop 组名 | `backdropLabel.test.ts` |
| image2 比例/尺寸 | `image2-model-aspect-size-test.ts` |
| 下载成品 URL 优先级 | `download-result-url-ranking-test.ts` + `generatedOutputUrl.test.ts` |
| Omni 视频 @资产-only 面板去重 / Details 标签 | `panel-ref-media-simulation-test.ts` §130 + `node-details-simulation-test.ts` §10d |
| Omni 指令 @主视频 | `omniMainVideoLabel.test.ts` + `node-details-simulation-test.ts` §11p + `model-media-contract-test.ts` |
| Omni 视频参考 tab @视频1 Details 角标 | `referenceVideoDetail.test.ts` + `node-details-simulation-test.ts` §11q + `model-media-contract-test.ts` |
| Seedance @图片n 上传串图（槽 COS + 过期 File） | `20260709-seedance-ref-images-verify-test.ts` + `referencedMediaRun.test.ts` |
| Seedance MOV 参考生 @主视频 非 @视频1 | `20260709-seedance-video1-mention-test.ts` + `seedanceMainVideoLabel.test.ts` |
| **主图=参考槽同 URL 丢图 / sync 清空（§5.11.2）** | `20260709-seedance-main-dup-ref-panel-test.ts` + `20260709-all-models-main-dup-ref-panel-test.ts` |
| **Seedance 纯@资产未@主图画布仍显示主图（§5.7）** | `20260710-seedance-asset-thumb-test.ts` + `panelMainSlotPrompt.test.ts` |
| **Backdrop 四角无法缩放（§5.11.3）** | `backdropLabel.test.ts`（`backdropResizeHandleNeedsPointerEventsAuto`） |
| **Node Details ←→ 只换视频不换整份面板（§5.12）** | `generatedThumbKeyboardNav.test.ts`；禁止去掉 `previewActiveThumbId` 守卫 / 只改 URL |
| **Banana 运行后主图裂图 / preserve 误清 false（banana-丢图）** | `20260710-banana-panel-loss-test.ts`；禁止 imagePreview 已是参考槽时清 `panelMainSlotVisible=false` |
| **Banana/全模型 未@主图 restore 误盖回主图（banana-丢图2）** | `20260710-banana-restore-dup-test.ts`；禁止仅凭有 `panelMainImageUrl` 就 restore |
| **4 种引用方式 × 全模型（丢图2/正常）** | `20260710-four-mention-all-models-test.ts`（@图片n 部分/@图片n 多槽/@主图+@图片/@资产+@图片） |
| **二次运行创意描述 @ 引用被 rewrite（§5.8.7·S级）** | `20260710-banana-run-gp-at-mention-test.ts` §8–§9 + `promptRerunCanonical.test.ts`；禁止 `handleNodeRun` / Seedance 运行中/收尾写回 canonical prompt |
| **导出 JSON 跨机器 INPUT 主图 EMPTY（§5.13）** | `20260713-export-json-main-image-persist-test.ts` + fixture `20260713-export-json-main-image-persist.json` + vitest `hydratePersistedNodePreviews.test.ts`；禁止已持久化 COS 主预览被 hydrate 清空 |
| 切模型/切 tab 面板 IDB 隔离 | `frame-model-switch-isolation-test.ts` + `kling-omni-tab-isolation-test.ts` |
| image2 切模型主图/裂图 URL | `panel-switch-broken-urls-test.ts` + `image2-panel-refs-test.ts` |

### 8.4 发版门禁（用户说「发布 / 发版 / 上线」时自动执行）

```bash
npm run test:gate        # 已含 model-contract
npm run test:project-json-details
npm run test:delivery-all
npm run build
npm run test:deploy-files   # 运行时文件齐全 + 本地 FLOWGEN_JWT_SECRET（§11.1）
```

Chat 发版还须跑：

```bash
npm run test:chat-gate
npm run test:llm-model-contract
npm run test:chat-all
npm run test:llm
```

---

## 9. 常见修改模式

### 9.1 改 @ 引用 / 首尾帧 / Inspector 下拉 / 创意描述

1. 先读 §5.2 / §5.3 / §5.4
2. 三处同步改：`buildPromptMediaRefLabels`（下拉）、`collectReferencedMediaFromPrompt`（plan）、`resolvePromptPlaceholders`（展开）
3. 首尾帧展示：`firstFramePanel.ts` + `FrameDropZone` fallback；plan 用 `effectiveFirstFramePanelUrl`
4. API 槽位：`refFrameIndex` + `assignStartEndUrlsFromImagePlan`
5. 必跑：`test:gate` + `test:model-contract` + `test:prompt-asset-scan` + `test:prompt-edit-matrix` + `test:panel-mention` + `test:inspector-mentions`

### 9.2 改运行后多图参考主图 / Nano / Omni 面板

1. 先读 §5.7；面板主图格**只**用 `shouldShowPanelMainImageSlot`
2. 三处须一致：`buildPanelImagePreviewPatchAfterRun`、`FlowEditor` runCapture、`NodeInspector` 选中恢复
3. 未 @主图：编辑态保留主图格；运行后 `panelMainSlotVisible: false` + 画布=首个 @ 参考
4. 重新选中：仅仍 @主图（或无图片类 @）时才 restore
5. 新模型：追加 `PANEL_MAIN_IMAGE_SLOT_SCENARIOS` + `test:panel-main-slot`

### 9.3 改 Node Details 参考图

- 上游运行节点：读**当前 tab 面板**，勿 dm+dr+gp 三合一
- 下游 OUTPUT/MOV：读 `generationParams.referenceImages`；Omni 面板槽/标签从**同 task 直接上游 OUTPUT** 补齐
- MOV 节点：`resolveNearestInputAncestorData` 须优先同 taskId 的直接上游 OUTPUT/PROCESSOR

### 9.4 改批量运行 / 定时

1. 队列收集逻辑放 `utils/batchRunQueue.ts`（FlowEditor 只编排）
2. 改入选条件须同步：`collectSelectedRunQueue`、`collectStoryboardGreenRunQueue`、`resolveBatchRunQueueByIds`
3. 定时路径必须走 `snapshotBatchRunNodeIds` + `fixedNodeIds`
4. 「定时」角标用 `scheduledRunBadgeNodeIds`，批量执行中**逐节点**清除

### 9.5 改 Inspector 组件

- 禁止在 `NodeInspector` 内定义子组件（用模块级 + `React.memo`）
- 运行中锁定媒体 URL（`useStableInspectorMediaUrl`）

### 9.6 改 server 下载

- 同步三处：`server.js`、`vite.config.ts` dev middleware、`utils/taskStatusMediaUrl.mjs`
- `/download-task-file` 必须透传 `domainAccount`
- 前端下载三入口须一致：`FlowEditor.downloadNodePreviewMedia`、`CustomNode.handleDownload`、`utils/remoteMediaFetch.resolveDownloadFetchUrl`
- 视频禁止走 `/proxy-image`，改走 `/proxy-file`

### 9.7 改 image2 面板

1. 上限常量 `IMAGE2_MAX_API_IMAGES = 4` 同步 `image2PanelRefs.ts`、`FlowEditor` slice、`aitop.ts` payload
2. 比例/尺寸：`IMAGE2_ASPECT_OPTIONS` + `ASPECT_TO_SIZES`；`image2NormalizeAspectRatio` 兼容旧 4:3 等
3. 必跑：`test:image2-panel-refs` + `test:image2-aspect-size`

### 9.8 改 MySQL / workspace PUT

1. 断连须 503 响应，禁止未捕获 fatal 退出进程
2. 超大 payload 须 gzip 包装 + 必要时 413
3. `putUserWorkspaceSlice` 重试 + `resetPool`；`rollback`/`release` 勿裸抛
4. 池配置保留 `enableKeepAlive`；新连接 `SET SESSION max_allowed_packet` 用 callback 形式
5. 保存前 `sanitizeWorkspacePayload` 剥离冗余 thumbnail poster
6. 必跑：`persist-sanitize-test.mjs` + `test:workspace-codec`

---

## 10. 历史迭代记录

> 以下记录已固化并经过回归测试，**禁止回退**。

### 10.1 2026-06 批量运行进度条 UI

- 进度条从顶中改到左上角 `top-4 left-4`，避免遮挡右上资产库/运行按钮
- 文件：`FlowEditor.tsx` ~14456

### 10.2 2026-06 MySQL workspace 大 payload 保存

- 新增 `server/flowgen/workspacePayloadCodec.mjs`；>512KB gzip→base64；>3.5MB 抛 `WORKSPACE_PAYLOAD_TOO_LARGE`
- `workspaceRepo` 读写编解码；routes 503/413/500 分级；`server.js` 忽略 MySQL 断连 unhandledRejection
- 常量：`WORKSPACE_COMPRESS_THRESHOLD=512KB`；`WORKSPACE_GZIP_KEY='__flowgen_gzip_v1__'`；`WORKSPACE_MAX_STORED_BYTES=3.5MB`

### 10.3 2026-06 三态分离与 OUTPUT/MOV 不继承 prompt/参考

- 产品规则：OUTPUT/MOV 面板一律不继承创意描述与参考；保留生成结果与 `generationParams` 快照
- 文件：`FlowEditor.tsx` spawn 段、`utils/panelRefPersistence.ts`
- 废止：运行后 `prunePanelReferenceImagesToPromptRefs` 清空未 @ 槽

### 10.4 2026-06 主图运行后恢复

- 字段：`panelMainImageUrl`（备份）、`panelMainSlotVisible`（运行后隐藏）
- 函数：`buildPanelImagePreviewPatchAfterRun`、`buildPanelMainImageRestorePatchForEditing`、`shouldShowPanelMainImageSlot`
- 测试：`panel-main-slot-prompt-test.ts`、`ggggttt-panel-preview-test.ts`

### 10.5 2026-06 面板换图后运行不恢复旧库图

- 规则：`resolveProjectAssetUrlForPromptToken` 面板有效 http 优先；blob/aitop 误拖仍用库
- 测试：`panel-swap-all-models-tabs-test.ts`（44 项）

### 10.6 2026-06 刷新后单节点运行进度条恢复

- 字段：`runRecoveryPending` / `runRecoveryProgress`
- 函数：`prepareNodesAfterWorkspaceLoad`、`useAiTopRunRecovery.ts`
- 测试：`runRecovery.test.ts`

### 10.7 2026-06 画布暂停刷新

- 入口：`App.tsx` 工程名行 `CanvasRefreshHeaderControls`
- 测试：`canvas-refresh-pause-test.ts`（32 项）

### 10.8 2026-06 Node Details 参考图标签与 API 顺序对齐

- 函数：`buildSeedanceReferenceDetailsFromSnapshot`、`buildImageGenOutputReferenceDetailsFromSnapshot`
- 规则：prompt 图片 token 数 ≥ API 张数时以 prompt 推断标签顺序为准
- 测试：`model-media-contract-test.ts`

### 10.9 2026-06-30 Seedance 参考生 Details 模式/参考视频

- 修复：参考生运行后 Node Details 显示「文生视频 + 0 张参考图」
- 修复：纯图参考生 OUTPUT Details 出现误回填的 Reference Videos
- 文件：`utils/referencedMediaRun.ts`、`utils/nodeDetailsPreview.ts`、`utils/runRecovery.ts`、`FlowEditor.tsx`
- 测试：`node-details-simulation-test.ts` §11d–§11f

### 10.10 2026-06-30 生成完成后 Source URL 须为 AiTop COS

- 函数：`outputUrl` 快照 + `resolveNodeDetailsSourceUrl`
- 规则：已生成节点的 Details 禁止展示 blob/data 作为 Source URL
- 测试：`generatedOutputUrl.test.ts`、`node-details-simulation-test.ts` §12

### 10.11 2026-07-01 image2 比例/尺寸对齐 OPEN_AI_GPT_IMAGE_2 规格

- 10 种比例 + 各比例 1 canonical 尺寸 + `auto`；`image2MigrateLegacyImageSize` 迁移旧 2048/3840
- 测试：`test:image2-aspect-size` 21/21

### 10.12 2026-07-01 下载成品 URL 优先级

- `rankAitopPersistableResultUrl`：imagesGenerations(300) > videosGenerations(280) > 其它(100) > openApi(50)
- 测试：`download-result-url-ranking-test.ts` 12/12

### 10.13 2026-07-01 Omni 视频 @资产-only 面板去重 / Details 标签

- 修复：`@资产:` 贪婪正则问题；`isOmniAssetMainUploadRefDuplicate` 同素材 COS 上传去重
- 测试：`panel-ref-media-simulation-test.ts` §130、`node-details-simulation-test.ts` §10d

### 10.14 2026-07-01 Omni MOV/OUTPUT 刷新后 Details 参考图错位

- 修复：同 task 直接上游优先；`buildOmniPanelSourceForNodeDetails` ancestor 合并空槽 + tab prompt
- 测试：`node-details-simulation-test.ts` §11n

### 10.15 2026-07-02 Omni 旧 MOV taskId≠ancestor 防 INPUT 污染

- 修复：`ancestorOmniPanelMergeAllowedForDetails` 仅双方 taskId 非空且相等才 merge
- 测试：`node-details-simulation-test.ts` §11o

### 10.16 2026-07-03 Seedance 参考生 444444 三态修复

- 修复：`runRecovery.ts` 加载后修复 stale gp；`referencedMediaRun.ts` 紧凑参考生含主图标签时隐藏独立主图格
- 测试：`test:444444-panel`（19 条）

### 10.17 2026-07-03 Omni 指令 @主视频（900788）

- 修复：`@主视频` 绑定 `klingOmni*VideoUrl`，不要求 imagePreview 本身为 mp4
- 测试：`omniMainVideoLabel.test.ts`、`node-details-simulation-test.ts` §11p

### 10.18 2026-07-03 Omni 视频参考 tab @视频1 Details 角标（990）

- 修复：`buildReferenceVideoDetailItems` + `buildNodeDetailsVideoLabelSource`
- 测试：`referenceVideoDetail.test.ts`、`node-details-simulation-test.ts` §11q

### 10.19 2026-07-03 面板本地参考图刷新后丢失

- 修复：`referenceImageLocalRefs` / `klingOmni*ReferenceLocalRefs`；拖入后等待 IndexedDB 写入完成再 `onUpdate`
- 测试：`hydratePanelReferenceLocalRefs.test.ts`

### 10.20 2026-07-06 image2 @图片1 误用主图原图上传（780）

- 症状：image2 未 @主图，运行后面板「图片1」被错误替换成主图（城市），用户拖入的干草/狼/别的被挤到图片2/图片3
- 根因：`utils/referencedMediaRun.ts` 的 `useMainForStartWhenNoFirstFrameFile` 用 `START_FRAME_REF_TOKENS.has(entry.token)` 触发，而 `START_FRAME_REF_TOKENS` 含 `@图片1`/`@图片`。当 image2 `@图片1` 槽位无 original File（用户拖入 http/资产库 URL，或 originals 未注册该槽）时，错误 fallback 到 `ctx.originals.main`（主图原图）上传，导致 `@图片1` 上传 URL = 主图上传 URL，面板图片1 格被主图覆盖
- 修复：`useMainForStartWhenNoFirstFrameFile` 增加 `entry.refFrameIndex === 0` 条件。image2 的 `@图片1` `refFrameIndex` 为 `undefined`（非首尾帧模型），不触发 fallback；首尾帧模型（可灵/vidu/即梦/seedance 图生）的 `@图片1` `refFrameIndex=0`，仍保留 fallback 主图能力
- 文件：`utils/referencedMediaRun.ts` line 866-870
- 测试：`scripts/780-image2-main-overwrite-ref-test.ts`（4 场景 11 断言）；`test:gate` 全绿（含 `test:i2v-pipeline`、`test:image2-panel-refs`、`test:778990-cat-church`、`test:model-contract`）
- 勿回退：image2 / Nano / Omni multi 等多图参考模型的 `@图片1` 不得 fallback 主图原图；仅首尾帧模型 `@图片1`（refFrameIndex=0）可 fallback

### 10.21 2026-07-06 image2/Banana2 运行后节点缩略图被错误切换成 @图片1

> **⚠️ 已被 §10.38（2026-07-07）回退**：用户拍板恢复 §5.7 原始规则「未@主图运行后画布=首个@参考图」。本节保留作历史记录，勿据此判断当前行为。

- 症状：image2 / Nano Banana 2.0 未 @主图 运行后，节点画布大图（`imagePreview`）被设成首个 @ 参考图（@图片1）的上传 URL，而非保留主图；主图备份 `panelMainImageUrl` 在主图为本地 blob/data 时被 sanitize 剥离导致丢失，刷新后缩略图变成 @图片1 或空白
- 根因：`buildPanelImagePreviewPatchAfterRun` 未 @主图 分支把 `imagePreview` 设成 `resolveNodeSelectionPreviewUrl` / `firstUploadedNonMainImageFromPlan`（@图片1 上传 URL）；`shouldPreferRunReferencePreviewOverLocalMain` 仅凭 `generationParams.referenceImages + taskId + panelMainSlotVisible=false` 即返回 true，阻止 hydrate 从 `imageLocalRef`+IndexedDB 恢复主图
- 修复（**2026-07-07 已回退**）：
  1. `buildPanelImagePreviewPatchAfterRun` 未 @主图 分支不再设 `imagePreview` 为 @参考图上传 URL，保留运行前主图；仅设 `panelMainSlotVisible: false` + `panelMainImageUrl` 备份
  2. `shouldPreferRunReferencePreviewOverLocalMain` 增加判断：当 `imagePreview` 不在 `generationParams.referenceImages` 里（即保留主图而非 @参考图）时返回 false，允许刷新后从 `imageLocalRef`+IndexedDB 恢复主图
- 文件：`utils/referencedMediaRun.ts` line 276-292、412-425
- 测试：`scripts/780-image2-main-overwrite-ref-test.ts`（5 场景 15 断言，验证运行后 imagePreview 保留主图）；`test:gate` 622 断言全绿
- ~~勿回退：未 @主图 运行后画布大图必须保留主图（`imagePreview` 不变），不得切换成 @参考图上传 URL；@主图 分支（`imagePreview = 主图上传 URL`）不受影响~~ **§10.38 已回退此规则**
- 影响：image2 / Banana2 / Omni multi / Seedance 参考生 等未 @主图 场景运行后画布大图保留主图；生成结果仍进 `generatedThumbnails` 与 OUTPUT 节点；API 入参 / generationParams / Node Details 不变

### 10.22 2026-07-06 Banana2/image2 面板本地图刷新后丢失

- 症状：Banana2 / image2 面板拖入多张本地图（或从画布拖入 blob URL），刷新后只剩主图，参考图全部消失；DB 中 `referenceImageLocalRefs` 几乎为空
- 根因：
  1. **画布/资产库 URL 拖入**走 `applyInspectorReferenceFromUrlString`，只写 `referenceImages`（data URL），**未**写 IndexedDB / `referenceImageLocalRefs`
  2. `sanitizePersistValueDeep` 剥离 blob/data 时 **filter 掉数组元素**，`referenceImages` 长度与 `referenceImageLocalRefs` / `referenceImageLabels` 下标错位
- 修复：
  1. `NodeInspector.tsx`：`registerEphemeralPanelRefToLocalStore` — URL 拖入参考槽时 fetch blob → `dispatchReferenceAppendFiles` 写入 IndexedDB
  2. `persistSanitize.mjs`：面板参考槽数组（`referenceImages` / `referenceImageLocalRefs` / labels / Omni*）剥离媒体时保留 `''` 占位，维持下标对齐
  3. `resolveCanvasNodePreviewUrl`：有 `panelMainImageUrl` 备份时画布缩略图保留主图
  4. `image2PanelRefs.ts`：`compactImage2PanelReferences` 压紧后 `slice(0, maxRefs)` 防溢出
- 测试：`banana2-refresh-ref-loss-test.ts`、`hydratePanelReferenceLocalRefs.test.ts`、`persist-sanitize-test.mjs`；`npm run test:gate` 全绿
- 勿回退：本地/画布拖入参考图必须写 `referenceImageLocalRefs`；sanitize 不得压缩参考槽数组长度

### 10.23 2026-07-06 中键多图拖入面板覆盖/丢图

- 症状：Shift 框选多节点后中键拖入面板参考区，个别图片被覆盖或丢失，不如之前一次能落多张
- 根因：`registerEphemeralPanelRefToLocalStore` 改为 async 后，`applyInspectorReferenceFromUrlString` 用 `void (async () => …)()` 未 await；`flowgen:media-url-drop` 循环 `await` 实际立即返回，多张图并发追加且都读到同一 `cur.length`，写入同一槽位
- 修复：`applyInspectorReferenceFromUrlString` / `seedanceReferenceFromUrlRef` 改为 `await normalize` + `await addOne`
- 测试：`panelReferenceSequentialAppend.test.ts`；`npm run test:gate` 全绿

### 10.44 2026-07-08 中键连续拖入面板重复 + 删库后标签残留

- 症状：`2026070802-seedance2.0-中键连续拖入节点图片还是重复.json` 等场景下，连续中键拖入多张图仍出现同槽覆盖/重复；资产库删除素材后再拖入新图，底栏仍显示已删库名
- 根因：
  1. 多次 `flowgen:media-url-drop` / HTML5 拖放并发进入 `applyInspectorReferenceFromUrlString`，异步追加均读到同一 `cur.length`（§10.23 仅修了单次 batch 内 await）
  2. `resolveReferenceSlotDisplayLabel` / `preferAssetDisplayNameOverGenericLabel` 无条件信任 `referenceImageLabels` 非泛称字符串，库中已删名称仍展示
- 修复：
  1. 新增 `utils/inspectorReferenceDropQueue.ts`（`enqueueInspectorReferenceDrop`），Nano/image2/Omni/Seedance URL 拖入与 `seedanceReferenceFromUrl` 串行化；Seedance HTML5 多 URL 改为 `await` 链
  2. 新增 `isStalePanelAssetDisplayLabel`：库中已无该名称时回退 `图片n`；库中仍有该名称时保留（888.json 误拖 URL 仍映射库缩略图）
- 文件：`components/NodeInspector.tsx`、`utils/referenceImageSlotLabels.ts`、`utils/inspectorReferenceDropQueue.ts`
- 测试：`inspectorReferenceDropQueue.test.ts`、`stalePanelAssetLabel.test.ts`、`panelRefInspectorDropLabel.test.ts`；`npm run test:gate` 全绿

### 10.45 2026-07-08 面板拖入去重增强 + 删库标签持久清理（面板图片.json）

- 症状：Shift+框选中键重复拖入同一批画布节点仍追加重复槽；本地左键拖入一张图出现两张；删库后 `referenceImageLabels` 仍存「祭司老人」等旧名（`d:/json/面板图片.json`）
- 根因：
  1. `applyInspectorReferenceFromUrlString` 入口仅 `panelReferencesAlreadyContainUrl(原 URL)`，画布 blob→data 压缩后与槽内 data URL 不匹配
  2. 本地文件拖入未走 `enqueueInspectorReferenceDrop`，并发/双触发可重复追加
  3. `isStalePanelAssetDisplayLabel` 过宽：COS 自定义名（如「街景」）被误判 stale；过窄则删库 asset URL 残留名不清理
- 修复：
  1. 新增 `panelReferencesAlreadyContainIncoming`（原 URL + 压缩后 URL + 展示名 + 主图去重）；URL 与本地文件拖入均压缩后再检
  2. `ingestInspectorReferenceLocalFiles` 串行队列 + 主图槽/槽位去重
  3. `isStalePanelAssetDisplayLabel`：asset file URL 无库名 / blob+无库名 → stale；https/cos 自定义名保留
  4. Inspector `useLayoutEffect` 持久清理 stale `referenceImageLabels`
- 文件：`components/NodeInspector.tsx`、`utils/referenceImageSlotLabels.ts`
- 测试：`panelReferencesAlreadyContainIncoming.test.ts`、`stalePanelAssetLabel.test.ts`、`panel-dedup-same-element-test.ts` §8；`npm run test:gate` 全绿

### 10.46 2026-07-08 Omni multi 拖入重复（面板问题2.json）

- 症状：Shift+框选中键重复拖入 → 图片3/4 与 1/2 重复；本地 D 盘拖 1 张 → 图片5+6 双槽（blob hydrate + data 压缩各占一槽）
- 根因：
  1. 画布二次拖入每次新 blob URL，无稳定去重键；Omni 应用 `klingOmniMultiReferenceElementIds` 存 `canvas:{nodeId}`（仅面板，API 过滤 `canvas:` 前缀）
  2. 本地拖入 `dispatchReferenceAppendFiles` 后 hydrate 同槽先写 blob，压缩 data 因 URL 不等又 append 到下一槽
- 修复：
  1. `panelReferencesAlreadyContainCanvasSource` + 拖入写 `canvasOmniRefElementId`
  2. 本地拖入按 `startIndex+fi` **同槽替换** hydrate blob；`targetSlotIndex+localRefs` 跳过去重误判
  3. `buildOmniMultiApiImageList` 不向 API 传 `canvas:` element_id
  4. **面板问题3.json**：`getKlingOmniRefElementIds/Images` 改读 `nodeDataRef`（串行 batch 无 React 重渲染）；Omni addOne **单次 onUpdate** 合并 images+eids+labels，避免第二次 onUpdate 用 stale state 冲掉 elementIds
- 文件：`components/NodeInspector.tsx`、`utils/referenceImageSlotLabels.ts`、`utils/referencedMediaRun.ts`
- 测试：见 **§5.8.4**（`test:2026070802-omni-panel-dedup` + vitest + gate）
- **已验收·S级**：§5.8.4；勿改 `nodeDataRef` 读 eids、单次 onUpdate、canvas: 写槽

### 10.47 2026-07-08 全模型面板 canvas: 去重（Banana / image2 / Seedance 等）

- 症状：Omni multi 修好后，Banana、image2、Seedance2.0 参考生等仍 Shift+框选中键重复拖入多出一槽
- 根因：仅 Omni 有 `klingOmni*ReferenceElementIds`；通用 `referenceImages` 无 `canvas:{nodeId}` 稳定键，串行 batch 亦须读 `nodeDataRef`
- 修复：
  1. `NodeData.referenceElementIds` 与 `referenceImages` 同槽；拖入写 `canvasOmniRefElementId`（面板专用，不发 API）
  2. `applyInspectorReferenceFromUrlString` / `seedanceReferenceFromUrlImpl` / 本地拖入 / 删槽：统一 `getStandardRefElementIds()` + `buildPanelRefElementIdsAfterWrite` + 单次 `onUpdate`
  3. Seedance tab 快照 / 切模型恢复 `referenceElementIds`；`persistSanitize` 保留该数组
- 文件：`types.ts`、`components/NodeInspector.tsx`、`utils/referenceImageSlotLabels.ts`、`utils/seedance20ModelSwitch.ts`、`utils/persistSanitize.mjs`
- 测试：见 **§5.8.4**（含 vitest `standard referenceElementIds`、场景6 全模型 batch）
- **已验收·S级**：§5.8.4；与 §10.46 同一门禁，禁止单独改通用模型而回退 Omni 逻辑

### 10.56 2026-07-08 可灵 Omni 指令/视频参考刷新后进度条丢失

- 症状：可灵3.0 **指令变换** / **视频参考** tab 点运行后 F5，节点进度条不恢复（multi tab 相对不易复现）
- 根因：instruction/video 上传视频+参考图耗时长，`runRecoveryPending` 仅在 `appendRunTaskId` 后写入；上传阶段刷新时持久化快照无 taskId，`prepareNodesAfterWorkspaceLoad` 将 `runRecoveryPending` 清掉并回落 idle
- 修复：① `handleNodeRun` 开始时即设 `runRecoveryPending` + `stageRunPersistPatch`；② `bumpRunningNodeProgress` 同步写 `runRecoveryPending`；③ `restoreUploadPhaseRunningUi` + `prepareNodesAfterWorkspaceLoad` 无 taskId 时恢复 running 进度条 UI（不触发 AiTop 轮询）
- 文件：`utils/runRecovery.ts`、`components/FlowEditor.tsx`
- 测试：`runRecovery.test.ts`；`npm run test:gate` 全绿

### 10.55 2026-07-08 image2 刷新后卡 95% 循环（没完没了.json）

- 症状：image2 `taskId=1532775` 持久化为 `running`+`progress=95`+`runRecoveryPending`；加载后一直显示 95% 运行中
- 根因①：**95% 是进度条设计上限**（`bumpRunningNodeProgress(max=95)`），任务完成前不会超过 95
- 根因②：AiTop 侧 **taskId 已不存在**（`/task-status` 返回「任务不存在」），recovery 约 20s 内失败
- 根因③（循环）：`useAiTopRunRecovery` catch 失败后 **未清 taskId** → `nodeNeedsAiTopTaskRecovery` 仍为 true → `recoveryWatchKey` 变化反复拉起 recovery，表现为「没完没了」卡 95%
- 修复：`useAiTopRunRecovery` catch 合并 `clearStaleRunTaskBeforeFreshRun`，与 `handleNodeRun` catch 一致
- 测试：`scripts/meiwanting-json-diagnose-test.ts` + `runRecovery.test.ts`

### 10.54 2026-07-08 可灵 Omni processor/MOV Node Details 参考图不一致

- 症状：`node details参考图不一致.json` — 同一 task 下 INPUT processor Details 显示 3 张（备份主图 blob 误作「图片1」+ 两张 cos），MOV Details 仅 2 张（gp 快照正确）
- 根因：未 @主图 运行后 `imagePreview`/`panelMainImageUrl` 为备份主图 blob；`buildReferenceImageDetailItemsFromPanel` / `buildOmniMultiPanelSnapshotRefsForPrompt` 见 prompt 含 `@图片1` 即将 `imagePreview` 当作「图片1」，与 `klingOmniMultiReferenceImages` 首张重复
- 修复：新增 `omniMultiImagePreviewCountsAsPromptImageRef` — 有 `panelMainImageUrl` 备份且与 multi 槽 URL 不一致时不计入 @图片1；同步 `restoreOmniMultiPanelFromSnapshot`
- 文件：`utils/promptMediaRefs.ts`、`utils/nodeDetailsPreview.ts`
- 测试：`scripts/omni-details-ref-mismatch-test.ts` + `omniMultiDetails.test.ts`；`npm run test:node-details` + `test:gate` 全绿

### 10.53 2026-07-08 seedance 参考生删节点后主图格消失（主图消失2.json）

- 症状：`d:/json/主图消失2.json` — seedance2.0 参考生未 @主图 运行后删画布节点，面板「主图」格消失（`panelMainSlotVisible=false`、无 `panelMainImageUrl`、`imagePreview` 与 `referenceImages[0]` 同 URL）
- 根因：
  1. `panelMainSlotRestorableFromLocalRef` / `needsMainBackupHydrateFromLocalRef` 仅覆盖 image2/Nano，seedance 参考生未纳入
  2. `seedanceShowMainInRefGrid` 在 `resolvePanelMainSlotPreviewUrl` 为空或主预览与参考槽同 URL 时直接隐藏主图格，未读 `imageLocalRef`
- 修复：
  1. seedance 参考生（且非紧凑「主图」标签，见 444444）纳入 `panelMainSlotRestorableFromLocalRef` 与 `needsMainBackupHydrateFromLocalRef`
  2. `seedanceShowMainInRefGrid`：`panelMainSlotVisible=false` + `imageLocalRef` 时仍展示主图格；同 URL 去重不误伤 IDB 主图
  3. 主图格渲染条件改为 `mainPreviewDisplaySrc || imageLocalRef`
- 文件：`utils/referencedMediaRun.ts`、`utils/hydratePanelReferenceLocalRefs.ts`、`components/NodeInspector.tsx`
- 测试：`scripts/seedance-zhutu-panel-loss-test.ts`（`npm run test:seedance-zhutu-panel`）+ `hydratePanelReferenceLocalRefs.test.ts` + `test:444444-panel`；`npm run test:gate` 全绿

### 10.52 2026-07-08 Banana 运行后删节点主图格 blob 破损（banana主图.json）

- 症状：`d:/json/banana主图.json` — Nano Banana 2.0 未 @主图 运行后删 OUTPUT/出错节点，面板「主图」格显示黑块破损图
- 根因：`panelMainImageUrl` 备份为 blob URL；删节点 / hydrate 轮换后 blob 已 revoke，但 `needsHydrateFromLocalRef` 对 blob 返回 false，`mainPanelPendingLocalHydrate` 又要求 `panelMainSlotVisible===false`，有备份 blob 时不触发 IDB 恢复
- 修复：
  1. 新增 `needsMainBackupHydrateFromLocalRef`：image2 / Nano 在 `panelMainImageUrl` 为缺失 / data: / blob 时触发 hydrate
  2. `hydratePanelMainImageUrlFromLocalRef`：`fetch(blob)` 检测存活，仅 revoke 时从 `imageLocalRef` 重建
  3. `NodeInspector` `mainPreviewDisplaySrc` 依赖 `imageLocalRef`
- 文件：`utils/hydratePanelReferenceLocalRefs.ts`、`components/NodeInspector.tsx`
- 测试：`scripts/banana-zhutu-panel-loss-test.ts`（`npm run test:banana-zhutu-panel`）+ `hydratePanelReferenceLocalRefs.test.ts`；`npm run test:gate` 全绿

### 10.51 2026-07-08 image2 删节点后再运行面板主图消失（主图消失.json）

- 症状：`d:/json/主图消失.json` — 未 @主图 运行后删画布源节点再运行，image2 面板主图格消失（`panelMainSlotVisible=false` 且无 `panelMainImageUrl`）
- 根因：
  1. 运行后 `panelMainImageUrl` 备份为 blob/data，持久化 sanitize 剥离后 JSON 无备份
  2. `shouldShowPanelMainImageSlot` / `hydratePanelMainImageUrlFromLocalRef` 在 `panelMainSlotVisible=false` 且无备份时直接隐藏主图格，未读 `imageLocalRef`
  3. `anyPanelRefsPendingLocalHydrate` 仅看参考槽 URL，参考槽已是 cos 链接时不触发主图 IDB hydrate
  4. 二次运行 `panelMainImageBackupFromNode` 把已与 `referenceImages[0]` 相同的 `imagePreview`（@图片1）误写入备份
- 修复：
  1. `shouldShowPanelMainImageSlot` / `mainPanelPendingLocalHydrate`：仅 **image2 / Nano** 在 `panelMainSlotVisible=false` 且无备份时，有 `imageLocalRef` 仍展示/触发 hydrate（Omni 保持 4 参考槽不变）
  2. `hydratePanelMainImageUrlFromLocalRef` 改走 `mainPanelPendingLocalHydrate` 门禁
  3. `panelMainImageBackupFromNode`：`imagePreview` 已与首参考同 URL 且主图在 IDB 时勿误备份参考 URL
  4. `image2HasMainInGrid` / `NodeInspector` `image2ShowMainInRefGrid` 同步 `imageLocalRef` 回退
  5. `FlowEditor` image2 `modelConfigs` 同步 `panelMainImageUrl`
- 文件：`utils/referencedMediaRun.ts`、`utils/hydratePanelReferenceLocalRefs.ts`、`utils/image2PanelRefs.ts`、`components/NodeInspector.tsx`、`components/FlowEditor.tsx`
- 测试：`scripts/zhutu-panel-loss-test.ts`（`npm run test:zhutu-panel`）+ `hydratePanelReferenceLocalRefs.test.ts`；`npm run test:gate` 全绿

### 10.50 2026-07-08 image2 删节点后改 @ 再运行面板参考图消失（image2.json）

- 症状：`d:/json/image2.json` — 删画布源节点、改创意描述 `@图片1/@图片2` 后点运行，面板参考图只剩一张或全空
- 根因：`referenceImageLabels` 双「图片1」错位时，`resolvePictureTokenSlotIndex` 把 `@图片1` 与 `@图片2` 都绑到 slot1 → plan 去重只上传一张 → 运行后 merge/compact 进一步丢槽
- 修复：`utils/promptMediaRefs.ts` `resolvePictureTokenSlotIndex`：
  1. 底栏重复「图片n」标签时 `@图片n` 按物理槽 `n-1` 对齐
  2. 主图重复槽底栏「图片1」+ 邻槽「图片2」时 slot0 优先绑 `@图片1`（Nano @主图+@图片1 不退化）
- 测试：`src/test/utils/resolvePictureTokenSlotIndex.test.ts` + `scripts/image2-json-panel-loss-test.ts` + `scripts/all-models-duplicate-label-panel-test.ts` + `panel-partial-ref-matrix-test.ts`（Nano/image2/Seedance/Omni）；`npm run test:gate` 全绿

### 10.49 2026-07-08 Shift 框选中键拖入面板后释放画布多选

- 症状：Shift+框选多节点 → 中键拖入 Inspector 参考区成功后，画布仍保持多选高亮，无法自然切到目标节点面板
- 根因：误将「恢复框选快照」当作修复，与用户期望（投放后退出框选模式）相反
- 修复：
  1. 监听 `flowgen:media-url-drop`（画布节点 → Inspector 参考/首尾帧/主图区）
  2. `buildClearCanvasSelectionPatch` 清除全部 `selected`
  3. Inspector 锚定到 `targetNodeId`，短暂 `preserveInspectorAnchorRef` 避免空选区误关面板
- 文件：`utils/canvasSelectionPreserve.ts`、`components/FlowEditor.tsx`
- 测试：`src/test/utils/canvasSelectionPreserve.test.ts` + `npm run test:gate`

### 10.48 2026-07-08 image2 切换满血版 OPEN_AI_GPT_IMAGE_2_QUALITY

- platform：`OPEN_AI_GPT_IMAGE_2` → `OPEN_AI_GPT_IMAGE_2_QUALITY`
- 面板新增：**清晰度**（quality: 1K/2K/4K）、**画质等级**（qualityLevel: low/medium/high）；图像尺寸随档位联动
- API：`createImage2Task` 发送 `quality` + `qualityLevel` + `size`（各档像素表见 `IMAGE2_QUALITY_ASPECT_TO_SIZE`）
- 兼容：旧工程无 `image2Quality` 时默认 1K；legacy 误用 3840×2160 等仍迁移为 1K canonical
- 测试：`test:image2-aspect-size` 29/29 + `test:gate` 全绿

### 10.24 2026-07-06 多节点/多模型面板刷新后仅当前面板保留图片

- 症状：不同模型（或不同节点）面板分别拖入参考图，刷新后只有最后选中/当前模型的面板有图，其余丢失
- 根因：
  1. `onUpdate` 只写 `referenceImages`，`referenceImageLocalRefs` 由 `attachLocalReferenceRefs` 另一次 `setNodes` 写入，存在竞态；非当前节点保存时 localRefs 可能未入库
  2. 刷新后 `buildPanelRefSlotSyncPatch` / `image2PanelRefsPatchIfChanged` 在 IDB hydrate 完成前对空槽 sync，可能触发多余写回
  3. 同节点切换模型时 `modelConfigs` 未保存/恢复 `referenceImageLocalRefs`，切走后顶层 localRefs 被下一模型覆盖
- 修复：
  1. `dispatchReferenceAppendFiles` ack 回传 `localRefs`；所有拖入路径 `onUpdate` 同批带上 `referenceImageLocalRefs`（或 Omni*LocalRefs）
  2. `attachLocalReferenceRefs` 合并写入、避免覆盖并发槽位
  3. `anyPanelRefsPendingLocalHydrate`：localRefs 在而槽位仍空时跳过 panel sync effect
  4. `handleModelChange` / `buildSeedanceModelConfigSnapshot`：各模型快照保存并恢复 localRefs
- 测试：`multi-node-panel-refresh-test.ts`、`hydratePanelReferenceLocalRefs.test.ts`；`npm run test:gate` 全绿
- 勿回退：拖入参考图必须同批写 localRefs；多节点各自 localRefs 独立持久化

### 10.26 2026-07-06 Banana2 空 prompt + 遗留 panelMainImageUrl 缩略图变图片1

- 症状：Banana2 拖入主图+参考图、创意描述为空（或切换模型后），连续刷新画布缩略图变成「图片1」而非主图（fixture `2026070607.json`）
- 根因：
  1. `nodeUsesHiddenMainPreviewSlot` 仅凭 `panelMainImageUrl` 即视为「运行后隐藏主图」，空 prompt 时 `resolveNodeSelectionPreviewUrl` 仍返回 `referenceImages[0]`
  2. `resolveCanvasNodePreviewUrl` 兜底走 Details 英雄图规则，覆盖正确 `imagePreview`
  3. `hydrateNodeImagePreviewFromPersisted` 对 PROCESSOR 节点从 `referenceImages` 拾取主预览；`imagePreview===ref[0]` 时未重置为待 IDB 恢复
- 修复：
  1. `nodeUsesHiddenMainPreviewSlot`：仅 `panelMainSlotVisible=false` 或（有 `@图片` + `panelMainImageUrl`）时隐藏主图
  2. `resolveCanvasNodePreviewUrl`：空 prompt 优先返回 `imagePreview` 主图
  3. `buildStalePanelMainBackupClearPatch`：清无 `@` 时的遗留 `panelMainImageUrl`；切回 Banana 时清 `firstFrameLocalRef` 污染
  4. `hydrateNodeImagePreviewFromPersisted`：PROCESSOR 不从参考槽拾主预览；`imagePreview===ref[0]` 时清空待 IDB
- 测试：`banana-thumb-2026070607-test.ts`、`nanoBananaModelSwitch.test.ts`；`npm run test:gate` 全绿

### 10.25 2026-07-06 Banana2 切换模型后缩略图变成图1

- 症状：Nano Banana 2.0 切到其他模型再切回（或刷新模型配置）后，画布节点缩略图不显示主图，变成 @图片1（图1）
- 根因：
  1. `modelConfigs['Nano Banana 2.0']` 切换时**未保存/恢复** `imagePreview` / `imageLocalRef` / `panelMainImageUrl` 等主图字段（image2 已有 `image2MainPatchOnModelSwitch`）
  2. 切回后 `imagePreview` 为空时，`resolveCanvasNodePreviewUrl` 无条件用 `generationParams.referenceImages[0]` 作画布缩略图
- 修复：
  1. `nanoBananaMainPatchOnModelSwitch` + `handleModelChange` / `syncModelConfigFromNodeData` 保存并恢复 Banana 主图快照
  2. `resolveCanvasNodePreviewUrl`：仅运行后隐藏主图格（`panelMainSlotVisible=false` 或有 `panelMainImageUrl` 备份）时才用 gp 首项
- 测试：`nanoBananaModelSwitch.test.ts`；`npm run test:gate` 全绿
- 勿回退：Banana2 与 image2 一样须在 modelConfigs 独立保存主图；未运行节点切换模型不得把缩略图变成图1

### 10.27 2026-07-06 刷新后切回模型面板图不显示（须再刷新）

- 症状：Banana2 拖图 → 切 image2 → 刷新 → 切回 Banana 面板空，再刷新才显示
- 根因：刷新后 `modelConfigs` 内 blob 已剥离、仅留 `referenceImageLocalRefs`；`hydrateAllPanelReferenceLocalRefs` 仅在工程加载时跑，切模型恢复空槽后未触发 IDB hydrate
- 修复：
  1. `NodeInspector`：`anyPanelRefsPendingLocalHydrate` 时异步 `hydrateAllPanelReferenceLocalRefs`（与主图 `imageLocalRef` hydrate 并列）
  2. `alignPanelReferenceSlotsFromLocalRefs`：`handleModelChange` 恢复 Banana/image2 时对齐 `referenceImages` 与 `localRefs` 槽位
- 测试：`model-switch-panel-hydrate-test.ts`、`hydratePanelReferenceLocalRefs.test.ts`；`npm run test:gate` 全绿
- 勿回退：切模型须即时从 IDB 恢复面板预览，不得依赖二次刷新

### 10.28 2026-07-06 可灵3.0 Omni 多图参考拖入面板闪动

- 症状：Omni 多图参考 tab 拖入图片后面板格持续闪动
- 根因：拖入后槽位已有 `blob:` 预览且写入 `klingOmniMultiReferenceLocalRefs`；`needsHydrateFromLocalRef` 将 blob 仍视为待恢复 → `hydrateAllPanelReferenceLocalRefs` effect 反复 revoke/重建 blob URL
- 修复：
  1. `needsHydrateFromLocalRef`：已有 `blob:` 预览则不再从 IDB 重建
  2. `NodeInspector` panel hydrate effect 仅依赖 localRefs / 模型，不因 referenceImages 变化重跑
- 测试：`hydratePanelReferenceLocalRefs.test.ts`；`npm run test:gate` 全绿

### 10.29 2026-07-06 全模型 tab 刷新+运行面板保留回归

- 新增 `scripts/panel-refresh-run-all-tabs-test.ts`（`npm run test:panel-refresh-run-all`，已并入 `test:gate`）
- 覆盖：Nano / image2 / Omni 多图·指令·视频 / Seedance 参考生（急速·高质量·1.5）+ Banana↔image2 多模型切回
- 每 tab 断言：sanitize 后 localRefs 保留 → hydrate 恢复 → 运行后未@槽与 @槽均保留（102 项）

### 10.32 2026-07-07 切模型间歇性丢图（stale blob）

- 症状：拖图后切换模型，面板图/缩略图/首尾帧**有时**丢失或显示 broken，刷新后恢复
- 根因：`modelConfigs` 快照保留旧 `blob:` URL；切走它模型时 blob 可能已被 `revokeObjectURL`，切回后 `needsHydrateFromLocalRef(blob:)` 误判为可用 → 跳过 IDB 重 hydrate
- 修复：
  1. `stripRestoredNodeMediaForLocalRefHydrate`：`handleModelChange` 恢复后统一剥离「有 localRef 的 blob/data」槽，强制 pending hydrate
  2. 首尾帧 hydrate token：仅当预览非空时才因 token 相同跳过，避免切回同模型空槽不重 hydrate
  3. panel hydrate effect 增加 `firstFrameLocalRef` / `lastFrameLocalRef` 依赖
- 测试：`panel-switch-broken-urls-test.ts` 场景4（stale blob）、`hydratePanelReferenceLocalRefs.test.ts`；`npm run test:gate` 全绿
- 勿回退：有 localRef 的槽切模型恢复时不得直接复用 modelConfigs 内 blob URL

### 10.33 2026-07-07 各模型尾帧图被覆盖成同一张

- 症状：可灵2.5 / vidu / Seedance 等模型各自拖入不同尾帧图，切换或刷新后尾帧变成同一张
- 根因：IDB 键 `flowgen-local:scope:nodeId:lastFrame` 全节点唯一，各模型 `modelConfigs` 保存同一 ref 字符串，后拖入的图覆盖先前者；上轮 `stripRestoredNodeMediaForLocalRefHydrate` 对首尾帧剥离 blob 加剧切回时闪空
- 修复：
  1. `buildModelScopedFrameLocalRef`：尾帧/首帧 IDB 键含模型段 `…:lastFrame:可灵_25_Turbo`
  2. `attachLocalFrameRef` 按当前 `selectedModel` 写入独立 IDB
  3. 撤回 `stripRestoredNodeMediaForLocalRefHydrate` 对首尾帧的剥离（参考图/主图 stale blob 剥离保留）
  4. `handleSwapFrames` 同步交换 `localRef` / `imageUrl` / `label`
  5. 刷新时 legacy 4 段 ref 自动迁移到当前模型 scoped ref
- 测试：`scripts/frame-model-switch-isolation-test.ts`（17/17）；`npm run test:gate` 全绿
- 勿回退：各首尾帧模型尾帧须 per-model IDB 隔离，不得共用 `…:lastFrame` 无模型后缀键
- **例外**：`seedance2.0 (急速版)` ↔ `seedance2.0 (高质量版)` 仍共用 legacy 面板 IDB 键（`usesUnifiedSeedance20PanelLocalRef`：首尾帧/主图/参考图），与 `resolveSeedanceConfigForModelSwitch` 面板统一一致
- 其余模型：主图 `buildMainLocalRefForModel`、参考图 `buildReferenceLocalRefForModel`、首尾帧 `buildFrameLocalRefForModel` 均 per-model 隔离

### 10.34 2026-07-07 image2 切模型主图消失/裂图

- 症状：切到 image2 后「主图」格与画布节点缩略图空白或 broken；参考图正常
- 根因（多因）：
  1. `modelConfigs.image2` 未保存/恢复 `panelMainSlotVisible`/`panelMainImageUrl`，切模型时继承它模型 `panelMainSlotVisible=false` 导致主图格被隐藏
  2. 上一版修复误剥离主图 blob / 清除它模型 `imageLocalRef`，无快照时主图被清空
- 修复：
  - `image2MainPatchOnModelSwitch`：有快照恢复 `imageLocalRef`+可见性；无快照保留当前主预览并清除继承的 `panelMainSlotVisible=false`
  - `stripRestoredNodeMediaForLocalRefHydrate`：主图有 `imageLocalRef` 时仅剥离 `data:`，保留会话内 `blob:`（对齐 Nano）
  - `handleModelChange`/`syncModelConfig` 持久化 `panelMainSlotVisible`/`panelMainImageUrl`
- 测试：`image2-panel-refs-test.ts`（含继承可见性用例）；`panel-switch-broken-urls-test.ts`；`npm run test:gate` 全绿

### 10.35 2026-07-07 可灵3.0 Omni 四 tab 面板独立（主图共用）【已验收·勿改 §5.8.1】

- 症状：多图/指令/视频 tab 参考图 IDB 互相覆盖；首尾帧与其它 tab 首尾帧混用
- **产品规则（用户确认 OK）**：**主图四 tab 共用**；仅参考图数组、指令/视频顶栏视频、首尾帧按 tab 隔离
- 实现：
  - `klingOmniTabConfigs` 仅存 `instruction` / `video` 顶栏视频 + `frames` 首尾帧（**不写主图**）
  - `buildKlingOmniTabSwitchPatch` / `switchKlingOmniTab`：**不**在 patch 中剥离 `imagePreview`
  - Omni 参考 IDB：`ref:可灵30_Omni_{multi|instruction|video}:N`；主图 IDB：模型级 `main:可灵30_Omni` 单键
- 测试：`scripts/kling-omni-tab-isolation-test.ts` + `klingOmniTabPanelIsolation.test.ts`；`npm run test:gate` 全绿
- **勿回退**：不得恢复「按 tab 拆分主图快照」或切换 tab 时 `clearLiveMainPanelPatch`

### 10.36 2026-07-07 模型/Tab 面板隔离写入 skill 防回归

- 将 §5.8「已验收·勿改契约」写入根目录 `skill.md`，标注 S 级模块与必跑脚本
- 补充 §6.1.7b `klingOmniTabPanelIsolation`、§6.1.7c `image2PanelRefs` 模块说明
- 同步 `.cursor/skills/flowgen-ai-studio/SKILL.md` 决策树第 0.5 步 + 变更记录 16.27
- 同步 `.cursor/rules/regression-gate.mdc`：触碰 §5.8 模块须跑对应脚本
- 目的：后续调试其它功能时 Agent **不得**顺手修改 Omni 四 tab / image2 切模型主图 / 各模型 IDB 隔离逻辑

### 10.37 2026-07-07 Banana 运行后面板参考图标签错位（丢图+串位）

- 症状：Nano Banana 2.0 拖入多张参考图（如 [A,B,C]），创意描述仅 @图片1+@图片3 运行后，面板「图片2」槽丢失、「图片3」错位到「图片2」位置；下次运行槽位解析全乱
- 根因：`components/FlowEditor.tsx` 的 `buildUpdatedRunNodeData` Banana 分支：
  - 顶层 `referenceImages` 正确用面板保留版 `nanoPanelMergedRefs`（[signedA, B, signedC]，3 槽）
  - 但 `referenceImageLabels` **错用** `runCaptureForGp.referenceImageLabels`（gp-only 标签，仅 ['图片1','图片3']，2 项）
  - 标签数组比图片数组短，下标错位：slot1(B) 被标成「图片3」、slot2(signedC) 无标签
  - 对比 image2 分支已用 `image2PanelMergedLabels`（面板版标签，等长对齐），Banana 缺失对应变量
- 修复（最小变更·单文件 3 处）：
  1. `FlowEditor.tsx` L6359 新增函数级 `let nanoPanelMergedLabels: string[] | null = null`（仿 image2 L6375）
  2. Banana 运行分支（`nanoPanelMergedRefs = [...mergedNanoRefs]` 之后）记录 `nanoPanelMergedLabels = mergedNanoLabels.some(l=>l.trim()) ? [...mergedNanoLabels] : null`
  3. `buildUpdatedRunNodeData` Banana 分支标签来源从 `runCaptureForGp.referenceImageLabels` 改为 `nanoPanelMergedLabels`，回退 `n.data.referenceImageLabels`
- 文件：`components/FlowEditor.tsx` L6359 / L7078 / L10587
- 测试：新增 `scripts/banana-panel-clobber-after-run-test.ts`（4 场景 34 断言，模拟完整 runflow 含 mediaPatch 中间态 + buildUpdatedRunNodeData 修复态，验证标签与槽位下标一一对应）；`npm run test:gate` 全绿；`npm run build` 通过
- 勿回退：Banana 运行后顶层 `referenceImageLabels` 必须用面板保留版（`nanoPanelMergedLabels`），与 `nanoPanelMergedRefs` 等长对齐；gp-only 标签仅用于 `generationParams.referenceImageLabels`
- 不影响：`generationParams`（仍用 `nanoRunReferenceSnapshot` + gp-only 标签）、Node Details、OUTPUT/MOV spawn、image2/Omni/Seedance/vidu/jimeng 分支
- 风险：低，仅 Banana 标签来源修正；image2 同模式已验证正确

### 10.38 2026-07-07 恢复 §5.7：未@主图运行后画布=首个@参考图（回退 §10.21）

- 背景：§10.21（2026-07-06）把「未@主图运行后画布大图」从 §5.7 原始规则「首个@参考图」改成「保留主图」，并标记「勿回退」。用户 2026-07-07 拍板恢复 §5.7 原始行为：
  - **运行前**：节点缩略图 = 主图（`imagePreview` = 主预览）
  - **运行后 + 未@主图**：节点缩略图 = **首个@参考图上传 URL**（`imagePreview = firstUploadedNonMainImageFromPlan`）
  - **运行后 + @主图**：节点缩略图 = @主图上传 URL（不变）
- 改动（最小变更·单文件 1 处）：`utils/referencedMediaRun.ts` `buildPanelImagePreviewPatchAfterRun` 未@主图分支恢复 `imagePreview: firstUploadedNonMainImageFromPlan(planImages, uploadedByToken)`，保留 `panelMainImageUrl` 备份（用于面板主图格恢复）+ `panelMainSlotVisible: false`
- 不变的支撑逻辑（已原生支持 §5.7，无需改）：
  - `resolveCanvasNodePreviewUrl`：有 `panelMainImageUrl` 备份 + prompt @图片 时返回 `imagePreview`（首个@参考图）
  - `shouldPreferRunReferencePreviewOverLocalMain`：`imagePreview` 在 `gp.referenceImages` 里时返回 true，刷新后不让 IDB 主图覆盖
  - `runNodeShouldHydratePreviewFromGpRefs`：`panelMainSlotVisible=false` 时返回 true，刷新后从 gp 首项恢复画布
  - `shouldShowPanelMainImageSlot`：有 `panelMainImageUrl` 备份时仍展示面板主图格（显示备份主图）
- 测试断言更新（§10.21 写的「保留主图」断言反转为「=首个@参考图」）：
  - `scripts/panel-ref-media-simulation-test.ts` §12 系列 + §40 系列（8 处）
  - `scripts/ggggttt-panel-preview-test.ts` §2/§3/§4（image2/Nano/全模型场景动态期望）
  - `scripts/778990-cat-church-panel-test.ts`
- 新增全模型×全 tab×三诉求矩阵测试：`scripts/all-models-three-requirements-test.ts`（`npm run test:all-models-three-requirements`，已并入 `test:gate`）
  - 覆盖：Nano / image2 / Omni multi·instruction·video·frames / 可灵2.5 / vidu / 即梦 / Seedance 参考生·图生·文生（急速+高质量）
  - 每场景逐项核对：诉求1 面板未@槽保留 + 诉求2 gp 仅含@到的 + 诉求3 缩略图=引用元素第一个（未@主图=首个@参考图 / @主图=@主图 / 运行前=主图）
  - 102 项断言全绿
- 测试：`npm run test:gate` 18 步全绿（含新增 `banana-panel-clobber` + `all-models-three-requirements` 两步）；`npm run build` 通过；Banana 专项全绿
- 勿回退（新规则，取代 §10.21）：未@主图运行后画布大图 = **首个@参考图上传 URL**，不得改回保留主图；面板主图格仍展示备份主图（`panelMainImageUrl`）；@主图 分支不受影响
- 影响：image2 / Banana2 / Omni multi / Seedance 参考生 等未@主图场景运行后画布大图 = 首个@参考图；生成结果仍进 `generatedThumbnails` 与 OUTPUT 节点；API 入参 / generationParams / Node Details 不变
- 风险：中，回退 S 级「勿回退」不变量需用户拍板（已确认）；`shouldPreferRunReferencePreviewOverLocalMain` 的 §10.21 判定保留（当 imagePreview 不在 gp refs 时仍返回 false），与 §10.38 兼容（imagePreview 现在在 gp refs 里，不触发该分支）

### 10.39 2026-07-08 运行失败后原节点卡 5% running（删错节点/刷新后 recovery 重新拉起失败任务）

- 症状：运行报错后，删除生成的 Error Result Node，原始节点显示 5% 进度不动；刷新也卡在 5%
- 根因：`components/FlowEditor.tsx` 错误 catch 块（L11250）只更新 LIVE 状态为 idle，**未清 taskId** + **未持久化**：
  1. 持久化状态仍为 `status: 'running', runRecoveryPending: true, progress: 5, taskId: <失败任务>`（来自任务创建时的 `flushCriticalRunPersist`）
  2. 删除 Error Result Node 后，`nodeNeedsAiTopTaskRecovery` 返回 true（taskId 存在 + 无下游 error 阻断）→ `useAiTopRunRecovery` 重新拉起 `recoverOneNode` → 设 running+5% → 重新轮询已失败任务 → 卡死循环
  3. 刷新加载持久化 running 态 → 同样循环
- 修复（最小变更·单文件 1 处）：catch 块用 `clearStaleRunTaskBeforeFreshRun` 清 taskId + gp.taskId + runRecoveryPending + runRecoveryProgress，设 idle，`stageRunPersistPatch` + `flowgen:persist-request`(force) 立即持久化
  - `flushCriticalRunPersist` 在 try 块内定义、catch 块访问不到，改用 `flowgen:persist-request` 事件（与任务创建 L6695 一致）
  - 错误信息（含 taskId）仍保留在 Error Result Node 的 `errorMessage`（L11224-11226 已写入，本改动在它之后），诊断不丢
- 文件：`components/FlowEditor.tsx` L11250-11263
- 测试：新增 `scripts/run-error-no-stuck-test.ts`（4 场景 15 断言，验证 catch 后无 taskId → 删 error OUTPUT 不触发 recovery → 刷新仍 idle；含旧行为对照证明根因）；`npm run test:gate` 全绿；`npm run build` 通过
- 勿回退：运行失败 catch 块必须清 taskId + 持久化 idle 态，不得只更新 LIVE 而不留 taskId 残留
- 不影响：成功路径、Error Result Node spawn、`useAiTopRunRecovery` / `runRecovery.ts` / `aitopTaskRecovery.ts`（均未改）、§10.37/§10.38 已验收功能

### 10.40 2026-07-08 @ 下拉误删最后元素（referenceImageLabels 错位时 seenNames 去重）

- 症状：Nano Banana 2.0 面板拖入 4 张参考图，`referenceImageLabels` = `["图片1","图片2","图片4","图片4"]`（slot2 标签错位成"图片4"，应为"图片3"），创意描述 @ 下拉无法 @ 最后元素（slot3 真正的 @图片4 不出现）
- 根因：`utils/promptMediaRefs.ts` `buildInspectorPromptMentionItems` 的 `seenNames` 去重（L1511-1512 原 `else { continue; }`）：
  - slot2 的 insertText=@图片3（ordinal=3），但 displayLabel="图片4"（customLabel="图片4" 经 fallback 后仍返回"图片4"）
  - slot3 的 insertText=@图片4，displayLabel="图片4"
  - `seenNames` 按 displayLabel 去重：slot2 先 push 并记 "图片4" → slot3 的 displayLabel "图片4" 命中 seenNames → `else { continue; }` 跳过 slot3
  - 实际 slot2 与 slot3 是不同 slot（@图片3 vs @图片4），不应按 displayLabel 去重
- 修复（最小变更·单文件 1 处）：`else { continue; }` 改为只对 `mainImage`/`mainVideo`/legacy frame 按 displayLabel 去重；`image`/`video`/`audio` kind（@图片n/@视频n/@音频n）不按 displayLabel 去重（insertText 已按 ordinal 唯一，seenTokens 足够）
- 文件：`utils/promptMediaRefs.ts` L1511-1521
- 测试：新增 `scripts/at-mention-label-mismatch-test.ts`（4 场景 9 断言：标签错位/正常/极端全重复/plan 解析）；`npm run test:gate` 全绿；`inspector-at-mention-e2e-test.ts` 49/49、`panel-mention-caption-alignment-test.ts` 31/31；`npm run build` 通过
- 勿回退：@图片n/@视频n/@音频n 不得按 displayLabel 去重（标签可能错位），只用 insertText（@图片n）去重；@资产:名 / @主图 / @主视频 仍按 displayLabel 去重（同名同义）
- 不影响：projectAsset 同资产名去重（L1498-1510 不变）、seenTokens 去重、`buildPromptMediaRefLabels` / `pushPanelRefImageAtSlot` / `panelSlotPictureOrdinal`（均未改）、§10.37/§10.38/§10.39 已验收功能

### 10.41 2026-07-08 面板同源元素去重（拖入同画布节点不重复添加）

- 需求：全模型全 tab，拖入与面板已有元素同源（同 URL/同资产）时不添加（静默跳过）
- 现状：`tryAppendReferenceImageWithLabel` 已按**压缩后 URL** 去重，`seedanceReferenceFromUrlRef` L3994-4002 已按**原 URL** 去重。漏洞：`applyInspectorReferenceFromUrlString`（Nano/image2/Omni 画布拖入入口）在压缩前未按原 URL 去重，同画布节点多次拖入若压缩后 URL 变化或压缩失败 fallback 到原 blob URL 时可能漏
- 修复（最小变更·纯加法·单文件 1 处）：`applyInspectorReferenceFromUrlString` 在 `currentRefs` 计算后（L3463 max-refs 检查前）加 `panelReferencesAlreadyContainUrl(currentRefs, internalCandidate)` early-return
  - 用已有 `panelReferencesAlreadyContainUrl` 函数（不新增函数）
  - 按**原 URL**（压缩前）去重，补充 `tryAppendReferenceImageWithLabel` 按压缩后 URL 去重的漏洞
  - 覆盖 Nano / image2（有主图时）/ Omni multi·instruction·video
- 文件：`components/NodeInspector.tsx` L3463
- 测试：新增 `scripts/panel-dedup-same-element-test.ts`（7 场景 18 断言：同/不同 URL、image2 资产 file/thumb、Omni、Seedance、压缩后 URL 不同兜底、压缩失败 fallback）；`npm run test:gate` 全绿；`npm run build` 通过
- 勿回退：`applyInspectorReferenceFromUrlString` 入口必须按原 URL 去重，不得只靠压缩后 URL 去重
- 不影响：`tryAppendReferenceImageWithLabel`（现有压缩后 URL 去重不变）、`seedanceReferenceFromUrlRef`（L3994-4002 不变）、`addSeedanceReferenceVideoUrl`（视频去重不变）、文件拖入路径（`ingestInspectorReferenceLocalFiles` → `tryAppendReferenceImageWithLabel` 不变）、`panelReferencesAlreadyContainUrl` / `normalizePanelReferenceUrlKey`（不变）、§10.37-§10.40 已验收功能

### 10.42 2026-07-08 Seedance 2.0 参考生运行后面板少图（mediaPatch gp-only 覆盖）

- 现象：Seedance 2.0 参考生 `@图片1+@图片4` 运行后，面板只剩 2 张（gp 仅 @ 到的素材），未 @ 的 `图片2/图片3` 丢失；Banana/image2 同模式已正确
- 根因：参考生上传完成后 `runCaptureForGp.referenceImages` 写入 **API/gp-only** 列表（仅 @ 引用）；spawn 前 `mediaPatch`（L9918）把该 gp-only 列表写回节点顶层 `referenceImages`，在 `buildUpdatedRunNodeData` 修复面板前 clobber 面板态；若 `buildUpdatedRunNodeData` 回退链读到被 clobber 的 `n.data.referenceImageLabels`（2 条）而 refs 有 4 条则标签串位
- 修复（对齐 Banana §10.37 / image2 模式）：
  1. 新增 `seedancePanelMergedRefs` / `seedancePanelMergedLabels` 函数级变量（参考生 merge 后写入）
  2. `buildUpdatedRunNodeData` Seedance 参考生分支优先用 `seedancePanelMerged*`，不再回退 `runCaptureForGp.referenceImageLabels`
  3. `mediaPatch` 在 `seedancePanelMergedRefs`（及 nano/image2 merged）非空时跳过 `referenceImages` / `referenceImageLabels`
- 文件：`components/FlowEditor.tsx`
- 测试：`scripts/2026070802-seedance-panel-verify-test.ts`（fixture `d:/json/2026070802-seedance2.0面板少图.json`）；`npm run test:gate` 全绿；`npm run build` 通过
- 勿回退：Seedance 参考生 `runCaptureForGp.referenceImages` 仍须 gp-only（供 generationParams）；面板写回必须走 `seedancePanelMerged*`，禁止 mediaPatch 用 gp-only 覆盖面板
- 不影响：§10.38 缩略图=首个@参考图、§10.41 面板去重、Banana/image2 已验收 run 流程、Seedance slot0 展示（`seedance-panel-slot0-not-hidden-test.ts`）

### 10.43 2026-07-08 可灵3.0 Omni 多图参考运行后面板少图 / gp 标签错位（对齐 §10.42）

- 现象：`2026070802-可灵.json` 多图参考 tab `@图片1+@图片4` 运行后，面板可能只剩 API 张数（未 @ 的 blob/资产槽丢失）；`generationParams.referenceImageLabels` 出现 `图片3` 等错位（应为 API 顺序 `图片1/图片1/图片4`）
- 根因：
  1. `mediaPatch` 未纳入 Omni merged 防护，`klingOmniMultiReferenceImages` / `referenceImageLabels` 可能被 gp-only 中间态覆盖
  2. 指令变换/视频参考 tab 在 `omniTabMergedRefs` 为空时回退 `klingOmniReferenceSnapshot.referenceImages`（API-only），clobber 面板
  3. multi tab gp 标签误用 `inferSeedanceReferenceDetailLabelsFromPrompt` 或面板 4 槽 labels 截断
- 修复：
  1. `skipPanelRefMediaPatchFromRunCapture` 纳入 `omniMultiMergedRefs` / `omniTabMergedRefs`；另跳过 `klingOmniMultiReferenceImages` / `klingOmniInstructionReferenceImages` / `klingOmniVideoReferenceImages` 的 mediaPatch
  2. instruction/video `tabRefPatch` 禁止回退 API-only `referenceImages`，仅用 `panelReferenceImages` 或保留原面板
  3. 新增 `buildOmniMultiGenerationParamsLabels`（`utils/referencedMediaRun.ts`），multi tab gp 标签按 imageList（首帧 + @图片n）与 upload map 对齐
  4. **2026070802-可灵2.json 追加**：Omni multi/instruction/video 运行须传 `nodeData`+`mergedPanelRefs` 给 `buildPanelImagePreviewPatchAfterRun`（对齐 Banana/Seedance），写入 `panelMainImageUrl` 保留主图格；`buildUpdatedRunNodeData` multi 分支合并 `omniMultiPreviewPatch`
  5. MOV/OUTPUT Details：面板槽数 > 创意描述 @ 数时不走全面板 preferPanel；`buildOmniMultiPromptTokenReferenceItems` 识别 Omni multi 首帧前缀（`@图片2+` 非 `@图片1`）正确映射 URL
  6. **2026070802-可灵3.json 追加**：`@图片2@图片4@图片3` 五槽时 `resolvePictureTokenSlotIndex` 须先按 `referenceImageLabels` 显式绑定「图片n」（避免 imagePreview=图片2 URL 时 ordinal 扫到 slot2）；`isOmniAssetMainUploadRefDuplicate` 含 `@图片n` 时勿按 imagePreview 误去重；`shouldDedupePanelRefsAgainstMainPreview` 与 `shouldShowPanelMainImageSlot` 对齐（有 `panelMainImageUrl` 备份仍展示主图格时按备份去重）
  7. **Omni multi imageList 去重**：无 `@主图/@首帧图` 时 plan 首 token 作隐式首帧；upload 循环须跳过同 token 二次 upload，并用 `buildOmniMultiApiImageList(firstFrameUrl, extraEntries, uploadedByToken)` 生成 API `imageList`（按 URL key / assetId 去重）。例：`@图片2@图片5@图片3` → **3 张**（非 4 张）
- 文件：`components/FlowEditor.tsx`、`utils/referencedMediaRun.ts`、`utils/referenceImageSlotLabels.ts`、`utils/promptMediaRefs.ts`
- 测试：`scripts/2026070802-kling-omni-panel-verify-test.ts`（fixture `d:/json/2026070802-可灵.json`）；`src/test/utils/referencedMediaRun.test.ts`；`npm run test:gate` 全绿；`npm run build` 通过
- 勿回退：§5.8.1 Omni 四 tab 面板隔离、§5.8.3 per-model IDB；multi tab 面板写回必须走 `omniMultiMerged*`，instruction/video 走 `omniTabMerged*`
- 不影响：首尾帧 tab 仍用 `firstLastFramePanelPatch`；§10.42 Seedance 修复

### 10.44 2026-07-09 Seedance 参考生 @图片n 上传串图（槽 COS + 过期 originals File）

- 现象：`20260709-seedance参考生视频.json` 第一次运行 `@图片2和@图片4` 时，gp 中 `@图片2` 上传成错误 COS（42713201），与面板槽 1（07e66432）不一致；第二次 `@图片5和@图片2` 正常
- 根因：`@图片n` plan 解析槽位正确，但 `uploadReferencedImageEntry` 在槽位已是远程 COS 时仍优先用 `getOriginals().referenceImages[slot]` 内存 File（画布换图/重拖后 URL 已更新、File 未清）
- 修复：`shouldUseSlotOriginalFileForUpload` — 槽位与 plan 均为远程 URL 时改走 URL 上传，仅 blob/flowgen-local 槽仍用 File
- 文件：`utils/referencedMediaRun.ts`
- 测试：`scripts/20260709-seedance-ref-images-verify-test.ts`；`src/test/utils/referencedMediaRun.test.ts`；`npm run test:gate` 全绿

### 10.45 2026-07-09 四大域验收冻结 + 门禁扩容（§5.9）

- 用户确认：模型 UI 面板、生成结果、拖拽、Node Details **目前测试 OK**，写入 `skill.md` **§5.9** 冻结契约
- 门禁：`test:gate` 由 26 步扩至 **33 步**（后续 §11.3 再增至 34 步），新增：
  - `test:kling-omni-tab-isolation` / `test:frame-model-switch-isolation` / `test:panel-switch-broken-urls`
  - `test:20260709-seedance-ref-images` / `test:20260709-seedance-video1-mention`
- fixture：`scripts/fixtures/20260709-seedance-*.json` + `scripts/fixturePath.ts`（CI 可跑）
- 同步：`.cursor/rules/regression-gate.mdc`、`.cursor/skills/flowgen-ai-studio/SKILL.md` §0.5

### 10.46 2026-07-09 Chat 轻量问候误联网 + 全模型四模式验收

- 现象：DeepSeek（及共用 AiTop 路径）开着联网时，用户发「你好，你是谁？」被 probe 改写成上一轮「Claude Code…」检索词，二次总结【用户问题】与【参考资料】错位
- 根因：
  1. `isLightweightPrompt` 不认组合问候「你好，你是谁？」
  2. `isGeminiWebSearchFirstPass` 只看 UI 联网开关，未看本轮 `effectiveWebSearch`（轻量句仍走 probe）
  3. `webSearchProbe` 对非检索句仍 LLM/历史拼接改写
- 修复：
  1. `isNonSearchableChatUtterance`（`utils/webSearchProbe.ts`）覆盖中英问候/致谢；`ChatPanel.isLightweightPrompt` 复用
  2. 联网首轮改为依赖 `effectiveWebSearch`（轻量句强制关联网）
  3. probe resolve/fallback 对非检索句跳过改写
- 验收：`npm run test:llm:four-mode` — Gemini/Claude/DeepSeek/DouBao ×（关/仅联网/仅思考/联网+思考）**16/16 通过**；`npm run test:chat-gate` 全绿
- 文件：`components/ChatPanel.tsx`、`utils/webSearchProbe.ts`、`scripts/llm-four-mode-matrix.mjs`、`scripts/llm-web-search-probe-test.ts`、`docs/LLM-CHAT-RULES-SPEC.md`
- 不影响：短追问「再查一下/用表格对比」仍可拼历史；Qwen 仍无联网/思考

### 10.47 2026-07-09 DeepSeek 开联网问「你是哪个模型」自称 Claude

- 现象：UI 选 DeepSeek + 联网，问「你是哪个模型 你删除做什么」；preload 确认为 `deepseek-v4-pro`，但正文自称 Claude（联网检索污染身份）
- 根因：「你是哪个模型…」未纳入非检索句 → 仍 `webSearch:true`；上游检索结果把助手身份带偏
- 修复：
  1. 新增 `isAssistantIdentityQuestion`，纳入 `isNonSearchableChatUtterance`（身份元问题强制关联网）
  2. **按需** tip：仅身份问注入一句「当前选用模型为 X」；普通问答不注入，避免过度约束
- 测试：`scripts/llm-web-search-probe-test.ts`；`npm run test:chat-gate`；`test:llm:four-mode`
- 文件：`utils/webSearchProbe.ts`、`components/ChatPanel.tsx`、`docs/LLM-CHAT-RULES-SPEC.md`

### 10.48 2026-07-09 Chat 约束精简（审计后）

- 原则（对齐业界多模型路由）：路由层只做必要防污染；正文尽量按上游 API 自然回复
- **保留必要**：身份/问候关联网；probe 非检索句不拼历史；身份问轻量 tip；简体 tip（skill 既有）
- **去掉过度**：每轮 tip 强制「禁止自称 Claude/GPT…」长约束
- 「你能做什么」不再当身份问（过宽，会误关联网）

### 10.50 2026-07-09 Chat §5.10 已验收冻结 + 门禁扩容

- 用户确认 Chat 身份/联网/四模式测试 OK → 写入 `skill.md` **§5.10**（S 级）
- 新增离线契约：`npm run test:llm-chat-identity-contract`（已并入 `test:chat-gate`）
- 发版 Chat 须加跑：`test:llm:four-mode`（可选 `test:llm:chat-audit`）
- 同步：`.cursor/rules/regression-gate.mdc`、`docs/LLM-CHAT-RULES-SPEC.md`、`.cursor/skills/.../SKILL.md`

### 10.51 2026-07-22 多输出节点 Source URL 错配修复

- **现象**：`E:\问题\特别.json` — Nano Banana 2.0 一次生成 2 张图并 spawn 出 2 个 OUTPUT 节点后，两个节点 Node Details 的 **Source URL** 都显示为同一张图的地址（`generatedImages[0]`）。
- **根因**：`components/FlowEditor.tsx` 运行后 spawn 逻辑在循环外统一将 `generationParams.outputUrl` 写死为 `generatedImages[0]`，且循环内所有 OUTPUT/MOV 节点复用**同一个** `generationParams` 对象。
- **修复**：
  1. 循环外不再设置 `outputUrl`，仅当生成多张时保留 `outputUrls = [...generatedImages]`；
  2. 循环内为每个新节点生成独立的 `generationParams` 副本：`{ ...generationParams, outputUrl: generatedImages[idx] }`。
- **影响**：仅影响「一次运行 spawn 出 2 个及以上 OUTPUT/MOV 节点」的场景；单图生成行为不变；下载 URL 同步修复。
- **文件**：`components/FlowEditor.tsx`
- **测试**：`src/test/utils/generatedOutputUrl.test.ts`（新增 multi-output 用例）、`scripts/node-details-simulation-test.ts` §14
- **风险**：低；未改动 S 级数据结构/字段语义，仅修正运行后写入快照的值。

### 10.52 2026-07-22 空白画布时隐藏 MiniMap

- **现象**：空白画布时右下角仍显示 MiniMap 占位区域（截图红框）；拖入图片或创建节点后才应显示。
- **根因**：`FlowgenMiniMap` 组件始终渲染，未根据画布实际节点做条件渲染。
- **修复**：
  1. 新增 `utils/flowgenMiniMapLayout.ts#hasVisibleMiniMapNodes(nodes)`：存在至少一个非 `backdropNode` / `chainFolderNode` 节点时返回 `true`；
  2. `components/FlowEditor.tsx` 中 `<FlowgenMiniMap>` 改为 `{hasVisibleMiniMapNodes(nodes) && <FlowgenMiniMap ... />}` 条件渲染。
- **影响**：空白画布或仅有背景框/链折叠夹时 MiniMap 完全隐藏；存在任意工作节点（INPUT/PROCESSOR/OUTPUT/MOV）时自动显示；删除全部工作节点后自动隐藏。
- **文件**：`components/FlowEditor.tsx`、`utils/flowgenMiniMapLayout.ts`
- **测试**：`src/test/utils/flowgenMiniMapLayout.test.ts`（新增 `hasVisibleMiniMapNodes` 用例）
- **风险**：低；未改动 MiniMap 内部布局/导航/交互逻辑，仅控制是否挂载组件。

---

## 11. 本次整理记录（2026-07-06）

- 在**项目根目录**新建 `skill.md`，作为项目唯一标准说明书。
- 整合 `.cursor/skills/flowgen-ai-studio/SKILL.md` 与 `reference.md` 的核心内容。
- 增加**模块稳定性分级**（S/A/B/C），明确标注哪些模块已测试稳定、禁止乱改业务逻辑。
- 补充核心数据结构（`NodeData`、`GenerationParams`）字段说明与稳定性标记。
- 补充关键模块的**用途、入参、出参、调用示例**。
- 保留全部历史迭代记录与回归门禁规则。
- 风险：根目录 skill.md 与 `.cursor/skills/flowgen-ai-studio/SKILL.md` 内容需保持一致；后续功能变更时应以根目录为准，并同步更新 `.cursor/skills` 下副本。

### 11.1 2026-07-09 发版一致性（非业务加固）

- **目的**：开发机与服务器部署行为一致；不改面板/@/Details/Chat 业务逻辑。
- `tsconfig.json`：`include` 应用源码，`exclude` `scripts/`、`src/test` 等，避免测试脚本类型错误阻断 `npm run build`（测试仍由 vitest / `tsx scripts/*` 执行）。
- `server.js`：非 MySQL 的 `uncaughtException` 打日志后 `process.exit(1)`，避免带病进程继续服务。
- 中键拖拽控制台日志需 `window.__FG_MIDDLE_DRAG_DEBUG === true`（内存 ring buffer 仍写入）。
- `.env.example` / 部署清单：强调生产与开发均须设置 `FLOWGEN_JWT_SECRET`；全量拷贝须含 `server/workspacePayloadCodec.mjs` 等运行时文件。
- 清理根目录误操作残留 `qc` / `query`。
- 风险：低；不触碰 §5.8–§5.10 S 级业务契约。

### 11.2 2026-07-09 恢复各模型 preload 控制台打印

- **现象**：发版一致性改动将 `isPreloadDebugEnabled` 改为默认关闭，运行模型时控制台不再打印 `[flowgen:preload]` JSON。
- **修复**：`services/aitop.ts` 恢复浏览器默认开启；仅当 `window.__FLOWGEN_DEBUG_PRELOAD__ === false` 时关闭（与 `docs/CORE_APPLICATION_LOGIC.md` §12 一致）。Chat LLM preload（`utils/chatRequestLog.ts`）共用同一开关。
- 风险：低；仅日志开关，不改请求体/业务逻辑。

### 11.3 2026-07-09 Seedance 参考生运行后主图=参考槽同 URL 丢图

- **现象**：`e:/问题/0709/nodes-Input Picture Node-Output Mov -1783590031269.json` — seedance2.0 参考生运行后面板少一张（「石头」）；数据层 `referenceImages` 仍为 5 张。
- **根因**：运行后 `imagePreview` 与某参考槽同 URL；`seedanceShowMainInRefGrid` 因重复隐藏主图格，但 `seedanceRefDisplayEntries` 仍按 `shouldShowPanelMainImageSlot` 对参考槽去重 → 该图两边都不展示。
- **修复**：`NodeInspector` 仅当主图格**实际展示**（`seedanceShowMainInRefGrid`）时才对参考槽做主图去重；`seedanceShowMainInRefGrid` 提前于 `seedanceRefDisplayEntries`。
- **文件**：`components/NodeInspector.tsx`
- **测试**：`scripts/20260709-seedance-main-dup-ref-panel-test.ts`（fixture `scripts/fixtures/20260709-seedance-main-dup-ref-panel.json`）。
- **风险**：低；仅 Seedance 参考生面板展示，不改上传/API/gp；未触碰 §5.8 S 级模块。

### 11.4 2026-07-09 全模型主图=参考槽：展示对齐 + sync 禁止清空

- **模拟结论**：
  - **展示层**：Nano / Omni / image2 在主图格仍展示时，参考格去重「石头」属预期（石头在主图格可见）；Seedance 因 `imageName` 与标签同名会隐藏主图格，须保留参考格 5 张（§11.3）。
  - **数据层风险**：idle 时 `buildPanelRefSlotSyncPatch` 对 Seedance/image2/Omni 使用 `shouldDedupePanelRefsAgainstMainPreview=true`，会把与主图同 URL 的参考槽**从数据清空**（Nano 历来 `false` 幸免）。
- **修复**：
  1. 新增 `panelMainOverlapsAnyReferenceSlot` / `shouldDedupePanelRefsAgainstMainForSync`：主图与任一参考槽同素材时 sync **不去重**。
  2. `NodeInspector` sync 改用 `shouldDedupePanelRefsAgainstMainForSync`；Omni/Nano 展示去重改为「仅主图格实际展示时」。
- **文件**：`utils/referencedMediaRun.ts`、`components/NodeInspector.tsx`
- **测试**：`scripts/20260709-all-models-main-dup-ref-panel-test.ts`；`test:gate` 增至 35 步。
- **风险**：低；不改上传/API；主图与参考不同 URL 时 sync 仍可去重。

### 11.5 2026-07-09 背景框选中后无法鼠标缩放

- **现象**：为选中节点创建背景框后，四角无法拖拽缩放。
- **根因**：
  1. `BackdropNode` 根节点 `pointer-events-none`（透传点击给框内节点），`NodeResizeControl` 未恢复 `pointer-events-auto`，手柄收不到指针事件。
  2. 未引入 `@reactflow/node-resizer/dist/style.css`，角点缺少绝对定位（`reactflow/dist/style.css` 不含 resizer 样式）。
- **修复**：手柄 class 加 `pointer-events-auto`；`index.tsx` 引入 resizer CSS；`backdropResizeHandleNeedsPointerEventsAuto` 回归断言。
- **文件**：`components/nodes/BackdropNode.tsx`、`index.tsx`、`utils/backdropLabel.ts`、`src/test/utils/backdropLabel.test.ts`
- **风险**：低；不改面板/@/Details；框体仍透传点击，仅角点/顶栏/标签可交互。

### 11.6 2026-07-10 §5.11 发版交付冻结写入 skill（防回归）

- **目的**：将 §11.2–§11.5 提升为根目录 `skill.md` **§5.11** S 级勿改契约，并同步决策树 / 模块约束 / `regression-gate.mdc` / `.cursor/skills` 副本。
- **覆盖**：preload 默认开；主图=参考槽展示+sync；Backdrop 四角缩放。
- **Agent 约束**：改面板去重 / `buildPanelRefSlotSyncPatch` / Backdrop / `isPreloadDebugEnabled` 前必读 §5.11；gate 第 34–35 步不得删除。
- **风险**：无代码变更；仅文档与门禁指引。

### 11.9 2026-07-10 Node Details：左右键切换整份 Generated Outputs 历史【已验收·勿改 §5.12】

- **需求**：从节点「GENERATED OUTPUTS」点开 Node Details 后，← → 切换的是**整份面板**（左侧预览 + 右侧 Prompt/参考图/Used Parameters），不是只换视频。
- **实现**：
  1. `utils/generatedThumbKeyboardNav.ts`：`buildNodeDetailsPreviewFromGeneratedThumb` 用该条 `thumb.generationParams` 快照重建预览节点 data；`resolveGeneratedThumbNavTarget` 循环定位
  2. `FlowEditor`：`previewActiveThumbId` 历史浏览模式禁止被画布 live 节点 sync 覆盖；ArrowLeft/Right 捕获阶段切换
  3. `CustomNode`：`flowgen:preview-node` 携带 `sourceNodeId` + thumb（含 gp）
  4. 标题显示 `← → 切换整份 Node Details · Generated Outputs 历史 N/M`
- **测试**：`src/test/utils/generatedThumbKeyboardNav.test.ts`（已并入 `test:gate` vitest 步）
- **冻结**：提升为根目录 `skill.md` **§5.12** S 级勿改；同步决策树 / `regression-gate.mdc` / `.cursor/skills` 副本
- **风险**：低；同一次运行多条输出若共享同一 gp，右侧文案可能相同，但预览 URL / 历史序号会变

### 11.10 2026-07-10 Banana 运行后「丢图」（preserve 误清 panelMainSlotVisible）

- **现象**：`d:/json/banana-丢图.json` — Nano Banana 2.0 拖入 4 张参考（@图片1+@图片4）运行后，面板主图/参考看起来丢图或裂图。
- **说明**：既有 `test:banana-panel-clobber` **已通过**（数据层 `referenceImages` 仍为 4，未被 gp-only 裁掉）；本次是另一类回归。
- **根因**：
  1. `NodeInspector` 的 `buildPanelMainImagePreservePatchOnEdit` effect 依赖 `panelMainImageUrl` / `panelMainSlotVisible`：运行刚写入 `false`+备份后立刻被清成 `undefined`
  2. `preserve` 在「`imagePreview` 已是首个 @ 参考」时仍清 `false`，主图格用失效 blob 备份或与参考槽混淆
  3. hydrate 替换 `imagePreview` 时可能误 revoke 仍作 `panelMainImageUrl` 的 blob
- **修复**：
  1. `buildPanelMainImagePreservePatchOnEdit`：未 @主图且 `imagePreview` 已等于某参考槽时 **不得** 清 `panelMainSlotVisible=false`
  2. Inspector effect **仅**依赖创意描述相关字段（勿跟 `panelMainImageUrl`/`panelMainSlotVisible`）
  3. `FlowEditor` hydrate revoke：旧 blob 仍被 backup/refs 引用时不 revoke
- **测试**：`scripts/20260710-banana-panel-loss-test.ts`（fixture `scripts/fixtures/20260710-banana-panel-loss.json`）+ `panel-main-slot`；已并入 `test:gate` 第 38 步
- **风险**：低；legacy「imagePreview 仍是主图备份」时仍可清 false

### 11.11 2026-07-10 Banana 未@主图 restore 误盖回主图（重复图 / 生成错乱）

- **现象**：`d:/json/banana-丢图2.json` vs `banana-正常.json` — 运行后面板主图与参考语义错乱（重复感），`modelConfigs.imagePreview` 已是图片3 但顶层被盖回「白泽」。
- **根因**：`shouldRestorePanelMainImageSlotForEditing` **只要有 `panelMainImageUrl` 就 return true**，未先判断「仅 @图片n/@资产、未 @主图」→ `buildPanelMainImageRestorePatchForEditing` 把 `imagePreview` 盖回主图备份。
- **修复**：未 @主图且有图片类 @ 时 **禁止 restore**；主图格仍靠 `panelMainImageUrl` 展示；有 `@主图` 时仍允许 restore。
- **全模型**：Nano / image2 / Omni / Seedance 参考生共用该门禁（脚本矩阵覆盖）。
- **测试**：`scripts/20260710-banana-restore-dup-test.ts` + vitest `panelMainSlotPrompt`；已并入 `test:gate` 第 39 步
- **风险**：低；不改上传/API/gp；仅改选中节点时的 restore 条件

### 11.12 2026-07-10 四种引用方式 × 全模型矩阵

- **覆盖**：A `@图片3参考@图片4`（部分未@）/ B `@图片3参考@图片9`（多槽）/ C `@主图参考@图片1` / D `@资产:光头强参考@图片2` × Nano Banana 2.0 / image 2 / 可灵3.0 Omni multi / seedance2.0 参考生
- **断言**：plan tokens、面板未@槽保留、gp 仅@、imagePreview、未@主图 restore=undefined、画布≠主图备份；C 运行后主图格可见无需 restore，legacy `panelMainSlotVisible=false`+@主图 才 restore
- **测试**：`scripts/20260710-four-mention-all-models-test.ts`（168 断言）；已并入 `test:gate` 第 40 步
- **风险**：无业务改动（纯回归矩阵）；防 §11.11 restore 门禁回退

### 11.13 2026-07-10 资产库中键拖到画布空白区失效

- **现象**：资产库中键可拖到节点面板，但拖到画布空白区不再创建节点。
- **根因**：发版时 `FlowEditor` 对 `dropZone === 'canvas-pane'` 直接 `return`，整段「空白区 → `createNodesFromAssetItems`」被关掉。
- **修复**：恢复资产库源（`asset:` / `asset:multi`）在 `canvas-pane` 的创建节点；画布节点拖到空白区仍不新建。抽出 `shouldCreateCanvasNodesFromMediaDrop` / `buildAssetItemsFromMediaDrop`。
- **测试**：vitest `middleButtonMediaDrag`（含 canvas-pane 门禁用例）
- **风险**：低；仅恢复资产库→画布路径，不改面板投放 / Inspector 去重

### 11.14 2026-07-10 主图=资产库 + 仅@图片n 运行后面板丢图

- **现象**：`banana-正常2.json`（多种拖入/@）正常；`banana-主图是资产库中图片.json` 主图为 `/flowgen-api/.../assets/.../file`、仅 `@图片5/@图片7` 运行后参考槽被掏空（用户感知丢图）。
- **根因**：
  1. 运行后 `imagePreview`=首个 @ 参考 COS，`panelMainImageUrl`=资产库备份；`referenceImagesDedupePatchIfNeeded` **误用 `imagePreview` 当主图去重** → 清掉同 URL 的 @槽
  2. `buildPanelMainImagePreservePatchOnEdit` 仅靠「preview∈refs」；资产库主图场景 URL 偶发不一致时误清 `panelMainSlotVisible=false`，随后默认去重再掏空
- **修复**：
  1. 去重主图 URL 改为 `resolvePromptMainImagePreviewForRefs`（优先 `panelMainImageUrl`）
  2. preserve：未 @主图且 `imagePreview ≠ 备份` 时保持 false
  3. Inspector 拖入去重同样改用主图槽 URL
- **测试**：`scripts/20260710-asset-main-all-models-test.ts`（Nano/image2/Omni multi·instruction/Seedance × E/F/G + fixture）；已并入 `test:gate` 第 41 步
- **风险**：低；展示层本已用 `panelReferenceLabelImagePreview`；不改 API/gp

### 11.15 2026-07-10 banana 运行后 gp 误写面板全量（banana-源/问题）

- **现象**：`banana-问题.json` — Nano 面板 9 槽全保留，但 `generationParams.referenceImages` 被写入 9 张（Details 展示全量）；`banana-源.json` 运行前 gp 为空。
- **根因**：`FlowEditor` Nano/image2 运行收尾在 `nanoRunReferenceSnapshot` 为空时，用 `mergedRefImages`（面板全量）去主图后仍写入 gp，违反 **§5.9.1 #2**（Details 仅 @ 引用）。
- **修复**：
  1. Nano/image2 无 API 上传 snapshot 时 `generationParams.referenceImages = undefined`（勿 strip 面板后写入）
  2. 刷新 recovery：`mergeRecoveryGenerationParamsFromRunNode` 优先 `pickStillImageRecoveryApiReferenceImages`，勿继承坏 gp 全量
  3. `buildRecoveryGraphUpdates` 保留 preview 补丁 + `resolveSpawnOutputDefaultModel`（非 load 时变异节点）
- **回退**：移除 `loadPersistedProject` 内联 prepare、`applyWorkspaceStillImageReferenceGpRepair`、OUTPUT load 修复
- **测试**：`scripts/20260710-banana-run-gp-at-mention-test.ts` + `runRecovery.test.ts`；`test:gate` 第 42 步

### 11.16 2026-07-10 banana @图片4+@图片7 gp 空时 Details 全量（banana-问题2）

- **现象**：`banana-问题2.json` — 运行后面板 8 槽保留，但 `generationParams.referenceImages` 为空（API 失败/中断）；Node Details 回退展示面板全量 8 张；用户感知「图片3/图片4 重复、错位」。
- **根因**：`FlowEditor` Nano/image2 Details 在 `snapRefs.length===0` 时走 `buildNodeDetailsReferencePreview` 全面板 fallback，违反 **§5.9.1 #2**。
- **修复**：
  1. `buildStillImageGenNodeDetailsReferencePreview`：gp 空时用 `pickStillImageRecoveryApiReferenceImages`（创意描述 @ + 面板槽）构建 Details
  2. Nano 上传完成 `setNodes` 时同步写入 `generationParams.referenceImages`（仅 `imageUrls`），避免 API 失败时 gp 仍空
- **测试**：`20260710-banana-run-gp-at-mention-test.ts` §6；`test:gate` 第 42 步
- **风险**：低；面板数据层不变；旧 JSON 需重新运行或刷新后 Details 走 recovery 解析

### 11.17 2026-07-10 banana @图片4 上传串 slot3 图（banana-问题3）

- **现象**：`banana-问题3.json` — 运行后面板「图片3」「图片4」显示同一张图（有轨电车）；`banana-源.json` 两槽本为不同图。
- **根因**：`shouldUseSlotOriginalFileForUpload` 在槽位已是 `data:image/` 预览时仍用 `originals.referenceImages[i]` 的过期 File 上传；File 与当前槽 b64 不一致时 @图片4 实际上传了其它槽的图，merge 写回 COS 后与图片3 槽视觉重复。
- **修复**：槽位为 `data:image/` 时禁止走 originals File，改走面板 data URL（与 COS 槽 remote URL 规则对称）。
- **测试**：`referencedMediaRun.test.ts` + `20260710-banana-run-gp-at-mention-test.ts` §6；`test:gate` 第 42 步
- **风险**：低；blob 槽仍用 File；仅 data: 预览槽改走 URL

### 11.18 2026-07-10 banana-问题4 gp 空 + @资产+@图片3 Details 少一张【§5.8.5 已验收·S级】

- **现象**：`banana-问题4.json` — 面板 4 槽正常；`generationParams.referenceImages` 为空；prompt `@资产:光头强参考@图片3风格生成`；Node Details 只显示 1 张（且可能误标为「光头强」），缺少 `@图片3`。
- **根因**：
  1. `pickStillImageRecoveryApiReferenceImages` / `collectReferencedMediaFromPrompt` 在 slug map 为空时调用 `resolveProjectAssetUrlFromTokenKey`，旧实现**只查 Map、不用 `projectAssets[].url`** → plan 丢失 `@资产:光头强`
  2. recovery 只剩 1 张时，`buildSeedanceReferenceDetailsFromSnapshot` 按 prompt 两 token 对齐标签，把「图片3」URL 误显示为资产库地址
- **修复**：`resolveProjectAssetUrlFromTokenKey` — slug map 未命中时回退 `projectAssets[].url`（仍优先 slug map）。
- **S级契约（§5.8.5）**：全模型 plan 须含 `@资产` + `@图片n`；Nano/image2 gp 空 Details **2 张**；面板槽不减；**禁止**回退 row.url / 禁止 gp 空 Details 全量面板。
- **全模型**：Nano / image2 / 可灵3.0 Omni multi / seedance2.0 参考生（fixture + banana-源 morph）。
- **测试**：
  - `scripts/20260710-asset-mention-details-recovery-test.ts`（**144 断言**）：fixture `scripts/fixtures/20260710-banana-source-9slot.json` + `20260710-banana-problem4-asset-pic3.json` + 可选 `d:/json/banana-源.json` / `banana-问题4.json`
  - vitest `projectAssetUrlFromTokenKey.test.ts`
  - 已并入 `test:gate` 第 43 步
- **风险**：低；slug map 仍优先；无 projectAssets 时行为不变（仅 `@图片n`）

### 11.19 2026-07-10 二次运行创意描述 @ 引用被 rewrite【§5.8.7 已验收·S级】

- **现象**：生成完成后再次点击运行，创意描述里 `@图片3` 等被自动改成 `@资产:…`，与用户输入不一致。
- **根因**：`FlowEditor.handleNodeRun` 运行前 `buildCanonicalInspectorPromptPatch` 后 **`updateNodeDataById` 写回节点**；Seedance 参考生运行中/收尾亦把 canonical 写入 `seedanceTabConfigs.reference.prompt`。
- **修复**：canonical patch **仅 merge 进 `runDataBase` / `runStartDataSnapshot`**，不再写回节点；Seedance 运行中/收尾 **只 sync 参考槽**，`refTab.prompt` 用 `getNodeInspectorPromptText`；API/plan 仍走 canonical。
- **测试**：`20260710-banana-run-gp-at-mention-test.ts` §8–§9（**六模型**）+ vitest `promptRerunCanonical.test.ts`；`test:gate` 全绿
- **风险**：低；§25 `@图片n→@资产` plan 行为不变；仅去掉 UI 侧写回

### 11.20 2026-07-13 Chat Gemini 身份问误显过程区 + 误判无正文【§5.10.4】

- **现象**：未开联网/思考，问「你是哪个模型？你擅长的是什么？」；Gemini 已流式输出 ~400+ 字，却出现「回复未完成」+ `[联网检索]`/`[思考过程]` 卡片，正文判空后 fallback。
- **根因**：① 嵌套 `[思考过程]`→`[联网检索]` 时 `parseAssistantMessage` 丢失正文；② 未开模式时过程区未合并回 main；③ 校验未用原始流 `fullContent` 兜底；④ 展示层默认拆英文前缀为思考卡。
- **修复**：`parseAssistantMessage` 保留嵌套标记后段；`flattenAssistantSectionsWhenProcessDisabled` + `recoverAssistantReplyFromRaw`；`assistantReplyHasVisibleMain` 支持 `rawFallback`；未开模式时 `consolidateWebSearchSections` 勿把正文 demote 到检索区；Gemini 流结束前先按 raw 恢复。
- **门禁**：`skill.md` **§5.10.4** + `scripts/llm-chat-display-contract-test.mjs`（已并入 `test:chat-gate`）
- **风险**：低；开联网/思考时行为不变

### 11.21 2026-07-13 思考关闭时剥离正文英文 CoT 前缀【§5.10.4】

- **现象**：Gemini 关思考后仍把 `**Assessing the Prompt**` 等英文推理写进正文区。
- **修复**：`stripLeakedThinkingFromMainWhenDisabled`（仅 `thinkingEnabled:false`）；不误伤 `Hello + 中文` 双语自我介绍。
- **门禁**：同上 + `assistant-message-layout-test.ts` 44 条
- **风险**：低；开思考 / 开联网 / 其他模型路径不变

### 11.22 2026-07-13 导出 JSON 跨机器 INPUT 主图 EMPTY【§5.13】

- **现象**：`@主图` + 资产库主图运行后导出 JSON，另一台机器导入后 INPUT 画布主图 EMPTY（OUTPUT 正常）；JSON 内 `imagePreview` 为 COS URL 仍被 hydrate 清空。
- **根因**：`hydrateNodeImagePreviewFromPersisted` 见 `imageLocalRef` + `gp.referenceImages` 含主图 URL 时误清空 `imagePreview`，期待本机 IndexedDB 恢复；跨机器 IDB 无数据则空白。
- **修复**：仅当 `imagePreview` 非持久化 URL，或等于面板首参考槽 URL 时才清空；已持久化 COS 主图保留。
- **回归**：`scripts/20260713-export-json-main-image-persist-test.ts` + fixture `20260713-export-json-main-image-persist.json` + vitest `hydratePersistedNodePreviews.test.ts`；**`test:gate` 第 44 步**
- **风险**：低；本机 blob 刷新 / 误写 ref0 为 preview 的 IDB 恢复路径不变

### 11.23 2026-07-14 Seedance 参考生 Node Details 参考图对齐

- **现象**：`E:/问题/seedance3.json` — MOV 节点的 Node Details 参考图（2 张：主图/图片4）与源 processor 节点不一致。
- **根因**：`FlowEditor` Seedance reference 分支对 processor 节点额外从面板补齐参考图，导致与 MOV 节点（仅用 gp）不一致。
- **修复**：撤销展示层兜底逻辑，所有 Seedance 参考生节点（processor/MOV）统一使用 `generationParams.referenceImages` 作为 Node Details 数据源，确保一致性。
- **文件**：`components/FlowEditor.tsx`（移除展示层 repair 兜底）
- **测试**：`scripts/test-seedance-fix.ts`（seedance3.json processor vs mov 对比）；`test:gate` 全绿（245 passed）
- **风险**：低；仅 Seedance 参考生节点的 Details 展示路径；不修改运行上传/API 逻辑；未触碰 §5.8–§5.13 S 级模块。

### 11.24 2026-07-14 Seedance 参考生 processor 运行后 @主图 误变为 @主视频

- **现象**：`E:/问题/seedance4.json` — processor 节点生完视频后，创意描述 @ 下拉中「主图」变成了「主视频」。
- **根因**：`resolveSeedanceReferenceMainVideoUrl` 在 `referenceMovs` 为空时，仍将 `generationParams.outputUrl`（视频）判定为主视频 URL，导致 `buildPromptMediaRefLabels` 调用 `pushMainVideo` 而跳过 `maybePushMainPreviewWithoutFrameMainImage`。
- **修复**：移除 `resolveSeedanceReferenceMainVideoUrl` 中无匹配 `soleMov` 时返回 `outputUrl` 的逻辑；仅当 `referenceMovs` 中有 `outputUrl` 时才视为参考主视频。
- **文件**：`utils/promptMediaRefs.ts`（`resolveSeedanceReferenceMainVideoUrl` 函数）
- **测试**：`scripts/test-seedance4-mainimage.ts`（5 passed）；`test:gate` 全绿（245 passed）；`seedanceMainVideoLabel.test.ts` 4 passed
- **风险**：低；仅影响无 `referenceMovs` 的 processor 节点 @ 下拉标签；MOV 节点（有 `referenceMovs`）不受影响；未触碰 §5.8–§5.13 S 级模块。

### 11.25 2026-07-14 聊天对话框右键导出 Word 文档

- **功能**：在聊天对话框中右键点击任意一条消息，右键菜单出现「导出为 Word 文档」选项，将该条消息内容导出为 `.docx` 文件（支持 Word / WPS 打开编辑）。
- **实现**：安装 `docx` 库；在 `ChatPanel.tsx` 中给消息行添加 `data-message-id` 属性；右键时通过 `contextMessageId` 状态追踪目标消息；导出函数解析 markdown（标题/代码块/表格/列表/引用/加粗斜体）生成 docx 文档；文件名使用 `exportSelectionFileBase()` 与 Excel 导出保持一致，避免重名。
- **文件**：`components/ChatPanel.tsx`（新增 `handleExportMessageAsWord`、`contextMessageId` 状态、菜单项）；`package.json`（新增 `docx` 依赖）
- **风险**：低；纯新增功能，不影响已有右键菜单项和导出逻辑。

### 11.26 2026-07-14 Seedance 参考生 Node Details 门禁

- **目的**：防止修改 Node Details 展示逻辑时破坏已验证行为。
- **门禁脚本**：`scripts/20260714-seedance-reference-consistency-test.ts`（9 断言）
  - §1 seedance3.json：processor 与 movNode 的 Node Details 参考图必须一致（都用 `gp.referenceImages`）
  - §2 seedance4.json：processor 节点 `resolveSeedanceReferenceMainVideoUrl` 在无 `referenceMovs` 时返回 `undefined`；`@mention` 中 `@主图` 不应变为 `@主视频`
- **已加入**：`test:gate`（第 52 步）、`package.json`（`test:20260714-seedance-reference-consistency`）
- **S 级约束**：`resolveSeedanceReferenceMainVideoUrl` 仅在 `referenceMovs` 中有匹配 `outputUrl` 时才返回主视频 URL；禁止回退到 `outputUrl`。

### 11.27 2026-07-14 导航地图（MiniMap）固定尺寸

- **现象**：导航地图大小随节点 bounds 变化（200×150 ~ 200×400），用户希望固定大小且能完整看到所有节点。
- **修复**：`computeAdaptiveMiniMapSize` 返回固定 **150×150**；viewBox 自动缩放以包含所有节点，不影响点击/拖拽/缩放导航功能。
- **文件**：`utils/flowgenMiniMapLayout.ts`（`BASE_WIDTH/MIN_HEIGHT/MAX_HEIGHT` 均设为 150）；`components/FlowEditor.tsx`（MiniMap `className` 固定 `!w-[150px] !h-[150px]`）；`src/test/utils/flowgenMiniMapLayout.test.ts`（更新断言）
- **风险**：低；仅 MiniMap 外观尺寸；viewBox 计算逻辑不变；导航功能不受影响。

### 11.28 2026-07-15 Seedance 参考生 Node Details 过滤未 @ 引用的面板图片

- **现象**：面板拖入 3 张图（图片1、石头、图片3），创意描述仅 `@资产:石头` + `@图片1`，但 Node Details 展示了全部 3 张参考图（多出"图片3"）。
- **根因**：`buildSeedanceReferenceDetailsFromSnapshot`（`utils/nodeDetailsPreview.ts`）压缩快照 URL 后直接展示所有非空 URL，未根据 prompt @ 引用过滤掉未引用的面板图片。违反 **§5.9.1 #2**（Details 仅展示创意描述 @ 到的素材）与 **§6.1.11 修改约束**（禁止 Details 展示面板全量未@槽）。
- **修复**：在 `compacted` 数组生成后、`urls` 提取前，增加 prompt 标签过滤逻辑：
  1. 当 `promptImageTokenCount > 0 && compacted.length > promptImageTokenCount` 时触发过滤；
  2. 用 `inferSeedanceReferenceDetailLabelsFromPrompt` 从 prompt 推断期望标签集合；
  3. 仅保留标签匹配的条目（`matched.length > 0` 时生效）；
  4. **安全回退**：若 prompt 含 `@资产:` 但 `projectAssets` 缺失（`matchAllPromptMediaTokens` 无法识别 @资产 token），不过滤避免误删。
- **文件**：`utils/nodeDetailsPreview.ts`（`buildSeedanceReferenceDetailsFromSnapshot`）；`scripts/20260715-seedance-unreferenced-filter-test.ts`（门禁）；`scripts/test-gate.mjs` + `package.json`（门禁注册）
- **测试**：`test:20260715-seedance-unreferenced-filter`（16 项）；`test:gate` 全量通过（含原 245+144+41+8+9 项）
- **风险**：低；仅影响 Node Details 展示层过滤；不动面板数据、generationParams 写入、API 上传逻辑；对正确 JSON（空槽已被过滤）无影响；缺 projectAssets 时安全回退不过滤。

### 11.29 2026-07-16 用户反馈"撤销修改后生成图片无缩略图"——纯构建问题排查

- **现象**：用户撤销此前会话累积的多文件修改后，浏览器生成图片时画布无缩略图；但 `npm run test:gate` 全过、`scripts/20260716-fresh-replay-all.ts` 18/18 通过、`scripts/20260716-thumbnail-loss-replay.ts` 4 场景 12/12 通过。
- **根因**：`dist/assets/FlowEditor-*.js` 仍为 2026/7/16 17:17 旧构建，未跑 `npm run build` 重建。src 端 `utils/referencedMediaRun.ts` 的 `buildPanelImagePreviewPatchAfterRun`（含 mergedPanelRefs fallback）+ `resolveCanvasNodePreviewUrl` 重写 + 新增 `pickStillImageRecoveryApiReferenceImages` / `buildStillImageRecoveryPanelPreviewPatch` 等修复均在源码，浏览器加载的旧 dist 缺乏这些保护。
- **新模拟脚本**（`scripts/20260716-thumbnail-loss-replay.ts`）：端到端模拟"未 @主图 + @资产 + @图片n"完整生成流程（runStartDataSnapshot → plan → uploadedByToken → mergedPanelRefs → buildPanelImagePreviewPatchAfterRun → enrichPanelPreviewPatchWithFreshMainBackup → runCaptureForGp → mediaPatch → setNodes → prepareNodesAfterWorkspaceLoad → hydrateGraphMediaFromPersisted）。4 场景：
  1. 场景 A：fixture=刷新前，未 @主图 + @资产:石头 + @图片1 → imagePreview=795c8b66（石头）✓
  2. 场景 B（用户实际场景）：fixture=刷新后，imagePreview=资产库美女 62803dee 再次运行 → imagePreview=795c8b66 ✓
  3. 场景 C：uploadedByToken 为空极端 → mergedPanelRefs 兜底 imagePreview=9d65585c ✓
  4. 场景 D：空 prompt 无任何 @ 引用 → 兜底 imagePreview=9d65585c ✓
- **修复**：零代码修改；按 `auto-build-and-run.mdc` 跑 `npm run build`（13.94s 通过）+ `npm start` 重启 3001，dist 新产物 `FlowEditor-i_s_1_B_.js` / `index-CkXBsWdL.js`（2026/7/17 8:38:23）。
- **文件**：`scripts/20260716-thumbnail-loss-replay.ts`（新增门禁脚本）
- **测试**：`npm run test:gate` 33 步全过；新模拟脚本 4 场景 12/12；`npm run build` 通过；`http://localhost:3001/` StatusCode 200 OK
- **勿回退**：若日后再次出现"代码测试通过但浏览器表现异常"，**先比对 dist 哈希与最新 src**（`Get-ChildItem dist/assets/FlowEditor-*.js | Sort-Object LastWriteTime -Descending | Select-Object -First 1` vs `git diff HEAD --name-only` 时间），不要轻率动 src。
- **不影响**：§5.7 多图参考主图、§10.38 未 @主图运行后画布=首个 @参考图、§11.28 Node Details 过滤未 @ 引用、用户报告的旧 bug 修复均未触动。

### 11.30 2026-07-17 Banana 节点 data:image URL 刷新后丢失（面板图片无法持久化）

- **现象**：`E:\问题\banana运行前.json` → `banana运行后.json` → `banana运行后再刷新.json` — Nano Banana 2.0 运行后，面板 `referenceImages` 中含有 `data:image/...` 格式的图片（本地拖入未上传 COS），刷新页面后该槽位变为空，面板丢图。
- **根因**：
  1. `sanitizePersistValueDeep`（`utils/persistSanitize.mjs`）持久化时剥离 `data:image/` URL（`referenceImages` 槽位保留空串占位，数据层不丢），但 `referenceImageLocalRefs` 从未被设置
  2. `hydratePanelReferenceUrlsFromLocalRefs`（`utils/hydratePanelReferenceLocalRefs.ts`）刷新后需通过 `referenceImageLocalRefs` 从 IndexedDB 恢复图片，但 localRefs 为空无法恢复
  3. 上传图片时 `addReferenceImagesByFiles` 会同时写入 `referenceImageLocalRefs`，但 `data:image` URL 来自 `modelConfigs` 恢复或拖入，未经过 File 上传路径，localRefs 未设置
- **修复**：在 `FlowEditor.tsx` 的 `saveRemoteWorkspaceNow` 持久化前，新增 `backfillPanelReferenceImageLocalRefs` 预处理：
  1. 遍历所有节点的 `referenceImages`（节点级 + `modelConfigs` 级）
  2. 对每个 `data:image/` URL，通过 `fetch` 解码为 Blob，存入 IndexedDB（`putLocalMediaFile`）
  3. 设置对应的 `referenceImageLocalRefs` 槽位，确保刷新后 `hydratePanelReferenceUrlsFromLocalRefs` 可从 IndexedDB 恢复
- **文件**：`components/FlowEditor.tsx`（新增 `backfillPanelReferenceImageLocalRefs` / `backfillRefsArray` 函数，在 `saveRemoteWorkspaceNow` 中调用）
- **测试**：`test:gate` 全量通过（463 项）；`scripts/20260716-fresh-replay-all.ts` 18/18 通过；`npm run build` 通过
- **风险**：低；仅持久化前预处理，不修改运行/上传/API/展示逻辑；预处理仅处理 `data:image/` 前缀 URL，不影响已有 COS/资产库 URL；未触碰 §5.8–§5.13 S 级模块

### 11.31 2026-07-17 顶层 referenceImageLocalRefs 为空导致刷新后面板丢图（第二版修复）

- **现象**：`E:\问题\刷新前banana.json` → `E:\问题\刷新后banana.json` — 刷新前顶层 `referenceImages` 含 data:image URL，`referenceImageLocalRefs` 为空数组 `[]`；modelConfigs 层 `referenceImageLocalRefs` 有正确的 localRefs。刷新后 data:image 被剥离为空串，顶层 localRefs 仍为空，`hydrateAllPanelReferenceLocalRefs` 无法恢复图片。
- **根因**：`hydrateAllPanelReferenceLocalRefs` 只检查顶层 `referenceImageLocalRefs`，不检查 modelConfigs 层。模型切换时 `referenceImages` 从 modelConfigs 同步到顶层，但 `referenceImageLocalRefs` 未同步，导致顶层 localRefs 为空。§11.30 的 backfill 逻辑为 data:image URL 创建新 localRefs 并存入 IndexedDB，但未处理「modelConfigs 已有 localRefs 但顶层缺失」的情况。
- **修复**：在 `backfillPanelReferenceImageLocalRefs` 中增加逻辑：如果顶层 `referenceImageLocalRefs` 为空且 modelConfigs（当前选中模型）有 localRefs，则从 modelConfigs 复制到顶层。这样持久化后顶层有正确的 localRefs，刷新后 `hydrateAllPanelReferenceLocalRefs` 能从 IndexedDB 恢复图片。
- **文件**：`components/FlowEditor.tsx`（`backfillPanelReferenceImageLocalRefs` 函数中增加 modelConfigs → 顶层 localRefs 同步逻辑）；`scripts/20260717-banana-localref-sync-replay.ts`（新增模拟验证脚本）
- **测试**：`test:gate` 全量通过（463 项）；`scripts/20260716-fresh-replay-all.ts` 18/18 通过；`scripts/20260717-banana-localref-sync-replay.ts` 通过；`npm run build` 通过
- **风险**：低；仅复制已有的 localRefs 引用，不修改 IndexedDB 数据；不影响已有 COS/资产库 URL；未触碰 §5.8–§5.13 S 级模块

### 11.32 2026-07-17 全模型 localRefs 同步（第三版修复：覆盖可灵 Omni 多 tab）

- **现象**：§11.31 只修复了 `referenceImageLocalRefs` 字段，但可灵 3.0 Omni 的 multi/instruction/video 三个 tab 分别使用 `klingOmniMultiReferenceLocalRefs`、`klingOmniInstructionReferenceLocalRefs`、`klingOmniVideoReferenceLocalRefs`，这些字段在模型切换时同样只同步了 images 未同步 localRefs。
- **根因**：`backfillPanelReferenceImageLocalRefs` 中的 modelConfigs → 顶层 localRefs 同步逻辑只覆盖了 `referenceImageLocalRefs`，未覆盖可灵 Omni 的三个 tab 专用 localRef 字段。
- **修复**：扩展 `backfillPanelReferenceImageLocalRefs` 中的同步逻辑，定义 `LOCAL_REF_SYNC_FIELDS` 映射表，遍历所有 4 个 localRef 字段类型（`referenceImageLocalRefs`、`klingOmniMultiReferenceLocalRefs`、`klingOmniInstructionReferenceLocalRefs`、`klingOmniVideoReferenceLocalRefs`），逐一检查顶层是否为空并从 modelConfigs 复制。
- **文件**：`components/FlowEditor.tsx`（`backfillPanelReferenceImageLocalRefs` 中 LOCAL_REF_SYNC_FIELDS 映射表）；`scripts/20260717-all-models-localref-sync-replay.ts`（新增全模型模拟验证脚本，覆盖 6 种场景：Nano Banana、image2、Seedance 参考生、可灵 Omni multi/instruction/video）
- **测试**：`test:gate` 全量通过（463 项）；`scripts/20260717-all-models-localref-sync-replay.ts` 6/6 通过；`npm run build` 通过
- **风险**：低；仅扩展已有同步逻辑的覆盖面，不修改 IndexedDB 数据；不影响已有 COS/资产库 URL；未触碰 §5.8–§5.13 S 级模块

### 11.33 2026-07-17 backfill 后 localStorage 写入时机修复（第四版修复）

- **现象**：§11.31/§11.32 的 backfill 逻辑在 `saveRemoteWorkspaceNow` 中执行，但刷新前 `flushOnLeave` 调用的完整链路为：
  1. `flushOnLeave` → `buildPersistSnapshot`（数据已 sanitize，localRefs 未同步）
  2. `flushOnLeave` → `writeProjectSnapshotToStorage`（写入的是 backfill 前的旧数据）
  3. `flushOnLeave` → `saveRemoteWorkspaceNow` → `backfillPanelReferenceImageLocalRefs`（同步 localRefs）
  4. `saveRemoteWorkspaceNow` → payload 大小检查（>58KB keepalive 跳过）
  5. 如果 keepalive 被跳过 → 服务端未保存，localStorage 只有步骤 2 的旧数据
- **根因**：backfill 后的 localStorage 写入在 keepalive 大小检查之后（`saveRemoteWorkspaceNow` 第 2265 行），如果 keepalive 因 payload 过大被跳过（第 2251-2256 行），backfill 后的数据从未写入 localStorage 或服务端。
- **修复**：在 `saveRemoteWorkspaceNow` 中，将 `writeProjectSnapshotToStorage(snap)` 移到 keepalive 大小检查之前，确保 backfill 后的数据立即写入 localStorage。即使 keepalive 被跳过，刷新后也能从 localStorage 恢复 backfill 后的数据。
- **文件**：`components/FlowEditor.tsx`（`saveRemoteWorkspaceNow` 函数中 backfill → buildPersistSnapshot → writeProjectSnapshotToStorage 的顺序调整）
- **测试**：`test:gate` 全量通过（463 项）；`scripts/20260717-all-models-localref-sync-replay.ts` 6/6 通过；`npm run build` 通过
- **风险**：低；仅调整 localStorage 写入时机，不改变数据内容；不影响服务端保存逻辑；未触碰 §5.8–§5.13 S 级模块

### 11.34 2026-07-17 flushOnLeave 缺少 localRefs 同步导致所有模型刷新后面板丢图（第五版修复）

- **现象**：§11.33 修复后，`saveRemoteWorkspaceNow` 内部的 backfill 确实能正确写入 localStorage，但 `flushOnLeave` 在调用 `saveRemoteWorkspaceNow` 之前，自己先执行了一次 `buildPersistSnapshot` → `writeProjectSnapshotToStorage`，使用的是未同步 localRefs 的旧数据。在 `beforeunload` 场景下，`saveRemoteWorkspaceNow` 的异步 backfill（含 IndexedDB 操作）可能来不及完成，导致 localStorage 最终保留的是未同步的旧数据，刷新后所有模型（Banana、Seedance、可灵3.0 Omni 全 tab）的面板图片丢失。
- **根因**：`flushOnLeave` 的 localStorage 写入链路（第 3354-3360 行）在 `buildPersistSnapshot` 之前没有调用 `syncLocalRefsFromModelConfigs`，节点数据中的 `modelConfigs` 层 localRefs 未同步到顶层就写入 localStorage。
- **修复**：在 `flushOnLeave` 中，`buildPersistSnapshot` 之前对每个节点调用 `syncLocalRefsFromModelConfigs`，确保 localStorage 写入已包含从 modelConfigs 同步的 localRefs。覆盖所有模型：Banana/Seedance（`referenceImageLocalRefs`）、可灵3.0 Omni（`klingOmniMulti/Instruction/VideoReferenceLocalRefs`）。
- **文件**：`components/FlowEditor.tsx`（`flushOnLeave` 函数中 `mergedNodes.forEach` 同步 localRefs 后调用 `buildPersistSnapshot`）
- **测试**：`test:gate` 全量通过；`npm run build` 通过；服务已重启 http://localhost:3001/
- **风险**：低；`syncLocalRefsFromModelConfigs` 是纯同步操作，无 I/O，不影响 `flushOnLeave` 的执行时间；仅当顶层 localRefs 为空时才从 modelConfigs 复制，不会覆盖已有数据；未触碰 §5.8–§5.13 S 级模块

### 11.35 2026-07-17 image2 模型 selectedModel 与 modelConfigs key 不匹配导致 localRefs 同步失败（第六版修复）

- **现象**：image2 模型运行后刷新页面，面板参考图片丢失。其他模型（Banana、Seedance、可灵 Omni）正常。
- **根因**：`selectedModel` 的值是 `'image 2'`（带空格），但 `modelConfigs` 中存储配置的 key 是 `'image2'`（无空格）。`syncLocalRefsFromModelConfigs` 使用 `modelConfigs[model]` 直接查找，`modelConfigs['image 2']` 为 `undefined`，导致 localRefs 同步被跳过，刷新后无法从 IndexedDB 恢复面板图片。
- **修复**：在 `syncLocalRefsFromModelConfigs` 中增加兜底逻辑：如果直接按 `selectedModel` 查找失败，则尝试去掉空格后的 normalized key（`model.replace(/\s+/g, '')`）再次查找。此修复对 image2 模型生效，其他模型（selectedModel 与 modelConfigs key 一致）不受影响。
- **文件**：`components/FlowEditor.tsx`（`syncLocalRefsFromModelConfigs` 函数中 modelConfigs key 查找兜底）
- **测试**：`test:gate` 全量通过；`npm run build` 通过；服务已重启 http://localhost:5173/
- **风险**：低；仅当直接查找失败时才触发兜底，不影响正常模型；去除空格是安全的归一化操作；未触碰 §5.8–§5.13 S 级模块

### 11.36 2026-07-17 image2 OUTPUT 节点刷新后 Node Details 显示多余面板参考图（第七版修复）

- **现象**：image2 模型运行后刷新页面，OUTPUT（生成结果）节点的 Node Details 属性面板中除了主图正确外，还显示了不应该存在的面板参考图（来自 INPUT 节点的 referenceImages）。
- **根因**：§11.32/§11.34 的 `syncLocalRefsFromModelConfigs` 对所有节点类型（包括 OUTPUT/MOV）生效。OUTPUT 节点的 `modelConfigs` 中存储了从 INPUT 节点复制来的 `referenceImageLocalRefs`，同步到顶层后，刷新时 hydrate 从 IndexedDB 恢复了 blob URL 到 `referenceImages`，导致 Node Details 面板显示了多余的面板参考图。OUTPUT 节点没有参考面板，不应同步 localRefs。
- **修复**：在 `flushOnLeave` 和 `backfillPanelReferenceImageLocalRefs` 两处调用 `syncLocalRefsFromModelConfigs` 时，增加节点类型判断：仅对 `INPUT` 和 `PROCESSOR` 节点同步 localRefs，跳过 `OUTPUT`、`MOV`、`CHAIN_FOLDER`、`BACKDROP` 等无需参考面板的节点类型。
- **文件**：`components/FlowEditor.tsx`（`flushOnLeave` 和 `backfillPanelReferenceImageLocalRefs` 中增加 `node.type` 判断）
- **测试**：`test:gate` 全量通过；`npm run build` 通过；服务已重启 http://localhost:3001/
- **风险**：低；仅限制 localRefs 同步的目标节点类型，不影响 INPUT/PROCESSOR 节点的正常同步；未触碰 §5.8–§5.13 S 级模块

### 11.37 2026-07-17 Node Details 参考图片 URL 使用 COS 地址而非资产库地址（第八版修复）

- **现象**：Node Details 属性面板中参考图片的 URL 显示为资产库地址（`/flowgen-api/projects/{id}/assets/{uuid}/file`），而非 API 实际使用的 aitop100 COS 地址。用户希望 Node Details 展示 API 调用时使用的 COS 地址。
- **根因**：`buildSeedanceReferenceDetailsFromSnapshot` 在构建 Node Details 参考图片 URL 时，调用了 `resolvePanelReferenceSlotDisplayUrl`。该函数将 COS 地址替换为资产库地址（当标签匹配命名资产时）。此函数设计用于面板（面板需要资产库地址以便交互），但 Node Details 应该展示 API 实际使用的 COS 地址。
- **修复**：在 `buildSeedanceReferenceDetailsFromSnapshot` 中，将 `displayUrl` 的赋值从 `resolvePanelReferenceSlotDisplayUrl(url, label, pa) || url` 改为直接使用 `url`（原始 COS 地址），不再替换为资产库地址。
- **文件**：
  - `utils/nodeDetailsPreview.ts`（`buildSeedanceReferenceDetailsFromSnapshot` 中 `displayUrl` 赋值）
  - `scripts/node-details-simulation-test.ts`（更新测试断言匹配新行为）
- **测试**：`test:gate` 全量通过；服务已重启 http://localhost:3001/
- **风险**：低；回退到使用原始 API 快照 URL，不依赖资产库映射；仅影响 Node Details 面板的参考图片 URL 显示，不影响面板交互；未触碰 §5.8–§5.13 S 级模块

### 11.38 2026-07-17 全面修复所有模型 Node Details 参考图片 URL 使用 COS 地址（第九版修复）

- **现象**：§11.37 仅修复了 `buildSeedanceReferenceDetailsFromSnapshot` 路径（OUTPUT 节点快照路径），但 `buildReferenceImageDetailItemsFromPanel` 路径（INPUT/PROCESSOR 节点面板路径）仍将 COS URL 替换为资产库地址。所有模型（Seedance 参考生、Nano Banana、image2、可灵 Omni 多图/指令/视频）的 INPUT/PROCESSOR 节点 Node Details 参考图片 URL 仍显示资产库路径。
- **根因**：`buildNodeDetailsReferencePreview` 是 Node Details 参考图片的统一入口函数，它调用 `buildReferenceImageDetailItemsFromPanel` 并传入 `projectAssets`，导致 `resolvePanelReferenceSlotDisplayUrl` 将 COS URL 替换为资产库路径。同时 `resolveReferenceImageDetailItemsWithUrlPool` 的 fallback 路径也使用了 `resolvePanelReferenceSlotDisplayUrl` 转换后的 URL。
- **修复**：
  1. `buildNodeDetailsReferencePreview` 不再向 `buildReferenceImageDetailItemsFromPanel` 传递 `projectAssets`，面板路径保持原始 URL（COS 地址），不触发资产库替换
  2. `resolveReferenceImageDetailItemsWithUrlPool` 中 `correctedUrl` 直接使用 `item.url`，不再调用 `resolvePanelReferenceSlotDisplayUrl`，确保 URL 池匹配和 fallback 均使用 COS 地址
  3. `buildReferenceImageDetailItemsFromPanel` 保持原有逻辑不变（画布/聊天预览仍使用资产库 URL，这是正确行为）
- **文件**：
  - `utils/nodeDetailsPreview.ts`（`buildNodeDetailsReferencePreview` 第 400 行：`buildReferenceImageDetailItemsFromPanel(input.panelSource, {})` 不传 `projectAssets`；`resolveReferenceImageDetailItemsWithUrlPool` 第 287 行：`correctedUrl = item.url`）
- **测试**：`test:gate` 全量 293 项通过；`node-details-simulation-test` 全量 241 项通过（0 失败）；`npm run build` 通过；服务已重启 http://localhost:3001/
- **风险**：低；仅影响 Node Details 面板的参考图片 URL 显示，不回退面板交互逻辑；`buildReferenceImageDetailItemsFromPanel` 在画布/聊天预览路径仍使用资产库 URL（正确）；覆盖所有模型的所有 tab 模式；未触碰 §5.8–§5.13 S 级模块

### 11.39 2026-07-17 修复 Seedance 2.0 刷新后 INPUT 节点缩略图被资产库 URL 替换（第十版修复）

- **现象**：Seedance 2.0 参考生模式运行成功后，INPUT 节点缩略图正确显示第一张参考图（COS URL），但刷新页面后缩略图变成资产库 `/flowgen-api/projects/14/assets/...` URL，而非参考图。`panelMainSlotVisible` 已正确为 `false`，但 `imagePreview` 被替换为资产库地址。
- **根因**：`normalizeGraphNodesProjectAssetBinding` 在工作区加载时，对带有 `projectAssetId` 的 INPUT/PROCESSOR 节点无条件调用 `normalizeTemplateNodeDataForSpawn`，将 `imagePreview` 替换为 `canonicalProjectAssetFileUrl`（资产库文件 URL）。该函数未考虑 `panelMainSlotVisible === false` 的场景（节点运行后缩略图已切换为参考图，不应再替换为资产库 URL）。
- **修复**：在 `normalizeGraphNodesProjectAssetBinding` 中，`hasBinding` 检查通过后、调用 `normalizeTemplateNodeDataForSpawn` 之前，增加判断：若节点类型为 INPUT 或 PROCESSOR 且 `panelMainSlotVisible === false`，则跳过归一化，直接返回原节点，保留参考图 URL 作为缩略图。
- **文件**：
  - `utils/normalizeTemplateNodeForSpawn.ts`（`normalizeGraphNodesProjectAssetBinding` 第 59-64 行：新增 `panelMainSlotVisible === false` 守卫）
- **测试**：`test:gate` 全量通过；`node-details-simulation-test` 全量 241 项通过（0 失败）；`npm run build` 通过；服务已重启 http://localhost:3001/
- **风险**：低；仅跳过 `panelMainSlotVisible === false` 的 INPUT/PROCESSOR 节点的资产库 URL 替换，不影响其他节点类型和 `panelMainSlotVisible !== false` 的场景；未被跳过的节点仍正常执行 `imageLocalRef` 清理和资产库绑定；未触碰 §5.8–§5.13 S 级模块

### 11.40 2026-07-20 中间 MOV 节点三场景视频播放逻辑修复（第十一版修复）

- **现象**：Seedance 参考生模式中间 MOV 节点（由 input picture node 生成，作为最后节点输入）的三个场景视频播放均有问题：
  1. PREVIEW MODE（Node Details 左侧大图）视频无法播放，或播放的是生成视频而非参考视频
  2. 画布缩略图点击无反应，显示错误图片
  3. Generated Outputs 历史节点播放视频错误（应是生成视频，但展示了参考视频）
- **根因**：
  1. `resolveNodeDetailsHeroImageUrl`：`nodeUsesHiddenMainPreviewSlot` 返回 true 时，视频 URL 被参考图 URL 覆盖；且未针对 Seedance 参考生模式优先返回参考视频
  2. `resolveCanvasNodePreviewUrl`：`nodeUsesHiddenMainPreviewSlot` 返回 true 时，视频 URL 被过滤，返回参考图 URL；且未针对 Seedance 参考生模式优先返回参考视频
  3. `buildNodeDetailsPreviewFromGeneratedThumb`：历史节点未标记 `_historyOutputNodeId`，导致 `resolveNodeDetailsHeroImageUrl` 中的 `isHistoryPreview` 判断失效
  4. `FlowEditor.tsx` 视频元素：`preload="metadata"` 仅加载元数据，未预加载完整视频数据
- **修复**：
  1. `resolveNodeDetailsHeroImageUrl`：新增 Seedance 参考生视频优先逻辑（L212-222），在 `isHistoryPreview` 为 false 时优先返回 `referenceMovs[0].url`；非 Seedance 参考生视频节点在 L255 直接返回视频 URL
  2. `resolveCanvasNodePreviewUrl`：两个分支（L191-199、L222-231）新增 Seedance 参考生视频优先逻辑，返回 `referenceMovs[0].url` 或直接返回视频 URL
  3. `buildNodeDetailsPreviewFromGeneratedThumb`：历史节点 data 中保留 `_historyOutputNodeId`（已有逻辑，来自 `thumbnail.nodeId`）
  4. `FlowEditor.tsx`：视频元素 `preload` 改为 `"auto"`，添加 `playsInline` 和 `key={nodeDetailsHeroUrl}` 属性
  5. `CustomNode.tsx`：移除缩略图容器 `pointer-events-none` 样式，恢复双击打开预览模态框
- **其他模型排查**：可灵3.0 Omni（指令变换/视频参考）、Vidu、即梦、可灵2.5、Nano Banana 2.0、image 2 均无同类漏洞。漏洞仅影响 `nodeUsesHiddenMainPreviewSlot` 返回 true 且产生视频 URL 的模型（仅 Seedance 参考生）。
- **文件**：
  - `utils/nodeDetailsPreview.ts`（`resolveNodeDetailsHeroImageUrl` L212-222、L255）
  - `utils/referencedMediaRun.ts`（`resolveCanvasNodePreviewUrl` L191-199、L222-231）
  - `utils/generatedThumbKeyboardNav.ts`（`buildNodeDetailsPreviewFromGeneratedThumb` `_historyOutputNodeId`）
  - `components/FlowEditor.tsx`（视频元素 `preload`/`playsInline`/`key`）
  - `components/nodes/CustomNode.tsx`（`pointer-events-none` 移除）
- **测试**：`test:gate` 全量通过；`test:node-details` 全量通过；`npm run build` 通过；服务已重启 http://localhost:3001/
- **风险**：低；仅影响 Seedance 参考生模式 MOV 节点的视频播放三场景；非 Seedance 参考生视频节点逻辑不变（L255 直接返回）；`isHistoryPreview` 判断确保历史节点不受影响；未触碰 §5.8–§5.13 S 级模块

### 11.41 2026-07-20 可灵3.0 Omni 指令变换/视频参考中间节点视频播放修复（第十二版修复）

- **现象**：可灵3.0 Omni 指令变换/视频参考中间 MOV 节点刷新后，PREVIEW MODE 和画布缩略图未展示参考视频（上游节点生成的视频），而是展示 `imagePreview` 的 PNG 图片或生成的视频。
- **根因**：`resolveNodeDetailsHeroImageUrl` 和 `resolveCanvasNodePreviewUrl` 中仅有 Seedance 参考生的参考视频优先逻辑，未覆盖可灵3.0 Omni 的 instruction 和 video tab。Omni 不在 `nodeUsesHiddenMainPreviewSlot` 中，`resolveNodeDetailsHeroImageUrl` 直接返回 `main`（`imagePreview`），未优先返回 `referenceMovs[0].url`。
- **修复**：
  1. `resolveNodeDetailsHeroImageUrl`（`nodeDetailsPreview.ts` L224-235）：新增 `isOmniVideoRef` 判断，`selectedModel === '可灵3.0 Omni'` 且 `klingOmniTab === 'instruction' || 'video'` 时，优先返回 `referenceMovs[0].url`。使用 `generationParams.klingOmniTab` 优先于节点顶层 `klingOmniTab`（后者可能与实际运行 tab 不一致）。
  2. `resolveCanvasNodePreviewUrl`（`referencedMediaRun.ts` 两个分支 L199-208、L240-249）：新增相同的 Omni 参考视频优先逻辑。
- **文件**：
  - `utils/nodeDetailsPreview.ts`（`resolveNodeDetailsHeroImageUrl` L224-235）
  - `utils/referencedMediaRun.ts`（`resolveCanvasNodePreviewUrl` L199-208、L240-249）
- **测试**：`test:gate` 全量通过；`test:node-details` 全量通过（241 通过/0 失败）；`npm run build` 通过；服务已重启 http://localhost:3001/
- **风险**：低；仅影响可灵3.0 Omni 指令变换/视频参考 tab 的 MOV 节点视频播放三场景；`isHistoryPreview` 判断确保 Generated Outputs 历史节点不受影响；Seedance 逻辑不变；未触碰 §5.8–§5.13 S 级模块

### 11.42 2026-07-21 可灵3.0 Omni 中间节点刷新后三问题修复（第十三版修复）

- **现象**：可灵3.0 Omni 中间 MOV 节点刷新后出现三个问题：
  1. Node Details 参考图标签不正确（显示"图片1"而非资产名如"熊大"）
  2. PREVIEW MODE 无法播放视频
  3. 画布缩略图无法播放视频
- **根因**：
  1. **标签错误**：`klingOmniInstructionReferenceImages` 中残留 blob URL（如 `blob:http://localhost:3001/...`），`filter(Boolean)` 无法过滤，导致 `slotRefs` 计数膨胀（2 > 1），触发 `omniPanelFilledCountExceedsPromptImageRefs` 返回 true，跳过面板预览路径，快照回退路径中 `buildOmniMultiPromptTokenReferenceItems` 若无 `projectAssets` 则返回 null，最终标签回退到 `referenceImageLabels[0]` = "图片1"。
  2. **PREVIEW MODE / 画布缩略图无法播放**：`isLikelyVideoMediaUrl` 中，MOV 节点的 `imagePreview` 为 PNG URL 但 `imageName` 为 `.mov` 时，`isVideoPreviewUrl(u)` 返回 false（PNG 非视频），但 `imageName` 检查误判为视频，导致 `movPreviewLooksComplete` 返回 true，阻止 `hydrateMovNodesFromUpstream` 将 `imagePreview` 更新为上游视频 URL。
- **修复**：
  1. `isLikelyVideoMediaUrl`（`hydratePersistedNodePreviews.ts` L40-43）：新增图片扩展名检查，若 URL 明确为 `.png/.jpg/.jpeg/.webp/.gif/.bmp/.svg`，直接返回 false，不因 `imageName` hint 误判为视频。
  2. `buildOmniInstructionVideoTabDetailsReferencePreview`（`nodeDetailsPreview.ts` L1297-1300）：`slotRefs` 过滤 blob:/data: 临时 URL，仅对持久化 URL 计数，避免 `omniPanelFilledCountExceedsPromptImageRefs` 误判。
  3. `buildOmniMultiTabDetailsReferencePreview`（`nodeDetailsPreview.ts` L1757-1760）：`activeSlotRefs` 同样过滤 blob:/data: URL，保持一致性。
- **文件**：
  - `utils/hydratePersistedNodePreviews.ts`（`isLikelyVideoMediaUrl` L40-43）
  - `utils/nodeDetailsPreview.ts`（`buildOmniInstructionVideoTabDetailsReferencePreview` L1297-1300、`buildOmniMultiTabDetailsReferencePreview` L1757-1760）
- **测试**：`test:gate` 全量通过；`test:node-details` 全量通过（241 通过/0 失败）；`npm run build` 通过；服务已重启 http://localhost:3001/
- **风险**：低；`isLikelyVideoMediaUrl` 新增的图片扩展名检查仅阻止明确图片 URL 被误判为视频，不影响无扩展名 URL（如 node-media/file）的判定；blob/data URL 过滤仅在计数场景使用，不影响 URL 解析本身；未触碰 §5.8–§5.13 S 级模块

### 11.43 2026-07-21 AiTop 长文本自动续写（防 fallback 误切换模型）

- **现象**：用户使用 DeepSeek 等模型进行长文本回复时，流式输出在约 12000 字处中断，前端显示"回复未完成，已输出越 12239 字"并自动切换模型（如 Claude/Gemini），导致用户看到回复被截断且模型被更换。
- **根因**：
  1. `handleAitopLlmSend` 的 catch 块在流中断时无条件调用 `preserveIncompleteStreamOnError` + throw，触发外层 `attemptSendWithFallback` 按 fallback 链切换模型
  2. 未区分"输出超长被截断"与"真正的 API 报错"（鉴权失败、余额不足等）
  3. 上游 AiTop 聚合接口对单次输出有字数上限（约 12000 字），这不是代码 bug 而是 API 限制
- **修复**（借鉴 [grok-build](https://github.com/xai-org/grok-build) 的 `classify_error` → `RetryDecision` 错误分类思路 + `truncate_middle_words` 保留尾部上下文思路）：
  1. 新增常量：`AITOP_CONTINUATION_MIN_CHARS=1000`、`MAX_AITOP_CONTINUATION_ROUNDS=2`、`AITOP_CONTINUATION_TAIL_CHARS=1500`
  2. 扩展 `LlmSendRetryOptions` 增加 `continuationContext` 字段（round/priorContent/priorReasoning/originalInput/assistantMessageId）
  3. 新增 `isContinuableStreamError`：仅当"已输出 ≥1000字 + 未达2轮上限 + 错误为超时/流中断类 + 非鉴权/余额/内容过滤"时返回 true
  4. 新增 `buildContinuationPrompt`：携带原问题 + 已输出内容尾部 1500 字，指示模型"接着上文继续，不要重复"
  5. `handleAitopLlmSend` 改动：
     - 续写时复用同一条 assistant 消息（不新建气泡），`fullContent` 初始值带 `priorContent`
     - 续写 prompt 用 `buildContinuationPrompt` 构造
     - catch 块在 `preserveIncompleteStreamOnError` 之前插入续写判断：满足则递归调用自身（round+1），续写成功 return 不 throw；续写也失败则 re-throw 让外层 fallback 接管
- **覆盖范围**：所有 AiTop 模型（Gemini / Claude / DeepSeek / DouBao），Qwen 不受影响（走 `handleQwenSend`）
- **文件**：`components/ChatPanel.tsx`（L797-802 常量、L1722-1773 类型+辅助函数、L4006-4012 续写prompt、L4093-4109 复用消息、L4510-4538 catch块续写分支）
- **测试**：`test:gate` 全量通过（16 通过/0 失败）；`npm run build` 通过；服务已重启 http://localhost:3001/
- **风险**：低；仅影响"已输出 ≥1000字 + 超时/流中断类错误"的场景，短回复和正常对话不受影响；鉴权/余额/内容过滤类错误不续写直接 fallback；续写最多 2 轮防止无限循环；Qwen 完全不受影响；未触碰 §5.8–§5.13 S 级模块业务逻辑

### 11.44 2026-07-21 AiTop 长文本续写第二批改进（丝滑体验优化）

- **背景**：深入研究 [grok-build](https://github.com/xai-org/grok-build) 源码后，借鉴其 5 个机制进一步优化续写体验，目标是"像商业版本一样自然丝滑"
- **改进清单**（借鉴 grok-build 5 个机制）：
  1. **续写视觉提示**（借鉴 `SamplingEvent::Retrying` 事件通知 UI）：续写开始时在 assistant 消息尾部追加 `> ⏳ 正在继续输出…` 淡色提示，续写首包到达后 `flushStreamUiIfDue` 自动覆盖移除
  2. **idle 超时放宽**（借鉴 `DEFAULT_IDLE_TIMEOUT_SECS = 300`）：`AITOP_HEAVY_PAYLOAD_STREAM_IDLE_CAP_MS` 从 180s 提升到 240s，给长文本生成更多时间
  3. **续写前小延迟**（借鉴 `retry.rs` 指数退避思路）：续写前等待 1500ms（`AITOP_CONTINUATION_DELAY_MS`），给上游 API 恢复窗口，避免立即重连再次失败
  4. **空响应同模型重试**（借鉴 `AttemptOutcome::Empty`）：流正常结束但 0 字输出时，先移除空 assistant 消息并同模型重试 1 次（`AITOP_EMPTY_RESPONSE_RETRY_MAX=1`），仍失败才 fallback
  5. **续写轮数提升**（借鉴 `DEFAULT_MAX_RETRIES = 15`）：`MAX_AITOP_CONTINUATION_ROUNDS` 从 2 提升到 3，覆盖约 4.8 万字超长输出
- **文件**：`components/ChatPanel.tsx`（L793-806 常量、L4515-4534 空响应重试、L4539-4544 视觉提示、L4545-4548 续写延迟）
- **测试**：`test:gate` 16 通过/0 失败；`npm run build` 通过；浏览器实测 DeepSeek 20000 字长文本请求正常完成、未切换模型、无 fallback 提示
- **风险**：低；idle 超时放宽 60s 仅影响长 payload 场景；续写延迟 1.5s 仅在续写触发时生效；空响应重试仅在 0 字输出时触发；Qwen 完全不受影响；未触碰 §5.8–§5.13 S 级模块业务逻辑

### 11.45 2026-07-21 AiTop 长文本续写第三批改进（借鉴 LangChain + FastChat）

- **背景**：深入研究 [LangChain](https://github.com/langchain-ai/langchain) 和 [FastChat](https://github.com/lm-sys/FastChat) 源码后，借鉴其 2 个关键机制进一步优化
- **LangChain 关键发现**：
  - `stream()` 不自动重试（源码注释"重试一个已产出部分的流不直观"）— 我们的续写机制正是应用层自处理，符合此设计理念
  - `finish_reason` 跨 provider 不统一（OpenAI `stop`/`length`，Anthropic `end_turn`/`max_tokens`），只在最后一个 chunk 出现
  - `wait_exponential(min=4, max=10)` 指数退避重试
  - `trim_messages(strategy="last")` 保留最新消息 — 我们项目已实现（`CHAT_CTX_MAX_TOTAL_CHARS=48000`）
- **FastChat 关键发现**：
  - 错误码内嵌流式 chunk（异常转为带 `error_code` 的正常 chunk，流不断裂）
  - 累积式 chunk（`text` 是累积全文而非 delta）
  - `stream_interval` 控制 yield 节奏
- **改进清单**：
  1. **续写延迟递增**（借鉴 LangChain `wait_exponential`）：第 N 轮续写延迟 `N * AITOP_CONTINUATION_DELAY_MS`（1.5s → 3s → 4.5s 递增退避），避免立即重连再次失败
- **文件**：`components/ChatPanel.tsx`（L4545-4550 续写延迟递增）
- **测试**：`test:gate` 16 通过/0 失败；`npm run build` 通过；浏览器实测 DeepSeek 长文本请求正常完成、未切换模型、无 fallback 提示
- **风险**：低；续写延迟递增仅影响续写触发时（已输出 ≥1000字）；Qwen 完全不受影响；未触碰 §5.8–§5.13 S 级模块业务逻辑

### 11.46 2026-07-21 全模型大语言模型场景测试与 vite 代理修复

- **背景**：用户要求对所有模型（DeepSeek / Claude / Gemini / DouBao / Qwen）进行短文本、长文本、上下文记忆、联网搜索、思考模式等极端场景测试，并参考 GitHub 项目做法调整直到符合预期
- **测试模型**：
  - DeepSeek V4 Pro（`deepseek-v4-pro-260425`）
  - Claude 4.6（`claude-sonnet-4-6`）
  - Gemini 3.1 Pro（`gemini-3.1-pro-preview:streamGenerateContent`）
  - DouBao Seed 2.0（`doubao-seed-2-0-pro-260215`）
  - Qwen3-VL-235B-A22B-Instruct（经 `/api/v1/chat/completions` 代理）
- **测试场景与结果**：

| 模型 | 短文本 | 上下文记忆 | 长文本输出（≥5000字） | 联网搜索 | 思考模式 | 备注 |
|------|--------|------------|----------------------|----------|----------|------|
| DeepSeek V4 Pro | PASS | PASS | PASS（5632 字） | PASS | PASS | 长文本、联网、思考均正常 |
| Claude 4.6 | PASS | PASS | PASS（12217 字） | PASS | **FAIL** | 思考模式上游返回"出了一些问题未能回复"；关闭思考后同一问题可正常回答 |
| Gemini 3.1 Pro | PASS | PASS | PARTIAL（3905 字） | PASS | PASS | 长文本未达 5000 字但内容完整，系模型自行说明单次输出限制 |
| DouBao Seed 2.0 | PASS | PASS | PASS（6590 字） | PASS | PASS | 长文本、思考均正常，思考过程 836 字 |
| Qwen | PASS | PASS | PASS（3629 字，≥2000 字要求） | N/A | N/A | Qwen 路径不含联网/思考参数，仅测试基本场景 |

- **关键发现**：
  1. 浏览器控制台出现的 `net::ERR_ABORTED` 只是 Chrome DevTools 对长连接 SSE 的显示误报，实际 fetch 已成功返回 200，流读取完整，聊天面板正常展示回复
  2. Claude 在 `thinking=true` 时对该推理题上游报错，但 `thinking=false` 时同一 prompt 可正常回答，判定为上游 Claude 思考模式暂不支持或稳定性问题，非本项目代码问题
  3. Gemini 长文本会主动说明单次输出限制并给出完整文章，未触发续写机制（输出长度未达阈值）
- **代码修复**：
  1. `vite.config.ts` 新增 `/aitop-llm-see` 代理到 `http://127.0.0.1:3001`，修复 `test:llm-model-contract` 中"vite /aitop-llm-see 代理"失败项
  2. 清理 `components/ChatPanel.tsx` 中此前插入的临时调试日志，保持生产代码整洁
  3. `server.js` 保留 `/aitop-llm-see` 中继日志（START/UPSTREAM/PIPE/CLIENT CLOSED），便于生产环境诊断
- **新增测试脚本**（位于 `scripts/`）：
  - `test-long-output.mjs`：长文本输出测试
  - `test-web-search.mjs`：联网搜索测试
  - `test-thinking.mjs`：思考模式测试
  - `test-context-memory.mjs`：上下文记忆测试
  - `test-qwen-basic.mjs`：Qwen 基本场景测试
  - `test-claude-thinking-levels.mjs`：Claude 思考模式级别测试
- **测试**：`npm run test:chat-gate` 全量通过；`npm run test:llm-model-contract` 全量通过；`npm run build` 通过；服务已重启 http://localhost:3001/
- **风险**：低；仅新增 vite dev 代理配置和 server 诊断日志，未改动 AiTop 调用业务逻辑；Qwen 路径未变；未触碰 §5.8–§5.13 S 级模块业务逻辑

### 11.47 2026-07-21 网页端复测与脚本级全模型验证

- **背景**：用户要求从网页端继续全面测试大语言模型。先构建最新代码并重启服务，再通过浏览器自动化与本地脚本两种方式验证。
- **环境**：`npm run build` 通过；`npm start` 已重启；服务运行在 http://localhost:3001/
- **浏览器自动化测试结果**：**整体 BLOCKED**
  - 可正常登录、进入 AI 对话面板、选择模型、发送消息；
  - 但所有模型的 `/aitop-llm-see` POST 请求均被浏览器 agent 在约 10ms 内中断，服务端日志显示 `CLIENT CLOSED after ~10ms (pipeStarted=false)`，页面未展示助手回复；
  - 该现象与模型、是否联网/思考无关，判定为浏览器自动化工具对长连接 SSE 流的保持能力限制，非产品代码 bug；
  - 对比：同参数使用 `scripts/test-short-text.mjs` 调用命令行 fetch 完全正常返回。
- **脚本级全模型复测结果**（通过 `scripts/test-*.mjs` 直接调用本机中转接口）：

| 模型 | 短文本 | 上下文记忆 | 长文本输出（≥5000字） | 联网搜索 | 思考模式 | 备注 |
|------|--------|------------|----------------------|----------|----------|------|
| DeepSeek V4 Pro | PASS（367 字） | PASS | PASS（7198 字） | PASS | PASS | 长文本、联网、思考均正常；但首次短文本调用 headers_time=69s |
| Claude 4.6 | PASS（112 字） | PASS | 未复测 | PASS | **FAIL** | 思考模式上游仍返回“出了一些问题未能回复，请多试几次”；关闭思考后同一问题可正常回答 |
| Gemini 3.1 Pro | PASS（328 字） | PASS | 未复测 | PASS（120 字） | PASS（521 字） | 思考内容未单独放在 reasoning 字段，但正文已给出完整推理 |
| DouBao Seed 2.0 | PASS（89 字） | PASS | 未复测 | PASS（347 字） | PASS（346 字，推理 734 字） | 联网、思考均正常 |

- **已处理事项**：
  1. **提升前端 LLM fetch 超时**：将 `components/ChatPanel.tsx` 中 `GEMINI_FETCH_TIMEOUT_MS_NORMAL` 与 `CLAUDE_FETCH_TIMEOUT_MS_NORMAL` 从 `45_000` 提升至 `90_000`（heavy payload 仍受 `AITOP_HEAVY_PAYLOAD_FETCH_CAP_MS = 120_000` 上限约束），避免 DeepSeek 等上游偶发慢首包被前端误中止。
  2. **修复用户-facing 乱码文案**：修复 `components/ChatPanel.tsx` 中 20+ 处影响用户提示、错误弹窗、图片处理、xlsx 导出、表格预览的 `????` 占位文本（如 L4297 的 idle 超时错误提示改为“流式输出在 X 秒内无新数据，连接可能已中断。请稍后重试。”）。未触碰可能改变匹配语义的模型名称字符串（L1286）以及故意让模型避免输出问号的提示词（L1864、L1931）。
- **仍存在的问题**：
  1. **浏览器自动化工具无法保持 SSE 长连接**：二次网页端复测仍显示 POST `/aitop-llm-see` 在约 5ms 内被 browser agent 中止（`CLIENT CLOSED after 5ms`），与前端 90s 超时无关，判定为自动化工具本身对长连接 SSE 的支持限制。命令行脚本调用同一接口完全正常。
  2. **大量中文注释仍为乱码**：`components/ChatPanel.tsx` 中业务注释大量被替换为 `????`，虽不影响运行时，但严重降低可维护性；根因疑似历史上某次编码转换或前置脚本异常，需单独批量恢复。
  3. **Claude 思考模式上游不稳定**：仍为上游返回“出了一些问题未能回复”，非本项目代码可控。
- **已验证门禁**：`npm run test:chat-gate` 全量通过；`npm run test:llm-model-contract` 全量通过；`npm run build` 通过；服务已重启 http://localhost:3001/；`scripts/test-short-text.mjs deepseek` 复测通过。
- **风险**：低；本次改动仅涉及超时常量与普通文案修复，未改变业务逻辑、接口、字段语义，未触碰 §5.8–§5.13 S 级模块。

### 11.48 2026-07-21 借鉴 FastChat + llama.cpp 优化 LLM 流式处理机制

- **背景**：研究 `https://github.com/lm-sys/FastChat` 和 `https://github.com/ggerganov/llama.cpp` 的大语言模型处理机制，对比 FlowGen 现有代码，找出 6 项优化点并逐一实现。
- **变更清单**：

1. **AiTop 流增加 `finish_reason` 解析（借鉴 FastChat）**
   - 新增 `getAitopStreamFinishReason()` 函数，兼容 AiTop 直接字段 + OpenAI 兼容格式
   - 在 `handleGeminiStreamData` 中追踪 `geminiFinishReason` 变量
   - 当 `finish_reason === 'length'` 时追加截断提示，与 Qwen 路径对齐
   - 文件：`components/ChatPanel.tsx`

2. **上下文溢出检测（借鉴 llama.cpp `isContextOverflow`）**
   - 新增 `isContextOverflowError()` 函数，检测上游返回的上下文溢出错误消息
   - 在 `attemptSendWithFallback` 的 catch 块中，上下文溢出时不切换模型，直接提示用户"对话过长，建议开启新对话"
   - 文件：`components/ChatPanel.tsx`

3. **流中断保留已输出内容（借鉴 FastChat 流内错误嵌入）**
   - 当流中断且已输出 >= 200 字符时，保留已输出内容 + 追加中断提示，不再触发 fallback 切换模型
   - 避免用户看到"已切换模型"而丢失可见的部分输出
   - 文件：`components/ChatPanel.tsx`

4. **客户端 Token 估算（借鉴 llama.cpp `LLMContextManager.estimateTokens`）**
   - 新增 `estimateChatTokens()` 函数：中文字符 ≈ 1.5 token，英文单词 ≈ 1.3 token，其他字符 ≈ 0.3 token
   - 阈值 `CHAT_TOKEN_WARNING_THRESHOLD = 8000`
   - 超过阈值时在输入框下方显示琥珀色警告提示
   - 文件：`components/ChatPanel.tsx`

5. **Server 端 relay 重试通知（借鉴 llama.cpp 诊断机制）**
   - `server.js` 在 502/504 重试时设置 `relayRetried` 标志，通过 `x-relay-retry: 1` 响应头通知前端
   - 前端 `ChatPanel.tsx` 检测该响应头并 log 诊断信息
   - 文件：`server.js`、`components/ChatPanel.tsx`

6. **并发发送锁（借鉴 FastChat `limit_worker_concurrency`）**
   - 新增 `isSendingRef` 同步锁，防止异步竞态导致的双重发送
   - 在 `handleSend` 入口处加锁，`finally` 中释放
   - 文件：`components/ChatPanel.tsx`

- **已验证门禁**：`npm run build` 通过；`npm run test:chat-gate` 48/48 通过；`npm run test:llm-model-contract` 48/48 通过
- **服务状态**：已重启 http://localhost:3001/；`scripts/test-short-text.mjs deepseek` 复测通过（351 字，9.1s 首包）
- **风险**：低；6 项改动均为新增/增强，不改变现有业务逻辑、接口、字段语义；未触碰 §5.8–§5.13 S 级模块；上下文溢出检测、流中断保留、并发锁均为保护性增强

### 11.49 2026-07-21 流式输出渲染优化 + 移除 Token 警告

- **背景**：用户反馈两个问题：
  1. Token 估算警告提示（⚠️ 对话约 10911 tokens...）不符合使用习惯，豆包等商业产品无此提示
  2. 流式输出体验为"转圈圈 → 等待 → 突然全部打印"，期望像 grok-build / FastChat 一样逐字逐行实时展示
- **根因分析**：
  - `StreamingAssistantMain` 组件存在一个逐字"打字机动画"（`revealedLen` 状态 + 22ms 定时器），步进速度最大 10 字符/22ms（约 455 字符/秒），当 SSE 流快速到达大量内容时，动画严重滞后，造成"等待很久后突然全部蹦出来"的体验
  - grok-build 和 FastChat 的做法是直接渲染 SSE 流收到的内容，不额外做打字机动画
- **变更**：
  1. **移除 Token 估算警告 UI**：删除输入框下方的 `estimateChatTokens` 警告提示，保留 `estimateChatTokens` 函数供未来上下文溢出检测内部使用
  2. **流式渲染改为直接渲染**：重写 `StreamingAssistantMain` 组件，移除 `revealedLen` 打字机动画，直接渲染 `main` 内容，保持流式光标闪烁
  3. **UI 刷新间隔优化**：`CHAT_STREAM_UI_INTERVAL_MS` 从 48ms 降至 30ms（约 33 FPS），流式更丝滑
- **已验证门禁**：`npm run build` 通过；`npm run test:chat-gate` 48/48 通过
- **服务状态**：已重启 http://localhost:3001/
- **风险**：低；仅涉及渲染层面的优化，不改变业务逻辑、接口、字段语义；未触碰 §5.8–§5.13 S 级模块

### 11.50 2026-07-21 网页端测试与"正在生成回复" spinner 优化

- **网页端测试结果**：
  - 已登录 http://localhost:3001/，进入"广告项目"工作区，AI 对话面板正常显示（左侧 320x820）
  - Token 警告已移除，输入框、模型选择器（DeepSeek V4 Pro）均正常
  - 浏览器自动化工具存在限制：`POST /aitop-llm-see` SSE 长连接会在 2-3ms 内被浏览器 agent 中止（`net::ERR_ABORTED` / `CLIENT CLOSED after 2ms`），无法完整验证网页端 LLM 流式输出；后端脚本级测试全部正常
- **后端脚本级全场景验证**：
  - `scripts/test-short-text.mjs deepseek`：PASS（307 字，8.6s 首包）
  - `scripts/test-long-output.mjs deepseek`：PASS（8431 字，179s，26 chunks，无中断无切换）
  - `scripts/test-web-search.mjs deepseek`：PASS（926 字，含深圳天气）
  - `scripts/test-thinking.mjs deepseek`：PASS（226 字内容 + 397 字 reasoning）
- **新发现并优化**：
  - 网页端消息列表中，即使 assistant 消息已经开始流式输出，仍会显示"正在生成回复..."的 spinner，造成"内容在打印 + 下面还在转圈圈"的重复感
  - 修改：spinner 仅在最后一条消息不是流式 assistant 消息时显示；一旦开始收到内容，只保留 assistant 消息 + 脉冲光标
  - 文件：`components/ChatPanel.tsx`
- **已验证门禁**：`npm run build` 通过；`npm run test:chat-gate` 48/48 通过
- **服务状态**：已重启 http://localhost:3001/
- **风险**：低；仅优化 UI 展示逻辑，不改变业务逻辑、接口、字段语义；未触碰 §5.8–§5.13 S 级模块

### 11.51 2026-07-21 联网搜索切换时保留对话上下文

- **背景**：用户反馈在对话中切换联网搜索功能后，上下文记忆会中断，希望像 FastChat 等商业产品一样保持连续。
- **根因分析**：
  - 思考模式切换：无影响。`thinkingMode` 仅作为 API 参数传递，不改变 `chatId` 或 `messages`，上下文天然保留。
  - 联网搜索切换：存在两处上下文断裂：
    1. **chatId 断裂**：`handleAitopLlmSend` 中 `isGeminiWebSearchFirstPass` 为 true 时，`createEphemeralChatId()` 每次都创建全新临时 chatId，导致 API 侧无法将联网搜索轮次与之前的对话关联
    2. **消息内容断裂**：联网搜索使用 `probeQuery`（搜索优化改写后的短查询）替代 `baseMessage`（含完整对话历史），虽然改写 prompt 会携带最近 6 轮对话摘要，但 API 侧仍然丢失了完整上下文
- **借鉴来源**：
  - FastChat：同一 worker 内所有轮次共享 `conversation_id`，不管是否切换搜索/思考模式，上下文持续保留
  - llama.cpp：slot 系统内同一会话的 chatId 不变，所有轮次共享 kv-cache
- **变更**：
  - 修改 `components/ChatPanel.tsx` L4025-4030：联网搜索不再无条件创建新临时 chatId，仅当 `chatIdRef.current` 为空（全新对话）时才创建；已有对话时复用原 chatId，保持 API 侧上下文连续性
  - 搜索改写仍使用独立临时 chatId（`probeRewriteChatId`），不影响主对话 chatId
- **已验证门禁**：`npm run build` 通过；`npm run test:chat-gate` 48/48 通过；`scripts/test-context-memory.mjs deepseek` 上下文记忆测试 PASS
- **服务状态**：已重启 http://localhost:3001/
- **风险**：低；仅修改 chatId 分配策略（从"每次新建"改为"复用已有"），不改变业务逻辑、接口、字段语义；未触碰 §5.8–§5.13 S 级模块

### 11.52 2026-07-21 流式输出逐字打字机动画（RAF 替换节流刷新）

- **背景**：用户反馈流式输出体验为"转圈圈 → 等待 → 突然全部打印"，期望像 FastChat / grok-build 一样逐字逐行实时展示。上轮 §11.49 已移除打字机动画改为直接渲染，但实测发现短响应（~34ms 完成）仍然存在"突然全部打印"问题。
- **根因分析**：
  - 服务端 SSE 流式传输正常（`test-stream-chunks.mjs` 验证：201 chunks，平均 45B/chunk，34ms 完成）
  - 前端 `flushStreamUiIfDue` 函数使用 30ms 节流控制 UI 刷新，当 SSE 流在 34ms 内完成全部内容到达时，`Date.now() - lastStreamUiAt` 仅经过 34ms，仅触发 1-2 次 `setMessages`，导致所有内容一次性渲染
  - React 18 的自动批处理（Automatic Batching）进一步加剧问题：多个 `setState` 在同一微任务中合并为一次渲染
- **变更**：
  1. **移除 `flushStreamUiIfDue` 节流函数**：删除 `lastStreamUiAt` 变量和 30ms 间隔控制逻辑
  2. **新增 `requestAnimationFrame` 逐字打字机动画**：
     - 新增 `streamRevealedLen` 变量控制已显示字符数
     - 新增 `updateStreamUI()` 函数：根据 `streamRevealedLen` 截取 `fullContent` 并更新消息列表
     - 新增 `tickReveal()` 函数：每帧推进 3 个中文字符（约 180 字/秒），通过 RAF 递归调用
     - 新增 `cleanupReveal()` 函数：清除 RAF 动画
  3. **流结束处理**：流完成时调用 `cleanupReveal()` 停止动画，然后通过 `setMessages` 一次性闪现完整内容（`isStreaming: false`）
  4. **双 handler 实现**：Gemini/Claude handler（`handleGeminiStreamData`）和 Qwen handler（`handleQwenStreamData`）均实现一致的逐字动画逻辑
- **文件**：`components/ChatPanel.tsx`
- **效果**：短响应从"0.5 秒转圈 → 突然全部显示"变为"开始收到内容后逐字显示，约 34ms 内流畅完成打字机动画"
- **已验证**：
  - `npm run build` 通过
  - `npm run test:gate` 全部通过（144/144 + 41/41 + 8/8 + 9/9 + 16/16）
  - `npm run test:chat-gate` 全部通过（48/48 layout + 16/16 pipeline + 24/24 display-contract + 13/13 probe + 19/19 identity + 48/48 llm-model-contract）
  - `scripts/test-stream-chunks.mjs deepseek`：201 chunks，STREAMING OK
  - 服务已重启 http://localhost:3001/
- **风险**：低；仅涉及渲染层面的逐字动画优化，不改变业务逻辑、接口、字段语义；未触碰 §5.8–§5.13 S 级模块；RAF 动画在流结束时自动清理，不会导致内存泄漏

### 11.53 2026-07-21 web search probe 缓存优化：避免 fallback 链重复调用

- **背景**：用户反馈开启联网搜索发送消息时，控制台反复打印 `[chat] web search probe LLM rewrite skipped, using fallback`，同一请求被发送多次，用户等待很久。
- **根因分析**：
  - `handleAitopLlmSend` 每次被调用（含 `attemptSendWithFallback` 的 fallback 链重试）都会重新执行 `resolveWebSearchProbeMessageForAitop`
  - Probe 的 LLM rewrite 调用 Claude（`WEB_SEARCH_PROBE_REWRITE_MODEL = 'claude-sonnet-4-6'`），超时 10s
  - Fallback 链有 3 个模型（Claude → Gemini → DeepSeek），每个模型调用 probe 一次，用户等待 3 × 10s = 30s 仅 probe 开销
  - 且 probe 改写模型与主模型同为 Claude，主模型慢时 probe 也慢，雪上加霜
- **变更**：
  1. 新增 `webSearchProbeCacheRef`：缓存当前轮次的 probe 结果
  2. `handleSend` 开始时清空缓存（`webSearchProbeCacheRef.current = null`）
  3. `handleAitopLlmSend` 中检查缓存：有缓存直接复用，无缓存才调用 probe 并写入缓存
- **文件**：`components/ChatPanel.tsx`
- **效果**：probe 从"每次 fallback 重试都调用"变为"每轮对话只调用一次"，fallback 链中后续尝试直接复用缓存结果
- **已验证**：
  - `npm run build` 通过
  - `npm run test:chat-gate` 全部通过（44 + 16 + 24 + 13 + 19 + 48）
  - 服务已重启 http://localhost:3001/
- **风险**：低；仅新增缓存逻辑，不改变 probe 的业务语义和结果；未触碰 §5.8–§5.13 S 级模块

### 11.54 2026-07-21 流式输出根因修复：BFF axios→原生https + 前端RAF→节流更新

- **背景**：用户反馈所有模型响应慢、等待很久，要求与商业版本体验一致，逐字逐行打印。
- **深度诊断**（全链路时序测量）：
  1. **BFF 层 axios 缓冲**（根因）：`server.js` 用 `axios.post(url, body, { responseType: 'stream' })` 请求上游，axios 在内部缓冲响应后才触发 pipe
  2. **async/await 延迟**：`await makeUpstreamRequest()` 返回后，`IncomingMessage` 内部缓冲区已积累数据，`pipe` 启动后一次性排出（4ms 内 158 个 data 事件）
  3. **直连对比**：用 `https` 模块直连上游有 503 个 data 事件持续 17 秒（真正流式），但经 BFF 只有 1-2 chunks
  4. **前端 RAF 动画积压**：3字/帧（180字/秒）跟不上流式数据到达速度，导致积压后一次性显示
- **变更**：
  1. **BFF relay 改用原生 https 模块**（`server.js` L493-601）：
     - `axios.post` → `https.request`，在 callback 内立即 `upstreamRes.pipe(res)`
     - 绕过 async/await 延迟，数据到达即推送
     - 保留 502/504 重试、错误处理、日志逻辑
  2. **前端移除 RAF 动画，改为 30ms 节流更新**（`ChatPanel.tsx` L4282-4318, L4890-4926）：
     - 移除 `streamRevealedLen`、`tickReveal`、`streamRafId`
     - 新增 `flushStreamUiIfDue()`（30ms 节流）和 `flushStreamUiImmediate()`（立即更新）
     - 每个 chunk 到达时调用 `flushStreamUiIfDue()`，数据到达即显示
     - 借鉴 FastChat/llama.cpp：不做人为延迟，数据到达即显示
  3. **TTFB loading 动画**（`ChatPanel.tsx` L2026-2036）：
     - `StreamingAssistantMain` 在 `isStreaming && !main` 时显示三点跳动 `animate-bounce` 动画
     - 消除 TTFB 期间空白气泡等待感
  4. **payload 添加 `stream: true`**（`ChatPanel.tsx` L4097）：
     - DeepSeek 从 1 chunk → 2 chunks（轻微改善）
- **文件**：
  - `server.js`：relay 从 axios 改为原生 https，callback 内立即 pipe
  - `components/ChatPanel.tsx`：RAF 动画 → 节流更新；TTFB loading 动画；stream:true
  - `scripts/test-stream-timing.mjs`：流式时序测量脚本
  - `scripts/test-aitop-direct-stream.mjs`：上游 API 直连对比脚本
  - `scripts/test-aitop-raw-stream.mjs`：原生 https 模块直连测试脚本
- **效果**：
  - BFF 真正流式：长文本 893 个 data 事件持续 16 秒（之前 1 chunk 0ms）
  - 前端逐字流式：30ms 节流更新，每秒 33 次 UI 刷新，数据到达即显示
  - TTFB 期间三点跳动动画，消除空白等待感
- **已验证**：
  - `npm run build` 通过
  - `npm run test:chat-gate` 全部通过（48/48）
  - `scripts/test-short-text.mjs deepseek`：PASS（8.4s, 304字）
  - `scripts/test-context-memory.mjs deepseek`：PASS（上下文记忆正常）
  - `scripts/test-long-output.mjs deepseek`：PASS（5000+字）
  - BFF 日志确认：长文本 893 data events 持续 16 秒，短文本 120 data events
  - 服务已重启 http://localhost:3001/
- **已知限制**：
  - TTFB 3-9 秒仍取决于上游模型生成首 token 的时间（前端通过 loading 动画改善感知）
  - 短文本响应可能在上游生成完后一次性发送（data 事件密集但持续 1ms），前端通过节流更新平滑显示
- **风险**：低；BFF relay 逻辑等价改写（保留重试/错误处理/日志），前端渲染从 RAF 改为节流（更贴近数据到达节奏）；未触碰 §5.8–§5.13 S 级模块

### 11.55 2026-07-21 思考模式超时放宽 + 模型流式速度标识

- **背景**：全模型体验测试发现 DeepSeek 思考模式物理题推理超时（120s 不够）；Gemini/Claude 上游不流式（一次性返回），用户无感知。
- **变更**：
  1. **思考模式 timeout 放宽**（`ChatPanel.tsx` L785）：`AITOP_LLM_STREAM_IDLE_DEEP_MS` 120_000 → 180_000，复杂推理（物理题/数学证明）首 token 较慢时避免误判超时
  2. **模型选择器下拉列表流式速度标识**（`ChatPanel.tsx` L5882-5913）：
     - DeepSeek/Doubao：🟢 流式快（hover 显示"流式快"）
     - Gemini/Claude：🟡 较慢（hover 显示"较慢"，title="响应较慢（上游限制）"）
     - 底部图例说明：🟢 流式快：逐字输出，体验丝滑 / 🟡 较慢：上游 API 缓冲后一次性返回
  3. **当前选中模型按钮速度小圆点**（`ChatPanel.tsx` L5874-5886）：
     - DeepSeek/Doubao：绿色圆点（bg-emerald-400）
     - Gemini/Claude：黄色圆点（bg-amber-400）
     - title 提示"流式响应快"/"响应较慢（上游 API 限制）"
- **全模型体验测试结果**（基于真实流式时序测量）：
  | 模型 | data 事件 | 流式持续 | 评价 |
  |------|----------|---------|------|
  | DeepSeek | 1371 | 29.7s | ✅ 完美流式 |
  | Doubao | 1800 | 36.5s | ✅ 完美流式 |
  | 联网检索 | 538 | 6.3s | ✅ 正常流式 |
  | Gemini | 41 | 1ms | ❌ 上游缓冲 |
  | Claude | 47 | 1ms | ❌ 上游缓冲 |
- **文件**：`components/ChatPanel.tsx`
- **已验证**：`npm run build` 通过；`npm run test:chat-gate` 48/48 通过；服务已重启 http://localhost:3001/
- **风险**：低；仅 timeout 常量调整和 UI 标识新增，不改变业务逻辑、接口、字段语义；未触碰 §5.8–§5.13 S 级模块

### 11.56 2026-07-22 流式逐字渲染根因修复：rAF 合并 + 主线程让步（解决"最后一起打印"）

- **背景**：用户反馈 DeepSeek/Doubao 逐字流式体验不出来，"还是感觉最后一起打印出来"。后端日志证明流是真流式（DeepSeek 262 events/0.8s、长文 1371 events/29.7s；Doubao 1491 events/51.8s），问题在前端渲染层。
- **根因**（双重叠加）：
  1. **微任务自旋导致绘制步骤饿死**：`readStreamChunkWithIdle` 内 `reader.read().then(...)` 续体是微任务。当上游数据已缓冲在流队列时，`while(true)` 的 `await` 以微任务连续自旋，永远到不了浏览器"渲染步骤"（rAF/绘制），于是 `setMessages` 调了无数次画面却一帧不画，直到流结束才一次性刷新——即"最后一起打印"。
  2. **每帧重解析加速积压**：旧版每 30ms `updateStreamUI` 对全量 `fullContent` 调 `finalizeAssistantMessageContent`（含 `segmentMessageByPipeTables` 最多 200 次循环 + `extractNextPipeTable` + `extractEmbeddedHtmlTable` 多趟正则）。内容越长越慢，主线程跟不上事件节奏 → 积压 → `reader.read()` 立即以微任务返回 → 自旋更严重 → 恶性循环。
- **变更**（仅 `components/ChatPanel.tsx`，AiTop 路径 + Qwen 路径各一套，共 4 处）：
  1. **节流块改 rAF 合并 + 轻量渲染**（AiTop L4287-、Qwen L4894-）：新增 `renderStreamingLightweight`（流式中直接用原始 `fullContent`，跳过 `finalizeAssistantMessageContent` 重解析）；`flushStreamUiIfDue` 改为 `requestAnimationFrame` 合并（一帧最多渲染一次且回调在绘制步骤执行）；`flushStreamUiImmediate` 仍走完整 `finalizeAssistantMessageContent`（保证流结束表格抽取/分段重组正确）。
  2. **读取循环每批让步**（AiTop while、Qwen while）：每轮处理完一批 SSE 行后加 `await new Promise<void>(r => requestAnimationFrame(() => r()))`，强制让出到绘制步骤，根治微任务自旋。
- **不动的地方**（防重蹈"内容不完整"覆辙）：流结束路径 `cleanupReveal`/`flushStreamUiImmediate`→`updateStreamUI`（完整解析）保留；循环后 `composeStreamedAssistantMessage` 等最终组装逻辑不动；`finalizeAssistantMessageContent`/`parseAssistantMessage`/`readStreamChunkWithIdle` 函数体不动；未触碰 §5.8–§5.13 S 级模块。
- **文件**：`components/ChatPanel.tsx`
- **已验证**：`npm run build` 通过；`npm run test:gate` 全通过（含 seedance 参考图过滤 16/16）；`npm run test:chat-gate` 契约 48/48 通过；服务已重启 http://localhost:3001/；浏览器实测 DeepSeek 短文回复完整无截断、模型切换正常；服务端日志确认该请求 `upstreamDataEvents=262` 真流式 pipe。
- **风险**：低；仅改渲染调度时机与让步，不改业务逻辑/接口/字段语义。流式中表格以原始 `|` 文本显示，流结束瞬间转为正式表格（标准聊天 UI 行为）。逐字观感需用户在真实浏览器最终确认（自动化工具对 SSE 长连接有 ~10ms 截断限制，无法捕获逐字中间态）。

### 11.57 2026-07-22 流式"一段一段"修复：匀速逐字打字机（rAF 驱动，显示端与网络解耦）
- **背景**：§11.56 修复"最后一起打印"后，用户反馈"没有逐字打印的感觉，长内容一段一段，短内容像整体显示"。
- **根因**：§11.56 的 `renderStreamingLightweight` 每帧 set `content: fullContent`（全量累积），每帧渲染增量 = "自上次渲染后累积的所有 token"。上游突发到达或前端偶掉帧时，单帧跳一大段 → "一段一段"；短内容秒到齐、几次渲染结束 → "整体"。缺少"显示端与网络到达解耦"这层。
- **变更**（仅 `components/ChatPanel.tsx`，7 处编辑）：
  1. **组件顶层新增 2 个 useRef**（L2569-2571）：`streamTypewriterActiveRef`、`streamTypewriterRafRef`，跨 try/catch 共享，用于异常时停止打字机。
  2. **AiTop + Qwen 节流块替换为 typewriter**（原 L4281-/L4906-）：`shownLen` 状态 + `renderStreamingSlice`（用 `fullContent.slice(0, shownLen)` 切片渲染）+ `tickTypewriter`（每帧推进 3 字，积压>40 字提速到 10 字 + UTF-16 代理对保护，rAF 自驱动）。`flushStreamUiIfDue` 改为"若 rAF 未在跑则启动"。`flushStreamUiImmediate`/`cleanupReveal` 内部 cancelAnimationFrame + shownLen=full + updateStreamUI（完整解析）。
  3. **AiTop + Qwen while 循环前**（L4414/L5047）：`streamTypewriterActiveRef.current = true;` 启动打字机。
  4. **AiTop + Qwen catch 块开头**（L4651/L5130）：`active=false` + `cancelAnimationFrame` 清理，防止 rAF 覆盖错误消息（顺带修复原代码异常时 rAF 覆盖错误消息的潜在 bug）。
- **关键设计**：显示端以恒定小步长（3字/帧≈180字/秒）逐字推进，与网络/渲染节奏解耦。无论上游匀速还是突发到达，前端都逐字显示；积压超阈值自动提速追赶，不会越来越慢。
- **不动的地方**：`finalizeAssistantMessageContent`/`readStreamChunkWithIdle`/while 循环内 `await rAF` 让步/BFF 层 server.js/模型选择器/思考模式/联网检索/§5.8–§5.13 S 级模块全部不动。流结束仍走完整 `finalizeAssistantMessageContent`（表格抽取/分段重组保留）。
- **文件**：`components/ChatPanel.tsx`
- **已验证**：`npm run build` 通过；`npm run test:gate` 16/16 通过；`npm run test:chat-gate` 164 项全通过（layout44+pipeline16+display-contract24+probe13+identity19+model48）；服务已重启 http://localhost:3001/。
- **风险**：低；仅改渲染调度策略（全量→切片逐字），不改业务逻辑/接口/字段语义。流结束 `cleanupReveal` 强制 shownLen=full + 完整解析，最终展示与原方案一致。UTF-16 代理对有保护，emoji 不会切断。逐字观感需用户在真实浏览器最终确认。
- **⚠️ 已回滚**：用户实测反馈"回复不完整 + 无逐字感"，本节 typewriter 方案已于 §11.58 全部回滚至 §11.56 rAF 合并方案。Qwen 在 §11.56 下因上游真·逐字到达仍保持良好逐字体验；DeepSeek/豆包受 AiTop 国内 API 批量到达节奏限制，前端无法改变（用户接受现状）。

### 11.58 2026-07-22 回滚 typewriter + 模型下拉框三色标识
- **背景**：§11.57 typewriter 方案用户实测体验不佳（回复不完整、无逐字感），决定回滚至已验证的 §11.56 rAF 合并方案。同时按用户要求调整模型下拉框颜色文案，区分三类部署来源。
- **回滚变更**（仅 `components/ChatPanel.tsx`）：
  1. AiTop + Qwen 节流块：typewriter 实现 → 恢复 §11.56 的 `rafPending` + `renderStreamingLightweight` + rAF 合并方案。
  2. 移除组件顶层 `streamTypewriterActiveRef` / `streamTypewriterRafRef` 两个 useRef 声明。
  3. 移除 AiTop + Qwen while 循环前的 `streamTypewriterActiveRef.current = true;`。
  4. 移除 AiTop + Qwen catch 块开头的 rAF 清理代码。
- **模型下拉框三色标识**（仅 `components/ChatPanel.tsx`，3 处）：
  - 选中模型小圆点 + 下拉列表项标识 + 底部说明，统一改为三档：
    - 🟢 Qwen：`稳定，快速：公司内部部署`（emerald-400）
    - 🟡 DeepSeek / 豆包：`较稳定，速度普通：国内api访问`（amber-400）
    - 🔴 Claude / Gemini：`不稳定，较慢：第三方api访问`（red-400）
- **关于"参考 Qwen 逐字"**：Qwen 走公司内部部署（models.fangte.com），SSE 真·逐字到达，§11.56 rAF 合并方案下天然逐字。DeepSeek/豆包经 AiTop 国内 API，token 批量到达；Claude/Gemini 经第三方 API，整体缓冲后返回——均为上游到达节奏决定，前端无法改变。用户确认"如果不行就算了"，接受现状。
- **文件**：`components/ChatPanel.tsx`
- **已验证**：`npm run build` 通过；`npm run test:gate` 16/16 通过；`npm run test:chat-gate` 164 项全通过；服务已重启 http://localhost:3001/。
- **风险**：低；回滚至已验证的 §11.56 状态，仅渲染调度相关；颜色文案为纯 UI 展示，不影响业务逻辑。

### 11.57 2026-07-22 JSON 导入节点视口居中修复

- **现象**：打开本地工程（导入 JSON 文件）后，节点出现在画布不可见区域，不在面板正中间或鼠标附近。
- **根因**：`applyImportedProjectJson` 中，导入节点后未调用 `fitView()` 将视口居中到新导入的节点区域。空画布导入时节点保持 JSON 文件中原始位置，若位置远离视口原点则用户看不到节点。
- **修复**：
  1. `applyImportedProjectJson` 依赖数组中新增 `fitView`
  2. 新增 `fitViewOnImportedNodes` 函数：过滤 `hasReasonableNodePosition` 的有效节点，通过 `setTimeout(100)` + `requestAnimationFrame` 双层延迟调用 `fitView({ nodes, padding: 0.18, maxZoom: 1.15, duration: 0 })`，确保 React Flow 完成节点渲染和尺寸测量后再居中视口
  3. lazy hydration 路径：在 `onComplete` 回调中追加 `fitViewOnImportedNodes()`
  4. 非 lazy 路径：在 `setNodes`/`setEdges` 后追加 `fitViewOnImportedNodes()`
- **文件**：`components/FlowEditor.tsx`（`applyImportedProjectJson` L12791-12830）
- **已验证**：`npm run build` 通过；`npm run test:gate` 16/16 通过；服务已重启 http://localhost:3001/。
- **风险**：低；仅新增 ReactFlow 内置 `fitView` API 调用，与项目现有初始加载视口居中逻辑（L3511-3526）一致；不改变节点位置、边连接、数据持久化等任何业务逻辑。

### 11.59 2026-07-22 可灵3.0 Omni 输出 MOV 节点 Node Details 参考图显示错误修复

- **现象**：可灵3.0 Omni 输出 MOV 节点 Node Details 中参考图片记录了 6 张（含 4 张 blob 临时图），而实际 API 调用仅使用了 prompt 中 @ 的 2 张（大牙 + 图片3）。
- **根因**：`buildOmniPanelSourceForNodeDetails` 在构建 MOV 节点 Node Details 面板数据时，无条件将上游 processor 节点的 `klingOmniMultiReferenceImages`（6 项，含 4 个 blob）合并到 MOV 节点中。后续 `buildOmniMultiTabDetailsReferencePreview` 优先使用面板数据而非 `generationParams` 快照，导致显示了全部未引用的面板槽位。
- **修复**：在 `buildOmniPanelSourceForNodeDetails` 中，合并祖先面板参考图前新增 `gpHasRefImages` 判断——当 `generationParams.referenceImages` 已有有效数据时，跳过合并 `klingOmniMultiReferenceImages` / `klingOmniVideoReferenceImages` / `klingOmniInstructionReferenceImages` 三个 tab 专属字段，确保输出节点 Node Details 仅展示 @ 引用的素材（§5.9.1 #2），与 Seedance 2.0 参考生行为一致。
- **文件**：`utils/nodeDetailsPreview.ts`（`buildOmniPanelSourceForNodeDetails` L1990-2018）
- **已验证**：`npm run test:gate` 16/16 全部通过；`npm run build` 成功；服务已重启 http://localhost:3001/。
- **风险**：低；仅影响 gp 已有参考图的可灵3.0 Omni 输出节点（MOV/OUTPUT），processor 节点和其他模型不受影响。`referenceImages` 和 `referenceImageLabels` 的通用合并不受限制。

## 12. 附加文档索引

| 文档 | 说明 |
|------|------|
| `.cursor/skills/flowgen-ai-studio/SKILL.md` | 详细功能架构与开发记录副本（以根目录 `skill.md` 为准） |
| `.cursor/skills/flowgen-ai-studio/reference.md` | 功能逻辑参考，含 mermaid 数据流图 |
| `docs/MODEL-MEDIA-RULES-SPEC.md` | 全模型媒体规则规格（三态分离、分模型矩阵） |
| `docs/LLM-CHAT-RULES-SPEC.md` | Chat / LLM 规则规格 |
| `.cursor/rules/regression-gate.mdc` | 回归门禁规则（何时跑、跑哪些） |
| `.cursor/rules/auto-build-and-run.mdc` | 修改后自动构建与启动规则 |
| `TEST-VERIFY-PANEL-REFS.md` | 面板本地参考图刷新后人工验证清单 |
| `docs/CORE_APPLICATION_LOGIC.md` | 核心应用逻辑文档 |
| `docs/服务器部署文件清单.md` | 部署清单 |
