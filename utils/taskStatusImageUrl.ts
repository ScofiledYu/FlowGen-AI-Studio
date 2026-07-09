import {
  collectStatusStringCandidates,
  pickBestPersistableUrlFromStatusCandidates,
} from './generatedOutputUrl';
import { pickVideoResourceUrlFromTaskStatus } from './taskStatusVideoUrl';

const IMAGE_STATUS_KEYS = [
  'resourceUrl',
  'resultUrl',
  'imageUrl',
  'image_url',
  'url',
  'outputUrl',
];

/**
 * AiTop 任务状态中的图片结果 URL（Nano / image2 等）。
 * 存在 https/AiTop COS 时不得退回 blob/data。
 */
export function pickImageResourceUrlFromTaskStatus(statusData: unknown): string | undefined {
  const candidates = collectStatusStringCandidates(statusData, IMAGE_STATUS_KEYS);
  return pickBestPersistableUrlFromStatusCandidates(candidates);
}

const MEDIA_STATUS_KEYS = [
  'resourceUrl',
  'resultUrl',
  'imageUrl',
  'image_url',
  'videoUrl',
  'outputUrl',
  'url',
  'video_url',
  'result',
];

/** 图片或视频结果 URL（轮询恢复、下载刷新共用；imagesGenerations/videosGenerations 优先于 openApi） */
export function pickMediaResourceUrlFromTaskStatus(statusData: unknown): string | undefined {
  const candidates = collectStatusStringCandidates(statusData, MEDIA_STATUS_KEYS);
  return pickBestPersistableUrlFromStatusCandidates(candidates);
}
