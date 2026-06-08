# 多客户端容量与硬件建议

> **目标 300 人同时制作？** 当前快照架构 **无法满足**，需先完成关系型改造，见 **[`architecture-300-concurrent-editors.md`](./architecture-300-concurrent-editors.md)**。  
> 本文描述的是 **现网快照模式（`FLOWGEN_STORAGE=mysql`）** 的实测上限与运维建议。

---

## 1. 当前架构约束

| 项 | 说明 |
|----|------|
| 应用进程 | **单 Node.js 进程**，全量业务数据常驻内存（`store.json` 同构对象） |
| 持久化 | 每次落库对 **整库** `JSON.stringify` → gzip → MySQL 分片写入 |
| 多用户隔离 | workspace 按 **`byUser[userId]`** 分片，**不同用户并行保存互不抢版本号** |
| 版本冲突 | **同一用户** 多标签页/多实例同时 PUT 可能 `409 版本冲突`；前端 `putWorkspace` 已自动重试最多 5 次 |
| 自动保存 | 客户端远程保存 **10s 防抖**；批处理/全部运行期间暂停；大 `data:` 媒体不入库 |

---

## 2. 压测结果摘要（本机 MySQL）

命令示例：

```powershell
cd D:\aaa\flowgen-ai-studio
node scripts/e2e-setup-test-users.mjs
npm run test:multi-client
# 加重：$env:CLIENTS=16; $env:ROUNDS=10; npm run test:multi-client
# 极限同账号并发：$env:BURST=1; $env:PUT_INTERVAL_MS=0; npm run test:multi-client
```

| 场景 | 客户端×轮次 | 失败率 | p95 延迟 | 结论 |
|------|-------------|--------|----------|------|
| 常规（模拟 10s 防抖） | 8×5 | **0%** | ~400ms | 通过 |
| 中等负载 | 12×8 | **0.35%** | ~280ms | 通过（偶发 409 后重试成功） |
| 高负载 | **16×10** | **0%** | ~94ms | 通过 |
| 极限 burst（同账号多实例同时 PUT） | 12×8 | ~12% PUT 失败 | ~450ms | **预期内**；真实产品应每用户单会话或依赖 409 重试 |

额外验证：`npm run test:e2e:isolation` **11/11 通过**（聊天/资产隔离未回归）。

---

## 3. 推荐并发规模（经验值）

以下为 **同时在线编辑同一 FlowGen 实例** 的保守建议（含 AI 生成、浏览器内存，非纯 API QPS）：

| 同时活跃编辑人数 | 服务器 CPU | 内存 | 磁盘 | 备注 |
|------------------|------------|------|------|------|
| **1～8 人** | 4 核 | **8 GB** | SSD 100GB+ | 小团队 / 试点；设 `NODE_OPTIONS=--max-old-space-size=8192` |
| **8～20 人** | **8 核** | **16 GB** | SSD 200GB+ | 当前生产推荐档位（如 10.98.98.211） |
| **20～35 人** | 16 核 | **32 GB** | NVMe | 需严格限制工程体积；监控 Node RSS；定期 mysqldump |
| **>35 人** | — | — | — | **不建议** 仅横向加硬件；需架构改造（见 §6） |

说明：

- **「活跃编辑」** 指打开项目画布、周期性自动保存、偶发批处理/生成；不是纯只读浏览。
- AI 视频/图像任务主要消耗 **外网 API 与客户端浏览器内存**，服务端瓶颈通常在 **整库序列化 + MySQL 写快照**。
- 单项目节点建议 **≤500**（代码上限 `FLOW_MAX_PERSISTED_NODES`）；缩略图/故事板勿堆 `data:` Base64（已自动清洗）。

---

## 4. 生产环境必配项

### 4.1 Node 堆上限（防 OOM）

PowerShell 启动前：

```powershell
$env:NODE_OPTIONS = "--max-old-space-size=8192"
$env:PORT = "3001"
npm start
```

或写入计划任务/PM2 ecosystem：

```json
{
  "apps": [{
    "name": "flowgen-ai-studio",
    "script": "server.js",
    "env": {
      "PORT": "3001",
      "NODE_OPTIONS": "--max-old-space-size=8192"
    }
  }]
}
```

### 4.2 MySQL

`my.ini` 建议（在默认 5.7 配置基础上）：

```ini
max_allowed_packet=64M
innodb_buffer_pool_size=1G
```

- 业务库与应用 **同机** 时，Node 8GB + MySQL 1GB buffer 适合 16GB 物理机。
- 定期备份：`mysqldump flowgen` + `data/flowgen/uploads/`（见 WS2012R2 部署文档）。

### 4.3 客户端侧

- 同一账号 **避免多标签同时编辑同一项目**；若必须，409 会自动重试，但可能丢最后一次未合并的编辑。
- 大工程请用 **「保存工程」导出 JSON 文件** 作冷备份。

---

## 5. 运维自检命令

```powershell
# 数据库与存储模式
curl -s http://localhost:3001/flowgen-api/health/db

# 多客户端模拟（需先 e2e-setup-test-users）
npm run test:multi-client

# 用户/聊天/资产隔离
npm run test:e2e:isolation
```

---

## 6. 超出单机能力时（规划）

当前设计 **不适合** 通过简单「加机器」水平扩展：

- 全库单快照、单进程内存缓存；
- workspace PUT 与 GET 共享同一 `store` 对象。

若需 **>35 并发编辑** 或 **单库 >2GB JSON**，需产品级改造，例如：

- workspace / 用户 / 项目 **分表** 增量写入，而非整库 stringify；
- 上传资产与画布元数据分离；
- 只读副本 + 主写分离。

**300 人同时制作的完整分阶段方案**（API/功能不变）：[`architecture-300-concurrent-editors.md`](./architecture-300-concurrent-editors.md)

## 7. 相关文档

- MySQL 安装与迁移：[`mysql-deployment.md`](./mysql-deployment.md)
- Windows Server 2012 R2 离线部署：[`Windows-Server-2012R2-离线部署说明.md`](./Windows-Server-2012R2-离线部署说明.md)
- 防 OOM 持久化清洗：`utils/persistSanitize.mjs`
- **300 人同时制作架构改造**：[`architecture-300-concurrent-editors.md`](./architecture-300-concurrent-editors.md)
