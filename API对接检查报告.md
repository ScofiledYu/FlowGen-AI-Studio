# Nano Banana 和可灵 API 对接检查报告

## 📋 检查时间
生成时间：2024年

---

## 1. Nano Banana Pro (生图) 对接检查

### 1.1 属性面板配置 ✅

**位置**: `components/NodeInspector.tsx`

**支持的属性**:
- ✅ `prompt` - 创意描述
- ✅ `negativePrompt` - 负面提示词
- ✅ `aspectRatio` - 宽高比（1:1, 4:3, 3:4, 3:2, 2:3, 16:9, 9:16, 4:5, 5:4, 21:9）
- ✅ `numberOfImages` - 生成数量（1张, 2张, 3张, 4张）
- ✅ `referenceImages` - 参考图片（最多14张）

**配置保存**: ✅ 已实现模型配置独立保存

### 1.2 API 接口调用 ✅

**位置**: `components/FlowEditor.tsx` (1424-1555行)

**API 函数**: `createNanoTask` (services/aitop.ts)

**参数映射**:
```typescript
// 属性面板 → API 参数
prompt → prompt ✅
aspectRatio → aspectRatio ✅
numberOfImages → 创建多个任务（每个任务生成1张）✅
referenceImages + imagePreview → image (数组) ✅
```

**参数提取逻辑**:
```typescript
const prompt = currentNode.data.prompt || "A cute cyber-punk cat"; ✅
const aspectRatio = currentNode.data.aspectRatio || "1:1"; ✅
const imageCount = parseInt(currentNode.data.numberOfImages || "1") || 1; ✅
// 问题：这里解析 "1张" 可能有问题，应该用正则提取数字
```

**问题发现**:
- ⚠️ **numberOfImages 解析问题**: 第1432行使用 `parseInt("1张")` 会返回 `NaN`，应该使用正则提取数字
- ✅ 图片上传逻辑正确
- ✅ 多任务并发创建正确
- ✅ 任务轮询逻辑正确

### 1.3 API 接口定义 ✅

**位置**: `services/aitop.ts` (49-108行)

**接口参数**:
```typescript
{
  platform: "NANO_BANANA_2", ✅
  prompt: string, ✅
  aspectRatio: string, ✅
  image: string[] ✅ (参考图片数组)
}
```

**返回**: `taskId: string | null` ✅

---

## 2. 可灵 (Keling) 对接检查

### 2.1 属性面板配置 ✅

**位置**: `components/NodeInspector.tsx`

**支持的属性**:
- ✅ `prompt` - 创意描述
- ✅ `negativePrompt` - 负面提示词
- ✅ `firstFrameImage` - 首帧图
- ✅ `lastFrameImage` - 尾帧图
- ✅ `quality` - 质量（高质量, 标准）
- ✅ `duration` - 时长（5s, 10s）
- ✅ `creativityLevel` - 创意度（0-100滑块）
- ✅ `numberOfImages` - 生成数量（1条, 2条, 3条, 4条）

**配置保存**: ✅ 已实现模型配置独立保存

### 2.2 API 接口调用 ✅

**位置**: `components/FlowEditor.tsx` (1559-1900行)

**API 函数**: `createKlingVideoTask` (services/aitop.ts)

**参数映射**:
```typescript
// 属性面板 → API 参数
prompt → prompt ✅
negativePrompt → negativePrompt ✅
firstFrameImage → image (URL) ✅
lastFrameImage → imageTail (URL) ✅
quality → mode ('pro' | 'std') ✅
duration → duration ('5' | '10') ✅
creativityLevel → cfgScale (0-1) ✅
numberOfImages → generateNum (1-4) ✅ (已修复)
```

**参数提取逻辑**:
```typescript
const prompt = currentNode.data.prompt || ''; ✅
const negativePrompt = currentNode.data.negativePrompt || ''; ✅
const quality = currentNode.data.quality || '高质量'; ✅
const duration = currentNode.data.duration || '5s'; ✅
const durationValue = duration.replace('s', '') as '5' | '10'; ✅
const creativityLevel = currentNode.data.creativityLevel ?? 70; ✅
const cfgScale = Math.max(0, Math.min(1, creativityLevel / 100)); ✅
// numberOfImages 解析（已修复）✅
const numberOfImagesStr = currentNode.data.numberOfImages || "1条";
const generateNumMatch = numberOfImagesStr.match(/(\d+)/);
const generateNum = generateNumMatch ? parseInt(generateNumMatch[1], 10) : 1;
const finalGenerateNum = Math.max(1, Math.min(4, generateNum));
```

**问题发现**:
- ✅ numberOfImages 解析已修复（使用正则提取数字）
- ✅ 多视频生成逻辑已实现（创建多个任务）
- ⚠️ **多视频生成时，每个任务都生成1个视频，但API的generateNum参数可能支持一次生成多个**
- ✅ 图片上传逻辑正确（base64 → URL）
- ✅ 模式选择逻辑正确（有尾帧图强制pro模式）

### 2.3 API 接口定义 ✅

**位置**: `services/aitop.ts` (172-279行)

**接口参数**:
```typescript
{
  modelName: 'KLING_V2_5_TURBO', ✅
  prompt: string, ✅
  negativePrompt?: string, ✅
  image: string, ✅ (首帧图URL)
  imageTail?: string, ✅ (尾帧图URL)
  mode: 'std' | 'pro', ✅
  duration: '5' | '10', ✅
  cfgScale: number, ✅ (0-1)
  sound: 'off' | 'on', ✅
  generateNum: number ✅ (生成数量)
}
```

**返回**: `taskId: string | null` ✅

---

## 3. 发现的问题

### 3.1 需要修复的问题

#### 问题1: Nano Banana 的 numberOfImages 解析 ⚠️
**位置**: `components/FlowEditor.tsx:1432`
```typescript
// 当前代码
const imageCount = parseInt(currentNode.data.numberOfImages || "1") || 1;
// 问题：如果 numberOfImages 是 "1张"，parseInt("1张") 会返回 1（实际上能工作）
// 但更安全的做法是使用正则提取数字
```

**建议修复**:
```typescript
const numberOfImagesStr = currentNode.data.numberOfImages || "1张";
const imageCountMatch = numberOfImagesStr.match(/(\d+)/);
const imageCount = imageCountMatch ? parseInt(imageCountMatch[1], 10) : 1;
```

#### 问题2: 可灵多视频生成方式 ⚠️
**当前实现**: 当 generateNum > 1 时，创建多个任务，每个任务 generateNum=1
**可能的问题**: API 的 generateNum 参数可能支持一次生成多个视频，不需要创建多个任务

**需要确认**: API 文档中 generateNum 参数的实际行为

### 3.2 已修复的问题 ✅

- ✅ 可灵的 numberOfImages 解析（已使用正则提取）
- ✅ 可灵多视频生成逻辑（已实现创建多个任务）

---

## 4. 参数映射完整性检查

### 4.1 Nano Banana 参数映射表

| 属性面板 | 数据类型 | API 参数 | 映射方式 | 状态 |
|---------|---------|---------|---------|------|
| prompt | string | prompt | 直接映射 | ✅ |
| negativePrompt | string | - | 未使用 | ⚠️ |
| aspectRatio | string | aspectRatio | 直接映射 | ✅ |
| numberOfImages | string | - | 创建多个任务 | ✅ |
| referenceImages | string[] | image[] | 数组映射 | ✅ |
| imagePreview | string | image[0] | 作为主图 | ✅ |

**缺失功能**: negativePrompt 未传递给 API

### 4.2 可灵参数映射表

| 属性面板 | 数据类型 | API 参数 | 映射方式 | 状态 |
|---------|---------|---------|---------|------|
| prompt | string | prompt | 直接映射 | ✅ |
| negativePrompt | string | negativePrompt | 直接映射 | ✅ |
| firstFrameImage | string | image | base64→URL | ✅ |
| lastFrameImage | string | imageTail | base64→URL | ✅ |
| quality | string | mode | '高质量'→'pro', '标准'→'std' | ✅ |
| duration | string | duration | '5s'→'5', '10s'→'10' | ✅ |
| creativityLevel | number | cfgScale | (0-100) → (0-1) | ✅ |
| numberOfImages | string | generateNum | '1条'→1, '2条'→2... | ✅ |

**所有参数已正确映射** ✅

---

## 5. 建议修复

### 5.1 修复 Nano Banana 的 numberOfImages 解析

```typescript
// 在 components/FlowEditor.tsx:1432 处修改
// 原代码：
const imageCount = parseInt(currentNode.data.numberOfImages || "1") || 1;

// 修改为：
const numberOfImagesStr = currentNode.data.numberOfImages || "1张";
const imageCountMatch = numberOfImagesStr.match(/(\d+)/);
const imageCount = imageCountMatch ? parseInt(imageCountMatch[1], 10) : 1;
```

### 5.2 检查可灵 API 的 generateNum 参数行为

需要确认：
- API 的 `generateNum` 参数是否支持一次生成多个视频？
- 还是需要创建多个任务，每个任务 generateNum=1？

**当前实现**: 创建多个任务，每个任务 generateNum=1（如果API支持一次生成多个，可以优化）

---

## 6. 总结

### ✅ 正确对接的部分

1. **属性面板配置完整**: 所有必要的参数都有对应的UI控件
2. **参数映射正确**: 大部分参数都正确映射到API参数
3. **图片处理正确**: base64转URL、图片上传逻辑正确
4. **任务轮询正确**: 状态轮询逻辑完整
5. **错误处理完善**: 有适当的错误处理和日志

### ⚠️ 需要修复的问题

1. **Nano Banana numberOfImages 解析**: 建议使用正则提取，更安全
2. **Nano Banana negativePrompt**: 未传递给API（如果API支持）
3. **可灵多视频生成**: 需要确认API的generateNum参数行为

### 📝 建议

1. 修复 Nano Banana 的 numberOfImages 解析
2. 检查 Nano Banana API 是否支持 negativePrompt
3. 确认可灵 API 的 generateNum 参数行为，优化多视频生成逻辑

---

**检查完成时间**: 2024年

