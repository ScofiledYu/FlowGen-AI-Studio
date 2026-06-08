# FlowGen — Windows Server 2012 R2（离线）

**第一部分** — 新服务器，从头到尾做一遍（步骤 1～13）  
**第二部分** — 以后每次更新、开关机  

日常维护简版：[服务器部署文件清单.md](../服务器部署文件清单.md)

**路径** — 安装包 `D:\software\` · 程序 `D:\apps\flowgen-ai-studio\` · MySQL `D:\MySQL\mysql-5.7.44-winx64\` · 数据 `D:\MySQL\data57\` · Web 3001 · 服务 MySQL57

**命令怎么复制**

- 【整段复制】— PowerShell 一次粘贴整段
- 【逐行执行】— 一行完成再做下一行
- 【写入文件】— 保存为文件内容，不是 Shell 命令
- 【手动】— 资源管理器或双击，不用命令行

---

# 第一部分：首次安装

概览：有网电脑（1～2）→ U 盘复制（3）→ 装 Node（4）、解压配置 MySQL（5～8）、初始化 FlowGen（9～10）、启动验证（11～13）

---

**步骤-1** · 有网电脑 · 下载

- 下载 `node-v18.20.4-x64.msi`、`mysql-5.7.44-winx64.zip` 到 U 盘
- https://nodejs.org/dist/v18.20.4/node-v18.20.4-x64.msi
- https://downloads.mysql.com/archives/get/p/23/file/mysql-5.7.44-winx64.zip

---

**步骤-2** · 有网电脑 · 构建 FlowGen

- 在项目根目录执行下面命令，生成含 `node_modules\` 的完整程序，供步骤-3 拷走

【整段复制】

    cd D:\aaa\flowgen-ai-studio
    npm ci
    npm run build

---

**步骤-3** · U 盘 → 服务器 · 复制（只复制，不安装、不解压）

【手动】资源管理器复制：

- `node-v18.20.4-x64.msi` → `D:\software\`
- `mysql-5.7.44-winx64.zip` → `D:\software\`
- `server.js`、`promptPlaceholders.mjs`、`package.json`、`package-lock.json` → `D:\apps\flowgen-ai-studio\`
- `dist\`、`server\`、`scripts\`、`node_modules\` → `D:\apps\flowgen-ai-studio\`
- `.env.local` → `D:\apps\flowgen-ai-studio\.env.local`
- 可选 `store.json`、`uploads\` → `D:\apps\flowgen-ai-studio\data\flowgen\`

---

**步骤-4** · 服务器 · 安装 Node

【手动】双击 `D:\software\node-v18.20.4-x64.msi`，一路下一步（MSI 安装，不是解压 zip）

【逐行执行】装完检查版本须 v18.x：

    node -v

---

**步骤-5** · 服务器 · 解压 MySQL

【手动】解压 `D:\software\mysql-5.7.44-winx64.zip`，将解压出的文件夹 `mysql-5.7.44-winx64` 放到 `D:\MySQL\mysql-5.7.44-winx64\`（不是运行安装程序）

- 检查：存在 `D:\MySQL\mysql-5.7.44-winx64\bin\mysqld.exe`

---

**步骤-6** · 服务器 · 写 MySQL 配置

【写入文件】`D:\MySQL\mysql-5.7.44-winx64\my.ini`

    [mysqld]
    basedir=D:/MySQL/mysql-5.7.44-winx64
    datadir=D:/MySQL/data57
    port=3306
    character-set-server=utf8mb4
    collation-server=utf8mb4_unicode_ci
    default-storage-engine=INNODB
    max_allowed_packet=64M
    [client]
    port=3306
    default-character-set=utf8mb4

---

**步骤-7** · 服务器 · 安装 MySQL 服务

- 管理员 PowerShell，每行等完成再执行下一行

【逐行执行】

    cd D:\MySQL\mysql-5.7.44-winx64\bin
    .\mysqld.exe --defaults-file=D:\MySQL\mysql-5.7.44-winx64\my.ini --initialize-insecure
    .\mysqld.exe --install MySQL57 --defaults-file=D:\MySQL\mysql-5.7.44-winx64\my.ini
    net start MySQL57
    sc.exe config MySQL57 start= auto

---

**步骤-8** · 服务器 · 建库建用户

- 密码与 `.env.local` 中 `MYSQL_PASSWORD=FlowgenDb@2026` 一致

【逐行执行】

    cd D:\MySQL\mysql-5.7.44-winx64\bin
    .\mysql.exe -u root

进入 `mysql>` 后 【整段复制】：

    CREATE DATABASE flowgen CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    CREATE USER 'flowgen'@'localhost' IDENTIFIED BY 'FlowgenDb@2026';
    CREATE USER 'flowgen'@'127.0.0.1' IDENTIFIED BY 'FlowgenDb@2026';
    GRANT ALL ON flowgen.* TO 'flowgen'@'localhost';
    GRANT ALL ON flowgen.* TO 'flowgen'@'127.0.0.1';
    FLUSH PRIVILEGES;
    EXIT;

---

**步骤-9** · 服务器 · 初始化 FlowGen 表

【整段复制】

    cd D:\apps\flowgen-ai-studio
    npm run mysql:init
    npm run test:mysql

- 须显示连接成功

---

**步骤-10** · 服务器 · 导入旧数据（无旧数据跳过）

- 步骤-3 已拷 `store.json` 时执行

【整段复制】

    cd D:\apps\flowgen-ai-studio
    npm run mysql:migrate

- migrate 提示已有数据、仍要用 json 覆盖时 【整段复制】：

    cd D:\apps\flowgen-ai-studio
    $env:FORCE_MIGRATE = "1"
    npm run mysql:migrate
    Remove-Item Env:FORCE_MIGRATE

---

**步骤-11** · 服务器 · 防火墙

【手动】入站规则放行 TCP 3001

---

**步骤-12** · 服务器 · 启动 FlowGen

- `npm start` 单独执行，窗口保持打开
- **生产建议**：大工程或多人同时编辑时，先设 Node 堆上限（见 [`capacity-and-hardware.md`](./capacity-and-hardware.md)）

【逐行执行】

    net start MySQL57
    cd D:\apps\flowgen-ai-studio
    $env:NODE_OPTIONS = "--max-old-space-size=8192"
    $env:PORT = "3001"
    npm start

---

**步骤-13** · 浏览器 · 验证

【手动】打开 `http://服务器IP:3001`，能登录即完成

---

**首次安装踩坑**

- `node:buffer` → 重做步骤-4，改装 Node 18
- `sc config` 报错 → 步骤-7 用 `sc.exe config`
- 步骤-9 失败且 Node 未就绪 【逐行执行】：

    cd D:\MySQL\mysql-5.7.44-winx64\bin
    cmd /c "mysql.exe -u flowgen -pFlowgenDb@2026 < D:\apps\flowgen-ai-studio\server\flowgen\schema.sql"

---

# 第二部分：日常维护

## 每次更新程序（步骤 1～7）

**步骤-1** · 有网电脑 · 准备并构建

- 只改界面：拷 `dist\`，执行：

【整段复制】

    cd D:\aaa\flowgen-ai-studio
    npm run build

- 改后端、依赖未变：拷 `server.js`、`promptPlaceholders.mjs`、`server\`、`scripts\`，无需下面命令
- 依赖变了或全拷：拷 8 项（含 `node_modules\`），执行：

【整段复制】

    cd D:\aaa\flowgen-ai-studio
    npm ci
    npm run build

- 永远不要盖：`.env.local`、`data\`
- 只拷 dist 或 4 个后端：不要盖 `node_modules\`
- 不要执行 `mysql:migrate`

---

**步骤-2** · 服务器 · 停止 FlowGen

【手动】npm start 窗口 Ctrl+C

---

**步骤-3** · 服务器 · 备份配置（仅拷 8 项时）

【手动】把 `D:\apps\flowgen-ai-studio\.env.local` 复制到 U 盘备份

---

**步骤-4** · U 盘 → 服务器 · 覆盖程序

【手动】资源管理器覆盖到 `D:\apps\flowgen-ai-studio\`，不要盖 `data\`

---

**步骤-5** · 服务器 · 还原配置（仅拷 8 项时）

【手动】把备份的 `.env.local` 拷回 `D:\apps\flowgen-ai-studio\`

---

**步骤-6** · 服务器 · 启动

- `npm start` 单独执行

【逐行执行】

    net start MySQL57
    cd D:\apps\flowgen-ai-studio
    $env:NODE_OPTIONS = "--max-old-space-size=8192"
    $env:PORT = "3001"
    npm start

---

**步骤-7** · 浏览器 · 刷新

【手动】Ctrl+F5

---

## 开关机（没发版时）

**开机** — 与上面步骤-6 相同 【逐行执行】

    net start MySQL57
    cd D:\apps\flowgen-ai-studio
    $env:NODE_OPTIONS = "--max-old-space-size=8192"
    $env:PORT = "3001"
    npm start

**关机** — 先 【手动】Ctrl+C 停 FlowGen，再 【逐行执行】：

    net stop MySQL57

---

## 维护前备份

【逐行执行】

    cd D:\MySQL\mysql-5.7.44-winx64\bin
    .\mysqldump.exe -u flowgen -pFlowgenDb@2026 --single-transaction flowgen > D:\backup\flowgen.sql

【手动】复制 `data\flowgen\uploads` 和 `.env.local` 到 `D:\backup\`

---

## 更新后自检

【整段复制】

    cd D:\apps\flowgen-ai-studio
    npm run test:mysql

【手动】浏览器 `http://服务器IP:3001/flowgen-api/health/db`，期望 `"storage":"relational"`

**升级到 relational 存储（防 OOM、推荐）**：见 [`单机部署-relational-简明步骤.md`](./单机部署-relational-简明步骤.md)

多人同时编辑时的硬件与压测说明：[`capacity-and-hardware.md`](./capacity-and-hardware.md)

---

## 出问题

- 页面没变 → Ctrl+F5，确认 `dist\` 已覆盖
- 登录失败 → 执行「开机」命令
- health/db 为 json → 检查 `.env.local` 的 `MYSQL_PASSWORD`
- 无图 → 检查 `data\flowgen\uploads\`
- Node 崩溃 `heap out of memory` → 设 `$env:NODE_OPTIONS="--max-old-space-size=8192"` 并重启；确认已部署含 `persistSanitize` 的版本（见 [`capacity-and-hardware.md`](./capacity-and-hardware.md)）
- 禁止：运行时删 `D:\MySQL\data57\`；覆盖生产 `data\`；不备份就 `FORCE_MIGRATE=1`

---

MySQL 细节：[mysql-deployment.md](./mysql-deployment.md) · 容量/硬件：[capacity-and-hardware.md](./capacity-and-hardware.md)
