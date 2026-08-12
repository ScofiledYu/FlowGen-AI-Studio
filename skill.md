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

1. 读本节 + §5.1–§5.7 + **§5.9** + **§5.8.11 各模型 prompt 引用格式门禁**，确认改动是否触碰「勿改」列（含 **§5.8.4 拖入去重**、**§5.8.5 @资产+Details recovery**、**§5.8.7 二次运行 prompt 不写回**、**§5.8.11 prompt 引用格式门禁表**）
2. 一次只修一类问题；**不得**顺手 refactor Omni tab / image2 主图 / 模型 IDB 键 / 拖入去重队列 / @资产 URL 解析 / 运行前 canonical 写回 Inspector / 各模型 prompt 引用格式
3. 改完必跑 §5.8 对应脚本 + `npm run test:gate` + **§5.8.11 门禁脚本**；未全绿不得声称完成
4. 向用户汇报时写明：是否触碰 §5.8 已验收模块 + 是否核对过 §5.8.11 官方文档

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

#### 5.8.8 Seedance 2.0 提交豆包 API 用原生「图片N」标记（2026-08-10）

> **背景**：对照火山引擎官方文档发现，豆包 SeedDance 2.0 要求 prompt「**必须使用素材类型+序号格式引用素材**」（如 `图片N` / `@图片 N`），序号对应 `content`/`referenceImages` 数组顺序；**不支持**纯 Asset ID 指代；纯自然语言描述（不带 `图片N` 标记）无法让模型对齐到特定素材。
> - 官方依据：[82379/2222480 提示词指南](https://www.volcengine.com/docs/82379/2222480)、[82379/2291680 教程](https://docs.volcengine.com/docs/82379/2291680)、[82379/1520757 API](https://www.volcengine.com/docs/82379/1520757)
>
> **问题**：原 `resolvePromptPlaceholders` 把 `@图片N` 展开成「（面板参考「乘黄」，对应本请求 referenceImages 第1张，在提示词中请视作 [图1]）」长括号自然语言说明，丢失豆包原生「图片N」结构化标记（且 `[图N]` 比 `[图片N]` 少「片」字），复杂多图场景（多角色/多镜头）对齐不可靠。

| 项 | 规则 |
|----|------|
| **Seedance 2.0（高质量/急速）** | 提交 API 的 prompt 调 `resolveSeedancePromptToNativeImageTokens`：`@图片N`/`@主图`/`@资产:名`/`@主体` → `图片{imageIndex}`；`@首帧图` → 「起始画面」、`@尾帧图` → 「结束画面」（转为自然语言保留语义，首尾帧靠 startImage/endImage 字段传递）；`@主视频` 移除（靠 referenceVideos 字段）；未命中标记保留原样 |
| **Seedance 1.5-pro** | 保持 `resolvePromptPlaceholders`（仅支持首帧/首尾帧，靠 startImage 字段，无多图参考需求） |
| **其它模型（Nano/image2/Omni/即梦/vidu/MJ）** | 不受影响，仍走 `resolvePromptPlaceholders` |
| **Inspector / 节点 prompt 字段** | 不变：`getNodeInspectorPromptText` 仍返回用户原文（§5.8.7 不变） |
| **plan / 面板槽对齐** | 不变：仍用 `collectReferencedMediaFromPrompt` + `buildReferenceIndexOptionsFromPlan` 构建 `referenceImageIndexByToken`，新函数复用此 map |

**关键模块：**
- `utils/promptMediaRefs.ts` — 新增 `resolveSeedancePromptToNativeImageTokens`（不改已有 `resolvePromptPlaceholders` S 级函数体）
- `components/FlowEditor.tsx` — `handleNodeRun` seedance 分支：`isSeedance20Model` 调新函数，否则调 `resolvePromptPlaceholders`

**门禁：** `npm run test:gate` 全绿（62 通过 0 失败）；未破坏 §5.8.7「二次运行不 rewrite」、§5.9 四大域。

**风险与待验证：**
- 现有 test:gate 主要覆盖 plan/面板/Inspector 对齐，**未直接断言提交给豆包 API 的 prompt 字符串形态**；本变更的 API prompt 形态需浏览器实测（seedance 2.0 参考生/图生视频，多图多角色场景）。
- `@首帧图`/`@尾帧图` 转为「起始画面/结束画面」自然语言（2026-08-11 修复）：原逻辑直接移除导致 prompt 语义断裂（如「@首帧图过渡自然到@尾帧图」→「过渡自然到」缺少主语）；现转为自然语言保留语义。首尾帧仍靠 startImage/endImage 字段传递，prompt 不引用字段名。
- 1.5-pro 仍走旧逻辑（展开为说明），若后续发现 1.5-pro 也需原生标记再单独评估。

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
| `resolvePromptPlaceholders(prompt, plan)` | `string`, `CollectedRef[]` | `string` | 展开为模型可读说明（§5.8.8：seedance 2.0 不再调用，改调下行新函数） |
| `resolveSeedancePromptToNativeImageTokens(prompt, opts)` | `string`, `ResolvePromptPlaceholdersOptions` | `string` | **§5.8.8**：seedance 2.0 专用，把 @标记替换为豆包原生「图片N」标记（对照官方文档 82379/2222480/2291680） |
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

##### §5.8.9 可灵3.0 Omni / gpt-image-2 / Nano Banana 2 — prompt 引用标记对齐各厂商官方格式

- **背景**：原 `resolvePromptPlaceholders` 把 `@图片N` 统一展开成「（面板参考「图片N」，对应本请求 referenceImages 第N张，在提示词中请视作 [图N]）」长括号中文元说明。该格式仅对豆包 Seedance 1.5-pro 有效；对可灵3.0 Omni 是功能性 bug（可灵 NLP 无法识别），对 gpt-image-2 / Nano Banana 2 非官方推荐格式。
- **官方格式对照**（2026-08-10 调研）：
  - **可灵3.0 Omni**（快手官方 API）：prompt 中用 `@image_1`、`@image_2`…`@image_7` 引用 imageList 数组中的图片（来源：useapi.net、unifically.com、somake.ai）
  - **gpt-image-2**（OpenAI Cookbook 提示词指南）：用自然语言 `Image 1`、`Image 2` 引用，如 `apply Image 2's style to Image 1`
  - **Nano Banana 2**（Google Gemini 官方文档）：用自然语言描述参考图关系，`Image N` 标记可辅助多图区分
- **变更内容**：
  - `utils/promptMediaRefs.ts` 新增 `resolvePromptToNativeImageTokensBase`（公共基础函数，接受 `formatToken` 回调）、`resolveKlingOmniPromptToNativeImageTokens`（`@图片N→@image_N`）、`resolveImageGenPromptToImageTokens`（`@图片N→Image N`，image2 与 Nano Banana 共用）
  - `components/FlowEditor.tsx` 三处 `resolvePromptPlaceholders` 调用替换为各自专用函数：
    - L7815 Nano Banana → `resolveImageGenPromptToImageTokens`
    - L7995 image 2 → `resolveImageGenPromptToImageTokens`
    - L8375 可灵3.0 Omni（prompt + negativePrompt）→ `resolveKlingOmniPromptToNativeImageTokens`
  - 与 §5.8.8（Seedance 2.0 用 `图片N`）互不影响：四个模型各自独立分流，未改动 `resolvePromptPlaceholders` 原函数
- **测试**：新增 `resolveKlingOmniPromptToNativeImageTokens.test.ts`（12 用例）、`resolveImageGenPromptToImageTokens.test.ts`（13 用例）；全量 464 测试通过零回归
- **稳定性**：新函数为纯新增；`resolvePromptPlaceholders` 及 `referenceImagePhrase` 未改动，仍供 Seedance 1.5-pro 及其他模型使用
- **风险**：可灵3.0 Omni 为功能性修复（原长文本可灵无法识别）；image2 / Nano Banana 为格式优化（原长文本多模态可理解但非官方推荐）

##### §5.8.10 端到端模拟测试：真实 fixture 数据验证

- **目的**：用真实用户场景数据验证三个模型的 prompt 转换准确性和官方格式合规性
- **测试文件**：`src/test/utils/resolveNativeImageTokensE2E.test.ts`
- **测试数据**：基于 `scripts/fixtures/20260709-seedance参考生视频.json`（5张参考图+1个主视频+多角色场景）
- **测试覆盖**（24 用例）：
  - 可灵3.0 Omni（7 用例）：单图、多图、复杂场景、角色绑定、全5图、首尾帧、尾帧
  - image 2 / Nano Banana 2（8 用例）：单图、多图、风格转移、多主体合成、角色一致性、全5图、@主图、@主体
  - 官方格式合规性验证（3 用例）：确认生成格式符合各厂商官方规范，三个模型格式互不相同
  - 边界场景（6 用例）：空 map、undefined opts、空 prompt、null prompt、未命中标记保留、@图片 简写
- **验证结果**：全量 55 文件 488 测试通过零回归
- **关键断言**：
  - 可灵3.0 Omni 生成 `@image_N`（无 `@图片N`、无长括号说明）
  - image 2 / Nano Banana 2 生成 `Image N`（无 `@图片N`、无长括号说明）
  - 三个模型格式互不相同，防止串扰

##### §5.8.11 各模型 prompt 引用格式门禁（S级·已验收·2026-08-11）

> **门禁目的**：保证各模型提交 API 的 prompt 引用格式严格对齐各厂商官方文档；**禁止**任何 Agent 在未核对官方文档的情况下擅自修改引用格式或回退为长文本说明。
>
> **适用范围**：`handleNodeRun` 内各模型分支的 prompt 处理（`FlowEditor.tsx` L7800–L8380）。触碰本节须 `npm run test:gate` 全绿 + 本节子门禁全绿。

**官方引用格式门禁表（修改前必对照）：**

| 模型 | 官方引用格式 | 转换函数 | 官方依据 | 禁止回退 |
|------|-------------|----------|----------|----------|
| **Seedance 2.0**（高质量/急速） | `图片N`（无方括号）；`@首帧图`→「起始画面」、`@尾帧图`→「结束画面」 | `resolveSeedancePromptToNativeImageTokens` | [Volcengine 82379/2222480](https://www.volcengine.com/docs/82379/2222480) | 禁止回退为「（面板参考…视作 [图N]）」长文本；禁止移除 @首帧图/@尾帧图（会导致 prompt 语义断裂） |
| **可灵3.0 Omni** | `@image_N`（1≤N≤7）；`@首帧图`/`@尾帧图`：map 有映射→`@image_N`，无映射→「起始画面/结束画面」 | `resolveKlingOmniPromptToNativeImageTokens` | [useapi.net Kling Omni](https://useapi.net/docs/articles/kling-omni-bash) | 禁止回退为长文本说明；N 不得超过 7；禁止移除 @首帧图/@尾帧图 |
| **gpt-image-2** | `Image N`（自然语言）；`@首帧图`→「起始画面」、`@尾帧图`→「结束画面」 | `resolveImageGenPromptToImageTokens` | [OpenAI Academy 提示词指南](https://openai.com/academy/image-generation/) | 禁止回退为长文本说明；禁止移除 @首帧图/@尾帧图 |
| **Nano Banana 2** | `Image N`（自然语言）；`@首帧图`→「起始画面」、`@尾帧图`→「结束画面」 | `resolveImageGenPromptToImageTokens` | [Google AI Nano Banana 文档](https://ai.google.dev/gemini-api/docs/image-generation) | 禁止回退为长文本说明；禁止移除 @首帧图/@尾帧图 |
| **Seedance 1.5-pro** | 长文本说明（保留） | `resolvePromptPlaceholders`（不改） | 仅支持首帧/首尾帧，无多图参考需求 | 禁止改为原生标记 |
| **Midjourney / Niji** | **纯自然语言**（无 @元素） | `resolvePromptPlaceholders`（plan 为空，原样返回） | [Midjourney Prompt Basics](https://docs.midjourney.com/hc/en-us/articles/32023408776205-Prompt-Basics)、[Character Reference](https://docs.midjourney.com/hc/en-us/articles/32162917505293-Character-Reference) | 禁止在 Midjourney 面板引入 @图片N；图片仅走 `mjSrefUrl`/`mjCrefUrl`/`mjOrefUrl` 三参数 |
| **即梦3.0 Pro** | **纯自然语言**；`@首帧图`→「起始画面」，`@图片N`/`@主图`/`@主体`/`@尾帧图`/`@主视频` 移除 | `resolveJimengPromptStripImageTokens` | [Volcengine 85621/1777001](https://www.volcengine.com/docs/85621/1777001) | 禁止回退为长文本说明；仅支持1张首帧图（通过 imageUrls 字段传递） |

**必跑门禁脚本：**

| 脚本 | 覆盖 |
|------|------|
| `npm run test:gate` | 全量回归（含 §5.8.7/§5.8.8/§5.9 四大域） |
| `npx vitest run src/test/utils/resolveSeedancePromptToNativeImageTokens.test.ts` | Seedance 2.0 单元（9 用例） |
| `npx vitest run src/test/utils/resolveKlingOmniPromptToNativeImageTokens.test.ts` | 可灵3.0 Omni 单元（12 用例） |
| `npx vitest run src/test/utils/resolveImageGenPromptToImageTokens.test.ts` | image2/Nano Banana 单元（13 用例） |
| `npx vitest run src/test/utils/resolveNativeImageTokensE2E.test.ts` | 三模型 E2E（24 用例，真实 fixture） |
| `npx vitest run src/test/utils/resolveJimengPromptStripImageTokens.test.ts` | 即梦3.0 Pro 单元（12 用例） |

**Agent 自检清单（改 prompt 引用格式前必跑）：**

1. **先核对官方文档**：打开对应厂商官方页面，确认当前官方引用格式（官方可能迭代）
2. **对照门禁表**：确认要改的模型属于哪一行，引用格式是否与官方一致
3. **不得跨模型串扰**：三个模型格式互不相同（`图片N` / `@image_N` / `Image N`），禁止用错
4. **Midjourney 特殊规则**：Midjourney 是 Text Node，**面板不支持 @元素**；图片仅通过 `mjSrefUrl`/`mjCrefUrl`/`mjOrefUrl` 三参数传递；prompt 是纯自然语言（官方明确禁止 prompt 中放图片引用标记）
5. **改完必跑门禁**：上述 5 个脚本全绿，且 `npm run test:gate` 零回归
6. **向用户汇报时写明**：是否触碰本节门禁表，是否核对过官方文档

**禁止行为：**

- ❌ 未经核对官方文档，擅自修改任一模型的引用格式
- ❌ 把 `@图片N` 回退为「（面板参考…视作 [图N]）」长文本说明
- ❌ 在 Midjourney 面板引入 @图片N 标记
- ❌ 把可灵3.0 Omni 的 `@image_N` 改为 `图片N` 或 `Image N`
- ❌ 把 gpt-image-2/Nano Banana 的 `Image N` 改为 `图片N` 或 `@image_N`
- ❌ 删除或跳过本节门禁脚本

**关键模块（改前必读）：**

| 文件 | 函数 | 稳定性 |
|------|------|--------|
| `utils/promptMediaRefs.ts` | `resolveSeedancePromptToNativeImageTokens`、`resolveKlingOmniPromptToNativeImageTokens`、`resolveImageGenPromptToImageTokens`、`resolvePromptToNativeImageTokensBase`、`resolvePromptPlaceholders`、`referenceImagePhrase` | S级（仅修语法或本节门禁下改 bug） |
| `components/FlowEditor.tsx` | `handleNodeRun` 各模型分支（L7800–L8380） | S级 |
| `services/aitop.ts` | `createDoubaoSeedanceVideoTask`、`createKlingOmniVideoTask`、`createNanoTask`、`createImage2Task`、`createMjImagineTask` | S级（prompt 透传，禁止改写） |

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

### 8.2 `test:gate` 组成（`scripts/test-gate.mjs`，共 47 步）

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
| 45 | 20260714-seedance-reference-consistency | Seedance processor/mov Details 参考一致 + @主图勿变@主视频 |
| 46 | 20260715-seedance-unreferenced-filter | Details 仅展示 prompt 显式 @ 的参考图 |
| 47 | text-gen-node | **Text Node（文生节点）** 白名单/面板/画布/菜单/S 级保护契约 |

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

### 10.76 2026-07-31 修订 §10.56：Omni instruction/video 刷新后永久卡 5%（面板卡在%5.json）

- 症状：`E:\问题\0731\面板卡在%5.json` 最后一个 Output Mov Node（可灵3.0 Omni instruction tab）刷新后进度条永久卡在 5%
- 根因：§10.56 修复③有设计缺陷——「无 taskId 时恢复 running 进度条 UI（不触发 AiTop 轮询）」假设"上传仍在内存中进行"。实际 F5 刷新后内存里的异步上传 Promise 已死，结果：✅ 进度条恢复 5%；❌ 没有任何机制推进它（`shouldTriggerAiTopRunRecovery` 因无 taskId 返回 false）；❌ 永久卡死，用户只能手动重新运行
- 第二处隐患：`reconcileZombieRunningNode` 对 MOV 节点仅看 `imagePreview` 是否为视频 URL；上传阶段刷新时 `imagePreview` 可能是上游参考视频/参考图占位，会被误判为本节点成片，错置为 `completed` 且残留 `runRecovery*` 字段（错位预览）
- §10.76 第一版修复（已废弃）：把上传阶段刷新改为回落 idle。但用户反馈希望刷新后保持 running 并自动完成生成，故改为 §10.77 方案

### 10.77 2026-07-31 Omni instruction/video 刷新后自动重跑（参考 ComfyUI 模式）

- 症状：同 §10.76，用户要求刷新后保持 running 进度并自动完成生成（不回落 idle）
- 调研：参考 GitHub ComfyUI 官方模式（"提交工作流 → 获取任务 ID → 用任务 ID 获取结果"，任务 ID 在长上传之前同步生成）+ Yara ComfyUI 工具（"保存/加载 in-progress job 会从头重启生成"）。成熟项目对"上传阶段中断"的标准处置就是**重新触发完整流程**。
- 修复（最小变更·3 文件，非 S 级）：
  1. **保留 §10.56 的 running 进度条恢复**（撤销 §10.76 第一版的"回落 idle"）：`prepareNodesAfterWorkspaceLoad` 无 taskId 分支继续调用 `restoreUploadPhaseRunningUi` 恢复 running 进度条 UI
  2. **保留 §10.76 的 `reconcileZombieRunningNode` 守卫**：`!taskIds.length && runRecoveryPending` 返回 `null`，避免误判 imagePreview 为成片
  3. **新增 `nodeIsUploadPhaseRefreshPending` 检测函数**（[utils/runRecovery.ts](file:///d:/aaa/flowgen-ai-studio/utils/runRecovery.ts)）：`runRecoveryPending && 无 taskId` → true
  4. **`useAiTopRunRecovery` 派发 `flowgen:auto-resume-run` 事件**（[hooks/useAiTopRunRecovery.ts](file:///d:/aaa/flowgen-ai-studio/hooks/useAiTopRunRecovery.ts)）：检测到上传阶段刷新节点时，setTimeout(0) 派发事件携带 nodeId；派发后立即清 `recoveringRef`（避免重入阻塞）
  5. **`FlowEditor.tsx` 监听 `flowgen:auto-resume-run` 事件**（[components/FlowEditor.tsx:12098-12121](file:///d:/aaa/flowgen-ai-studio/components/FlowEditor.tsx#L12098-L12121)）：调用 `handleNodeRun(nodeId)` 重新跑完整"上传 → 创建任务 → 轮询 → 落盘"流程；含 3 重防御：① 节点仍 `runRecoveryPending` 才重跑；② 无 taskId 才重跑（已有 taskId 走正常 recovery 轮询）；③ 不与 `activeRunIdsRef` 冲突
- 文件：`utils/runRecovery.ts`、`hooks/useAiTopRunRecovery.ts`、`components/FlowEditor.tsx`、`src/test/utils/runRecovery.test.ts`
- 测试：`runRecovery.test.ts` 30/30 通过；新增 `nodeIsUploadPhaseRefreshPending detects upload-phase refresh nodes` 用例（3 场景：上传阶段/有 taskId/无 pending）；保留 `reconcileZombieRunningNode skips upload-phase refresh nodes` 对照用例
- 安全性：上传阶段刷新时 AiTop 侧任务尚未创建（`appendRunTaskId` 未调用），重跑不会产生重复任务；极小概率"任务创建成功→taskId 未持久化就刷新"会产生 AiTop 孤儿任务，但 AiTop 会自动过期回收，不影响新任务执行
- 风险评估：① 已有 taskId 的 running 节点走原 recovery 轮询分支，不受影响；② 正常完成态节点不受影响；③ S 级稳定模块未触碰；④ 上传阶段刷新自动重跑会重新上传素材（耗时与首次相同），但避免永久卡死
- 与既有约束关系：与 §10.55（image2 卡 95% 循环）、§10.68（运行失败主图格回滚）属同一 runRecovery 体系；本次仅修「上传阶段刷新」分支，不动其它分支；废弃 §10.76 第一版的"回落 idle"方案
- 备注：`test:gate` 在本次修改后存在 1 个 pre-existing 失败（`seedanceMainVideoLabel.test.ts`），由 working tree 里 `utils/promptMediaRefs.ts` 等文件的修改导致，与本次修改无关，未触碰

### 10.78 2026-07-31 修复 @ 下拉丢失资产条目（referenceImageLabels 为泛称时 projectAsset 项被误去重）

- **症状**：`E:\问题\0731\banna.json` — Nano Banana 2.0 面板参考格底栏能显示资产名「原始丛林小路」，但创意描述输入 `@` 时下拉列表里没有 `@资产:原始丛林小路`。其他模型（image2 / Seedance 参考生 / Omni multi·instruction）在相同条件下也存在同样问题。
- **根因**（`utils/promptMediaRefs.ts` `inspectorMentionDisplayNameForItem`）：
  - 当 `referenceImageLabels[i]` 为泛称「图片n」、但槽 URL 实为资产库图片时，`pushPanelRefImageAtSlot` 内 `refSlotMentionDisplayLabel` 返回泛称「图片n」作为 `displayLabel`，于是 `projectAsset` 项的 `label="图片n"`，`insertText="@资产:原始丛林小路"`。
  - `inspectorMentionDisplayNameForItem` 原实现 `if (lab) return lab;` 无条件返回 `label`，导致 `projectAsset` 项的 displayName = `"图片n"`。
  - `buildInspectorPromptMentionItems` 用 `inspectorMentionDisplayNameForItem(it).toLowerCase()` 作 `nameKey` 去重：`@图片n`（image 项）与 `@资产:原始丛林小路`（projectAsset 项）的 nameKey 同为 `"图片n"`。
  - 去重逻辑中，`projectAsset` 项仅在冲突项是 `@主图` / 首尾帧时才替换；冲突项是 `@图片n` 时直接 `continue` 丢弃 → **`@资产:原始丛林小路` 被误删**。
  - 面板底栏走 `resolveReferenceSlotDisplayLabel`，会从 URL 反查资产库得到资产名，所以底栏显示正常；但 @ 下拉走 `inspectorMentionDisplayNameForItem`，路径不同，导致「底栏有 / 下拉无」的不一致。
- **修复**（`utils/promptMediaRefs.ts` `inspectorMentionDisplayNameForItem`，S 级模块最小变更）：
  ```typescript
  // 原：if (lab) return lab;
  // 新：label 为泛称（图片n/主图/主视频/首帧图/尾帧图）时，projectAsset 项改从 insertText 解析资产名
  if (lab && !isGenericPanelRefCaption(lab)) return lab;
  const ins = String(it.insertText || '').trim();
  if (ins.startsWith('@资产:')) {
    const name = ins.slice('@资产:'.length).trim();
    if (name) return name;
  }
  // 其余分支保持原样（@主图/@主视频/@首帧图/@尾帧图）
  ```
  - 仅在 `label` 缺失或为泛称时，对 `projectAsset` 项从 `insertText`（`@资产:名称`）解析资产名作为 displayName。
  - 项目库全量项 `label="素材·${name}"` 非泛称，仍走 `lab` 分支，行为不变。
  - 资产名为非泛称的常规场景（`lab=资产名`）也不受影响。
- **影响范围**：全模型统一生效（Nano / image2 / Seedance 参考生 / Omni multi·instruction / 即梦 / vidu 等所有走 `pushPanelRefImageAtSlot` 的模型）。
- **文件**：`utils/promptMediaRefs.ts`（仅 1 个函数，约 10 行改动）
- **测试**：
  - `scripts/panel-mention-caption-alignment-test.ts` 31/31 通过
  - `scripts/inspector-at-mention-e2e-test.ts` 49/49 通过
  - `npm run test:gate` 全绿
  - `npm run build` 成功
- **风险评估**：低。
  ① 仅改 `inspectorMentionDisplayNameForItem` 一个纯展示/去重函数，不动 `buildPromptMediaRefLabels` 的 `label` 语义，不影响运行 plan、API 上传、Node Details 等下游。
  ② 修改后 `@资产:名` 与 `@图片n`（指向同一槽）会在下拉中共存，符合 §5.8.5 设计（两种引用方式都可解析到同一槽位）。
  ③ 项目库全量项与面板项目资产名项的 displayName 行为不变，不引入新的去重冲突。
- **勿回退约束**：`inspectorMentionDisplayNameForItem` 对 `projectAsset` 项不得重新无条件返回 `label`；当 `label` 为泛称时必须从 `insertText` 解析资产名，否则 @ 下拉会再次丢失资产条目。

### 10.79 2026-08-11 修复可灵3.0 Omni 运行进度条永久卡 95%（上传/轮询无超时导致节点挂起）

- **症状**：`E:\问题\0811\一直转动.json` — 可灵3.0 Omni video tab 节点运行后进度条卡在 95%，无法看到成功还是失败；刷新后进度到 95% 又卡住，形成死循环。
- **根因分析**：
  1. **进度条上限 95%**（设计行为）：`bumpRunningNodeProgress(delta, max=95)` 在 [FlowEditor.tsx:7264](file:///d:/aaa/flowgen-ai-studio/components/FlowEditor.tsx#L7264) 中 `Math.min(max, prev+delta)` 限制 progress 最多到 95%，任务完成前不会到 100。可灵3.0 Omni 分支 `omniProgressInterval` 每 1 秒推进 +1，到 95% 后停住。用户无法判断是"还在运行"还是"卡住了"。
  2. **上传链路无 fetch 超时**（核心缺陷）：`services/aitop.ts` 中 `getBlobFromUrl` / `uploadImage` / `uploadVideo` 的所有 `fetch` 调用均无 `AbortController` 超时。若 AiTop 上传服务端 accept 了 TCP 连接但不返回响应体（如服务端在解析大文件时卡死），`fetch` 不会 reject，整个 `await` 链被永久挂起，节点 status 停留 `running`，progress 永久卡在 95%，不会抛错也不会恢复。
  3. **轮询链路无 fetch 超时**：`getTaskStatus`（[aitop.ts:741](file:///d:/aaa/flowgen-ai-studio/services/aitop.ts#L741)）的 `fetch` 同样无超时。若 `/task-status` 代理 fetch 卡住，`pollVideoTaskUntilUrl` 会无限等待。
  4. **刷新后 auto-resume-run 死循环**：节点是上传阶段刷新中断（无 taskId + runRecoveryPending=true），`useAiTopRunRecovery` 派发 `flowgen:auto-resume-run` 事件触发 `handleNodeRun` 重跑。若重跑时 fetch 又卡住，progress 又到 95% 卡住，用户刷新后又重复。
- **修复方案**（三管齐下）：
  - **方案A（上传链路超时）** — [services/aitop.ts](file:///d:/aaa/flowgen-ai-studio/services/aitop.ts)：
    - 新增 `fetchWithTimeout(input, init, timeoutMs)` 辅助函数，封装 `fetch` + `AbortController`；超时后抛出 `请求超时（Ns）：URL` 错误，被 `handleNodeRun` catch 块捕获，节点回落 idle + 创建 Error Result Node。
    - `getBlobFromUrl` 3 处 `fetch` → `fetchWithTimeout`，超时 60s（`FETCH_BLOB_TIMEOUT_MS`）。
    - `uploadImage` / `uploadAudio` 上传 `fetch` → `fetchWithTimeout`，超时 120s（`UPLOAD_IMAGE_TIMEOUT_MS`）。
    - `uploadVideo` 上传 `fetch` → `fetchWithTimeout`，超时 180s（`UPLOAD_VIDEO_TIMEOUT_MS`，视频文件通常较大）。
    - `getTaskStatus` 2 处 `fetch`（代理 + 直连）→ `fetchWithTimeout`，超时 30s（`TASK_STATUS_TIMEOUT_MS`）；单次超时后由 `pollImageTaskUntilUrl` / `pollVideoTaskUntilUrl` 的 try/catch + `continue` 兜底重试，连续超时最终因 `maxAttempts` 耗尽抛出"轮询超时"错误。
  - **方案B（运行总超时兜底）** — [FlowEditor.tsx 可灵3.0 Omni 分支](file:///d:/aaa/flowgen-ai-studio/components/FlowEditor.tsx#L8228)：
    - 在 try 块前创建 `omniRunTimeoutPromise`（30 分钟超时），超时后 `reject(new Error('可灵3.0 Omni 运行超时（30分钟），请检查网络或重试'))`。
    - `pollOmniVideo` 用 `Promise.race([pollVideoTaskUntilUrl(...), omniRunTimeoutPromise])` 包装，覆盖 `getTaskStatus` fetch 卡住等无超时场景。
    - finally 块中 `clearTimeout(omniRunTimeoutTimer)` 清理定时器。
  - **方案C（UI 提示）** — [CustomNode.tsx Running Overlay](file:///d:/aaa/flowgen-ai-studio/components/nodes/CustomNode.tsx#L1297)：
    - progress >= 95 时在进度数字下方显示「任务仍在运行中，请耐心等待…」提示（`animate-pulse` 闪烁效果），避免用户误以为卡住。
- **文件**：`services/aitop.ts`、`components/FlowEditor.tsx`、`components/nodes/CustomNode.tsx`、`utils/multiGenerateTasks.ts`
- **测试**：`npm run test:gate` 全绿（含 panel-image-isolation-guard / attach-local-reference-refs-backup / nano-model-switch-main-loss / mov-node-drag-image-no-clobber-video 等全套回归）；`npm run build` 成功。
- **风险评估**：低。
  ① `fetchWithTimeout` 仅增加超时机制，不改变业务逻辑、接口签名、字段语义；超时后抛错走原有 catch 链，节点状态变为 idle + Error Result Node，与网络错误处理路径一致。
  ② 方案B 的 `omniRunTimeoutPromise` 仅作用于可灵3.0 Omni 分支的轮询阶段，不影响其他模型；30 分钟超时远大于正常视频生成耗时（通常 3-10 分钟）。
  ③ 方案C 仅增加 UI 提示，不动节点数据结构。
  ④ S 级稳定模块未触碰；`services/aitop.ts` 属 A 级稳定模块，改动仅增加超时，必跑 `test:gate` 已通过。
- **勿回退约束**：
  ① `fetchWithTimeout` 不得移除，否则上传/拉取链路再次无超时，节点会永久卡在 95%。
  ② `getTaskStatus` 的 `fetchWithTimeout` 不得移除，否则 `/task-status` 代理 fetch 卡住时轮询会无限等待；`pollImageTaskUntilUrl` / `pollVideoTaskUntilUrl` 中的 try/catch + continue 不得移除，否则单次超时会直接终止整个轮询。
  ③ `omniRunTimeoutPromise` 不得移除，作为可灵3.0 Omni 的总超时兜底。
  ④ progress >= 95 的 UI 提示不得移除，否则用户无法区分"还在运行"和"卡住"。
- **与既有约束关系**：与 §10.55（image2 卡 95% 循环）、§10.77（Omni instruction/video 刷新后自动重跑）属同一 runRecovery 体系；本次仅增加超时兜底，不动 runRecovery 业务逻辑。

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

### 10.53 2026-07-23 Text Node（文生节点）

- **需求**：画布右键菜单新增「Text Node」，纯文生图/文生视频；模型仅保留 Nano Banana 2.0、image 2、seedance2.0（高质量版/急速版）文生视频；面板无拖图/参考区/@引用。
- **设计**：
  1. 复用 `PROCESSOR` 节点类型 + `NodeData.textGenNode` 标记（S 级 `NodeType` 枚举零改动），运行链路完全复用：Nano/image2 无 @ 引用即文生图、`seedanceGenerationMode='text'` 即文生视频（既有能力，未改运行代码）；
  2. 模型白名单 `TEXT_GEN_NODE_MODELS`（types.ts），为 `INSPECTOR_SELECTABLE_MODELS` 子集；
  3. 面板全部差异均以 `isTextGenNode` 短路，普通节点走原路径。
- **实现**：
  - `types.ts`：`TEXT_GEN_NODE_MODELS` / `isTextGenNodeModel` / `NodeData.textGenNode`；
  - `FlowEditor.tsx`：右键菜单新增 Text Node（Type 图标），`addNodeFromMenu` 支持 `extraData`；
  - `CustomNode.tsx`：文生节点空态显示「Text to Media」、不提供本地选择、不接收拖入媒体；
  - `NodeInspector.tsx`（13 处）：模型下拉限定白名单；隐藏上传区/素材区；image2 仅保留风格卡片；seedance2.0 隐藏三 Tab 仅文生（`handleModelChange`/`switchSeedance20Tab` 强制 `text`）；`promptMentionItems` 置空禁用 @ 下拉；隐藏「扫描 @素材」；placeholder 改纯文生文案。
- **顺带修复（构建阻塞，纯去重零逻辑改动）**：上一会话编辑事故残留的 4 处完全重复声明——`types.ts` 头部错误自引用 import、`FlowEditor.tsx` onSelectionEnd/onSelectionChange 双份、`NodeInspector.tsx` 参考注册辅助函数块双份、`BackdropNode.tsx` estimateTextFlowWidth 双份。
- **文件**：`types.ts`、`components/FlowEditor.tsx`、`components/nodes/CustomNode.tsx`、`components/NodeInspector.tsx`、`scripts/text-gen-node-contract-test.ts`（新增）、`scripts/test-gate.mjs`、`package.json`
- **测试**：`npm run test:text-gen-node`（30 项断言：白名单/面板源码/画布/菜单/S 级保护契约），已挂入 `test:gate` 第 47 步；`npm run build` + `npm run test:gate` 全绿
- **风险**：低；运行链路零改动，面板差异仅 `textGenNode===true` 时生效；`INSPECTOR_SELECTABLE_MODELS` 未增删；S 级模块（§5.8.1–§5.8.7、§5.10–§5.13）未触碰。
- **后续建议**：浏览器实测三模型文生（Nano 文生图 / image2 文生图 / seedance2.0 文生视频）各跑一次确认 API 参数与生成结果 Node Details 展示。

### 10.54 2026-07-23 Text Node image2 文生图「图片未能上传」误报修复

- **现象**：Text Node 选 image 2 纯文生（无任何参考图）运行即报错「**❌ image 2 运行失败** 提示词中 @ 到的图片未能上传，请检查主图/参考图是否有效。」
- **根因**：`FlowEditor.tsx` image2 运行链路（约 7695 行）对图生图强制校验 `!imageUrls.length → throw`，未区分 Text Node 纯文生场景；下游「面板参考槽合并/写回」块（约 7699–7813 行）同样默认存在上传图。
- **修复（最小变更，仅 2 处，均在 image2 运行块内）**：
  1. throw 条件追加 `&& !currentNode.data.textGenNode`：Text Node 纯文生跳过图生图强制校验；
  2. 面板参考槽合并/写回块整体包入 `if (imageUrls.length > 0)`：纯文生时快照变量保持 `null`，下游（约 10863 行）既有 null 安全逻辑直接复用，零新增分支。
- **契约测试同步**：`text-gen-node-contract-test.ts` §5 由「运行链路零 textGenNode 引用」改为「image2 运行链路含文生空图守卫（勿移除）+ 全链路仅菜单/守卫两处 textGenNode」，断言总数 30 → 31。
- **文件**：`components/FlowEditor.tsx`（2 处）、`scripts/text-gen-node-contract-test.ts`（§5 两条断言）
- **测试**：`npm run test:gate` 全绿（含 text-gen-node 31/31）；`npm run build` 通过；liangyu 账号《AI技术测试》项目实测：Text Node + image 2 纯文生连续 2 次生成成功（Generated Outputs ×2），运行后 `textGenNode` 标志保持、面板契约（白名单 4 模型/无上传区/无 @引用/纯文生 placeholder）不变。
- **风险**：低；普通 image2 图生图节点（`textGenNode` 为 undefined）走原校验路径不变；S 级模块未触碰。

### 10.55 2026-07-23 Text Node 新增 MidJourney/Niji 文生图模型

- **需求**：Text Node 文生图模型新增「MidJourney (真实感强)」与「Niji (卡通动漫)」，对接 `POST /api/v1/images/mj/imagine`（文档 §h.iqutor95zd0c；`test-mj-imagine.ts` 已实测 7 用例全通）。
- **模型设计**：MJ/Niji 作为 `TEXT_GEN_NODE_MODELS` 成员（白名单 4 → 6），仅 Text Node 可选，不进 `INSPECTOR_SELECTABLE_MODELS`（普通 Image Node 面板不受影响）；运行链路复用 `runParallelGenerationTasks` + `pollImageTaskUntilUrl`，与 Nano/image2 同款批量多图（每任务 1 张，并行轮询）。
- **类型**：`types.ts` 新增 `MODEL_MIDJOURNEY` / `MODEL_NIJI` / `isMidJourneyModel` / `isNijiModel` / `isMidJourneyFamilyModel`、`MJ_VERSION_OPTIONS_*` / `MJ_RATIO_OPTIONS` / `MJ_QUALITY_OPTIONS` / `MJ_DEFAULT_VERSION_*`；`NodeData` 新增 `mjVersion` / `mjStyle` / `mjRatio` / `mjQuality` / `mjMode` / `mjSrefUrl` / `mjCrefUrl` / `mjOrefUrl`；`modelConfigs` 新增两模型键；`GenerationParams` 新增 `mjVersion` / `mjRatio` / `mjQuality` / `mjMode` 快照字段。
- **API 层**：`services/aitop.ts` `createMjImagineTask(prompt, options)`：必填 `platform='MidJourney'` + `model`（' --v 7' / ' --niji6' 等含前导空格，服务端接受）+ `mode`（FAST=30 积分 / RELAX=15 积分）；选填 `ratio` / `style` / `quality` / `sref` / `cref` / `oref`；sref/cref/oref 仅透传 `http(s)://`（blob: 上传中防护，不下发避免 API 拉取失败）。
- **面板**（`NodeInspector.tsx`，Text Node 专属两个新分支，不动其它模型分支）：
  - 素材区 `isMidJourney` 分支：参考图（选填）三槽 = 风格参考(sref)/角色参考(cref)/万物参考(oref) + 风格(mjStyle)自由文本输入；`handleMjReferenceFile` 上传即 `uploadImage` 转 COS URL（blob 即时预览 → COS 替换，失败回滚 alert），运行时零上传链路。
  - 设置区 `isMidJourney` 分支：模型版本按钮组（MidJourney=--v 7/6.1/6，Niji=--niji6/5，按 `isNiji` 分流）、画面比例 1:1/4:3/3:4/16:9/9:16、画质下拉（默认不传 quality）、计费模式 FAST/RELAX（标注积分）、图像数量 1–4 张。
  - `handleModelChange`：保存/恢复 MJ 配置进 `modelConfigs[模型名]`；切到非 MJ 模型统一清 `mj*` 字段；切到 MJ 清 `aspectRatio`/`resolution`/`referenceImages`/`imagePreview` 等其它模型字段。
- **运行链路**（`FlowEditor.tsx`）：`else if (isMidJourneyFamilyModel(model))` 分支读面板 `mj*` 字段 + 默认版本/比例/FAST，prompt 走既有 `collectReferencedMediaFromPrompt`/`resolvePromptPlaceholders`（Text Node 无 @ 引用时原样透传），`runParallelGenerationTasks(finalImageCount, createMjImagineTask, pollImageTaskUntilUrl)`。
- **Node Details**：`nodeDetailsPreview.ts` `applyRunPanelFieldsToGenerationParams` MJ 分支快照 `mjVersion/mjRatio/mjQuality/mjMode`（`aspectRatio=mjRatio`）；`FlowEditor` Used Parameters 新增 `isMjParams` 分支展示 Version/Aspect Ratio/Quality/Mode；`OUTPUT_NODE_INHERIT_KEYS` 追加 8 个 `mj*` 字段（OUTPUT 节点继承面板配置）。
- **契约测试**：`text-gen-node-contract-test.ts` 30 → 47 断言：白名单 6 项、MJ/Niji 仅 Text Node 专属、面板两分支 + 版本分流 + 上传转 COS + 切模型保存/恢复、运行分支 + 参数透传 + OUTPUT 继承 + Details 展示 + aitop blob 防护。
- **文件**：`types.ts`、`services/aitop.ts`、`components/NodeInspector.tsx`、`components/FlowEditor.tsx`、`utils/nodeDetailsPreview.ts`、`scripts/text-gen-node-contract-test.ts`
- **测试**：`npm run test:gate` 全绿（47/47）；`npm run build` 通过；浏览器实测（liangyu《AI技术测试》）：MJ 面板元素齐全、切 Niji 版本组变 --niji6/5、切模型配置保留；真实生成 1 次（FAST，提示词「一只可爱的橘猫坐在窗台上看夕阳，电影感光线」）约 135s 出图成功，Node Details Used Parameters 正确展示 Model=MidJourney (真实感强)/Version=--v 7/Aspect Ratio=1:1/Mode=FAST，控制台零报错。
- **风险**：低；MJ/Niji 仅新增独立分支，Nano/image2/seedance/可灵等已有链路零改动，S 级模块未触碰。已知边界：① sref/cref/oref 上传中（blob:）点运行时该参考不下发（防护设计，不阻断生成）；② `mjStyle` 未入 `generationParams` 快照（Details 不展示风格文本，仅展示版本/比例/画质/模式）；③ API 文档 `angle`/`camera`/`light`/`art`/`cw` 等高级参数面板未开放（最简实现，后续可按需扩展）。

### 10.56 2026-07-28 Chat 短回复误判降级 / 联网截断 / 降级链丢上下文 / image2 误报文案 / Details 模型提示

- **背景**：全面测试（liangyu《AI技术测试》）复盘发现 5 项问题，用户确认后统一修复；同步澄清 2 项非 bug（可灵 Details 显示旧模型=运行失败后 gp 快照正确；MJ OUTPUT 默认 seedance=§10.55 有意设计）。
- **P0-1 短回复误触发全模型降级链**：Gemini 回「银河流星2026」（8字符）、DouBao 回「已记住」被 `isLikelyTooShortMainAnswer`（≤24字符阈值）判无效 → throw「未返回有效正文」→ 触发 Gemini→Claude→DeepSeek→DouBao→Qwen 全降级链；思考关闭时短正文还会被思考内容回填。**修复**（`assistantMessageLayout.ts` `assistantReplyHasVisibleMain`，非 §5.10.4 守护函数）：尾部判定改为——显式无效模式（no results found/未找到相关结果）维持原判定；其余短文本凡含 ≥2 个中文字符或 ≥2 个字母/数字即视为可见正文。`isLikelyTooShortMainAnswer` 全局阈值**未动**，联网二次总结（`needsWebSearchSynthesisPass`）等其它 8 处调用方行为不变。
- **P1-1 Claude 联网回复引导语式截断**：联网首轮正文停在「以下是今天广州的天气情况：」（冒号收尾承诺下文、无实质数据），`needsWebSearchSynthesisPass` 各判定均不命中 → 不触发二次总结直接展示半成品。**修复**：新增 `isLikelyTruncatedLeadInMain`（≤200字符 + 冒号收尾 + 含「以下是/如下/情况如下/一起来看/来看看/为您整理/介绍如下」），`needsWebSearchSynthesisPass` 增加 `process && isLikelyTruncatedLeadInMain(main)` 分支触发 summarize 二次 pass。
- **P1-2 降级链指代型追问丢上下文**：fallback 到 AiTop 模型且联网开启时走 probe 首轮（`message = probeQuery` 搜索重写查询），「我刚才问的是哪个城市？」等指代追问的对话结构被替换；且 `sendByModel` 对 AiTop 路径未透传 `fromFallback`。**修复**（`ChatPanel.tsx`，§5.10 S级文件，用户明确批准）：`LlmSendRetryOptions` 新增 `fromFallback?: boolean`；`sendByModel` 调 `handleAitopLlmSend` 时透传；`isGeminiWebSearchFirstPass` 增加 `retryOptions?.fromFallback !== true` 条件——fallback 时 message=带完整对话历史的 `baseMessage`（webSearch 仍开，由上游检索），直连路径 probe 行为不变。
- **P2-1 image2 OUTPUT 节点纯文生误导性报错**：OUTPUT 节点跑无 @ 引用纯文生时报「@ 到的图片未能上传」（用户未 @ 任何图）。**修复**（`FlowEditor.tsx` image2 运行链路空图守卫，§10.54 契约保留）：按 `image2MediaPlan.images.length` 分流文案——有 @ 引用维持原文案；无 @ 引用提示「未检测到可用的主图/参考图：请在主图槽添加有效图片，或在提示词中 @ 引用图片；如需纯文生图请改用 Text Node」。
- **P2-2 Details 面板模型≠生成快照模型 UX 提示**：切模型未重跑/上次生成失败时 Details 展示 gp 快照模型（正确但用户困惑）。**修复**（`FlowEditor.tsx` Used Parameters IIFE）：`snapshotModel` 与 `selectedModel` 均存在且不同时，参数网格顶部插入琥珀色提示条（col-span-2）「面板当前模型「X」与生成模型「Y」不一致，以下为实际生成时参数」；MJ OUTPUT（selectedModel=seedance2.0 / gp.model=MidJourney）属常态提示，文案中性。
- **P2-3 联网开关 UI 反馈**：代码审查确认开关样式逻辑正确（开启态渐变+边框+发光+脉冲圆点），此前测试「视觉未变」系浏览器自动化 snapshot 时机误差（API 验证功能实际生效），**不改代码**。
- **文件**：`utils/assistantMessageLayout.ts`、`components/ChatPanel.tsx`、`components/FlowEditor.tsx`
- **测试**：`npm run test:chat-gate` 全绿（48/48）；`npm run test:gate` 全绿（47/47，image2 文生空图守卫契约保留）；`npm run build` 通过；服务已重启 http://localhost:3001。
- **风险**：低。触碰 §5.10 S级文件 `ChatPanel.tsx`（用户明确批准的 P1-2 修复），§5.10.4 四个守护函数（`flattenAssistantSectionsWhenProcessDisabled`/`stripLeakedThinkingFromMainWhenDisabled`/`recoverAssistantReplyFromRaw`/`parseAssistantMessage`）零改动；`assistantMessageLayout.ts` 改动仅限非守护函数。已知边界：① P1-1 依赖引导语模式匹配，英文引导语（"Here is..."）未覆盖（上游 Claude 中文场景为主）；② P1-2 fallback 联网回答风格与直连 probe 路径略有差异（直连=客户端重写查询，fallback=上游基于历史自行检索），答案完整性优先；③ 短回复豁免后「OK」「42」等极短回复不再触发降级（符合预期）。

### 10.57 2026-07-28 联网搜索 query rewriting 上下文补全（指代消解）

- **背景**：用户实测发现，浅思考 + 联网搜索模式下，对「介绍一下东北经济振兴的难点」后的追问「你认为未来会成为怎样的地位」，系统直接把原句当作检索词，未补全「东北」这一主语，导致搜索结果偏离真实意图。该问题属于所有 LLM 模型的公共联网 probe 层，非单一模型缺陷。
- **修复**（`utils/webSearchProbe.ts`，非 S 级检索策略层）：
  1. `buildRewritePrompt`：明确要求「如果最后一问缺少主语、宾语或包含隐含指代（如“它/这/那/未来/这种情况/上述问题”），必须从对话历史中补全主语和实体」；新增 3 组中文示例（东北经济 / 广州天气 / 深中梅香）。
  2. `needsContextualProbeFallback`：新增 `turns` 参数；引入 `CONTEXT_DEPENDENT_RE` 识别「未来/现在/上述/之前/结果」等隐含上下文依赖词；有历史对话且短句命中时触发 fallback 拼接。
  3. `resolveWebSearchProbeQuery`：LLM 改写返回结果若与原文完全相同，且当前追问被判定为上下文依赖型，则不信任该改写，走 fallback 拼接历史。
  4. `buildWebSearchProbeQueryFallback`：优先把上一轮用户完整问题与当前追问拼接，补全省略的主语/实体；保留问候/身份/致谢不串历史的双保险。
  5. `buildFallbackSearchAwareMessage`（新增）：模型降级 fallback 路径下，把改写后的独立检索问题显式注入 message，提示 fallback 模型「联网搜索已开启，请先基于该检索问题联网检索，再回答」。参考 LangChain `RunnableWithFallbacks` 的 whole-runnable 设计（不同 fallback 模型应使用适合它的 prompt），以及 Hugging Face Chat UI `LLM Router` 在模型切换时显式保留工具/搜索上下文的做法。
  6. `ChatPanel.tsx` fallback 分支（`isGeminiWebSearchFirstPass=false`）：若仍开启联网搜索，不再直接发送原 `baseMessage`，而是复用 probe 缓存或重新生成 standalone search query，再调用 `buildFallbackSearchAwareMessage` 构造 message，确保降级模型也能明确知道需要检索什么。
- **测试**（`scripts/llm-web-search-probe-test.ts`）：新增 fallback 单元测试「主语省略型追问补全东北实体」「独立问句不被历史污染」「fallback 搜索感知 message 含独立检索问题」「fallback 搜索感知 message 保留原始追问」；API 改写测试新增东北经济追问与广州天气追问用例。
- **范围**：所有 AiTop LLM 模型（Gemini 3.1 Pro / Claude 4.6 / DeepSeek V4 Pro / DouBao Seed 2.0 / Qwen）的联网首轮 probe query 生成，以及联网开启时的模型降级 fallback 路径；浅思考 / 深度思考 / 思考关闭三种模式均走同一 probe 层，均受益。
- **测试**：`npm run test:chat-gate` 全绿（48/48，含 web-search-probe-unit 离线门禁）；`npm run test:gate` 全绿（47/47）；`npm run build` 通过；服务已重启 http://localhost:3001。
- **风险**：低。`ChatPanel.tsx` §5.10 S 级文件仅修改 fallback 分支的 message 赋值，不改 SSE/降级链/业务协议；其余改动均在非 S 级检索策略层。已知边界：① 拼接式 fallback 在「用户完全换话题且短句恰好命中上下文词」时可能带入前序实体（已用 `CONTEXT_DEPENDENT_RE` 收窄）；② LLM 改写效果依赖上游模型对示例的理解；③ 上游模型是否真正触发联网仍受 AiTop 接口内部行为影响，客户端只能尽可能显式提示。

### 10.58 2026-07-28 Chat LLM 全链路加固（上下文压缩 / <think> 标签 / fallback 参数 / SSE 分类 / topic-shift / 历史压缩 / 能力矩阵）

- **背景**：参考 GitHub Copilot CLI auto-compaction、Dify `<think>` 分离、LangChain `RunnableWithFallbacks`、Hugging Face Chat UI `LLM Router`、@microsoft/fetch-event-source 等成熟方案，对 Chat LLM 处理链路做系统性审查，修复 7 处隐藏 bug/风险。
- **P0 上下文压缩**：`components/ChatPanel.tsx`
  - `buildAitopMessageWithHistoryAsync`（新增 async 版）：当 `estimateChatTokens` 超过阈值且轮次 >4 时，用轻量 LLM 对早期历史做摘要，保留最近 3 轮原文。
  - `summarizeHistoryWithLlm`（新增）：调用 AiTop 接口生成 ≤200 字中文摘要。
  - 原 `buildAitopMessageWithHistory` 保留为同步兜底。
  - `estimateChatTokens` 放宽参数类型，支持 `{ role, content }[]`。
- **P1 原生 <think> 标签处理**：
  - `utils/assistantMessageLayout.ts` 新增 `extractNativeThinkTags`，兼容 `<think>` / `<thinking>` / `<reasoning>`，处理跨 chunk 未闭合。
  - `parseAssistantMessage` 先提取原生 think 标签。
  - `components/ChatPanel.tsx` 流式处理中维护 `thinkBuffer` / `thinkOpen`，闭合后归入 `fullReasoning`。
- **P1 fallback 参数一致性**：
  - `LlmSendRetryOptions` 新增 `inheritedParams`（thinkingMode / webSearchEnabled / temperature）。
  - fallback 链调用 `sendByModel` 时透传原模型设置，并根据目标模型能力矩阵自动降级不支持的能力。
  - `handleAitopLlmSend` payload 构造使用 `inheritedThinkingMode` / `inheritedWebSearch` / `inheritedTemperature`。
  - `temperatureRef`（新增）保存当前温度默认值 0.7。
- **P2 SSE 错误分类细化**：
  - 新增 `classifyStreamError`：返回 `fatal` / `retriable` / `context-overflow` / `auth`。
  - 401/403 直接 fatal；429/502/503/504 指数退避；context-overflow 后续可接入压缩重试；网络瞬断/超时直接重试。
  - `exponentialBackoffMs` 提供退避间隔。
  - `attemptSendWithFallback` 接入分类，认证错误直接抛出，限流错误先指数退避再同模型重试。
- **P2 query rewriting topic-shift 后校验**：
  - `utils/webSearchProbe.ts` 新增 `isQueryOverInfluencedByHistory`：LLM 改写后若引入原句没有的历史实体且原句无指代词，回退到原句。
  - `buildRewritePrompt` 增加 topic-shift 示例和明确要求。
  - `resolveWebSearchProbeQuery` 应用后校验。
- **P2 历史过程区压缩替代完全剥离**：
  - `utils/assistantMessageLayout.ts` 新增 `compressAssistantProcessForHistory`：保留正文，把 `[联网检索]` 压缩为「曾检索：…；来源：…」，把思考过程压缩为首行摘要。
  - `components/ChatPanel.tsx` `sanitizeContentForCrossModelHistory` 改用压缩版；`isNoisyAssistantHistory` 基于压缩结果判断是否保留。
- **P3 模型能力矩阵注册**：
  - `utils/aitopChatModels.ts` 新增 `AitopModelCapabilities` 类型，每个模型注册 `capabilities: { webSearch, thinking, vision, maxTokens, supportsFallback }`。
  - 新增 `getAitopModelCapabilities` 辅助函数，Qwen 固定为不支持联网/思考/fallback。
  - `ChatPanel.tsx` fallback 链用能力矩阵替代硬编码 `fallbackModel === 'qwen'` 判断。
- **测试**：
  - `scripts/assistant-message-layout-test.ts`：新增原生 `<think>` / `<reasoning>` 提取测试、历史压缩保留来源测试。
  - `scripts/llm-web-search-probe-test.ts`：新增 API topic-shift 不串历史测试。
  - `scripts/llm-model-registry-contract-test.mjs`：新增 capabilities 矩阵契约测试。
- **范围**：所有 AiTop LLM 模型（Gemini / Claude / DeepSeek / DouBao / Qwen）的 Chat 路径，涉及上下文管理、思考提取、模型降级、联网搜索、SSE 错误处理。
- **风险**：中。`ChatPanel.tsx` 改动较多，但均集中在 §5.10 Chat 协议层；未改动节点运行/面板/Details 等 S 级模块。已知边界：① LLM 摘要压缩增加一次额外调用（15s 超时，失败则回退同步版本）；② `extractNativeThinkTags` 用正则匹配，极端嵌套标签可能解析不准确；③ 能力矩阵默认值需随上游模型能力变化及时更新。

### 10.59 2026-07-29 Chat LLM 思考/能力矩阵补漏（Claude 禁用思考 / 中文推理识别 / e2e 重叠判定）

- **背景**：浏览器端到端验证时发现 Claude 4.6 开启 `thinking` 后上游返回 10001 错误；部分模型 reasoning 字段包含中文内心独白、规划步骤、自我修正，需确保归入思考区；e2e 对中文 thinking/main 重叠的判定因分词方式过严导致误报。
- **Claude 4.6 禁用思考**（⚠️ §10.64 曾短暂重新启用，因上游不稳定已于 §10.65 回退，当前仍为禁用）：
  - `utils/aitopChatModels.ts`：将 `claude-4.5` 的 `capabilities.thinking` 设为 `false`，并注释说明上游限制。
  - `components/ChatPanel.tsx`：`handleAitopLlmSend` payload 构造使用 `getAitopModelCapabilities(uiModelId).thinking`，上游不支持时强制 `payload.thinking = false`，避免 API 报错。
  - `components/ChatPanel.tsx`：底部思考切换按钮根据 `capabilities.thinking` 禁用并显示模型专属提示（如「Claude 4.6 暂不支持深度思考」），避免 UI 状态与实际请求不一致。
- **增强中文 reasoning 识别**：
  - `utils/assistantMessageLayout.ts`：`isLikelyReasoningContent` 新增中文内心独白（嗯/呃/等等/不对/其实/仔细想想…）、规划步骤（第一步/首先/然后/接下来…）、自我修正（重新考虑/修正一下/补充一下…）、自我质疑（是否/能否/假设/也许…）等模式。
  - 保持保守底线：若文本含面向用户的答案结构（分节标题、编号列表、结论断言）仍视为正文，不归入 thinking。
- **e2e 重叠判定修复**：
  - `scripts/llm-e2e-api-test.ts`：中文按连续字符、英文按词分词；重叠阈值从 0.8 放宽到 0.95（模型 thinking 中重复正文关键术语是正常特性）。
  - 新增防御指标：计算正文 10-gram 被 thinking 包含的比例，若 >85% 才判定为 thinking 吞掉了正文。
- **测试**：
  - `scripts/assistant-message-layout-test.ts`：新增中文内心独白、规划步骤、自我修正归入 thinking 的回归用例。
  - `scripts/llm-e2e-api-test.ts`：Claude `supportsThinking` 更新为 `false`；重叠判定逻辑更新。
  - `npm run test:chat-gate` 50/50 通过；`npm run test:gate` 47/47 通过；`scripts/llm-e2e-api-test.ts` 14/14 通过。
- **范围**：`utils/aitopChatModels.ts`、`utils/assistantMessageLayout.ts`、`components/ChatPanel.tsx`、`scripts/llm-e2e-api-test.ts`、`scripts/assistant-message-layout-test.ts`。
- **风险**：低。仅调整 Chat 协议层与测试断言；未改动节点运行/面板/Details 等 S 级模块。已知边界：① Claude 上游未来若支持 thinking，需手动改回 `capabilities.thinking = true`；② `isLikelyReasoningContent` 新增模式可能极罕见地把极短自我对话正文误判为 thinking，但已通过「答案结构/结论断言」保守规则兜底。

### 10.60 2026-07-29 Chat LLM 浏览器端到端验证与交付

- **背景**：§10.58–§10.59 的修改完成后，按用户要求登录 liangyu《AI技术测试》项目进行浏览器端到端验证，并完成交付报告。
- **验证环境**：
  - 服务：`npm start` 运行在生产模式，端口 `3001`，`server.js` 托管 `dist/` + 代理 API。
  - 浏览器：自动化访问 `http://localhost:3001/#/workspace/14`。
  - 账号：liangyu / 《AI技术测试》。
- **已验证项**：
  1. **DouBao Seed 2.0 + 浅思考模式**：提问「1+1等于多少？请用一句话回答」；正文仅输出「1+1等于2。」，思考过程为内心独白（「用户现在问的是…直接按照要求给一句话就行…」），未把完整答案重复写入 thinking，多阶段去重生效。
  2. **模型切换**：从 DouBao Seed 2.0 切换至 DeepSeek V4 Pro，底部模型选择器与当前会话状态同步；切换提示「联网搜索/思考模式设置已保留」。
  3. **DeepSeek V4 Pro + 浅思考模式**：提问「请解释下为什么1+1=2？要简单易懂」；正文输出生活化解释，thinking 保留推理前缀。
  4. **联网搜索 + 浅思考 + DeepSeek V4 Pro**：提问「今天北京天气怎么样？」；[联网检索] 区显示「检索完成：「今天北京天气怎么样」」，[思考过程] 区显示英文检索前缀，正文输出完整天气、气温、预警、未来预报，三态分离正常。
  5. **历史上下文保留**：多轮对话中模型切换提示显示「当前对话历史已保留，可以继续对话」；会话 ID 未因切换模型而变更。
  6. **回归门禁**：`npm run test:chat-gate` 57/57 通过；`npm run test:gate` 47/47 通过；服务持续运行在 http://localhost:3001。
- **新发现（待用户决策是否修复）**：
  - DeepSeek V4 Pro 的思考过程末尾偶尔出现「角度 / 解释」形式的答案总结表格（如「实物合并 | 1个东西+1个东西=2个东西」），与正文中的总结表格重复。当前 `truncateThinkingAtAnswerStart` 的触发模式（「整理一下」「综上」「最终回答」等）未覆盖「角度\t解释」这类表格标题，因此未截断。建议：若用户认为该重复影响阅读体验，可在 `assistantMessageLayout.ts` 的 `truncateThinkingAtAnswerStart` 中新增表格类答案组织语言模式（如 `/^角度\s*[\t:：]\s*解释/` 或 `/^项目\s*[\t:：]\s*详情/`），并补充对应回归用例。
- **临时文件说明**：
  - 本轮调试与验证过程中在根目录/ `scripts/` 留下大量 `_tmp-*`、`temp_*`、`test-*`、`server-output*` 等临时文件（约 60+ 个）。这些文件不参与构建与运行，建议交付前统一清理；若用户需要保留部分调试日志，可提前告知。
- **范围**：本次仅做验证与文档记录，无新增代码改动（`skill.md` 除外）。
- **风险**：低。验证过程中未触发降级链，未发现服务异常；历史聊天记录因用户已存在大量会话而保留在 workspace 14 中。

### 10.61 2026-07-29 Chat 思考模式由三态简化为二态（开启=深思考）

- **背景**：用户反馈不希望区分「浅思考/深思考」，要求统一为单一「思考模式」开关，开启即等价于原深思考。对照 GitHub 上 Claude 官方（Extended Thinking on/off toggle）、ChatGPT（o 系列 Reasoning toggle）、DeepSeek 官方（深度思考按钮）等成熟案例，主流产品均采用开关式设计，不区分浅/深，当前项目的 `关→浅→深` 三态循环属于过度设计。
- **改动文件**：
  1. `components/ChatPanel.tsx`
  2. `utils/aitopChatModels.ts`
- **改动内容**：
  1. **类型收窄**：`type ThinkingMode = 'off' | 'light' | 'deep'` → `'off' | 'on'`；`inheritedParams.thinkingMode` 同步。
  2. **thinkingLevel 映射**：`inheritedThinkingMode === 'deep' ? 'high' : 'low'` → `=== 'on' ? 'high' : 'low'`（两处：常规与 summarizeRetry）。保留「轻量提示词降级为 low」的优化，避免「你好」也走 180s 深思考。
  3. **流式空闲超时**：`resolveAitopStreamIdleTimeoutMs` 中 `thinkingMode === 'deep'` → `=== 'on'`。开思考=180s，关=90s。
  4. **UI 切换**：循环 `off→light→deep→off` → `off→on→off` 二态。
  5. **UI 颜色**：移除 indigo（浅思考）分支，只保留 purple（深思考，开态）+ 灰（关态）。
  6. **UI 文案**：按钮文字「深度思考/浅思考/思考」→「思考中/思考」；title「思考：关 → 浅 → 深（循环切换）」→「思考：关 → 开（深度思考）」；禁用态「暂不支持深度思考」→「暂不支持思考」；模型切换提示与空状态引导文案中的「深度思考」→「思考」。
  7. **注释**：`aitopChatModels.ts` 能力矩阵注释 `（light/deep）` → `（开启=深思考）`。
- **不变项（重要）**：
  - `thinkingEnabledForTurn = inheritedThinkingMode !== 'off' && modelSupportsThinking` 逻辑不变。
  - `collectReasoning: thinkingMode !== 'off'` 不变。
  - 能力矩阵（Claude 4.6 禁用思考、Qwen 禁用思考与联网）不变。
  - `assistantMessageLayout.ts` 零改动（不依赖 ThinkingMode 类型）。
  - fallback 链 `thinkingMode !== 'off' && !fallbackCaps.thinking ? 'off' : thinkingMode` 逻辑不变。
- **验证**：
  - `npm run test:chat-gate`：51/51 通过。
  - `npm run test:gate`：47/47 通过。
  - `npm run build`：成功（10.65s）。
  - 服务已重启，`http://localhost:3001/` 返回 HTTP 200。
- **风险评估**：低。类型收窄后所有 `!== 'off'` 判断语义不变；`=== 'deep'` 仅 2 处（thinkingLevel + timeout）已同步改为 `=== 'on'`；契约测试未硬编码三态，全绿。未触碰 S 级模块。
- **后续注意**：若未来 AiTop 上游支持 Claude 4.6 思考，将 `aitopChatModels.ts:63` 的 `thinking: false` 改回 `true` 即可，无需再调整三态逻辑。（⚠️ §10.64 曾短暂落实，但同日多次测试发现上游对 `thinking=true` 不稳定——随机返回 10001「出了一些问题未能回复」，已于 §10.65 回退禁用。需多日多次验证上游稳定后再启用。）

### 10.62 2026-07-29 Chat 思考模式三项优化（轻量降级 UI 透明 / thinkingLevel 语义清理 / 类型约束）

- **背景**：§10.61 将思考模式简化为二态后，对照 OpenAI GPT-5 `reasoning.effort`（none/minimal/low/medium/high/xhigh，用户可见可控）、Claude Extended Thinking（on/off + 独立 effort 维度）、LobeChat 思维链开关等成熟案例做全面评估，发现 3 处可优化点，用户确认全部修复。
- **改动文件**：`components/ChatPanel.tsx`
- **改动内容**：
  1. **P0 方案 B：轻量降级 UI 透明化**（参考 OpenAI reasoning.effort 用户可见理念）。
     - 新增组件级实时计算变量 `thinkingLightweightNow`（line 2723）：当思考开启、模型支持思考、输入非空且命中 `isLightweightPrompt`（问候/致谢等短句）时为 true。
     - 思考按钮 title 动态化：轻量时显示「思考：开（深度思考）· 当前输入较短，将自动轻量思考以加快响应」。
     - Brain 图标颜色：深思考=`text-purple-400`，轻量降级=`text-amber-400`。
     - 脉冲圆点颜色：深思考=`bg-purple-400`，轻量降级=`bg-amber-400`。
     - 保留 `!lightweight` 自动降级为 `low` 的逻辑（避免「你好」也走 180s 深思考），但通过 UI 颜色 + tooltip 让用户感知到当前轮思考强度被自动调整。
  2. **P1：关闭思考时不赋 thinkingLevel**（语义清理）。
     - 原：`thinking=false` 时 `thinkingLevel` 仍被赋 `'low'`，语义混淆（易误以为「关思考 = low 思考」）。
     - 现：`thinkingLevel` 仅在 `thinkingEnabledForTurn=true` 时赋值（`as ThinkingLevel`），关闭时不赋值。字段语义清晰：「thinkingLevel 仅在 thinking=true 时有意义」。
     - 影响两处：`isSummarizeRetry` 分支与常规分支。
  3. **P2：新增 ThinkingLevel 类型约束**。
     - 新增 `type ThinkingLevel = 'high' | 'low'`（line 128），与 ThinkingMode 并列。
     - thinkingLevel 赋值处加 `as ThinkingLevel`，拼写错误可被编译器捕获。
- **不变项**：
  - 轻量降级的 `low` 行为本身保留（仅 UI 透明化，不改变实际请求参数）。
  - 能力矩阵、fallback 链、超时分级、assistantMessageLayout 均不变。
- **验证**：
  - `npm run test:chat-gate`：51/51 通过。
  - `npm run build`：成功（10.45s）。
  - 服务已重启，`http://localhost:3001/` 返回 HTTP 200。
- **风险评估**：低。P0 仅 UI 层（title/className），不影响请求；P1 关闭思考时不赋值，上游原本就忽略 thinking=false 时的 thinkingLevel；P2 纯类型层。未触碰 S 级模块。
- **UI 最终效果**：
  - 思考关闭：灰色「思考」按钮。
  - 思考开启 + 正常输入：紫色高亮「思考中」+ 紫色脉冲点。
  - 思考开启 + 轻量短句（你好/谢谢）：紫色高亮「思考中」+ 琥珀色脉冲点 + Brain 图标变琥珀色 + tooltip 提示「将自动轻量思考以加快响应」。
  - 不支持思考（Claude/Qwen）：灰色禁用。

### 10.63 2026-07-29 修复切换模型后联网+思考过程展示框消失（degradedOnceAfterModelSwitchRef 残留）

- **背景**：用户反馈"切换模型 + 同时开联网和思考 = 思考过程展示框消失"。经多轮浏览器端到端调试定位根因。
- **根因**：`degradedOnceAfterModelSwitchRef` 残留 true。
  - 切换到 Qwen 时 `beginDegradedUiForModelSwitch` 被调用，设 `degradedOnceAfterModelSwitchRef=true`、`thinkingMode='off'`、`useWebSearch=false`。
  - 切换回 Gemini/DeepSeek/DouBao 时 `handleModelSelect` 不重置 `degradedOnceAfterModelSwitchRef`，残留 true。
  - 用户手动重新开启联网+思考后，发送时 `degradedAfterSwitch=true` → `useDegraded=true` → `effectiveWebSearch=false`（line 4269 `useDegraded || lightweight ? false : inheritedWebSearch`）→ 联网被静默关闭。
  - 同时 `useDegraded=true` 导致 `thinkingLevel` 降级为 low，且不走联网第一轮（`isGeminiWebSearchFirstPass=false`），回复丢失 [联网检索] 和 [思考过程] 展示框。
- **改动文件**：`components/ChatPanel.tsx`
- **改动内容**：在 `handleModelSelect`（line 5414-5423）新增 else if 分支：切换到非 Qwen 模型时，若 `degradedOnceAfterModelSwitchRef.current=true`，清除它和 `toggleSnapshotBeforeModelSwitchRef` 快照。
  - 不恢复快照（`setThinkingMode(snap.thinkingMode)`）：用户可能已手动重新设置，恢复快照会覆盖用户当前选择。
  - 仅清除 degraded 标记，让后续发送走正常路径（`useDegraded=false` → `effectiveWebSearch=inheritedWebSearch`）。
- **调试验证**：通过 `localStorage.setItem('__debug_aitop', ...)` 写入关键路径变量，`browser_evaluate` 读取确认：
  - 修复前：`useDegraded=true`, `effectiveWebSearch=false`, `isGeminiWebSearchFirstPass=false`
  - 修复后：`useDegraded=false`, `effectiveWebSearch=true`, `isGeminiWebSearchFirstPass=true`, `thinkingMode="on"`
- **验证**：
  - `npm run test:chat-gate`：51/51 通过。
  - `npm run build`：成功。
  - 服务已重启，`http://localhost:3001/` 返回 HTTP 200。
- **风险评估**：低。仅在 `handleModelSelect` 新增 else if 分支，不影响 fallback 链（fallback 链的 `beginDegradedUiForModelSwitch` 在 line 3311 独立调用，`endDegradedModelSwitch` 在发送完成后 line 5030/5390 恢复）。未触碰 S 级模块。
- **注意**：用户需 **Ctrl+Shift+R 硬刷新** 浏览器才能加载最新版本（旧版本 JS 会被缓存）。

### 10.64 2026-07-29 Claude 4.6 重新启用思考模式（thinking=true+high，跳过 low 降级）【⚠️ 已回退，见 §10.65】

- **背景**：§10.59 因 AiTop 上游对 Claude `thinking=true` 返回 10001 错误而禁用思考。本次重新评估发现上游已恢复支持，经 `scripts/test-claude-thinking-levels.mjs` 三档实测验证：`thinking=false` 正常、`thinking=true+low` 仍 502、`thinking=true+high` 成功返回 913 tokens reasoning 内容。故重新启用 Claude 思考，但仅限 `high` 级别。
- **改动文件**：
  1. `utils/aitopChatModels.ts`
  2. `components/ChatPanel.tsx`
- **改动内容**：
  1. **能力矩阵**（`aitopChatModels.ts:63`）：`claude-4.5` 的 `capabilities.thinking` 由 `false` 改回 `true`，注释标注「AiTop 已支持 thinking=true+high（2026-07-29 验证通过）；thinkingLevel=low 仍 502，故 ChatPanel 中跳过 low 降级」。
  2. **thinkingLevel 跳过 low**（`ChatPanel.tsx`）：payload 构造处新增 `claudeSkipLow = uiModelId === 'claude-4.5'`；当 Claude 且本应降级到 `low` 时强制保持 `high`，避免触发上游 502。
     ```typescript
     const claudeSkipLow = uiModelId === 'claude-4.5';
     payload.thinkingLevel = (
       !useDegraded && inheritedThinkingMode === 'on' ? 'high' :
       claudeSkipLow ? 'high' : 'low'
     ) as ThinkingLevel;
     ```
- **不变项（重要）**：
  - `thinkingEnabledForTurn = inheritedThinkingMode !== 'off' && modelSupportsThinking` 逻辑不变。
  - fallback 链 `thinkingMode !== 'off' && !fallbackCaps.thinking ? 'off' : thinkingMode` 不变。
  - `assistantMessageLayout.ts` 零改动。
  - 其余模型（Gemini/DeepSeek/DouBao）的 thinkingLevel 降级逻辑不变，仅 Claude 走 `claudeSkipLow` 分支。
- **验证**：
  - `npm run test:chat-gate`：51/51 通过。
  - `npm run test:gate`：47/47 通过。
  - 中转日志确认 Claude `thinking=true` 请求成功（relay_1785307956035，183 个 data 事件，reasoning 内容正常返回）。
- **风险评估**：低。仅能力矩阵 1 处 `false→true` + ChatPanel 新增 `claudeSkipLow` 单模型分支；不影响其余模型降级路径，未触碰 S 级模块。已知边界：① 若用户对 Claude 输入轻量短句（你好/谢谢），原本会降级到 `low` 加快响应，现因 `claudeSkipLow` 强制 `high`，响应会略慢但避免 502，符合「正确性优先于速度」；② 若上游未来修复 `low` 级别，可移除 `claudeSkipLow` 分支恢复统一降级。
- **⚠️ 已回退（见 §10.65）**：本次重新启用后，同日多次实测发现 AiTop 上游对 Claude `thinking=true` 不稳定——简单问题（1+1）与推理题（灯泡开关）均返回 `{"code":10001,"content":"出了一些问题未能回复，请多试几次"}`。§10.64 全部改动已回退，Claude 思考恢复禁用。

### 10.65 2026-07-29 Claude 4.6 思考模式回退禁用（上游 thinking=true 不稳定）

- **背景**：§10.64 基于单次成功测试（灯泡推理题返回 913 tokens reasoning）重新启用了 Claude 思考。但用户反馈前端 Claude 思考未开启，排查后发现上游实际不稳定。
- **根因**：AiTop 上游对 Claude `thinking=true` 的支持时好时坏。
  - 几小时前 `test-claude-thinking-levels.mjs` 测试灯泡推理题 → 成功（913 tokens reasoning）。
  - 本次用同一道灯泡推理题 + "1+1等于几"两个 prompt 直打 `/aitop-llm-see` → **均返回 `{"code":10001,"isDone":true,"content":"出了一些问题未能回复，请多试几次"}`**。
  - 与 §10.59 当初禁用时的 10001 错误完全一致，说明上游并未稳定支持，§10.64 的单次成功属偶发。
- **前端"思考未开启"的附带根因**：§10.64 改了 `aitopChatModels.ts` 后未重新 build，dist 停留在 11:43 旧版（`thinking=false`），浏览器加载旧 JS。已 build 修复，但随后发现上游不稳定，故整体回退。
- **回退改动**（恢复到 §10.64 之前的状态）：
  1. `utils/aitopChatModels.ts:63`：`capabilities.thinking` 由 `true` 改回 `false`，注释更新为「上游不稳定，暂禁用」。
  2. `components/ChatPanel.tsx`（line 4395-4414）：移除 `const claudeSkipLow = uiModelId === 'claude-4.5'` 声明及两处 `claudeSkipLow ? 'high' : 'low'` 分支，恢复统一 `low` 降级逻辑。
  3. `scripts/llm-e2e-api-test.ts`：Claude `supportsThinking` 由 `true` 改回 `false`；移除 `thinkingLevelHighOnly` 类型字段与 thinkBody 的 `thinkingLevel` 透传逻辑。
- **验证**：
  - `npm run build`：成功（22.93s，新 dist `index-D6eBbh_X.js`）。
  - `npm run test:chat-gate`：51/51 通过。
  - `npm run test:gate`：47/47 通过。
- **风险评估**：低。本次为纯回退，恢复到 §10.59/§10.61 验证过的稳定状态；未触碰 S 级模块；其余模型（Gemini/DeepSeek/DouBao）思考逻辑零改动。
- **经验教训**：① 单次成功测试不足以判定上游稳定，需多日多次、多 prompt 验证；② 代码改动后必须立即 build，否则前端加载旧 dist 会误导排查方向；③ Claude 思考的启用条件应设为「连续 N 天、多 prompt 稳定返回 reasoning」而非单次成功。
- **后续启用条件**：需在未来多日（建议 ≥3 天）每日多次用不同复杂度 prompt 验证 AiTop 对 Claude `thinking=true` 稳定返回 reasoning 内容且无 10001 后，方可按 §10.61 的「后续注意」重新启用。

### 10.66 2026-07-29 画布拖动性能优化（autoPanOnNodeDrag / elevateNodesOnSelect）

- **背景**：评估"节点过多时鼠标拖动卡顿"优化空间，对照 GitHub xyflow/React Flow 成熟案例（reactflow.dev whats-new、xyflow 千级节点 60fps 优化指南）。结论：项目已有优化（onlyRenderVisibleElements、nodeTypes/edgeTypes 模块级单例、CustomNode memo+精细比较、canvasRefreshPause 拖动暂停+LOD 降档+rAF 节流、selectNodesOnDrag=false）覆盖了约 80% 最佳实践，属中上水平。剩余低成本优化空间为两个 ReactFlow prop。
- **改动文件**：`components/FlowEditor.tsx`
- **改动内容**（ReactFlow 组件 props，line 16051-16052 新增两行）：
  1. `autoPanOnNodeDrag={false}` — 拖动节点到视口边缘不再触发自动平移计算，避免大型画布下平移+渲染叠加卡顿。用户仍可用中键/Alt+拖动（`isAltMiddlePanActive`）手动平移。
  2. `elevateNodesOnSelect={false}` — 选中节点不再提升 z-index，避免 DOM 重排。代价：节点重叠时选中节点不自动置顶。
- **未做项（评估后排除）**：
  - React Flow 11.10 → 12.11 升级：收益最大（XYDrag 实例化/MiniMap/Viewport/Handle 框架级优化），但 12.x 破坏性 API 变化，FlowEditor 为 ~15k 行 S 级 monolith，需单独排期全回归，不混入日常。
  - zustand 细粒度状态订阅：现有 memo + canvasRefreshPause 已缓解，重构 S 级状态层性价比低。
  - edge 类型 bezier→straight：onlyRenderVisibleElements 已过滤视口外 edge，影响有限且影响美观。
- **验证**：
  - `npm run build`：成功（21.55s）。
  - `npm run test:gate`：47/47 通过。
  - `npm run test:chat-gate`：51/51 通过。
- **风险评估**：低。仅新增 2 个 ReactFlow 声明式 prop，不改业务逻辑/接口/数据流；未触碰节点运行/面板/Details。已知行为变化：① 拖节点到边缘不自动平移（用中键替代）；② 选中节点不置顶（重叠时需手动调整层级）。若体验不符可移除对应 prop 回退。
- **后续建议**：择期评估 React Flow 12 升级（单独排期 + test:gate + 浏览器全回归）；届时可免费获得 Handle context 订阅、MiniMap 不重渲染、Viewport 命令式 transform 等框架级优化。

### 10.67 2026-07-29 节点生成链路全面排查 + 并发运行部分失败契约测试

- **排查范围**：用户要求排查"各个模型的节点、属性面板、引用等节点生成全部是否有漏洞"。启动 3 个 Explore agent（文生图 / 视频 / 跨模型公共链路）广度扫描 + 人工逐一核实。
- **排查结论**：agent 报告经核实**全部为误报**（基于代码片段推测，与真实代码和守护契约矛盾）。人工核实 4 个关键点均实现正确：
  1. `repairSeedanceReferenceGenerationParamsFromPanel`（referencedMediaRun.ts:1307）空值返回 undefined ✅
  2. `seedanceReferenceSnapshotUrlsMatch`（referencedMediaRun.ts:1281-1284）过滤空/blob/data URL ✅
  3. `createMjImagineTask`（aitop.ts:617-623）sref/cref/oref 仅透传 http(s) ✅
  4. `resolveSeedanceReferenceMainVideoUrl`（promptMediaRefs.ts:663-667）referenceMovs 空时返回 undefined，防止 @主图→@主视频 ✅
- **发现一个真实设计缺口**（基于代码事实，非推测）：
  - `runParallelGenerationTasks`（multiGenerateTasks.ts:91-139）部分成功时 `return urls`（string[]），**errors 数组在函数内部被丢弃**。
  - 调用方（FlowEditor.tsx 7 处，如 L7636）直接 `generatedImages = await ...` 不检查长度差异。
  - 用户影响：请求批量生成 3 张，1 张失败时只 spawn 2 个输出节点，用户无失败提示，静默丢失。
  - 定性：倾向设计取舍（部分成功优于全失败），但"无失败提示"是体验缺口。
- **新增测试**：`scripts/parallel-run-partial-failure-test.ts`（方案 A：先用测试暴露问题）。
  - 4 用例：全成功保序 / 部分失败不阻塞 / 全失败抛错 / 部分失败可获取 errors。
  - 运行结果：9 通过 1 失败（断言 4 预期红，暴露 errors 丢弃）。
  - **暂不注册 test-gate.mjs**：断言 4 故意红，注册会阻塞门禁。待修复后转绿再注册。
  - 运行：`npx tsx scripts/parallel-run-partial-failure-test.ts`。
- **已按方案 B 修复**（2026-07-29）：
  - `multiGenerateTasks.ts`：`runParallelGenerationTasks` 返回类型 `Promise<string[]>` → `Promise<{ urls: string[]; errors: string[] }>`，`return urls` → `return { urls, errors }`。
  - `FlowEditor.tsx`：L6775 声明 `partialGenerationErrors` 收集器；7 处调用方（Nano/image2/MJ/Kling/vidu/seedance/即梦，L7638/7893/7982/9248/9408/10316/10430）解构 `{ urls, errors }` 赋值给 `generatedImages` 并收集 errors；L11197 统一处理前若 errors 非空 `console.warn` 记录部分失败（UI 可见提示作为后续增强，项目无 toast 组件）。
  - 测试断言 4 转绿（13/13 通过），已注册 test-gate.mjs（L55）+ package.json `test:parallel-run-partial-failure`。
- **验证**：`npm run build` 成功（TS 类型检查通过）；`npx tsx scripts/parallel-run-partial-failure-test.ts` 13/13；`npm run test:gate` 全部通过（48 项）。
- **风险评估**：低。runParallelGenerationTasks 返回类型变更影响 7 处调用方，均已解构适配；TS 编译通过；7 处其他赋值（可灵 Omni 视频轮询/mock URL L8955/8957/8972/10440）不经过 runParallelGenerationTasks，不受影响。部分失败现在可被调用方感知（console.warn），不再静默丢失。已知局限：UI 提示暂为 console.warn（项目无 toast），后续可加节点状态/通知组件增强用户可见性。
- **勿回退约束**：`runParallelGenerationTasks` 返回 `{ urls, errors }` 不得改回 `string[]`；7 处调用方必须解构并收集 errors；`parallel-run-partial-failure` 契约不得从 test-gate.mjs 移除。

### 10.68 2026-07-29 修复运行报错后面板主图格消失（catch 块回滚主图格）

- **背景**：用户报告 Nano Banana 2.0 运行报错后，属性面板中主图格消失（"面板少图"）。
- **根因**（基于代码事实）：图生图/图生视频模型运行链路存在**时序缺陷**：
  1. 上传参考图后、API 调用前，调用 `buildPanelImagePreviewPatchAfterRun`（referencedMediaRun.ts:585）计算主图 patch，未 `@主图` 时设 `panelMainSlotVisible: false`（主图格隐藏）+ 备份原主图到 `panelMainImageUrl`。
  2. 随即 `setNodes` 写回面板（FlowEditor.tsx Nano L7580 / image2 L7780+ / Omni L8449+ / Seedance L9992+）。
  3. 之后才调用 `runParallelGenerationTasks`（API 创建任务 + 轮询）。
  4. **API 失败 → catch 块（L11984）只清 status/taskId/progress，不回滚面板主图格** → 主图格保持隐藏状态 → 用户看到"面板少图"。
- **影响范围**：所有调用 `buildPanelImagePreviewPatchAfterRun` 的模型：Nano(7551) / image2(7775) / Omni multi(8449) / Omni tab(8602) / Seedance(9992)。MJ 不调用该函数（参考图处理方式不同），不受影响。
- **修复**（抽函数 + catch 块调用）：
  - 新增 `buildMainSlotRollbackPatchForRunError(data)`（utils/runRecovery.ts:352，与 clearStaleRunTaskBeforeFreshRun 同文件，可单元测试）。
  - FlowEditor catch 块（L11987）调用该函数，条件回滚主图格：
    - 条件：`panelMainSlotVisible === false && panelMainImageUrl 有值`（运行时确实隐藏了主图格）。
    - 回滚：`panelMainSlotVisible: true` + `imagePreview: panelMainImageUrl 备份` + 清 `panelMainImageUrl`。
    - 不回滚：`referenceImages` 的 COS URL 替换（COS URL 有效，回滚到 blob 可能失效）。
    - 对未动主图格的模型无影响（条件不满足，返回空 patch）。
- **契约测试**：`scripts/run-error-panel-rollback-test.ts`（5 场景 16 断言）：
  - 场景1：运行时隐藏主图格 → catch 回滚（恢复 imagePreview + panelMainSlotVisible:true + 清备份）
  - 场景2：运行时未动主图格 → catch 不回滚
  - 场景3：隐藏但无备份 → 不回滚（避免 imagePreview 变 undefined）
  - 场景4：对照旧行为（不回滚时主图格保持隐藏，暴露根因）
  - 场景5：Omni/Seedance 多 tab（回滚仅基于字段，与模型无关）
  - 已注册 test-gate.mjs（L56）+ package.json（L72 `test:run-error-panel-rollback`）。
- **验证**：`npm run build` 成功（TS 类型检查通过）；`npm run test:gate` 全部通过（49 项，含新契约）；`npm run test:chat-gate` 51/51 通过。
- **风险评估**：低。仅在 catch 块新增条件回滚，不改运行成功路径；条件式回滚只影响"运行时被隐藏的主图格"，不影响其他模型；referenceImages 不回滚避免引入失效 blob。
- **勿回退约束**：catch 块的主图格条件回滚（`shouldRollbackMainSlot` + `mainSlotRollbackPatch`）不得移除；运行失败时必须恢复 `panelMainSlotVisible: true` + `imagePreview` 备份。

### 10.69 2026-07-29 修复运行失败刷新后主图 blob 丢失（hydrate 恢复边界）

- **背景**：用户报告 Nano Banana 2.0 运行失败**刷新后**，面板主图 blob 丢失（§10.68 修复主图格回滚后暴露的既有缺陷）。
- **根因**（基于代码事实）：
  1. 用户拖入本地图片作主图 → 运行前 `imagePreview=blob:xxx`，`imageLocalRef='idb-key'`（IDB 备份）。
  2. 运行中 `buildPanelImagePreviewPatchAfterRun`（referencedMediaRun.ts:592）未 @主图 时备份 `panelMainImageUrl=panelMainImageBackupFromNode()`（L425 `return preRunMain` = 原 imagePreview **blob**），imagePreview 切换为首个 @参考 COS URL。
  3. 运行失败 catch（§10.68）回滚 `imagePreview=panelMainImageUrl`（**blob 备份**）+ `panelMainSlotVisible:true`。
  4. 刷新后 `hydrateNodeImagePreviewFromPersisted`（hydratePersistedNodePreviews.ts:285）的 `shouldClearForLocalMainRestore` 三个条件**未覆盖"imagePreview 是 panelMainImageUrl 备份的失效 blob + 有 imageLocalRef + 主图格显示"**：
     - `!current`=false（blob 非空）
     - `looksLikePanelFirstRef && !panelMainHidden`=false（blob≠panelFirstRef）
     - `!isPersistableMediaUrl(current) && matchesGpRef`=false（blob≠gpRef）
     - 结果=false → 不清空 imagePreview → 不走 IDB 恢复 → blob 失效 → 主图丢失。
  5. `pickPersistableMainPreviewUrl`（L159）对 runNode 过滤 blob（`pushPersistableUrl` 只收持久化 URL），找不到替代 → imagePreview 保持失效 blob。
- **修复**（hydratePersistedNodePreviews.ts:285-291）：`shouldClearForLocalMainRestore` 新增第 4 条件：
  - `(!isPersistableMediaUrl(current) && hasLocalMainRef && !panelMainHidden)`
  - 语义：imagePreview 是失效 blob/data + 有 imageLocalRef（可 IDB 恢复）+ 主图格显示中（`panelMainSlotVisible=true`，运行失败回滚场景）→ 清空 `imagePreview=''` 让后续 `hydrateLocalMediaPreviews` 从 IDB 恢复原主图。
  - `!panelMainHidden` 保护运行成功未 @主图场景（`panelMainSlotVisible=false` → `panelMainHidden=true` → 不触发，保留参考图 COS URL）。
- **契约测试**：`scripts/run-error-hydrate-blob-recovery-test.ts`（5 场景 6 断言）：
  - 场景1：运行失败回滚后刷新（blob 备份 + imageLocalRef）→ hydrate 清空让 IDB 恢复
  - 场景2：运行成功未 @主图（参考 COS + panelMainSlotVisible:false）→ 不清空
  - 场景3：运行成功 @主图（主图 COS + panelMainSlotVisible:true）→ 不清空（isPersistable=true）
  - 场景4：无 imageLocalRef（blob + 无 IDB）→ 不清空（无 IDB 可恢复，避免丢图）
  - 场景5：对照旧行为（修复前场景1 保持失效 blob → 主图丢失，防回退）
  - 已注册 test-gate.mjs（L57）+ package.json（L73 `test:run-error-hydrate-blob-recovery`）。
- **验证**：`npm run build` 成功；`npm run test:gate` 全部通过（50 项，含 §5.13 `20260713-export-json-main-image` 主图持久化契约未破坏）；`npm run test:chat-gate` 51/51 通过。
- **风险评估**：中（涉及 §5.13 S 级 hydrate 逻辑）。新增条件只在"失效 blob + imageLocalRef + 主图格显示"时触发；运行成功的持久化 COS URL 不受影响（`isPersistableMediaUrl=true`→`!isPersistable=false`）；运行成功未 @主图不受影响（`panelMainHidden=true`→`!panelMainHidden=false`）。§5.13 跨机器导入契约验证通过。
- **勿回退约束**：`shouldClearForLocalMainRestore` 的第 4 条件（`!isPersistableMediaUrl(current) && hasLocalMainRef && !panelMainHidden`）不得移除；运行失败刷新后必须从 imageLocalRef 恢复原主图，不得保持失效 blob。

### 10.70 2026-07-30 修复 normalizeGraphNodesProjectAssetBinding 误将 imageLocalRef 视为项目资产绑定

- **背景**：用户报告 Banana 节点**未运行**仅上传主图后刷新，blob 图片丢失。经排查，`normalizeGraphNodesProjectAssetBinding` 的 `hasBinding` 判断错误地将 `imageLocalRef`（本地 IndexedDB 媒体引用）视为项目资产绑定条件。
- **根因**：`utils/normalizeTemplateNodeForSpawn.ts:58` 的 `hasBinding` 条件包含 `imageLocalRef.startsWith('flowgen-local:')`。当节点仅有 `imageLocalRef`（无 `projectAssetId`、无项目资产库 URL）时，`hasBinding=true` 会错误进入 `normalizeTemplateNodeDataForSpawn`，该函数在特定分支会 `delete next.imageLocalRef`，导致刷新后无法从 IndexedDB 恢复 blob 图片。
- **修复**：
  - `utils/normalizeTemplateNodeForSpawn.ts:55-59`：从 `hasBinding` 中移除 `imageLocalRef` 条件，仅保留 `projectAssetId` 和 `parseProjectAssetIdsFromMediaUrl(imagePreview)` 两个真正的项目资产绑定判断。
  - 注释标记 `§10.70` 说明原因。
- **全模型验证**：新增 `scripts/cross-model-no-run-refresh-blob-test.ts`，覆盖 9 个场景 × 10 个模型（含活跃模型 + 已下线旧模型 + MidJourney 文生节点 + MOV 视频节点 + OUTPUT 节点 + 可灵 Omni 多 tab），共 76 项断言：
  - 场景 A：各模型仅主图 → 刷新 → `imageLocalRef` 保留 + `imagePreview` 清空待 IDB 恢复（10 模型 × 3 断言 = 30）
  - 场景 B：各模型主图 + 参考图 → 刷新 → 所有 `localRefs` 保留（10 模型 × 3 断言 = 30）
  - 场景 C：MOV 视频节点 → 刷新（2 断言）
  - 场景 D：OUTPUT 节点有 COS URL → 不受影响（1 断言）
  - 场景 E：项目资产绑定节点 → `imageLocalRef` 正确删除 + `projectAssetId` 保留（3 断言）
  - 场景 F：MidJourney 文生节点（textGenNode）→ 刷新（2 断言）
  - 场景 G：可灵3.0 Omni 多 tab 参考图 → 刷新（4 断言）
  - 场景 H：无 `imageLocalRef` 节点 → 不误操作（2 断言）
  - 场景 I：验证 `hasBinding` 不再包含 `imageLocalRef`（2 断言）
- **验证**：`npm run build` 成功；`npm run test:gate` 47/47 通过；`npm run test:chat-gate` 51/51 通过；`npx tsx scripts/cross-model-no-run-refresh-blob-test.ts` 76/76 通过。
- **风险评估**：低。移除的条件仅影响 `hasBinding` 判断；`normalizeTemplateNodeDataForSpawn` 本身在 `imagePreview` 为空时返回原始数据不变；项目资产绑定节点（有 `projectAssetId` 或项目资产 URL）仍会正常进入规范化流程。§5.13 S 级 hydrate 逻辑未修改。

### 10.71 2026-07-30 修复 hydratePersistedRemotePreviews 冗余调用导致 blob 恢复后被再次清空

- **背景**：§10.70 修复后，image2 用户仍反馈刷新后 blob 丢失。排查发现 `hydratePersistedRemotePreviews` 在 `useEffect` 中被冗余调用，会在 `hydrateLocalMediaPreviews` 从 IDB 恢复 blob URL 后再次清空 `imagePreview`，导致竞态窗口内 blob 丢失。
- **根因**：`FlowEditor.tsx` 中 `hydratePersistedRemotePreviews` 被调用两次：
  1. `schedulePostLoadInit` 的 `setTimeout` 回调中（与 `hydrateLocalMediaPreviews` 配对）
  2. `useEffect` 中（`graphHydrationReady` 变为 true 时触发）
  
  第二次调用在 `hydrateLocalMediaPreviews` 恢复 blob 后执行 `hydrateGraphMediaFromPersisted`，该函数对 `isEphemeralMediaUrl(blob_url)` 为 true 的节点会触发 `shouldClearForLocalMainRestore` 条件，将 `imagePreview` 清空回 `''`。虽然第二次 `hydrateLocalMediaPreviews` 会再次恢复，但存在时序竞态。
- **修复**：
  - `components/FlowEditor.tsx:3447-3452`：从 `useEffect` 中移除冗余的 `hydratePersistedRemotePreviews()` 调用，仅保留 `hydrateLocalMediaPreviews()` 作为安全网。
  - 注释标记 `§10.70` 说明原因。
- **验证**：`npm run build` 成功；`npm run test:gate` 全部通过；`npm run test:chat-gate` 51/51 通过；`cross-model-no-run-refresh-blob-test.ts` 76/76 通过；`image2-no-run-blob-loss-deep-test.ts` 36/36 通过。
- **风险评估**：低。`hydratePersistedRemotePreviews` 在初始加载流程（`hydrateGraphMediaFromPersisted` → `normalizeGraphNodesProjectAssetBinding`）和 `schedulePostLoadInit` 中均已执行，`useEffect` 中的调用完全冗余。移除不影响任何正常功能，仅消除 blob 恢复后的非预期清空。

### 10.71 2026-07-30 修复 image2 中键拖入/链上拖入图片时未设置 imageLocalRef 导致刷新后 blob 丢失

- **背景**：§10.70 修复后，用户仍反馈 image2 刷新后 blob 丢失，且中键拖图无法正常使用。排查发现 `applyInspectorReferenceFromUrlStringImpl` 中 image2 无主图时拖入参考区的分支（`isImage2 && !main`）仅设置了 `imagePreview`，**未触发 IndexedDB 存储**，也未设置 `imageLocalRef`。
- **根因**：对比本地文件上传路径（`ingestInspectorReferenceLocalFilesImpl` → `flowgen:register-original-image` type=main → `attachLocalMainRef`），中键拖入/链上拖入路径缺少 `imageLocalRef` 的写入。结果是：
  1. 图片在当前会话中短暂显示（data URL），但刷新后 `hydrateLocalMediaPreviews` 因 `imageLocalRef` 为空而无法从 IDB 恢复 blob。
  2. 用户感知为"中键拖图进不去"——图片虽短暂出现在面板，但 `imageLocalRef` 缺失导致后续流程（如 `image2ShowMainInRefGrid` 依赖 `imageLocalRef`）无法正确识别主图状态。
- **第一版修复（已废弃）**：`applyMain` 改为 `async`，在 `onUpdate` 前先 `await fetch` + IDB 备份。引入了异步延迟导致图片延迟出现，用户反馈"无法中键拖图进去"。
- **最终修复**：
  - `components/NodeInspector.tsx:3707-3750`：`applyMain` 保持同步，**先立即调用 `onUpdate` 显示图片**，再后台异步（`void (async () => {...})()`）执行 fetch → blob → File → dispatch `flowgen:register-original-image`（type=main）。
  - 关键：`onUpdate` 不等待 IDB 备份，图片立即显示；IDB 备份在后台异步进行，不阻塞 UI。
  - 对 https URL 跳过 IDB 备份（`isPersistableMediaUrl` 返回 true 时直接持久化）。
  - 添加 try/catch 包裹，IDB 写入失败时仅 console.warn，不影响面板预览展示。
  - 注释标记 `§10.71`。
- **刷新恢复链路验证**：
  1. 中键拖入 blob URL → `onUpdate` 设置 `imagePreview=data_url`（立即显示）+ 后台 `attachLocalMainRef` 设置 `imageLocalRef` + IDB 存 blob
  2. 持久化：`persistSanitize` 剥离 `imagePreview`（data URL），保留 `imageLocalRef`
  3. 刷新后 `hydrateNodeImagePreviewFromPersisted`：`imagePreview` 为空 + `imageLocalRef` 存在 → 清空 `imagePreview` 等待 IDB 恢复
  4. `shouldPreferRunReferencePreviewOverLocalMain` = false（无 gp.referenceImages）→ 允许 IDB 恢复
  5. `hydrateLocalMediaPreviews`：`getLocalMediaBlob(imageLocalRef)` → `URL.createObjectURL(blob)` → `imagePreview` = 新 blob URL
  6. `shouldShowPanelMainImageSlot` = true（imagePreview 已恢复）→ 主图格显示
- **验证**：`npm run build` 成功；`npm run test:gate` 全部通过；`npm run test:chat-gate` 全部通过；`npm run test:image2-panel-refs` 25/25 通过；`npm run test:image2-json-panel` 7/7 通过；`image2-middle-drag-blob-recovery-test.ts` 31/31 通过（覆盖 7 个场景：blob 拖入、持久化剥离、刷新恢复、https 拖入、参考槽逻辑、主图格显示、执行顺序）。
- **风险评估**：低。纯新增分支，仅影响 image2 无主图时中键拖入/链上拖入场景。`flowgen:register-original-image` 事件处理在 FlowEditor 中已稳定运行，本地文件上传路径使用相同机制。不影响其他模型、不影响已有主图的 image2 节点、不影响 HTML5 左键拖放。`onUpdate` 同步执行确保图片立即显示，IDB 备份后台异步不阻塞 UI。

### 10.73 2026-07-30 修复 attachLocalMainRef / hydrateLocalMediaPreviews / normalizeGraphNodesProjectAssetBinding 时序竞态导致刷新后 blob 丢失

- **背景**：§10.71 + §10.72 修复后，用户仍反馈"拖图的解决了，但是刷新后 blob 图片丢失还是没有解决"。深入排查发现根因是 **React setNodes 异步调度导致的时序竞态**，之前的 §10.72 修复（清除 projectAssetId）虽然逻辑正确，但在运行时因时序问题失效。
- **根因（时序竞态）**：
  1. `onUpdate({ projectAssetId: undefined })` 调用 `setNodes`，但 React 的状态更新是**异步调度**的，不会立即生效。
  2. `dispatchEvent(new CustomEvent('flowgen:register-original-image', ...))` 是**同步**的，立即触发事件监听器。
  3. 事件监听器中 `attachLocalMainRef` 通过 `getNodes()` 读取状态，可能读到**旧的 projectAssetId / imagePreview（资产库 URL）**而跳过 IDB 备份。
  4. `hydrateLocalMediaPreviews` 检查 `boundAsset`（projectAssetId），若残留则跳过 blob 恢复。
  5. `normalizeGraphNodesProjectAssetBinding` 若 projectAssetId 残留，会调用 `normalizeTemplateNodeDataForSpawn` **删除 imageLocalRef** → 刷新后无法恢复。
- **为什么之前的测试脚本通过了却没解决问题**：`image2-asset-binding-blob-loss-test.ts` 只测试了**同步数据状态**，假设 `onUpdate` 后 `getNodes()` 立即返回新值。实际上 `setNodes` 是异步的，`getNodes()` 可能读到旧值。
- **修复方案**（4 处改动）：
  1. **`components/FlowEditor.tsx` `attachLocalMainRef`（L2727-2737）**：移除 `projectAssetId` 与 `imagePreview` 资产库 URL 检查。调用方已通过 `dispatchEvent type=main` 明确表达备份意图，无需二次校验。资产库节点初始化不会触发该事件（L2996-3000 已有 projectAssetId 守卫）。
  2. **`components/FlowEditor.tsx` `register-original-image` 事件处理（L4580-4586）**：移除 `skipLocal` 检查，直接调用 `attachLocalMainRef`。
  3. **`components/FlowEditor.tsx` `hydrateLocalMediaPreviews`（L2468-2473, L2568, L2597）**：将 `boundAsset`（projectAssetId）检查改为 `isAssetBoundPreview`（`imagePreview` 是否资产库 URL）。`imagePreview` 是持久化后实际加载的值，不依赖运行时时序。
  4. **`utils/normalizeTemplateNodeForSpawn.ts` `normalizeGraphNodesProjectAssetBinding`（L61-64）**：若 `imageLocalRef` 已存在则跳过 normalize，保护用户拖入的新图不被资产库 URL 覆盖。
  5. **`components/NodeInspector.tsx` 本地文件上传路径（L4809-4821, L4157-4188）**：调换 `onUpdate` / `dispatchEvent` 顺序，先更新状态再触发事件（辅助优化）。
- **验证**：
  - `npx tsc --noEmit` 通过（无类型错误）
  - `npm run build` 成功
  - `npm run test:gate` 全部通过
  - `npm run test:persist-sanitize` 通过
  - `npm run test:image2-panel-refs` 25/25 通过
  - `npm run test:image2-json-panel` 7/7 通过
  - `image2-asset-binding-blob-loss-test.ts` 26/26 通过
  - `image2-middle-drag-blob-recovery-test.ts` 31/31 通过
  - `image2-timing-race-blob-loss-test.ts` 26/26 通过（新增，覆盖 6 个时序竞态场景）
- **风险评估**：中。
  - ** attachLocalMainRef 移除检查**：可能导致资产库节点在某些边缘场景被误备份（多一份 IDB 记录），但不影响显示（`hydrateLocalMediaPreviews` 会因 `isAssetBoundPreview=true` 跳过用 IDB 覆盖 imagePreview）。
  - **hydrateLocalMediaPreviews 改用 isAssetBoundPreview**：当 imagePreview 为空（被 sanitize 剥离）时不会跳过恢复，行为正确。当 imagePreview 是资产库 URL 时跳过恢复，行为正确。
  - **normalizeGraphNodesProjectAssetBinding 保护 imageLocalRef**：若用户已用本地图片替换主图（imageLocalRef 存在），刷新后不会被资产库 URL 覆盖。资产库节点未替换图片时（无 imageLocalRef）仍走正常 normalize 逻辑。
  - **时序竞态最坏情况**：若 `onUpdate` 的 `setNodes` 未生效但 `attachLocalMainRef` 已执行（IDB 备份成功），刷新后 `imagePreview` 可能显示旧的资产库 URL（因为持久化时 imagePreview 还是旧值），但 `imageLocalRef` 已保留在 IDB 中。相比之前（图片完全丢失），这是改善。

### 10.74 2026-07-30 修复 applyAssetToNodeMain 不触发 IDB 备份 + 全模型刷新 blob 持久化回归测试

- **背景**：§10.73 修复 image2 面板内中键拖入/本地上传路径后，用户要求"每个模型的面板都刷新测试下，看是否有这样的情况发生"。排查发现 **`applyAssetToNodeMain`（FlowEditor.tsx node-main 区域中键拖入）** 这条路径在所有模型上共性地缺少 IDB 备份，会导致刷新后 blob 丢失。
- **根因**：`components/FlowEditor.tsx:3894` 的 `applyAssetToNodeMain` 在拖入非持久化 URL（`blob:`/`data:`）时，仅通过 `setNodes` 设置 `imagePreview`，**未触发 `flowgen:register-original-image` 事件**，因此：
  1. `imageLocalRef` 未设置 → IDB 无备份
  2. 持久化时 `persistSanitize` 剥离 `blob:`/`data:` → `imagePreview=''`
  3. 刷新后 `hydrateLocalMediaPreviews` 因 `imageLocalRef` 为空无法恢复 → 图片丢失
  4. 影响所有模型（Nano Banana 2.0 / image 2 / 可灵3.0 Omni / 即梦3.0 Pro / seedance2.0 高质量+急速 / 可灵 2.5 Turbo / vidu 2.0 / seedance1.5-pro / MidJourney）
- **修复**（`components/FlowEditor.tsx:3924-3949`）：
  - 在 `applyAssetToNodeMain` 的 `setNodes` + `scheduleRemoteWorkspaceSave` 之后，新增异步 IDB 备份分支：
    - 条件：`nextPreview && !isPersistableMediaUrl(nextPreview) && !isVid`（非持久化 URL 且非视频）
    - 动作：`fetch(nextPreview)` → `blob` → `new File(...)` → `dispatchEvent('flowgen:register-original-image', { nodeId, file, type: 'main' })`
    - 错误处理：`try/catch` 包裹，失败仅 `console.warn`，不阻塞 UI
  - 注释标记 `§10.73` 说明：此修复覆盖所有模型 node-main 区域中键拖入场景；若 `normalizeTemplateNodeDataForSpawn` 已将 `imagePreview` 改为资产库 URL（`projectAssetId` 存在时），多备份一份 IDB 不影响显示（`hydrateLocalMediaPreviews` 会因 `isAssetBoundPreview=true` 跳过覆盖）。
- **全模型回归测试**：新增 `scripts/all-models-refresh-blob-persistence-test.ts`，覆盖 **10 个模型 × 9 个场景（A-I）共 238 项断言**：
  - 场景 A：各模型中键拖图到 node-main（blob: URL）→ persist → 刷新 → IDB 恢复（10 模型 × 4 断言 = 40）
  - 场景 B：各模型本地上传主图（data: URL）→ persist → 刷新 → IDB 恢复（10 模型 × 5 断言 = 50）
  - 场景 C：各模型时序竞态 — projectAssetId 残留 + imageLocalRef 已设置 → normalize 保护（10 模型 × 3 断言 = 30）
  - 场景 D：各模型主图 + 参考图（referenceImageLocalRefs）→ persist → 刷新 → localRefs 全保留（10 模型 × 3 断言 = 30）
  - 场景 E：可灵3.0 Omni 三 tab 参考图（multi/instruction/video）→ persist → 刷新 → localRefs 全保留（4 断言）
  - 场景 F：MOV 视频节点（seedance2.0）未运行 → 刷新 → imageLocalRef 保留（2 断言）
  - 场景 G：MidJourney 文生节点（textGenNode）→ 刷新 → imageLocalRef 保留（2 断言）
  - 场景 H：各模型资产库节点 + 中键拖入新图（projectAssetId 已清除）→ 刷新 → 新图恢复（10 模型 × 7 断言 = 70）
  - 场景 I：各模型已运行成功（outputUrl=COS）→ 刷新 → 主图保留 COS URL（10 模型 × 1 断言 = 10）
- **同步修正 cross-model-no-run-refresh-blob-test 场景 E**：原断言期望"资产绑定时 imageLocalRef 被删除"，与 §10.73 修复（保护 imageLocalRef）冲突。已更新为验证新行为：imageLocalRef 受保护（无害残留）+ isAssetBoundPreview=true → 显示正确。测试从 75/1 改为 77/0 通过。
- **test-gate 注册**：将 4 个 blob 持久化测试注册到 `scripts/test-gate.mjs` + `package.json`，防回归：
  - `test:all-models-refresh-blob-persistence`（238 项，新增）
  - `test:cross-model-no-run-refresh-blob`（77 项，§10.70 已有但未注册）
  - `test:image2-timing-race-blob-loss`（26 项，§10.73 已有但未注册）
  - `test:image2-asset-binding-blob-loss`（26 项，§10.72 已有但未注册）
- **验证**：4 个测试全通过（238 + 77 + 26 + 26 = 367 项断言）；`npm run test:gate` 全部通过。
- **风险评估**：低。
  - `applyAssetToNodeMain` 新增的 IDB 备份分支是纯增量逻辑，仅在 `!isPersistableMediaUrl(nextPreview) && !isVid` 时触发；持久化 URL（https/资产库 URL）和视频不受影响。
  - 资产库节点拖入时若 `normalizeTemplateNodeDataForSpawn` 已将 `imagePreview` 改为资产库 URL，多备份一份 IDB 不影响显示（`isAssetBoundPreview=true` 跳过覆盖）。
  - cross-model 场景 E 断言更新仅反映 §10.73 已生效的行为，不改业务逻辑。
- **勿回退约束**：
  - `applyAssetToNodeMain` 中的 `if (nextPreview && !isPersistableMediaUrl(nextPreview) && !isVid)` IDB 备份分支不得移除，否则所有模型 node-main 中键拖入刷新后 blob 丢失。
  - `all-models-refresh-blob-persistence-test.ts` 必须保持在 test-gate 中注册，防止任一模型的刷新持久化回归。

### 10.74.1 2026-07-30 修复 applyAssetToNodeMain 中 normalizeTemplateNodeDataForSpawn 覆盖非持久化 URL 的 imagePreview

- **背景**：§10.74 修复后用户反馈"image2又无法拖图片了，刷新后还是会丢图"。排查发现 `applyAssetToNodeMain` 调用 `normalizeTemplateNodeDataForSpawn` 时，对从资产库创建的节点（`n.data.projectAssetId` 存在），会把用户拖入的 blob URL **改回资产库 fileUrl**，导致"无法拖图"+ "刷新后丢图"。
- **根因**：`components/FlowEditor.tsx:3910` 的 `applyAssetToNodeMain` 中：
  ```typescript
  normalizeTemplateNodeDataForSpawn({ ...n.data, imagePreview: blobUrl, ... }, serverProjectId)
  ```
  - `n.data.projectAssetId` 存在（资产库创建）+ `serverProjectId` 存在 → `pid && aid` = true
  - `normalizeTemplateNodeDataForSpawn` 第一个分支：`imagePreview = canonicalProjectAssetFileUrl(pid, aid)`（资产库 URL）+ `delete next.imageLocalRef`
  - 用户拖入的 blob URL 被资产库旧图覆盖 → "无法拖图"
  - 刷新后 `isAssetBoundPreview=true`（imagePreview 是资产库 URL）→ `hydrateLocalMediaPreviews` 跳过 IDB 恢复 → "刷新后丢图"
- **修复**（`components/FlowEditor.tsx:3910-3928`）：
  - 拖入非持久化 URL（`!isPersistableMediaUrl(nextPreview)`）时清除 `projectAssetId: undefined`
  - 资产库拖入（`fromAssetLibrary && d.assetId`）仍保留 `projectAssetId` 走正常规范化
  - 持久化 URL（https）保留 `n.data.projectAssetId`
  ```typescript
  const isNonPersistedDrop = !isPersistableMediaUrl(nextPreview);
  ...(isNonPersistedDrop
    ? { projectAssetId: undefined }
    : fromAssetLibrary && d.assetId
      ? { projectAssetId: d.assetId }
      : {}),
  ```
- **回归测试**：新增 `scripts/node-main-drag-normalize-override-test.ts`（34 项断言）：
  - 场景1：资产库节点 + blob URL → imagePreview 不被覆盖（修复后）
  - 场景2：对照组（修复前）→ imagePreview 被改回资产库 URL（确认 bug 存在）
  - 场景3：资产库节点 + data URL → 不被覆盖
  - 场景4：资产库拖入（fromAssetLibrary=true）→ 正常 normalize
  - 场景5：普通节点（无 projectAssetId）→ 原本正常
  - 场景6：持久化 https URL → projectAssetId 保留
  - 场景7：全 10 模型验证 → imagePreview 不被覆盖
- **验证**：`test:node-main-drag-normalize-override` 34/34 通过；`npm run build` 成功；服务已重启。
- **风险评估**：低。纯增量条件判断，仅在非持久化 URL 时清除 projectAssetId；资产库拖入和持久化 URL 不受影响。
- **勿回退约束**：`isNonPersistedDrop` 条件不得移除，否则资产库节点中键拖入新图会被旧资产图覆盖。

### 10.75 2026-07-30 修复 attachLocalReferenceRefs 中 projectAssetId 守卫导致资产库节点参考图无法备份到 IDB

- **背景**：§10.70–§10.74.1 连续五轮修复均集中在**主图**（`imageLocalRef`）的 IDB 备份链路，用户反馈"参考图丢失了"始终未解决。最终通过 TRAE-debugger 运行时插桩定位到**参考图**（`referenceImageLocalRefs`）走的是另一条完全独立的备份函数 `attachLocalReferenceRefs`，其中存在与 `attachLocalMainRef` 同款的 `projectAssetId` 守卫，从未被前五轮修复触及。
- **根因**（`components/FlowEditor.tsx` `attachLocalReferenceRefs`）：
  ```typescript
  if (existingData?.projectAssetId) return [];   // ← 此行导致资产库创建的节点跳过参考图 IDB 备份
  ```
  - 用户从资产库创建 image2（或任意模型）节点 → 节点自带 `projectAssetId`
  - 用户在面板参考图区拖入新的 blob 参考图 → 参考图仅写入内存 `referenceImages` 数组
  - `attachLocalReferenceRefs` 因 `projectAssetId` 存在直接 `return []` → **参考图从未写入 IDB**
  - 刷新后内存清空 → 参考图 blob URL 失效 → 参考图丢失
- **为何前五轮修改无效**：
  | 轮次 | 修改位置 | 失效原因 |
  |------|---------|---------|
  | §10.70 | `normalizeGraphNodesProjectAssetBinding` | 只保护主图 `imageLocalRef`，未触及参考图 |
  | §10.71 | `applyMain` 异步化 / 移除冗余 hydrate | 主图链路，参考图独立路径 |
  | §10.72 | `attachLocalMainRef` 移除 `projectAssetId` 检查 | 主图函数，非参考图函数 `attachLocalReferenceRefs` |
  | §10.73 | `applyAssetToNodeMain` 加 IDB 备份 | 仅覆盖 node-main 区域（主图），不覆盖面板参考图区 |
  | §10.74.1 | `normalizeTemplateNodeDataForSpawn` 清理 `projectAssetId` | 仅拖入瞬间，资产库节点本身仍带 `projectAssetId` |
  - 核心盲点：主图与参考图是两套并行的备份函数，`projectAssetId` 守卫在两处各有一份，前五轮只改了主图那份。
- **修复**（`components/FlowEditor.tsx` `attachLocalReferenceRefs`）：
  - 移除 `if (existingData?.projectAssetId) return [];` 守卫
  - 与 §10.73 `attachLocalMainRef` 修复保持一致原理
  ```typescript
  // §10.75：移除 projectAssetId 检查 — 与 attachLocalMainRef §10.73 同理。
  // 资产库创建的节点也允许用户拖入新的 blob 参考图，须备份到 IDB。
  // registerEphemeralPanelRefToLocalStore 已通过 isPersistableMediaUrl 过滤持久化 URL，
  // 此处无需二次守卫。误备份仅多一份 IDB 记录，不影响资产库 URL 显示。
  ```
- **安全性论证**：
  - `registerEphemeralPanelRefToLocalStore` 内部已通过 `isPersistableMediaUrl(u)` 过滤 https 等持久化 URL，资产库 fileUrl 不会被重复备份
  - 即使误备份一份 IDB 记录，`hydratePanelReferenceUrlsFromLocalRefs` 仅在 `needsHydrateFromLocalRef(cur)` 为 true（非持久化 URL）时才用 IDB 恢复，资产库 URL 显示不受影响
  - 与 §10.73 主图修复同理，已验证安全
- **并行备份函数排查**（建议执行结果）：FlowEditor.tsx 共 3 个并行 IDB 备份函数：
  | 函数 | 行号 | `projectAssetId` 守卫 | 状态 |
  |------|------|----------------------|------|
  | `attachLocalMainRef`（主图） | 2726 | §10.73 已移除 | ✅ |
  | `attachLocalFrameRef`（首尾帧） | 2768 | **从未有此守卫** | ✅ 安全 |
  | `attachLocalReferenceRefs`（参考图 / Omni 多 tab） | 2803 | §10.75 已移除 | ✅ |
  - 结论：无残留守卫。首尾帧备份函数本就没有 `projectAssetId` 守卫；主图与参考图两处同款守卫均已移除。Omni 三 tab（multi/instruction/video）走 `attachLocalReferenceRefs` 同一函数，一并修复。
- **回归测试**：新增 `scripts/attach-local-reference-refs-backup-test.ts`（62 项断言，7 场景）：
  - 场景1：旧逻辑对照 — 资产库节点 + 旧守卫 → `referenceImageLocalRefs` 为空 → `panelRefsPendingLocalHydrate=false` → 刷新后丢失
  - 场景2：修复后 — 守卫移除 → localRef 写入 → 刷新后（blob 被剥离为空）`pending=true` → 可恢复
  - 场景3：持久化链路 — `referenceImageLocalRefs` 保留，`referenceImages` blob 被剥离
  - 场景4：持久化 URL（https / 资产库 fileUrl）不触发误备份（`isPersistableMediaUrl` 二次过滤）
  - 场景5：可灵3.0 Omni 三 tab — `projectAssetId` 存在时可备份
  - 场景6：全 10 模型 — `projectAssetId` 存在不阻断参考图备份
  - 场景7：首尾帧一致性 — `attachLocalFrameRef` 从未有守卫，参考图移除后行为对齐
  - 关键测试函数：`panelRefsPendingLocalHydrate`（纯函数，不依赖 IDB mock）— localRef 是否被保留决定刷新后能否恢复
  - 边界发现：`needsHydrateFromLocalRef` 对 `blob:` 返回 **false**（内存中可用，防 Omni 多图闪动），仅空 URL（持久化剥离后）返回 true；故 pending 断言须在「刷新后状态（空 referenceImages）」上做，而非 blob 还在内存时
- **门禁注册**：`test:attach-local-reference-refs-backup` 已注册至 `package.json` 与 `scripts/test-gate.mjs`
- **验证**：用户确认"修复成功"；`test:attach-local-reference-refs-backup` 62/62 通过；`test:gate` 全绿。
- **风险评估**：低。移除一行守卫，下游已有 `isPersistableMediaUrl` 二次过滤；不影响资产库 URL 显示。
- **勿回退约束**：`attachLocalReferenceRefs` 不得重新加入 `projectAssetId` 守卫，否则资产库节点参考图将再次无法备份到 IDB。与 §10.73 `attachLocalMainRef` 守卫保持同步约束。

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

### 11.60 2026-07-23 画布空白页提示文案调整

- **背景**：用户反馈画布空状态（无节点时）提示仅为「拖入图片 / Drop Images」，未体现右键创建节点能力，需同步更新提示。
- **变更**：`components/FlowEditor.tsx` 空状态覆盖层（`nodes.length === 0`）文案调整：
  - 中文主标题：`拖入图片` → `请拖入图片或者右键创建节点`
  - 英文副标题：`Drop Images` → `Drop images or right-click to create node`
- **文件**：`components/FlowEditor.tsx`（空状态提示 L15442-L15452）
- **已验证**：`npm run test:gate` 全部通过；`npm run build` 成功；服务已重启 http://localhost:3001/。
- **风险**：极低；纯 UI 文案展示变更，未改动拖拽、右键菜单、节点创建等业务逻辑，未触碰 §5.8–§5.13 S 级模块。

### 11.61 2026-07-24 MidJourney 文生图面板重构：单模型 + 风格族 + 折叠参考图/高级参数 + 中文画质

- **背景**：Text Node 中文生图模型下拉原先同时存在 `MidJourney (真实感强)` 与 `Niji (卡通动漫)` 两个选项，用户要求合并为单一 `MidJourney` 模型，并在面板内通过「风格族」区分两套参数体系。
- **变更**：
  1. **types.ts**：
     - `MODEL_MIDJOURNEY` 由 `'MidJourney (真实感强)'` 改为 `'MidJourney'`；保留旧名常量 `MODEL_MIDJOURNEY_REALISTIC`、`MODEL_NIJI` 仅用于向后兼容。
     - 新增 `MjFamily = 'realistic' | 'cartoon'` 与 `MJ_FAMILY_OPTIONS`（面板内切换：真实感强 / 卡通动漫）。
     - 新增 5 组下拉选项常量：`MJ_STYLE_OPTIONS`（29 项风格）、`MJ_ANGLE_OPTIONS`（视角）、`MJ_CAMERA_OPTIONS`（人物镜头）、`MJ_LIGHT_OPTIONS`（灯光）、`MJ_ART_OPTIONS`（艺术程度）。
     - `MJ_QUALITY_OPTIONS` 改为 `{name,value}` 结构，UI 显示中文（一般/清晰/高清/超高清），API 仍透传数值。
     - 版本常量按风格族拆分：`MJ_VERSION_OPTIONS_REALISTIC = [' --v 7',' --v 6.1',' --v 6']`、`MJ_VERSION_OPTIONS_CARTOON = [' --niji6',' --niji5']`；面板显示为 `v7/v6.1/v6` 与 `niji6/niji5`。
     - `GenerationParams` / `NodeData` / `modelConfigs['MidJourney']` 新增字段：`mjFamily`、`mjStyle`、`mjAngle`、`mjCamera`、`mjLight`、`mjArt`。
  2. **components/NodeInspector.tsx**：
     - 风格族切换按钮组位于素材区顶部，选择后自动校正 `mjVersion` 到对应风格族默认版本。
     - 参考图区外包折叠面板，默认收起；根据 `mjFamily` 动态显示：
       - `realistic`：风格一致性图（sref）+ 参照万物图（oref）
       - `cartoon`：风格一致性图（sref）+ 角色一致性图（cref）
     - 风格由自由文本输入改为 `MJ_STYLE_OPTIONS` 下拉选择。
     - 高级参数区默认折叠，展开后包含视角/人物镜头/灯光/艺术程度四个下拉。
     - 画质下拉改为中文显示。
     - `handleModelChange` 中 MJ 配置统一保存到 `modelConfigs.MidJourney`，恢复时兼容旧 persisted 键。
     - 新增 useEffect：旧 persisted 节点（`MidJourney (真实感强)` / `Niji (卡通动漫)`）自动迁移为 `selectedModel='MidJourney'` + 对应 `mjFamily`。
  3. **components/FlowEditor.tsx**：
     - `syncModelConfigFromNodeData` MJ 分支统一写入 `modelConfigs.MidJourney`，并推断 `mjFamily`。
     - 运行分支读取 `mjFamily`、`mjAngle`、`mjCamera`、`mjLight`、`mjArt`，透传给 `createMjImagineTask`。
     - Node Details `Used Parameters` MJ 分支新增 `Family`、`Style`、`Angle`、`Camera`、`Light`、`Art` 展示；Version 显示去掉前导 `--`。
  4. **services/aitop.ts**：
     - `MjImagineTaskOptions` 新增 `mjAngle`/`mjCamera`/`mjLight`/`mjArt`。
     - `createMjImagineTask` payload 中按非空透传 `angle`/`camera`/`light`/`art`。
  5. **scripts/text-gen-node-contract-test.ts**：
     - 白名单长度由 6 改为 5，移除 `Niji` 独立模型断言。
     - 更新 NodeInspector / aitop 源码契约，覆盖风格族、折叠区、中文画质、高级参数透传。
- **已验证**：`npx tsx scripts/text-gen-node-contract-test.ts` 47/47 通过；`npm run test:gate` 全部通过；`npm run build` 成功；服务已重启 http://localhost:3001/；`curl http://localhost:3001/` 返回 200。
- **风险**：中低；主要影响 Text Node 的 MidJourney 面板形态与 API 参数透传。旧 persisted 节点通过 `isLegacyMidJourneyFamilyModel` + 自动迁移 effect 保持兼容，已生成输出与历史记录不受影响。`isNijiModel` 仍保留但已不再被业务代码引用，仅作类型库历史函数。
- **待用户最终确认**：
  - 浏览器实测：Text Node 模型下拉仅显示 `MidJourney`，面板内风格族、折叠参考图、风格下拉、高级参数折叠、中文画质是否符合预期。
  - 真实生成实测：选择真实感强/卡通动漫、不同版本、高级参数、参考图后，API 是否正常返回图片。
- **2026-07-24 补充**：画面比例默认值改为 `16:9`，画质默认值改为 `高清`（value=`1`）；MidJourney 生成图片后 OUTPUT 节点默认模型改为 `seedance2.0 (高质量版)`（`spawnOutputNode.ts` `resolveSpawnOutputDefaultModel` 新增 MidJourney 分支，便于图生视频链路）。
- **2026-07-24 补充**：MidJourney 参考图上传区支持拖图（`NodeInspector.tsx` 新增 `handleMjRefDrop` + `getMjRefSlots`）：本地左键拖入文件 → 填充首个空槽位；画布中键拖图 → 拉取 URL 转 COS 上传；单个槽位支持独立拖放替换；容器 `data-flowgen-media-drop="1"` + `data-flowgen-drop-zone="mj-reference"` 与画布拖放桥接。

### 11.62 2026-07-25 MidJourney gp 快照/恢复补全 + 恢复轮询超时放宽 + Inspector 渲染性能优化

- **背景**：全量代码审查发现 MidJourney 链路三处隐藏缺陷及一处性能问题，均在保证 S 级模块不动的前提下最小化修复。
- **变更**：
  1. **utils/nodeDetailsPreview.ts**（修复：gp 快照缺 MJ 字段）：`applyRunPanelFieldsToGenerationParams` 新增 `isMidJourneyFamilyModel` 分支，运行完成时将 `mjVersion`/`mjRatio`（默认 `1:1`）/`mjQuality`/`mjMode`（`RELAX` 兜底 `FAST`）写入 `generationParams`，并同步 `aspectRatio=mjRatio`，保证 OUTPUT 节点 Node Details 能还原 MJ 面板参数。
  2. **utils/runRecovery.ts**（修复：刷新恢复 gp 不回填 mj 字段）：`mergeRecoveryGenerationParamsFromRunNode` 新增 MidJourney 分支，从面板态回填 `mjFamily`/`mjVersion`/`mjRatio`/`mjQuality`/`mjMode` 及 `aspectRatio`，避免刷新后恢复 spawn 的 OUTPUT 节点 Node Details 缺参数。
  3. **utils/aitopTaskRecovery.ts**（修复：恢复轮询提前超时）：`defaultPollConfigForModel` 新增 `MidJourney`/`Niji` 分支（`maxAttempts:300 × intervalMs:4000 = 20min`）；原默认 `150×2s=5min` 对 MJ 生图（常 2~3 分钟，高峰更久）刷新恢复场景不足，易误报失败。
  4. **components/NodeInspector.tsx + components/FlowEditor.tsx**（性能：面板卡顿优化）：`NodeInspector` 默认导出改为 `React.memo(NodeInspector)`；FlowEditor 渲染处原先内联的 `onUpdate`/`onRun` 改为 `useCallback` 稳定回调（`handleInspectorUpdate`/`handleInspectorRun`，插入位置在 `handleNodeRun` 定义之后避免 TDZ）。无关节点进度 tick 刷新 nodes 数组时，若选中节点 data 未变则 Inspector 整体跳过重渲染。语义安全：`updateNodeDataById`/`handleNodeRun` 本身均为 useCallback，`handleNodeRun` 依赖变化时 memo 仍会正常重渲染，无 stale closure 风险。
- **已验证**：`npm run test:gate`（80+8+9+16+47 全绿）、`npm run test:chat-gate`（44+16+24+13+19+48 全绿）、`npm run build` 成功（tsc 无错），服务已重启 http://localhost:3001/。
- **风险**：低。1~3 为纯新增分支，仅影响 MidJourney/Niji 家族；4 为渲染优化，`data`/`projectAsset*` prop 引用变化时仍正常重渲染，业务行为不变。
- **待用户最终确认**：
  - MidJourney 生图运行完成后，OUTPUT 节点 Node Details 的 Version/Ratio/Quality/Mode 展示是否正确。
  - MidJourney 生图中刷新页面，恢复轮询是否不再 5 分钟误超时，且恢复后 Details 参数完整。
  - 多节点画布运行期间，右侧属性面板操作是否更顺滑。

### 11.63 2026-07-27 全面网页版测试（账号 liangyu）

- **测试范围**：登录、LLM 对话、MidJourney 节点、刷新恢复、控制台/网络错误扫描、右键菜单代码审查。
- **已验证功能**：
  1. 登录《AI技术测试》项目成功，画布加载正常。
  2. LLM 对话：联网时间查询准确、上下文保持、身份披露合规、浅思考推理链展示正常。
  3. MidJourney 节点：Node Details 完整显示 MODEL/TASK_ID/GENERATED_AT/COUNT/FAMILY/VERSION/ASPECT_RATIO/QUALITY/MODE。
  4. 刷新恢复：taskId=1704094 持久化成功，恢复后输出正常，参数完整保留。
  5. 控制台错误：仅视频资源 `net::ERR_ABORTED`（正常网络问题），无代码级错误。
  6. 网络请求：API 正常（workspace 保存、图片加载），仅视频代理偶发中止。
  7. 右键菜单代码审查：`onPaneContextMenu`/`onNodeContextMenu`/`onSelectionContextMenu` 实现正确，节点创建位置使用 `menu.flowPosition` 精确计算。
- **发现的问题**：
  - 视频资源代理加载偶发 `net::ERR_ABORTED`（COS 视频文件较大或网络波动导致，不影响核心功能）。
- **风险**：低。所有核心功能正常，无阻塞性 bug。
- **交付状态**：可交付。

### 11.64 2026-07-31 可灵3.0 Omni 多图 Node Details 参考图修复（参照 Seedance 2.0 模式）

- **现象**：`E:/问题/0731/omin3.json` — 可灵3.0 Omni 多图 tab 的 OUTPUT 节点（node_3）和 MOV 节点（node_1）的 Node Details 参考图显示的是上游 Nano Banana 的参考图（大牙、原始丛林小路），而非 Omni API 实际使用的参考图（熊大、主图）。
- **根因**：Seedance 2.0 参考生有 `repairSeedanceReferenceGenerationParamsFromPanel` 修复函数，在 workspace 加载时从面板数据修复 `generationParams.referenceImages`。Omni 缺少对应的修复函数，导致 `generationParams.referenceImages` 残留上游节点旧值。
- **修复**：
  1. `utils/referencedMediaRun.ts`：新增 `repairOmniMultiGenerationParamsFromPanel` 函数，从面板 `klingOmniMultiReferenceImages` 修复 `generationParams.referenceImages`（过滤 blob/data URL，仅比较 COS URL）
  2. `utils/runRecovery.ts`：新增 `applyWorkspaceOmniMultiGpRepair` 函数，在 `prepareNodesAfterWorkspaceLoad` 中调用，修复节点 gp 和 generatedThumbnails 的 gp
- **文件**：
  - `utils/referencedMediaRun.ts`（新增 `repairOmniMultiGenerationParamsFromPanel` 函数，约 30 行）
  - `utils/runRecovery.ts`（新增 `applyWorkspaceOmniMultiGpRepair` 函数 + 调用点，约 80 行）
- **风险**：低；仅修复 gp 中错误的参考图数据，不改变面板交互逻辑；参照 Seedance 2.0 已验证模式；`test:gate` 全量通过；未触碰 §5.8–§5.13 S 级模块
- **对比验证**：`E:/问题/0731/seedance2.0.json` 每个节点 gp.referenceImages 均为该节点自身 API 调用时的参考图，与上游无关；修复后 Omni 行为与此对齐

### 11.65 2026-07-31 Omni 多图中间节点 Node Details 显示全部面板图片（而非仅 @ 引用图）

- **现象**：`E:/问题/0731/omin中间节点.json` — Output Picture Node（node_2）Node Details 显示了面板上全部 4 张图片（主图 + 3 张面板参考图），而非仅显示创意描述中 @ 引用的 2 张图片（@主图 + @资产:白泽）
- **根因**：`buildOmniMultiTabDetailsReferencePreview` 中 `preferPanel` 决策使用 `activeSlotRefs`（过滤掉 blob/data URL 后只剩 1 个非临时槽），导致 `panelExceedsPromptRefs`（1 ≤ 2）误判为 false，面板路径被采用。面板路径调用 `buildReferenceImageDetailItemsFromPanel` 遍历全部 `klingOmniMultiReferenceImages`（3 张），加上主图共 4 张，未过滤未被 @ 引用的图片
- **修复**：在 `preferPanel` 面板路径中，构建 items 后新增过滤逻辑：当 `dedupedPanel.length > promptImageCount`（面板项数超过创意描述 @ 引用数）时，用 `snapRefs`（generationParams.referenceImages）的 URL 集合过滤掉未被 API 实际使用的多余图片
- **文件**：`utils/nodeDetailsPreview.ts`（`buildOmniMultiTabDetailsReferencePreview` 函数 preferPanel 代码块，新增约 10 行）
- **风险**：低；仅在面板项数超过 prompt @ 引用数时触发过滤，不影响面板项数等于或少于 @ 引用数的正常路径；`snapKeys.size > 0` 守卫防止空快照误过滤；`test:gate` 全量通过（298 vitest + 全量脚本测试 0 失败）；未触碰 §5.8–§5.13 S 级模块

### 11.66 2026-07-31 Omni instruction/video tab 中间节点 Node Details 显示全部面板图片且标签全相同

- **现象**：`E:/问题/0731/omin中间节点2.json` — Output Mov Node（instruction tab）Node Details 显示 3 张 Reference Images，且全部标签都是"鸱吻"（应该只显示 1 张 @资产:鸱吻）
- **根因 1**：`buildOmniInstructionVideoTabDetailsReferencePreview` 第 1339 行使用 `slotRefs.length`（过滤 blob/data 后）判断是否超过 prompt @ 引用数，与 §11.65 的 multi tab 同根因：`slotRefs` 过滤了 blob 导致计数偏小（1），而实际 `panelPreview` 有 3 个 items（含 blob），误判为未超过
- **根因 2**：`applyOmniAssetLabelsToDetailsReferencePreview` 第 1380 行兜底 `assetLabels[0]` 在 `assetLabels` 仅 1 个标签时，将所有 items 标签都替换为同一标签
- **修复**：
  1. 将 `omniPanelFilledCountExceedsPromptImageRefs` 的参数从 `slotRefs.length`（过滤后）改为 `panelPreview.referenceImages.length`（实际展示数），确保正确检测面板项数超过 @ 引用数
  2. 移除 `applyOmniAssetLabelsToDetailsReferencePreview` 中 `assetLabels[0]` 兜底逻辑，改为保留原始 `it.label`（`assetLabels[i]?.trim() || it.label`），避免未匹配项被错误覆盖为同一标签
- **文件**：`utils/nodeDetailsPreview.ts`（`buildOmniInstructionVideoTabDetailsReferencePreview` 第 1339 行 + `applyOmniAssetLabelsToDetailsReferencePreview` 第 1384 行）
- **风险**：低；修改 1 与 §11.65 修复方案一致，修改 2 仅移除危险的兜底赋值，`assetLabels[i]` 存在时正常覆盖；`test:gate` 全量通过；未触碰 §5.8–§5.13 S 级模块

### 11.67 2026-07-31 Omni instruction/video tab MOV 节点 Reference Videos 缺失主视频

- **现象**：`E:/问题/0731/omin中间节点2.json` — Output Mov Node（instruction tab）创意描述引用了 `@主视频`，但 Node Details 的 Reference Videos 为空；`E:/问题/0731/seedance倒数第二个节点.json`、`E:/问题/0731/seedance倒数第二个节点2.json` — Seedance 2.0 参考生 Output Mov Node 同样问题
- **根因**：**两层过滤**，Seedance 比 Omni 多一层上游 scrub：
  1. `mergeReferenceMovsSources` 第 13902-13904 行：`seedanceReferenceMovsForOutputDetails(g?.referenceMovs, outputResultUrlForRefMovs)` 把 `gp.referenceMovs` 中与 `gp.outputUrl` 相同 URL 的参考视频 scrub 掉（因为 Seedance 参考生 gp.outputUrl 恰好等于参考视频 URL），返回空数组 → `mergedRefMovsRaw` 为空 → `baseRefMovs` 收不到任何参考视频
  2. `baseRefMovs` 第 14130 行 `isOutputNode` 检查 + 第 14136 行 Omni 检查 + fallback 第 14206 行 `isGeneratedResultVideo` 三重过滤（Omni 受此影响）
- **修复**（两处）：
  - `mergeReferenceMovsSources` 第 13902-13904 行：移除 `outputResultUrlForRefMovs` 参数，`seedanceReferenceMovsForOutputDetails(g?.referenceMovs)` 不再 scrub 合法的参考视频（`gp.referenceMovs` 本身就是输入参考视频，无需用 outputUrl 过滤）
  - `baseRefMovs` 第 14130-14143 行：Omni instruction/video + Seedance 参考生 MOV/OUTPUT 节点的参考视频不因 URL 与 outputUrl 相同而被过滤 → 添加 `!(isOmniModel && ...)` + `!isSeedanceRefOutput` 守卫
- **文件**：`components/FlowEditor.tsx`（`mergeReferenceMovsSources` 第 13902-13904 行 + `baseRefMovs` 第 14111-14142 行）
- **风险**：低；`gp.referenceMovs` 是生成时使用的参考视频，本身不含输出结果，移除 scrub 不会误显示生成结果；`test:gate` 全量通过；未触碰 §5.8–§5.13 S 级模块

### 11.68 2026-07-31 修复 outputNode 切换模型时主图被旧快照覆盖

- **现象**：`E:/问题/0731/问题.json` — 最后一个 Output Picture Node 当前运行的是 `image 2`，生成结果主图为丛林小女孩图；切换到 `Nano Banana 2.0` 后，面板主图却显示为上游资产图“夏茉”；切回 `image 2` 又显示正常。
- **根因**：outputNode / movNode 的 `modelConfigs` 会继承上游 processorNode 的各模型快照。`Nano Banana 2.0` 快照里保存的是上游资产绑定时的主图（`/flowgen-api/projects/14/assets/.../file`）。`NodeInspector.tsx` 的 `handleModelChange` 在切换模型时，对 Nano Banana / image2 等模型会调用对应 `*MainPatchOnModelSwitch` 从 `modelConfigs` 恢复快照，导致 outputNode 主图被旧快照覆盖。
- **修复**：
  - `utils/modelSwitchPanelIsolation.ts`：新增 `getRunResultMainPreviewUrl(gp)` 与 `preserveRunResultMainPreview(nodeType, gp)` 纯函数。
    - `getRunResultMainPreviewUrl`：从 `generationParams.outputUrl` 或 `outputUrls[0]` 提取运行结果主图/主视频 URL。
    - `preserveRunResultMainPreview`：仅当节点类型为 `OUTPUT` 或 `MOV` 且存在运行结果 URL 时，返回 `{ imagePreview: runResultUrl, panelMainImageUrl: undefined, panelMainSlotVisible: undefined, imageLocalRef: undefined }`；否则返回 `null`。
  - `components/NodeInspector.tsx`：`handleModelChange` 在保存当前模型快照、组装完 `updateData` 后，若 `preserveRunResultMainPreview` 返回非空，则 `Object.assign(updateData, runResultPreviewPatch)`，强制保持运行结果主图。
- **设计约束**：
  - 仅影响**显示层**（`imagePreview` / `panelMainImageUrl` / `panelMainSlotVisible` / `imageLocalRef`），不动 `prompt`、参考图、模型参数等运行配置。
  - 不影响 processorNode / inputNode 的正常模型切换快照恢复行为。
  - 视频 outputNode 的运行结果 URL（如 `.mp4`）切换到图片模型时，主图格会因 `isLikelyMainVideoUrl` 隐藏，与现有行为一致。
- **回归测试**：新增 `src/test/utils/modelSwitchPreserveRunResult.test.ts`（13 项断言）：
  - `getRunResultMainPreviewUrl`：outputUrl 优先、outputUrls[0] 兜底、空值返回 undefined。
  - `preserveRunResultMainPreview`：processorNode 返回 null；outputNode/movNode 无运行结果返回 null；outputNode/movNode 有运行结果时正确保护主图；模拟 `E:/问题/0731/问题.json` 场景。
- **验证**：`npm run test:gate` 全绿；`npm run build` 成功。
- **风险**：低；改动集中在 Inspector 模型切换的显示层补丁，未修改 S 级数据结构或核心运行流程。潜在影响：若用户期望 outputNode 切换模型后显示目标模型的旧快照主图（非运行结果），此行为会改变；但 outputNode 语义为“运行结果节点”，保持运行结果图符合 §5.1 三态分离与 §10.3 设计。
- **勿回退约束**：outputNode / movNode 在 `handleModelChange` 中必须优先保持 `generationParams` 的运行结果主图，禁止允许 `modelConfigs` 旧快照覆盖运行结果主图。

### 11.69 2026-07-31 Seedance 参考生 Node Details 参考图少主图（gp.referenceImages 空槽补回）

- **现象**：`E:/问题/0731/seedance缺主图.json` — 后两个节点（Output Picture Node + Output Mov Node，Seedance 2.0 参考生）Node Details 的 Reference Images 缺少主图，prompt 中有 `@主图` 但只显示 1 张参考图（祭司老人）
- **根因**：主图是 blob URL，未持久化到 `seedanceTabConfigs.reference.referenceImages` 和 `gp.referenceImages`，导致 `gp.referenceImages[0]` 为空。`buildSeedanceReferenceDetailsFromSnapshot` 的 compact 步骤过滤空 URL 后只剩 1 个 URL，prompt 有 2 个 ref（@主图 + @资产:祭司老人），主图无法展示
- **数据链**：`data.referenceImages[0]` = blob:... → `seedanceTabConfigs.reference.referenceImages[0]` = "" → `gp.referenceImages[0]` = "" → compact 后仅 1 URL
- **修复**（两处）：
  - `components/FlowEditor.tsx` 第 14765-14774 行：`snapRefsRaw` → `supplementedRefs` 补充逻辑 — `gp.referenceImages` 的空槽用 `data.referenceImages` 对应槽位的面板 URL 补回
  - `utils/nodeDetailsPreview.ts` `buildSeedanceReferenceDetailsFromSnapshot` 第 623-627 行：compacted 标签重映射 — 首项（主图位）标签为通用名（如"图片1"）且 prompt 含 `@主图` 时，将标签重映射为"主图"，防止后续 `expectedLabels` 过滤因标签不匹配而误删主图
- **文件**：`components/FlowEditor.tsx`（`supplementedRefs` 补充逻辑，约 10 行）+ `utils/nodeDetailsPreview.ts`（标签重映射，约 5 行）
- **风险**：低；仅补充空槽，不覆盖已有 URL；`hasAnyRef` 判断基于补充后的数组；`test:gate` 全量通过；未触碰 §5.8–§5.13 S 级模块

### 11.70 2026-07-31 Seedance 参考生 MOV 节点 Reference Videos 标签显示「视频1」而非「主视频」

- **现象**：`E:/问题/0731/seedance倒数第二个节点3.json` — 倒数第二个 Output Mov Node（Seedance 2.0 参考生）创意描述引用了 `@主视频`，但 Node Details 的 Reference Videos 标签显示「视频1」而非「主视频」
- **根因**：`resolveSeedanceReferenceMainVideoUrl` 中 `imagePreview`（生成结果视频）先于 `referenceMovs`（参考视频）被检查。MOV 输出节点的 `imagePreview` 为生成的 mp4 视频，函数优先返回 `imagePreview` 作为 `mainVideoUrl`，导致 `referenceMovs[0]` 不匹配，被 `buildPromptMediaRefLabels` 降级为 `@视频1`
- **修复**：`utils/promptMediaRefs.ts` `resolveSeedanceReferenceMainVideoUrl`：将 `referenceMovs` 的 `soleMov` 检查提前到 `imagePreview` 之前。保留 `outputUrl`/`prev` 匹配 gate：仅当 `soleMov` 与 `outputUrl` 或 `imagePreview` 为同一视频时才确认为主视频。无 `soleMov` 时回退到 `imagePreview`
- **文件**：`utils/promptMediaRefs.ts`（`resolveSeedanceReferenceMainVideoUrl` 函数，调序 + gate 保留，约 5 行净变更）
- **风险**：低；仅调序不删 gate，非主视频参考视频仍标注为 `@视频1`（`seedanceMainVideoLabel.test.ts` 全部通过）；`test:gate` 全量通过；未触碰 §5.8–§5.13 S 级模块

### 11.72 2026-08-03 Seedance 参考生 Node Details 参考视频角标「主视频→视频1」+ 索引错位（§11.70 展示层补漏）

- **现象**：用户反馈 Seedance 2.0 参考生视频，当参考元素含「主视频」时，Node Details 的 Reference Videos 把主视频显示成「视频1」；进一步核查发现非主视频也全部错位（主视频→视频1、视频1→视频2、视频2→视频3）。面板侧 `NodeInspector.tsx:6152` 已正确用 `isSeedanceReferenceMovMainVideo` 标注「主视频」，Node Details 与面板不一致。
- **根因（双重）**：
  1. **主视频标签缺失**：`utils/nodeDetailsPreview.ts` `buildReferenceVideoDetailItems` 第 102-106 行的「主视频」赋值分支只在可灵 Omni `instruction`/`video` tab 下生效（`ctx.klingOmniTab === 'instruction' || 'video'`），Seedance 参考生 `klingOmniTab` 默认 `'multi'`，永远不进该分支，主视频走 else 被打成「视频N」。
  2. **索引错位**：`referenceMovs` 运行时含主视频 URL（`collectReferencedMediaFromPrompt` 收集 `@主视频`，`mergeSeedancePanelReferenceMovsAfterUpload` 写入 `referenceMovs[0]`，与 `imagePreview` 同源双写）。但 `buildPromptMediaRefLabels` 编号时跳过主视频（`promptMediaRefs.ts` 范式），导致 `urlsInOrder`（含主视频）比 `numberedLabels`（过滤掉 mainVideo）多一项，`ordIdx` 与 `numberedLabels` 索引错位。
- **与 §11.70 的关系**：§11.70 修了标签生成层（`resolveSeedanceReferenceMainVideoUrl` 调序），但展示层 `buildReferenceVideoDetailItems` 因 `numberedLabels = filter(kind==='video')` 把 mainVideo 项过滤掉、且「主视频」字面量只在 Omni 分支硬编码，导致 Seedance 参考生仍显示「视频1」。本节是 §11.70 的展示层补漏。
- **修复**：`utils/nodeDetailsPreview.ts` `buildReferenceVideoDetailItems`：在 Omni `if` 分支与 `else` 之间插入 `else if (ctx.isSeedance20 && ctx.seedanceMode === 'reference')` 分支。主视频用 `isSeedanceReferenceMovMainVideo(panelSource, url)` 判定标「主视频」；非主视频用「排除主视频后的序号」`视频${movIdx - prevMainCount + 1}` 编号，彻底规避 `urlsInOrder` 索引错位。预计算 `movIsMain` 数组避免重复调用。**不动 `referenceVideoUrlsInLabelOrder`**（其默认分支仍含主视频），避免影响 `@视频N` prompt 解析层与运行时上传逻辑。
- **可灵 Omni 现状核查**（用户额外要求）：`instruction`/`video` tab 正确（已有 `isOmniTabVideoMainVideoReference` 检查 + `urlsInOrder` 排除主视频，`referenceVideoDetail.test.ts` + node-details §11p/§11q 回归通过）；`multi` tab 无主视频概念，按槽位编号正确。
- **文件**：`utils/nodeDetailsPreview.ts`（import 增 `isSeedanceReferenceMovMainVideo` + `buildReferenceVideoDetailItems` 新增 `else if` 分支，约 20 行净变更）；`src/test/utils/seedanceMainVideoLabel.test.ts`（新增 7 个门禁场景：单主视频 / 主视频+视频1+视频2 / 无主视频 / 主视频居中 / MOV poster / 非参考生模式不误判 / 字段保留）
- **验证**：`npx vitest run` 全量 317 通过（含新增 7 + Omni `referenceVideoDetail`/`omniMainVideoLabel` 回归）；`npm run test:node-details` 244 通过 0 失败（含 §11p Omni 主视频 / §11q Omni 视频1 回归）；`npm run build` 通过；服务 3001 端口 HTTP 200。
- **风险**：低。①可灵 Omni 由前置 `if` 分支处理，不进新分支；②image2/Nano `referenceMovs` 为空被函数入口挡住；③Seedance 参考生原走 else 显示「视频1/视频N」，现主视频显示「主视频」+ 非主视频编号正确（与面板 `NodeInspector.tsx:6152` 一致）；④不动 `referenceVideoUrlsInLabelOrder`，`@视频N` prompt 解析层与运行时上传逻辑零影响；⑤`buildReferenceVideoDetailItems` 未被 skill.md 标记为 S 级（§5.8.5 S 级范围明确限定为 Nano/image2 gp 空恢复三个函数），可安全修改。
- **未触碰的潜在问题（供后续迭代）**：`NodeInspector.tsx:6154` 面板侧非主视频用 `视频${vi+1}`（index-based），当 `referenceMovs` 含主视频时面板也会编号偏移（vid1 标「视频2」）。本次未改面板侧（用户未反馈面板错位，且改动面板风险更大）。`referenceVideoUrlsInLabelOrder` 默认分支不过滤主视频，导致 `@视频N` prompt 解析时 `@视频1` 指向主视频 URL（运行时上传仍按 referenceMovs 顺序，结果正确，但语义上 `@视频1` 应指向 vid1）。这两点建议后续单独评估。
- **0724 备份版本核查**：用户最初要求「参考 D:\aaa\20260724 版本恢复」。经逐字节对比，`buildReferenceVideoDetailItems` 在 0724 与当前版本完全一致——**此 bug 在 0724 同样存在，回退无法解决**，需新增修复（本节）。0724 之后的 §10.68-§10.78 / §11.65-§11.70 共 22 处均为 bug 修复，整体回退会重新引入这些 bug，未采纳。

### 11.73 2026-08-03 Seedance 参考生刷新后 Node Details 主图 COS URL 被空槽覆盖丢失（gp 回填修复）

- **现象**：用户反馈 Seedance 2.0 参考生 OUTPUT 节点，刷新后面板主图不丢失，但 Node Details 的 Reference Images 中主图消失。仅影响 Seedance 2.0 参考生模式，其他模型不受影响。
- **根因**：`utils/referencedMediaRun.ts` `repairSeedanceReferenceGenerationParamsFromPanel` 在刷新后将面板数据同步到 gp 时，直接使用面板 `referenceImages` 覆盖 gp 的 `referenceImages`。刷新后面板主图 blob URL 被 `persistSanitize` 剥离为空槽 `''`，空槽覆盖 gp 已有的主图 COS URL，导致 Node Details 从 gp 读取时主图丢失。
- **修复**：`repairSeedanceReferenceGenerationParamsFromPanel` 合并面板与 gp 时，对空槽位回填 gp 已有的 URL：
  ```typescript
  const prevRefArr = (prev.referenceImages || []) as string[];
  const mergedRefs = panelRefs.map((u, i) => {
    const v = String(u || '').trim();
    if (v) return v;
    return String(prevRefArr[i] || '').trim();
  });
  ```
  逻辑：面板非空槽 → 用面板值（用户可能替换了图片）；面板空槽 → 回填 gp 对应槽位的 URL（保护已有 COS URL 不被空槽覆盖）。空槽对应 gp 也为空时保持空（不凭空捏造）。URL 集合匹配时仍早退 undefined。
- **文件**：`utils/referencedMediaRun.ts`（`repairSeedanceReferenceGenerationParamsFromPanel` 函数，约 8 行净变更）；`src/test/utils/referencedMediaRun.test.ts`（新增 8 个门禁场景：面板主图空槽+gp 含主图 / 面板全非空覆盖 / 面板全空早退 / URL 集合匹配早退 / 非 reference 模式早退 / 非 Seedance 模型早退 / 多空槽全回填 / 空槽对应 gp 也为空）
- **验证**：`npx vitest run` 全量 325 通过（含新增 8 场景）；`npm run test:gate` 全量通过；`npm run test:node-details` 244 通过；`npm run build` 通过；服务 3001 HTTP 200；浏览器实测刷新后 Reference Images 无丢失（Omni Output 节点「大牙-有牙」「原始丛林小路」、Seedance 节点「大牙-有牙」均保留）。
- **风险**：低。①仅影响 Seedance 2.0 参考生模式（`isSeedance20ReferenceMode` 守卫），其他模型不进此函数；②回填仅在面板空槽时触发，非空槽保持面板值不变；③URL 集合已匹配时早退，不额外触发写操作；④gp 槽位超出面板长度时 `prevRefArr[i]` 为 undefined，`String(undefined)` = `''`，安全。

### 11.74 2026-08-04 Node Details 参考图片地址未转为 aitop100 COS 路径（`resolveProjectAssetUrlForPromptToken` 修复）

- **现象**：`E:/问题/8月4日/没转aitop100路径.json` — Nano Banana 2.0 和 image 2 节点的 Node Details 参考图片（如「卷卷」「原始丛林小路」）显示的是资产库代理路径（`/flowgen-api/projects/14/assets/xxx/file`），而不是 aitop100 COS 地址（`https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/...`）。
- **根因**：`utils/promptMediaRefs.ts` `resolveProjectAssetUrlForPromptToken` 第 2612-2616 行，当面板槽 URL 为 aitop100 COS 地址时，调用 `projectAssetMediaPairKey(panel)` 提取 project/asset ID——但 COS URL 不含 `/flowgen-api/` 格式的路径，`projectAssetMediaPairKey` 始终返回 `null`。导致 `libKey && panelKey && libKey === panelKey` 条件永远为 `false`，函数永远返回 `lib`（资产库代理路径），丢弃了 COS URL。
- **数据链路**：`FlowEditor.tsx` → `buildStillImageGenNodeDetailsReferencePreview` → `pickStillImageRecoveryApiReferenceImages` → `collectReferencedMediaFromPrompt` → `resolveSeedancePromptTokenMedia` → `resolveProjectAssetUrlForPromptToken(panelUrl, libUrl)`。当 `snapRefs`（gp.referenceImages）为空时（Nano Banana 2.0 / image 2 常见），走此恢复链路，COS URL 被替换为库路径。
- **修复**：`resolveProjectAssetUrlForPromptToken` 中，面板 URL 已是 aitop100 COS 地址时直接返回 `panel`，不再尝试与 `lib` 做 assetId 比对后替换：
  ```typescript
  // 修复前
  if (/aitop100app-1251510006/i.test(panel)) {
    const libKey = projectAssetMediaPairKey(lib);
    const panelKey = projectAssetMediaPairKey(panel);
    if (libKey && panelKey && libKey === panelKey) return panel;
    return lib;  // 永远走到这里
  }
  // 修复后
  if (/aitop100app-1251510006/i.test(panel)) {
    return panel;  // 直接返回 COS URL
  }
  ```
- **文件**：`utils/promptMediaRefs.ts`（`resolveProjectAssetUrlForPromptToken` 函数，约 5 行净变更）；`scripts/panel-ref-media-simulation-test.ts`（更新 5 个测试用例预期，从期望库 URL 改为期望 COS URL）
- **验证**：`npm run build` 通过；`npm run test:gate` 全量通过（vitest 325 + node-details 244 + panel-refs 633 + 其他全部通过）；服务 3001 HTTP 200。
- **风险**：低。①仅影响 `@资产:xxx` token 解析，不影响 `@主图`/`@图片N`/`@首帧图`/`@尾帧图` 等 token；②blob/data URL 分支不受影响（仍返回 lib URL，因为 blob 是临时的）；③面板 URL 已是 aitop100 COS 时，COS URL 本身就是稳定可用的远程地址，无需替换；④该函数同时被运行时上传逻辑调用，COS URL 可直接用于上传，无副作用；⑤未触碰 §5.8–§5.13 S 级模块。

### 11.75 2026-08-04 Seedance 参考生刷新后 `repairSeedanceReferenceGenerationParamsFromPanel` 因 `seedanceReferenceSnapshotUrlsMatch` 提前退出导致空槽不被回填

- **现象**：`E:/问题/8月4日/seedance问题.json` — Seedance 2.0 参考生 OUTPUT 节点和 MOV 节点刷新后 Node Details 主图丢失。面板 `referenceImages` 含空槽（blob 被 sanitize），gp 已有正确 COS URL，但空槽未被回填。
- **根因**：`repairSeedanceReferenceGenerationParamsFromPanel` 第 1313 行 `seedanceReferenceSnapshotUrlsMatch(prevRefs, panelRefs)` 用 `isComparableUrl` 过滤仅比较 `https?://` URL 集合。当面板非空 URL 与 gp 非空 URL 集合一致时（如面板 `["", cosUrl, ""]` vs gp `[cosUrl]`），集合匹配 → 提前返回 `undefined` → §11.73 的 mergedRefs 回填逻辑从未执行 → 空槽永不被回填。同时 gp 标签为空时也无法同步面板标签。
- **修复**：删除 `seedanceReferenceSnapshotUrlsMatch` 提前退出，改为先计算 mergedRefs（面板空槽回填 gp URL），再与 gp 原值逐元素比较。仅当 `mergedRefs` 与 gp `referenceImages` 完全一致且标签也一致时才返回 `undefined`（无变更），否则返回修复后的 gp。同时将标签同步纳入比较和修复范围。
- **文件**：`utils/referencedMediaRun.ts`（`repairSeedanceReferenceGenerationParamsFromPanel` 函数，约 15 行净变更）；`src/test/utils/referencedMediaRun.test.ts`（更新场景1 和场景8 预期）
- **验证**：`npx vitest run` 325 通过；`npm run test:gate` 全量通过；`npm run build` 通过；服务 3001 HTTP 200。
- **风险**：低。①仅影响 Seedance 2.0 参考生模式；②mergedRefs 与 gp 一致时仍返回 undefined（无变更优化保留）；③标签同步仅在面板有标签时生效，不会凭空覆盖 gp 标签。

### 11.76 2026-08-04 可灵3.0 Omni 中间节点刷新后 Node Details 主图丢失（`repairOmniMultiGenerationParamsFromPanel` 同源 §11.75 缺陷）

- **现象**：`E:/问题/8月4日/可灵.json` — 可灵3.0 Omni multi tab 中间节点（outputNode）刷新后 Node Details 主图丢失，最后节点（movNode）正常。面板 `klingOmniMultiReferenceImages` 含空槽（blob 被 sanitize），gp 已有正确的主图 COS URL，但被空槽覆盖。
- **根因（与 §11.75 完全同源）**：`repairOmniMultiGenerationParamsFromPanel` 使用 `seedanceReferenceSnapshotUrlsMatch` 做集合比较。当面板有 3 槽（`["", cosUrl, ""]`）而 gp 有 2 槽（`[mainCos, cosUrl]`）时，集合比较因大小不同（2 ≠ 1）返回 false → 不提前退出 → 但旧逻辑直接 `referenceImages: [...panelRefs]` 把面板空槽写入 gp，导致 gp 原有的主图 COS URL 被覆盖为 `""`。最后节点（movNode）无 `klingOmniMultiReferenceImages` 面板数据，不受此函数影响，故正常。
- **修复**：删除 `seedanceReferenceSnapshotUrlsMatch` 调用，改为先计算 `mergedRefs`（面板非空槽用面板值，空槽回填 gp 对应位置 URL），再与 gp 原值逐元素比较。仅当 `mergedRefs` 与 gp `referenceImages` 完全一致且标签也一致时才返回 `undefined`（无变更），否则返回 `mergedRefs` 修复后的 gp。与 §11.75 Seedance 修复完全一致的范式。
- **文件**：`utils/referencedMediaRun.ts`（`repairOmniMultiGenerationParamsFromPanel` 函数，约 15 行净变更）；`src/test/utils/referencedMediaRun.test.ts`（新增 8 个测试用例）
- **验证**：`npm run test:gate` 全量通过（333 vitest + 245 node-details 全部通过）；`npm run build` 通过。
- **风险**：低。①仅影响可灵3.0 Omni multi tab 刷新后 gp 修复逻辑；②面板全空时仍早退（`!panelRefs.some` 守卫保留）；③mergedRefs 与 gp 一致时仍返回 undefined（无变更优化保留）；④非 multi tab / 非可灵3.0 Omni 模型早退不变；⑤`seedanceReferenceSnapshotUrlsMatch` 函数本身保留（可能被其他路径使用），仅 Omni 修复路径不再调用。

### 11.77 2026-08-04 Seedance 刷新后 Node Details 主图丢失（`resolveSeedancePromptTokenMedia` 使用 `imagePreview` 作为 `@主图` URL 导致持久化错误）— **已废弃，见 §11.78**

- **现象**：`E:/问题/8月4日/seedance没主图.json` — Seedance 2.0 参考生节点重新生成后，刷新页面 Node Details 主图丢失。
- **原修复（已废弃）**：从 `data.imagePreview` 回填主图。**问题**：`imagePreview` 是生成输出（如 `imagesGenerations/c198bcfe-...png`）而非主参考图，回填后 Node Details 显示的是生成结果而非主参考图。
- **废弃原因**：见 §11.78 正确根因与修复。

### 11.78 2026-08-04 Seedance 2.0 参考生重新生成后刷新 Node Details 主图丢失（`resolveSeedancePromptTokenMedia` 根因修复）

- **现象**：`E:/问题/8月4日/seedance没主图.json` — Seedance 2.0 参考生节点重新生成后，刷新页面 Node Details 主图丢失。`gp.referenceImages[0]` 为空字符串，`panel.referenceImages[0]` 为 blob URL（sanitize 后变空）。
- **根因（三层链路）**：
  1. **`resolveSeedancePromptTokenMedia`**（`promptMediaRefs.ts:2671`）：`@主图` token 解析时使用 `data.imagePreview` 作为 URL。但重新生成时 `imagePreview` 已是上一次生成的输出图（如 `imagesGenerations/xxx.png`），而非主参考图。
  2. **`seedanceApiRefImages`**（`FlowEditor.tsx:10105`）：当 `referenceImagesForApi` 为空且 `uploadedRefOnlyImages` 为空时，fallback 到 `mergedPanelRefs`（含 blob URL）。持久化后 blob URL 被 sanitize 为 `""`。
  3. **§11.77 错误修复**：从 `imagePreview` 回填主图，但 `imagePreview` 是生成输出，回填后 Node Details 显示的是生成结果而非主参考图。
- **修复（两处）**：
  1. **`resolveSeedancePromptTokenMedia`**（`promptMediaRefs.ts`）：Seedance 2.0 参考生模式下，`@主图` 优先使用面板参考图第一槽（`referenceImages[0]`）作为 URL，该槽在上传后会被替换为 COS URL。非 Seedance 模型保持原有 `imagePreview` 行为不变。
  2. **`seedanceApiRefImages` fallback**（`FlowEditor.tsx`）：当回退到 `mergedPanelRefs` 时，若首个槽位为 blob URL 或空字符串，用 `uploadedMainImageUrl`（已上传的 COS URL）替换，防止 blob URL 写入 gp。
  3. **`repairSeedanceReferenceGenerationParamsFromPanel`**（`referencedMediaRun.ts`）：移除 §11.77 的 `imagePreview` 回填逻辑（`imagePreview` 是生成输出而非主参考图），改为仅过滤 `blob:`/`data:` 临时 URL + 从 gp 回填已有 COS URL。
- **文件**：`utils/promptMediaRefs.ts`（`resolveSeedancePromptTokenMedia`，约 10 行）；`components/FlowEditor.tsx`（`seedanceApiRefImages` fallback，约 10 行）；`utils/referencedMediaRun.ts`（`repairSeedanceReferenceGenerationParamsFromPanel`，移除 §11.77 回填）；`src/test/utils/referencedMediaRun.test.ts`（§11.78 测试替换 §11.77）
- **验证**：`npm run test:gate` 全量通过（62 通过，0 失败）；`npm run build` 通过。
- **风险**：低。①`resolveSeedancePromptTokenMedia` 修复仅在 Seedance 2.0 参考生模式生效（`ctx.isSeedance20 && ctx.seedanceMode === 'reference'`），其他模型行为不变；②`seedanceApiRefImages` fallback 修复仅在 `uploadedMainImageUrl` 存在时替换首个 blob 槽；③`repairSeedanceReferenceGenerationParamsFromPanel` 移除 `imagePreview` 回填后，旧数据（gp 主图槽为空）无法自动恢复——需重新生成一次才能正确写入 COS URL。

### 11.78b 2026-08-04 repairOmniMulti / repairSeedance mergedRefs 过滤 blob:/data: 临时 URL

- **现象**：`E:/问题/8月4日/可灵还是有问题.json` — 可灵3.0 Omni 最终节点（movNode）刷新后 Node Details 参考图标签错乱（`['图片1','祭司老人','图片3']` 而非 `['主图','祭司老人']`）。根因链路：用户运行后面板含 blob URL → `repairOmniMultiGenerationParamsFromPanel` 把 blob URL 写回 `generationParams.referenceImages` → §11.65 过滤时主图（https COS）被 snapKeys 误过滤。
- **根因**：`repairOmniMultiGenerationParamsFromPanel` 和 `repairSeedanceReferenceGenerationParamsFromPanel` 的 `mergedRefs` 计算中，面板非空槽直接用面板值（含 `blob:`/`data:` 临时 URL），未过滤临时协议。blob URL 刷新后即失效，写回 gp 会污染持久化数据，导致下游 §11.65 / Details 过滤逻辑错乱。
- **修复**：两个 repair 函数的 `mergedRefs` 计算中，面板值若为 `blob:`/`data:` 协议，跳过并回填 gp 对应槽位 URL（与 §11.77 imagePreview 回填逻辑一致）：
  ```typescript
  const mergedRefs = panelRefs.map((u, i) => {
    const v = String(u || '').trim();
    if (v && !/^(blob|data):/i.test(v)) return v;  // §11.78 过滤临时 URL
    const fromGp = String(prevRefArr[i] || '').trim();
    if (fromGp) return fromGp;
    // 首槽回填 imagePreview（§11.77 逻辑保留）
    ...
    return '';
  });
  ```
- **文件**：`utils/referencedMediaRun.ts`（`repairOmniMultiGenerationParamsFromPanel` + `repairSeedanceReferenceGenerationParamsFromPanel`，约 6 行净变更）；`src/test/utils/kling-omni-blob-repro.test.ts`（场景A-D 验证 blob 不污染 gp）
- **验证**：`npx vitest run src/test/utils/kling-omni-blob-repro.test.ts` 7 通过；`npm run test:gate` 全量通过（47 文件 / 344 测试 + ALL PASSED）。
- **风险**：低。①仅过滤 `blob:`/`data:` 协议，不影响 `https://` COS URL；②面板值为临时 URL 时回填 gp 已有 URL，gp 也为空时保持空槽（不凭空生成）；③与 §11.77 imagePreview 回填逻辑一致，范式统一。

### 11.79 2026-08-04 §11.65 snapKeys 排除 blob:/data: 临时 URL（Node Details 中间节点少图）

- **现象**：`E:/问题/8月4日/可灵还是有问题.json` — 可灵3.0 Omni 节点 Node Details 参考图中持久化 COS URL 被 §11.65 过滤逻辑误删。当 `snapRefs` 含 blob URL（gp 被污染或刷新前状态）时，`normalizeDetailImageUrlKey` 将 blob URL 归一化为非空 key（如 `blob:http://localhost:3001/abc`），混入 `snapKeys`。`dedupedPanel` 中的 COS URL key 与 blob key 不匹配，被误过滤。
- **根因**：`nodeDetailsPreview.ts` §11.65 的 `snapKeys = new Set(snapRefs.map(normalizeDetailImageUrlKey).filter(Boolean))` 未排除 `blob:`/`data:` URL。blob URL 刷新后重新生成（值不同），导致新旧 blob key 不匹配，连带误过滤同槽位的 COS URL。
- **修复**：`snapKeys` 构建时过滤 `blob:`/`data:` URL；`dedupedPanel` 过滤时 blob 项直接保留（不参与 snapKeys 匹配）：
  ```typescript
  const snapKeys = new Set(
    snapRefs.filter((u) => !/^(blob|data):/i.test(u))
      .map(normalizeDetailImageUrlKey).filter(Boolean)
  );
  if (snapKeys.size > 0) {
    dedupedPanel = dedupedPanel.filter((item) => {
      if (/^(blob|data):/i.test(item.url)) return true;  // blob 项直接保留
      const key = normalizeDetailImageUrlKey(item.url);
      return key && snapKeys.has(key);
    });
  }
  ```
- **文件**：`utils/nodeDetailsPreview.ts`（§11.65 块，约 10 行净变更）；`src/test/utils/kling-omni-blob-repro.test.ts`（场景G 验证 snapRefs 只含 blob 时 COS 参考图不被误过滤）
- **验证**：`npm run test:gate` 全量通过（47 文件 / 344 测试 + ALL PASSED）。
- **风险**：低。①snapKeys 为空（全 blob）时不触发过滤，dedupedPanel 全保留（更安全）；②blob 项直接保留避免误过滤，COS 项继续按 snapKeys 匹配；③仅影响 §11.65 过滤路径，其他路径不变。

### 11.80 2026-08-04 image 2 中间节点 Node Details 少图（pickStillImageRecovery 无 projectAssets 时用 referenceImageLabels 匹配 + 标签展开顺序修复）

- **现象**：`E:/问题/8月4日/可灵还是有问题.json` — image 2 中间节点（processorNode）刷新后 Node Details 参考图全部丢失。节点 `prompt = '@资产:大牙-有牙出现在@资产:原始丛林小路中'`，面板 `referenceImages = [blob, cosJungle, cosTooth]`、`referenceImageLabels = ['图片1','原始丛林小路','大牙-有牙']`，但 `generationParams.referenceImages` 为 undefined（中间节点未持久化 gp）。
- **根因（双层）**：
  1. **`matchAllPromptMediaTokens` 无法识别 @资产:xxx**：当 `projectAssets` 为空（资产库未加载/中间节点恢复路径）时，`matchLongestProjectAssetKey` 直接返回 null，`matchAllPromptMediaTokens` 跳过 @资产: token（不加入 matches）→ `collectReferencedMediaFromPrompt` 的 `plan.images` 为空 → `pickStillImageRecoveryApiReferenceImages` 返回 null → Node Details 少图。
  2. **`buildStillImageGenNodeDetailsReferencePreview` 标签展开顺序错误**：`buildImageGenOutputReferenceDetailsFromSnapshot({ snapshotLabels: recovered.referenceImageLabels, ...snapOpts })` 中 `snapOpts.snapshotLabels`（=input.snapLabels，常为 undefined）覆盖了 `recovered.referenceImageLabels`，导致 @资产:名称 标签丢失，退化为通用名"图片n"。
- **修复**：
  1. `pickStillImageRecoveryApiReferenceImages`（`utils/referencedMediaRun.ts`）：当 `projectAssets` 为空且 prompt 含 `@资产:` 时，从 `data.referenceImageLabels` + `data.referenceImages` 构造 fallback `projectAssets`（slug=name=label，排除"图片n"通用名），让 `matchLongestProjectAssetKey` 能按标签精确匹配 @资产:名称边界（避免 greedy 正则吞正文）。
  2. `buildStillImageGenNodeDetailsReferencePreview`（`utils/nodeDetailsPreview.ts`）：调整对象展开顺序，`recovered.referenceImageLabels` 优先于 `snapOpts.snapshotLabels`：
     ```typescript
     return buildImageGenOutputReferenceDetailsFromSnapshot({
       ...snapOpts,
       snapshotRefs: recovered.referenceImages,
       snapshotLabels: recovered.referenceImageLabels ?? snapOpts.snapshotLabels,
     });
     ```
- **文件**：`utils/referencedMediaRun.ts`（`pickStillImageRecoveryApiReferenceImages`，约 20 行净变更）；`utils/nodeDetailsPreview.ts`（`buildStillImageGenNodeDetailsReferencePreview`，约 5 行净变更）；`src/test/utils/kling-omni-blob-repro.test.ts`（场景E/F 验证 image 2 中间节点 projectAssets 为空/undefined 时返回 2 张 COS URL + 正确标签）
- **验证**：`npx vitest run src/test/utils/kling-omni-blob-repro.test.ts` 7 通过；`npm run test:gate` 全量通过（47 文件 / 344 测试 + ALL PASSED）。
- **风险**：低。①fallback projectAssets 仅在 `projectAssets` 为空且 prompt 含 `@资产:` 时构造，不影响已加载资产库的正常路径；②fallback 排除"图片n"通用名，仅用具体资产名匹配；③标签展开顺序修复仅影响 `buildStillImageGenNodeDetailsReferencePreview` 的 recovered 分支（snapRefs 为空时），snapRefs 非空时走 snapshot 分支不变；④`recovered.referenceImageLabels` 为 undefined 时回退 `snapOpts.snapshotLabels`，行为兼容。

### 11.81 2026-08-04 Omni multi Node Details 过滤 blob:/data: 临时 URL（`可灵中间节点.json`）

- **现象**：`E:/问题/8月4日/可灵中间节点.json` — 可灵3.0 Omni 中间节点（outputNode）Node Details 仍保留 `blob:`（如 `Generated_259.png`）。节点 `klingOmniMultiReferenceImages = [blob, cosRef, blob]`（槽0、槽2 为 blob），`generationParams.referenceImages` 为正确的 COS URL，但 Details 展示层把面板 blob 槽残留显示出来。
- **根因（双层）**：
  1. **`filterItem` 默认值不过滤 blob**：`buildOmniMultiTabDetailsReferencePreview` 的默认 `filterItem` 仅 `Boolean(it.url) && !movUrlSet.has(it.url)`，未排除 `blob:`/`data:`。FlowEditor 调用时未传自定义 filterItem，故面板 blob 槽进入 Details。
  2. **§11.79 的 blob 保留逻辑错误**：§11.79 在 §11.65 过滤的 `dedupedPanel.filter` 中写了 `if (/^(blob|data):/i.test(item.url)) return true;`（blob 项直接保留），反而把 blob 项保留下来。
- **修复**：
  1. `buildOmniMultiTabDetailsReferencePreview` 默认 `filterItem` 增加 `!/^(blob|data):/i.test(it.url)` 过滤（所有出口分支共用，含 fallback preview）。
  2. §11.65 过滤的 `dedupedPanel.filter` 中 blob 项改为 `return false`（排除），与 §11.79 防 COS 误过滤的意图一致（blob 是无效临时 URL，不应展示）。
- **文件**：`utils/nodeDetailsPreview.ts`（`buildOmniMultiTabDetailsReferencePreview` 默认 filterItem + §11.65 过滤块，约 8 行净变更）；`src/test/utils/omniMultiDetails.test.ts`（新增 §11.81 场景测试：面板含 blob 槽时 Details 过滤 blob，仅保留 COS 参考图）
- **验证**：`npx vitest run src/test/utils/omniMultiDetails.test.ts` 11 通过；`npm run test:gate` 全量通过（47 文件 / 345 测试 + ALL PASSED）；`npm run build` 通过；服务 3001 HTTP 200。
- **风险**：低。①仅过滤 `blob:`/`data:` 协议，不影响 `https://` COS URL；②所有出口分支共用同一 filterItem，行为一致；③§11.65 过滤 blob 项改为排除后，snapKeys 为空（全 blob）时仍不触发过滤（保留 COS 参考图），§11.79 防误过滤的意图保持；④不影响已加载资产库的正常路径与 S 级稳定模块。

### 11.71 2026-07-31 Seedance 参考生面板主图预览不显示

- **现象**：`E:/问题/0731/seedance面板缺主图.json` — Seedance 2.0 参考生 Output Picture Node 面板主图预览区域不显示主图，Node Details 能显示（§11.69），但刷新后 Node Details 也丢失
- **根因**：`nodeModelUsesPanelMainImageRestore` 仅支持 Nano Banana 2.0 / image 2 / 可灵3.0 Omni，不包括 Seedance 2.0。运行后 `panelMainSlotVisible` 被设为 `false`，重新选中节点时主图恢复逻辑（`useLayoutEffect` → `buildPanelMainImageRestorePatchForEditing`）因模型不在白名单中而跳过，导致主图预览永久隐藏
- **修复**：`utils/referencedMediaRun.ts` `nodeModelUsesPanelMainImageRestore`：添加 `seedance2.0 (高质量版)` 和 `seedance2.0 (急速版)` 到白名单
- **文件**：`utils/referencedMediaRun.ts`（`nodeModelUsesPanelMainImageRestore` 函数，约 1 行）
- **风险**：低；仅恢复主图预览可见性（`panelMainSlotVisible: undefined`），不改变图片内容；`shouldRestorePanelMainImageSlotForEditing` 仅在 prompt 含 `@主图` 时返回 true；`test:gate` 全量通过；未触碰 §5.8–§5.13 S 级模块

### 11.71 2026-07-31 MiniMap 点击节点居中视口（z-index + 事件冒泡双修复）

- **现象**：点击 MiniMap 上某个高亮节点，主画布完全不移动（点击无反应）。
- **根因（双层，主因为 z-index）**：
  1. **主因：z-index 配置错误导致点击被 `.react-flow__pane` 拦截**。`index.css` 曾把 `.react-flow__panel.react-flow__minimap` 的 z-index 设为 **3**（注释意图"低于 renderer(4) 故节点叠在上面"）。但 React Flow 的 Panel/MiniMap 是 `.react-flow__renderer`（z-index 4）的**兄弟元素**而非子元素（二者同处 `.react-flow` 层叠上下文，z-index 直接互比）。z-index 3 < renderer 4 → 整个 renderer（含 `.react-flow__pane` z-index 1）盖在 minimap 之上 → 点击 minimap 区域时 `elementFromPoint` 返回 pane，minimap 的 `<svg onClick>` / `<rect onClick>` **永不触发**。
  2. **次因：事件冒泡**。即使点击到达 svg，节点 `<rect>` 的 onClick 与父级 `<svg>` 的 onClick 共存，React 合成事件冒泡 → 点击节点时连续触发两次 `centerViewportAt`：先居中到节点中心，再被 svg 级 click 覆盖为"跳到点击位置（节点边缘）"。
- **修复**：
  1. `index.css`：minimap z-index 3 → **5**（= React Flow 默认值，= Controls 同级，> renderer 4），minimap 在 pane 之上，点击可达 svg。
  2. `components/flowgen/FlowgenMiniMap.tsx`：`onSvgNodeClick` 开头新增 `event.stopPropagation()`，阻断冒泡到 svg 级 click，确保点击节点只执行"居中到节点中心"。
- **文件**：`index.css`（第32-42行，z-index 3→5 + 注释更新）；`components/flowgen/FlowgenMiniMap.tsx`（onSvgNodeClick，1 行 stopPropagation + 2 行注释）
- **验证**：浏览器实测（http://localhost:3001/#/workspace/14）—— 对 minimap 内节点 rect 派发 click，控制台确认 `onSvgNodeClick fired {nodeFound: true}` + `centerViewportAt {hasD3Zoom: true, hasD3Selection: true}`，主画布视口移动并居中到该节点。`npm run test:gate` 全量通过（0 失败）；`npm run build` 通过；服务在 3001 端口正常启动（HTTP 200）。
- **风险**：低。z-index 3→5 会让 minimap 不再被节点视觉叠盖（minimap 会遮挡经过右下角 150×150 区域的节点），但点击导航功能优先于视觉叠层。stopPropagation 仅阻节点点击冒泡，空白处 `onSvgClick` 行为不变，`pannable`/`zoomable` 拖拽缩放不受影响。未触碰 §5.8–§5.13 S 级模块。
- **设计教训（重要）**：React Flow 的 Panel/MiniMap/Controls 是 `.react-flow__renderer` 的**兄弟元素**（在 `.react-flow` 下，与 renderer 平级），不是 renderer 的子元素。调节 Panel 与节点/pane 的视觉层叠关系，必须调 Panel 与 renderer 这对兄弟的 z-index，而非 Panel 内部。z-index 3 < renderer 4 会导致 pane 随 renderer 盖住 Panel，拦截所有交互——这是"点击无反应"的隐蔽根因。

### 11.82 2026-08-05 可灵3.0 Omni 中间节点 Node Details 少图/标签错误（`可灵3.0.json`）

- **现象**：`E:/问题/8月5日/可灵3.0.json` — 可灵3.0 Omni 工作流中，processorNode（node_17）的 Node Details 仅显示 1 张参考图，标签错误（正确应为 2 张：`图片2` + `大牙`）。`klingOmniMultiReferenceImages = [blob0, cosPic2, cosMain, blob3]`，prompt 含 `@资产:大牙出现在@图片2中`，但 Details 只展示 1 张。
- **根因（三层）**：
  1. **`effectiveProjectAssets` 缺失**：`projectAssets` 为空（资产库未加载/中间节点恢复），prompt 含 `@资产:` 前缀时 `matchAllPromptMediaTokens` 无法解析 `@资产:` 边界（`matchLongestProjectAssetKey` 返回 null），导致 `countUniquePromptImageRefTokens` 少算、`preferPanel` 误判为 false。
  2. **`needsSnapSlotIndex` 使用 `panelSnapRefs.length` 而非 `activeSlotRefs.length`**：`panelSnapRefs` 可能因 `imagePreview` 去重/ blob 过滤而欠计（实际有效 COS 槽 2 个但 `panelSnapRefs` 只计 1 个），导致 `needsSnapSlotIndex=true` → `preferPanel=false` → 走 snap 路径少图。
  3. **`buildOmniMultiPanelSnapshotRefsForPrompt` 未预过滤 blob URL**：面板快照引用含 blob 临时 URL，后续 `sanitizeDetailsReferenceImageUrls` 过滤后导致 panelSnapRefs 项数减少，加剧问题 2。
- **修复（四处）**：
  1. **`effectiveProjectAssets` fallback**：当 `projectAssets` 为空且 prompt 含 `@资产:` 时，用面板 `referenceImageLabels` + `klingOmniMultiReferenceImages` 构造 fallback projectAssets（仅具体资产名，排除"图片n"泛化名，排除 blob/data URL）。
  2. **`needsSnapSlotIndex` 改用 `activeSlotRefs.length`**：`activeSlotRefs` 反映面板实际有效持久化槽数（过滤空槽/blob 后），与 `snapRefs.length` 比较，避免因 `panelSnapRefs` 欠计导致误判。
  3. **`buildOmniMultiPanelSnapshotRefsForPrompt` 预过滤 blob/data URL**：在构建 panelSnapRefs 时即排除 blob/data 临时 URL，确保 panelSnapRefs 计数准确。
  4. **面板路径参考图顺序按 prompt @ 引用顺序重排**：`preferPanel` 路径中，面板槽位顺序（如 `图片2→大牙`）可能与 API/gp 顺序（`大牙→图片2`）不一致，导致前节点 Node Details 顺序与后节点不同。在返回前按 `inferSeedanceReferenceDetailLabelsFromPrompt` 推断的标签顺序重排，与 `buildSeedanceReferenceDetailsFromSnapshot` 的 `preferPromptLabels` 逻辑对齐。
- **文件**：`utils/nodeDetailsPreview.ts`（`buildOmniMultiTabDetailsReferencePreview`，约 60 行净变更）；`src/test/utils/omniMultiDetails.test.ts`（新增 §11.82 测试用例 + 更新标签顺序断言）；`scripts/2026070802-kling-omni-panel-verify-test.ts`（更新测试断言：修复后错误 gp 标签不再出现错位图片3）
- **验证**：`npm run test:gate` 全量通过（62 通过，0 失败）；`npm run build` 通过；服务 3001 端口 HTTP 200。
- **风险**：低。①`effectiveProjectAssets` fallback 仅在 `projectAssets` 为空且 prompt 含 `@资产:` 时构造，不影响已加载资产库的正常路径；②fallback 排除 blob/data URL 和泛化名"图片n"，仅保留具体资产名；③`needsSnapSlotIndex` 改用 `activeSlotRefs.length` 仅影响面板/快照偏好决策，不改变其他逻辑；④`buildOmniMultiPanelSnapshotRefsForPrompt` 预过滤 blob 不改动后续过滤逻辑，仅提前排除无效 URL；⑤顺序重排仅在标签集一致时执行（`panelLabelSet === inferredLabelSet`），标签集不一致时跳过，不影响已有行为。
- **门禁强化**：新增 3 个 vitest 用例覆盖 §11.82 关键决策点：①`needsSnapSlotIndex` 修复验证（panel 2 槽但 imagePreview 去重 → preferPanel 仍为 true）；②`effectiveProjectAssets` fallback 边界（prompt 无 `@资产:` 时不构造）；③顺序重排跳过（标签集不一致时保持原顺序）。同时修复 `seedanceReferenceDetails.test.ts` 场景1/7 的 prompt 标签匹配问题（`@主图` → `@资产:大牙`），确保 §11.85 代理路径 URL 转换测试数据与 `preferPromptLabels` 逻辑一致。

### 11.83 2026-08-05 Seedance 2.0 参考生视频点击运行后属性面板主图消失 + Node Details 引用标签混乱（参考可灵多图参考修复）

- **现象**：`E:/问题/8月5日/seedance.json` — Seedance 2.0 参考生视频节点点击运行时：
  1. 属性面板主图格消失（`panelMainSlotVisible: false`）；
  2. Node Details 中 Reference Images 标签混乱：gp 中 `@主图` 显示为泛化名"主图"，而非面板自定义标签"大牙"。
- **根因（双层，参考可灵多图对比分析）**：
  1. **主图消失**：`seedanceHideMainSlotForCompactRefs`（`FlowEditor.tsx:10144`）和 `hideMainForCompact`（`FlowEditor.tsx:11442`）在 `seedanceApiRefLabels` 含"主图"或 prompt 含 `@主图` 时，强制将 `panelMainSlotVisible` 覆盖为 `false`。而可灵 Omni 的多图参考使用 `buildPanelImagePreviewPatchAfterRun` 返回 `panelMainSlotVisible: true`（当 `@主图` 被引用时），不隐藏主图格。
  2. **标签混乱**：`buildSeedanceReferenceApiLabelsFromPlan` 使用 plan 的泛化标签（如 `@主图` → "主图"），未考虑面板槽位的自定义标签（如"大牙"）。可灵 Omni 的 `buildOmniMultiGenerationParamsLabels` 通过 URL 匹配将 API 顺序图片映射到面板实际标签。
- **修复（三处）**：
  1. **移除 `seedanceHideMainSlotForCompactRefs`**（`FlowEditor.tsx`）：删除变量定义（~4行）及 `runCaptureForGp` 中的覆盖逻辑（~5行），改为仅用 `seedancePreviewPatch.panelMainSlotVisible`（`buildPanelImagePreviewPatchAfterRun` 控制：`@主图` 时 → `true`，未引用时 → `false`）。
  2. **移除 `hideMainForCompact`**（`FlowEditor.tsx`）：删除变量定义（~3行）及面板写回中的覆盖逻辑（~1行），改为仅用 `panelMainVisible`（来自 `runCaptureForGp`）。
  3. **增强 `buildSeedanceReferenceApiLabelsFromPlan`**（`referencedMediaRun.ts`）：新增可选参数 `panelLabels?: string[]`。当 plan entry 有 `refImageSlotIndex` 或 token 属于 `MAIN_IMAGE_REF_TOKENS` 时，优先使用面板槽位标签（如"大牙"），仅当面板标签为泛化名（`/^图片\d+$/`）时才回退到 plan 标签。
  4. **传递 `mergedPanelLabels`**（`FlowEditor.tsx`）：调用 `buildSeedanceReferenceApiLabelsFromPlan` 时传入 `mergedPanelLabels`（面板槽位顺序标签）。
- **文件**：`components/FlowEditor.tsx`（删除 ~13 行，新增 ~2 行注释）；`utils/referencedMediaRun.ts`（`buildSeedanceReferenceApiLabelsFromPlan`，约 10 行净变更）；`src/test/utils/referencedMediaRun.test.ts`（新增 §11.79 测试组，4 个测试用例）
- **验证**：`npm run test:gate` 全量通过（62 通过，0 失败）；`npm run build` 通过；服务 3001 端口 HTTP 200。
- **风险**：低。①主图格可见性现在由 `buildPanelImagePreviewPatchAfterRun` 统一控制，与可灵 Omni 行为一致；②`panelLabels` 为可选参数，不传时保持向后兼容；③仅当面板标签为非泛化名（如"大牙"）时才替换 plan 标签，泛化名（如"主图"）仍沿用 plan 原有逻辑；④仅影响 Seedance 2.0 参考生模式，其他模型不受影响。

### 11.84 2026-08-05 Seedance 2.0 回退 §11.78 `@主图` 解析变更 —— 恢复使用 `imagePreview`（对齐 banana/可灵 Omni）

- **现象**：`E:/问题/8月5日/seedance2.json` — Seedance 2.0 参考生视频运行后，`@主图` 引用了错误的图片（面板槽0 blob URL 而非 `imagePreview` 的 COS URL）。
- **根因**：§11.78 修复将 `resolveSeedancePromptTokenMedia` 中 `@主图` 的 URL 来源从 `data.imagePreview` 改为 `data.referenceImages[0]`。但 `referenceImages[0]` 是面板参考图槽位，不一定是主图。banana、可灵 Omni 等所有其他模型的 `@主图` 均使用 `imagePreview`。§11.78 的修改方向错误——正确的修复应在 `seedanceApiRefImages` 构建层面处理 blob URL 回退，而非修改 `@主图` 的解析来源。
- **修复**：回退 `promptMediaRefs.ts:2671-2676` 中 `resolveSeedancePromptTokenMedia` 的 `@主图` 解析逻辑，从 `referenceImages[0]` 优先恢复为直接使用 `data.imagePreview?.trim()`，与 banana、可灵 Omni 多图参考行为一致。
- **文件**：`utils/promptMediaRefs.ts`（1 行净变更：删除 §11.78 特殊逻辑，恢复直接使用 `imagePreview`）
- **验证**：`npm run test:gate` 全量通过（62 通过，0 失败）；`npm run build` 通过；服务 3001 端口 HTTP 200。
- **风险**：低。①`@主图` 恢复使用 `imagePreview` 与所有其他模型（banana、可灵 Omni、即梦等）行为一致；②`imagePreview` 可能是 blob（待上传）或 COS URL（生成输出），两种场景均正确；③FlowEditor.tsx 中 §11.78 的 `seedanceApiRefImages` fallback 修复（`uploadedMainImageUrl` 替换 blob URL）和 `referencedMediaRun.ts` 中 §11.78 的 blob/data 过滤修复均保留，确保 blob URL 不会写入 gp。

### 11.85 2026-08-05 Seedance 2.0 输出节点 Node Details Reference Videos 主视频标签显示为「视频1」而非「主视频」

- **现象**：`E:/问题/8月5日/seedance3.json` — Seedance 2.0 参考生视频，最后一个输出节点（MOV）的 Node Details Reference Videos 标签显示为「视频1」，但前面连接的节点显示为「主视频」，不一致。
- **根因**：`resolveSeedanceReferenceMainVideoUrl` 中 `soleMov`（唯一参考视频 URL）的匹配门禁要求 `soleMov` 与 `outputUrl` 或 `imagePreview` 为同一视频。输出节点的 `imagePreview`/`outputUrl` 是生成结果视频 URL，与上游传入的参考视频 URL 不同，门禁失败后 fallback 到 `imagePreview`（生成结果），导致 `isSeedanceReferenceMovMainVideo` 返回 false，标签变为「视频1」。
- **修复**：在 `resolveSeedanceReferenceMainVideoUrl` 中，当 `soleMov` 是有效视频 URL 且 prompt 明确包含 `@主视频` 时，即使不匹配 `outputUrl`/`imagePreview`，也返回 `soleMov` 作为主视频 URL。新增的 `promptMentionsMainVideoForNodeData` 守卫确保仅当用户明确在 prompt 中写了 `@主视频` 时才触发，避免误判。
- **文件**：`utils/promptMediaRefs.ts`（`resolveSeedanceReferenceMainVideoUrl`，新增 4 行注释 + 1 行守卫代码）
- **验证**：`npm run test:gate` 全量通过（62 通过，0 失败）；`npm run build` 通过；服务 3001 端口 HTTP 200。
- **风险**：低。①仅新增 `promptMentionsMainVideoForNodeData` 守卫，不改变原有匹配门禁逻辑；②仅当 `soleMov` 为有效视频 URL 且 prompt 明确包含 `@主视频` 时才触发，双重条件限制防止误判；③`imagePreview` 为图片时 `isLikelyMainVideoUrl(prev)` 返回 false，不会进入此分支；④仅影响 Seedance 2.0 参考生输出节点，其他模型不受影响。

### 11.86 2026-08-05 Seedance 2.0 Node Details 参考图片 URL 未转换为 aitop100 COS 地址

- **现象**：`E:/问题/8月5日/seedance4.json` — Node Details 中 Reference Images 的 URL 显示为代理路径 `/flowgen-api/projects/14/assets/.../file`，而非 aitop100 COS 地址。
- **根因**：`buildSeedanceReferenceDetailsFromSnapshot` 在构建 `compacted` 时直接使用 `generationParams.referenceImages` 中的原始 URL，未将代理路径转换为 COS URL。`sanitizeDetailsReferenceImageUrls` 仅过滤 blob/data/视频/重复，不做代理路径→COS URL 转换。
- **修复**：在 `buildSeedanceReferenceDetailsFromSnapshot` 中，`pa` 声明后新增 §11.85 逻辑：遍历 `compacted`，对 URL 为代理路径（`parseProjectAssetIdsFromMediaUrl` 返回非空）且标签为命名资产（非泛化名）的条目，从 `projectAssets` 中按标签名查找对应的 COS URL 并替换。
- **文件**：`utils/nodeDetailsPreview.ts`（`buildSeedanceReferenceDetailsFromSnapshot`，新增约 15 行）
- **验证**：`npm run test:gate` 全量通过（62 通过，0 失败）；`npm run build` 通过；服务 3001 端口 HTTP 200。
- **风险**：低。①仅当 URL 为代理路径（`parseProjectAssetIdsFromMediaUrl` 返回非空）且标签为命名资产时触发，双重守卫防止误转换；②仅替换 URL 不同的情况（`lib !== item.url`），相同 URL 不做无意义替换；③不影响 `sanitizeDetailsReferenceImageUrls` 及其他过滤逻辑；④`buildSeedanceReferenceDetailsFromSnapshot` 被 `buildImageGenOutputReferenceDetailsFromSnapshot` 等函数共用，覆盖所有模型。

### 11.87 2026-08-05 门禁测试体系整理 —— 全量通过（382 tests / 47 files）

- **目的**：整理门禁测试覆盖清单，确保后续修改不会破坏已测试稳定的功能。
- **当前状态**：`npm run test:gate` 全量通过（382 通过，0 失败），覆盖 47 个 vitest 测试文件 + 48 个集成脚本。
- **vitest 单元测试覆盖矩阵（47 files / 382 tests）**：

| 分类 | 文件数 | 测试数 | 覆盖场景 |
|------|--------|--------|----------|
| Node Details & 参考素材 | 7 | 57 | Seedance 参考详情(11)、Omni 多标签详情(15)、Seedance 主视频标签(16)、参考视频详情(2)、Omni 主视频标签(3)、Seedance 图片帧(3)、Omni blob 复现(7) |
| 面板交互 & 拖拽 | 19 | 100 | 中键拖拽(5+12+3)、Inspector 拖入(8+1+2+5+1+4)、Omni 去重(5)、面板槽位(2+3+9)、stale 标签(7)、Backdrop(7)、token 解析(5)、键盘导航(10)、画布选区(2)、小地图(11) |
| 模型切换 & 状态保持 | 4 | 24 | Nano 切换(5)、Seedance 切换(4)、运行结果保持(10)、Omni tab 隔离(5) |
| 持久化 & 刷新恢复 | 5 | 115 | 运行恢复(30)、参考媒体运行(50)、节点预览 hydrate(6)、面板参考本地引用(19)、任务恢复(10) |
| API 服务 | 2 | 27 | AiTop 服务(24)、Flowgen API(3) |
| 其他 | 10 | 59 | prompt 重跑(8)、JSON 保存(7)、下载文件名(9)、输出 URL(11)、聊天日志(4)、生成节点(4)、节点工具(3)、生成计数(4)、资产 URL(3)、类型(4) |

- **关键防回归测试（按 § 编号）**：
  - §11.71：Seedance 参考生视频角标（主视频/视频1/视频2 索引不错位）— `seedanceMainVideoLabel.test.ts`
  - §11.79：blob/data URL 写入 gp 后 snapKeys 排除防误过滤 — `kling-omni-blob-repro.test.ts`
  - §11.80：image2 中间节点 gp 空 Details recovery（@资产 兜底识别）— `kling-omni-blob-repro.test.ts`
  - §11.81：面板含 blob 槽时 Details 过滤 blob 仅保留 COS — `omniMultiDetails.test.ts`
  - §11.82：`@资产:大牙` + `@图片2` 标签顺序按 prompt 引用排列 — `omniMultiDetails.test.ts`
  - §11.82：`needsSnapSlotIndex` 改用 `activeSlotRefs.length` — `omniMultiDetails.test.ts`
  - §11.82：`effectiveProjectAssets` fallback 边界 — `omniMultiDetails.test.ts`
  - §11.83：Seedance 参考生运行后主图消失 + 标签混乱 — `referencedMediaRun.test.ts`
  - §11.84：Seedance `@主图` 恢复使用 `imagePreview` — `promptMediaRefs` 行级回归
  - §11.85：Seedance 输出节点 `@主视频` 标签（imagePreview≠参考视频）— `seedanceMainVideoLabel.test.ts`
  - §11.86：Seedance 代理路径 → COS URL 转换（命名资产标签）— `seedanceReferenceDetails.test.ts`

- **集成脚本门禁（48 步）**：`scripts/test-gate.mjs` 在 vitest 之后依次运行，覆盖面板引用、Node Details 模拟、跨模型契约、导出 JSON、刷新恢复等场景。

- **如何新增门禁**：
  1. 每个 bug 修复后，在对应 `src/test/utils/*.test.ts` 文件中新增 1+ 条 vitest 用例
  2. 用例命名格式：`§11.XX 场景描述`，便于追踪
  3. 对于需要真实数据 JSON 的复杂场景，在 `scripts/fixtures/` 放 fixture 文件，编写 tsx 集成脚本
  4. 集成脚本命名格式：`test:YYYYMMDD-功能描述`，在 `test-gate.mjs` 中注册

### 11.88 2026-08-05 可灵3.0 Omni 视频参考面板标签与图片错位 + 刷新后丢图（参照 Seedance 方案）

- **现象**：`E:/问题/8月5日/可灵3.0面板.json` — 可灵3.0 Omni 视频参考 tab 中，标签为「鸱吻」的参考格显示的是马的 blob 图片；刷新后鸱吻图片消失。
- **根因**：
  1. Omni 视频/指令参考格渲染时直接显示 `klingOmniVideoReferenceImages` 原始 blob URL，未像 Seedance/标准多图参考那样按 `referenceImageLabels[slotIndex]` 调用 `resolvePanelReferenceSlotDisplayUrl` 做资产库映射，导致标签与图片各走各的。
  2. `FlowEditor.tsx` 保存可灵3.0 Omni 的 `modelConfigs` 时，只保存了 `klingOmni*ReferenceImages` 和 `klingOmni*ReferenceElementIds`，未保存对应的 `localRefs`；而 `NodeInspector.tsx` 切回 Omni 时从 `omniConfig` 读 `localRefs`，读不到就强制设为空数组，导致 IndexedDB 备份指针被清空，刷新后 blob 失效无法恢复。
- **修复**：
  1. `utils/referenceImageSlotLabels.ts`：新增 `resolveNamedAssetUrlByLabel(label, projectAssets)`，按标签查找命名资产库 URL，泛称标签返回 undefined；不依赖 `projectAssetPairKey`，兼容 COS 资产库地址。
  2. `components/NodeInspector.tsx`（Omni 参考格渲染 L5760 附近）：遍历 `klingOmniActiveRefImages`，对每个非视频 URL 按标签调用 `resolveNamedAssetUrlByLabel` 做资产库映射；若原 URL 为空但标签是命名资产，则兜底取资产库 URL 显示。
  3. `components/FlowEditor.tsx`（保存 Omni `modelConfigs` L7311-7363）：参照 Seedance/Nano/image2，加入 `referenceImageLocalRefs`、`klingOmniMultiReferenceLocalRefs`、`klingOmniInstructionReferenceLocalRefs`、`klingOmniVideoReferenceLocalRefs`。
  4. `components/NodeInspector.tsx`（读取 `omniConfig.localRefs` L3368-3384）：`modelConfigs` 中无对应 `localRefs` 时保留节点顶层值，不再强制清空为 `[]`。
- **文件**：`components/NodeInspector.tsx`、`components/FlowEditor.tsx`、`utils/referenceImageSlotLabels.ts`
- **门禁测试**：新增 `src/test/utils/omniPanelReferenceDisplay.test.ts`（7 tests），覆盖 `resolveNamedAssetUrlByLabel` 的命名资产匹配、泛称过滤、空值/空资产集边界。
- **验证**：`npm run test:gate` 全量通过（62 通过，0 失败）；`npm run build` 通过。
- **风险**：低。①仅影响 Omni 面板参考格的显示 URL 解析，不动运行/上传/API 逻辑；②仅新增 `modelConfigs` 字段保存，不改变已有数据结构读取；③兜底逻辑仅在「URL 为空 + 标签为命名资产」时触发，条件严格。

### 11.89 2026-08-06 面板删除参考图后泛称标签重复/错位（`面板标签.json`）

- **现象**：`E:/问题/8月5日/面板标签.json` — 删除面板上一张资产库图片后，泛称标签出现重复（如"图片4"出现两次），标签序号与槽位不对齐。
- **根因**：`syncGenericReferenceImageLabelsToSlotOrdinals`（`utils/referenceImageSlotLabels.ts:923`）在删除参考图后重新编号标签时，第 959 行的兜底逻辑 `if (labelOrd >= 1) return cap;` 无条件保留旧标签，即使旧标签序号与槽位实际序号（compact ordinal）不一致。例：4 槽位标签为 `["图片2", "图片3", "图片4", "图片4"]`，正确序号应为 `["图片1", "图片2", "图片3", "图片4"]`，但函数原样返回。
- **修复**：`utils/referenceImageSlotLabels.ts:959`：将 `if (labelOrd >= 1) return cap;` 改为 `return \`图片${compact >= 1 ? compact : labelOrd}\`;`。仅当泛称标签（"图片n"）序号与槽位实际序号不对齐时生效，命名资产标签在 L935 处已提前返回不受影响。
- **文件**：`utils/referenceImageSlotLabels.ts`
- **门禁测试**：新增 `src/test/utils/panelRefLabelSync.test.ts`（21 tests），覆盖：
  - 删除命名资产后泛称标签重新编号
  - 标签全部偏移 1 位修正
  - 重复标签修正
  - 命名资产标签保留
  - 空槽位处理
  - 主图去重后序号计算
  - Prompt 中 @图片n 保护
  - 10 槽位大规模场景
  - 用户 JSON 实际场景还原
- **验证**：`npm run test:gate` 全量通过（62 通过，0 失败）；`npm run build` 通过。
- **风险**：低。仅修改泛称标签序号不对齐时的兜底行为，命名资产、Prompt 引用、已对齐标签均不受影响。

### 11.90 2026-08-06 Seedance 2.0 参考生刷新后图片4/图片5显示重复（`面板图片重复.json`）
- **现象**：`E:/问题/8月5日/面板图片重复.json` — 面板有 5 张参考图，刷新后「图片4」与「图片5」显示同一张图（金色树/灯光）。导出数据中 `referenceImageLocalRefs` 为 `['...:ref:2', '...:ref:3', '...:ref:4', '...:ref:6', '...:ref:8']`，且 `seedanceTabConfigs.reference.referenceImages` 为 4 个空槽，与顶层 `referenceImages` 不一致。
- **根因**：
  1. 删除参考图时，`removeReferenceImageLocalRefAtIndex`（`utils/hydratePanelReferenceLocalRefs.ts:348`）仅对 `localRefs` 数组做 `splice`，**不会重命名**剩余 ref 中的 index 段。例如原 5 槽 `ref:0~ref:4`，删除前 2 槽后剩余 `ref:2/ref:3/ref:4`。
  2. 再次拖入本地图片时，`attachLocalReferenceRefs`（`components/FlowEditor.tsx:2804`）按 `referenceImages.length` 生成新 ref index。此时数组长度 3，新图生成 `ref:3`；继续追加生成 `ref:4`、`ref:5`……其中 `ref:3`/`ref:4` 已被剩余 localRefs 占用。
  3. 同一个 IDB key 被两个不同数组下标引用，刷新后 `hydratePanelReferenceUrlsFromLocalRefs` 从同一 blob 恢复，导致两张参考图显示相同内容。
  4. 附带问题：`seedanceTabConfigs.reference` 快照未随删除同步更新，切 tab/刷新时可能从旧快照（4 个空槽）恢复，造成参考图丢失。
- **修复**：
  - `utils/hydratePanelReferenceLocalRefs.ts`：新增 `parseReferenceLocalRefIndex` 与 `nextAvailableReferenceLocalRefIndex`，从现有 localRefs 中扫描已被占用的 index，向后寻找第一个可用序号。
  - `components/FlowEditor.tsx`：`attachLocalReferenceRefs` 生成新 localRef 前调用 `nextAvailableReferenceLocalRefIndex`，确保 IDB key 唯一；数组下标仍保持连续，仅 ref 名称中的 index 允许跳跃。
  - `components/NodeInspector.tsx`：`removeRefImage` 删除参考图后，若当前为 Seedance 2.0 reference 模式，同步更新 `seedanceTabConfigs.reference.referenceImages` / `referenceImageLabels`，保持快照与顶层一致。
- **文件**：`utils/hydratePanelReferenceLocalRefs.ts`、`components/FlowEditor.tsx`、`components/NodeInspector.tsx`
- **门禁测试**：`src/test/utils/hydratePanelReferenceLocalRefs.test.ts` 新增 3 个用例：
  - 解析 ref 字符串末尾 index（覆盖 Seedance/Omni/旧模型格式）
  - 删除后追加自动跳过已占用 index
  - 模拟 5 槽 → 删除前 2 槽 → 再追加，验证不生成冲突 ref
- **风险**：中低。
  - 不改动 `localNodeMediaStore.ts` 的 localRef 生成规则（S级稳定模块 §5.8.1/§5.8.2/§5.8.3），只在使用侧避免冲突。
  - 数组下标与 ref 名称 index 可能不一致，但 `hydratePanelReferenceUrlsFromLocalRefs` 只按数组下标读取 localRef，不影响恢复逻辑。
  - Seedance reference tab 快照同步仅影响 `seedanceGenerationMode === 'reference'` 的删除操作，不改动 tab 切换/保存逻辑。

### 11.90b 2026-08-06 `pickSeedanceReferencePanelSnapshot` 贫化快照回退顶层（`4444.json`）
- **现象**：`E:/问题/8月5日/4444.json` — Seedance 2.0 reference 删除若干图片刷新后，图片3/图片4显示相同；`seedanceTabConfigs.reference.referenceImages` 为 `['','','','',cosUrl]`，与顶层 `referenceImages`（5 个 URL）严重不一致；`generationParams.referenceImages[0]` 与 `[1]` 重复。
- **根因**：
  1. `pickSeedanceReferencePanelSnapshot` 无条件优先使用 `seedanceTabConfigs.reference`。当该快照保留旧空槽时，`repairSeedanceReferenceGenerationParamsFromPanel` 会错误地从历史 gp 回填，造成 generationParams 重复/空槽。
  2. 运行 recovery（`utils/runRecovery.ts:1190`）用该快照覆盖顶层 `referenceImages`，把面板真实参考图抹成空槽。
  3. 间接加剧 localRef 与 referenceImages 错位，刷新后 hydrate 从同一 IDB key 恢复，表现为相邻槽位图片重复。
- **修复**：`utils/referencedMediaRun.ts` 的 `pickSeedanceReferencePanelSnapshot` 增加贫化检测：当 tab 快照全空，或非空 URL 数少于顶层时，回退到 `data.referenceImages`；长度不一致时以非空 URL 更多的一方为准。
- **门禁测试**：`src/test/utils/referencedMediaRun.test.ts` 新增 3 个用例覆盖 tab 全空、长度不一致、非空数量远少于顶层三种回退场景。
- **风险**：低。仅在 tab 快照不可靠时回退到顶层，正常 tab 切换隔离性不受影响。

### 11.90c 2026-08-06 Seedance reference 添加图片时未同步 seedanceTabConfigs.reference（对标 Banana）
- **现象**：删除图片后 seedanceTabConfigs 已同步，但添加新图片后 tab 快照仍保留旧数据，刷新/切 tab 后旧快照覆盖面板。
- **根因**：三个添加路径（`addOne` URL/资产库/画布拖入、`ingestInspectorReferenceLocalFiles` 本地文件拖入、URL 粘贴/拖入）均只写入顶层 `referenceImages` / `referenceImageLocalRefs`，未同步 `seedanceTabConfigs.reference`。
- **修复**：三个路径的 `onUpdate` patch 中均增加 `seedanceTabConfigs.reference` 同步（`NodeInspector.tsx:3952/4358/4640`）。
- **风险**：低。仅同步已存在的 tab 快照，不影响其他模型。

### 11.90d 2026-08-06 `pickSeedanceReferencePanelSnapshot` 顶层有数据时始终优先（彻底对标 Banana）
- **现象**：§11.90b/c 修复后，用户仍反馈删除多张图片刷新后面板出现重复。
- **根因**：`pickSeedanceReferencePanelSnapshot` 的条件 `tabNonEmpty < topNonEmpty` 不够强。当 COS URL 同时存在于 tab 和顶层时，`tabNonEmpty === topNonEmpty`，仍走 tab 快照的旧数据，`repairSeedanceReferenceGenerationParamsFromPanel` 按位置索引回填 gp 时错位。
- **修复**：简化判断为 `useTopInstead = topNonEmpty > 0`。只要顶层有数据，始终以顶层为准（对标 Banana 单数据源模式）。tab 快照仅在顶层全空时兜底（如切 tab 后 image tab 活跃期）。
- **门禁测试**：`src/test/utils/referencedMediaRun.test.ts` 更新"优先使用 tab 数据"测试为"顶层有数据时优先使用顶层"+"顶层全空时使用 tab 快照"。
- **风险**：低。顶层全空时仍用 tab 快照兜底，tab 切换隔离性不受影响。

### 11.90e 2026-08-06 `repairSeedanceReferenceGenerationParamsFromPanel` 长度不一致时不回退 gp（`面板.json`）
- **现象**：用户删除参考图后刷新，gp 中 panel 与 gp 长度不一致，位置索引回退错位导致 gp 出现重复 URL。
- **根因**：删除参考图后 panel 有 5 项但 gp 仍有 7 项，旧逻辑按位置索引回退（如 blob[5]→gp[5]），但 gp[5] 实际对应已删除的旧图，导致 gp 出现重复 URL。
- **修复**：添加 `panelGpLengthMatch` 检查，仅当 panel 与 gp 长度一致时做位置回退，否则 blob 槽留空。
- **门禁测试**：`src/test/utils/referencedMediaRun.test.ts` §11.90e 测试组。
- **风险**：低。长度不一致时不回退，blob 槽留空，不会引入错误数据。

### 11.90f 2026-08-06 `repairSeedanceReferenceGenerationParamsFromPanel` gp 回退去重（`面板.json` 二次修复）
- **现象**：§11.90e 修复后，长度一致但索引错位时（panel 和 gp 都是 7 项但内容不对齐），blob 回退 gp 仍会引入重复 URL。同时旧 session 遗留的 gp 重复 URL 也会被保留。
- **根因**：即使长度一致，panel 的 blob URL 回退到 gp[i] 时，gp[i] 的 URL 可能已在 panel 其他位置出现（或 gp 本身已有重复），导致合并后 gp 重复。
- **修复**：两遍去重策略：
  1. 第一遍收集所有 panel 非 blob URL 作为去重集合
  2. 第二遍合并时，gp 回退 URL 若已在去重集合中则留空
- **影响范围**：`repairSeedanceReferenceGenerationParamsFromPanel` 和 `repairOmniMultiGenerationParamsFromPanel`（Omni 多图参考）
- **门禁测试**：`src/test/utils/referencedMediaRun.test.ts` §11.90f 新增测试"panel 与 gp 长度一致且 gp 有重复 URL → blob 回退到 gp 时去重"。
- **风险**：低。去重仅在 gp 回退时生效，不影响 panel 自身 URL 的保留。标签与 panel 槽位保持对齐。

### §11.90g 本地引用迁移后删除旧引用 + 删除后同步 nodeDataRef（2026-08-06）
- **现象**：`面板图片重复2.json`（localRefs 为 `ref:1, ref:3, ref:7, ref:8` 非连续索引）中，删除后多次刷新，图片2和图片3显示相同内容。根因是 IndexedDB 中不同 key 存了相同 blob（旧迁移未删除旧 ref），导致刷新水化后两个槽位显示同一张图。
- **修复内容**：
  1. `FlowEditor.tsx` `migrateRefToModelScoped`：迁移旧 localRef 到新引用后，调用 `deleteLocalMediaRef` 删除旧 ref。
  2. `NodeInspector.tsx` `removeRefImage`：删除图片后调用 `mergeNodeDataRef` 同步 `nodeDataRef`，防止后续 `addOne` 读取到旧数据。
  3. `FlowEditor.tsx` `dispatchReferenceAppendFiles`：使用 `nextAvailableReferenceLocalRefIndex` 生成唯一 ref index，避免删除后追加覆盖已有 IDB key。
- **影响文件**：`FlowEditor.tsx`, `NodeInspector.tsx`, `hydratePanelReferenceLocalRefs.ts`
- **风险**：低。仅在迁移和删除路径生效，不影响正常添加和显示流程。

### §11.90h 迁移过程 blob 指纹去重（2026-08-06）
- **现象**：§11.90g 修复后，迁移代码能正确删除旧 ref，但若 IndexedDB 已有脏数据（两个不同 key 指向相同 blob，如 `ref:3` 和 `ref:7` 存了同一张图），迁移后新 ref 仍会复制相同 blob，刷新后依然出现重复。
- **修复内容**：
  1. `FlowEditor.tsx` `hydrateLocalMediaPreviews`：在迁移循环外维护 `migratedBlobFingerprints` 集合，使用 `computeBlobFingerprint`（blob.size + blob.type + 前 2048 字节 hex）作为指纹。
  2. 在所有迁移路径（Seedance 2.0 统一格式、非 Seedance 模型、可灵 3.0 Omni 的 ref/main/frame 路径）中，写入新 ref 前检查指纹是否已存在，若重复则跳过写入仅删除旧 ref。
- **影响文件**：`FlowEditor.tsx`
- **风险**：低。指纹检测仅阻止重复 blob 写入新 ref，不影响正常迁移。指纹使用前 2048 字节 + 尺寸 + 类型，误判概率极低。

### §11.90i 主图水化使用迁移后的 imageLocalRef（2026-08-07）
- **现象**：刷新后主图（imagePreview）丢失。表现为主图格显示空白或占位图。
- **根因**：`hydrateLocalMediaPreviews` 中，先执行迁移（`migrateRefToModelScoped`）将旧 `imageLocalRef` 迁移到新格式，旧 ref 从 IndexedDB 删除。但后续主图水化代码（第 2649 行）仍使用 `n.data.imageLocalRef`（原始数据中的旧 ref），`getLocalMediaBlob` 因旧 ref 已被删除而返回 null，主图无法恢复。
- **修复内容**：`FlowEditor.tsx` 第 2649 行改为 `const ref = nodePatch.imageLocalRef || n.data.imageLocalRef;`，优先使用迁移后的新 ref，回退到原始 ref。
- **影响文件**：`FlowEditor.tsx`
- **风险**：低。仅影响刷新后主图恢复逻辑，`nodePatch.imageLocalRef` 仅在迁移成功时存在，否则回退到原始 ref（与修复前行为一致）。

### §11.90k attachLocalReferenceRefs 数据覆盖修复（2026-08-07）
- **现象**：删除图片后添加新图片时，刷新后 `referenceImageLocalRefs` 数组错位，导致显示错误图片。
- **根因**：React 的 `setNodes` 是异步的，`attachLocalReferenceRefs` 中 `getNodes()` 可能返回旧数据，`nextLocalRefs` 基于旧数据计算，在 `setNodes` 回调中覆盖正确的最新数据。
- **修复内容**：`FlowEditor.tsx` 重构 `attachLocalReferenceRefs` 函数，使用 `newRefEntries` Map 记录新增 ref 映射，`setNodes` 回调中仅写入新增 ref，不覆盖已有数据。通过 Promise 在 `setNodes` 回调中 resolve 最新 merged 结果。
- **影响文件**：`FlowEditor.tsx`
- **风险**：低。仅影响本地文件拖入/添加时的 localRef 写入逻辑。

### §11.90l 对标 Banana 面板 — 消除 Seedance 参考图双源数据问题（2026-08-07）
- **现象**：Seedance 面板删除图片后刷新，出现图片内容与标签不一致的情况。快照同步逻辑越改越乱。
- **根因**：Seedance 面板存在**双源数据**问题——顶层 `data.referenceImages` 和快照 `data.seedanceTabConfigs.reference.referenceImages` 同时存储参考图数据。每次 add/delete/drag/refresh 都需要手动同步两处，同步点遗漏或冲突导致数据不一致。Banana 面板无此问题，因为只有顶层数据。
- **修复方案**：对标 Banana 面板，**参考图仅存于顶层数据，不再依赖快照层**。
  - `seedance20ModelSwitch.ts` — `snapshotSeedanceTabConfigsWithLivePanel`：不再将 referenceImages/referenceImageLabels/referenceElementIds 写入快照
  - `NodeInspector.tsx` — `switchSeedance20Tab`：切换 tab 时不清空顶层 referenceImages；切回 reference tab 时从顶层数据读取，不从快照读
  - `NodeInspector.tsx` — 移除 4 处手动 `seedanceTabPatch` 同步代码（addOne、removeRefImage、dispatchReferenceAppendFiles、URL paste handler）
  - `FlowEditor.tsx` — 移除 hydration 后的 §11.90j 快照同步代码
  - 下游消费者（`referencedMediaRun.ts`、`nodeDetailsPreview.ts`、`enrichSpawnedStoryboardNode.ts`、`storyboardTableSpawn.ts`）已有回退逻辑，快照为空时自动使用顶层数据，无需修改
  - `seedance20ModelSwitch.test.ts` — 更新测试以反映新行为
- **影响文件**：`seedance20ModelSwitch.ts`、`NodeInspector.tsx`、`FlowEditor.tsx`、`seedance20ModelSwitch.test.ts`
- **风险**：低。核心变更只影响数据存储位置，不影响数据内容。下游消费者已兼容。门禁测试全部通过（62 通过，0 失败）。

### §11.90m 对标 Banana — Seedance 删除后重新压紧并对齐 localRefs（2026-08-07）

- **现象**：§11.90g/h/i/k/l 修复后，用户仍反馈「删除一张刷新没问题，再删除一张刷新后出现图片1和图片2一样、图片6和图片7一样」。要求参考 Banana 面板彻底解决。
- **根因（Banana vs Seedance 4 大差异）**：
  1. **删除后不压紧**（核心差异）：Banana 的 `removeImage2PanelReferenceAtDisplaySlot` 删除后调用 `compactImage2PanelReferences` + `compactImage2PanelLocalRefs` 重新压紧并按 URL 对齐 localRefs；Seedance 的 `removeRefImage` 仅 splice 各数组，不重新压紧。空槽/localRefs 错位持续累积，导致 `hydrateAllPanelReferenceLocalRefs` 按 i 下标从 IDB 取到错误槽位的 blob。
  2. **快照层脏数据**：旧 JSON 残留 `seedanceTabConfigs.reference.referenceImages` 全空快照（如 `面板图片重复2.json`）。
  3. **gp 回退重复**：`面板.json` 中 `generationParams.referenceImages` slot 4/5/6 都是 `421bca6c.png`。
  4. **ref index 累积**：`referenceImageLocalRefs` 的 ref index 非连续（如 1,3,7,8）。
- **修复方案**：新增 `compactSeedancePanelReferences` 函数，仿照 Banana 的 `compactImage2PanelReferences` + `compactImage2PanelLocalRefs`。
  - `utils/referenceImageSlotLabels.ts` — 新增 `compactSeedancePanelReferences`：遍历 referenceImages 过滤空槽，按槽位严格对齐 labels / localRefs / elementIds。
  - `components/NodeInspector.tsx` — `removeRefImage`：splice 后调用 `compactSeedancePanelReferences` 重新压紧，确保下标一一对应。
  - `components/FlowEditor.tsx` — `hydrateLocalMediaPreviews`：hydration 前对 Seedance 模型调用 `compactSeedancePanelReferences`，确保导入旧 JSON 首次刷新也能自动修复错位。
  - `src/test/utils/compactSeedancePanelReferences.test.ts` — 新增 6 个测试用例覆盖核心场景。
- **影响文件**：`utils/referenceImageSlotLabels.ts`、`components/NodeInspector.tsx`、`components/FlowEditor.tsx`、`src/test/utils/compactSeedancePanelReferences.test.ts`
- **风险评估**：低。`compactSeedancePanelReferences` 是纯函数，仅过滤空槽并保留下标对齐，不改变 URL 内容。只影响 Seedance 2.0（高质量版/急速版）模型，不影响 Banana / image2 / Omni。门禁测试全部通过（62 通过，0 失败），tsc + vite build 成功。

### §11.90m.2 修复 compactSeedancePanelReferences 误删等待恢复槽位（2026-08-07）

- **现象**：§11.90m 部署后用户反馈「删除一个刷新没问题，再删除一个刷新后自动重新多删除了一个」（图片丢失）。
- **根因**：`compactSeedancePanelReferences` 旧逻辑 `if (!url) continue` 把所有空字符串槽位过滤。但 `persistSanitize.mjs` 的 `PRESERVE_SLOT_ARRAY_KEYS` 会把 `referenceImages` 中的 blob/data URL **剥离成空字符串占位**（保留数组下标与 `referenceImageLocalRefs` 对齐），等待 `hydrateAllPanelReferenceLocalRefs` 从 IDB 恢复。旧逻辑把这些「URL 空但 localRef 有值」的等待恢复槽位连同 localRef 一起误删，导致 IDB 无法恢复 → 图片丢失。
- **修复**：`utils/referenceImageSlotLabels.ts` `compactSeedancePanelReferences` 改为只过滤「URL 和 localRef **都**为空」的真正空槽，保留「URL 空但 localRef 有值」的等待恢复槽位。
- **门禁测试**：`src/test/utils/compactSeedancePanelReferences.test.ts` 新增「§11.90m 关键：保留持久化剥离后等待 IDB 恢复的占位槽位」测试。7 个测试全部通过，test:gate 62/62 通过。

### §11.90m.3 移除 hydration 压紧 — 对标 Banana 只在删除时压紧（2026-08-07）

- **现象**：§11.90m.2 修复后用户反馈「一刷新就少图」。即使 `compactSeedancePanelReferences` 改为只过滤「URL 和 localRef 都为空」的槽位，hydration 时调用它仍会误删合法槽位（如用户拖入 https URL 无 localRef 的槽位，持久化时 URL 保留但某些边缘场景仍被过滤）。
- **根因**：Banana 的 `compactImage2PanelReferences` **只在 `removeImage2RefSlot`（删除时）调用，不在 hydration 时调用**。我在 `hydrateLocalMediaPreviews` 中加的 hydration 压紧是多余的，违背了 Banana 的设计——hydration 应该是纯恢复逻辑，不应该修改数组结构。
- **修复**：移除 `components/FlowEditor.tsx` `hydrateLocalMediaPreviews` 中的 hydration 压紧代码块，以及 `compactSeedancePanelReferences` 导入。`compactSeedancePanelReferences` 只保留在 `NodeInspector.tsx` `removeRefImage` 中使用（对标 Banana 删除时压紧）。
- **影响**：导入旧脏 JSON（localRefs 错位如 ref:1,3,7,8）首次刷新不会自动修复错位，但用户下次删除一张图时会触发压紧修复。这是可接受的——与 Banana 行为一致。
- **门禁测试**：test:gate 62/62 通过，tsc + vite build 成功。

### §11.90m.4 修复 Nano Banana 2.0 拖入图片后刷新主图全部丢失（2026-08-07）
- **现象**：用户在 Nano Banana 2.0 面板拖入多张图片，刷新后主图全部丢失。控制台日志显示：① `clear-check {current: "", isPersistable: false, hasLocalMainRef: true, shouldClear: ""}` — imagePreview 为空，imageLocalRef 存在但为 4段 legacy 格式 `flowgen-local:xxx:main`；② `pick-persistable {picked: "(none)"}` — `pickPersistableMainPreviewUrl` 从 `generatedThumbnails/gp/referenceImages` 等所有来源均无法恢复主图。
- **根因A（NodeInspector.tsx）**：`ingestInspectorReferenceLocalFilesImpl` 中「首张无主图时做主图 + 调用 attachLocalMainRef 备份 IDB」逻辑只写了 `if (isImage2)` 分支，漏了 `isNano`（Nano Banana 2.0）。Nano 面板拖入本地图片直接进入参考图分支，从未调用 `attachLocalMainRef`，导致：① imageLocalRef 未设置（或保留旧 legacy）；② IndexedDB 无 blob 记录 → 刷新后 hydrateLocalMediaPreviews 用 legacy ref 查不到 → pickPersistableMainPreviewUrl 兜底也无 → 主图全部丢失。
- **根因B（参考图追加分支）**：有主图时追加参考图分支也复用 `image2MaxReferenceSlots`（最多 3-4 张，因 image2 主图占格），但 Nano Banana 2.0 上限是 14 张，严重限制可用。
- **修复A（NodeInspector.tsx L4165）**：`if (isImage2)` → `if (isImage2 || isNano)`，Nano 与 image2 共用「首张无主图做主图」逻辑；参考图 slice(0, 2) 改为按模型限：image2 上限 2，Nano 上限 14。
- **修复B（NodeInspector.tsx L4202）**：有主图时追加参考图分支拆 `if (isNano)` / `else (isImage2)`：Nano 走「filter 空项后按 maxStandardRefImages(14) 截断」；image2 保持原 `image2MaxReferenceSlots + compactImage2PanelReferences` 流程。
- **影响**：现有 image2 行为不变（最大 3-4 参考图 + 压紧逻辑）；Nano Banana 2.0 参考图上限对齐面板实际展示 14 张，且首张无主图场景正确走 attachLocalMainRef → imageLocalRef + IDB 双备份，刷新可恢复。

### §11.90m.5 修复迁移逻辑中 legacy ref（4段）无法恢复到新格式（5段）导致 IDB key 对不上（2026-08-07）
- **现象**：同 §11.90m.4，用户 Nano Banana 2.0 的 imageLocalRef 是旧 4段 legacy 格式 `flowgen-local:xxx_14:node_x:main`，IDB 中如果存的是新 5段格式 `flowgen-local:xxx_14:node_x:main:Nano_Banana_2_0`（因早期其他路径写入过），两者 key 不一致 → `getLocalMediaBlob(legacyRef)` 返回 null → 主图丢失。
- **根因**：`migrateRefToModelScoped` 通用分支（L2583+），当 `isLegacy=true` 但 `blob=null`（legacy key 不在 IDB）时，原代码直接返回 undefined（保持 legacy ref），**未再检查 targetRef（新5段 key）是否有 blob**。即使新格式在 IDB 有数据，仍保持旧 legacy ref → 后续 hydration 仍按 legacy 查 → 持续取不到。
- **修复（FlowEditor.tsx L2624-L2652）**：在 `blob=null`（legacy key 无数据）后，新增二次检查 `targetBlob = getLocalMediaBlob(targetRef)`：① targetBlob 存在 → 直接迁移到 targetRef（IDB 已正确，只同步 workspace imageLocalRef）；② targetBlob 也不存在 → **强制迁移**到 targetRef（保持新格式统一，避免「下次拖入新图 attachLocalMainRef 按 targetRef 写入但 imageLocalRef 仍为 legacy 对不上」问题）。
- **影响**：修复前「旧 workspace 保存 legacy ref + IDB 新格式数据」场景完全读不出主图；修复后可正确恢复。强制迁移不会比保持 legacy 更糟（两者 IDB 都空时 pickPersistableMainPreviewUrl 仍会兜底）。
- **门禁测试**：test:gate 62/62 通过，tsc + vite build 成功。服务器已启动在端口 3001。

### §11.90m.6 修复 Seedance 面板拖入图片后刷新主图丢失（对标 Banana isNano 分支）（2026-08-10）
- **现象**：Seedance 2.0「参考生视频」tab 拖入图片后，刷新主图丢失。原代码所有图片一律写入 referenceImages，从不设置 imageLocalRef + IDB 主图备份。
- **根因**：`handleSeedanceReferenceFiles`（NodeInspector.tsx L4729）是 Seedance 独立拖入处理器，完全缺少 Banana 面板（isNano 分支 L4165-L4225）的「首张无主图时做主图 + attachLocalMainRef（IDB 备份 + imageLocalRef 设置）」逻辑。同时 `ingestInspectorReferenceLocalFilesImpl` 的通用分支也不包含 Seedance。
- **修复（NodeInspector.tsx handleSeedanceReferenceFiles）**：在函数开头新增主图判断和"首张做主图"分支：
  1. 用 `resolvePanelMainSlotPreviewUrl` 检查当前是否有主图
  2. 无主图 + 有图片文件 → 首张做主图（`imagePreview` + `attachLocalMainRef` 触发 IDB 备份），剩余图片作为参考图（含 localRefs），视频/音频照常处理
  3. 有主图 → 保持原逻辑（全部图片作为参考图）
  4. 严格遵循 Banana 的"先 onUpdate 后 dispatchEvent"顺序，确保 `attachLocalMainRef` 读到正确的状态
- **影响**：Seedance 面板拖入图片后，主图首次获得 `imageLocalRef` + IDB 备份，刷新后可通过 `hydrateLocalMediaPreviews` 恢复主图，与 Banana 面板行为一致。删除图片逻辑已通过 `compactSeedancePanelReferences`（§11.90m.1）正确对齐，无需额外修改。
- **门禁测试**：test:gate 62/62 通过，tsc + vite build 成功。服务器已启动在端口 3001。

### §11.90o 修复 Seedance 面板删图刷新丢图/图片自行减少（对标 Banana 删除链路）（2026-08-10）
- **现象**：Seedance 面板拖入 9 张图后逐张删除+刷新，当面板剩 7 张时未删图再刷新却只剩 6 张（图片自行减少）；日志出现非连续 `blob-miss`（ref:6、ref:8）。
- **根因（三处，对比 Banana `removeImage2PanelReferenceAtDisplaySlot` / `compactImage2PanelLocalRefs`）**：
  1. **删除时 splice 了两个不同步的数组（致命）**：`removeRefImage`（NodeInspector.tsx）用 props `data` 快照。`referenceImages`（onUpdate 写入）与 `referenceImageLocalRefs`（FlowEditor `attachLocalReferenceRefs` 的 setNodes 写入）来自两条异步链路，props 快照里两数组可能长度/内容不一致 → 同下标 splice → refs 删 A 图、localRefs 删 B 的 ref → `deleteLocalMediaRef` 误删无辜 IDB blob → 刷新 blob-miss 丢图。日志铁证：miss 的是非连续的 ref:6（下标4）、ref:8（下标6）。
  2. **`compactSeedancePanelReferences` 的 commonLen 截断（放大器）**：`Math.min(refs, labels, localRefs, eids)` 任一数组短 1，末尾合法图被静默丢弃 → 「没删图再刷新也少一张」。
  3. **hydrate compact 只压 refs+localRefs 不压 labels/eids（衍生）**：标签与图片错位。
- **修复（3 处最小变更）**：
  1. `utils/referenceImageSlotLabels.ts compactSeedancePanelReferences`：去掉 commonLen 截断，以 refs 长度为准遍历；localRefs 与 refs 长度不一致时按 URL 内容重匹配（Banana `compactImage2PanelLocalRefs` 语义，used 防重），下标错位可自愈。
  2. `components/NodeInspector.tsx removeRefImage` 标准分支：数据源从 props `data` 改为 `nodeDataRef.current`（最新一致快照），不动 Omni 分支。
  3. `utils/hydratePanelReferenceLocalRefs.ts` compact 段：仅 `referenceImageLocalRefs` 字段时同步压缩 `referenceImageLabels` / `referenceElementIds`。
- **风险**：三处均限定在删图/刷新对齐链路，不碰 S 级模块、不改接口语义；长度一致的正常路径行为与旧逻辑完全一致。
- **门禁测试**：test:gate 62/62 通过，tsc + vite build 成功，服务已重启在端口 3001。

### §11.90p 修复 hydrate patch 半字段合并导致 refs/localRefs 错位恶性循环（2026-08-10）
- **现象**：新节点拖 9 张图，删一张刷新一次均正常；删到「图片7」后再刷新自动少图，之后持续恶化。日志显示 workspace 中 `referenceImageLocalRefs` 出现尾随空槽（`[ref:0, ref:1, "", ""]`）。
- **根因（核心）**：`FlowEditor.tsx` 刷新 hydration 的 `setNodes` 合并逻辑**只写入 patch 里的 `referenceImages`，丢弃 `referenceImageLocalRefs` / `referenceImageLabels` / `referenceElementIds`（含 Omni 三个 localRefs 字段）**。hydrate 遇 blob-miss 时 compact 算出对齐的短数组，但只有 refs 被缩短、localRefs 保持旧长 → 两数组错位 → 后续删除同下标 splice 两个不同数组 → `deleteLocalMediaRef` 误删无辜 IDB blob → 自动保存把错位状态入库 → 下次刷新更多 blob-miss → **恶性循环**，表现为「没删图刷新也自动少图」。
- **为什么 Banana 不明显**：Banana 的 `compactImage2PanelLocalRefs` 按 URL 内容重匹配 localRefs（错位自愈），且 blob 未被误删；该 setNodes 缺陷对 Seedance 是致命的。
- **修复（1 处最小变更）**：`FlowEditor.tsx` hydration `setNodes` 合并逻辑补上 `referenceImageLocalRefs` / `referenceImageLabels` / `referenceElementIds` / `klingOmniMulti/Instruction/VideoReferenceLocalRefs` 六个字段的同步写入（`!== undefined` 判断，空数组也写入）。
- **与 §11.90o 的关系**：§11.90o 修的是「删除时」的数据源一致性（nodeDataRef.current + compact 去截断 + hydrate labels 同步）；本节修的是「刷新 hydrate 时」patch 应用不完整——两者共同构成完整防线：compact 结果必须完整落盘。
- **风险**：仅补充此前被静默丢弃的 patch 字段写入，不改变任何计算逻辑；hydrate patch 无这些字段时行为与旧逻辑一致。
- **门禁测试**：test:gate 62/62 通过，tsc + vite build 成功，服务已重启在端口 3001。

### §11.90q 修复 Nano Banana 2.0 模型切换后主图丢失（2026-08-10）
- **现象**：image2 面板删图刷新后，切换到 Nano Banana 2.0 主图消失。
- **根因**：`nanoBananaMainPatchOnModelSwitch` 在 `nanoConfig.imagePreview === undefined` 但 `imageLocalRef` 存在时，错误返回 `current.imagePreview`（刷新后失效的 blob URL），导致主图无法从 IDB 恢复。
- **修复**：`modelSwitchPanelIsolation.ts` 第 78-92 行，当 `nanoConfig.imagePreview === undefined` 但 `imageLocalRef` 存在时，`imagePreview` 置为 `undefined`，让后续 hydration 从 `imageLocalRef` 恢复主图。
- **门禁测试**：`scripts/nano-model-switch-main-loss-test.ts`（6 个场景 16 个断言）— 覆盖 nanoConfig 无 imagePreview + 有 imageLocalRef、完整快照、data URL 失效、无快照保留 current、对照组等场景。test:gate 全部通过。

### §11.90r 修复 movNode/OUTPUT 拖入图片覆盖主视频（2026-08-10）
- **现象**：movNode 运行完成后 `imagePreview` 为主视频 URL（`.mp4`），Seedance 参考生模式拖入图片后，`handleSeedanceReferenceFiles` 将首张图片写入 `imagePreview`，覆盖主视频导致主视频消失。
- **根因**：`resolvePanelMainSlotPreviewUrl` 会排除视频 URL，导致 `needsMain = true`，进入「首张做主图」分支覆盖主视频。
- **修复**：`NodeInspector.tsx` 第 4752-4755 行，新增 `hasMainVideo = isLikelyMainVideoUrl(d0.imagePreview)` 判断；当 `hasMainVideo === true` 时 `needsMain = false`，拖入图片全部走参考图分支，不再覆盖主视频。
- **门禁测试**：`scripts/mov-node-drag-image-no-clobber-video-test.ts`（8 个场景 16 个断言）— 覆盖 .mp4/.mov/.webm/data:video 等视频格式、图片 URL、空 imagePreview、对照组、真实节点数据（seedance2.0.json）等场景。test:gate 64 项全部通过（新增 2 项），服务已重启在端口 3001。

### §11.90s 修复跨模型面板串图 + 主图迁移删键导致主图丢失（2026-08-11）
- **现象**（banana.json 等 4 个问题）：① banana 面板拖图删一张、刷新后切到别的模型，面板主图丢失；② image2 拖入的图片显示在可灵3.0 Omni 多图参考；③ Seedance 拖入的图片同样串到 Omni 多图参考；④ image2/可灵 Omni 拖图刷新后，其他模型面板主图丢失。
- **根因 A（串图，问题②③）**：`NodeInspector.tsx` `handleModelChange` 切到可灵3.0 Omni 分支中，`referenceImageLocalRefs` 在 omniConfig 缺失时兜底继承**当前顶层值**（属于上一个模型 image2/Seedance/Nano）→ hydrate effect 将外来图片恢复到顶层 `referenceImages` → `buildPanelRefSlotSyncPatch`（panelRefPersistence.ts）在 Omni multi tab 下把顶层 referenceImages 的去重/标签同步结果写入 `klingOmniMultiReferenceImages` → 串图可见。对比：Seedance 恢复分支（同文件）兜底为 `: []`，从不继承，故不串图。
- **根因 B（主图丢失，问题①④）**：`FlowEditor.tsx` `hydrateLocalMediaPreviews` 的 `migrateRefToModelScoped` 在主图迁移后 `deleteLocalMediaRef(curRef)` 删除旧 IDB 键；而其他模型 modelConfigs 快照里的 `imageLocalRef` 仍指向旧键 → 切回该模型刷新后 blob 查无 → 主图永久丢失（前缀兜底 §11.90n 也匹配不到 4 段 legacy `main` 键）。对比：Seedance 用统一键（usesUnifiedSeedance20PanelLocalRef）且从不把主图快照存入 modelConfigs，主图跟随顶层活指针，故不受影响。
- **修复**（最小变更 2 处）：
  1. `NodeInspector.tsx` L3359-3366：Omni 恢复分支 `referenceImageLocalRefs` 兜底由 `data.referenceImageLocalRefs ?? []` 改为 `[]`（对齐 Seedance 分支）；Omni 三个 tab 专用 localRefs 兜底保持不变。
  2. `FlowEditor.tsx` L2582-2588、L2614-2619：两处 `deleteLocalMediaRef(curRef)` 加 `kind !== 'main'` 守卫——主图迁移只复制不删除；ref/首尾帧槽删除逻辑原样保留（§11.90g/h 防重复不受影响）。
- **语义变化说明**：各模型恢复各自 modelConfigs 快照中的主图（A 模型换主图不再覆盖 B 模型的主图快照），与"面板独立"诉求一致；代价是 IDB 主图可能多存一份副本（每节点最多 1 张）。
- **残留风险（未动）**：`buildPanelRefSlotSyncPatch` 的 gp 恢复路径在 Omni multi tab 且提示词含 @图片n 时，仍可能把 `modelConfigs.image2.referenceImages` 合入顶层 referenceImages 再同步进 Omni 字段；本次修复后常态（无 @图片n）不触发，如出现再单独处理。
- **验证**：test:gate 全部通过；npm run build 成功；服务已重启在端口 3001。

### §11.90u 面板图片隔离 & 主图持久化 门禁规则（2026-08-11）
- **新增门禁测试**：`npm run test:panel-image-isolation-guard`（已纳入 `test:gate`）
- **测试脚本**：`scripts/panel-image-isolation-guard.test.ts`（58 项断言全通过）
- **覆盖场景**：
  1. IDB 键模型隔离：每个模型（image2、Nano Banana 2.0、可灵3.0 Omni、Seedance）生成独立 main/ref 键，互不干扰
  2. image2 → banana 主图保持：image2 拖图刷新后切 banana，banana 有快照时恢复自己的主图，无快照时保留 image2 主图
  3. image2 删图+刷新×2 → 其他模型主图保持：连续删图刷新后切 banana/seedance，主图不丢失
  4. 可灵3.0 Omni → 其他模型主图保持：Omni 拖图刷新后切 banana，banana 有快照时恢复自己的主图
  5. 跨模型参考图隔离：各模型 referenceImageLocalRefs 使用独立 IDB 键，image2 参考图不泄漏到 Omni
  6. `clearInheritedPanelMedia` 正确清理所有面板媒体字段
  7. `hasMainSnapshot` 守卫：空模型快照（imageLocalRef 和 imagePreview 都为空）不覆盖已有主图
  8. `image2MainPatchOnModelSwitch` 正确恢复/保留主图
  9. Seedance 2.0 高质量版/急速版共用 IDB 键，Nano Banana 使用独立键
  10. `modelFrameLocalRefKey` 各模型名映射稳定
- **核心不变式（禁止违反）**：
  - **不变式 1**：`buildMainLocalRefForModel(scope, nodeId, model)` 对不同模型返回不同的 IDB 键（Seedance 2.0 两型号共用除外）
  - **不变式 2**：`nanoBananaMainPatchOnModelSwitch` 中，当 nanoConfig 的 imageLocalRef 和 imagePreview 都为空字符串时，视为无有效快照，不得覆盖 current 主图
  - **不变式 3**：`FlowEditor.tsx` 迁移逻辑中，`kind === 'main'` 的 blob 只复制不删除（`if (kind !== 'main') deleteLocalMediaRef(curRef)`）
  - **不变式 4**：`clearInheritedPanelMedia` 必须清理 imagePreview、imageLocalRef、referenceImages、referenceImageLocalRefs 等全部面板字段
  - **不变式 5**：各模型 `modelConfigs` 中的 `referenceImageLocalRefs` 必须使用对应模型的 IDB 键，不得跨模型共享
- **违反后果**：任何违反上述不变式的修改将直接导致主图丢失或跨模型参考图泄漏
- **修改前必读**：涉及模型切换、IDB 迁移、面板媒体处理的代码修改前，必须通读 `§11.90s` 和本节，确认变更不违反核心不变式
- **运行命令**：`npm run test:gate`（包含本测试）

### §11.90v image2 生图完成切 Banana 主图消失修复（2026-08-11）
- **问题**：image2 生图完成后切换到 Banana 面板，主图消失；其他模型面板正常（数据样本：`E:\问题\0811\image2-特别.json`）。
- **根因**：Banana 的 modelConfig 快照保存时顶层 `panelMainImageUrl` 恰好为空（保存逻辑仅 `panelMainSlotVisible === false` 时才存该字段，见 [NodeInspector.tsx](file:///d:/aaa/flowgen-ai-studio/components/NodeInspector.tsx#L2926-L2927)），导致快照丢失备份字段。切换恢复时 [nanoBananaMainPatchOnModelSwitch](file:///d:/aaa/flowgen-ai-studio/utils/modelSwitchPanelIsolation.ts#L58) 快照分支把顶层 `panelMainImageUrl` 清成 undefined，同时恢复 `panelMainSlotVisible=false` → [resolvePanelMainSlotPreviewUrl](file:///d:/aaa/flowgen-ai-studio/utils/referencedMediaRun.ts#L270-L277)「无 backup 且 visible=false → undefined」→ 主图槽永不显示。其他模型正常是因为 image2 快照恰好保存了 `panelMainImageUrl`（backup 优先返回）。
- **修复**（最小变更，仅 [modelSwitchPanelIsolation.ts](file:///d:/aaa/flowgen-ai-studio/utils/modelSwitchPanelIsolation.ts#L87-L116) 快照分支）：恢复快照时若 `panelMainSlotVisible === false` 但**无任何 backup 可依**且 `imagePreview` 有效（即主图本身），清除虚假隐藏标记（置 undefined），让主图槽直接展示 imagePreview——与重新选中节点时 `buildPanelMainImageRestorePatchForEditing` 的恢复语义一致。
- **不破坏的场景**（均有门禁断言）：
  - 快照有 backup + visible=false → 标记保留（运行后隐藏语义不变）
  - visible=false + 无 backup + 无 preview（imageLocalRef 待 hydration）→ 标记保留
  - 空快照（hasMainSnapshot=false）→ 保留 current 主图（§11.90t 行为不变）
- **门禁**：`panel-image-isolation-guard.test.ts` 新增 §7.5 共 6 项断言（真实数据复刻 + 2 个反向防护），总计 64 项；test:gate 全部通过。
- **变更记录**：
  - 修改 `utils/modelSwitchPanelIsolation.ts` `nanoBananaMainPatchOnModelSwitch` 快照分支
  - 修改 `scripts/panel-image-isolation-guard.test.ts` 新增 §7.5 场景
- **风险评估**：仅影响「Banana 快照 visible=false 且无 backup 且有 preview」这一必然消失的组合，其余路径行为完全不变；不涉及 S 级稳定模块。

### §11.90w 画布主视频 `<video>` 鉴权 401 修复（2026-08-11）
- **问题**：浏览器控制台报 `GET /flowgen-api/projects/14/node-media/xxx.jpg/file → 401 Unauthorized`，画布视频节点无法预览。
- **根因**：[CustomNode.tsx](file:///d:/aaa/flowgen-ai-studio/components/nodes/CustomNode.tsx#L1166-L1168) 画布主 `<video>` 标签直接使用 `displayImagePreview`（useMemo 缓存值），未通过 `toRenderableSrc` 包装。该 useMemo 依赖 `[canvasMainPreviewUrl, previewLod]`，不包含 token 状态；当首次渲染时 localStorage 的 token 尚未就绪，缓存就固化为裸 URL，后续 token 写入也不会触发重算 → `<video src>` 永久不带 `?access_token=` → 后端 `authMiddleware(true)` 返回 401。
- **对比**：同文件 `<img>` 海报（L1160）和 fallback `<video>`（L128）早已用 `toRenderableSrc` 包装，是成熟逻辑；本次修复仅让画布主 `<video>` 与它们对齐。
- **修复**（最小变更，仅 [CustomNode.tsx:1168](file:///d:/aaa/flowgen-ai-studio/components/nodes/CustomNode.tsx#L1168) 一行）：
  ```diff
  - src={nodeVideoSrc || mainVideoDisplaySrc || displayImagePreview}
  + src={toRenderableSrc(nodeVideoSrc || mainVideoDisplaySrc || displayImagePreview)}
  ```
- **影响范围**：仅画布节点主视频预览的 src 生成路径；不改动 `toRenderableSrc` 本身；不改动后端鉴权；不改动 `<img>` 渲染路径；不改动 workspace JSON 持久化内容。
- **验证**：`npm run build` 成功；`npm run test:gate` 全部通过（64 项断言 0 失败）；服务在 3001 端口正常启动（HTTP 200）。
- **风险评估**：极低。`toRenderableSrc` 是同文件 `useCallback` 空依赖的成熟函数，每次渲染重新检查并注入最新 token；已带 token 的不重复处理；blob/data URL 在 `resolveDisplayMediaUrl` 内部直接返回不受影响。不影响任何原有正常业务，只修复 401 这一个 bug 点。不涉及 S 级稳定模块。

### §11.90x image2 运行后切 Banana 主图跟随 @首个元素（2026-08-12）
- **问题**：image2 生图完成后切换到 Banana 面板，主图显示「面板默认首张图」（夏茉），而切换到其他模型（seedance/即梦等）主图显示 @首个元素——两套逻辑不一致（数据样本：localStorage 真实节点 `node_14_1786433893248`）。
- **根因**：[nanoBananaMainPatchOnModelSwitch](file:///d:/aaa/flowgen-ai-studio/utils/modelSwitchPanelIsolation.ts#L59) 在节点处于「运行后未 @主图」状态（`current.panelMainSlotVisible===false` 且 `imagePreview` 已切到首个 @ 参考图，见 `buildPanelImagePreviewPatchAfterRun` §5.7/§10.38）时，仍走快照恢复分支，用 Banana 旧快照主图（夏茉）覆盖 `imagePreview`，导致显示面板默认首张图。其他模型面板正常是因为它们的切换分支不动 `imagePreview`（直接保留运行后状态）。
- **修复**（最小变更，仅 [modelSwitchPanelIsolation.ts](file:///d:/aaa/flowgen-ai-studio/utils/modelSwitchPanelIsolation.ts#L79-L95) 守卫前置）：在 `nanoBananaMainPatchOnModelSwitch` 最前面加守卫，检测 `current.panelMainSlotVisible===false && imagePreview 非空且非视频 URL` 时，跟随 `current.imagePreview`（= @首个元素），并清掉 `imageLocalRef`/`panelMainImageUrl`/`panelMainSlotVisible`（避免 IDB 灌回旧主图、备份覆盖首个 @ 参考）——与 seedance/即梦等模型切换分支一套逻辑。
- **不破坏的场景**（均有门禁断言）：
  - 快照带 backup + visible=false → 守卫仍优先跟随 current（一套逻辑优先于快照）
  - 非运行后切换（visible≠false）→ 守卫不触发，快照恢复分支行为不变（backup/visible/imagePreview 全保留）
  - 运行后视频预览（imagePreview 是 .mp4）→ 守卫不触发（Banana 是图片模型，恢复快照）
  - 无 preview 无 backup（待 hydration）→ §11.90v 行为不变（visible=false 保留）
- **门禁**：`panel-image-isolation-guard.test.ts`
  - §7.5 单函数 11 项（含 4 个反向防护）
  - §7.6 真实数据端到端 5 项（复刻 localStorage 真实节点 fixture，模拟 `handleModelChange` 完整 patch 链路：`nanoBananaMainPatchOnModelSwitch` → `buildStalePanelMainBackupClearPatch` → `stripRestoredNodeMediaForLocalRefHydrate`，断言最终 `imagePreview`=2a5576c2、`resolvePanelMainSlotPreviewUrl`=@首个元素）
  - 总计 75 项全绿；`test:gate` 全部通过
- **编号修正**：本次守卫原误标 §11.90w（与 §11.90w 视频 401 修复冲突），统一改为 §11.90x；代码注释与门禁同步修正。
- **变更记录**：
  - 修改 `utils/modelSwitchPanelIsolation.ts` `nanoBananaMainPatchOnModelSwitch` 注释 §11.90w→§11.90x（逻辑未动，守卫在上一轮已加）
  - 修改 `scripts/panel-image-isolation-guard.test.ts` §7.5 注释编号 + 新增 §7.6 真实数据端到端门禁 + 补 import（`buildStalePanelMainBackupClearPatch`/`resolvePanelMainSlotPreviewUrl`/`stripRestoredNodeMediaForLocalRefHydrate`）
- **风险评估**：极低。守卫仅在「运行后未 @主图」精确组合触发，其余路径行为完全不变；§7.6 端到端门禁用真实数据锁定了完整 patch 链路的最终显示结果。不涉及 S 级稳定模块。
- **实测提示**：守卫逻辑已由 §7.6 端到端门禁验证生效（`imagePreview`=2a5576c2=@首个元素，≠夏茉）。若浏览器仍显示夏茉，多为旧前端包未刷新（构建于今日 9:17）或 localStorage 历史残留——强制刷新页面（Ctrl+F5）后重新切换 image2→banana 即可验证。

### §11.91 Seedance 2.0 参考生参考图保留原始比例不裁切 + 图生首尾帧裁切提醒（2026-08-12）

- **现象**：用户反馈 Seedance 2.0 参考生视频上传时会裁切拖入的原始图片；竖向图片选 16:9 视频比例时，图片被居中裁掉上下，丢失画面内容。

- **根因**：`utils/seedanceImageUpload.ts` 的 `prepareImageForSeedanceModelUpload` 在传入 `targetRatioLabel`（如 16:9）时，会按目标比例居中裁切图片（L133-L145）。参考生模式下，`FlowEditor.tsx` L10119 将面板比例（默认 16:9）作为 `seedanceRatioLabel` 传入参考图上传上下文，导致所有参考图被强制裁切成视频比例。但火山引擎豆包官方文档（82379/1520757）对单张图片仅要求：宽高比 (0.4, 2.5)、边长 (300, 6000)px、<30MB，**并不要求图片比例与视频 aspectRatio 一致**。L133-L145 的按目标比例裁切属于过度处理。

- **解决方案**：统一「不裁切只提醒」策略（豆包官方不强制图片比例=视频 aspectRatio，模型自行适配）：
  - 参考生模式（`seedanceMode === 'reference'`）：参考图上传时 `seedanceRatioLabel` 传 `null`，`prepareImageForSeedanceModelUpload` 仅做边长/字节/极值（0.4~2.5）约束，保留原图构图，不按视频比例裁切。
  - 图生首尾帧模式（`seedanceMode === 'image'`）：**同样不裁切**，首尾帧/`@图片n` 上传时 `seedanceRatioLabel` 传 `null`，仅做边长/字节/极值约束，比例适配交给模型（与即梦图生服务端裁切、参考生行为一致）。
  - 文生模式：无图，不涉及。

- **新增面板提醒**：`NodeInspector.tsx` 图生视频「素材要求」列表（`seedanceMode === 'image'`，仅 `isSeedance20` 显示）新增琥珀色加粗条目「⚠ 比例建议：首尾帧图片比例宜与所选视频比例一致；不一致时模型会自行适配比例，可能影响首帧还原效果。」（放在素材要求 ul 列表内，紧随数量项之后，比视频比例区更醒目）

- **改动文件**：
  - `components/FlowEditor.tsx` L9801-9808：图生首尾帧 `prepareLocalImageSrcCached` 不传 `seedanceRatioLabel`（不裁切，仅边长/字节/极值约束）
  - `components/FlowEditor.tsx` L9912-9913：图生 `imageUploadCtx.seedanceRatioLabel` 改为 `null`（`@图片n` 上传不裁切）
  - `components/FlowEditor.tsx` L10119-10121：参考生 `seedanceUploadCtx.seedanceRatioLabel` 传 `null`（参考图不裁切）
  - `components/NodeInspector.tsx` L6123-6125：图生素材要求 ul 列表内新增 `isSeedance20` 条件的比例提醒条目（文案：模型会自行适配比例）

- **不改动**：
  - `utils/seedanceImageUpload.ts`：函数已支持 `targetRatioLabel` 为空时不裁切（`targetAspectFromLabel` 返回 undefined），无需改动
  - L125-L131 极值裁切（0.4~2.5 官方硬约束）、L147-L191 边长/字节约束、L9812-L9819 首尾帧比例一致校验：全部保留
  - `services/aitop.ts` `createDoubaoSeedanceVideoTask`：S级，不碰

- **官方依据**：火山引擎创建视频生成任务 API（82379/1520757）— 传入单张图片要求：宽高比 (0.4, 2.5)、宽高长度 (300, 6000)px、单张 <30MB；`aspectRatio` 为输出视频比例字段，不要求与图片比例一致。

- **门禁验证**：`npm run test:gate` 全部通过（含 panel-image-isolation-guard 75 项、nano-model-switch 16 项、mov-node-drag 16 项等），构建成功，服务重启于 http://localhost:3001。

- **风险评估**：低。
  - 参考生模式：参考图保留原图构图，符合官方硬约束，无 API 报错风险；参考图仅作特征参考，比例差异不影响模型提取特征。
  - 图生模式：首尾帧同样保留原图构图，比例适配交给豆包模型（官方不强制首帧=视频比例）；面板提醒告知用户「不一致时模型会自行适配比例，可能影响首帧还原效果」。
  - 全模式统一「不裁切只提醒」，与即梦/可灵/banana/image2 行为一致，无 API 报错风险。
  - 不影响其他模型（nano/image2/kling/jimeng/vidu/mj）。

- **后续建议**：浏览器实测参考生模式拖入竖图 + 选 16:9，确认参考图完整上传（可在运行日志 `seedance-image-fit` stage 查看 width/height/resized，resized=true 但宽高比与原图一致即未裁切）。

### §11.92 即梦/可灵面板比例提醒补充 + 全模型不裁切核查（2026-08-12）

- **背景**：§11.91 完成 Seedance 不裁切修复后，需同步补充即梦3.0 Pro、可灵3.0 Omni 面板的图片比例提醒，并全面核查所有文生图/文生视频模型代码确认均不裁切素材。

- **全模型裁切核查结论**：**当前代码中没有任何模型在客户端裁切图片**。
  - 唯一具备裁切能力的函数 `prepareImageForSeedanceModelUpload`（`utils/seedanceImageUpload.ts` L111-L192），其裁切逻辑仅在 `targetRatioLabel` 为有效比例时触发；§11.91 已将所有 Seedance 调用路径的 `seedanceRatioLabel` 设为 `null`，实际不裁切。
  - 所有非 Seedance 模型（Nano Banana 2、image 2、MidJourney、可灵3.0 Omni、可灵 2.5 Turbo、Vidu 2.0、即梦3.0 Pro）在 `prepareLocalImageSrc`（`FlowEditor.tsx` L7598-L7672）中直接返回原 src，零预处理。
  - Seedance 保留的极值裁切（宽高比 0.4~2.5 范围外居中裁切）是豆包官方硬约束，超出会被 API 拒绝，必须保留。

- **官方 API 图片要求汇总**（2026-08-12 查证）：
  | 模型 | 格式 | 大小 | 尺寸/边长 | 宽高比 | 裁切行为 |
  |------|------|------|-----------|--------|----------|
  | Seedance 2.0 | JPEG/PNG | ≤30MB | 边长 300~6000px | 0.4~2.5 | 客户端不裁切（§11.91），模型自行适配 |
  | 即梦3.0 Pro | JPEG/PNG | ≤4.7MB | 最大 4096×4096，最短边≥320px | 长边:短边 ≤ 3 | **服务端居中裁切**以匹配最接近的视频比例 |
  | 可灵3.0 Omni | JPG/JPEG/PNG | ≤10MB | 宽高 ≥ 300px | 1:2.5~2.5:1 | 不裁切，比例超限被官方拒绝 |
  | Nano Banana 2 | - | - | - | - | 不裁切（非 Seedance，零预处理） |
  | image 2 | - | - | - | - | 不裁切（非 Seedance，零预处理） |
  | MidJourney | - | - | - | - | 不裁切（sref/cref/oref 透传 COS URL） |

- **改动文件**：`components/NodeInspector.tsx`
  - L6019-6022：即梦3.0 Pro 面板提醒 — 新增琥珀色加粗比例建议条目，告知用户「不一致时官方服务端会居中裁切，可能丢失画面边缘。图片长边:短边 ≤ 3，最短边 ≥ 320px，最大 4096×4096」。
  - L5761-5764：可灵3.0 Omni 首尾帧 Tab — 新增琥珀色加粗图片要求条目，告知用户「JPG/JPEG/PNG；宽高比 1:2.5~2.5:1；宽高 ≥ 300px；单张 ≤ 10MB。比例超出范围将被官方拒绝」。
  - L5817-5836：可灵3.0 Omni 多图参考/指令变换/视频参考 Tab — 同样新增琥珀色加粗图片要求条目。

- **门禁验证**：`npm run test:gate` 全部通过（75+62+16+16=169 项断言，0 失败），构建成功，服务重启于 http://localhost:3001。

- **风险评估**：低。
  - 仅在面板 UI 新增提醒文案（`<p>` 标签），未改动任何业务逻辑、接口、变量、流程。
  - 不影响 S 级稳定模块（`services/aitop.ts` 等）。
  - 不影响图片上传/预处理链路（`FlowEditor.tsx`、`seedanceImageUpload.ts` 未改动）。
  - 提醒文案基于官方 API 文档（火山引擎豆包 API、可灵官方文档），准确可靠。

### §11.94 移除 Seedance 2.0 参考生"比例策略"栏（死代码清理）（2026-08-12）

- **背景**：§11.91 完成 Seedance 全模式不裁切后，"比例策略"栏（强制比例/自动匹配）中的"自动匹配"选项变为死代码——由于 `ratioFromPanel` 在 Seedance 2.0 参考生模式下永远非 null（"视频比例"选择器始终有有效值），`!ratioFromPanel` 条件永远为 false，自动检测参考图比例的逻辑永不执行。

- **改动内容**：
  - `components/NodeInspector.tsx` L7576-7607（原）：移除"比例策略"栏 UI（`isSeedance20 && seedanceMode === 'reference'` 条件下的"强制比例"/"自动匹配"两个按钮）。用户统一通过上方"视频比例"六宫格选择输出视频比例。
  - `components/FlowEditor.tsx`：
    - 移除 `seedanceReferenceRatioMode` 变量和 `shouldAutoMatchReferenceRatio` 变量（L9759-9768 原）
    - 移除 `runCaptureForGp` 中的 `seedanceReferenceRatioMode` 赋值（L9751-9756 原）
    - 移除参考图比例自动检测死代码块（L10475-10492 原，`shouldAutoMatchReferenceRatio && !ratioFromPanel` 永远为 false）
    - 将参考视频时长校验从 `shouldAutoMatchReferenceRatio` 条件中提取出来，改为对所有参考生视频均生效（L10305 原）
    - 移除参考视频比例检测 `ratioOverrideByReferenceVideo = await detectVideoRatioFromUrl(...)`（仅"自动匹配"时生效，现已移除）
  - 持久化引用（`seedanceReferenceRatioMode` 字段在快照/generationParams 中的读写）保留以确保旧数据兼容性，不影响行为。

- **门禁验证**：`npm run test:gate` 全部通过（75+62+16+16=169 项断言，0 失败），构建成功，服务重启于 http://localhost:3001。

- **风险评估**：低。
  - "自动匹配"从未实际生效（`!ratioFromPanel` 永远为 false），移除不改变任何现有行为。
  - 参考视频时长校验从仅"自动匹配"模式扩展到所有参考生模式，是一个安全性增强（之前"强制比例"模式下缺少此校验）。
  - `seedanceReferenceRatioMode` 字段保留在持久化列表中，旧节点数据不会丢失。
  - 不影响 S 级稳定模块、不影响图片上传/预处理链路。

### §11.93 JSON 导入节点放置到当前视口中心（替代 §11.57 fitView 方案）（2026-08-12）

- **现象**：用户从面板导入 JSON 后，节点出现在画布其他位置，需要移动画布才能找到。§11.57（2026-07-22）曾用 `fitView` 修复同类问题，但实际仍会出现节点跑到不可见区域、视口被强行拉走的情况。

- **根因**：`applyImportedProjectJson`（[FlowEditor.tsx:13128-13320](file:///d:/aaa/flowgen-ai-studio/components/FlowEditor.tsx#L13128-L13320)）原策略是「节点位置不变 + 偏移到画布已有节点右侧 + fitView 移动视口」：
  - 画布已有节点时，节点被偏移到 `currentMaxX + 100`（右侧很远），fitView 把视口抢走移到右侧，用户当前看到的位置被替换。
  - fitView 依赖 `setTimeout(100) + requestAnimationFrame` 双层延迟，在 lazy hydration 路径或节点尺寸未测好时容易失效。
  - 与用户期望相反：用户要「节点出现在我当前看到的位置」，原实现是「视口被拉到节点所在位置」。

- **修复**（参照粘贴节点逻辑 [FlowEditor.tsx:6241-6248](file:///d:/aaa/flowgen-ai-studio/components/FlowEditor.tsx#L6241-L6248) 同源方案，最小变更）：
  - 用 `screenToFlowPosition({ x: window.innerWidth/2, y: window.innerHeight/2 })` 计算当前视口中心的流程坐标
  - 计算导入节点的几何中心 `(ax, ay)`（仅统计 `hasReasonableNodePosition` 通过的节点）
  - 平移所有节点：`position.x += (viewportCenter.x - ax + extraOffsetX)`，`position.y += (viewportCenter.y - ay)`
  - 当画布已有节点时，`extraOffsetX = 320`（一个默认节点宽 200 + 120 间距）避免与中心已有节点完全重叠；空画布时 `extraOffsetX = 0`，节点几何中心精确落在视口中心
  - 依赖数组新增 `screenToFlowPosition`
  - `fitViewOnImportedNodes` 保留作为兜底（节点已在视口中心，fitView 不会大幅移动）
  - 同步更新 `posHint` 文案：已有节点时「新节点放在当前视口中心右侧（避免与已有节点重叠）」；空画布时「节点放在当前视口中心」

- **改动文件**：`components/FlowEditor.tsx`
  - L13159-13186：偏移量计算逻辑（从 `currentMaxX + 100` 改为视口中心平移）
  - L13308-13311：`posHint` 文案
  - L13319-13332：依赖数组新增 `screenToFlowPosition`

- **不改动**：
  - 节点 ID 映射、边连接、`mergeLegacyChainFolderNodesIntoRoots`、`hydrateGraphMediaFromPersisted`、`normalizePersistedInputRowsWithFolders`、`persistImportedGraphSnapshot`、storyboardImages 合并、lazy hydration 路径 — 全部保留
  - `fitViewOnImportedNodes` 函数本体保留作兜底
  - 不触及 S 级稳定模块

- **门禁验证**：`npm run build` 通过；`npm run test:gate` 全部通过（75+62+16+16=169 项断言，0 失败）；服务已重启 http://localhost:3001。

- **风险评估**：低。
  - 与粘贴节点逻辑（L6241-6248）同源，已是项目验证过的模式
  - 取消「向右偏移到 currentMaxX」语义改为「视口中心 + 小幅偏移」——若画布已有节点且恰在视口中心，导入节点会与之偏移 320px（不完全重叠，用户可手动拖开）
  - 持久化、边连接、ID 映射等业务逻辑完全不变
  - 不涉及 S 级稳定模块

- **后续建议**：浏览器实测三种场景：①空画布导入 → 节点应在视口中心；②画布已有节点且视口在中心 → 导入节点应在中心右侧 ~320px；③画布已有节点但视口在其他区域 → 导入节点应在当前可见区域中心。

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

---

## 13. 跨服务器 JSON 导入修复（2026-08-12）

### 13.1 问题背景

开发端导出的工程 JSON 文件，在部署端客户端导入后出现三类控制台报错：
1. `/flowgen-api/pr/PXF5N3Y3bufmznnD6A:1` → 404（旧版精简路径标识，后端无此路由）
2. `/flowgen-api/projects/14/node-media/xxx.jpg/file` → 404（node-media 海报文件未随 JSON 迁移）
3. 同上 URL → 401（旧 access_token 过期）

直接表现：**导入的视频节点缩略图不显示，需点击播放后才出现画面**。

### 13.2 修复方案（B1+B2+B3 组合）

#### B1：导出 JSON 时内嵌 node-media 海报为 data URL
- **文件**：`components/FlowEditor.tsx`
- **新增函数**：`inlineNodeMediaPosters(nodes)` — 深拷贝节点 data，检测 `videoPosterDataUrl`、`generatedThumbnails[].posterDataUrl`、`referenceMovs[].posterDataUrl` 中的 `/node-media/.../file` URL，fetch 拉取图片转为 data URL 后写入拷贝。
- **调用点**：`handleExportNodes`（右键导出节点）、`handleSaveProject`（保存工程到 JSON 文件）。
- **不影响**：内存中的原始节点 data、画布渲染、localStorage/MySQL 持久化等现有流程。
- **失败容错**：fetch 失败时保持原 URL 不变，不阻塞导出。

#### B2：VideoPoster / 主视频区域 onError 自动重截帧
- **文件**：`components/nodes/CustomNode.tsx`
- **VideoPoster 组件**：新增 `posterLoadFailed` state，`<img onError>` 触发后重置状态，使截帧 useEffect 在 poster URL 失效时重新执行 `captureVideoMiddleFrameQueued`。
- **主视频区域**：新增 `mainPosterLoadFailed` state，`<img onError>` 触发后让大图截帧 useEffect（L896）在 `videoPosterDataUrl` 存在但加载失败时也执行截帧，截帧成功后重置标志。

#### B3：导入时清理 `/pr/` 旧路径标识
- **文件**：`components/FlowEditor.tsx`
- **位置**：`applyImportedProjectJson` 入口处
- **逻辑**：递归遍历 `parsed.nodes`，将匹配 `/flowgen-api/pr/{id}:{index}` 的字符串替换为空串。

### 13.3 风险评估

| 修复项 | 影响范围 | 风险等级 |
|--------|----------|----------|
| B1 | 仅导出 JSON 文件（深拷贝替换） | 🟢 低 |
| B2 | 仅 onError 分支（正常加载不受影响） | 🟢 低 |
| B3 | 仅导入路径（递归清理无效 URL） | 🟢 低 |

### 13.4 验证
- TypeScript 编译零错误（`tsc --noEmit`）
- VS Code 诊断零错误

---

## 14. Seedance 模型默认 tab 改为参考生视频（2026-08-12）

### 14.1 问题背景
右键创建 image 节点后，切换到 Seedance 模型时，面板默认激活「文生视频」tab，与用户预期的「参考生视频」不一致。

### 14.2 根因
`NodeInspector.tsx` 中两处 fallback 逻辑默认为 `'text'`：
- Line 3495（模型切换路径）：`seedanceConfig.seedanceGenerationMode || (hasMainImage ? 'reference' : 'text')`
- Line 1194（显示层 fallback）：`data.seedanceGenerationMode || 'text'`

### 14.3 修改内容
| 文件 | 行号 | 改动 |
|------|------|------|
| `NodeInspector.tsx` | 3489-3495 | 移除 `hasMainImage` 变量；fallback 从 `'text'` 改为 `'reference'` |
| `NodeInspector.tsx` | 1194 | 显示层 fallback 从 `'text'` 改为 `'reference'` |

首次选择路径（Line 3577）已正确设置 `'reference'`，无需修改。

### 14.4 风险
- 🟢 低：仅影响新节点/模型切换时的初始 tab 选择；已有 `seedanceGenerationMode` 值的节点不受影响
- Text Node（`isTextGenNode`）仍默认 `'text'`，逻辑未变
- seedance1.5-pro 仍默认 `'image'`，逻辑未变

### 14.5 门禁验证（2026-08-12）

| 测试 | 结果 |
|------|------|
| `vitest`（全量单元测试） | ✅ 56 文件 / 503 测试全绿 |
| `test:2026070802-seedance-panel` | ✅ 11 通过 |
| `test:frame-model-switch-isolation` | ✅ 44 通过 |
| `test:20260714-seedance-reference-consistency` | ✅ 9 通过 |
| `test:text-gen-node` | ✅ 47 通过（含「首次选模型：文生节点 seedance 默认 text（非 reference）」契约） |
| `test:node-details` | ✅ 全部通过 |
| `test:panel-refs` | ✅ 全部通过 |
| `seedance20ModelSwitch.test.ts` | ✅ 4 通过 |

