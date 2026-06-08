/** 同一 URL 只打一次截帧失败警告，避免控制台被 kechuangai/COS 慢链刷屏 */
const warnedCaptureFailUrls = new Set<string>();

/** 同一 URL 的截帧缓存，避免 Details/缩略图同时触发导致重复耗时 */
const captureThumbnailCache = new Map<string, Promise<string | null>>();

/**
 * 远程视频若直接用原始 URL 加载，canvas 截帧常因 CORS 被污染导致 toDataURL 失败或整帧黑图。
 * 经同源 `/proxy-file` 拉流后截帧稳定（与 FlowEditor 下载/代理逻辑一致）。
 */
export function resolveUrlForVideoCapture(url: string): string {
  if (typeof window === 'undefined') return url;
  if (!url) return url;
  if (url.startsWith('blob:') || url.startsWith('data:')) return url;
  if (url.includes('/proxy-file?')) return url;
  if (!/^https?:\/\//i.test(url)) {
    try {
      const u = new URL(url, window.location.href);
      if (u.origin === window.location.origin) return url;
    } catch {
      return url;
    }
    return url;
  }
  try {
    const parsed = new URL(url);
    if (parsed.origin === window.location.origin) return url;
  } catch {
    return url;
  }
  return `/proxy-file?url=${encodeURIComponent(url)}`;
}

function warnCaptureOnce(url: string, _reason: string) {
  const key = url.length > 160 ? url.slice(0, 160) : url;
  if (warnedCaptureFailUrls.has(key)) return;
  warnedCaptureFailUrls.add(key);
  if (warnedCaptureFailUrls.size > 200) {
    warnedCaptureFailUrls.clear();
  }
}

/** seeked 之后立刻 drawImage 常得到黑帧；等下一帧真正解码绘制后再截 */
function waitForPaintAfterSeek(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    const v = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => void };
    if (typeof v.requestVideoFrameCallback === 'function') {
      v.requestVideoFrameCallback(() => resolve());
      return;
    }
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function tryCapture(url: string, useCors: boolean): Promise<{ result: string | null; reason?: string }> {
  return new Promise((resolve) => {
    const loadUrl = resolveUrlForVideoCapture(url);
    /** 跨域 URL 在浏览器里会走同源 `/proxy-file`，首包/缓冲常 >10s，不能与直连混用短超时 */
    const viaProxy = loadUrl.startsWith('/proxy-file');
    const isStrictBlockedVideoCdn = /aigc-cloud\.com/i.test(url);
    const video = document.createElement('video');
    /** 同源代理不要用 crossOrigin：部分环境下反不利于解码；canvas 仍同源可 toDataURL */
    if (useCors && !viaProxy) video.crossOrigin = 'anonymous';
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.preload = 'auto';

    const startedAt = Date.now();
    /** 无进度事件时的最长等待；代理拉流时给足时间，避免慢 CDN 在 loadeddata 前就判超时 */
    const INACTIVITY_MS = viaProxy ? 90000 : isStrictBlockedVideoCdn ? 14000 : 42000;
    /** 硬上限，避免标签页永久挂死 */
    const ABSOLUTE_MAX_MS = viaProxy ? 240000 : isStrictBlockedVideoCdn ? 45000 : 95000;
    /** seek 后若迟迟不触发 seeked，progress 也会停，易误触全局 inactivity；须短于 INACTIVITY_MS */
    const SEEK_STALL_MS = viaProxy ? 14000 : 10000;
    let lastActivityAt = startedAt;
    let watchdogId: number | null = null;

    const bumpActivity = () => {
      lastActivityAt = Date.now();
    };

    const scheduleWatchdog = () => {
      if (watchdogId != null) window.clearTimeout(watchdogId);
      watchdogId = window.setTimeout(() => {
        watchdogId = null;
        const now = Date.now();
        if (now - lastActivityAt >= INACTIVITY_MS || now - startedAt >= ABSOLUTE_MAX_MS) {
          cleanup();
          resolve({ result: null, reason: 'timeout' });
          return;
        }
        scheduleWatchdog();
      }, 2000);
    };
    scheduleWatchdog();
    const onProgressBump = () => bumpActivity();
    const onSeeked = () => {
      bumpActivity();
    };

    let delayCaptureId: number | null = null;
    const cleanup = () => {
      if (watchdogId != null) window.clearTimeout(watchdogId);
      watchdogId = null;
      video.removeEventListener('loadstart', bumpActivity);
      video.removeEventListener('loadedmetadata', bumpActivity);
      video.removeEventListener('canplay', bumpActivity);
      video.removeEventListener('progress', onProgressBump);
      video.removeEventListener('timeupdate', bumpActivity);
      video.removeEventListener('seeking', bumpActivity);
      if (delayCaptureId != null) window.clearTimeout(delayCaptureId);
      video.removeEventListener('loadeddata', onLoadedData);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      video.src = '';
      video.load();
      video.remove();
    };

    let captureStarted = false;

    // 计算当前帧的平均亮度，返回 dataUrl + 亮度分数
    const captureWithBrightness = (): { dataUrl: string | null; brightness: number } => {
      try {
        if (video.videoWidth === 0 || video.videoHeight === 0) {
          return { dataUrl: null, brightness: 0 };
        }
        // 为了让 dataUrl 在 Node Details / 缩略图中能稳定渲染：对输出做最大尺寸限制
        // 否则直接用原视频分辨率会产生超大的 base64，浏览器可能无法展示或非常慢。
        const MAX_OUT_DIM = 640;
        const srcW = Math.max(1, video.videoWidth);
        const srcH = Math.max(1, video.videoHeight);
        const scale = Math.min(1, MAX_OUT_DIM / Math.max(srcW, srcH));
        const outW = Math.max(1, Math.round(srcW * scale));
        const outH = Math.max(1, Math.round(srcH * scale));

        const canvas = document.createElement('canvas');
        canvas.width = outW;
        canvas.height = outH;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          return { dataUrl: null, brightness: 0 };
        }
        ctx.drawImage(video, 0, 0, outW, outH);
        // 为了性能，只取一个缩小区域来估算亮度
        const sampleSize = 80;
        const tmpCanvas = document.createElement('canvas');
        tmpCanvas.width = sampleSize;
        tmpCanvas.height = sampleSize;
        const tctx = tmpCanvas.getContext('2d');
        if (!tctx) {
          return { dataUrl: null, brightness: 0 };
        }
        tctx.drawImage(canvas, 0, 0, sampleSize, sampleSize);
        const imgData = tctx.getImageData(0, 0, sampleSize, sampleSize);
        const dataArr = imgData.data;
        let total = 0;
        const len = dataArr.length;
        for (let i = 0; i < len; i += 4) {
          // 简单平均灰度
          const r = dataArr[i];
          const g = dataArr[i + 1];
          const b = dataArr[i + 2];
          total += (r + g + b) / 3;
        }
        const brightness = total / (len / 4) / 255; // 0~1
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        // 过滤全黑帧；阈值过低会误杀夜景/暗场素材，过高则易把 CORS 失败时的黑块当成有效图
        const MIN_BRIGHTNESS_ACCEPT = 0.012;
        if (brightness < MIN_BRIGHTNESS_ACCEPT) {
          return { dataUrl: null, brightness };
        }
        return { dataUrl, brightness };
      } catch (_e) {
        return { dataUrl: null, brightness: 0 };
      }
    };

    // 多时间点采样，选亮度最高的一帧（避开片头黑场 / 非关键帧黑屏）
    /** 走代理时少采几点，降低「某次 seek 卡死」概率与总耗时 */
    const samplePoints = viaProxy ? [0.05, 0.22, 0.48, 0.78] : [0.02, 0.08, 0.18, 0.35, 0.55, 0.72, 0.9];
    let best: { dataUrl: string | null; brightness: number } | null = null;

    /** 单次 seek：超时则继续下一采样点，避免 seeked 永不触发时拖满全局 watchdog */
    const seekOnceTo = (targetTime: number): Promise<void> =>
      new Promise((resolve) => {
        bumpActivity();
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          video.removeEventListener('seeked', onOnce);
          window.clearTimeout(stalledId);
          bumpActivity();
          resolve();
        };
        const onOnce = () => finish();
        const stalledId = window.setTimeout(finish, SEEK_STALL_MS);
        video.addEventListener('seeked', onOnce);
        video.currentTime = targetTime;
      });

    let extraTried = false;
    const tryExtraMidFrame = async (duration: number) => {
      if (extraTried) {
        if (best && best.dataUrl) resolve({ result: best.dataUrl });
        else resolve({ result: null, reason: 'no-samples' });
        cleanup();
        return;
      }
      extraTried = true;
      try {
        const target = Math.min(Math.max(duration * 0.48, 0.08), duration - 0.05);
        // 若与当前时刻过近，seek 可能不触发 seeked，略偏移
        const t = Math.abs(video.currentTime - target) < 0.08 ? Math.min(target + 0.12, duration - 0.04) : target;
        video.currentTime = t;
        await new Promise<void>((r) => {
          const once = () => {
            video.removeEventListener('seeked', once);
            r();
          };
          video.addEventListener('seeked', once);
          window.setTimeout(() => {
            video.removeEventListener('seeked', once);
            r();
          }, 2000);
        });
        await waitForPaintAfterSeek(video);
        await new Promise((r) => setTimeout(r, 48));
        const shot = captureWithBrightness();
        if (shot.dataUrl && (!best || shot.brightness > best.brightness)) {
          best = shot;
        }
      } catch {
        /* ignore */
      }
      // extra 仍然太暗：返回 null，避免黑块
      if (best && best.dataUrl) {
        const MIN_BRIGHTNESS_ACCEPT = 0.012;
        if (best.brightness >= MIN_BRIGHTNESS_ACCEPT) resolve({ result: best.dataUrl });
        else resolve({ result: null, reason: 'too-dark' });
      }
      else resolve({ result: null, reason: 'no-samples' });
      cleanup();
    };

    const onLoadedData = () => {
      if (captureStarted) return;
      captureStarted = true;
      bumpActivity();
      if (video.videoWidth === 0 || video.videoHeight === 0) {
        cleanup();
        resolve({ result: null, reason: 'zero-size' });
        return;
      }
      const duration = video.duration;
      if (Number.isFinite(duration) && duration > 0) {
        void (async () => {
          try {
            for (let si = 0; si < samplePoints.length; si++) {
              const t = duration * samplePoints[si];
              const targetTime = Math.max(0.01, Math.min(t, Math.max(0.02, duration - 0.04)));
              await seekOnceTo(targetTime);
              await waitForPaintAfterSeek(video);
              await new Promise((r) => setTimeout(r, 16));
              bumpActivity();
              const shot = captureWithBrightness();
              if (shot.dataUrl) {
                if (!best || shot.brightness > best.brightness) {
                  best = shot;
                }
              }
            }
            if (best && best.dataUrl) {
              const tooDark = best.brightness < 0.03;
              if (tooDark && Number.isFinite(duration) && duration > 0.3) {
                await tryExtraMidFrame(duration);
                return;
              }
              resolve({ result: best.dataUrl });
            } else {
              resolve({ result: null, reason: 'no-samples' });
            }
            cleanup();
          } catch {
            resolve({ result: null, reason: 'no-samples' });
            cleanup();
          }
        })();
      } else {
        // duration 未就绪（如部分 CDN/vidu）：延迟再截帧，给首帧解码时间，避免黑屏
        delayCaptureId = window.setTimeout(() => {
          delayCaptureId = null;
          if (video.readyState >= 2 && video.videoWidth > 0) {
            void (async () => {
              await waitForPaintAfterSeek(video);
              await new Promise((r) => setTimeout(r, 32));
              const shot = captureWithBrightness();
              if (shot.dataUrl) {
                resolve({ result: shot.dataUrl });
              } else {
                resolve({ result: null, reason: 'zero-size' });
              }
              cleanup();
            })();
          }
          else {
            void (async () => {
              await seekOnceTo(0.5);
              await waitForPaintAfterSeek(video);
              await new Promise((r) => setTimeout(r, 32));
              const shot = captureWithBrightness();
              if (shot.dataUrl) {
                resolve({ result: shot.dataUrl });
              } else {
                resolve({ result: null, reason: 'zero-size' });
              }
              cleanup();
            })();
          }
        }, 600);
      }
    };

    const onError = () => {
      cleanup();
      resolve({ result: null, reason: 'video-error' });
    };

    // 加载过程中持续 bump，避免「仅 startedAt、久无 loadeddata」被误判为卡死（此前未挂 progress 等，慢链必现 timeout）
    video.addEventListener('loadstart', bumpActivity);
    video.addEventListener('loadedmetadata', bumpActivity);
    video.addEventListener('canplay', bumpActivity);
    video.addEventListener('progress', onProgressBump);
    video.addEventListener('timeupdate', bumpActivity);
    video.addEventListener('seeking', bumpActivity);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('loadeddata', onLoadedData);
    video.addEventListener('error', onError);
    video.src = loadUrl;
    video.load();
  });
}

/**
 * 用 canvas 截取视频中间帧为 JPEG data URL，用于缩略图。
 * 先尝试 CORS，失败则尝试不带 CORS（同源或部分 CDN 可用）。
 */
export function captureVideoMiddleFrame(url: string): Promise<string | null> {
  if (!url) return Promise.resolve(null);
  const key = url;
  const cached = captureThumbnailCache.get(key);
  if (cached) return cached;
  const loadUrlEarly = resolveUrlForVideoCapture(url);
  const viaProxyEarly = loadUrlEarly.startsWith('/proxy-file');
  const isStrictBlockedVideoCdn = /aigc-cloud\.com/i.test(url);

  const p = tryCapture(url, true).then((out) => {
    if (out.result) return out.result;
    // 直连 aigc 等域名才快速失败；走 /proxy-file 同源时应允许第二次 no-CORS 尝试
    if (isStrictBlockedVideoCdn && !viaProxyEarly) {
      const reason = out.reason || 'blocked-cdn-fast-fail';
      warnCaptureOnce(url, reason);
      return null;
    }
    return tryCapture(url, false).then((out2) => {
      if (out2.result) return out2.result;
      const reason = out.reason || out2.reason || 'unknown';
      warnCaptureOnce(url, reason);
      return null;
    });
  });

  if (captureThumbnailCache.size > 100) {
    let n = 0;
    const drop = 50;
    for (const k of captureThumbnailCache.keys()) {
      captureThumbnailCache.delete(k);
      if (++n >= drop) break;
    }
  }
  captureThumbnailCache.set(key, p);
  void p.then((result) => {
    if (!result) captureThumbnailCache.delete(key);
  });
  return p;
}
