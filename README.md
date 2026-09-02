# FlowGen AI Studio

基于 React + ReactFlow 的可视化 AI 工作流编辑器：画布编排、多模型视频/图像生成（集成 **AITOP100 API**）、Node Inspector、侧边栏多模型聊天（Gemini / Claude / Qwen）、MySQL 关系型存储与 Windows/Nginx 生产部署。

> 从 GitHub 克隆时，本工程位于仓库子目录 `FlowGen-AI-Studio/flowgen-ai-studio/`。请先 `cd` 到该目录再执行下文命令。仓库级说明见上级 [README](../README.md)。

---

## 项目标准说明书

**修改任何代码前必读 [skill.md](skill.md)** ——项目唯一标准说明书，记录：
- 全部功能用途、入参、出参、调用示例
- 模块稳定性分级（S/A/B/C 级，**S 级禁改业务逻辑/接口/字段语义**）
- 历史迭代优化点与风险说明
- 回归门禁规则

每次新增/修改功能、bug 修复完成后，**必须同步更新 skill.md**（补充变更记录、风险说明）。

---

## 功能概览

- 可视化节点编排（输入 / 处理 / 输出 / 视频节点）
- 多模型生成：可灵（含 Omni 多参考）、即梦、Vidu、Seedance 2.0/2.5（含 4K 版）、Nano Banana 等
- **AITOP100 API 集成**：任务创建、轮询、转码版回写、COS 视频兜底
- **Seedance 模型族**：@元素引用、视频编辑、视频延长、图生视频；2.5 面板已移除联网功能
- **4K H.265 视频播放**：网关转码版自动轮询（等待上限 8 分钟 + 5 次自动重试）+ 同源校验防止"张冠李戴"
- **MOV 中间节点链式生成**：已有成片保留原视频，新产出写入下游节点，避免刷新覆盖
- **Node Inspector**：参考图/视频、参数、生成结果预览
- **聊天面板**：会话历史、联网检索、思考过程卡片、主模型失败自动 fallback（Claude/Gemini → Qwen）
- 项目 / 用户 workspace 隔离，支持 **MySQL relational** 持久化
- 服务端：任务查询、媒体代理、`/flowgen-api` 业务接口

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18、TypeScript、Vite、Tailwind CSS、ReactFlow |
| 后端 | Node.js、Express（`server.js`） |
| 存储 | 本地 JSON 或 MySQL（`server/flowgen/`） |

---

## 目录结构

```text
.
├─ components/       # 页面、节点、ChatPanel、FlowEditor
├─ server/           # FlowGen API、MySQL、路由与存储
├─ services/         # 外部模型 API 封装
├─ utils/            # 缩略图、聊天消息布局、持久化清洗等
├─ docs/             # 部署与实现文档
├─ scripts/          # 构建修复、LLM/聊天回归测试、MySQL 迁移
├─ dist/             # npm run build 产出（勿提交 Git）
├─ data/             # 本地数据目录（勿提交 Git）
├─ server.js         # 生产/本地统一入口
├─ DEPLOYMENT.md     # 通用部署说明
└─ package.json
```

---

## 环境要求

- **Node.js 18+**（Windows Server 2012 R2 生产机建议 **18.x**；新环境可用 20 LTS）
- **npm 9+**
- 生产可选：**MySQL 5.7+**、**Nginx**

复制环境变量模板：

```bash
cp .env.example .env.local
```

在 `.env.local` 中配置 API Key、MySQL、`FLOWGEN_STORAGE` 等（**勿提交** `.env.local`）。

---

## 本地开发

```bash
npm install
npm run dev:full
```

| 命令 | 说明 |
|------|------|
| `npm run dev` | 仅 Vite 前端（需另起 API 时功能不全） |
| `npm run dev:full` | **推荐**：Vite + `3001` 端口 FlowGen API |
| `npm run dev:api` | 仅 API 服务 |

- 前端 dev server：Vite 默认端口（见终端输出）
- API：**http://localhost:3001**

---

## 生产构建与启动

```bash
npm run build
npm start
```

- 构建产物：`dist/`
- 默认访问：**http://localhost:3001**（`PORT` 环境变量可改）

与线上一致验证：

```bash
npm run build && npm start
```

修改前端或 `components/`、`src/` 后需重新 `npm run build`；仅改 `server/` 时重启 Node 即可。

---

## 部署文档

| 文档 | 场景 |
|------|------|
| [docs/单机部署-relational-简明步骤.md](docs/单机部署-relational-简明步骤.md) | MySQL + 单机 Node |
| [docs/Windows-Server-2012R2-Nginx部署说明.md](docs/Windows-Server-2012R2-Nginx部署说明.md) | Win2012 R2、Nginx 蓝绿、离线包 |
| [docs/日常更新速查.md](docs/日常更新速查.md) | 日常覆盖 `dist/`、启停 |
| [DEPLOYMENT.md](DEPLOYMENT.md) | PM2、Nginx、环境变量 |
| [docs/IMPLEMENTATION_NOTES_2026-04.md](docs/IMPLEMENTATION_NOTES_2026-04.md) | 核心实现记录 |

---

## 常用 npm 脚本

| 命令 | 说明 |
|------|------|
| `npm run build` | `tsc` + Vite 生产构建 |
| `npm run start` | 启动 `server.js` |
| `npm run preview` | 预览 `dist/` |
| `npm run test` | Vitest |
| `npm run test:layout` | 聊天消息布局回归 |
| `npm run test:chat-pipeline` | 聊天管线回归 |
| `npm run mysql:init-v2` | 初始化 relational 表结构 |
| `npm run mysql:migrate-relational` | JSON 快照迁移到 MySQL |

---

## 门禁与回归测试

| 命令 | 说明 |
|------|------|
| `npm run test:gate` | **日常门禁**（~20s）：覆盖面板/引用/Details/运行链路，改 A 级模块必跑 |
| `npm run test:transcoded-video-url` | 4K 转码版同源校验（防"张冠李戴"） |
| `npm run test:mov-recovery-keep-original` | MOV 恢复保留原视频防回归 |
| `npm run test:seedance25-api-mock` | Seedance 2.5 taskType/参数合规 |
| `npm run test:delivery-all` | 全量引用交付链路回归（发版前） |
| `npm run test:final` | 引用 + Details + 全模型最终测试 |

**发版门禁**（用户说"发布/发版/上线"时自动执行）：
```bash
npm run test:gate → npm run test:project-json-details → npm run test:delivery-all → npm run build
```

修改 panel/generation results/drag-and-drop/Node Details 必须 `test:gate` 通过。新增专项测试需同步加入 `scripts/test-gate.mjs`。

---

## 推送到 GitHub（本机开发目录）

若使用配套克隆目录 `D:\aaa\_fg_push_repo`：

```powershell
cd D:\aaa\_fg_push_repo
.\sync-from-dev.ps1
git add -A
git commit -m "说明改动"
git push origin main
```

**不要提交：** `node_modules/`、`dist/`、`data/`、`.env.local`（见 `.gitignore`）。

---

## 服务器最小更新集

仅改前端时，生产机通常覆盖：

- `dist/`（整个目录）
- 若改后端：`server.js`、`server/`、`promptPlaceholders.mjs`
- 然后**重启 Node**（不必重启 Nginx）

---

## 常见问题

- **页面 401 / workspace 保存失败**：先登录；检查 `.env.local` 与 MySQL 连通。
- **聊天历史点击消失 / fallback 后会话异常**：需含最新 `ChatPanel.tsx`、`assistantMessageLayout.ts` 的 `dist/`，并 Ctrl+F5。
- **Gemini 思考过程显示在正文里**：同上，需最新构建；思考与联网检索均为可折叠过程卡片。
- **下载视频 403**：签名 URL 过期或防盗链，走服务端代理/任务下载。
- **Node 启动 `ERR_MODULE_NOT_FOUND`**：勿随意整包替换 `node_modules`；用与 `package-lock.json` 匹配的离线包或 `npm ci`。
- **端口占用**：默认 `3001`，`netstat -ano | findstr :3001` 查占用进程。
- **4K 视频无法播放**：Seedance 2.0 4K 为 H.265，浏览器不直接支持。网关会异步转码为 H.264，前端轮询写入 `gp.transcodedVideoUrl`。若 6 分钟仍未就绪，可能超过等待上限，刷新后会触发恢复重试。播放源已加同源校验，避免转码版"张冠李戴"。
- **刷新后中间 MOV 节点视频被覆盖**：MOV 节点已有成片时，恢复逻辑会新建下游节点写入新产出，不再覆盖原视频（[shouldWriteRecoveryIntoRunNode](utils/runRecovery.ts)）。存量被覆盖的节点可从 `gp.referenceMovs` 或上游节点手动恢复 `imagePreview`。
- **Seedance 2.5 任务报"不支持该参数组合"**：2.5 不支持 `tools` 参数，面板已隐藏联网开关；2.0 4K 的 `resolution` 必须大写 `4K`（网关大小写敏感）。
- **Node Details 引用图与面板标签不一致**：仅显示 prompt 中 `@` 显式引用的素材；`preferPromptLabels` 仅在标签全为通用名（图片1/主图）时重排，含具体资产名（如"石头"）不重排。

---

## License

仅用于项目内部开发与部署。如需开源，请按实际情况补充许可证声明。
