import './scripts/load-env-local.mjs';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createProxyMiddleware } from 'http-proxy-middleware';
import https from 'https';
import http from 'http';
import os from 'os';
import axios from 'axios';
import {
  buildPromptMediaRefContextFromNode,
  resolvePromptPlaceholders,
} from './promptPlaceholders.mjs';
import { createFlowgenRouter } from './server/flowgen/routes.mjs';
import { initStore, loadStore, bootstrapAdminIfNeeded } from './server/flowgen/store.mjs';

// 在 ES Module 中，__dirname 变量不存在，需要手动创建
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '50mb' }));

function forwardParsedJsonBody(proxyReq, req) {
  const method = (req.method || '').toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return;
  const body = req.body;
  if (!body || typeof body !== 'object') return;
  const bodyData = JSON.stringify(body);
  proxyReq.setHeader('Content-Type', 'application/json');
  proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
  proxyReq.write(bodyData);
}

/** 多用户 / 项目 / 资产库 API（生产与预览同端口） */
let flowgenApiMounted = false;
try {
  await initStore();
  const flowStore = loadStore();
  bootstrapAdminIfNeeded(flowStore);
  app.use('/flowgen-api', createFlowgenRouter());
  flowgenApiMounted = true;
} catch (e) {
  console.error('[flowgen-api] failed to mount:', e);
}
/** 未匹配的 /flowgen-api 请求必须返回 JSON，勿落入下方 SPA 的 index.html（否则前端误报「收到 HTML」） */
app.use('/flowgen-api', (req, res) => {
  if (!flowgenApiMounted) {
    return res.status(503).json({
      error: 'FlowGen API 未挂载',
      detail:
        '请查看本进程启动日志中的 [flowgen-api] failed to mount。开发请使用 npm run dev:full；生产请确认已部署 server/flowgen 且依赖完整。',
    });
  }
  return res.status(404).json({
    error: 'FlowGen API 路径不存在',
    path: req.originalUrl || req.url,
  });
});
const AITOP_API_BASE = 'https://aitop100-api.hytch.com';
const AITOP_API_KEY = process.env.AITOP_API_KEY || 'aitop-key-4MGEBAFEArM3HRaJ0P77EkhEAtxseJma';
const AITOP_FILE_PREFIX = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/';
const AITOP_STATUS_TIMEOUT_MS = 90000;
const AITOP_STATUS_RETRY_TIMES = 1;

// 配置端口：优先使用环境变量，否则使用 3001（服务器部署默认端口）
const PORT = process.env.PORT || 3001;

async function fetchTaskStatusWithRetry(taskId) {
  const url = `${AITOP_API_BASE}/api/v1/task/${encodeURIComponent(taskId)}`;
  let lastError = null;
  for (let i = 0; i <= AITOP_STATUS_RETRY_TIMES; i++) {
    try {
      return await axios.get(url, {
        headers: { 'api-key': AITOP_API_KEY },
        timeout: AITOP_STATUS_TIMEOUT_MS,
        validateStatus: () => true,
      });
    } catch (err) {
      lastError = err;
      if (i < AITOP_STATUS_RETRY_TIMES) {
        await new Promise((r) => setTimeout(r, 1200));
      }
    }
  }
  throw lastError;
}

function isAitopCosMediaUrl(url) {
  return Boolean(url && /aitop100app-.*\.myqcloud\.com/i.test(String(url).trim()));
}

/** 服务端拉取远程媒体（火山/ark-acg 等），规避浏览器 CORS 与签名链限制 */
async function downloadRemoteUrlToBuffer(fileUrl) {
  const target = new URL(fileUrl);
  if (!/^https?:$/.test(target.protocol)) {
    throw new Error('仅支持 http/https URL');
  }
  const baseHeaders = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    Accept: '*/*',
  };
  const headerSets = [
    {
      ...baseHeaders,
      Referer: `${target.protocol}//${target.host}/`,
      Origin: `${target.protocol}//${target.host}`,
    },
    { ...baseHeaders },
    {
      ...baseHeaders,
      Referer: 'https://www.volcengine.com/',
      Origin: 'https://www.volcengine.com',
    },
  ];
  let lastStatus = 0;
  for (const headers of headerSets) {
    try {
      const upstream = await axios.get(target.toString(), {
        method: 'GET',
        headers,
        timeout: 300000,
        maxRedirects: 8,
        responseType: 'arraybuffer',
        validateStatus: () => true,
      });
      lastStatus = upstream.status || 0;
      if (upstream.status >= 200 && upstream.status < 300 && upstream.data?.byteLength > 0) {
        return {
          buffer: upstream.data,
          contentType: upstream.headers['content-type'] || 'application/octet-stream',
        };
      }
    } catch {
      /* 下一组请求头重试 */
    }
  }
  throw new Error(`上游资源获取失败（HTTP ${lastStatus || 'unknown'}）`);
}

async function uploadBufferToAitop(buffer, filename, contentType) {
  const form = new FormData();
  const blob = new Blob([buffer], { type: contentType || 'application/octet-stream' });
  form.append('file', blob, filename || 'media.bin');
  const resp = await fetch(`${AITOP_API_BASE}/api/v1/file/upload`, {
    method: 'POST',
    headers: { 'api-key': AITOP_API_KEY },
    body: form,
  });
  const data = await resp.json().catch(() => ({}));
  if (data?.code === 0 && data?.success && data?.data?.key) {
    return AITOP_FILE_PREFIX + data.data.key;
  }
  throw new Error(data?.message || data?.msg || 'AiTop 上传失败');
}

/**
 * 组生图/生视频 payload 前由 BFF 调用：把 @主图、@图片1 等换成可读中文；媒体仍走各模型专用字段。
 * POST JSON: { prompt?: string, negativePrompt?: string, nodeData: object, context?: object, subjectCaption?: string }
 * context 可选，与前端 PromptMediaRefContext 同形；缺省时从 nodeData（含 selectedModel、klingOmniTab 等）推导。
 */
app.post('/flowgen-expand-prompt', (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const { prompt, negativePrompt, nodeData, context, subjectCaption } = body;
    if (typeof prompt !== 'string' && typeof negativePrompt !== 'string') {
      return res.status(400).json({
        error: '至少提供字符串字段 prompt 或 negativePrompt',
      });
    }
    const data = nodeData && typeof nodeData === 'object' ? nodeData : {};
    const baseCtx = buildPromptMediaRefContextFromNode(data);
    const ctx =
      context && typeof context === 'object'
        ? { ...baseCtx, ...context }
        : baseCtx;
    const options =
      subjectCaption != null && String(subjectCaption).trim()
        ? { subjectCaption: String(subjectCaption).trim() }
        : undefined;
    const out = {};
    if (typeof prompt === 'string') {
      out.prompt = resolvePromptPlaceholders(prompt, data, ctx, options);
    }
    if (typeof negativePrompt === 'string') {
      out.negativePrompt = resolvePromptPlaceholders(negativePrompt, data, ctx, options);
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.json(out);
  } catch (e) {
    res.status(500).json({
      error: 'expand-prompt 失败',
      message: e instanceof Error ? e.message : String(e),
    });
  }
});

// 本机登录用户：用于前端生成对话 id 的前缀
app.get('/whoami', (req, res) => {
  try {
    const info = os.userInfo();
    const username = (info && info.username) ? String(info.username) : '';
    res.json({ username });
  } catch (e) {
    res.status(200).json({ username: '' });
  }
});

// 通用文件代理端点：用于绕过浏览器 CORS（支持图片/视频下载）
app.get('/proxy-file', async (req, res) => {
  const fileUrl = req.query.url;
  if (!fileUrl || typeof fileUrl !== 'string') {
    return res.status(400).json({ error: '缺少文件URL参数' });
  }

  try {
    const target = new URL(fileUrl);
    if (!/^https?:$/.test(target.protocol)) {
      return res.status(400).json({ error: '仅支持 http/https URL' });
    }

    const range = req.headers.range;
    const ifRange = req.headers['if-range'];
    const baseCommonHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept': '*/*',
    };
    const firstTryHeaders = {
      ...baseCommonHeaders,
      'Referer': `${target.protocol}//${target.host}/`,
      'Origin': `${target.protocol}//${target.host}`,
    };
    const secondTryHeaders = {
      ...baseCommonHeaders,
    };
    if (typeof range === 'string' && range.length > 0) {
      firstTryHeaders.Range = range;
      secondTryHeaders.Range = range;
    }
    if (typeof ifRange === 'string' && ifRange.length > 0) {
      firstTryHeaders['If-Range'] = ifRange;
      secondTryHeaders['If-Range'] = ifRange;
    }

    let upstream = null;
    let lastErr = null;
    for (const headers of [firstTryHeaders, secondTryHeaders]) {
      try {
        upstream = await axios.get(target.toString(), {
          method: 'GET',
          headers,
          timeout: 120000,
          maxRedirects: 5,
          responseType: 'stream',
          validateStatus: () => true,
        });
        break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (!upstream) {
      throw lastErr || new Error('upstream request failed');
    }
    if (upstream.status < 200 || upstream.status >= 300 || !upstream.data) {
      return res.status(upstream.status || 500).json({
        error: '文件获取失败',
        statusCode: upstream.status || 500,
      });
    }

    const contentType = upstream.headers['content-type'] || 'application/octet-stream';
    const contentLength = upstream.headers['content-length'];
    const contentRange = upstream.headers['content-range'];
    const acceptRanges = upstream.headers['accept-ranges'];
    res.status(upstream.status || 200);
    if (contentLength) res.setHeader('Content-Length', contentLength);
    if (contentRange) res.setHeader('Content-Range', contentRange);
    if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);
    res.setHeader('Content-Type', contentType);
    // 明确 inline，避免浏览器/下载工具把预览代理当成附件保存为「proxy-file」
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    upstream.data.pipe(res);
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ error: '文件代理处理失败', message: error instanceof Error ? error.message : String(error) });
    }
  }
});

// 通过 taskId 服务端实时查询并下载文件，规避前端临时签名 URL 过期/CORS 问题
app.get('/download-task-file', async (req, res) => {
  const taskId = req.query.taskId;
  if (!taskId || typeof taskId !== 'string') {
    return res.status(400).json({ error: '缺少 taskId 参数' });
  }
  try {
    const statusResp = await fetchTaskStatusWithRetry(taskId);
    const statusJson = statusResp?.data || {};
    const resourceUrl = statusJson?.data?.resourceUrl;
    if (!resourceUrl || typeof resourceUrl !== 'string') {
      return res.status(404).json({ error: '任务暂无可下载资源', taskId, detail: statusJson?.message || '' });
    }

    const upstream = await axios.get(resourceUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': '*/*',
      },
      timeout: 60000,
      responseType: 'stream',
      validateStatus: () => true,
    });
    if (upstream.status < 200 || upstream.status >= 300 || !upstream.data) {
      return res.status(upstream.status || 502).json({
        error: '上游资源获取失败',
        status: upstream.status,
        taskId
      });
    }

    const contentType = upstream.headers['content-type'] || 'application/octet-stream';
    const contentLength = upstream.headers['content-length'];
    res.status(200);
    res.setHeader('Content-Type', contentType);
    if (contentLength) res.setHeader('Content-Length', contentLength);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    upstream.data.pipe(res);
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({
        error: '下载中转失败',
        message: error instanceof Error ? error.message : String(error),
        taskId
      });
    }
  }
});

// 服务端转存远程媒体到 AiTop COS（Seedance 成片 / 参考视频等；不依赖浏览器 CORS）
app.post('/mirror-media-to-aitop', async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const taskId = typeof body.taskId === 'string' ? body.taskId.trim() : '';
  let src = typeof body.url === 'string' ? body.url.trim() : '';
  const filename =
    typeof body.filename === 'string' && body.filename.trim()
      ? body.filename.trim()
      : 'video.mp4';

  try {
    if (taskId) {
      const statusResp = await fetchTaskStatusWithRetry(taskId);
      const envelope = statusResp?.data || {};
      const sd = envelope?.data && typeof envelope.data === 'object' ? envelope.data : envelope;
      const statusUrl =
        typeof sd?.resourceUrl === 'string'
          ? sd.resourceUrl.trim()
          : typeof sd?.videoUrl === 'string'
            ? sd.videoUrl.trim()
            : '';
      if (statusUrl) src = statusUrl;
      if (isAitopCosMediaUrl(src)) {
        return res.json({ ok: true, url: src, via: 'task-status' });
      }
    }

    if (!src) {
      return res.status(400).json({ error: '缺少 url 或 taskId' });
    }
    if (isAitopCosMediaUrl(src)) {
      return res.json({ ok: true, url: src, via: 'already-aitop' });
    }

    const { buffer, contentType } = await downloadRemoteUrlToBuffer(src);
    const outUrl = await uploadBufferToAitop(buffer, filename, contentType);
    return res.json({ ok: true, url: outUrl, via: 'server-mirror' });
  } catch (error) {
    return res.status(502).json({
      error: '转存 AiTop 失败',
      message: error instanceof Error ? error.message : String(error),
      taskId: taskId || undefined,
    });
  }
});

// 任务状态中转：由服务端请求 AiTop，规避浏览器侧 CORS
app.get('/task-status', async (req, res) => {
  const taskId = req.query.taskId;
  if (!taskId || typeof taskId !== 'string') {
    return res.status(400).json({ error: '缺少 taskId 参数' });
  }
  try {
    const statusResp = await fetchTaskStatusWithRetry(taskId);
    res.status(statusResp.status || 500);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.send(JSON.stringify(statusResp.data || {}));
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({
        error: '任务状态中转失败',
        message: error instanceof Error ? error.message : String(error),
        taskId
      });
    }
  }
});

// AiTop LLM 同源中转：避免浏览器直连 CORS/网关差异导致的 Failed to fetch
app.post('/aitop-llm-see', async (req, res) => {
  try {
    const runOnce = () =>
      axios.post('https://aitop100-api.hytch.com/api/v1/llm/see', req.body, {
        headers: {
          'api-key': req.headers['api-key'] || AITOP_API_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 120000,
        responseType: 'stream',
        validateStatus: () => true,
      });

    let upstream = await runOnce();
    if ((upstream.status === 502 || upstream.status === 504) && req.body && typeof req.body === 'object') {
      // 网关抖动时快速重试一次，降低前端失败率
      await new Promise((r) => setTimeout(r, 250));
      upstream = await runOnce();
    }
    res.status(upstream.status || 502);
    const ct = upstream.headers['content-type'] || 'text/plain; charset=utf-8';
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, api-key');
    res.setHeader(
      'Access-Control-Expose-Headers',
      'x-request-id, x-trace-id, request-id, trace-id'
    );
    if (upstream.headers['x-request-id']) {
      res.setHeader('x-request-id', upstream.headers['x-request-id']);
    }
    if (upstream.headers['x-trace-id']) {
      res.setHeader('x-trace-id', upstream.headers['x-trace-id']);
    }
    upstream.data.pipe(res);
  } catch (error) {
    console.error('[AiTop Relay Error]', error instanceof Error ? error.message : String(error));
    res.status(502).json({
      error: 'AiTop LLM 中转失败',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// 图片代理端点：用于绕过CORS限制获取远程图片
app.get('/proxy-image', async (req, res) => {
  const imageUrl = req.query.url;
  
  if (!imageUrl || typeof imageUrl !== 'string') {
    return res.status(400).json({ error: '缺少图片URL参数' });
  }

  try {
    console.log(`[Image Proxy] 代理请求图片: ${imageUrl.substring(0, 100)}`);
    
    // 处理base64格式的图片
    if (imageUrl.startsWith('data:image/')) {
      console.log('[Image Proxy] 检测到base64格式图片');
      try {
        // 提取base64数据
        const base64Data = imageUrl.split(',')[1];
        if (!base64Data) {
          return res.status(400).json({ error: 'Base64数据格式不正确' });
        }
        
        // 提取MIME类型
        const mimeMatch = imageUrl.match(/^data:image\/([^;]+)/);
        const mimeType = mimeMatch ? `image/${mimeMatch[1]}` : 'image/png';
        
        // 将base64转换为Buffer
        const imageBuffer = Buffer.from(base64Data, 'base64');
        
        console.log(`[Image Proxy] Base64转换成功: ${imageBuffer.length} bytes, Content-Type: ${mimeType}`);
        
        // 设置响应头
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Length', imageBuffer.length);
        res.setHeader('Content-Disposition', 'inline');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        
        // 发送图片数据
        res.send(imageBuffer);
        return;
      } catch (error) {
        console.error(`[Image Proxy] Base64处理失败:`, error);
        return res.status(500).json({ 
          error: 'Base64图片处理失败', 
          message: error.message 
        });
      }
    }
    
    // 处理blob URL（需要从浏览器获取，这里暂时不支持，应该先转换为base64）
    if (imageUrl.startsWith('blob:')) {
      return res.status(400).json({ 
        error: 'Blob URL需要通过前端转换为base64后再发送' 
      });
    }
    
    // 使用Node.js的http/https模块获取远程图片
    const url = new URL(imageUrl);
    const client = url.protocol === 'https:' ? https : http;
    
    client.get(imageUrl, (response) => {
      // 检查响应状态
      if (response.statusCode !== 200) {
        console.error(`[Image Proxy] HTTP错误: ${response.statusCode}`);
        return res.status(response.statusCode || 500).json({ 
          error: '图片获取失败', 
          statusCode: response.statusCode 
        });
      }

      // 收集图片数据
      const chunks = [];
      let totalLength = 0;
      
      response.on('data', (chunk) => {
        chunks.push(chunk);
        totalLength += chunk.length;
      });
      
      response.on('end', () => {
        try {
          // 合并所有数据块
          const imageBuffer = Buffer.concat(chunks, totalLength);
          
          // 检测Content-Type
          const contentType = response.headers['content-type'] || 
                            (imageUrl.toLowerCase().endsWith('.png') ? 'image/png' :
                             imageUrl.toLowerCase().endsWith('.jpg') || imageUrl.toLowerCase().endsWith('.jpeg') ? 'image/jpeg' :
                             imageUrl.toLowerCase().endsWith('.gif') ? 'image/gif' :
                             imageUrl.toLowerCase().endsWith('.webp') ? 'image/webp' :
                             'image/jpeg');
          
          console.log(`[Image Proxy] 图片获取成功: ${totalLength} bytes, Content-Type: ${contentType}`);
          
          // 设置响应头
          res.setHeader('Content-Type', contentType);
          res.setHeader('Content-Length', totalLength);
          res.setHeader('Content-Disposition', 'inline');
          res.setHeader('Cache-Control', 'public, max-age=3600');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

          // 发送图片数据
          res.send(imageBuffer);
        } catch (error) {
          console.error(`[Image Proxy] 数据处理失败:`, error);
          res.status(500).json({ 
            error: '图片数据处理失败', 
            message: error.message 
          });
        }
      });
      
      response.on('error', (error) => {
        console.error(`[Image Proxy] 响应流错误:`, error.message);
        if (!res.headersSent) {
          res.status(500).json({ 
            error: '图片数据流错误', 
            message: error.message 
          });
        }
      });
    }).on('error', (error) => {
      console.error(`[Image Proxy] 请求失败:`, error.message);
      if (!res.headersSent) {
        res.status(500).json({ 
          error: '图片代理请求失败', 
          message: error.message 
        });
      }
    });
  } catch (error) {
    console.error(`[Image Proxy] 处理失败:`, error);
    if (!res.headersSent) {
      res.status(500).json({ 
        error: '图片代理处理失败', 
        message: error.message 
      });
    }
  }
});

// Qwen 上游（与 test.py 一致；内网可设 QWEN_PROXY_TARGET）
function resolveQwenUpstreamBase() {
  const raw = (process.env.QWEN_PROXY_TARGET || 'https://models.fangte.com').trim();
  let base = raw.replace(/\/$/, '');
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  try {
    const u = new URL(base);
    const port = u.port || (u.protocol === 'https:' ? '443' : '80');
    const isLoopbackHost = /^(localhost|127\.0\.0\.1)$/i.test(u.hostname);
    const isSamePortAsApp = port === String(PORT);
    if (isLoopbackHost && isSamePortAsApp) {
      console.error(
        `[Qwen] QWEN_PROXY_TARGET=${raw} 指向本机 :${PORT}，已回退为 https://models.fangte.com`
      );
      return 'https://models.fangte.com';
    }
  } catch {
    return 'https://models.fangte.com';
  }
  return base;
}

const QWEN_UPSTREAM_BASE = resolveQwenUpstreamBase();
/** 默认 600s，与 test.py 的 timeout=600 一致 */
const QWEN_PROXY_TIMEOUT_MS = Number(process.env.QWEN_PROXY_TIMEOUT_MS) || 600_000;

/**
 * Qwen 对话：服务端 axios 直连上游（同 test.py），不用 http-proxy 避免 ~60s 网关 504。
 * 浏览器 POST /api/v1/chat/completions → https://models.fangte.com/v1/chat/completions
 */
app.post('/api/v1/chat/completions', async (req, res) => {
  const upstreamUrl = `${QWEN_UPSTREAM_BASE}/v1/chat/completions`;
  const started = Date.now();
  const isStream = !!(req.body && req.body.stream === true);
  try {
    console.log(`[Qwen Forward] POST ${req.originalUrl || req.url} -> ${upstreamUrl} stream=${isStream}`);
    const response = await axios.post(upstreamUrl, req.body, {
      headers: {
        'Content-Type': 'application/json',
        ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}),
      },
      timeout: QWEN_PROXY_TIMEOUT_MS,
      validateStatus: () => true,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      responseType: isStream ? 'stream' : 'json',
    });
    console.log(`[Qwen Forward] status=${response.status} stream=${isStream} elapsedMs=${Date.now() - started}`);
    res.status(response.status);
    const ct = response.headers['content-type'];
    if (ct) res.setHeader('Content-Type', ct);
    if (isStream && response.data && typeof response.data.pipe === 'function') {
      res.setHeader('Cache-Control', 'no-store');
      response.data.pipe(res);
      return;
    }
    return res.send(response.data);
  } catch (err) {
    const elapsedMs = Date.now() - started;
    console.error('[Qwen Forward Error]', err.message, { upstreamUrl, elapsedMs });
    if (!res.headersSent) {
      const isTimeout = err.code === 'ECONNABORTED' || /timeout/i.test(String(err.message));
      return res.status(isTimeout ? 504 : 502).json({
        error: 'Qwen 转发失败',
        message: err.message,
        upstream: upstreamUrl,
        elapsedMs,
        hint: '与 test.py 相同路径；请确认本机可访问 https://models.fangte.com',
      });
    }
  }
});

console.warn(`[Qwen Forward] upstream=${QWEN_UPSTREAM_BASE} timeoutMs=${QWEN_PROXY_TIMEOUT_MS}`);

// AiTop LLM 代理：用于 Gemini / Claude，避免浏览器直连 CORS 并统一超时策略
app.use('/aitop-api', createProxyMiddleware({
  target: 'https://aitop100-api.hytch.com',
  changeOrigin: true,
  timeout: 120000,
  proxyTimeout: 120000,
  pathRewrite: {
    '^/aitop-api': '/api',
  },
  onProxyReq: (proxyReq, req, res) => {
    console.log(`[AiTop Proxy] ${req.method} ${req.url} -> ${proxyReq.path}`);
    forwardParsedJsonBody(proxyReq, req);
  },
  onError: (err, req, res) => {
    console.error('[AiTop Proxy Error]', err.message);
    res.status(502).json({ error: 'AiTop 代理请求失败', message: err.message });
  }
}));


// 指定静态资源目录为 'dist' 文件夹（入口页不缓存，避免部署后刷新仍用旧 index 引用旧 hash 资源）
app.use(
  express.static(path.join(__dirname, 'dist'), {
    setHeaders(res, filepath) {
      if (filepath.replace(/\\/g, '/').endsWith('/index.html')) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      }
    },
  })
);

// 处理 SPA (单页应用) 路由
// 任何不匹配静态文件的请求，都返回 index.html，让 React Router 接管
// 注意：勿对 Vite 开发期路径回退到 index.html，否则浏览器按 JS/CSS 模块加载会得到 text/html 触发 MIME 报错
app.get('*', (req, res) => {
  const p = req.path || '';
  if (p.startsWith('/flowgen-api')) {
    res.status(flowgenApiMounted ? 404 : 503);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.json(
      flowgenApiMounted
        ? { error: 'FlowGen API 路径不存在', path: req.originalUrl || req.url }
        : {
            error: 'FlowGen API 未挂载',
            detail:
              '请查看启动日志 [flowgen-api] failed to mount。开发请 npm run dev:full；勿仅打开 Vite 而未起 3001 API。',
          }
    );
  }
  /** 勿对静态资源路径回退 index.html，否则 <script type="module" src="/assets/*.js"> 会得到 text/html 触发 Strict MIME 报错 */
  /** 含 .ts/.tsx：勿把 SPA 回退成 index.html（否则会 MIME=text/html，酷似「模块脚本却是 HTML」） */
  const looksLikeStaticAsset =
    p.startsWith('/assets/') ||
    /\.(?:js|mjs|cjs|css|map|json|wasm|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|webp|ico|avif|ts|tsx)$/i.test(
      p
    );
  if (looksLikeStaticAsset) {
    res.status(404);
    res.type('text/plain; charset=utf-8');
    const tsHint = /\.(?:tsx?)$/i.test(p)
      ? ' 若路径为 .ts/.tsx：当前是生产服务器，不应直接请求源码模块；请本地开发用 npm run dev，若已构建请仅用 dist 内 hashed 的 /assets/*.js。'
      : '';
    return res.send(
      '静态资源未找到（404）。使用 node server.js 时请先执行 npm run build，并确保部署了完整 dist（含 dist/assets）。若刚部署过新版本，请强制刷新(Ctrl+Shift+R)以免浏览器仍缓存旧 index.html 里已过期的 *.js 文件名。开发请用 npm run dev，勿用生产服务器加载开发期入口。' +
        tsHint
    );
  }
  const devOnlyHint =
    '当前是生产模式 (node server.js)，不应请求 Vite 开发入口。请二选一：① 开发：npm run dev；② 生产：npm run build 后 npm start，并对本页强制刷新(Ctrl+Shift+R)清除旧缓存。';
  if (
    p.startsWith('/node_modules/') ||
    p.startsWith('/@vite/') ||
    p.startsWith('/@fs/') ||
    p.startsWith('/@id/') ||
    p.startsWith('/.vite/') ||
    p.startsWith('/src/') ||
    p === '/index.tsx' ||
    p === '/index.css'
  ) {
    res.status(404);
    res.type('text/plain; charset=utf-8');
    return res.send(devOnlyHint);
  }
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// 启动服务器 - 监听所有网络接口，支持局域网访问
app.listen(PORT, '0.0.0.0', () => {
  console.log(`=========================================`);
  console.log(`FlowGen AI Studio 服务器已启动!`);
  console.log(`本地访问: http://localhost:${PORT}`);
  console.log(`局域网访问: http://[您的IP地址]:${PORT}`);
  console.log(`请确保防火墙已放行该端口。`);
  console.log(`=========================================`);
});