# 面板参考图持久化修复验证清单

## 问题描述
修复前：拖入面板的本地图片在刷新后会丢失，因为：
1. IndexedDB 写入是异步的，NodeInspector 没有等待完成
2. 如果用户快速刷新，IndexedDB 可能还没写入

## 修复内容
1. **添加 IndexedDB 写入完成通知机制**
   - `dispatchReferenceAppendFiles` 现在返回 Promise
   - `attachLocalReferenceRefs` 完成后触发 `flowgen:reference-files-registered` 事件
   - NodeInspector 等待这个事件后才继续

2. **确保所有调用点都使用 await**
   - `ingestInspectorReferenceLocalFiles` 中所有 `dispatchReferenceAppendFiles` 调用
   - `handleRefUploadInputChange` 改为 async

## 测试步骤

### 测试 1：基础拖入 + 刷新
1. 打开 http://localhost:3001
2. 创建一个新节点（如 Nano Banana 2.0）
3. 在面板拖入 2-3 张本地图片到参考图区域
4. 等待图片显示（压缩完成）
5. **按 F5 刷新页面**
6. **验证**：参考图区域应该显示之前拖入的图片

### 测试 2：运行后 + 刷新
1. 创建一个节点，拖入参考图
2. 在 prompt 中 @ 引用其中一张（如 `@图片1`）
3. 点击运行
4. 等待运行完成
5. **按 F5 刷新**
6. **验证**：
   - 面板应该保留所有参考图（包括未 @ 的）
   - Node Details 应该只显示被 @ 引用的图

### 测试 3：image2 模型
1. 切换到 image2 模型
2. 不设置主图，直接拖入 3 张参考图
3. 第一张应该自动成为主图，后两张成为参考图
4. **按 F5 刷新**
5. **验证**：主图和参考图都应该保留

### 测试 4：Omni 多图参考
1. 切换到可灵 3.0 Omni 模型
2. 选择 multi tab
3. 拖入多张参考图（最多 7 张）
4. **按 F5 刷新**
5. **验证**：所有参考图都应该保留

### 测试 5：快速刷新（压力测试）
1. 拖入图片后**立即**（1秒内）按 F5 刷新
2. **验证**：图片可能会丢失（这是预期的，因为 IndexedDB 写入需要时间）
3. 但如果等待压缩完成（图片显示）后再刷新，图片应该保留

## 如果测试失败

检查浏览器控制台：
1. 是否有 `[flowgen] local reference media IDB write failed` 错误
2. 是否有 IndexedDB 相关错误
3. 检查 Application > IndexedDB > flowgen-local-media-v1 中是否有数据

## 注意事项
- 本机预览仅保存在当前浏览器的 IndexedDB 中
- 换浏览器或清除站点数据后，本地拖入的图片会丢失（这是设计行为）
- 运行后上传到 COS 的图片不受此影响
