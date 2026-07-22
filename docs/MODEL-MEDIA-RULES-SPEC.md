# 全模型媒体规则规格（面板 · @ · API · Node Details · 缩略图）

> **用途：** 对照你之前定的产品规则，核对代码实现是否一致；确认后可据此加「契约测试」。  
> **代码真源：** `promptMediaRefs.ts` · `referencedMediaRun.ts` · `panelRefPersistence.ts` · `nodeDetailsPreview.ts` · `FlowEditor` run/spawn · `NodeInspector` · `CustomNode`  
> **关联：** [SKILL 决策树](../.cursor/skills/flowgen-ai-studio/SKILL.md) · [LLM/Chat 规则](./LLM-CHAT-RULES-SPEC.md) · [最终验收清单](./最终验收-NodeDetails与面板.md) · [CORE_APPLICATION_LOGIC](./CORE_APPLICATION_LOGIC.md)

---

## 0. 总架构：三态分离（所有模型的铁律）

| 态 | 存哪 | 谁读 | 谁写 |
|----|------|------|------|
| **面板态** | `NodeData` 顶层、`seedanceTabConfigs`、`klingOmniTabConfigs` 等 | NodeInspector 编辑、@ 下拉（仅已有槽） | 用户拖入/上传；运行后 **prune/备份** 写回源节点 |
| **运行快照** | `generationParams`（spawn 时写入 OUTPUT/MOV） | Node Details（输出节点）、历史追溯 | `FlowEditor` run 结束 + spawn 一次性写入 |
| **画布预览** | `imagePreview`、`videoPosterDataUrl` | CustomNode 主区 | 运行结果 URL；未 @主图 时可能改为首个 @ 参考 |

**禁止：**

- OUTPUT/MOV 的 Node Details **不得**用当前 Inspector 默认值冒充本次 API 入参
- OUTPUT/MOV 侧栏 **不得**把 `generationParams.referenceImages` / 首尾帧 URL 灌回参考格（除非 prompt 含 `@图片n` / `@资产:`）
- 仅 `@主图` 时：API 可含主图 URL，但面板参考格应为空；Details 标签应为 **「主图」** 而非「图片1」

---

## 1. 通用规则

### 1.1 拖图 / 拖视频进面板

| 规则 | 说明 |
|------|------|
| 拖入只填**目标空槽** | 不覆盖已有槽；索引与 `@图片n` 对齐 |
| 中键拖画布/资产库 | 与本地文件拖入同等写入对应 drop zone |
| 主图格独立 | `imagePreview` + 可选「主图」格；**不**与 `@图片1` 混槽（Seedance 参考生 / Omni multi 等） |
| 视频拖入 | 进 `referenceMovs` 或 Omni 视频槽；参考图区不放视频 URL |
| 面板换图优先 | 槽内已是有效 http(s) 用户新图 → **以面板为准**；blob/误拖 aitop COS → 可回退资产库 |
| 运行后槽位 | **保留全部已拖入槽**；仅将 @ 到的槽 URL 更新为上传结果；**未 @ 的素材仍在原索引** |

### 1.2 创意描述与 `@`

| 环节 | 规则 |
|------|------|
| **@ 下拉** | 只列**当前面板已有**素材（含运行后新拖入）；禁止合并全资产库 |
| **底栏 ↔ @ token** | 资产名 → `@资产:名`；泛称 → `@主图` / `@首帧图` / `@尾帧图` / `@图片n` |
| **粘贴** | 纯文本粘贴，**不**自动扫描/规范化 |
| **扫描 @素材** | 仅按钮触发 `buildScanPromptAndPanelPatch` |
| **Tab 文案** | Omni / Seedance 各 tab 独立 prompt 字段；读写走 `getNodeInspectorPromptText` / `buildNodePromptUpdatePatch` |
| **Plan 收集** | `collectReferencedMediaFromPrompt`：仅 prompt 里**实际出现**的 token；顺序=出现顺序 |
| **未 @ 不进 API** | 面板有图但 prompt 未 @ → **不上传、不进 referenceImages** |

### 1.3 发给模型的规则（运行链路）

```
创意描述 @token
  → collectReferencedMediaFromPrompt (plan)
  → uploadReferencedImageEntry / ensureAitopCosVideoUrl …
  → 各模型 create*Task (aitop.ts)
  → resolvePromptPlaceholders 展开为「对应本请求第 N 项…」
```

| 规则 | 说明 |
|------|------|
| Plan 与上传一一对应 | `uploadedByToken`；`assertDistinctUploadedRefsForPlan` 防重复 |
| 首尾帧 API 槽 | `refFrameIndex` + `@首帧图`/`@尾帧图`；`assignStartEndUrlsFromImagePlan` |
| Seedance 参考生 API | `buildSeedanceReferenceImagesApiPayload`：含 `@主图` 时也写入 referenceImages |
| 标签进快照 | `referenceImageLabels` 与 API URL 同序（如 `@主图` → 「主图」） |
| 运行快照 | 异步完成时用 `runStartDataSnapshot`，避免面板被用户改掉导致 gp 失真 |

### 1.4 Node Details

| 节点类型 | 读什么 |
|----------|--------|
| **上游 INPUT/PROCESSOR** | 当前 **tab** 面板 + prompt；参考图来自面板槽 + `@主图` 时的主预览 |
| **OUTPUT/MOV** | **仅 `generationParams`**（model / prompt / referenceImages / referenceImageLabels / 首尾帧 / movs / audios） |
| **旧节点无 gp** | 降级展示；需重新运行才有完整快照 |

**参考图展示：**

- 剔除视频 URL、与 referenceMovs 重复的 poster
- Seedance 参考生 OUTPUT：`buildSeedanceReferenceDetailsFromSnapshot`（gp 顺序 + 标签）
- Omni instruction/video：参考视频区不展示「本次生成结果视频」

**Generated Outputs 历史 ← →（`skill.md` §5.12·S级）：**

- 从节点历史条打开 Details 后，左右键切换**整份面板**（预览 + Prompt/refs/Used Parameters）
- 必须用 `buildNodeDetailsPreviewFromGeneratedThumb`（该条 `thumb.generationParams`）；`previewActiveThumbId` 有值时禁止 live 节点 sync 覆盖
- **禁止**只换左侧媒体 URL；必跑 `src/test/utils/generatedThumbKeyboardNav.test.ts`

### 1.5 缩略图与主预览

| 项 | 规则 |
|----|------|
| 主区 | 图用 `imagePreview`；视频用 `videoPosterDataUrl` 作封面 |
| `generatedThumbnails` | 每条可带 `generationParams`；上限 48 条/节点 |
| 持久化 | 去掉 `blob:`；有 https 的 thumb 可剥离冗余 poster |
| 运行后主图 | 未 `@主图` → `panelMainSlotVisible=false` + `panelMainImageUrl` 备份 |
| 编辑态主图格 | `shouldShowPanelMainImageSlot`：有 `@图片n`/`@资产` 但无 `@主图` → **隐藏主图格**；纯文本 prompt → 仍展示 |
| 重新选中 | **仅**仍 `@主图`（或无图片类 `@`）时 restore 主图格 |
| **主图 URL = 参考槽 URL（§5.11.2）** | 展示：仅主图格**实际展示**时对参考槽去重；idle sync 用 `shouldDedupePanelRefsAgainstMainForSync`（overlap 时不清空槽） |
| OUTPUT/MOV spawn | 视频结果写 `imagePreview`；面板首尾帧格清空（Details 读 gp） |

---

## 2. 分模型面板槽位与 @ 矩阵

| 模型 | 面板结构 | 主要 @ token | API 参考/帧 |
|------|----------|--------------|-------------|
| **Nano Banana 2.0** | 主图格 + 参考格 | `@主图` `@图片n` `@资产:` | `referenceImages` |
| **image 2** | 主图格 + 最多 3 参考（共 4 格） | 同上 | `image[]` 最多 4 |
| **可灵 2.5 Turbo** | 首帧 + 尾帧（+ 主体库） | `@首帧图` `@尾帧图` `@主图` | 首尾帧 URL |
| **vidu 2.0** | 首帧 + 尾帧 | `@首帧图` `@尾帧图` | 首尾帧 |
| **seedance1.5-pro** | 首帧 + 尾帧 | `@首帧图` `@尾帧图` | 首尾帧 |
| **seedance2.0 文生** | 无参考槽 | — | 纯 prompt |
| **seedance2.0 图生** | 首帧 + 尾帧(选填) | `@首帧图` `@尾帧图` | start/end image |
| **seedance2.0 参考生** | **主图格** + 图片/视频/音频参考区 | `@主图` `@图片n` `@视频n` `@音频n` | referenceImages / videos / audios；**仅 @主图 时面板参考格为空** |
| **即梦 3.0 Pro** | 图生：仅首帧槽 | `@首帧图` `@主图` | 单图图生 |
| **可灵 3.0 Omni multi** | **主图格** + multi 参考数组 | `@主图` `@图片n` | multi 参考 API |
| **Omni instruction** | 图参考 + **视频槽** | `@图片n` `@视频n` | 图 + referenceMovs |
| **Omni video** | 图参考 + 视频 | `@图片n` | 同上 |
| **Omni frames** | 首帧 + 尾帧 | `@首帧图` `@尾帧图` | 首尾帧 |

---

## 3. OUTPUT/MOV 专项（近期收敛规则）

| 场景 | 面板 | Node Details |
|------|------|--------------|
| Seedance 参考生 仅 `@主图` | 参考格空；主图在 imagePreview/主图格 | gp.referenceImages 1 张，标签 **主图** |
| 可灵/vidu 等首尾帧视频输出 | 首/尾帧格空 | gp 含 firstFrameImageUrl 等 |
| **任何 OUTPUT/MOV（含 `@图片n`）** | **spawn 时**面板参考格/首尾帧格/创意描述为空；**用户手动拖入后可编辑并持久化** | gp 含完整快照 |
| 工程加载/刷新 | 不再清空用户手动添加的面板参考/首尾帧（spawn 已保证不继承） | 不变（仍读 gp） |

---

## 4. 现有自动化覆盖

| 套件 | 覆盖什么 | 命令 |
|------|----------|------|
| **test:gate** | vitest + node-details + panel-refs + **panel-main-slot** + **batch-run-schedule** + model-contract + i2v + first-frame | `npm run test:gate` |
| **test:panel-main-slot** | 全模型主图格 × 创意描述（`PANEL_MAIN_IMAGE_SLOT_SCENARIOS`） | 已并入 gate |
| **test:20260709-*-main-dup-ref-panel** | 主图=参考槽同 URL：展示不丢图 + sync 不清空（`skill.md` **§5.11.2**） | 已并入 gate 第 34–35 步 |
| **vitest generatedThumbKeyboardNav** | Node Details ←→ 整份 Generated Outputs 历史（`skill.md` **§5.12**） | 已并入 gate vitest 步 |
| **test:model-contract** | 表驱动：各模型面板→@→plan→API→gp→Details→OUTPUT sanitize | `npm run test:model-contract` |
| **test:panel-partial-ref** | **全模型各 tab：面板保留未@槽 + Details 仅@引用 + 运行后新图可@** | 已并入 gate |
| **test:node-details** | 各模型 Details 构建 | 140 项 |
| **test:panel-models** | 各模型面板统一矩阵 | `test:panel-models` |
| **test:panel-swap-all** | 换图不恢复旧 @资产 | 44 项 |
| **test:i2v-pipeline** | 图生视频链路 @主图 | 101 项 |
| **test:final / delivery-all** | 全模型终检 | 发版用 |
| **CI** | push/PR 跑 test:gate | `.github/workflows/test-gate.yml` |

**仍未自动化：** 真实 AITOP 上传/生成、浏览器拖入手感、全模型拖视频逐格 UI。

---

## 5. 建议：是否加「完整契约测试」？

**结论：方案可行，建议分层，不要一个脚本包打天下。**

### 推荐三层

```
日常改代码     → npm run test:gate          （~20s，已启用）
改 @/面板/API  → npm run test:model-contract （已启用，~1–2min，见下）
发版 / 大重构   → npm run test:delivery-all  （已有，~10min+）
```

### 新建 `test:model-contract` 应断言什么（纯模拟、不调 API）

**已实现：** `scripts/model-media-contract-test.ts` · `npm run test:model-contract`

对每个模型 **1～2 个代表用例**，固定断言：

1. **面板槽字段** — 拖入后 URL 落在哪个数组/字段  
2. **@ 下拉项** — token 与底栏 caption 一致  
3. **plan** — `collectReferencedMediaFromPrompt` 张数/顺序  
4. **API payload** — 上传后 `referenceImages` / 首尾帧 / movs 形状  
5. **spawn gp** — OUTPUT 节点 `generationParams` 关键字段  
6. **Details** — `buildNodeDetails*` 标签与张数  
7. **OUTPUT 面板 sanitize** — 参考格/首尾帧格是否为空（按 §3）  

实现方式：抽 `scripts/model-media-contract-test.ts`，复用 `simNode` + 现有 builder，**表驱动**（一行模型一条期望 JSON）。

### 不建议

- 一个 2000 行的「超级测试」替代现有 panel-refs / node-details（难维护）  
- 用 E2E 浏览器测所有模型拖图（慢、脆）  

### 与你之前规则的对照要点

**已确认（2026-06）：** 以下与产品规则一致，代码与规格对齐。

- [x] 仅 `@主图` 时 API 有图、面板参考格为空  
- [x] `@图片n` 才持久化面板参考格到 OUTPUT  
- [x] Node Details 输出节点只信 gp  
- [x] @ 下拉不出现未拖入的素材  
- [x] 面板换图后运行不恢复旧资产库图  
- [x] 未 @主图 但有 @图片n：编辑态隐藏主图格；运行后 `panelMainSlotVisible=false`
- [x] 未 @主图 时重新选中**不**恢复主图格（仍 @主图 时才 restore）  
- [x] Seedance 参考生主图只在主图格 + `@主图`，不占「图片1」  

契约测试 `test:model-contract` 对上述关键项有代表用例覆盖（尤其仅 `@主图`、OUTPUT sanitize、@ 下拉空槽）。

---

## 6. 状态

1. ~~你审阅本文，标注「与之前不一致」的条目~~ **已确认一致**  
2. ~~按 §5 实现 `scripts/model-media-contract-test.ts` + `npm run test:model-contract`~~ **已完成**  
3. **日常：** 改代码跑 `test:gate`；改 @/面板/API 加跑 `test:model-contract`；发版跑 `test:delivery-all`

---

*文档版本：2026-06 · 与当前 main 工作区代码同步整理*
