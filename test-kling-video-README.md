# Kling Video API 测试脚本使用说明

## 简介

这是一个基于 Python 测试代码 (`kling_video_test.py`) 实现的 TypeScript 测试脚本，用于测试 Kling AI 视频生成功能。

## 前置要求

1. Node.js 18+ (已内置 fetch, FormData, Blob)
2. 已安装项目依赖: `npm install`
3. 准备两张测试图片（首帧图和尾帧图）

## 使用方法

### 1. 修改图片路径

编辑 `test-kling-video.ts` 文件，修改以下路径为您的实际图片路径：

```typescript
const START_IMAGE_PATH = 'D:/01.jpg';  // 首帧图
const END_IMAGE_PATH = 'D:/02.jpg';    // 尾帧图
```

### 2. 运行测试

```bash
npm run test:kling
```

或者直接使用 tsx：

```bash
npx tsx test-kling-video.ts
```

## 测试流程

脚本会按以下步骤执行：

1. **[1] 上传首帧图** - 将首帧图上传到服务器或转换为 base64
2. **[2] 上传尾帧图** - 将尾帧图上传到服务器或转换为 base64
3. **[3] 图片上传完成** - 显示上传结果
4. **[4] 创建视频生成任务** - 调用 Kling API 创建视频生成任务
5. **[5] 轮询任务状态** - 每 5 秒查询一次任务状态，最多轮询 120 次（10 分钟）
6. **[6] 测试完成** - 显示最终结果（成功或失败）

## 测试参数

默认测试参数：
- **Prompt**: "一个美丽的风景视频，展示从山脚下到山顶的变化过程"
- **Mode**: "pro" (高质量模式)
- **Duration**: "10" (10秒)
- **CfgScale**: 0.7 (生成自由度)
- **Sound**: "off" (无音频)
- **GenerateNum**: 1 (生成数量)

您可以在 `main()` 函数中修改这些参数。

## 预期输出

### 成功情况

```
[+] 上传成功! 图片URL: https://...
[+] 上传成功! 图片URL: https://...
Kling Video: 任务创建成功! Task ID: 189851
[*] 视频生成中... 状态: PROCESSING (尝试 1/120)
...
[OK] 视频生成完成! 视频地址: https://...
[6] 测试完成！视频已生成，地址: https://...
```

### 失败情况

如果任务创建失败或视频生成失败，会显示相应的错误信息。

## 注意事项

1. **图片格式**: 支持 JPG/JPEG 和 PNG 格式
2. **网络连接**: 确保可以访问 `https://aitop100-api.hytch.com`
3. **API Key**: 脚本使用硬编码的 API Key，如需修改请编辑 `services/aitop.ts`
4. **轮询时间**: 视频生成可能需要较长时间，脚本会最多等待 10 分钟
5. **状态处理**: 脚本会正确处理以下状态：
   - `SUCCESS`, `completed`, `FINISHED` - 成功
   - `FAIL`, `failed`, `ERROR` - 失败
   - `PROCESSING`, `RUNNING`, `QUEUED`, `pending`, `NOT_START` - 处理中

## 故障排除

### 问题：图片文件不存在
- 检查图片路径是否正确
- 确保使用绝对路径或相对于项目根目录的路径

### 问题：上传失败
- 检查网络连接
- 检查 API Key 是否有效
- 查看控制台输出的详细错误信息

### 问题：任务状态一直为 NOT_START
- 这是正常现象，表示任务已创建但尚未开始处理
- 脚本会继续轮询直到状态改变或达到最大尝试次数

### 问题：TypeScript 编译错误
- 确保已安装所有依赖: `npm install`
- 确保 Node.js 版本 >= 18

## 相关文件

- `test-kling-video.ts` - 测试脚本主文件
- `services/aitop.ts` - API 服务实现
- `kling_video_test.py` - Python 参考实现

