/**
 * AiTop / 网关任务状态里视频结果 URL 字段名因模型略有差异，统一提取（供 FlowEditor 轮询、开发下载中转等复用）。
 */
import {
  collectStatusStringCandidates,
  pickBestPersistableUrlFromStatusCandidates,
} from './generatedOutputUrl';

const VIDEO_STATUS_KEYS = [
  'resourceUrl',
  'resultUrl',
  'videoUrl',
  'outputUrl',
  'url',
  'video_url',
  'result',
];

export function pickVideoResourceUrlFromTaskStatus(statusData: unknown): string | undefined {
  const candidates = collectStatusStringCandidates(statusData, VIDEO_STATUS_KEYS);
  return pickBestPersistableUrlFromStatusCandidates(candidates);
}

/**
 * AiTop 网关 H.264 转码版 URL（transcodedVideo 字段）。
 * 仅源视频为 HEVC（如 seedance2.0 4K）时网关才生成，H.264 原生任务为 null（videoJobStatus=IGNORE）。
 * 用途：浏览器无法解码 MP4 内 HEVC，预览用转码版；下载仍走 resourceUrl 原版。
 */
export function pickTranscodedVideoUrlFromTaskStatus(statusData: unknown): string | undefined {
  if (!statusData || typeof statusData !== 'object') return undefined;
  const raw = (statusData as { transcodedVideo?: unknown }).transcodedVideo;
  if (typeof raw !== 'string') return undefined;
  const url = raw.trim();
  return url || undefined;
}

/**
 * 同源校验（§16.27）：转码版 URL 是否属于指定原片。
 * 网关命名规律实测稳定：`transcode-{uuid}.mp4 ↔ {uuid}.mp4`（同目录、文件名加 transcode- 前缀）。
 *
 * 用途：MOV 节点再生成场景，gp.transcodedVideoUrl 记录的是「本次新产出」的转码版，
 * 与节点 imagePreview（原视频）不同源——播放时若无条件优先会误播新产出（6666.json 实测），
 * 同源校验不同则回退 imagePreview。
 */
export function isTranscodedPairOfOriginal(
  transcodedUrl: string | undefined,
  originalUrl: string | undefined
): boolean {
  if (!transcodedUrl || !originalUrl) return false;
  const m = String(transcodedUrl).match(/transcode-([\w][\w-]*\.\w+)(?:[?#]|$)/);
  return !!m && String(originalUrl).includes(m[1]);
}
