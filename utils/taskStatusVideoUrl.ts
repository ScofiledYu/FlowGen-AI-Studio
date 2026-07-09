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
