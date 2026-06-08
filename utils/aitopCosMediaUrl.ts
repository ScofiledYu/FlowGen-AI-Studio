/** AiTop 腾讯 COS 公网地址（上传/任务转存后的稳定链） */
export function isAitopCosUrl(url?: string): boolean {
  return Boolean(url && /aitop100app-.*\.myqcloud\.com/i.test(String(url).trim()));
}

export type AitopCosUploadFn = (src: string, filename?: string) => Promise<string | null>;

/** 优先走 Node 服务端下载并上传 AiTop，避免浏览器 /proxy-file CORS 失败 */
export async function mirrorMediaToAitopViaServer(
  mediaUrl: string,
  options?: { filename?: string; taskId?: string }
): Promise<string | null> {
  if (typeof fetch === 'undefined') return null;
  try {
    const res = await fetch('/mirror-media-to-aitop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: mediaUrl,
        filename: options?.filename,
        taskId: options?.taskId,
      }),
    });
    const data = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
    if (res.ok && data?.url && isAitopCosUrl(data.url)) return data.url;
  } catch {
    /* 回退浏览器侧 upload */
  }
  return null;
}

/**
 * 将任意可拉取的参考视频/成片 URL 转存到 AiTop COS。
 * 已是 aitop 则原样返回；失败时抛错（不静默保留 ark-acg 等第三方 CDN）。
 */
export async function ensureAitopCosVideoUrl(
  videoUrl: string,
  upload: AitopCosUploadFn,
  options?: { label?: string; filename?: string; taskId?: string }
): Promise<string> {
  const u = String(videoUrl || '').trim();
  if (!u) {
    throw new Error(options?.label ? `${options.label} 地址为空` : '视频地址为空');
  }
  if (isAitopCosUrl(u)) return u;

  const viaServer = await mirrorMediaToAitopViaServer(u, {
    filename: options?.filename,
    taskId: options?.taskId,
  });
  if (viaServer) return viaServer;

  const uploaded = await upload(u, options?.filename);
  if (uploaded && isAitopCosUrl(uploaded)) return uploaded;

  throw new Error(
    `${options?.label || '视频'}转存 AiTop 失败。` +
      '若为上游 ark-acg / 火山 CDN，请检查服务器能否访问火山存储，或联系 AiTop 确认任务是否已 TRANSFER_SUCCESS。'
  );
}

/** 参考音频等同理转存 AiTop */
export async function ensureAitopCosAudioUrl(
  audioUrl: string,
  upload: AitopCosUploadFn,
  options?: { label?: string; filename?: string; taskId?: string }
): Promise<string> {
  const u = String(audioUrl || '').trim();
  if (!u) {
    throw new Error(options?.label ? `${options.label} 地址为空` : '音频地址为空');
  }
  if (isAitopCosUrl(u)) return u;

  const viaServer = await mirrorMediaToAitopViaServer(u, {
    filename: options?.filename,
    taskId: options?.taskId,
  });
  if (viaServer) return viaServer;

  const uploaded = await upload(u, options?.filename);
  if (uploaded && isAitopCosUrl(uploaded)) return uploaded;

  throw new Error(`${options?.label || '音频'}转存 AiTop 失败，请换本地文件后重试。`);
}
