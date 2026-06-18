# Windows Server 2022 · 128GB 机器 · 蓝绿部署完整指南（relational 模式 · 离线）

**适用机器**：AMD Ryzen Threadripper 3960X 24核 / 128GB RAM / Windows Server 2022 Standard  
**目标并发**：不改代码情况下，**140~160 人** 同时在画布编辑（乐观可达 180 人）  
**存储模式**：`FLOWGEN_STORAGE=relational`（与开发机一致）  
**部署策略**：Blue-Green（零停机更新 + 快速回滚）  
**网络环境**：服务器**无外网**，所有软件从开发机/U 盘拷贝安装

---

## 命令标记说明

- **【逐行执行】** — PowerShell 中一行一行执行
- **【整段复制】** — PowerShell 中可整段粘贴执行
- **【手动】** — 资源管理器复制、双击安装、图形界面操作
- **【写入文件】** — 用记事本保存为指定路径的文件内容
- **【MySQL 命令行】** — 先 `.\mysql.exe -u ... -p` 登录，出现 `mysql>` 后再执行 SQL

> **重要**：所有 PowerShell 命令建议**以管理员身份运行**（窗口标题应显示「管理员: Windows PowerShell」）。

---

## 蓝绿部署目录规划（先看懂再动手）

蓝绿是**两个程序目录 + 一份共享数据**，不是两个完全独立的环境：

```
D:\apps\
  ├── flowgen-blue\          ← 蓝版本程序（端口 3001，待命/回滚）
  ├── flowgen-green\         ← 绿版本程序（端口 3002，当前激活）
  └── flowgen-active.txt     ← 记录当前 Nginx 指向 blue 还是 green

D:\flowgen-data\             ← ★ 共享上传目录（蓝绿两个实例都读写这里）
  └── uploads\
      └── {项目ID}\          ← 项目封面、资产库图片、节点预览等

D:\nginx\
D:\MySQL\mysql-5.7.44\
D:\backup\
D:\software\
D:\tools\npm\                ← PM2 离线目录
```

| 数据类型 | 存放位置 | 蓝绿是否共享 |
|----------|----------|--------------|
| 用户、项目、画布、聊天记录等 | MySQL `flowgen` 库 | ✅ 共享（两个实例连同一库） |
| 上传图片/视频/音频文件 | `D:\flowgen-data\uploads\` | ✅ **必须共享**（靠 `FLOWGEN_DATA_DIR`） |
| 程序代码 | `flowgen-blue\` / `flowgen-green\` | ❌ 各自独立，更新时只覆盖待命目录 |

> **为什么 data 要换位置？**  
> 默认上传目录是相对路径 `data/flowgen/uploads/`（相对各实例自己的 `process.cwd()`）。  
> 若不配置 `FLOWGEN_DATA_DIR`，Blue 写到 `D:\apps\flowgen-blue\data\...`，Green 写到 `D:\apps\flowgen-green\data\...`，**图片会分裂**，切换版本后用户会看到缺图。  
> 因此蓝绿部署**必须**把 `FLOWGEN_DATA_DIR` 指向 `D:\flowgen-data`。

---

## 部署前检查清单

- [ ] 开发机已执行 `npm run build`，并准备好待拷贝文件
- [ ] 已准备安装包到 `D:\software\`：
  - `node-v22.22.0-x64.msi`
  - `mysql-5.7.44-winx64.zip`
  - `nginx-1.28.3.zip`
  - **`vc_redist.x64.exe`**（Visual C++ 2015-2022 运行库，MySQL 必需）
- [ ] 已准备 PM2 离线目录（开发机 `C:\Users\Administrator\AppData\Roaming\npm` 整个文件夹）
- [ ] 已规划目录：`D:\apps\flowgen-blue`、`D:\apps\flowgen-green`、**`D:\flowgen-data`**、`D:\nginx`、`D:\MySQL\mysql-5.7.44`
- [ ] 若从旧服务器迁移，已备份并准备拷贝 **`data\flowgen\uploads\`** 到 `D:\flowgen-data\uploads\`
- [ ] 已从旧服务器导出数据库（见「八、数据迁移」，可选）
- [ ] 已确认 `.env.local` 中的 `FLOWGEN_JWT_SECRET`、`FLOWGEN_DATA_DIR` 和 MySQL 密码

---

# 第一部分：首次完整部署（步骤 1~15）

## 步骤-1 · 服务器 · 创建目录结构

【逐行执行】

```powershell
New-Item -ItemType Directory -Path D:\apps, D:\nginx, D:\MySQL, D:\backup, D:\software, D:\tools, D:\flowgen-data\uploads -Force
```

---

## 步骤-2 · 服务器 · 拷贝安装包与工具

【手动】把以下文件/目录拷贝到服务器：

| 来源（开发机） | 目标（服务器） |
|----------------|----------------|
| `node-v22.22.0-x64.msi` | `D:\software\` |
| `mysql-5.7.44-winx64.zip` | `D:\software\` |
| `nginx-1.28.3.zip` | `D:\software\` |
| `vc_redist.x64.exe` | `D:\software\` |
| `npm` 全局目录（含 `pm2.cmd`） | `D:\tools\npm\` |

---

## 步骤-3 · 服务器 · 安装 Node.js 22.22.0

【手动】双击 `D:\software\node-v22.22.0-x64.msi` 安装。

【逐行执行】验证：

```powershell
node --version     # 应显示 v22.22.0
npm --version      # 应显示 10.9.2
```

---

## 步骤-4 · 服务器 · 安装 Visual C++ 运行库（MySQL 必需）

MySQL 5.7 依赖 `MSVCP140.dll`，未安装会弹出「找不到 MSVCP140.dll」错误。

【逐行执行】（管理员 PowerShell）

```powershell
D:\software\vc_redist.x64.exe /install /quiet /norestart
```

安装完成后重启 PowerShell 窗口（或重启服务器）。

---

## 步骤-5 · 服务器 · 安装 MySQL 5.7.44（ZIP 版）

### 5.1 清理旧目录（如果之前解压失败）

【逐行执行】

```powershell
Remove-Item -Path D:\MySQL\mysql-5.7.44-winx64 -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path D:\MySQL\mysql-5.7.44 -Recurse -Force -ErrorAction SilentlyContinue
```

### 5.2 解压并重命名

【逐行执行】

```powershell
Expand-Archive -Path D:\software\mysql-5.7.44-winx64.zip -DestinationPath D:\MySQL\ -Force
Rename-Item D:\MySQL\mysql-5.7.44-winx64 D:\MySQL\mysql-5.7.44
```

### 5.3 验证 bin 目录

【逐行执行】

```powershell
Get-ChildItem D:\MySQL\mysql-5.7.44\bin\mysqld.exe
```

应能看到 `mysqld.exe` 文件。

### 5.4 创建 my.ini

【写入文件】`D:\MySQL\mysql-5.7.44\my.ini`

```ini
[mysqld]
basedir=D:/MySQL/mysql-5.7.44
datadir=D:/MySQL/mysql-5.7.44/data
port=3306
server_id=1
character-set-server=utf8mb4
collation-server=utf8mb4_general_ci
max_connections=400
max_allowed_packet=64M
innodb_buffer_pool_size=16G
innodb_log_file_size=512M
innodb_flush_log_at_trx_commit=2
innodb_file_per_table=1
sql_mode=STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION

[mysql]
default-character-set=utf8mb4
```

### 5.5 初始化并安装服务

【逐行执行】（**管理员** PowerShell）

```powershell
cd D:\MySQL\mysql-5.7.44\bin

# 初始化（务必复制保存输出的 root 临时密码！）
.\mysqld --initialize --console

# 安装为 Windows 服务
.\mysqld --install MySQL57

# 启动服务
net start MySQL57
```

执行 `.\mysqld --initialize --console` 后，应看到：

```
A temporary password is generated for root@localhost: xxxxxxxx
```

**务必复制保存这个密码！**

如果没有看到密码、或报 `data directory has files`，见本文档 **「十、MySQL 常见问题」**。

---

## 步骤-6 · 服务器 · 创建 MySQL 数据库与用户

### 6.1 登录 root

【逐行执行】

```powershell
cd D:\MySQL\mysql-5.7.44\bin
.\mysql.exe -u root -p
```

输入初始化时生成的**临时密码**，出现 `mysql>` 提示符。

> 如果忘记临时密码，见 **「十、MySQL 常见问题 → 重置 root 密码」**。

### 6.2 修改 root 密码并创建 flowgen 用户

【MySQL 命令行】在 `mysql>` 下**逐条执行**（首次登录必须先改密码）：

```sql
ALTER USER 'root'@'localhost' IDENTIFIED BY 'FlowgenDb@2026';
FLUSH PRIVILEGES;

CREATE DATABASE flowgen CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
CREATE USER 'flowgen'@'localhost' IDENTIFIED BY 'FlowgenDb@2026';
GRANT ALL PRIVILEGES ON flowgen.* TO 'flowgen'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

执行 `EXIT;` 后回到 PowerShell。

---

## 步骤-7 · 服务器 · 离线安装 PM2

服务器无外网，**不能**执行 `npm install -g pm2`。

### 7.1 拷贝 PM2 目录

【手动】把开发机的 `npm` 全局目录完整拷贝到 `D:\tools\npm\`（含 `pm2.cmd`、`pm2.ps1`、`node_modules`）。

### 7.2 加入系统 Path

1. 右键「此电脑」→ 属性 → 高级系统设置 → 环境变量
2. 系统变量 `Path` → 新建 → 填入 `D:\tools\npm`
3. 确定后**重启 PowerShell**

### 7.3 验证

【逐行执行】

```powershell
pm2 --version
```

> PM2 数据目录默认在 `C:\Users\用户名\.pm2`，这是正常的，与 `D:\tools\npm`（程序位置）不同。

---

## 步骤-8 · 服务器 · 安装 Nginx 1.28.3

【逐行执行】

```powershell
Expand-Archive -Path D:\software\nginx-1.28.3.zip -DestinationPath D:\nginx\ -Force
```

---

## 步骤-9 · 服务器 · 部署 FlowGen（开发机 build 后拷贝）

> **重要**：全部在开发机 `npm run build` 后拷贝到服务器。**服务器端不执行 npm install / npm ci**。

### 9.1 开发机 build

【整段复制】（开发机执行）

```powershell
cd D:\aaa\flowgen-ai-studio
npm run build
```

### 9.2 必须拷贝的文件/目录

【手动】从开发机拷贝到 `D:\apps\flowgen-green\` 和 `D:\apps\flowgen-blue\`：

| 必须拷贝 | 说明 |
|----------|------|
| `dist\` | 前端构建产物 |
| `server.js` | 入口文件 |
| `server\` | 后端代码（含 schema SQL） |
| `scripts\` | **必需**，含 `load-env-local.mjs`、`mysql-init-schema-v2.mjs` |
| `package.json` | 依赖声明 |
| `package-lock.json` | 锁文件 |
| `node_modules\` | 从开发机直接拷贝 |
| `promptPlaceholders.mjs` | server.js 依赖 |
| `utils\` | **必需**（含 `taskStatusMediaUrl.mjs`，`server.js` 启动时会 import） |

**不要拷贝**：

| 不要拷贝 | 原因 |
|----------|------|
| `components\`、`src\`、`docs\`、`test-*` 等开发文件 | 生产不需要 |
| **`data\`** | 上传文件走共享目录 `D:\flowgen-data`，**不要**放进 blue/green 程序目录 |

### 9.3 创建 `.env.local`（含共享 data 路径）

两个实例除 `PORT` 外配置**必须一致**，尤其是 `FLOWGEN_DATA_DIR` 和 `FLOWGEN_JWT_SECRET`。

【写入文件】`D:\apps\flowgen-green\.env.local`

```env
PORT=3002
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=flowgen
MYSQL_PASSWORD=FlowgenDb@2026
MYSQL_DATABASE=flowgen
FLOWGEN_STORAGE=relational
FLOWGEN_DATA_DIR=D:/flowgen-data
FLOWGEN_JWT_SECRET=your-super-secret-jwt-key-change-me-2026
```

【写入文件】`D:\apps\flowgen-blue\.env.local`（仅 `PORT` 不同，其余相同）

```env
PORT=3001
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=flowgen
MYSQL_PASSWORD=FlowgenDb@2026
MYSQL_DATABASE=flowgen
FLOWGEN_STORAGE=relational
FLOWGEN_DATA_DIR=D:/flowgen-data
FLOWGEN_JWT_SECRET=your-super-secret-jwt-key-change-me-2026
```

> **端口必须写在 `.env.local` 的 `PORT=` 里**，不要依赖 PowerShell 临时 `$env:PORT`（PM2 重启后会丢失）。  
> **`FLOWGEN_DATA_DIR` 蓝绿两个实例必须完全相同**，指向 `D:\flowgen-data`。

---

## 步骤-10 · 服务器 · 配置共享上传目录（data）

relational 模式下，**业务数据在 MySQL**；`data` 目录只存**上传文件**（项目封面、资产库、节点预览等）。

### 10.1 首次部署（无历史数据）

步骤-1 已创建 `D:\flowgen-data\uploads\`，无需额外操作。新上传会自动落到该目录。

### 10.2 从旧服务器迁移上传文件

【手动】把旧服务器上的上传目录拷贝到新服务器：

| 旧服务器路径 | 新服务器路径 |
|--------------|--------------|
| `D:\apps\flowgen-ai-studio\data\flowgen\uploads\` | `D:\flowgen-data\uploads\` |

若旧服务器也是蓝绿且已配置过共享目录，则直接拷贝其 `FLOWGEN_DATA_DIR` 下的 `uploads\` 即可。

【逐行执行】验证目录非空（有历史项目时）：

```powershell
Get-ChildItem D:\flowgen-data\uploads
```

应能看到以项目 ID 命名的子文件夹。

### 10.3 禁止在 blue/green 程序目录下留 data

【逐行执行】若误拷了 `data\` 到程序目录，删除以免混淆：

```powershell
Remove-Item -Path D:\apps\flowgen-green\data -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path D:\apps\flowgen-blue\data -Recurse -Force -ErrorAction SilentlyContinue
```

---

## 步骤-11 · 服务器 · 初始化数据库表结构

### 11.1 执行初始化脚本

【逐行执行】

```powershell
cd D:\apps\flowgen-green
node scripts/mysql-init-schema-v2.mjs
```

如果报错 `Table 'flowgen.flowgen_meta' doesn't exist`，执行下一步补建。

### 11.2 补建 flowgen_meta 表（如 11.1 报错）

【逐行执行】

```powershell
cd D:\MySQL\mysql-5.7.44\bin
.\mysql.exe -u flowgen -pFlowgenDb@2026 flowgen
```

【MySQL 命令行】

```sql
CREATE TABLE IF NOT EXISTS flowgen_meta (
  `key` VARCHAR(64) NOT NULL PRIMARY KEY,
  `value` VARCHAR(255) NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO flowgen_meta (`key`, `value`)
VALUES ('schema_version', '2-relational-draft')
ON DUPLICATE KEY UPDATE `value` = VALUES(`value`), updated_at = CURRENT_TIMESTAMP;

SHOW TABLES LIKE 'flowgen_%';
EXIT;
```

应看到 8 张表：`flowgen_users`、`flowgen_projects`、`flowgen_workspace_slices`、`flowgen_meta` 等。

### 11.3 导入旧数据（如有备份，可选）

详见 **「八、数据迁移」**。relational 模式旧库导入后可直接使用。

---

## 步骤-12 · 服务器 · 启动 FlowGen（PM2）

> **Windows 上不要用** `pm2 start npm -- run start` 或 `pm2 start node.exe -- server.js`，会启动失败或端口不监听。  
> **正确方式**：`pm2 start server.js --name xxx`

### 12.1 先前台测试（推荐）

【逐行执行】

```powershell
cd D:\apps\flowgen-green
node server.js
```

应看到：

```
[flowgen] Storage: relational (flowgen)
FlowGen AI Studio 服务器已启动!
本地访问: http://localhost:3002
```

确认无误后按 `Ctrl+C` 停止。

### 12.2 用 PM2 启动 Green（端口 3002）

【逐行执行】

```powershell
cd D:\apps\flowgen-green
pm2 delete flowgen-green -ErrorAction SilentlyContinue
pm2 start server.js --name flowgen-green
pm2 status
```

### 12.3 启动 Blue（端口 3001，待命）

【逐行执行】

```powershell
cd D:\apps\flowgen-blue
pm2 delete flowgen-blue -ErrorAction SilentlyContinue
pm2 start server.js --name flowgen-blue
pm2 status
```

### 12.4 验证

【逐行执行】

```powershell
netstat -ano | findstr :3002
netstat -ano | findstr :3001
curl http://127.0.0.1:3002/flowgen-api/health/db
curl http://127.0.0.1:3001/flowgen-api/health/db
```

浏览器访问：

- `http://服务器IP:3002`（Green）
- `http://服务器IP:3001`（Blue）

**默认管理员账号**（首次启动自动创建）：

| 用户名 | 密码 |
|--------|------|
| `admin` | `admin` |

登录后请立即修改密码。若有历史项目，检查项目封面和资产库图片是否正常显示。

---

## 步骤-13 · 服务器 · 配置 Nginx（蓝绿切换）

【写入文件】`D:\nginx\conf\nginx.conf`

```nginx
worker_processes  auto;

events {
    worker_connections  2048;
}

http {
    include       mime.types;
    default_type  application/octet-stream;

    sendfile        on;
    keepalive_timeout  65;

    # 上传大文件（资产库 / 封面 / 本地工程）；Nginx 默认仅 1m，超出会 413 Request Entity Too Large
    client_max_body_size 100m;

    upstream flowgen_blue {
        server 127.0.0.1:3001;
    }

    upstream flowgen_green {
        server 127.0.0.1:3002;
    }

    upstream flowgen_active {
        server 127.0.0.1:3002;   # 当前激活 green
        # server 127.0.0.1:3001;   # 切换到 blue 时改这里
    }

    server {
        listen       80;
        server_name  _;

        location / {
            proxy_pass http://flowgen_active;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;

            proxy_read_timeout 600s;
            proxy_send_timeout 600s;
        }
    }
}
```

【逐行执行】

```powershell
cd D:\nginx
.\nginx.exe -t
.\nginx.exe
```

【逐行执行】记录当前激活版本：

```powershell
"green" | Out-File D:\apps\flowgen-active.txt -Encoding utf8
```

---

## 步骤-14 · 服务器 · 设置开机自启（Windows 计划任务）

> **注意**：Windows 上 `pm2 startup` 会报 `Init system not found`，这是正常的。用**一个计划任务 + 一个 bat** 按顺序拉起 MySQL → FlowGen（PM2）→ Nginx。

### 14.1 首次配置：保存 PM2 进程表（只做一次）

在 **blue、green 两个实例都已 `pm2 start` 且 `pm2 status` 均为 online** 时执行：

【逐行执行】

```powershell
pm2 status
pm2 save
```

`pm2 save` 写入 `%USERPROFILE%\.pm2\dump.pm2`。**开机脚本只在端口未监听时执行 `pm2 resurrect`**，不会在每次开机时 `pm2 save`（开机时进程未起，误 save 会覆盖成空表）。

确认 MySQL 为自动启动（一般安装服务后已是自动）：

```powershell
sc qc MySQL57
sc config MySQL57 start= auto
```

### 14.2 创建统一开机脚本

【推荐】**直接复制仓库文件**到服务器（不要从网页/文档粘贴进记事本，避免 UTF-8 中文注释导致 cmd 乱解析、`%time%` 小数秒触发「输入新时间」卡死）：

```powershell
copy D:\aaa\flowgen-ai-studio\scripts\start-flowgen-server.bat D:\apps\start-flowgen.bat
```

目标路径：`D:\apps\start-flowgen.bat`（与仓库 `scripts\start-flowgen-server.bat` 一致，按服务器改路径变量）。

> bat 内注释为**纯英文 ASCII**；若卡在 `输入新时间:`，按 **Ctrl+C** 中断，换用新版脚本后重试。

```bat
@echo off
setlocal EnableExtensions
REM FlowGen 单机/蓝绿 — 开机顺序：MySQL → PM2(FlowGen) → Nginx

set "MYSQL_SVC=MySQL57"
set "NGINX_DIR=D:\nginx"
set "PM2_CMD=D:\tools\npm\pm2.cmd"
set "APPS_DIR=D:\apps"
if not defined PM2_HOME set "PM2_HOME=%USERPROFILE%\.pm2"
set "MYSQL_WAIT_SEC=8"
set "NODE_WAIT_SEC=5"

echo [%date% %time%] FlowGen stack startup begin.

REM --- 1) MySQL（必须先于 FlowGen） ---
sc query %MYSQL_SVC% | find /I "RUNNING" >nul
if errorlevel 1 (
  echo [%date% %time%] Starting %MYSQL_SVC%...
  net start %MYSQL_SVC%
  if errorlevel 1 (
    echo [%date% %time%] ERROR: %MYSQL_SVC% failed to start.
    exit /b 1
  )
  timeout /t %MYSQL_WAIT_SEC% /nobreak >nul
) else (
  echo [%date% %time%] %MYSQL_SVC% already running.
  timeout /t 3 /nobreak >nul
)

REM --- 2) PM2 / FlowGen（3001 蓝 + 3002 绿） ---
if not exist "%PM2_CMD%" (
  echo [%date% %time%] ERROR: PM2 not found: %PM2_CMD%
  exit /b 1
)

set "NEED_PM2=0"
call :check_ports || set "NEED_PM2=1"

if "%NEED_PM2%"=="1" (
  if not exist "%PM2_HOME%\dump.pm2" (
    echo [%date% %time%] ERROR: %PM2_HOME%\dump.pm2 not found. Run pm2 save once while blue+green are online.
    exit /b 1
  )
  echo [%date% %time%] FlowGen ports not listening, running pm2 resurrect...
  cd /d "%APPS_DIR%"
  set "PM2_HOME=%PM2_HOME%"
  call "%PM2_CMD%" resurrect
  timeout /t %NODE_WAIT_SEC% /nobreak >nul
  call :check_ports
  if errorlevel 1 (
    echo [%date% %time%] ERROR: ports 3001/3002 still not listening after pm2 resurrect.
    exit /b 1
  )
  echo [%date% %time%] FlowGen ports 3001/3002 are listening.
) else (
  echo [%date% %time%] FlowGen ports 3001/3002 already listening.
)

REM --- 3) Nginx（反向代理，放在 Node 就绪之后） ---
tasklist /FI "IMAGENAME eq nginx.exe" 2>nul | find /I "nginx.exe" >nul
if errorlevel 1 (
  if not exist "%NGINX_DIR%\nginx.exe" (
    echo [%date% %time%] ERROR: nginx.exe not found in %NGINX_DIR%
    exit /b 1
  )
  echo [%date% %time%] Starting Nginx...
  cd /d "%NGINX_DIR%"
  start "" nginx.exe
  timeout /t 2 /nobreak >nul
) else (
  echo [%date% %time%] Nginx already running.
)

echo [%date% %time%] FlowGen stack startup done.
exit /b 0

:check_ports
netstat -ano | findstr /R /C:":3001 " | findstr LISTENING >nul || exit /b 1
netstat -ano | findstr /R /C:":3002 " | findstr LISTENING >nul || exit /b 1
exit /b 0
```

**请按服务器实际修改：**

| 变量 | 示例 |
|------|------|
| `PM2_CMD` | `D:\tools\npm\pm2.cmd` 或全局 `pm2` 的完整路径 |
| `APPS_DIR` | `D:\apps`（`pm2 resurrect` 的工作目录） |
| `PM2_HOME` | 默认 `%USERPROFILE%\.pm2`；计划任务用其他账号时改为 `C:\Users\Administrator\.pm2` |
| `NGINX_DIR` | `D:\nginx` |
| `MYSQL_SVC` | `MySQL57` |

**启动顺序说明：**

| 顺序 | 组件 | 原因 |
|------|------|------|
| 1 | MySQL | FlowGen 启动即连库 |
| 2 | PM2 resurrect | 拉起 blue(3001)、green(3002)；仅在端口未监听时执行 |
| 3 | Nginx | 对外 80 代理，应在后端已监听后再起 |

用户访问 `http://服务器IP/` 走蓝或绿，仍由 **Nginx `upstream flowgen_active`** 决定，与 bat 无关。

### 14.3 创建计划任务（只需一个）

【手动】

1. 运行 `taskschd.msc`
2. 创建任务（建议用「创建任务」而非「基本任务」）→ 名称：`FlowGen Stack Startup`
3. **常规**：
   - **安全选项** → 选 **不管用户是否登录都要运行**，账号填 **执行过 `pm2 save` 的同一用户**（如 `Administrator`），并输入密码
   - 勾选 **使用最高权限运行**
   - **不要**选「只在 SYSTEM 下运行」——SYSTEM 读不到 `Administrator\.pm2\dump.pm2`，`pm2 resurrect` 会空转
4. **触发器**：**计算机启动时**（可选：延迟 **30 秒**，避免与系统服务争抢磁盘）
5. **操作**：**启动程序** → 程序填 `D:\apps\start-flowgen.bat`
6. 完成

> 已用本统一脚本时，**不必**再单独建 Nginx / FlowGen 多个计划任务。

### 14.4 手动测试脚本

【逐行执行】（先停掉部分服务模拟开机，或在维护窗口执行）

```powershell
D:\apps\start-flowgen.bat
sc query MySQL57
netstat -ano | findstr ":3001 :3002 :80"
pm2 status
```

### 14.5 重启后自检

| 组件 | 期望 |
|------|------|
| MySQL57 | `RUNNING` |
| 3001 / 3002 | `LISTENING` |
| nginx.exe | 1～2 个进程 |
| flowgen-blue / flowgen-green | 均为 `online` |

---

## 步骤-15 · 浏览器 · 验证部署

【手动】打开浏览器访问：

| 地址 | 说明 |
|------|------|
| `http://服务器IP` | 走 Nginx（当前激活版本） |
| `http://服务器IP:3002` | 直接访问 Green |
| `http://服务器IP:3001` | 直接访问 Blue |

用 `admin` / `admin` 登录测试。若有历史数据，确认图片/资产可正常加载。

---

# 第二部分：日常维护与蓝绿切换

## 蓝绿切换流程（零停机更新）

> **核心原则**：每次只更新「待命版本」的程序文件，**不动** MySQL 和 `D:\flowgen-data`；Nginx 切换流量后，原激活版本变为待命，可随时回滚。

### 更新前准备

```powershell
Get-Content D:\apps\flowgen-active.txt
```

确认当前激活版本和待命版本。

### 示例：当前激活 Green，更新到 Blue

1. 开发机 `npm run build`，拷贝文件到 `D:\apps\flowgen-blue\`
2. **禁止覆盖**：
   - `D:\apps\flowgen-blue\.env.local`
   - **`D:\flowgen-data\`**（共享上传目录）
   - **不要**向 blue/green 目录拷贝 `data\`
3. 重启 Blue：
   ```powershell
   cd D:\apps\flowgen-blue
   pm2 restart flowgen-blue
   ```
4. 测试 Blue：
   ```powershell
   curl http://127.0.0.1:3001/flowgen-api/health/db
   ```
   浏览器访问 `http://服务器IP:3001`，检查项目与图片是否正常
5. 修改 `D:\nginx\conf\nginx.conf`，`upstream flowgen_active` 改为 `127.0.0.1:3001`
6. 重载 Nginx：
   ```powershell
   cd D:\nginx
   .\nginx.exe -s reload
   ```
7. 更新标记：
   ```powershell
   "blue" | Out-File D:\apps\flowgen-active.txt -Encoding utf8
   ```

### 回滚

把 Nginx `upstream flowgen_active` 改回上一个端口，`nginx.exe -s reload`，更新 `flowgen-active.txt`。

### 切换注意

- 切换后等待 30~60 秒再更新标记
- 两个 `.env.local` 除 `PORT` 外应一致，**`FLOWGEN_DATA_DIR` 必须相同**
- 蓝绿两个实例**同时运行**，共享同一 MySQL 和 `D:\flowgen-data`
- 更新程序时**只覆盖待命目录的代码**，永远不动共享 data

---

## 日常运维命令

```powershell
# 查看状态
pm2 status

# 重启
pm2 restart flowgen-green
pm2 restart flowgen-blue

# 查看日志（如乱码可先执行 chcp 65001）
pm2 logs flowgen-green --lines 50
pm2 flush flowgen-green

# 重载 Nginx
cd D:\nginx; .\nginx.exe -s reload

# MySQL 备份
cd D:\MySQL\mysql-5.7.44\bin
.\mysqldump.exe -u flowgen -pFlowgenDb@2026 --single-transaction flowgen > D:\backup\flowgen-$(Get-Date -Format yyyyMMdd-HHmm).sql

# 上传文件备份（与 MySQL 备份一起做）
Copy-Item -Path D:\flowgen-data\uploads -Destination D:\backup\flowgen-uploads-$(Get-Date -Format yyyyMMdd) -Recurse

# 停止
pm2 stop flowgen-green
pm2 stop flowgen-blue
net stop MySQL57
```

---

## 八、数据迁移（从旧 Windows Server 2012 R2 到新服务器 2022）

### 1. 在旧服务器导出 MySQL

```powershell
cd D:\MySQL\mysql-5.7.44-winx64\bin
.\mysqldump.exe -u flowgen -pFlowgenDb@2026 --single-transaction --routines --triggers --databases flowgen > D:\backup\flowgen-export-$(Get-Date -Format yyyyMMdd).sql
```

### 2. 在旧服务器备份上传文件

【手动】拷贝：

| 旧路径 | 说明 |
|--------|------|
| `D:\apps\flowgen-ai-studio\data\flowgen\uploads\` | 默认单机路径 |
| 或旧 `.env.local` 里 `FLOWGEN_DATA_DIR` 指向的 `uploads\` | 若已配置共享目录 |

### 3. 传输到新服务器

- `flowgen-export-*.sql` → `D:\backup\`
- `uploads\` 整个文件夹 → `D:\flowgen-data\uploads\`

### 4. 导入 MySQL（新服务器已完成步骤-6、步骤-11 后）

```powershell
cd D:\MySQL\mysql-5.7.44\bin
.\mysql.exe -u flowgen -pFlowgenDb@2026 --default-character-set=utf8mb4 flowgen < D:\backup\flowgen-export-*.sql
```

### 5. 验证

```powershell
.\mysql.exe -u flowgen -pFlowgenDb@2026 -e "USE flowgen; SHOW TABLES; SELECT COUNT(*) AS users FROM flowgen_users;"
Get-ChildItem D:\flowgen-data\uploads
```

- 旧服务器是 **relational 模式** → 导入 MySQL + 拷贝 uploads 后直接可用
- 旧服务器是 **mysql 快照模式** → 导入后执行：
  ```powershell
  cd D:\apps\flowgen-green
  node scripts/migrate-json-to-mysql.mjs
  ```

---

## 九、注意事项

- 本文档基于**不改代码**的前提，metadata 仍为全量 sync
- 如需支撑 200+ 人，需先完成 metadata 行级 upsert 改造
- 访问应用时注意端口：Green=3002，Blue=3001，Nginx=80
- **`FLOWGEN_DATA_DIR` 是蓝绿部署的关键**：不配则两个实例各写各的 `data\`，切换后会缺图
- 程序目录（blue/green）与数据目录（`D:\flowgen-data`）**物理分离**，升级只动程序，不动 data
- `pm2 logs` 中的旧错误不会自动清除，用 `pm2 flush` 后再看新日志
- PM2 在 Windows 上请始终用 `pm2 start server.js --name xxx`

---

## 十、常见问题排查

### 10.1 MySQL 初始化没有输出密码

**原因**：`data` 目录已存在。

```powershell
net stop MySQL57
Remove-Item -Path D:\MySQL\mysql-5.7.44\data -Recurse -Force
cd D:\MySQL\mysql-5.7.44\bin
.\mysqld --initialize --console
```

### 10.2 弹出 MSVCP140.dll 找不到

安装步骤-4 的 `vc_redist.x64.exe`。

### 10.3 忘记 MySQL root 临时密码

```powershell
net stop MySQL57
cd D:\MySQL\mysql-5.7.44\bin
.\mysqld --skip-grant-tables --console
```

新开 PowerShell 窗口：

```powershell
cd D:\MySQL\mysql-5.7.44\bin
.\mysql.exe -u root
```

【MySQL 命令行】

```sql
ALTER USER 'root'@'localhost' IDENTIFIED BY 'FlowgenDb@2026';
FLUSH PRIVILEGES;
EXIT;
```

回到第一个窗口 `Ctrl+C`，然后 `net start MySQL57`。

### 10.4 首次登录 root 报 ERROR 1820

必须先执行 `ALTER USER` 改密码，再执行 `CREATE DATABASE` 等命令（见步骤-6.2）。

### 10.5 PM2 显示 online 但端口无监听

不要用 `pm2 start npm` 或 `pm2 start node.exe`。改用：

```powershell
cd D:\apps\flowgen-green
pm2 delete flowgen-green
pm2 start server.js --name flowgen-green
```

或先 `node server.js` 前台测试。

### 10.6 curl 无法连接

- 确认 URL 带端口：`http://127.0.0.1:3002/...`（不是 80 端口）
- 确认 `.env.local` 有 `PORT=3002`
- `netstat -ano | findstr :3002` 应有 LISTENING

### 10.7 PM2 输出乱码

```powershell
chcp 65001
pm2 status
```

### 10.8 pm2 startup 报 Init system not found

Windows 正常，用步骤-14 的计划任务方案。

### 10.9 切换蓝绿后图片/资产丢失

**原因**：未配置 `FLOWGEN_DATA_DIR`，或 blue/green 指向了不同路径。

【逐行执行】检查两个 `.env.local`：

```powershell
Select-String -Path D:\apps\flowgen-green\.env.local, D:\apps\flowgen-blue\.env.local -Pattern FLOWGEN_DATA_DIR
```

两行都应显示 `FLOWGEN_DATA_DIR=D:/flowgen-data`。

若历史文件在程序目录下，合并到共享目录后重启：

```powershell
# 若误写在 blue 目录
Copy-Item -Path D:\apps\flowgen-blue\data\flowgen\uploads\* -Destination D:\flowgen-data\uploads\ -Recurse -Force -ErrorAction SilentlyContinue
# 若误写在 green 目录
Copy-Item -Path D:\apps\flowgen-green\data\flowgen\uploads\* -Destination D:\flowgen-data\uploads\ -Recurse -Force -ErrorAction SilentlyContinue
pm2 restart flowgen-blue
pm2 restart flowgen-green
```

### 10.10 资产库 / 封面上传报 `Request Entity Too Large`（413）

**现象**：开发机直连 `localhost:3001` 上传正常；用户经 Nginx（`http://服务器IP/`）上传图片到资产库或封面时，界面提示 **`Request Entity Too Large`**。

**原因**：请求在到达 FlowGen 之前被 **Nginx** 拦截。Nginx 默认 `client_max_body_size` 为 **1MB**，而 FlowGen 后端允许更大（multer 约 80MB）。开发端若未走 Nginx，则不会触发此限制。

**处理**：确认 `D:\nginx\conf\nginx.conf` 的 `http { }` 内包含：

```nginx
client_max_body_size 100m;
```

【逐行执行】

```powershell
cd D:\nginx
.\nginx.exe -t
.\nginx.exe -s reload
```

**验证**：

- 浏览器 F12 → Network，失败请求 Status 应为 **413**（改配置前）。
- 改完 reload 后，同一图片应上传成功。
- 若直连 `http://服务器IP:3001` 可以、走 80 不行，即可确认是 Nginx 限制。

**说明**：步骤-13 的示例 `nginx.conf` 已包含上述配置；若服务器是早期按旧版文档部署的，请手动补上这一行。

---

**文档版本**：2026-06-17（补充 Nginx 上传大小 `client_max_body_size`、413 排查）  
**适用机器**：128GB Ryzen Threadripper + Windows Server 2022  
**软件版本**：Node 22.22.0 + MySQL 5.7.44 + Nginx 1.28.3 + PM2 7.x（离线）+ VC++ Redistributable

如需进一步改造（metadata 行级 + 对象存储），可参考 `docs/architecture-300-concurrent-editors.md`。
