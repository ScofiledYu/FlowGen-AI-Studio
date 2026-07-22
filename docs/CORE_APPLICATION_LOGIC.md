# FlowGen AI Studio — 核心功能与实现细节（完整版）

本文档按**用户可见功能**与**数据落盘路径**对齐描述实现位置与规则，便于加功能、改模型、做回归。代码为准；部分边界案例另见 `docs/IMPLEMENTATION_NOTES_2026-04.md`，背景框见 `docs/BACKDROP_NODE.md`。

---

## 目录

1. 代码入口与关键文件  
2. 数据模型（`types.ts`）  
3. Node Details：记录什么、从哪里读、如何合并  
4. 缩略图与主预览：如何生成、如何保存  
5. 聊天：Markdown / 表格解析与展示  
6. 右键菜单、添加节点菜单、剪贴板  
7. 排列与链折叠（INPUT / MOV 网格）  
8. 自动布局（L 键 / 工具栏）  
9. 保存、自动存盘、导入、配额  
10. 键盘快捷键  
11. 其它画布交互  
12. 模型与 AiTop（`services/aitop.ts`）  
13. 防护常量（`utils/flowLimits.ts`）  
14. 相关文档索引  
15. Seedance 2.0（侧栏、运行、API）
16. 新模型接入的共享规则

---

## 1. 代码入口与关键文件

| 区域 | 文件 | 说明 |
|------|------|------|
| 启动 | `index.tsx` | React 挂载；`console.error` 包装过滤 ResizeObserver 噪声 |
| 壳层 | `App.tsx` | 顶栏项目名、保存/打开；`#/test-chat` → `TestChatPage`，否则懒加载 `FlowEditor` |
| 画布核心 | `components/FlowEditor.tsx` | 节点/边状态、运行、持久化、Node Details 弹层、`previewParams` 大段合并逻辑、右键菜单、导入导出、排列、自动布局等 |
| 侧栏参数 | `components/NodeInspector.tsx` | 选中节点编辑区：各模型 Tab、上传、提示词区高度持久化到 `localStorage`（`flowgen:node-inspector-heights:v1`） |
| 聊天 | `components/ChatPanel.tsx` | 多模型对话、流式渲染、表格解析、选区右键动作、会话列表 key |
| 节点 UI | `components/nodes/CustomNode.tsx` 等 | 卡片主预览、`generatedThumbnails` 条、视频 poster 异步补全 |
| 类型 | `types.ts` | `NodeType`、`NodeData`、`GenerationParams` |
| 限制 | `utils/flowLimits.ts` | 持久化节点数、边数、缩略条数、撤销深度 |
| 视频截帧 | `utils/videoThumbnail.ts` | 远程视频中间帧 JPEG data URL（代理/CORS/超时） |

---

## 16. 新模型接入的共享规则

后续新增模型时，**优先复用共性链路**，不要把每个模型都当成独立系统去写。除模型专属 API 协议与侧栏 UI 外，下面这些结果规则应尽量保持一致：

### 16.1 共享运行骨架

- 运行入口统一在 `components/FlowEditor.tsx` 的 `handleNodeRun`
- 模型差异主要集中在：
  - 运行前输入整理（主图/参考图/视频/音频上传）
  - 调用 `services/aitop.ts` 的具体任务创建 API
  - 从 task status 中解析结果 URL
- 运行完成后的共性步骤应尽量复用：
  - 写 `generationParams`
  - 更新当前运行节点
  - 创建输出节点
  - 追加 `generatedThumbnails`
  - 必要时补 poster / persist

### 16.2 输出节点共享契约

输出节点不要直接整包继承上游 `snapForGp.data`。  
当前代码已改为使用 **白名单字段继承**（`buildInheritedOutputDataFromSnapshot`，位于 `components/FlowEditor.tsx`），只带结果节点真正需要的共性字段，例如：

- `prompt` / `negativePrompt`
- `referenceImages` / `referenceMovs` / `referenceAudios`
- `aspectRatio` / `resolution` / `numberOfImages`
- 首尾帧、即梦、Vidu、Seedance、Omni、image 2 等模型专用配置
- `modelConfigs`

明确**不继承**的高频/高体积/运行态字段：

- `generatedThumbnails`
- `chatHistory`
- 运行态 `status/progress/errorMessage`
- 上游 `customName`
- 上游 `generationParams`

这条规则的意义：

- 降低运行成功后的对象复制成本
- 让输出节点结构对所有模型尽量一致
- 后续新增模型时，只补“白名单里是否需要额外字段”，而不是复制一整包上游状态

### 16.3 一致性判断标准

如果一个新模型满足以下条件，就应尽量与其它模型行为一致，而不需要逐模型重新发明规则：

1. 有输入素材（图/视频/音频）  
2. 会创建任务并轮询结果  
3. 会生成 OUTPUT / MOV 节点  
4. 需要在 Node Details / generatedThumbnails 中追溯本次参数

这类模型都应优先复用：

- `generationParams` 快照结构
- 输出节点白名单继承
- `generatedThumbnails` 写入方式
- 持久化与 poster 的共性稳定性策略

### 16.4 新模型开发建议

以后如果你只提供：

- 模型名
- API 协议
- 侧栏 UI

那么新增模型时优先按这个顺序接：

1. 在 `types.ts` 补模型常量 / 类型字段  
2. 在 `services/aitop.ts` 补任务创建与状态解析  
3. 在 `NodeInspector.tsx` 补面板 UI  
4. 在 `FlowEditor.tsx` 的运行分支只写“输入整理 + API 调用 + 结果解析”  
5. 输出节点、缩略图、Node Details、persist、history 统一走现有共享链路

目标不是“每个模型单独调通”，而是“只新增模型差异部分，共性结果行为天然一致”。

## 2. 数据模型（`types.ts`）

### 2.1 节点类型 `NodeType`

- `INPUT`：输入图节点（故事板/拖入）。  
- `PROCESSOR`：侧栏称 Image Node（带模型与 Copilot）。  
- `OUTPUT`：图片输出。  
- `MOV`：视频输出。  
- `CHAIN_FOLDER`：历史/兼容的独立折叠夹；新逻辑多在 INPUT/PROCESSOR 上用 `chainFolderChildIds` 内嵌条表示。  
- `BACKDROP`：背景框；`backdropChildIds` 组织子节点，拖动框体带动子节点（见 `BACKDROP_NODE.md`）。

### 2.2 `NodeData`（与持久化强相关）

- **运行态**：`status`（`idle` / `running` / `completed` / `error`）、`progress`、`errorMessage`。  
- **主预览**：`imagePreview`（图 URL/base64 或视频 URL）；`imageName`。  
- **视频 poster（避免反复解码视频）**：`videoPosterDataUrl`（JPEG data URL）。  
- **生成历史（INPUT 等）**：`generatedThumbnails?: { id, url, type, nodeId?, name?, generationParams?, posterDataUrl? }[]` — 每条可带本次快照 `generationParams`，用于 Node Details 与追溯。  
- **当前编辑参数**：`prompt`、`negativePrompt`、`selectedModel`、各模型专用字段（可灵 Omni 多 tab 提示词与参考数组、即梦 `jimengImages`、Vidu、Seedance、`seedanceTabConfigs` 等）。  
- **一次生成完成快照**：`generationParams?: GenerationParams`（与 `generatedAt`、`taskId` 配合）；运行管线在 `handleNodeRun` 末尾按模型写入，**Node Details 优先信任此处**（尤其输出节点上 `selectedModel` 可能是「下一步默认」而非本次实际模型）。  
- **链路折叠**：`chainFolderChildIds`、`chainFolderExpanded`、`chainFolderLabel` 等。  
- **按模型隔离的配置**：`modelConfigs`（例如 Nano、可灵 2.5、可灵 Omni 等子对象），切换模型时恢复各套 prompt/参考等。

### 2.3 `GenerationParams`

结构化快照字段与 `NodeInspector` / Node Details 展示对齐，含 `model`、`prompt`、`referenceImages`、`referenceMovs`（`url` + `posterDataUrl`）、`referenceAudios`、各视频模型分辨率/时长/即梦/Vidu/Seedance/Omni tab 与 `klingOmni*` URL 字段、`generatedAt`、`taskId` 等。完整列表见 `types.ts` 接口定义。

---

## 3. Node Details：记录什么、从哪里读、如何合并

Node Details **不是**独立路由页，而是 `FlowEditor.tsx` 内由 **`previewNode`**（`useState<RFNode | null>`）驱动的**大图/参数预览弹层**。打开来源包括：节点上「详情」类操作、`CustomNode` 派发的事件、`createPreviewNodeFromThumbnail` 等（见 `setPreviewNode` 引用）。

### 3.1 核心原则

1. **模型名**：优先 `generationParams.model`（非空 trim），否则 `data.selectedModel`，再否则 Nano 2.0 等默认值。  
2. **提示词 / 负向**：对 **可灵3.0 Omni** 按当前 `klingOmniTab` 从 `klingOmniMultiPrompt` / `Instruction` / `Video` / `Frames` 等字段与 `generationParams` 做 `pickNonEmpty` 合并（`resolveOmniPromptForPreview`）。  
3. **参考图列表**：`mergeReferenceImagesSources` + **`sanitizeRefImagesForDetails`**：剔除视频 URL、视频 poster、与参考视频同源误写入的项；合并 `data` 与 `generationParams`；输出节点上可按快照 `referenceImages` 顺序重排（`mergedRefImagesOrdered`）。  
4. **参考视频**：`mergeReferenceMovsSources` + **`dedupeReferenceMovsByUrl`**（UUID/路径规范化、blob 与 https 择优、COS/kechuangai 镜像折叠）。Omni 的 `instruction` / `video` tab 下 **Reference Videos** 刻意不展示「本次生成结果视频」，只保留输入参考（与 `IMPLEMENTATION_NOTES` 一致）。  
5. **首尾帧 / 即梦多图**：输出节点若自身缺失，会 **BFS 沿入边** 找最近 `INPUT`/`PROCESSOR`，用其 `firstFrameImage*`、`jimengImages` 等补齐展示（`resolveNearestInputAncestorData`）。  
6. **摘要行**：`nodeDetailsTabSummaryLine` — Seedance 展示生成模式（1.5 不展示该摘要）；Omni 展示 tab 中文名；即梦 3.0 Pro **不展示**「生成模式」摘要行。

### 3.2 与「运行请求」的关系

`handleNodeRun` 内大量使用 `runStartDataSnapshot`，避免异步轮询完成时节点已被改掉；写入 `generationParams` 时会合并参考图/视频、Omni 槽位、Seedance 参考快照等，**保证 Details 与实际上传后的 URL 一致**（避免长期停留在 `blob:`/`data:` 被 `sanitizePersistValueDeep` 清掉后 Details 空白）。

---

## 4. 缩略图与主预览：如何生成、如何保存

### 4.1 节点卡片主区（`CustomNode.tsx`）

- **图**：`imagePreview` 直接展示。  
- **视频（MOV）**：优先用 **`videoPosterDataUrl`** 作静止封面；用户播放时用 `resolveUrlForVideoCapture` 等同源策略拉流。若主预览是视频且尚无 poster，会异步 **`captureVideoMiddleFrame`** 截帧并写回 `videoPosterDataUrl`，并 **`dispatchEvent(new CustomEvent('flowgen:persist-request'))`** 触发延迟写 `localStorage`。  
- **生成历史条**：`data.generatedThumbnails`；UI 使用 **`slice(0, FLOW_MAX_THUMBNAILS_PER_NODE)`**（与 `flowLimits` 常量一致，当前为 **48**）。若条数超过上限，持久化加载时会 **`capNodeGeneratedThumbnailsDeep`** 只保留**最近**一批，防止超大工程拖垮渲染。

### 4.2 每条 `generatedThumbnails` 项

- `url`：缩略或小图/视频地址。  
- `type`：`image` | `video`。  
- `posterDataUrl`：视频条目的静态图。  
- `generationParams`：该条对应生成参数快照，点开详情预览时用。  
- `name`：输出节点显示名快照。

### 4.3 持久化时的清洗（`buildPersistSnapshot`）

- 对整图做 **`sanitizePersistValueDeep`**：**去掉 `blob:` 字符串**（避免无效持久化）；数组/对象递归清洗。  
- 节点数组 **`slice(0, FLOW_MAX_PERSISTED_NODES)`**（500）、边 **`slice(0, FLOW_MAX_PERSISTED_EDGES)`**（4000）。  
- 每条节点再 **`capNodeGeneratedThumbnailsDeep`**。

### 4.4 与侧栏 `NodeInspector` 的差异

Inspector 内本地上传视频会用 **`createVideoPosterLite`**（轻量截帧）做侧栏预览，逻辑与画布 `videoThumbnail.ts` 不完全相同，但目的一致：减少视频解码压力。

### 4.5 共性稳定性策略（不区分模型）

以下策略是跨模型共用的，目的不是改变业务逻辑，而是降低刷新、批量拖图、运行成功后 UI 更新时的崩溃概率：

- **多图压缩改为小批顺序处理**
  - 位置：`components/NodeInspector.tsx`
  - 逻辑：多文件拖入/选择时，不再对所有图片 `Promise.all` 同时压缩，而是按小批次顺序推进，并在批次间让出主线程。
  - 适用：Nano / image 2 / 即梦 / Omni 等所有走多图素材区的模型。

- **缩略图分批 reveal**
  - 位置：`components/nodes/CustomNode.tsx`
  - 逻辑：`generatedThumbnails` 不一次性全渲染，而是首批少量显示，再按时间片逐步补齐。
  - 目的：降低刷新/恢复工程时的 DOM 挂载峰值、图片解码峰值与视频 poster 子组件并发数量。

- **poster 写回合批**
  - 位置：`components/FlowEditor.tsx`
  - 逻辑：运行成功后的 MOV poster 不再“每得到一张就 setNodes 一次”，而是先收集结果，再统一 patch。
  - 目的：减少连续 `setNodes(...map(...))` 引发的整图重渲染。

- **立即持久化请求防抖**
  - 位置：`components/FlowEditor.tsx`
  - 逻辑：`flowgen:persist-request` 不再每次触发都立即整图序列化写 `localStorage`，而是合批防抖。
  - 目的：避免 poster/thumbnail 高频补写把主线程卡死。

- **history / persist 跳过纯 poster 变化**
  - 位置：`components/FlowEditor.tsx`
  - 逻辑：通过轻量结构签名忽略 `videoPosterDataUrl` 与 `generatedThumbnails[].posterDataUrl`，减少“只变展示、不变业务”的整图深拷贝与整图持久化。
  - 目的：降低大工程中视频后处理阶段的内存与 CPU 压力。

- **运行成功后的节点更新波次收敛**
  - 位置：`components/FlowEditor.tsx`
  - 逻辑：若本次运行会生成输出节点，则把“运行节点本身更新”并入“追加输出节点/缩略图”的那一轮 `setNodes`。
  - 目的：减少一次运行成功后的整图遍历次数。

---

## 5. 聊天：Markdown / 表格解析与展示

实现集中在 **`components/ChatPanel.tsx`**。

### 5.1 消息结构 `ChatMessage`

- `content`：主文本。  
- `tableRows?: string[][]`：若存在，气泡内**优先用 HTML `<table>` 渲染**（`ChatTableHtml`），并可与 `content` 同时存在（上方说明文字 + 下方表）。  
- `imageUrl` / `imageUrls`：用户消息多图等。

### 5.2 模型回复如何变成「表」

1. **显式结构化**：若上游/本地把助手消息写成 `tableRows` 矩阵，直接渲染表。  
2. **Markdown 管道表嵌入文本**：若**没有** `tableRows`，对 `content` 调用 **`segmentMessageByPipeTables`**：  
   - 用 **`extractEmbeddedPipeTable`** 找第一段连续含 `|` 的行块；  
   - **`parseMarkdownPipeTableLines`** 拆单元格，**跳过** `| --- | :--- |` 这类分隔行；  
   - 至少 **2 行且 2 列** 才视为有效表；  
   - 支持同一条消息内**多张表**（循环 `extractEmbeddedPipeTable`）。  
3. **单元格内换行**：`normalizeTableCellBrTags` 把 `<br>` 转为换行展示。

### 5.3 用户框选 + 解析为矩阵（「Markdown 变表格」的数据侧）

**`parseSelectionToRows(text)`** 将选中文本变为 `string[][]`，顺序为：

1. 若多行含 `|`，按 Markdown 管道行解析（跳过分隔行）。  
2. 否则若 Tab 密集（约 ≥45% 行含 `\t`），按 TSV。  
3. 否则若每行逗号数量一致，按 CSV（**`simpleCsvSplitLine`** 支持双引号转义）。  
4. 否则每行作为单列。

**`padRowsToMatrix`** 将各行补齐为同列数矩形。

### 5.4 选区右键菜单中的表格动作

- **导出 CSV**：`exportRowsAsCsv` + UTF-8 BOM。  
- **导出 xlsx**：动态 `import('xlsx')`，失败时提示改 CSV。  
- **插入表格预览到聊天**：`handleInsertTablePreviewInChat` — 新增一条 `assistant` 消息，`tableRows` 为解析结果，说明文字固定为预览提示。

### 5.5 流式与性能

- **`CHAT_STREAM_UI_INTERVAL_MS`（280ms）**：限制流式 `setState` 频率，避免整表每 token 重绘导致 OOM。  
- **`CHAT_MESSAGES_SOFT_CAP`（60 条）**、**`CHAT_MESSAGE_CONTENT_MAX_CHARS`（120000）**：软上限；超长内容 **`clipMessageContent`** 截断展示。

### 5.6 多模型路由（概要）

- **Qwen**：同源 `axios` `/api/v1/chat/completions`，带超时。  
- **Gemini / Claude**：AITop `.../api/v1/llm/see`，带首包超时与流式空闲超时；图片以 markdown 形式拼进消息体（代码注释所述）。

---

## 6. 右键菜单、添加节点菜单、剪贴板

均在 **`FlowEditor.tsx`**。

### 6.1 画布空白处右键 `onPaneContextMenu`

- 若事件目标在 **`.react-flow__node`** 内：**不处理**（交给节点右键）。  
- `preventDefault()` 禁用浏览器菜单。  
- **若当前有选中节点**：在指针处打开 **`nodeContextMenu`**（与点在节点上同一套菜单）。  
- **若无选中节点**：打开 **`menu`**（ADD NODE），带 `flowPosition` 与 **`showPaste: true`**。

### 6.2 节点上右键 `onNodeContextMenu`

- 阻止冒泡，避免触发 pane 菜单。  
- **多选规则**：若已有选中且当前节点未选中，则把当前节点**并入**选中；若无选中则只选中当前节点。  
- 打开 **`nodeContextMenu`**。

### 6.3 `nodeContextMenu` 菜单项

- **复制节点**：`copySelectedNodesToClipboard`（等同 Ctrl+C；无 HTTPS 时仍可用页内 ref 粘贴）。  
- **创建背景框**：`handleCreateBackdropFromSelection` — 对当前选中（排除 BACKDROP、CHAIN_FOLDER）算外包矩形 + padding，新建 `BACKDROP` 并写入 `backdropChildIds`。  
- **导出节点**：`handleExportNodes` — 对齐顶栏文件夹「打开工程」：点击后立刻系统对话框。HTTPS/localhost → `showSaveFilePicker`；内网 `http://IP` → `confirm` 后再 `<a download>`（无静默下载）。`canUseSaveFilePicker` = API ∧ `isSecureContext`。

### 6.4 `menu`（ADD NODE）

- **粘贴节点**：`pasteNodesFromClipboard`。  
- **Image Node**：`addNodeFromMenu(NodeType.PROCESSOR, 'GenAI Node')`。

### 6.5 剪贴板协议 `FlowgenClipboardPayload`

- 顶层标记 **`__flowgenFlowClipboard: true`** + `version`。  
- `nodes`：含 `id/type/position/data/width/height/style`。  
- `edges`：含 `id/source/target/handles/animated/style/type`。  
- **`copySelectedNodesToClipboard`**：`JSON.stringify` 全量 `data`（**含大图 base64**），写入 `navigator.clipboard.writeText` 失败时仍写入 **`internalFlowNodeClipboardRef`** 供同页粘贴。  
- **`pasteNodesFromClipboard`**：先读系统剪贴板，失败则用内部 ref；**新 id 映射**；粘贴中心对齐视口；**条数上限** `FLOW_MAX_PERSISTED_NODES`；`stripPastedFlowNodeHistory` 清理历史；**BACKDROP** 子 id 同步替换。

---

## 7. 排列与链折叠（INPUT / MOV 网格）

**函数：`arrangeNodesByType(type)`**（`FlowEditor.tsx`）。

### 7.1 双态 Ref（每次执行后翻转）

- **`inputArrangeFoldOnNextClickRef`**：`true` → 本次 INPUT/PROCESSOR **排序并打组**；`false` → **同规则排序后按单点「下游」逻辑依次展开**。  
- **`movArrangeFoldOnNextClickRef`**：`true` → 末端 OUTPUT/MOV **打组上游**；`false` → **全部展开**（逐个 `applyChainFolderExpandLayout`）。

工具栏按钮 title 内有完整中文说明（搜索 `arrangeNodesByType(NodeType.INPUT)` 附近）。

### 7.2 排序键

同一类型目标节点集合排序：**显示名**（`customName` 优先否则 `label`，数字自然序）→ **分镜索引** `getStoryboardIndex` → **画布 y**。

### 7.3 MOV 第一次（打组）如何选「末端」

在可见边图上统计入度/出度：优先 **无出边** 的 OUTPUT/MOV；若无则退 **有入边** 的 OUTPUT/MOV；再退全部 OUTPUT/MOV。

### 7.4 打组 / 展开与懒加载

- **`hiddenBaselineBeforeArrange`**：记录排序前各节点 `hidden`，用于第二次「全部展开」时识别 **由隐变显** 的节点 id。  
- 若批量展开揭示 id 数 **≥ `FLOW_LAZY_HYDRATION_NODE_THRESHOLD`（22）**，走 **`hydrateGraphWithLazyReveal`**：先保持大量节点 `hidden`，按批（每批 **`FLOW_LAZY_HYDRATION_REVEAL_BATCH`（12）**）`requestAnimationFrame` 揭示，降低 React Flow 同时 mount 压力。

---

## 8. 自动布局（L 键 / 工具栏）

**`handleAutoLayoutAll`**：**toggle** 行为。

- **第一次**：深拷贝当前图到 **`autoLayoutSnapshotRef`**；`stripChainFolderNodesAndUnhide` + `clearEdgesHiddenFlag`；暂时移出 **BACKDROP**；按 DAG 算层级（INPUT/PROCESSOR/无父节点为根），根层按显示名与分镜排序；按 `LAYER_WIDTH` 等横向分层纵向排布；最后再考虑把 backdrop 叠回（代码后续段落）。  
- **第二次**：从 **`autoLayoutSnapshotRef`** 恢复节点与边并 `fitView`，清空 ref。

键盘 **`L`**（非输入焦点时）触发；工具栏有对应按钮。

键盘 **`F`**：`fitView` 仅框入**当前选中**节点。

---

## 9. 保存、自动存盘、导入、配额

### 9.1 `localStorage` 自动保存

- **Key**：`flowgen-project-data`（`STORAGE_KEY`）。  
- **内容**：**`buildPersistSnapshot`** → `nodes` + `edges` + `storyboardImages` + `savedAt`（**已 sanitize、已 cap 缩略、已截断数量**）。  
- **防抖**：依赖 `nodes/edges/storyboardImages` 的 `useEffect` 内 **`3 * 60 * 1000` ms** 定时器；到期后在 **`requestIdleCallback`**（或 `setTimeout(0)`）里执行写入，减轻主线程卡顿。  
- **挂载加载**：读 key → `mergeLegacyChainFolderNodesIntoRoots` → `capNodeGeneratedThumbnailsDeep` → `normalizePersistedInputRowsWithFolders`；若节点数多 → **`hydrateGraphWithLazyReveal`**。  
- **QuotaExceededError**：可弹确认清理当前 key 后重试写入；并有定时 **`STORAGE_HEALTH_REFRESH_MS`** 等健康提示逻辑（见 `STORAGE_WARN_MB` 常量附近）。

### 9.2 手动「保存工程」`handleSaveProject`

- 若有节点 **`status === 'running'`**，**禁止保存**并提示等待完成。  
- 写入 JSON：`nodes: getNodes()`、`edges: getEdges()`、`storyboardImages` — **注意：此处未调用 `buildPersistSnapshot`**，文件备份可能含 **`blob:`** 等浏览器临时 URL，换机/久存可能失效；**可靠归档建议依赖自动存盘逻辑同款清洗**（若产品要统一，可后续改为统一 `buildPersistSnapshot`）。

### 9.3 顶栏「打开工程」`handleLoadProject`

- **合并导入**：不覆盖当前图；冲突 **节点 id** 重新 `getId()` 并维护 **`nodeIdMap`** 重写边 `source`/`target`；导入节点整体 **x 方向偏移** 到当前最大 x 右侧。  
- 边指向不存在节点则丢弃。  
- **`mergeLegacyChainFolderNodesIntoRoots`** + **`normalizePersistedInputRowsWithFolders`**。  
- 若本次导入节点数 **≥ 22**：`hydrateGraphWithLazyReveal`。  
- **故事板图片**：合并去重追加。  
- 成功后 **延迟 `localStorage.setItem`** 同步（带 quota 降级：可尝试去掉部分 data URL 的 `imagePreview`/`referenceImages` 再写）。

### 9.4 `flowgen:persist-request` 自定义事件

部分异步写回（如视频 poster）后派发，监听里 **约 200ms** 后再 `buildPersistSnapshot` 写入，避免与 React 状态提交竞态。

---

## 10. 键盘快捷键

监听在 **`window` capture 阶段**（`FlowEditor.tsx` `useEffect`）。

| 按键 | 条件 | 行为 |
|------|------|------|
| `Escape` | — | 中断运行 ref、`previewNode` 关闭、视频播放器关闭、`isGlobalRunning` false |
| `Ctrl/Cmd + Z` | 非输入焦点 | 撤销 |
| `Ctrl/Cmd + Shift + Z` / `Ctrl/Cmd + Y` | 非输入焦点 | 重做 |
| `Ctrl/Cmd + C` | 非输入焦点且**无**非空文本选区且存在选中节点 | 复制节点 JSON |
| `Ctrl/Cmd + C` | 有文本选区（如 Node Details 内 div） | **不劫持**，交给系统复制 |
| `Ctrl/Cmd + V` | 非输入焦点 | 粘贴节点 |
| `L` | 非输入焦点 | 自动布局 toggle |
| `F` | 非输入焦点且有选中 | `fitView` 选中集 |

---

## 11. 其它画布交互

- **中键拖媒体**：`FLOWGEN_MEDIA_URL_DROP`（`utils/middleButtonMediaDrag.ts`），松手在另一节点主预览区可写入 `imagePreview`（图可走 `compressImageForPreview`），并触发持久化请求。  
- **删除**：React Flow `deleteKeyCode`：`Backspace` / `Delete`。  
- **框选模式**：`selectionOnDrag` 与 `panOnDrag` 互斥（`isSelectionMode`）。  
- **多选修饰键**：`multiSelectionKeyCode`：`Control` / `Meta` / `Shift`。

---

## 12. 模型与 AiTop（`services/aitop.ts`）

- 上传、创建任务、轮询 `getTaskStatus`、各模型封装函数。  
- **`logPreloadJson`**：请求前打印 JSON（浏览器默认开启；`window.__FLOWGEN_DEBUG_PRELOAD__ === false` 关闭）。详见前文版本说明。

---

## 13. 防护常量（`utils/flowLimits.ts`）

| 常量 | 值 | 含义 |
|------|-----|------|
| `FLOW_MAX_PERSISTED_NODES` | 500 | 写入快照的最大节点数 |
| `FLOW_MAX_PERSISTED_EDGES` | 4000 | 最大边数 |
| `FLOW_MAX_THUMBNAILS_PER_NODE` | 48 | 单节点 `generatedThumbnails` 保留条数 |
| `FLOW_MAX_UNDO_HISTORY` | 28 | 撤销栈深度（每步整图深拷贝） |

另：`FlowEditor` 内 **`FLOW_LAZY_HYDRATION_NODE_THRESHOLD = 22`**、**`FLOW_LAZY_HYDRATION_REVEAL_BATCH = 12`** 控制懒揭示。

---

## 14. 相关文档索引

| 文档 | 内容 |
|------|------|
| `docs/IMPLEMENTATION_NOTES_2026-04.md` | Node Details 展示规则、URL 稳定、播放/下载、各模型边界修复 |
| `docs/BACKDROP_NODE.md` | 背景框节点 |

---

## 15. Seedance 2.0（侧栏、运行、API）

侧栏与运行逻辑以 **`components/NodeInspector.tsx`**、**`components/FlowEditor.tsx`**（`handleNodeRun` 内 Seedance 分支）、**`services/aitop.ts`**（`createDoubaoSeedanceVideoTask`）为准。时长与比例工具见 **`utils/seedanceDuration.ts`**、**`utils/seedanceAspectRatio.ts`**。

### 15.1 产品内模型名 → 豆包网关 `model`

| `selectedModel`（UI） | `DoubaoSeedanceVideoTaskOptions.model` |
|------------------------|----------------------------------------|
| `seedance2.0 (急速版)` | `DOUBAO_SEEDANCE_2_0_FAST` |
| `seedance2.0 (高质量版)` | `DOUBAO_SEEDANCE_2_0` |

（Seedance 1.5 为 `DOUBAO_SEEDANCE_1_5_PRO`，与 2.0 共用同一段请求组装，但 1.5 仅 **图生** 路径。）

### 15.2 三种生成模式（`seedanceGenerationMode`）

仅 **2.0** 使用三态；值存于 `NodeData.seedanceGenerationMode`：`text` | `image` | `reference`（侧栏文案：**文生视频 / 图生视频 / 参考生视频**）。

- **`seedanceTabConfigs`**：`{ text?, image?, reference? }` 各子对象保存该 tab 下的 `prompt`、`negativePrompt`；`image` 还存首尾帧字段；`reference` 存 `referenceImages` / `referenceMovs` / `referenceAudios`。切换 tab 时 **`switchSeedance20Tab`** 把当前 tab 写入快照再切到目标 tab 的快照，避免混用。  
  - 切到 **图生**：清空参考类数组，**`seedanceAspectRatio` 置 `自动匹配`**（比例由首帧推断）。  
  - 切到 **文生 / 参考**：清空首尾帧 URL/图；若比例仍为「自动匹配」则默认 **`1:1`**（代码显式写入）。

### 15.3 侧栏字段（`NodeData` 与 Inspector 行为摘要）

| 字段 | 含义 |
|------|------|
| `seedanceResolution` | `480p` / `720p` / `1080p`。**1080p 仅「高质量版」**：急速版或 1.5 若持久化里误带 `1080p`，Inspector 的 `useEffect` 会 **自动降为 `720p`**。 |
| `seedanceAspectRatio` | 文生/参考：具体比例或历史「自动匹配」经 `normalizeSeedanceAspectForTextRef` 规范化；图生模式运行侧常按 **首帧算比例**（面板为「自动匹配」时）。 |
| `seedanceDuration` | 标签字符串 **`4s`–`15s`**（与 1.5 共用滑杆语义），运行前 **`parseSeedanceDurationSeconds`** 转成秒数传给 API。 |
| `seedanceGenerateAudio` | 是否生成音频（1.5 常用；2.0 仍透传 `generateAudio` 字段）。 |
| `seedanceFixedCamera` | **1.5** 固定镜头 → API `parameters.camerafixed`；**2.0** 在运行分支里 **`camerafixed` 固定传 `false`**。 |
| `seedanceReferenceWebSearch` | 参考生相关开关（与节点数据一致时写入快照/展示）。 |
| `prompt` / `negativePrompt` | 2.0 下编辑会同步写入 **当前 tab** 对应的 `seedanceTabConfigs[mode]`，保证切 tab 不丢文案。 |
| 参考生 **`referenceImages` / `referenceMovs` / `referenceAudios`** | 参考视频列表项为 `{ url, posterDataUrl? }`；音频为 `{ url }`。中键拖入 **`seedance-reference`** 落区时由专用 ref 处理。 |

**主预览 `imagePreview` 自动装槽**（`NodeInspector` `useEffect`）：在 **2.0 + 参考模式** 下，若参考图为空且主预览是 **图**，则把主图放进 **`referenceImages[0]`**；若主预览是 **视频** 且参考视频为空，则 **`referenceMovs = [{ url: main }]`**。仅在目标槽为空时补齐，不覆盖用户已填。

### 15.4 运行分支要点（`FlowEditor` → `createDoubaoSeedanceVideoTask`）

统一入口 **`POST .../api/v1/video/doubao`**，body 含 `model`、`generateNum`、`prompt`、`parameters: { resolution, ratio, duration, seed, camerafixed }`，以及按模式附加的 `startImage`/`endImage`、`negativePrompt`、`referenceImages`/`referenceVideos`/`referenceAudios`、`generateAudio`。

1. **文生（`text`）**  
   - **不传** `startImage`/`endImage`（与脚本 `doubao_video_test.py` 一致）。  
   - `ratio` 来自面板比例（「自动匹配」经 `normalizeSeedanceAspectForTextRef`）或默认 **`16:9`**。

2. **图生（`image`）**  
   - 首帧必填：来自 `firstFrameImage*`、`generationParams`、非视频的 `imagePreview`、`referenceImages` 等 **`pickFrameLikeImage`** 链；缺首帧则 **抛错**。  
   - 若 **首尾帧同时存在**，会检测两帧 **宽高比是否一致**，不一致则 **抛错**。  
   - `data:` / `blob:` 经 **`uploadImage`**（或内联 `base64ToUrl`）换成 COS **http** URL；并写回节点 **`firstFrameImageUrl`/`lastFrameImageUrl`** 与 **`seedanceImageRunSnapshot`**，供 Node Details 与后续运行一致。  
   - 图生模式下 API **`ratio` 使用「自动匹配」**：由首帧 **`getImageAspectRatioFromSource`** 推断标签。

3. **参考生（`reference`，仅 2.0）**  
   - **清空** `startImage`/`endImage` 路径上的首尾帧，仅走 **`referenceImages` / `referenceVideos` / `referenceAudios`**。  
   - 列表项中的 `blob:`/`data:` 分别 **`uploadImage` / `uploadVideo` / `uploadAudio`**。  
   - **主图**（非视频 `imagePreview`）：若是 COS 直链则沿用，否则 **一律再上传** 到 AiTop，得到 **`canonicalMainImageUrl`**；对 **INPUT/PROCESSOR** 还会把 **`imagePreview`** 与首帧槽 **patch 成该 URL**，避免 Details 仍显示 blob。  
   - **`seedanceReferenceSnapshot`**：保存 **上传后的** URL 与 poster，合并进 **`generationParams`** 供 Node Details。  
   - 用 **第一条参考视频** 的 metadata：**`detectVideoRatioFromUrl`** 可 **覆盖 `ratio`**（`16:9`/`9:16`）；**时长须在 2–15 秒**，否则抛错。  
   - **API 约束**（`aitop.ts`）：若传了 **`referenceAudios`** 则 **必须同时有 `referenceVideos`**，否则接口层 **直接抛错**。

4. **分辨率**  
   - 用户选 `1080p` 时：若当前模型 **不是**「高质量版」，实际请求 **`seedanceApiResolution` 降为 `720p`**（网关/产品限制）。

5. **轮询**（`getTaskStatus`）  
   - **急速版**：约 **720 × 5s**（约 1 小时窗口）。  
   - **高质量版**：约 **3600 × 10s**（约 10 小时窗口）。  
   - 其它（含 1.5）：约 **240 × 5s**。  
   - 高质量版对连续状态查询失败容忍 **18 次**，其余 **10 次**，超过再判死。

6. **提示词占位符**  
   - 组装 payload 前用 **`seedanceDataForPromptExpand`**（含本次首尾帧或参考列表）+ **`buildPromptMediaRefContextFromNode`** + **`resolvePromptPlaceholders`**，解析 **`@图片n` / `@视频n`** 等（与 `promptMediaRefs` 一致）。

### 15.5 Node Details 与 1.5 的差异（摘要）

- Details 摘要行：2.0 展示 **「生成模式：文生视频 | 图生视频 | 参考生视频」**；**1.5 不展示该行**（`formatSeedanceGenerationModeForDetails` 对 `seedance1.5-pro` 返回空）。  
- 快照字段与 `GenerationParams` 中的 **`seedanceResolution`**、**`seedanceAspectRatio`**、**`seedanceDuration`**、**`seedanceGenerationMode`**、**`referenceImages` / `referenceMovs` / `referenceAudios`** 等与运行写入逻辑对齐（详见 §3 与 `IMPLEMENTATION_NOTES`）。

---

*文档生成策略：以仓库当前实现为准；若行为变更，请同步更新本节与 `IMPLEMENTATION_NOTES` / `BACKDROP_NODE` 分工，避免三处重复矛盾。*
