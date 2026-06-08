# MySQL 部署指南（FlowGen AI Studio）

本文说明在 **Windows 10 开发机** 与 **Windows Server 2012 R2 生产机** 上安装 **同一版本 MySQL**，并将 FlowGen **业务数据**（用户、项目、成员、工作区、资产元数据、字段定义、聊天记录等）持久化到 MySQL。**上传文件**仍保存在 `FLOWGEN_DATA_DIR`（默认 `data/flowgen/uploads/`）。

---

## 1. 版本选型

| 项目 | 说明 |
|------|------|
| **推荐版本** | **MySQL Community Server 5.7.44**（5.7 最终 GA） |
| **原因** | MySQL **8.0+** 官方安装包**不再支持** Windows Server 2012 / 2012 R2；5.7 在 Win10 与 WS2012 R2 上均有官方 Windows x64 包 |
| **架构** | 64 位系统使用 **winx64**；仅 32 位系统才选 win32 |
| **替代** | 若 5.7 安装失败，可评估 **MariaDB 10.5 LTS**（需单独验证与 `mysql2` 驱动兼容性） |

---

## 2. 安装包路径（复制到 WS2012 R2 用）

将下列文件从开发机拷到服务器（**安装包本身**，不是 `D:\MySQL\` 运行目录）：

| 完整路径 | 大小（约） | 用途 |
|----------|------------|------|
| `D:\tools\mysql\mysql-5.7.44-winx64.zip` | 336.5 MB（352,891,656 字节） | **推荐**：ZIP 绿色包，WS2012 R2 与 Win10 统一版本 |
| `D:\tools\mysql\mysql-installer-web-community-5.7.44.0.msi` | 2.1 MB（2,240,512 字节） | 可选：Win10 图形安装（在线拉组件） |

若目录缺失，从归档重新下载：

- ZIP：https://downloads.mysql.com/archives/get/p/23/file/mysql-5.7.44-winx64.zip  
- Installer 归档：https://downloads.mysql.com/archives/installer/?version=5.7.44  

---

## 3. Windows Server 2012 R2 安装步骤（ZIP）

以下路径示例使用 `D:\MySQL\mysql-5.7.44-winx64`，可按机房规范调整。

### 3.1 解压

```powershell
New-Item -ItemType Directory -Force -Path D:\MySQL
Expand-Archive -Path D:\tools\mysql\mysql-5.7.44-winx64.zip -DestinationPath D:\MySQL
# 解压后目录名一般为 mysql-5.7.44-winx64
```

### 3.2 配置文件 `my.ini`

在 `D:\MySQL\mysql-5.7.44-winx64\my.ini` 创建：

```ini
[mysqld]
basedir=D:/MySQL/mysql-5.7.44-winx64
datadir=D:/MySQL/data57
port=3306
character-set-server=utf8mb4
collation-server=utf8mb4_unicode_ci
default-storage-engine=INNODB
max_allowed_packet=64M
sql_mode=NO_ENGINE_SUBSTITUTION,STRICT_TRANS_TABLES

[client]
port=3306
default-character-set=utf8mb4
```

### 3.3 初始化数据目录（首次）

以**管理员** PowerShell：

```powershell
cd D:\MySQL\mysql-5.7.44-winx64\bin
.\mysqld.exe --defaults-file=D:\MySQL\mysql-5.7.44-winx64\my.ini --initialize-insecure
```

> `--initialize-insecure` 会创建无密码的 `root@localhost`，**务必**在首次启动后立即设置强密码。

### 3.4 安装并启动 Windows 服务

```powershell
.\mysqld.exe --install MySQL57 --defaults-file=D:\MySQL\mysql-5.7.44-winx64\my.ini
net start MySQL57
```

### 3.5 设置 root 与业务账号

```sql
-- 在 bin 目录执行: mysql -u root -p
ALTER USER 'root'@'localhost' IDENTIFIED BY '你的强密码';
CREATE DATABASE flowgen CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'flowgen'@'localhost' IDENTIFIED BY '业务库密码';
CREATE USER 'flowgen'@'127.0.0.1' IDENTIFIED BY '业务库密码';
GRANT ALL PRIVILEGES ON flowgen.* TO 'flowgen'@'localhost';
GRANT ALL PRIVILEGES ON flowgen.* TO 'flowgen'@'127.0.0.1';
FLUSH PRIVILEGES;
```

若需局域网内其他机器访问，再增加 `'flowgen'@'192.168.%'` 等主机限制，**勿**使用 `'%'` 弱限制，除非有防火墙与 VPN 保护。

### 3.6 防火墙

在「高级安全 Windows 防火墙」中为 **入站 TCP 3306** 添加规则（仅内网网段），或仅允许应用服务器 IP 访问数据库机。

---

## 4. flowgen-ai-studio 环境变量

复制 `.env.example` 为 `.env.local`（已在 `.gitignore` 的 `*.local` 中，**勿提交密码**）：

```env
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=flowgen
MYSQL_PASSWORD=你的业务库密码
MYSQL_DATABASE=flowgen

# 业务数据：设置 MYSQL_PASSWORD 后默认 mysql；强制 JSON 开发可设：
# FLOWGEN_STORAGE=json
# FLOWGEN_STORAGE=mysql
```

| 变量 | 说明 |
|------|------|
| `MYSQL_*` | 连接池；**必须**设 `MYSQL_PASSWORD` 才启用 MySQL |
| `FLOWGEN_STORAGE` | `mysql` 或 `json`；未设置且已配置 `MYSQL_PASSWORD` 时**默认 mysql** |
| `FLOWGEN_DATA_DIR` | 上传目录与（JSON 模式下的）`store.json` 路径 |

---

## 5. 存储架构

- **MySQL 模式**：与 `store.json` 同构的快照写入 `flowgen_store_chunk`（gzip 后按约 900KB 分片，适配默认 `max_allowed_packet=4MB`）。进程内缓存 + 写请求串行落库；**上传二进制**仍在磁盘。
- **JSON 模式**：`data/flowgen/store.json`（无 `MYSQL_PASSWORD` 或 `FLOWGEN_STORAGE=json`）。
- **探活**：`GET /flowgen-api/health/db` 返回 `storage: "mysql"|"json"` 与 MySQL 连通性。

---

## 6. 初始化与从 JSON 迁移

在应用目录（已 `npm install`）：

```powershell
cd D:\aaa\flowgen-ai-studio
npm run mysql:init
npm run test:mysql
```

若存在旧版 `data/flowgen/store.json` 且需导入 MySQL：

**服务器路径：** `D:\apps\flowgen-ai-studio\data\flowgen\store.json`（上传文件同目录下的 `uploads\`）。  
**运维步骤（停 FlowGen 后）：** 见 `docs/Windows-Server-2012R2-离线部署说明.md` 第二节。

```powershell
cd D:\apps\flowgen-ai-studio
npm run mysql:migrate
```

- 成功前会自动备份为 `store.json.bak-<时间戳>`  
- 若 MySQL 已有用户/项目数据则跳过；**强制覆盖：**

```powershell
$env:FORCE_MIGRATE = "1"
npm run mysql:migrate
Remove-Item Env:FORCE_MIGRATE -ErrorAction SilentlyContinue
```

---

## 7. 启动应用并验证

```powershell
npm start
```

```powershell
curl -s http://localhost:3001/flowgen-api/health/db
curl -s -X POST http://localhost:3001/flowgen-api/auth/login -H "Content-Type: application/json" -d "{\"username\":\"admin\",\"password\":\"admin\"}"
```

期望 `health/db` 示例（MySQL 模式）：

```json
{
  "ok": true,
  "storage": "mysql",
  "mysql": {
    "configured": true,
    "version": "5.7.44",
    "database": "flowgen",
    "tableCount": 3
  }
}
```

登录返回 `token` 后：

```powershell
curl -s http://localhost:3001/flowgen-api/projects -H "Authorization: Bearer <token>"
```

---

## 8. 生产部署检查清单

1. 安装 MySQL 5.7.44（ZIP 与开发机一致）  
2. 创建库 `flowgen` 与用户 `flowgen`  
3. 部署应用 + `.env.local`（含 `MYSQL_PASSWORD`，不设 `FLOWGEN_STORAGE=json`）  
4. `npm run mysql:init`  
5. 若有旧 JSON：`npm run mysql:migrate`  
6. `npm run build`（若含前端变更）→ `npm start`  
7. 验证 `health/db` 与登录、项目列表  

---

## 9. 本地开发机（Windows 10）说明

本机可安装与生产相同的 **5.7.44 ZIP**（服务名如 `MySQL57`）。若另有 **MySQL 8.0**（`MySQL80`），**不要**与 5.7 同时占用 **3306**：二选一，或 5.7 改 `port=3307` 并同步 `MYSQL_PORT`。

无 MySQL 时设 `FLOWGEN_STORAGE=json` 或不要配置 `MYSQL_PASSWORD`，仍用 JSON 文件。

---

## 10. 故障排查

| 现象 | 处理 |
|------|------|
| `Can't connect ... (10061)` | 服务未启动：`net start MySQL57`；检查 `my.ini` 中 `port` |
| `Access denied for user` | 核对 `MYSQL_USER` / `MYSQL_PASSWORD`；`FLUSH PRIVILEGES` |
| 8.0 与 5.7 争用 3306 | 停止不需要的服务，或修改其一端口 |
| `health/db` 显示 `storage: json` | 检查 `.env.local` 是否含 `MYSQL_PASSWORD`；是否设了 `FLOWGEN_STORAGE=json` |
| 启动报 Store not initialized | 确认 `server.js` / `flowgenApiOnly.mjs` 已 `await initStore()` |
| `mysql:migrate` 跳过 | MySQL 已有数据；需覆盖时 `FORCE_MIGRATE=1` |

错误日志默认在 `datadir` 下 `*.err`（例如 `D:\MySQL\data57\主机名.err`）。

---

## 11. 参考

- MySQL 5.7 Windows 安装：https://dev.mysql.com/doc/refman/5.7/en/windows-installation.html  
- 支持平台：https://www.mysql.com/support/supportedplatforms/database.html  
- 项目总览：[`部署说明.md`](../部署说明.md)

---

## 12. 多客户端容量与硬件

生产环境在 **8～20 人同时编辑** 时，建议 **8 核 / 16GB / SSD**，并设置：

```powershell
$env:NODE_OPTIONS = "--max-old-space-size=8192"
```

压测与分级建议见 **[`capacity-and-hardware.md`](./capacity-and-hardware.md)**，包括：

- `npm run test:multi-client` 多客户端 workspace 压测  
- `NODE_OPTIONS`、MySQL `innodb_buffer_pool_size` 建议  
- 409 版本冲突（同用户多标签）说明  
- 超出 ~35 人时的架构限制

更新后可在服务器执行：

```powershell
node scripts/e2e-setup-test-users.mjs
npm run test:multi-client
```
