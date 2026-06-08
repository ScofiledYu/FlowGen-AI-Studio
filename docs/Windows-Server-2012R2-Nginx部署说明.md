# FlowGen — Windows Server 2012 R2 · Nginx 反向代理

适用：**Windows Server 2012 R2**、FlowGen 程序目录 `D:\apps\flowgen-ai-studio\`、Node 默认端口 **3001**。

**作用**

- 用户统一访问 `http://服务器IP/`（80 端口），不再记 `:3001`
- 更新程序时可 **蓝绿切换**（3001 ↔ 3002），用户几乎无感知

相关文档：

- 首次装机：[Windows-Server-2012R2-离线部署说明.md](./Windows-Server-2012R2-离线部署说明.md)
- 程序更新：[单机部署-relational-简明步骤.md](./单机部署-relational-简明步骤.md)
- 速查：[日常更新速查.md](./日常更新速查.md)

**路径约定**

| 用途 | 路径 |
|------|------|
| Nginx 安装目录 | `D:\nginx\` |
| Nginx 配置 | `D:\nginx\conf\nginx.conf` |
| FlowGen 程序 | `D:\apps\flowgen-ai-studio\` |
| 安装包（U 盘） | `D:\software\` |

**命令怎么复制**

- 【整段复制】— PowerShell 一次粘贴整段
- 【逐行执行】— 一行完成再做下一行
- 【写入文件】— 保存为文件内容，不是 Shell 命令
- 【手动】— 资源管理器或双击，不用命令行

---

# 第一部分：下载与安装（第一次）

## 步骤-1 · 下载 Nginx

Nginx 在 Windows 上**没有安装程序**，官方 zip 解压即用。

| 版本 | 说明 | 下载页 | 直接下载 |
|------|------|--------|----------|
| **Stable 稳定版（推荐）** | 生产环境 | https://nginx.org/en/download.html | https://nginx.org/download/nginx-1.28.3.zip |
| Mainline 主线版 | 更新快，偏测试 | 同上 | https://nginx.org/download/nginx-1.29.7.zip |

**建议：** 服务器用 **Stable 1.28.3**。

离线部署：有网电脑下载 zip → U 盘拷到服务器 `D:\software\`。

---

## 步骤-2 · 解压

【手动】将 `nginx-1.28.3.zip` 解压到 `D:\nginx\`。

解压后目录结构：

```text
D:\nginx\
  ├── conf\nginx.conf      ← 配置文件
  ├── html\
  ├── logs\
  └── nginx.exe            ← 主程序
```

---

## 步骤-3 · 检查 80 端口

装 Nginx 后，用户访问 **`http://服务器IP/`**（80 端口），Nginx 再转发到 Node 的 3001。

【逐行执行】

```powershell
netstat -ano | findstr ":80 "
```

| 结果 | 处理 |
|------|------|
| 无输出 | 80 空闲，继续 |
| 有输出且进程为 System / PID 4 | 可能被 **IIS** 占用 |

若被 IIS 占用，且不需要 IIS：

【逐行执行】

```powershell
iisreset /stop
```

或在「服务器管理器 → 删除角色和功能」中移除 Web 服务器 (IIS)。

---

## 步骤-4 · 写 Nginx 配置（简单模式）

先按「简单模式」配置：用户访问 80 → Nginx 转发到 **3001**。

【写入文件】`D:\nginx\conf\nginx.conf`（整文件替换）

```nginx
worker_processes  1;

events {
    worker_connections  1024;
}

http {
    include       mime.types;
    default_type  application/octet-stream;
    sendfile      on;
    keepalive_timeout  65;

    # 上传大文件（FlowGen 素材/图片）
    client_max_body_size 100m;

    upstream flowgen_backend {
        server 127.0.0.1:3001;
    }

    server {
        listen       80;
        server_name  _;

        location / {
            proxy_pass http://flowgen_backend;
            proxy_http_version 1.1;

            proxy_set_header Host              $host;
            proxy_set_header X-Real-IP         $remote_addr;
            proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;

            # 前端更新后避免 index.html 被浏览器缓存
            proxy_no_cache 1;
            proxy_cache_bypass 1;

            # 长连接 / 流式（AI 对话等）
            proxy_read_timeout 600s;
            proxy_send_timeout 600s;
        }
    }
}
```

【逐行执行】测试配置语法

```powershell
cd D:\nginx
.\nginx.exe -t
```

应看到：

```text
syntax is ok
test is successful
```

---

## 步骤-5 · 启动 FlowGen + Nginx

**前提：** FlowGen 已在 3001 正常运行（与原来启动方式相同）。

【逐行执行】启动 Nginx

```powershell
cd D:\nginx
start nginx
```

【逐行执行】确认进程

```powershell
tasklist | findstr nginx
```

应看到 1～2 个 `nginx.exe` 进程。

---

## 步骤-6 · 开放防火墙

【逐行执行】

```powershell
netsh advfirewall firewall add rule name="Nginx HTTP 80" dir=in action=allow protocol=TCP localport=80
```

若使用云服务器，还需在云平台「安全组」中放行 **TCP 80**。

---

## 步骤-7 · 验收

浏览器访问（**不带 :3001**）：

1. `http://服务器IP/` — 应出现 FlowGen 登录页
2. `http://服务器IP/flowgen-api/health/db` — 应返回 `"ok":true`

| 项目 | 装 Nginx 前 | 装 Nginx 后 |
|------|-------------|-------------|
| 用户访问地址 | `http://IP:3001` | **`http://IP/`** |
| Node 端口 | 3001 | 3001（内部，不变） |
| MySQL / `.env.local` / `data\` | — | **不需要改动** |

---

# 第二部分：常用命令

在 `D:\nginx` 目录下执行：

| 操作 | 命令 |
|------|------|
| 启动 | `start nginx` |
| 停止 | `.\nginx.exe -s stop` |
| 重载配置（不中断服务） | `.\nginx.exe -s reload` |
| 检查配置 | `.\nginx.exe -t` |

**注意：** 优先用 `nginx.exe -s stop` 停止，不要用任务管理器强杀。

---

# 第三部分：开机自动启动（可选，推荐）

Nginx 默认不会随 Windows 自启。

【手动】任务计划程序（`taskschd.msc`）

1. **创建基本任务**
   - 名称：`Nginx`
   - 触发器：**计算机启动时**
   - 操作：**启动程序**
   - 程序：`D:\nginx\nginx.exe`
   - 起始于：`D:\nginx`
2. 完成后右键该任务 → **属性** → 勾选 **使用最高权限运行**

FlowGen 建议同样配置开机任务（沿用原有 `npm start` 命令，端口 3001）。

---

# 第四部分：无感更新（蓝绿部署）

用户**永远只访问 80 端口**；Node 在后台用 **3001 / 3002** 轮换，切换时用户无感知。

## 4.1 双端口版 nginx.conf

【写入文件】`D:\nginx\conf\nginx.conf` 中 `upstream` 部分改为：

**当前线上在 3001（默认）：**

```nginx
upstream flowgen_backend {
    server 127.0.0.1:3001;
    # server 127.0.0.1:3002;
}
```

**切换后线上在 3002：**

```nginx
upstream flowgen_backend {
    # server 127.0.0.1:3001;
    server 127.0.0.1:3002;
}
```

改完后执行：

```powershell
cd D:\nginx
.\nginx.exe -t
.\nginx.exe -s reload
```

---

## 4.2 每次发版流程

假设当前线上是 **3001**，要更新到新版本。

**日常小更新范围（多数情况够用了）：** 至少覆盖 `dist\`；后端有改动再加 `server\`、`utils\persistSanitize.mjs`、`scripts\`、`server.js`。  
**不要覆盖：** `.env.local`、`data\`。  
**不要重复做：** `mysql:migrate-relational`（除非本次发布说明要求迁库）。  
若 `package.json` / `package-lock.json` 有变，覆盖后还要执行 `npm ci --omit=dev`。

### ⓪ 更新前备份（必做）

覆盖新文件前，先复制一份当前能正常跑的程序（回滚用）：

【手动】资源管理器复制整个 `D:\apps\flowgen-ai-studio\` → `D:\backup\flowgen-ai-studio-YYYYMMDD\`

| 建议备份 | 说明 |
|----------|------|
| `dist\`、`server\`、`server.js`、`utils\`、`scripts\`、`package.json` | 回滚程序 |
| **不要**从备份里覆盖回去 `.env.local`、`data\` | 配置和用户上传仍在原目录 |

### ① 覆盖新程序（不停 3001）

【手动】覆盖到 `D:\apps\flowgen-ai-studio\`：

| 必须更新 | 禁止覆盖 |
|----------|----------|
| `dist\` | `.env.local` |
| `server\` | `data\` |
| `utils\persistSanitize.mjs`（若有改） | |
| `scripts\`（若有改） | |
| `server.js`、`package.json`（若有改） | |

若 `package.json` 有变，覆盖后【逐行执行】：

```powershell
cd D:\apps\flowgen-ai-studio
npm ci --omit=dev
```

### ② 启动绿色实例（3002）

【整段复制】新开一个 PowerShell 窗口

```powershell
net start MySQL57
cd D:\apps\flowgen-ai-studio
$env:FLOWGEN_STORAGE = "relational"
$env:NODE_OPTIONS = "--max-old-space-size=8192"
$env:PORT = "3002"
npm start
```

保持此窗口开着。

### ③ 本机验收 3002

浏览器或 PowerShell 检查：

```text
http://127.0.0.1:3002/flowgen-api/health/db
```

必须 `"ok":true`，并抽查登录、打开项目。

### ④ Nginx 切到 3002

修改 `nginx.conf` 的 `upstream` 指向 3002（见 4.1），然后：

```powershell
cd D:\nginx
.\nginx.exe -t
.\nginx.exe -s reload
```

用户仍访问 `http://服务器IP/`，不会变成 3002。

### ⑤ 停掉旧实例

确认用户访问正常后，在 **3001 窗口** 按 **Ctrl+C** 停掉旧进程。

### ⑥ 下次更新

反过来：先起 **3001**，Nginx 切回 3001，再停 3002。如此交替。

---

## 4.3 一键切换脚本（可选）

【写入文件】`D:\nginx\switch-to-3001.bat`

```bat
@echo off
powershell -NoProfile -Command "(Get-Content 'D:\nginx\conf\nginx.conf') -replace 'server 127.0.0.1:3002;', '# server 127.0.0.1:3002;' -replace '# server 127.0.0.1:3001;', 'server 127.0.0.1:3001;' | Set-Content 'D:\nginx\conf\nginx.conf'"
cd /d D:\nginx
nginx.exe -t && nginx.exe -s reload
echo Switched to 3001
pause
```

【写入文件】`D:\nginx\switch-to-3002.bat`

```bat
@echo off
powershell -NoProfile -Command "(Get-Content 'D:\nginx\conf\nginx.conf') -replace 'server 127.0.0.1:3001;', '# server 127.0.0.1:3001;' -replace '# server 127.0.0.1:3002;', 'server 127.0.0.1:3002;' | Set-Content 'D:\nginx\conf\nginx.conf'"
cd /d D:\nginx
nginx.exe -t && nginx.exe -s reload
echo Switched to 3002
pause
```

**说明：** 使用前请确认 `nginx.conf` 里两行 upstream 的写法与 4.1 节一致（一行注释、一行生效），否则 bat 替换可能不匹配。也可手动改 upstream 后只执行 `nginx.exe -s reload`。

---

## 4.4 出问题怎么回滚

蓝绿更新的意义：**先验收、再切换**；切换前旧端口仍在跑，出问题可以很快切回去。

### 情况 A：3002 启动失败，或步骤 ③ 验收不过

| 现象 | 处理 |
|------|------|
| 3002 窗口报错起不来 | **不要切 Nginx**，用户仍走 3001，无影响 |
| `health/db` 不是 `"ok":true` | 同上；修新版本或放弃本次更新 |
| 登录/打开项目异常 | 同上；3001 窗口保持运行 |

此时磁盘上的程序已被新文件覆盖，但 **3001 内存里仍是旧代码**，线上不受影响。

### 情况 B：已切到 3002（步骤 ④），但还没停 3001（步骤 ⑤ 之前）

**最快回滚（推荐，约 10 秒）：**

1. 把 Nginx 指回 3001（改 `nginx.conf` 或运行 `D:\nginx\switch-to-3001.bat`）
2. 【逐行执行】

```powershell
cd D:\nginx
.\nginx.exe -t
.\nginx.exe -s reload
```

3. 用户立刻回到旧版本；在 3002 窗口 **Ctrl+C** 停掉新版本即可

**不必**拷文件、**不必**重启 MySQL。

### 情况 C：已停掉旧实例（步骤 ⑤ 之后）才发现有问题

旧进程已不在内存里，需要用 **步骤 ⓪ 的备份** 恢复：

1. 【手动】用 `D:\backup\flowgen-ai-studio-YYYYMMDD\` 里的 `dist\`、`server\` 等覆盖回 `D:\apps\flowgen-ai-studio\`
2. **不要**覆盖 `.env.local`、`data\`
3. 在空闲端口启动（若当前线上是 3002，则在 3001 起）：

```powershell
cd D:\apps\flowgen-ai-studio
$env:FLOWGEN_STORAGE = "relational"
$env:NODE_OPTIONS = "--max-old-space-size=8192"
$env:PORT = "3001"
npm start
```

4. Nginx 切到该端口 → `nginx.exe -s reload`
5. 确认正常后，停掉有问题的端口实例

### 回滚对照（速查）

| 阶段 | 用户是否受影响 | 怎么回滚 |
|------|----------------|----------|
| 覆盖文件后、未切 Nginx | 否 | 不切 Nginx；可选放弃 3002 |
| 已切 Nginx、旧端口还在 | 可能已受影响 | Nginx 切回旧端口 + reload |
| 旧端口已停 | 是 | 用备份覆盖 + 重启旧版本 |

---

# 第五部分：常见问题

| 现象 | 处理 |
|------|------|
| `nginx.exe -t` 报错 | 检查 `nginx.conf` 有无中文标点、括号是否配对 |
| 启动后立刻退出 | 80 被占用 → `netstat -ano \| findstr ":80 "` 查占用进程 |
| 502 Bad Gateway | FlowGen 未启动 → 确认 3001/3002 对应实例在跑 |
| 页面还是旧的 | 浏览器 Ctrl+F5；确认 `dist\` 已覆盖 |
| 访问 80 不通 | 检查 Windows 防火墙 + 云安全组是否放行 80 |
| 用户仍访问 :3001 | 正常，3001 仍可直连调试；对外宣传统一用 `http://IP/` |
| 更新后 502 / 白屏 | 见 [4.4 出问题怎么回滚](#44-出问题怎么回滚)；优先 Nginx 切回旧端口 |
| 切回旧版后页面仍异常 | Ctrl+F5；确认备份已正确覆盖 `dist\` |

---

# 附录：与现有部署的关系

```text
用户浏览器
    │
    ▼  http://服务器IP/  (80)
  Nginx (D:\nginx\)
    │
    ▼  转发到 127.0.0.1:3001 或 3002
  FlowGen (D:\apps\flowgen-ai-studio\, npm start)
    │
    ▼
  MySQL (MySQL57, 3306)
```

- **首次装 Nginx：** 按第一部分步骤 1～7 即可
- **日常小更新：** 可先只用简单模式（始终 3001）；需要无感更新时再启用第四部分蓝绿流程
- **程序更新细节：** 见 [单机部署-relational-简明步骤.md · 以后只发程序小更新](./单机部署-relational-简明步骤.md#以后只发程序小更新不要再-migrate)
