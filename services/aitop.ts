import { remoteMediaUrlPreferSameOriginProxy } from '../utils/remoteMediaFetch';
import { IMAGE2_MAX_API_IMAGES, AITOP_PLATFORM_IMAGE_2 } from '../utils/image2Model';
import { AITOP_PLATFORM_NANO_BANANA_2 } from '../types';
import {
  getAitopBillingContext,
  buildAitopBillingQuery,
  type AitopBillingContext,
} from '../utils/aitopBilling';

export {
  setAitopBillingContext,
  getAitopBillingContext,
  type AitopBillingContext,
} from '../utils/aitopBilling';

const API_KEY = "aitop-key-4MGEBAFEArM3HRaJ0P77EkhEAtxseJma";
const BASE_URL = "https://aitop100-api.hytch.com";
const FILE_PREFIX = "https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/";

function aitopJsonHeaders(): Record<string, string> {
  const ctx = getAitopBillingContext();
  const h: Record<string, string> = {
    'api-key': API_KEY,
    'Content-Type': 'application/json',
  };
  if (ctx?.domainAccount) h['domain-account'] = ctx.domainAccount;
  return h;
}

function aitopUploadHeaders(): Record<string, string> {
  const ctx = getAitopBillingContext();
  const h: Record<string, string> = { 'api-key': API_KEY };
  if (ctx?.domainAccount) h['domain-account'] = ctx.domainAccount;
  return h;
}

function withScoreProjectId(payload: object): object {
  const ctx = getAitopBillingContext();
  if (ctx?.scoreProjectId) {
    return { ...payload, scoreProjectId: ctx.scoreProjectId };
  }
  return payload;
}

/** 默认关闭；控制台执行 `window.__FLOWGEN_DEBUG_PRELOAD__ = true` 开启 preload JSON 日志 */
export function isPreloadDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as Window & { __FLOWGEN_DEBUG_PRELOAD__?: boolean };
  return w.__FLOWGEN_DEBUG_PRELOAD__ === true;
}

/** 控制台打印 JSON preload（每次发往 AITOP 只打一条，含 domainAccount / scoreProjectId） */
export function logPreloadJson(payload: Record<string, unknown>) {
  if (!isPreloadDebugEnabled()) return;
  console.info('[flowgen:preload]', JSON.stringify(payload, null, 2));
}

function billingFieldsForLog(): { domainAccount?: string; scoreProjectId?: string } {
  const ctx = getAitopBillingContext();
  if (!ctx) return {};
  const out: { domainAccount?: string; scoreProjectId?: string } = {};
  if (ctx.domainAccount) out.domainAccount = ctx.domainAccount;
  if (ctx.scoreProjectId) out.scoreProjectId = ctx.scoreProjectId;
  return out;
}

function headersForLog(headers: Record<string, string>): Record<string, string> {
  const h = { ...headers };
  if (h['api-key']) h['api-key'] = '***';
  return h;
}

/** 并行多任务时仅首条 clientBatchIndex 打印完整 preload（body 含 clientBatchTotal） */
export function shouldLogAitopModelPreloadBody(body: unknown): boolean {
  if (!body || typeof body !== 'object') return true;
  const b = body as Record<string, unknown>;
  const total = typeof b.clientBatchTotal === 'number' ? b.clientBatchTotal : undefined;
  const idx = typeof b.clientBatchIndex === 'number' ? b.clientBatchIndex : undefined;
  if (total != null && total > 1 && idx != null && idx > 1) return false;
  return true;
}

/** 仅模型创建任务（生图/生视频等）打印一条 preload；上传、轮询等辅助请求不打 */
function logAitopModelRequest(spec: {
  model: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
}) {
  logAitopOutgoingRequest(spec);
}

function logAitopOutgoingRequest(spec: {
  model: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
  query?: Record<string, string>;
}) {
  if (!isPreloadDebugEnabled()) return;
  if (spec.body !== undefined && !shouldLogAitopModelPreloadBody(spec.body)) return;
  logPreloadJson({
    debugType: 'preload',
    model: spec.model,
    method: spec.method,
    url: spec.url,
    ...billingFieldsForLog(),
    headers: headersForLog(spec.headers),
    ...(spec.query && Object.keys(spec.query).length ? { query: spec.query } : {}),
    ...(spec.body !== undefined ? { body: compactAitopPreloadBodyForLog(spec.body) } : {}),
  });
}

/** snake_case → camelCase（仅用于识别 AiTop 双写冗余键） */
function snakeCaseKeyToCamelCase(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/**
 * preload 日志去重：同层已有 camelCase 时省略 snake_case 副本。
 * 真实 HTTP 请求体仍双写；仅控制台 JSON 更干净。
 */
export function compactAitopPreloadBodyForLog(body: unknown): unknown {
  if (body === null || typeof body !== 'object') return body;
  if (Array.isArray(body)) return body.map(compactAitopPreloadBodyForLog);
  const src = body as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(src)) {
    if (key.includes('_')) {
      const camel = snakeCaseKeyToCamelCase(key);
      if (camel !== key && camel in src) continue;
    }
    out[key] = compactAitopPreloadBodyForLog(value);
  }
  return out;
}

// Helper to convert URL/Base64 to Blob for Upload
async function getBlobFromUrl(url: string): Promise<Blob> {
  const trimmed = (url || '').trim();
  if (trimmed) {
    try {
      const { isFlowgenProtectedAssetFileUrl, getAssetFileBlob, stripAssetAccessTokenFromUrl } =
        await import('./flowgenApi');
      if (isFlowgenProtectedAssetFileUrl(trimmed)) {
        return await getAssetFileBlob(stripAssetAccessTokenFromUrl(trimmed));
      }
    } catch {
      /* 非鉴权素材或拉取失败时走下方通用 fetch */
    }
  }

  if (remoteMediaUrlPreferSameOriginProxy(url)) {
    const proxyResp = await fetch(`/proxy-file?url=${encodeURIComponent(url)}`).catch((e) => {
      throw e instanceof Error ? e : new Error(String(e));
    });
    if (proxyResp.ok) return await proxyResp.blob();
    throw new Error(`fetch failed (same-origin proxy): ${proxyResp.status}`);
  }

  let fetchErr: unknown = null;
  const direct = await fetch(url).catch((e) => {
    fetchErr = e;
    return null;
  });
  if (direct?.ok) {
    return await direct.blob();
  }

  // 远程地址在浏览器侧可能受 CORS 限制；回退同源代理拉取
  const isHttpLike = /^https?:\/\//i.test(url);
  if (isHttpLike) {
    const proxyResp = await fetch(`/proxy-file?url=${encodeURIComponent(url)}`).catch((e) => {
      if (fetchErr instanceof Error) throw fetchErr;
      throw e instanceof Error ? e : new Error(String(e));
    });
    if (proxyResp.ok) return await proxyResp.blob();
  }

  if (direct && !direct.ok) {
    throw new Error(`fetch failed: ${direct.status} ${direct.statusText}`);
  }
  if (fetchErr instanceof Error) throw fetchErr;
  throw new Error('fetch failed');
}

function formatAitopFileUploadFailureDetail(response: Response, data: unknown): string {
  const lines: string[] = [`**HTTP状态：** ${response.status} ${response.statusText}`];
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    const msg = d.message ?? d.msg ?? d.error;
    if (msg != null) {
      lines.push(
        `**错误消息：** ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`
      );
    }
    if (d.code != null) lines.push(`**错误代码：** ${String(d.code)}`);
    if (msg == null && Object.keys(d).length > 0) {
      lines.push(`**响应体：** ${JSON.stringify(data)}`);
    }
  } else if (data != null && data !== '') {
    lines.push(`**响应体：** ${String(data)}`);
  }
  return lines.join('\n');
}

function throwAitopFileUploadError(
  kind: '图片' | '视频' | '音频',
  response: Response,
  data: unknown
): never {
  throw new Error(
    `**❌ AITOP ${kind}上传失败**\n${formatAitopFileUploadFailureDetail(response, data)}`
  );
}

/**
 * Uploads an image file/blob to the server
 */
export async function uploadImage(imageUri: string): Promise<string | null> {
  try {
    const blob = await getBlobFromUrl(imageUri);
    const formData = new FormData();
    formData.append('file', blob, 'image.png');

    const uploadUrl = `${BASE_URL}/api/v1/file/upload`;
    const uploadHeaders = aitopUploadHeaders();
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: uploadHeaders,
      body: formData
    });

    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (
      response.ok &&
      data &&
      typeof data === 'object' &&
      (data as { code?: number; success?: boolean }).code === 0 &&
      (data as { success?: boolean }).success
    ) {
      const key = (data as { data?: { key?: string } }).data?.key;
      if (key) return FILE_PREFIX + key;
    }
    throwAitopFileUploadError('图片', response, data);
  } catch (error) {
    if (error instanceof Error && error.message.includes('AITOP')) throw error;
    throw new Error(
      `**❌ AITOP 图片上传失败**\n**错误消息：** ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Uploads a video file/blob URL to the server
 * - Accepts object URLs, base64 data URLs, or any fetchable http(s) URL
 * - Returns an AiTop accessible URL
 */
/**
 * Uploads an audio file/blob URL (WAV/MP3 等) to the same file endpoint as images/videos.
 */
export async function uploadAudio(audioUri: string): Promise<string | null> {
  try {
    const blob = await getBlobFromUrl(audioUri);
    const formData = new FormData();
    formData.append('file', blob, 'audio.mp3');

    const uploadUrl = `${BASE_URL}/api/v1/file/upload`;
    const uploadHeaders = aitopUploadHeaders();
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: uploadHeaders,
      body: formData,
    });

    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (
      response.ok &&
      data &&
      typeof data === 'object' &&
      (data as { code?: number; success?: boolean }).code === 0 &&
      (data as { success?: boolean }).success
    ) {
      const key = (data as { data?: { key?: string } }).data?.key;
      if (key) return FILE_PREFIX + key;
    }
    throwAitopFileUploadError('音频', response, data);
  } catch (error) {
    if (error instanceof Error && error.message.includes('AITOP')) throw error;
    throw new Error(
      `**❌ AITOP 音频上传失败**\n**错误消息：** ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

export async function uploadVideo(videoUri: string, filename = 'video.mp4'): Promise<string | null> {
  try {
    const blob = await getBlobFromUrl(videoUri);
    const formData = new FormData();
    formData.append('file', blob, filename);

    const uploadUrl = `${BASE_URL}/api/v1/file/upload`;
    const uploadHeaders = aitopUploadHeaders();
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: uploadHeaders,
      body: formData
    });

    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (
      response.ok &&
      data &&
      typeof data === 'object' &&
      (data as { code?: number; success?: boolean }).code === 0 &&
      (data as { success?: boolean }).success
    ) {
      const key = (data as { data?: { key?: string } }).data?.key;
      if (key) return FILE_PREFIX + key;
    }
    throwAitopFileUploadError('视频', response, data);
  } catch (error) {
    if (error instanceof Error && error.message.includes('AITOP')) throw error;
    throw new Error(
      `**❌ AITOP 视频上传失败**\n**错误消息：** ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

interface NanoTaskOptions {
  aspectRatio?: string;
  /** 仅 NANO_BANANA_2_FLASH：1K / 2K / 4K */
  imageSize?: '1K' | '2K' | '4K';
  /** 客户端批量：第几个任务（1-based） */
  clientBatchIndex?: number;
  /** 客户端批量：总任务数（面板 numberOfImages） */
  clientBatchTotal?: number;
}

/**
 * 创建 Nano Banana 2.0 图生任务（POST /api/v1/images/nanoBanana，platform: NANO_BANANA_2_FLASH）
 */
export async function createNanoTask(prompt: string, imageUrls: string[] = [], options: NanoTaskOptions = {}): Promise<string | null> {
  try {
    const payload: Record<string, unknown> = {
      platform: AITOP_PLATFORM_NANO_BANANA_2,
      prompt,
      aspectRatio: options.aspectRatio || '1:1',
    };
    if (imageUrls.length > 0) {
      payload.image = imageUrls;
    }
    const sz = options.imageSize;
    if (sz === '1K' || sz === '2K' || sz === '4K') {
      payload.imageSize = sz;
    }
    payload.generateNum = 1;
    if (options.clientBatchTotal != null && options.clientBatchTotal > 1) {
      payload.clientBatchIndex = options.clientBatchIndex ?? 1;
      payload.clientBatchTotal = options.clientBatchTotal;
    }

    const nanoUrl = `${BASE_URL}/api/v1/images/nanoBanana`;
    const nanoHeaders = aitopJsonHeaders();
    const nanoBody = withScoreProjectId(payload);
    logAitopModelRequest({
      model: 'Nano Banana 2.0',
      method: 'POST',
      url: nanoUrl,
      headers: nanoHeaders,
      body: nanoBody,
    });

    const response = await fetch(nanoUrl, {
      method: 'POST',
      headers: nanoHeaders,
      body: JSON.stringify(nanoBody)
    });

    // 检查HTTP状态码
    if (!response.ok) {
      let errorDetail = '';
      try {
        const errorData = await response.json();
        
        if (errorData.error) {
          errorDetail = `\n**错误类型：** ${errorData.error.type || '未知'}\n**错误消息：** ${errorData.error.message || '无详细错误信息'}`;
          if (errorData.error.code) {
            errorDetail += `\n**错误代码：** ${errorData.error.code}`;
          }
        } else if (errorData.message) {
          errorDetail = `\n**错误消息：** ${errorData.message}`;
        } else if (errorData.msg) {
          errorDetail = `\n**错误消息：** ${errorData.msg}`;
        } else {
          errorDetail = `\n**错误详情：** ${JSON.stringify(errorData, null, 2)}`;
        }
      } catch (parseError) {
        try {
          const errorText = await response.text();
          errorDetail = `\n**错误详情：** ${errorText}`;
        } catch (textError) {
          errorDetail = `\n**状态码：** ${response.status}\n**状态文本：** ${response.statusText}`;
        }
      }
      
      throw new Error(`**❌ Nano Banana API 调用失败**\n**HTTP状态：** ${response.status} ${response.statusText}${errorDetail}`);
    }

    const data = await response.json();

    if (data.code === 0 && data.success) {
      const taskId = data.data?.taskId;
      if (taskId) {
        return taskId;
      } else {
        let errorMsg = `**❌ Nano Banana API 错误**\n**问题：** 任务创建成功但未获取到taskId\n**响应数据：** ${JSON.stringify(data, null, 2)}`;
        throw new Error(errorMsg);
      }
    } else {
      let errorMsg = `**❌ Nano Banana API 调用失败**\n**错误代码：** ${data.code || '未知'}\n**成功状态：** ${data.success || false}\n**错误消息：** ${data.message || data.msg || '无详细错误信息'}`;
      if (data.data) {
        errorMsg += `\n**响应数据：** ${JSON.stringify(data.data, null, 2)}`;
      }
      throw new Error(errorMsg);
    }
  } catch (error) {
    if (error instanceof Error) {
      // 如果已经是格式化的错误，直接抛出
      throw error;
    }
    throw new Error(`**❌ Nano Banana API 调用异常**\n**错误：** ${error instanceof Error ? error.message : String(error)}`);
  }
}

export interface Image2TaskOptions {
  aspectRatio?: string;
  imageSize?: string;
  style?: 'vivid' | 'natural';
  quality?: '1K' | '2K' | '4K';
  qualityLevel?: 'low' | 'medium' | 'high';
  /** 客户端批量：第几个任务（1-based） */
  clientBatchIndex?: number;
  /** 客户端批量：总任务数（面板 numberOfImages） */
  clientBatchTotal?: number;
}

/**
 * image 2 图生任务（POST /api/v1/images/openAI）
 * 协议字段：
 * - platform: OPEN_AI_GPT_IMAGE_2_QUALITY
 * - prompt: string
 * - size: 各档位像素尺寸 | auto
 * - quality: 1K | 2K | 4K
 * - qualityLevel: low | medium | high
 * - image: string[] (最多 4 张)
 * - style: vivid | natural
 */
export async function createImage2Task(
  prompt: string,
  imageUrls: string[] = [],
  options: Image2TaskOptions = {}
): Promise<string | null> {
  try {
    const payload: Record<string, unknown> = {
      platform: AITOP_PLATFORM_IMAGE_2,
      prompt,
      size: options.imageSize || '1024x1024',
      style: options.style === 'natural' ? 'natural' : 'vivid',
      quality: options.quality || '1K',
      qualityLevel: options.qualityLevel || 'medium',
    };
    const ar = String(options.aspectRatio || '').trim();
    if (ar) payload.aspectRatio = ar;
    if (imageUrls.length > 0) {
      payload.image = imageUrls.slice(0, IMAGE2_MAX_API_IMAGES);
    }
    payload.generateNum = 1;
    if (options.clientBatchTotal != null && options.clientBatchTotal > 1) {
      payload.clientBatchIndex = options.clientBatchIndex ?? 1;
      payload.clientBatchTotal = options.clientBatchTotal;
    }

    const endpoint = '/api/v1/images/openAI';
    const fullUrl = `${BASE_URL}${endpoint}`;
    const image2Headers = aitopJsonHeaders();
    const image2Body = withScoreProjectId(payload);
    logAitopModelRequest({
      model: 'image 2',
      method: 'POST',
      url: fullUrl,
      headers: image2Headers,
      body: image2Body,
    });
    const response = await fetch(fullUrl, {
      method: 'POST',
      headers: image2Headers,
      body: JSON.stringify(image2Body),
    });

    if (!response.ok) {
      let errorDetail = '';
      try {
        const errorData = await response.json();
        errorDetail =
          errorData?.message ||
          errorData?.msg ||
          (errorData?.error ? JSON.stringify(errorData.error) : JSON.stringify(errorData));
      } catch {
        try {
          errorDetail = await response.text();
        } catch {
          errorDetail = response.statusText;
        }
      }
      throw new Error(
        `**❌ image 2 API 调用失败**\n**错误：** [${endpoint}] HTTP ${response.status} ${response.statusText} - ${errorDetail || 'Unknown'}`
      );
    }

    const data = await response.json();
    if (data.code === 0 && data.success) {
      const taskId = data.data?.taskId;
      if (taskId) return taskId;
      throw new Error(`**❌ image 2 API 调用失败**\n**错误：** [${endpoint}] success but missing taskId`);
    }
    throw new Error(`**❌ image 2 API 调用失败**\n**错误：** [${endpoint}] ${data.message || data.msg || JSON.stringify(data)}`);
  } catch (e) {
    if (e instanceof Error) throw e;
    throw new Error(`**❌ image 2 请求异常**\n**错误：** ${String(e)}`);
  }
}

/**
 * Polls the task status
 */
export async function getTaskStatus(taskId: string): Promise<any> {
  try {
    const proxyUrl = `/task-status?taskId=${encodeURIComponent(taskId)}${buildAitopBillingQuery()}`;
    let response: Response;
    try {
      response = await fetch(proxyUrl, {
        method: 'GET',
        cache: 'no-store'
      });
      if (!response.ok) {
        throw new Error(`proxy status ${response.status}`);
      }
    } catch (proxyError) {
      const directUrl = `${BASE_URL}/api/v1/task/${taskId}`;
      const directHeaders = aitopJsonHeaders();
      response = await fetch(directUrl, {
        method: 'GET',
        headers: directHeaders,
      });
    }

    // 检查HTTP状态码
    if (!response.ok) {
      let errorDetail = '';
      try {
        const errorData = await response.json();
        
        if (errorData.error) {
          errorDetail = `\n**错误类型：** ${errorData.error.type || '未知'}\n**错误消息：** ${errorData.error.message || '无详细错误信息'}`;
          if (errorData.error.code) {
            errorDetail += `\n**错误代码：** ${errorData.error.code}`;
          }
        } else if (errorData.message) {
          errorDetail = `\n**错误消息：** ${errorData.message}`;
        } else if (errorData.msg) {
          errorDetail = `\n**错误消息：** ${errorData.msg}`;
        } else {
          errorDetail = `\n**错误详情：** ${JSON.stringify(errorData, null, 2)}`;
        }
      } catch (parseError) {
        try {
          const errorText = await response.text();
          errorDetail = `\n**错误详情：** ${errorText}`;
        } catch (textError) {
          errorDetail = `\n**状态码：** ${response.status}\n**状态文本：** ${response.statusText}`;
        }
      }
      
      throw new Error(`**❌ 任务状态查询失败**\n**HTTP状态：** ${response.status} ${response.statusText}${errorDetail}`);
    }

    const data = await response.json();
    
    if (data.code === 0 && data.success) {
      const statusData = data.data;
      return statusData;
    } else {
      const errorMsg = `**❌ 任务状态查询失败**\n**错误代码：** ${data.code || '未知'}\n**成功状态：** ${data.success || false}\n**错误消息：** ${data.message || data.msg || '无详细错误信息'}`;
      throw new Error(errorMsg);
    }
  } catch (error) {
    if (error instanceof Error) {
      // 如果已经是格式化的错误，直接抛出
      throw error;
    }
    throw new Error(`**❌ 任务状态查询异常**\n**错误：** ${error instanceof Error ? error.message : String(error)}`);
  }
}

interface KlingVideoTaskOptions {
  prompt?: string; // 提示词（可选）
  negativePrompt?: string; // 负提示词（可选）
  image: string; // 首帧图（必填，base64或URL）
  imageTail?: string; // 尾帧图（可选，base64或URL）
  modelName?: string; // 模型名称
  mode?: 'std' | 'pro'; // 生成模式：标准或高质量
  duration?: string; // 视频时长（秒），例如 '4'/'5'/'10'
  cfgScale?: number; // 生成自由度，范围[0, 1]
  sound?: 'off' | 'on'; // 音频控制
  generateNum?: number; // 生成数量
}

/**
 * 可灵 Omni 生视频（AiTop：`POST /api/v1/video/kling/omni`，与官方 2.1.4 字段对齐）
 * @see https://app.klingai.com/cn/dev/document-api/apiReference/model/OmniVideo
 */
interface KlingOmniVideoTaskOptions {
  prompt?: string;
  negativePrompt?: string;
  /** 与 aitop100 / 可灵 Omni 文档一致：KLING_OMNI_VIDEO 或 KLING_V3_OMNI */
  modelName?: 'KLING_OMNI_VIDEO' | 'KLING_V3_OMNI';
  mode?: 'std' | 'pro';
  /** 秒；无 video_list 时官方 2.1.4：文生/首帧图生/首尾帧等仅允许 5 或 10 */
  duration?: string;
  aspectRatio?: '16:9' | '9:16' | '1:1';
  /**
   * 与 `elementList`、`videoList` 等为请求体**平级**字段。
   * - 入参可在每行带 `element_id`/`elementId`（与图绑定）；发送前归一为仅含 `image_url`/`type` 的 Image 数组，主体 id 写入同级 `elementList`。
   * - 无 videoList：`normalizeKlingOmniImageListForAiTopProxy` — 仅 2 张且无 type 时补 first+end；**>2 张为多图参考，不补 end_frame**（2.1.4：超过 2 张不支持尾帧）。
   * - 有参考视频时参考图+主体 ≤4；无参考视频时 ≤7。
   * - Prompt 可用 <<<element_1>>>、<<<image_1>>>、<<<video_1>>>（≤2500 字符）。
   */
  imageList: Array<{
    image_url: string;
    type?: 'first_frame' | 'end_frame' | string;
    /** 构建请求时合并进平级 `elementList`，不出现在最终 `imageList[]` 项上 */
    element_id?: string;
    elementId?: string;
  }>;
  /**
   * 与 `imageList`、`videoList` **同级**（官方 Omni：https://app.klingai.com/cn/dev/document-api/apiReference/model/OmniVideo）
   * 仅含主体 `element_id`；与某张参考图绑定过的主体在构建请求时从 `imageList` 行上的 element 信息合并进本数组，**不再**写在 `imageList[]` 里，避免层级混淆。
   * 文档：有参考视频时「参考图片数量 + 参考主体数量」之和 ≤4；无参考视频时 ≤7。
   */
  elementList?: Array<{ element_id?: string; elementId?: string }>;
  /**
   * Docs: videoList is for reference videos.
   * - Only supports MP4/MOV and exactly one segment.
   */
  videoList?: Array<{ video_url: string; refer_type: 'feature' | 'base'; keep_original_sound: 'yes' | 'no' }>;
  /**
   * 多图参考测试：无 video_list 时仅按行传 `image_url`（不补 first_frame/end_frame，请求体不写 `type`）。
   * 用于验证 AiTop/可灵对「无 type」多图参考的解析；首尾帧等其它模式勿开。
   */
  omniMultiReferenceNoType?: boolean;
  generateNum?: number;
  clientBatchIndex?: number;
  clientBatchTotal?: number;
}

/** 选项在 TS 侧用 camelCase；发往 AiTop/可灵 Omni 的请求体须与官方一致用 snake_case，否则 Java 反序列化得到 null 再 .trim() 会 NPE */
function klingOmniStr(v: unknown, fallback = ''): string {
  if (v == null) return fallback;
  return String(v);
}

/** JSON.stringify 时把任意 null 叶子打成空串，避免代理层 trim NPE */
function klingOmniJsonReplacer(_key: string, value: unknown): unknown {
  if (value === null) return '';
  return value;
}

/**
 * 无 `video_list`：
 * - 仅 2 张且缺省 type：第一张补 `first_frame`，第二张补 `end_frame`（首尾帧）。
 * - 超过 2 张：除显式 type 外，首张缺省补 `first_frame`，其余只传 `image_url`（多图参考，禁止误补 `end_frame`）。
 *
 * **有 `video_list`**：仅传 `image_url`（不补 type），最多 4 张。
 */
function pickKlingOmniElementId(img: {
  image_url: string;
  type?: string;
  element_id?: string;
  elementId?: string;
}): string | undefined {
  const e = img.element_id ?? img.elementId;
  if (e == null || String(e).trim() === '') return undefined;
  return String(e).trim();
}

/** 官方 Omni elementList：仅保留有效 element_id */
export function normalizeKlingOmniElementListForPayload(
  list?: Array<{ element_id?: string; elementId?: string }> | null
): Array<{ element_id: string }> {
  if (!list?.length) return [];
  const out: Array<{ element_id: string }> = [];
  for (const e of list) {
    const raw = e.element_id ?? e.elementId;
    if (raw == null || String(raw).trim() === '') continue;
    out.push({ element_id: String(raw).trim() });
  }
  return out;
}

/** 合并多路 element_id（含仅主体、无图）并按 id 去重 */
export function mergeKlingOmniElementListDeduped(
  ...parts: Array<Array<{ element_id?: string; elementId?: string } | undefined> | undefined>
): Array<{ element_id: string }> {
  const seen = new Set<string>();
  const out: Array<{ element_id: string }> = [];
  for (const part of parts) {
    if (!part?.length) continue;
    for (const row of part) {
      const raw = row?.element_id ?? row?.elementId;
      if (raw == null || String(raw).trim() === '') continue;
      const id = String(raw).trim();
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ element_id: id });
    }
  }
  return out;
}

/** @deprecated 已改为 imageList 仅含 image_url/type，主体统一进平级 elementList；保留仅为旧测试引用 */
export function dedupeKlingOmniElementListAgainstImageList(
  imageList: Array<{ image_url: string; type?: string; element_id?: string }>,
  elementList: Array<{ element_id: string }>
): Array<{ element_id: string }> {
  if (!elementList.length) return [];
  const onImage = new Set<string>();
  for (const img of imageList) {
    const id = img.element_id;
    if (id != null && String(id).trim() !== '') onImage.add(String(id).trim());
  }
  return elementList.filter((e) => e.element_id && !onImage.has(e.element_id));
}

/**
 * 输出仅含官方 Image：`image_url` 与可选 `type`（首尾帧）。
 * 主体 `element_id` 由调用方从入参行上收集后写入**平级** `elementList`，不挂在 image 项上（与官方文档一致）。
 */
export function normalizeKlingOmniImageListForAiTopProxy(
  imageList: Array<{ image_url: string; type?: string; element_id?: string; elementId?: string }>,
  options?: { hasVideo?: boolean }
): Array<{ image_url: string; type?: string }> {
  if (options?.hasVideo) {
    return imageList.slice(0, 4).map((img) => ({ image_url: klingOmniStr(img.image_url).trim() }));
  }

  const list = imageList.slice();
  let hasFirstFrame = list.some((img) => img.type?.trim() === 'first_frame');
  /** 多图参考：总量>2 时除首/尾帧外均为参考图，不能补 end_frame（否则会触发「超过2张不支持尾帧」） */
  const multiReferenceNoEndFrame = list.length > 2;
  return list.map((img) => {
    const url = klingOmniStr(img.image_url).trim();
    const base = (withType: { image_url: string; type: string }) => withType;
    const t = typeof img.type === 'string' ? img.type.trim() : '';
    if (t) {
      return base({ image_url: url, type: t });
    }
    if (!hasFirstFrame) {
      hasFirstFrame = true;
      return base({ image_url: url, type: 'first_frame' });
    }
    if (multiReferenceNoEndFrame) {
      return { image_url: url };
    }
    return base({ image_url: url, type: 'end_frame' });
  });
}

function isNonRetryableKlingOmniMessage(msg: unknown): boolean {
  const s = typeof msg === 'string' ? msg : '';
  if (!s) return false;
  return (
    s.includes('getType()') ||
    s.includes('Cannot invoke') ||
    s.includes('NullPointer') ||
    s.includes('invalid') ||
    s.includes('非法') ||
    // 校验类错误：输入视频与 duration 参数不一致时，重试通常不会成功
    /时长.*不一致/i.test(s) ||
    s.includes('duration mismatch') ||
    s.includes('参数') ||
    // 素材/业务校验：尺寸、格式、大小等重试不会改变结果（避免无意义刷满 12 次）
    /视频尺寸|尺寸不符合|分辨率|宽高|帧率|fps|不符合要求|格式错误|不支持.*格式|文件过大|超出.*限制|不在.*之间/i.test(
      s
    ) ||
    /dimension|resolution|file size|aspect ratio|must be between|out of range/i.test(s) ||
    // Omni 多图参考：超过 2 张时不能带尾帧；重试无效
    /超过\s*2\s*张|不支持.*尾帧|尾帧.*不支持|more than 2.*end|end[_\s]?frame.*not supported/i.test(s) ||
    /2500|字符.*过长|prompt.*too long/i.test(s)
  );
}

/**
 * Creates a Kling video generation task
 * 根据 Python 测试代码实现可灵AI视频生成
 */
export async function createKlingVideoTask(options: KlingVideoTaskOptions): Promise<string | null> {
  try {
    const {
      prompt = '',
      negativePrompt = '',
      image,
      imageTail,
      modelName = 'KLING_V2_5_TURBO',
      mode = 'pro',
      duration = '10',
      cfgScale = 0.7,
      sound = 'off',
      generateNum = 1
    } = options;

    // 验证必填字段
    if (!image) {
      return null;
    }

    // 验证：只接受 URL，不接受 base64
    if (image.startsWith('data:image/')) {
      return null;
    }

    // 构建请求参数 - 严格按照 Python 代码规范
    const payload: any = {
      modelName: modelName, // 必填：模型名称
      cfgScale: cfgScale, // 必填：生成视频的自由度，number类型
      mode: mode, // 必填：生成模式，枚举值：std或pro
      duration: duration, // 必填：生成视频时长，字符串类型
      generateNum: generateNum, // 生成数量
      image: image, // 必填：首帧图（字符串类型，必须是URL）
      sound: sound // 音频控制
    };

    // 可选字段：提示词（显式设置，避免null）
    payload.prompt = prompt || '';

    // 可选字段：负提示词（如果有值才添加）
    if (negativePrompt) {
      payload.negativePrompt = negativePrompt;
    }

    // 可选字段：尾帧图（字符串类型，必须是图片URL）
    // 根据文档：image和imageTail至少二选一
    if (imageTail) {
      // 验证：只接受 URL，不接受 base64
      if (imageTail.startsWith('data:image/')) {
        return null;
      }
      payload.imageTail = imageTail; // 字符串类型，不是数组！
    }

    // 验证所有必填字段都不为 null（严格按照 Python 代码）
    const requiredFields = ['modelName', 'cfgScale', 'mode', 'duration', 'generateNum'];
    for (const field of requiredFields) {
      if (payload[field] === undefined || payload[field] === null) {
        return null;
      }
    }

    // 验证 image 字段（image和imageTail至少二选一）
    if (!payload.image) {
      return null;
    }

    // 最终验证：确保所有字段都不是 None（与 Python 代码保持一致）
    for (const key in payload) {
      if (payload[key] === null) {
        return null;
      }
    }

    const klingUrl = `${BASE_URL}/api/v1/video/kling/image`;
    const klingHeaders = aitopJsonHeaders();
    const klingBody = withScoreProjectId(payload);
    logAitopModelRequest({
      model: '可灵视频',
      method: 'POST',
      url: klingUrl,
      headers: klingHeaders,
      body: klingBody,
    });

    const response = await fetch(klingUrl, {
      method: 'POST',
      headers: klingHeaders,
      body: JSON.stringify(klingBody)
    });

    // 检查HTTP状态码
    if (!response.ok) {
      let errorDetail = '';
      try {
        const errorData = await response.json();
        
        if (errorData.error) {
          errorDetail = `\n**错误类型：** ${errorData.error.type || '未知'}\n**错误消息：** ${errorData.error.message || '无详细错误信息'}`;
          if (errorData.error.code) {
            errorDetail += `\n**错误代码：** ${errorData.error.code}`;
          }
        } else if (errorData.message) {
          errorDetail = `\n**错误消息：** ${errorData.message}`;
        } else if (errorData.msg) {
          errorDetail = `\n**错误消息：** ${errorData.msg}`;
        } else {
          errorDetail = `\n**错误详情：** ${JSON.stringify(errorData, null, 2)}`;
        }
      } catch (parseError) {
        try {
          const errorText = await response.text();
          errorDetail = `\n**错误详情：** ${errorText}`;
        } catch (textError) {
          errorDetail = `\n**状态码：** ${response.status}\n**状态文本：** ${response.statusText}`;
        }
      }
      
      throw new Error(`**❌ Kling Video API 调用失败**\n**HTTP状态：** ${response.status} ${response.statusText}${errorDetail}`);
    }

    const data = await response.json();
    
    if (data.code === 0 && data.success) {
      const taskId = data.data?.taskId;
      if (taskId) {
        return taskId;
      } else {
        let errorMsg = `**❌ Kling Video API 错误**\n**问题：** 任务创建成功但未获取到taskId\n**响应数据：** ${JSON.stringify(data, null, 2)}`;
        throw new Error(errorMsg);
      }
    } else {
      let errorMsg = `**❌ Kling Video API 调用失败**\n**错误代码：** ${data.code || '未知'}\n**成功状态：** ${data.success || false}\n**错误消息：** ${data.message || data.msg || '无详细错误信息'}`;
      if (data.data) {
        errorMsg += `\n**响应数据：** ${JSON.stringify(data.data, null, 2)}`;
      }
      throw new Error(errorMsg);
    }
  } catch (error) {
    if (error instanceof Error) {
      // 如果已经是格式化的错误，直接抛出
      throw error;
    }
    throw new Error(`**❌ Kling Video API 调用异常**\n**错误：** ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Creates a Kling Omni video generation task
 * 对应 Python: POST /api/v1/video/kling/omni
 */
export async function createKlingOmniVideoTask(options: KlingOmniVideoTaskOptions): Promise<string | null> {
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const isBalanceNotEnough = (data: { code?: unknown; message?: unknown; msg?: unknown }) => {
    const code = String(data?.code ?? '').trim();
    const text = String(data?.message ?? data?.msg ?? '').toLowerCase();
    return code === '1102' || text.includes('account balance not enough') || text.includes('余额不足');
  };
  const extractAccountIdFromErrorDetail = (detail: string): string | null => {
    if (!detail) return null;
    const byOpenApiPath = detail.match(/openApi\/(\d+)\//i)?.[1];
    if (byOpenApiPath) return byOpenApiPath;
    const byAccountId = detail.match(/account[_\s-]?id["'\s:=]+(\d+)/i)?.[1];
    if (byAccountId) return byAccountId;
    const byUserId = detail.match(/user[_\s-]?id["'\s:=]+(\d+)/i)?.[1];
    if (byUserId) return byUserId;
    return null;
  };
  const isBusyMessage = (msg: unknown) => {
    const s = typeof msg === 'string' ? msg : '';
    return (
      s.includes('繁忙') ||
      s.includes('稍后再试') ||
      s.includes('请稍后') ||
      s.includes('稍候') ||
      s.includes('排队') ||
      s.includes('限流') ||
      s.includes('负载') ||
      s.includes('过载') ||
      s.includes('高峰') ||
      s.includes('拥挤') ||
      s.includes('busy') ||
      /rate\s*limit|throttl/i.test(s)
    );
  };

  /** 业务体里 code 也常表示限流/过载（中英混排） */
  const isBusyApiBody = (data: { code?: unknown; message?: unknown; msg?: unknown }) => {
    if (isBalanceNotEnough(data)) return false;
    const c = data?.code;
    if (c === 429 || c === 503 || c === '429' || c === '503') return true;
    return isBusyMessage(data?.message ?? data?.msg);
  };

  /** 系统繁忙时多给一点时间再试；普通重试略短 */
  const backoffMs = (attempt: number, busy: boolean) => {
    const jitter = Math.floor(Math.random() * 400);
    if (busy) {
      return Math.min(45000, 2200 * Math.pow(1.72, attempt - 1) + jitter);
    }
    return 1200 * Math.pow(1.85, attempt - 1) + jitter;
  };

  try {
    const {
      imageList: imageListOpt
    } = options;
    const prompt = klingOmniStr(options.prompt).trim();
    const negativePrompt = klingOmniStr(options.negativePrompt).trim();
    const modelName = klingOmniStr(options.modelName, 'KLING_V3_OMNI').trim() || 'KLING_V3_OMNI';
    const mode: 'std' | 'pro' = options.mode === 'std' ? 'std' : 'pro';
    const duration = klingOmniStr(options.duration, '5').trim() || '5';
    const aspectRatio = klingOmniStr(options.aspectRatio, '16:9').trim() || '16:9';
    const imageList = (imageListOpt ?? [])
      .filter((img) => img != null && klingOmniStr(img.image_url).trim() !== '')
      .map((img) => ({ ...img, image_url: klingOmniStr(img.image_url).trim() }));
    const videoList = options.videoList;
    const elementListRaw = options.elementList;
    const hasVideo = Boolean(videoList && Array.isArray(videoList) && videoList.length > 0);
    const referType = hasVideo ? klingOmniStr(videoList?.[0]?.refer_type).trim() : '';

    if (!prompt) {
      throw new Error('**❌ Kling Omni**\n**错误：** prompt 不能为空（官方接口要求）');
    }
    if (prompt.length > 2500) {
      throw new Error(
        `**❌ Kling Omni（官方 2.1.4）**\n**错误：** prompt 不能超过 2500 个字符，当前约 ${prompt.length} 字符。`
      );
    }

    if (!hasVideo && (!imageList || !Array.isArray(imageList) || imageList.length === 0)) {
      throw new Error(
        '**❌ Kling Omni（官方 2.1.4）**\n**错误：** 无参考视频（无 video_list）时 imageList 不能为空，且 image_url 不得为空。'
      );
    }

    // --- Validate videoList (if provided) ---
    if (hasVideo) {
      if (!videoList) {
        return null;
      }
      if (videoList.length > 1) {
        return null;
      }

      for (const v of videoList) {
        if (!klingOmniStr(v.video_url).trim()) {
          return null;
        }
        const rt = klingOmniStr(v.refer_type).trim();
        if (rt !== 'base' && rt !== 'feature') {
          return null;
        }
        const kos = klingOmniStr(v.keep_original_sound).trim();
        if (kos !== 'yes' && kos !== 'no') {
          return null;
        }
      }

      // docs: 仅「待编辑视频 base」时不能在 image_list 里定义首尾帧；特征参考视频 feature 不受此限制
      if (
        referType === 'base' &&
        imageList.some((img) => String(img.type ?? '').trim() === 'first_frame' || String(img.type ?? '').trim() === 'end_frame')
      ) {
        return null;
      }
    } else {
      // --- Image-only mode validations ---
      const typedFirstCnt = imageList.filter((i) => i.type === 'first_frame').length;
      const typedEndCnt = imageList.filter((i) => i.type === 'end_frame').length;

      // docs: 有尾帧时必须同时有首帧
      if (typedEndCnt > 0 && typedFirstCnt === 0) {
        return null;
      }

      // docs: 尾帧生视频时仅支持首尾帧图片；并限制总量
      if (typedEndCnt > 0 && imageList.length > 2) {
        return null;
      }

    }

    const normalizedImageList: Array<{ image_url: string; type?: string }> =
      !hasVideo && options.omniMultiReferenceNoType
        ? imageList.map((img) => ({ image_url: klingOmniStr(img.image_url).trim() }))
        : normalizeKlingOmniImageListForAiTopProxy(imageList, { hasVideo });
    // 官方 2.1.4：「数组中超过 2 张图片时，不支持设置尾帧」（归一化后再验，避免显式 end_frame 漏网）
    const normalizedEndFrameCount = normalizedImageList.filter(
      (i) => String(i.type ?? '').trim() === 'end_frame'
    ).length;
    if (!hasVideo && normalizedImageList.length > 2 && normalizedEndFrameCount > 0) {
      throw new Error(
        '**❌ Kling Omni（官方 2.1.4）**\n**错误：** 参考图超过 2 张时不支持设置尾帧（end_frame）。请减少参考图数量，或改为仅「首帧 + 尾帧」共 2 张的首尾帧模式。'
      );
    }
    const elementIdsFromImageRows = imageList
      .map((img) => pickKlingOmniElementId(img))
      .filter((id): id is string => Boolean(id && String(id).trim()));
    const normalizedElementList = mergeKlingOmniElementListDeduped(
      normalizeKlingOmniElementListForPayload(elementListRaw),
      elementIdsFromImageRows.map((id) => ({ element_id: id }))
    );

    const maxCombined = hasVideo ? 4 : 7;
    if (normalizedImageList.length + normalizedElementList.length > maxCombined) {
      throw new Error(
        `**❌ Kling Omni（官方 2.1.4）**\n**错误：** 参考图片数量与参考主体数量之和不得超过 **${maxCombined}**（有参考视频时 ≤4，无参考视频时 ≤7）。当前约 **${normalizedImageList.length}** 张图 + **${normalizedElementList.length}** 个主体。`
      );
    }

    /** 无 video_list 时 2.1.4：文生/首帧图生/首尾帧 duration 仅 5 与 10（秒）；非法值钳位为 5 并告警，避免旧工程里 4s 等选项直接失败 */
    let effectiveDuration = duration;
    if (!hasVideo) {
      const durationDigits = String(duration).replace(/\D/g, '') || '5';
      if (durationDigits === '10') {
        effectiveDuration = '10';
      } else {
        if (durationDigits !== '5') {
        }
        effectiveDuration = '5';
      }
    }

    // duration：Kling Omni 这边的代理/服务端会校验该字段是否为空，并且在 base 模式下也会进行时长一致性校验。
    // 因此这里始终传 duration，避免触发 “时长不能为空”。
    // AiTop：部分 DTO 只绑 camelCase（如 modelName），仅 snake_case 会触发「模型不能为空」；仅 camelCase 曾触发 Java trim NPE。
    // 同一请求里双写两套键名，共用数组引用，避免再踩命名策略差异。
    const imagePayload =
      normalizedImageList.length > 0
        ? normalizedImageList.map((row) => {
            const item: Record<string, string> = { image_url: row.image_url };
            if (row.type) item.type = row.type;
            return item;
          })
        : null;
    const elementPayload =
      normalizedElementList.length > 0
        ? normalizedElementList.map((e) => ({ element_id: e.element_id }))
        : null;
    const videoPayload =
      hasVideo && videoList?.length
        ? videoList.map((v) => ({
            video_url: klingOmniStr(v.video_url).trim(),
            refer_type: v.refer_type === 'base' ? 'base' : 'feature',
            keep_original_sound: v.keep_original_sound === 'yes' ? 'yes' : 'no',
          }))
        : null;

    const omniBody: Record<string, unknown> = {
      modelName: modelName,
      model_name: modelName,
      generateNum: options.generateNum ?? 1,
      generate_num: options.generateNum ?? 1,
      mode,
      aspectRatio: aspectRatio,
      aspect_ratio: aspectRatio,
      duration: effectiveDuration,
      prompt,
    };
    if (imagePayload) {
      omniBody.imageList = imagePayload;
      omniBody.image_list = imagePayload;
    }
    if (elementPayload) {
      omniBody.elementList = elementPayload;
      omniBody.element_list = elementPayload;
    }
    if (negativePrompt) {
      omniBody.negativePrompt = negativePrompt;
      omniBody.negative_prompt = negativePrompt;
    }
    if (videoPayload) {
      omniBody.videoList = videoPayload;
      omniBody.video_list = videoPayload;
    }
    if (options.clientBatchTotal != null && options.clientBatchTotal > 1) {
      omniBody.clientBatchIndex = options.clientBatchIndex ?? 1;
      omniBody.clientBatchTotal = options.clientBatchTotal;
    }

    const omniBodyJson = JSON.stringify(withScoreProjectId(omniBody), klingOmniJsonReplacer);
    const url = `${BASE_URL}/api/v1/video/kling/omni`;
    const maxAttempts = 12;
    const formatOmniResponseTaskIdLine = (data: {
      data?: { taskId?: unknown };
      taskId?: unknown;
      request_id?: string;
      requestId?: string;
    }) => {
      const tid = data?.data?.taskId ?? data?.taskId;
      const rid = data?.request_id ?? data?.requestId;
      if (tid != null && String(tid) !== '') return `\n**Task ID：** ${String(tid)}`;
      if (rid != null && String(rid) !== '') return `\n**Task ID：** ${String(rid)}`;
      return '';
    };
    /** 便于持 Task ID 向 AiTop 侧查日志 */
    const aitopSupportFooter = (hasTaskIdLine: boolean) =>
      hasTaskIdLine
        ? '\n**支持：** 请将上述 Task ID 提供给 **AiTop（aitop100）** 以便核对原因。'
        : '\n**支持：** 如需排查，可联系 **AiTop（aitop100）**。';

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        if (attempt === 1) {
          const omniHeaders = aitopJsonHeaders();
          logAitopModelRequest({
            model: modelName,
            method: 'POST',
            url,
            headers: omniHeaders,
            body: JSON.parse(omniBodyJson),
          });
        }
        const response = await fetch(url, {
          method: 'POST',
          headers: aitopJsonHeaders(),
          body: omniBodyJson
        });

        const data = await response.json();
        if (!response.ok) {
          const detail = data?.message || data?.msg || JSON.stringify(data);
          const accountId = extractAccountIdFromErrorDetail(detail);
          const accountHint =
            isBalanceNotEnough(data) && accountId
              ? `\n**账号ID：** ${accountId}\n**提示：** 该账号余额不足，请充值后重试。`
              : isBalanceNotEnough(data)
                ? '\n**提示：** 当前账号余额不足，请充值后重试。'
                : '';
          const busyHint =
            !isBalanceNotEnough(data) &&
            (isBusyMessage(detail) || response.status === 429 || response.status === 503 || response.status >= 500);
          // 429/503/5xx：可灵/AiTop 繁忙或网关抖动，允许重试
          if (
            attempt < maxAttempts &&
            !isBalanceNotEnough(data) &&
            (response.status === 429 || response.status === 503 || response.status >= 500)
          ) {
            await delay(backoffMs(attempt, busyHint));
            continue;
          }
          {
            const idLine = formatOmniResponseTaskIdLine(data);
            throw new Error(
              `**❌ Kling Omni API 调用失败**\n**HTTP状态：** ${response.status}\n**错误：** ${detail}${accountHint}${idLine}${aitopSupportFooter(idLine !== '')}`
            );
          }
        }

        if (data.code === 0 && data.success) {
          const taskId = data.data?.taskId;
          if (taskId) return taskId;
        }

        const msg = data?.message || data?.msg;
        const omniIdNote = formatOmniResponseTaskIdLine(data);
        const omniFooter = aitopSupportFooter(omniIdNote !== '');
        // 业务返回繁忙 / code=429 等时重试
        if (attempt < maxAttempts && isBusyApiBody(data)) {
          const waitBusy = backoffMs(attempt, true);
          await delay(waitBusy);
          continue;
        }

        const busyFinal = isBusyApiBody(data);
        throw new Error(
          busyFinal
            ? `**❌ Kling Omni 任务创建失败**\n**错误：** ${msg || '系统繁忙'}\n**提示：** 服务端持续繁忙，请几分钟后再试或避开高峰。${omniIdNote}${omniFooter}`
            : `**❌ Kling Omni 任务创建失败**\n**错误：** ${msg || '无详细错误信息'}${omniIdNote}${omniFooter}`
        );
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        // 参数/NPE/明确业务错误重试无意义，直接失败
        if (isNonRetryableKlingOmniMessage(errMsg)) {
          throw err instanceof Error ? err : new Error(errMsg);
        }
        // fetch/parse 异常：若不是最后一次就重试
        if (attempt < maxAttempts) {
          await delay(backoffMs(attempt, errMsg.includes('繁忙')));
          continue;
        }
        throw err;
      }
    }

    return null;
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error(`**❌ Kling Omni 请求异常**\n**错误：** ${String(error)}`);
  }
}

/** Vidu 2.0 图生视频 API（参考 vidu_video_test.py） */
export interface ViduVideoTaskOptions {
  prompt: string;
  images: string[];  // 图片 URL 数组：[首帧] 或 [首帧, 尾帧]，需先通过 uploadImage 上传
  duration?: 4 | 8;  // 视频时长，仅支持 4 或 8 秒
  resolution?: '360p' | '720p' | '1080p';
  aspectRatio?: string;  // '16:9' | '9:16' | '1:1'
  movementAmplitude?: 'auto' | 'small' | 'medium' | 'large';
  modelName?: string;
  generateNum?: number;
  seed?: number;
}

/**
 * 创建 Vidu 2.0 图生视频任务
 * 接口：POST /api/v1/video/vidu/image
 */
export async function createViduVideoTask(options: ViduVideoTaskOptions): Promise<string | null> {
  const {
    prompt,
    images,
    duration = 4,
    resolution = '1080p',
    aspectRatio = '16:9',
    movementAmplitude = 'auto',
    modelName = 'VIDU_2_0',
    generateNum = 1,
    seed = 0,
  } = options;

  if (!images?.length) {
    return null;
  }

  const payload = {
    model: modelName,
    generateNum,
    prompt,
    duration,
    aspectRatio,
    resolution,
    movementAmplitude,
    images,
    ...(seed !== 0 ? { seed } : {}),
  };

  try {
    const viduUrl = `${BASE_URL}/api/v1/video/vidu/image`;
    const viduHeaders = aitopJsonHeaders();
    const viduBody = withScoreProjectId(payload);
    logAitopModelRequest({
      model: 'Vidu 2.0',
      method: 'POST',
      url: viduUrl,
      headers: viduHeaders,
      body: viduBody,
    });
    const response = await fetch(viduUrl, {
      method: 'POST',
      headers: viduHeaders,
      body: JSON.stringify(viduBody),
    });

    const data = await response.json();

    if (!response.ok) {
      const errorDetail = data?.message || data?.msg || JSON.stringify(data);
      throw new Error(`**❌ Vidu Video API 调用失败**\n**HTTP状态：** ${response.status}\n**错误：** ${errorDetail}`);
    }

    if (data.code === 0 && data.success) {
      const taskId = data.data?.taskId;
      if (taskId) {
        return taskId;
      }
    }
    const errMsg = data?.message || data?.msg || '无详细错误信息';
    throw new Error(`**❌ Vidu Video 任务创建失败**\n**错误：** ${errMsg}`);
  } catch (e) {
    if (e instanceof Error) throw e;
    throw new Error(`**❌ Vidu Video 请求异常**\n${String(e)}`);
  }
}

/** 豆包 Seedance 1.5 Pro 图生视频 API（参考 doubao_video_test.py） */
export interface DoubaoSeedanceVideoTaskOptions {
  /** Seedance 模型：1.5 / 2.0 FAST / 2.0（高质量） */
  model?: 'DOUBAO_SEEDANCE_1_5_PRO' | 'DOUBAO_SEEDANCE_2_0_FAST' | 'DOUBAO_SEEDANCE_2_0';
  prompt?: string;
  negativePrompt?: string;
  /** 图生视频：首帧图片 URL（必填，需先上传）；文生/参考生视频可不传 */
  startImage?: string;
  /** 图生视频：尾帧图片 URL（可选） */
  endImage?: string;
  resolution?: '480p' | '720p' | '1080p';
  /** ratio 由网关校验：图生时需与首帧比例一致；参考生视频建议与参考视频一致 */
  ratio?: string; // 21:9、16:9、4:3、1:1、3:4、9:16、9:21
  /** 2.0 支持 2～15s；1.5 常用 5/10。这里统一用 number 透传。 */
  duration?: number;
  camerafixed?: boolean; // 1.5：固定镜头
  generateAudio?: boolean; // 1.5：是否生成音频
  seed?: number; // 默认 -1 随机
  /** Seedance 2.0 参考生视频：参考音频 URL（先上传） */
  referenceAudios?: string[];
  /** Seedance 2.0 参考生视频：参考视频 URL（先上传），与 doubao_video_test.py 一致字段 */
  referenceVideos?: string[];
  /** Seedance 2.0 参考生视频：参考图片 URL（先上传） */
  referenceImages?: string[];
  generateNum?: number;
  clientBatchIndex?: number;
  clientBatchTotal?: number;
}

/**
 * 创建豆包 Seedance 1.5 Pro 图生视频任务
 * 接口：POST /api/v1/video/doubao
 */
export async function createDoubaoSeedanceVideoTask(options: DoubaoSeedanceVideoTaskOptions): Promise<string | null> {
  const {
    model = 'DOUBAO_SEEDANCE_1_5_PRO',
    prompt = '',
    negativePrompt,
    startImage,
    endImage,
    resolution = '720p',
    ratio = '1:1',
    duration = 5,
    camerafixed = false,
    generateAudio = true,
    seed = -1,
    referenceAudios,
    referenceVideos,
    referenceImages,
    generateNum = 1,
    clientBatchIndex,
    clientBatchTotal,
  } = options;
  const modelLabel = model === 'DOUBAO_SEEDANCE_1_5_PRO' ? 'Seedance 1.5 Pro' : 'Seedance 2.0';

  // 兼容：1.5 pro 仍必须有首帧；2.0 的文生/参考生视频允许不传 startImage
  if (model === 'DOUBAO_SEEDANCE_1_5_PRO' && !startImage) {
    return null;
  }
  // 参考音频不能单独使用：必须同时提供 referenceVideos
  if (
    referenceAudios &&
    referenceAudios.length > 0 &&
    (!referenceVideos || referenceVideos.length === 0)
  ) {
    throw new Error(`**❌ ${modelLabel} 参数错误**\n**错误：** referenceAudios 不能单独使用，必须同时提供 referenceVideos`);
  }

  const payload: Record<string, unknown> = {
    model,
    generateNum,
    prompt: prompt || '镜头缓缓推进，人物自然走动',
    parameters: {
      resolution,
      ratio,
      duration,
      seed,
      // 1.5 专用参数（2.0 忽略即可）
      camerafixed,
    },
  };
  if (startImage) payload.startImage = startImage;
  if (endImage) payload.endImage = endImage;
  if (generateAudio !== undefined) payload.generateAudio = generateAudio;
  if (negativePrompt && negativePrompt.trim()) payload.negativePrompt = negativePrompt.trim();

  if (referenceAudios && referenceAudios.length > 0) payload.referenceAudios = referenceAudios;
  if (referenceVideos && referenceVideos.length > 0) payload.referenceVideos = referenceVideos;
  if (referenceImages && referenceImages.length > 0) payload.referenceImages = referenceImages;
  if (clientBatchTotal != null && clientBatchTotal > 1) {
    payload.clientBatchIndex = clientBatchIndex ?? 1;
    payload.clientBatchTotal = clientBatchTotal;
  }

  const endpoint = '/api/v1/video/doubao';
  const fullUrl = `${BASE_URL}${endpoint}`;
  const seedanceHeaders = aitopJsonHeaders();
  const seedanceBody = withScoreProjectId(payload);

  try {
    logAitopModelRequest({
      model: modelLabel,
      method: 'POST',
      url: fullUrl,
      headers: seedanceHeaders,
      body: seedanceBody,
    });
    const response = await fetch(fullUrl, {
      method: 'POST',
      headers: seedanceHeaders,
      body: JSON.stringify(seedanceBody),
    });

    const data = await response.json();

    if (!response.ok) {
      const errorDetail = data?.message || data?.msg || JSON.stringify(data);
      throw new Error(`**❌ ${modelLabel} API 调用失败**\n**HTTP状态：** ${response.status}\n**错误：** ${errorDetail}`);
    }

    if (data.code === 0 && data.success) {
      const taskId = data.data?.taskId;
      if (taskId) {
        return taskId;
      }
    }
    const errMsg = data?.message || data?.msg || '无详细错误信息';
    throw new Error(`**❌ ${modelLabel} 任务创建失败**\n**错误：** ${errMsg}`);
  } catch (e) {
    if (e instanceof Error) throw e;
    throw new Error(`**❌ ${modelLabel} 请求异常**\n${String(e)}`);
  }
}

/** 即梦图生视频 API（参考 jimeng_video_test.py） */
export interface JimengVideoTaskOptions {
  imageUrls: string[];  // 图片 URL 数组（必填，先通过 uploadImage 上传）
  prompt?: string;
  quality?: '720p' | '1080p';  // 3.0 Pro 仅支持 1080p
  seconds?: 5 | 10;
  generateNum?: number;
  seed?: number;
}

/**
 * 创建即梦图生视频任务
 * 接口：POST /api/v1/video/jimeng
 */
export async function createJimengVideoTask(options: JimengVideoTaskOptions): Promise<string | null> {
  const {
    imageUrls,
    prompt = '镜头缓缓推进，人物自然走动',
    quality = '1080p',
    seconds = 5,
    generateNum = 1,
    seed = -1,
  } = options;

  if (!imageUrls?.length) {
    return null;
  }

  const payload = {
    model: 'JI_MENG_3_PRO',
    generateNum,
    seed,
    prompt,
    quality,
    seconds,
    imageUrls,
  };

  try {
    const jimengUrl = `${BASE_URL}/api/v1/video/jimeng`;
    const jimengHeaders = aitopJsonHeaders();
    const jimengBody = withScoreProjectId(payload);
    logAitopModelRequest({
      model: '即梦3.0 Pro',
      method: 'POST',
      url: jimengUrl,
      headers: jimengHeaders,
      body: jimengBody,
    });
    const response = await fetch(jimengUrl, {
      method: 'POST',
      headers: jimengHeaders,
      body: JSON.stringify(jimengBody),
    });

    const data = await response.json();

    if (response.ok && data.success && data.code === 0) {
      const taskId = data.data?.taskId;
      if (taskId) {
        return taskId;
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

// --- 可灵主体库 kLingMainLibrary（与 Python 测试脚本路径一致）---

/**
 * UI 分类 → 可灵主体库 save 的 tag 枚举（AITOP100 文档）
 * OTHER / PERSON / ANIMAL / PROP / CLOTHES / SCENE / EFFECT
 */
export const KLING_SUBJECT_TAG_BY_CATEGORY: Record<string, string> = {
  人物: 'PERSON',
  动物: 'ANIMAL',
  道具: 'PROP',
  服饰: 'CLOTHES',
  场景: 'SCENE',
  特效: 'EFFECT',
  /** 与侧栏主体库历史文案「特性」对齐 */
  特性: 'EFFECT',
  其他: 'OTHER',
};

/** 可灵/AITOP tag → 界面中文（与 NodeInspector KLING_TAG_TO_CATEGORY 一致） */
export const KLING_TAG_TO_UI_CATEGORY: Record<string, string> = {
  PERSON: '人物',
  ANIMAL: '动物',
  PROP: '道具',
  CLOTHES: '服饰',
  SCENE: '场景',
  EFFECT: '特效',
  OTHER: '其他',
  CHARACTER: '人物',
  COSTUME: '服饰',
};

export function uiCategoryToKlingSubjectTag(category: string): string {
  return KLING_SUBJECT_TAG_BY_CATEGORY[category] ?? 'OTHER';
}

export function klingTagToUiCategory(tag: string | undefined): string {
  if (!tag?.trim()) return '其他';
  const u = tag.trim().toUpperCase();
  return KLING_TAG_TO_UI_CATEGORY[u] ?? '其他';
}

/**
 * FlowGen 项目资产列表展示：兼容库存英文枚举、中文及旧别名（与可灵主体库列表映射同源思路）。
 */
export function normalizeAssetCategoryForDisplay(raw: string | undefined): string {
  let s = (raw ?? '').trim();
  if (!s) return '其他';
  const legacy: Record<string, string> = { 其它: '其他', 未分类: '其他', 特性: '特效' };
  if (legacy[s]) s = legacy[s];
  const upperAscii = s.toUpperCase();
  if (/^[A-Z][A-Z_]*$/.test(upperAscii)) return klingTagToUiCategory(upperAscii);
  if (KLING_SUBJECT_TAG_BY_CATEGORY[s]) return s;
  return '其他';
}

export interface KlingSubjectSavePayload {
  elementName: string;
  elementDescription: string;
  elementFrontalImage: string;
  elementRefers: string[];
  tag: string;
}

/** 列表/详情中的单条主体（字段兼容多种命名） */
export interface KlingSubjectRecord {
  id?: string | number;
  elementId?: string;
  element_id?: string;
  elementName?: string;
  elementDescription?: string;
  elementFrontalImage?: string;
  elementRefers?: string[];
  tag?: string;
  [key: string]: unknown;
}

export async function listKlingSubjects(
  pageNo = 1,
  pageSize = 100
): Promise<{ records: KlingSubjectRecord[]; total?: number } | null> {
  try {
    const qs = new URLSearchParams({
      pageNo: String(pageNo),
      pageSize: String(pageSize),
    });
    const listUrl = `${BASE_URL}/api/v1/kLingMainLibrary/page?${qs}`;
    const listHeaders = aitopJsonHeaders();
    const response = await fetch(listUrl, {
      method: 'GET',
      headers: listHeaders,
    });
    const data = await response.json();
    if (data.code !== 0 || !data.success) {
      return null;
    }
    const d = data.data;
    let records: KlingSubjectRecord[] = [];
    if (Array.isArray(d)) {
      records = d as KlingSubjectRecord[];
    } else if (d && typeof d === 'object') {
      const raw =
        (d as { records?: unknown }).records ??
        (d as { list?: unknown }).list ??
        (d as { rows?: unknown }).rows;
      if (Array.isArray(raw)) records = raw as KlingSubjectRecord[];
    }
    const total =
      (d && typeof d === 'object' && (d as { total?: number }).total) ??
      (d && typeof d === 'object' && (d as { totalCount?: number }).totalCount);
    return { records, total };
  } catch (e) {
    return null;
  }
}

export type SaveKlingSubjectResult =
  | { ok: true; id?: string | number; elementId?: string; raw: unknown }
  | { ok: false; message: string; raw: unknown };

export async function saveKlingSubject(payload: KlingSubjectSavePayload): Promise<SaveKlingSubjectResult> {
  try {
    const saveUrl = `${BASE_URL}/api/v1/kLingMainLibrary/save`;
    const saveHeaders = aitopJsonHeaders();
    const saveBody = withScoreProjectId(payload);
    logAitopModelRequest({
      model: '可灵主体库保存',
      method: 'POST',
      url: saveUrl,
      headers: saveHeaders,
      body: saveBody,
    });
    const response = await fetch(saveUrl, {
      method: 'POST',
      headers: saveHeaders,
      body: JSON.stringify(saveBody),
    });
    const text = await response.text();
    let data: { code?: number; success?: boolean; message?: string; msg?: string; data?: unknown; id?: unknown };
    try {
      data = text ? (JSON.parse(text) as typeof data) : {};
    } catch {
      return {
        ok: false,
        message: `HTTP ${response.status}，服务器返回非 JSON`,
        raw: text,
      };
    }
    if (data.code !== 0 || !data.success) {
      const msg = (data.message || data.msg || '创建失败') as string;
      return { ok: false, message: String(msg), raw: data };
    }
    const inner = (data.data && typeof data.data === 'object' ? data.data : {}) as KlingSubjectRecord;
    const id = (inner.id ?? data.id) as string | number | undefined;
    const elementId =
      inner.elementId ?? inner.element_id ?? (data as { elementId?: string }).elementId;
    return { ok: true, id, elementId, raw: data };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e), raw: null };
  }
}

export async function deleteKlingSubject(id: string | number): Promise<{ ok: boolean; message?: string }> {
  try {
    const deleteUrl = `${BASE_URL}/api/v1/kLingMainLibrary/delete/${id}`;
    const deleteHeaders = aitopJsonHeaders();
    const response = await fetch(deleteUrl, {
      method: 'POST',
      headers: deleteHeaders,
    });
    const data = await response.json();
    if (data.code === 0 && data.success) {
      return { ok: true };
    }
    const msg = data.message || data.msg || '删除失败';
    return { ok: false, message: msg };
  } catch (e) {
    return { ok: false, message: String(e) };
  }
}
