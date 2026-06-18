# 单机生产部署（简明步骤）

适用：**一台 Windows Server**、**MySQL 已有数据和用户**、程序目录 `D:\apps\flowgen-ai-studio\`、端口 **3001**。

升级后：用 **relational** 存数据，避免整库 OOM；单机 64G 建议按 **约 80 人同时在画布编辑并自动保存** 规划。

---

## 你的情况（最常见）：服务器还是旧版，第一次换新版本

下面按顺序做即可。**MySQL 里已有数据时，不需要再拷 `store.json`，也不用 `mysql:migrate`（旧 JSON 进 MySQL）**；只需把现有 MySQL 快照 **搬进关系表**（做一次）。

### 第 0 步：有网电脑先打好包

在开发机项目目录执行：

```powershell
cd D:\aaa\flowgen-ai-studio
npm ci
npm run build
```

**拷哪些（二选一）：**

**方式 A — 推荐（整包，最省事）**  
拷整个 `flowgen-ai-studio` 文件夹到 U 盘，但 **不要拷/不要覆盖** 下面「禁止覆盖」里的内容（服务器上保留原文件）。

**方式 B — 精简（只拷运行和迁移需要的）**  
开发机 `npm ci` + `npm run build` 后，只拷这些到 `D:\apps\flowgen-ai-studio\`：

| 类型 | 路径 |
|------|------|
| 入口 | `server.js` |
| 入口依赖 | `promptPlaceholders.mjs` |
| 前端产物 | `dist\`（整个文件夹） |
| 后端 | `server\`（整个文件夹，含 `flowgen\repos\`、`schema-v2-relational.sql`） |
| 运维脚本 | `scripts\`（整个文件夹，含 `mysql-init-schema-v2.mjs`、`migrate-snapshot-to-relational.mjs`、`load-env-local.mjs`） |
| 服务端工具 | `utils\persistSanitize.mjs`（**必拷**，`server\flowgen\routes.mjs` 运行时会 import） |
| 依赖声明 | `package.json`、`package-lock.json` |
| 运行时依赖 | `node_modules\`（整个文件夹；或在服务器执行 `npm ci --omit=dev` 生成，二选一） |

**不必拷（生产 `npm start` 用不到）：**  
`components\`、`src\`、其余 `utils\*.ts`（前端逻辑已打进 `dist\`）、`docs\`、`test-*`、`*.ts` 源码、`vite.config.ts`、`tailwind.config.js`、`.cursor\`、`.git\`（若有）。

**禁止覆盖（服务器上保留，不要用 U 盘里的替换）：**

| 路径 |
|------|
| `.env.local` |
| `data\`（含 `uploads\`） |

---


### 第 1 步：停服务 + 备份（服务器）

1. 找到正在跑 FlowGen 的窗口，**Ctrl+C** 停掉。
2. 备份（复制到 U 盘或其它盘）：
   - `D:\apps\flowgen-ai-studio\.env.local`
   - `D:\apps\flowgen-ai-studio\data\flowgen\`（整个文件夹，含 `uploads\`）
3. 建议备份 MySQL（可选）：

```powershell
cd D:\MySQL\mysql-5.7.44-winx64\bin
.\mysqldump.exe -u flowgen -pFlowgenDb@2026 --single-transaction flowgen > D:\backup\flowgen-before-relational.sql
```

---

### 第 2 步：覆盖新程序（不要盖数据和配置）

用资源管理器覆盖到 `D:\apps\flowgen-ai-studio\`：

**必须更新：**

| 路径 |
|------|
| `dist\` |
| `server\`（含 `server\flowgen\repos\`） |
| `utils\persistSanitize.mjs` |
| `scripts\` |
| `server.js` |
| `package.json`、`package-lock.json` |

若服务器上 **没有** `node_modules` 或依赖有变，在服务器执行：

```powershell
cd D:\apps\flowgen-ai-studio
npm ci --omit=dev
```

**千万不要覆盖：**

| 路径 | 原因 |
|------|------|
| `.env.local` | 密码、MySQL 配置 |
| `data\` | 上传文件、旧 JSON |

---

### 第 3 步：改 `.env.local`（只加/改一行）

用记事本打开 `D:\apps\flowgen-ai-studio\.env.local`，确认有 MySQL 配置，并**增加或改成**：

```env
FLOWGEN_STORAGE=relational
```

保留原来的 `MYSQL_HOST`、`MYSQL_PASSWORD`、`FLOWGEN_JWT_SECRET` 等，不要删。

不要写 `FLOWGEN_STORAGE=mysql`（那是旧快照模式）。

---

### 第 4 步：数据库（只做一次，不是「再导入文件」）

说明：你 **MySQL 里已经有旧数据**（快照表 `flowgen_store_chunk`）。  
这一步是：**新建关系表 + 把快照里的用户/项目/画布 抄进新表**。  
**不用**再导入 `store.json`（除非 MySQL 是空的、数据只在 `data\flowgen\store.json` 里）。

管理员 PowerShell：

```powershell
cd D:\apps\flowgen-ai-studio
npm run mysql:init-v2
npm run mysql:migrate-relational
```

若提示「已有数据、跳过」，且你确认从没迁过 relational，再执行：

```powershell
$env:FORCE_MIGRATE = "1"
npm run mysql:migrate-relational
Remove-Item Env:FORCE_MIGRATE -ErrorAction SilentlyContinue
```

成功时末尾类似：

```text
users: 7
workspace_slices: 7
...
```

`workspace_slices` 为 0 且你本来有项目 → 检查失败，不要启动给用户用。

---

### 第 5 步：启动服务

```powershell
net start MySQL57
cd D:\apps\flowgen-ai-studio
$env:FLOWGEN_STORAGE = "relational"
$env:NODE_OPTIONS = "--max-old-space-size=8192"
$env:PORT = "3001"
npm start
```

保持窗口开着；不要关。

---

### 第 6 步：验收（必做）

1. 浏览器打开：`http://服务器IP:3001/flowgen-api/health/db`  
   必须看到：`"storage":"relational"` 且 `"ok":true`

2. 打开 `http://服务器IP:3001`，用原账号登录。

3. 打开以前的项目，看节点、素材、对话是否还在。

4. 改一个节点，等约 10 秒，刷新页面，确认能保存。

全部正常 → 升级完成。

---

### 第 7 步：以后每天怎么开（升级完成后）

```powershell
net start MySQL57
cd D:\apps\flowgen-ai-studio
$env:FLOWGEN_STORAGE = "relational"
$env:NODE_OPTIONS = "--max-old-space-size=8192"
$env:PORT = "3001"
npm start
```

关机：先 **Ctrl+C** 停 FlowGen，再按需 `net stop MySQL57`。

---

## 以后只发程序小更新（不要再 migrate）

1. Ctrl+C 停服务  
2. 只覆盖 `dist\` 和/或 `server\`、`scripts\`  
3. **不要**覆盖 `.env.local`、`data\`  
4. **不要**再跑 `mysql:migrate-relational`  
5. 按上面「第 7 步」重新启动  

---

## 要不要导入数据？（对照表）

| 你服务器现在的情况 | 要不要导入 |
|--------------------|------------|
| MySQL 有用户/项目，一直在用（旧版 `mysql` 模式） | **要** 做第 4 步 `migrate-relational`（从 MySQL 快照搬进关系表），**不要**只拷 store.json |
| 只有 `data\flowgen\store.json`，MySQL 是空的 | 先 `npm run mysql:migrate`，再做第 4 步 |
| 已经迁过，`health/db` 已是 `relational` 且数据正常 | **不要**再 migrate |

---

## 常见问题

| 现象 | 处理 |
|------|------|
| `health/db` 仍是 `mysql` | `.env.local` 加 `FLOWGEN_STORAGE=relational`，重启时带上 `$env:FLOWGEN_STORAGE="relational"` |
| 登录后工程没了 | 先别让用户用；`$env:FORCE_MIGRATE="1"; npm run mysql:migrate-relational` |
| 又 OOM 崩溃 | 确认 `storage` 已是 `relational`；确认 `NODE_OPTIONS=8192` |
| 页面没变 | Ctrl+F5；确认 `dist\` 已覆盖 |
| `Cannot find module ... persistSanitize.mjs` | 从开发机拷 `utils\persistSanitize.mjs` 到服务器同路径后重启 |
| 项目列表全是占位图、无封面 | 见下文「项目封面」；磁盘有 `project-cover.*` 时执行 `npm run repair:project-covers` |
| 资产库 / 封面上传 **`Request Entity Too Large`** | Nginx 默认只允许 1MB；在 `D:\nginx\conf\nginx.conf` 的 `http { }` 加 `client_max_body_size 100m;` 后 `nginx.exe -t` 与 `nginx.exe -s reload`。详见 [Nginx 部署说明 · 常见问题](./Windows-Server-2012R2-Nginx部署说明.md#第五部分常见问题) 与 [蓝绿指南 · 10.10](./Windows-Server-2022-128GB-蓝绿部署指南.md#1010-资产库--封面上传报-request-entity-too-large413) |

### 项目封面（列表缩略图）

封面**不在 MySQL BLOB 里**，而是：

| 部分 | 位置 |
|------|------|
| 图片文件 | `D:\apps\flowgen-ai-studio\data\flowgen\uploads\{项目ID}\project-cover.jpg`（或 .png） |
| 数据库字段 | `flowgen_projects.cover_image`，一般为 `/flowgen-api/projects/{id}/cover/file` |

迁移时若旧数据是 `data:` / `blob:` 临时地址，会**清空** `cover_image`，列表就显示占位图标。

**处理：**

1. 确认升级时**没有覆盖**服务器上的 `data\` 文件夹（含 `uploads\`）。
2. 在服务器执行：`npm run repair:project-covers`（根据磁盘上的 `project-cover.*` 写回数据库）。
3. 仍无图：由**超级管理员 / 管理员 / 项目管理员**在项目列表 ⋮ 菜单中**手动上传封面**（保存画布不会自动改封面）。

---

## 容量（单机 64G）

| 场景 | 建议 |
|------|------|
| 同时在画布编辑 + 自动保存 | **约 80 人**（规划用） |
| 只登录、偶尔看看 | 可多于 80 |

---

## 其它文档

- 装机/MySQL 细节：[`Windows-Server-2012R2-离线部署说明.md`](./Windows-Server-2012R2-离线部署说明.md)
- Nginx 反向代理 / 无感更新：[`Windows-Server-2012R2-Nginx部署说明.md`](./Windows-Server-2012R2-Nginx部署说明.md)
- 架构说明：[`architecture-300-concurrent-editors.md`](./architecture-300-concurrent-editors.md)
