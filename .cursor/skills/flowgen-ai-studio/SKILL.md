---
name: flowgen-ai-studio
description: >-
  FlowGen AI Studio 功能架构、修改禁区与回归测试清单。修改 FlowEditor、NodeInspector、
  模型运行、@引用、Node Details、下载/代理、分镜、Chat、项目持久化或 server.js 前必读，
  避免破坏既有逻辑。
---

# FlowGen AI Studio — 项目 Skill

## 何时使用

- 修改画布、属性面板、模型运行、Node Details、下载、分镜、Chat、认证、服务端路由
- 用户报告「改 A 坏了 B」或需要理解数据流
- 提交前跑回归测试

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
**开发：** `npm run dev:full` = Vite + `server/flowgenApiOnly.mjs`

---

## 修改前检查清单

```
- [ ] 明确改的是「面板态」还是「运行快照 generationParams」还是「Node Details 展示」
- [ ] 是否影响 @引用 / 上传 plan / 参考槽顺序
- [ ] 是否影响 blob/data/COS/代理 URL 优先级
- [ ] 是否需在 server.js 与 vite.config.ts 同步（proxy、download-task-file）
- [ ] 是否需在 utils/taskStatusImageUrl.ts 与 utils/taskStatusMediaUrl.mjs 同步
- [ ] 改完跑下方「必跑测试」
- [ ] 涉及 UI 则 npm run build + npm start
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

### 2. @ 引用链路

```
创意描述 @token → promptMediaRefs.ts 解析
  → referencedMediaRun.ts 生成上传 plan
  → aitop.ts 创建任务
  → taskStatus*Url.ts 取结果 URL
  → spawn 输出节点 + 写 generationParams
```

**规则：** 展开后不得留裸 `@资产:`；`@图片n` 与 `@资产:名` 去重；模型切换时面板隔离（`modelSwitchPanelIsolation.ts`）。

### 3. 媒体 URL 优先级

- 持久化：仅 COS / 资产库 URL / 服务端 node-media（`workspaceMediaPersist.ts`、`persistSanitize.ts`）
- 预览：blob/data 优先于过期 COS（Inspector 首尾帧、`resolveInspectorFramePreviewUrl`）
- 下载：`/download-task-file` 用 `pickMediaResourceUrlFromTaskStatus`；失败或无 taskId 回退 `imagePreview` + `/proxy-file`（**禁止**再对视频无 taskId 硬拦截）
- 下载文件名：`utils/nodeDownloadFilename.ts` → `customName` > 有意义 `imageName` > 非工厂 `label` > URL 段
- 批量下载 / Node Details / 节点卡片 ↓ 三处逻辑应对齐（Details 与批量共用 `downloadNodePreviewMedia`）
- 跨域：CDN 走 `/proxy-file`；AITOP 上传前可能需 `/mirror-media-to-aitop`

### 4. 并发与恢复

- 同一节点禁止重复 run（`FlowEditor.tsx` ~5708）
- 页面 reload 后 `useAiTopRunRecovery` + `runRecovery.ts` 恢复僵尸任务
- 工作区 PUT 带 version，并发冲突需处理

### 5. 计费

进入 workspace 后设置 `setAiTopBillingContext(domainAccount, scoreProjectId)`（`utils/aitopBilling.ts`）。

### 6. 分镜模板

模板节点必须使用项目资产库 URL（`/flowgen-api/.../assets/.../file`），禁止 blob/IndexedDB（`storyboardTableSpawn.ts`）。

### 7. 项目封面与项目级管理权限

| 能力 | 超级管理员 / 管理员 | 项目管理员 | 普通用户 / editor |
|------|---------------------|------------|-------------------|
| 封面上传 | 全部项目 | **仅已分配项目**（members） | 否 |
| 资产库增删改 | 全部项目 | **仅已分配项目** | 只读 |
| Skill 配置 | 全部项目 | **仅已分配项目** | editor 可改 Skill（`canManageProject`） |

- 服务端统一入口：`canManageInAssignedProject(store, user, projectId)`（`permissions.mjs`）
- 封面：`canManageProjectCover`；资产：`canManageProjectAssets`
- **禁止** workspace 保存时自动写封面
- 测试：`npm run test:project-cover`

### 8. 用户管理（Admin）

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
| 画布编辑 | `FlowEditor.tsx`, `components/nodes/CustomNode.tsx` |
| 模型运行 | `FlowEditor.tsx` run 段, `services/aitop.ts` |
| 属性面板 | `NodeInspector.tsx` |
| Node Details | `FlowEditor.tsx` modal, `utils/nodeDetailsPreview.ts` |
| @ 引用 | `utils/promptMediaRefs.ts`, `utils/referencedMediaRun.ts` |
| 下载/代理 | `server.js`, `utils/nodeDownloadFilename.ts`, `FlowEditor.tsx` downloadNodePreviewMedia, `CustomNode.tsx` |
| 分镜 | `utils/storyboardTableSpawn.ts`, `Sidebar.tsx`, `ChatPanel.tsx` |
| Chat/LLM | `ChatPanel.tsx`, `utils/assistantMessageLayout.ts`, `/aitop-llm-see` |
| 资产库 | `ProjectAssetLibrary.tsx`, `server/flowgen/repos/*` |
| AITOP 项目同步 | `server/flowgen/aitopProjectSync.mjs` |
| 用户管理 | `AdminUsersPage.tsx`, `GET/PATCH /users`, `usersRepo.mjs` |

---

## 模型一览

| 显示名 | 运行入口（FlowEditor） | AITOP / 备注 |
|--------|------------------------|--------------|
| Nano Banana 2.0 | nano 分支 | `NANO_BANANA_2_FLASH` |
| image 2 | image2 分支 | 三格参考槽 `image2PanelRefs.ts` |
| 可灵 2.5 Turbo | kling 分支 | 首尾帧 / 参考图 |
| 可灵3.0 Omni | kling omni 分支 | tabs: multi/instruction/video/frames |
| 即梦3.0 Pro | jimeng 分支 | |
| vidu 2.0 | vidu 分支 | |
| seedance1.5-pro | seedance 1.5 | image 模式 |
| seedance2.0 高质量/急速 | seedance 2.0 | text/image/reference tabs |

Omni 进度：run 全程 `setInterval` 伪进度（上传阶段也要动）；poll 内勿重复 bump。

---

## 必跑回归测试

**快速门禁（改面板/引用/Details，~2 分钟）：**

```bash
npm test -- --run
npm run test:node-details      # 140 项
npm run test:panel-refs        # 503 项
npm run test:project-cover     # 封面策略（禁 workspace 自动改封面）
npm run test:delivery          # 115 项
npm run test:inspector-mentions
npm run test:image2-panel-refs
node scripts/storyboard-table-spawn-test.mjs
```

**全模型矩阵：**

```bash
npm run test:final
```

**改 Chat / LLM 展示：**

```bash
npm run test:chat-all
```

**改持久化 / 工作区：**

```bash
node scripts/persist-sanitize-test.mjs
npm run test:workspace-persistence    # 需本地 API
```

**改 server / 下载：**

```bash
npm test -- --run src/test/utils/nodeDownloadFilename.test.ts
# 手动：有/无 taskId 的 OUTPUT/MOV；customName 命名；批量下载与卡片 ↓ 行为一致
```

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

### 加新模型

1. `types.ts` 常量 + `NodeInspector` 选项
2. `FlowEditor.tsx` run 分支 + spawn + poll URL picker
3. `nodeDetailsPreview.ts` 展示分支
4. `scripts/all-models-final-test.ts` 矩阵加 case
5. `services/aitop.ts` API 封装

### 改 Node Details 参考图

- 上游运行节点：读**当前 tab 面板**，勿 dm+dr+gp 三合一
- 下游 OUTPUT：读 `generationParams.referenceImages`；Omni instruction/video tab 空槽时回退 run snapshot URL（`buildOmniInstructionVideoTabDetailsReferencePreview`）

### 改 Inspector 组件

- **禁止**在 `NodeInspector` 内部定义子组件（会导致 img/video remount 闪动）
- 提取到模块级 + `React.memo`；运行中锁定媒体 URL（`useStableInspectorMediaUrl`）

### 改 server 下载

同步三处：`server.js`、`vite.config.ts` dev middleware、`utils/taskStatusMediaUrl.mjs`（与 TS 版 `pickMediaResourceUrlFromTaskStatus` 一致）

**前端下载三入口须一致：**

1. `FlowEditor.tsx` → `downloadNodePreviewMedia`（批量 + Node Details）
2. `CustomNode.tsx` → `handleDownload`（节点卡片 ↓）
3. 文件名统一 `resolveNodeDownloadFilename`（`utils/nodeDownloadFilename.ts`）

**流程：** taskId → `/download-task-file` → 失败或无 taskId → `imagePreview` + proxy → 仍失败提示「链接可能已过期，请重新运行节点后再下载」

### 改用户管理

1. `server/flowgen/routes.mjs` — `GET/PATCH/POST /users`、import 行映射
2. `services/flowgenApi.ts` — `ListUsersParams`、`FlowgenUserListResponse`、`listUsers(params)`
3. `components/flowgen/AdminUsersPage.tsx` — 表格、筛选、分页、表单
4. 新组织字段一律进 `extendedJson`；**勿**要求迁移旧数据，空值 UI 显示 `-`
5. 关联项目仍只读 AITOP；勿恢复手动 `members` 分配 UI

---

## 附加文档

- 详细逻辑与数据流：[reference.md](reference.md)
- 部署（运维文档，非 skill 范围）：见 `docs/` 目录
- 自动构建规则：`.cursor/rules/auto-build-and-run.mdc`
