import { getTaskStatus } from '../services/aitop';
import { pickImageResourceUrlFromTaskStatus } from './taskStatusImageUrl';
import { pickVideoResourceUrlFromTaskStatus } from './taskStatusVideoUrl';

export type PollProgressFn = () => void;

export async function pollImageTaskUntilUrl(
  taskId: string,
  opts: {
    maxAttempts?: number;
    intervalMs?: number;
    onProgress?: PollProgressFn;
    failLabel?: string;
  } = {}
): Promise<string> {
  const maxAttempts = opts.maxAttempts ?? 150;
  const intervalMs = opts.intervalMs ?? 2000;
  const label = opts.failLabel || 'image';
  let attempts = 0;
  while (attempts < maxAttempts) {
    await new Promise((r) => setTimeout(r, intervalMs));
    attempts++;
    opts.onProgress?.();
    const statusData = await getTaskStatus(taskId);
    if (!statusData) continue;
    const status = statusData.status;
    if (
      status === 'TRANSFER_SUCCESS' ||
      status === 'SUCCESS' ||
      status === '2' ||
      status === '5'
    ) {
      const resourceUrl =
        pickImageResourceUrlFromTaskStatus(statusData) ||
        pickVideoResourceUrlFromTaskStatus(statusData);
      if (resourceUrl) return resourceUrl;
      continue;
    }
    if (['3', 'FAIL', '6', 'TRANSFER_FAIL'].includes(String(status))) {
      const errorMsg =
        (statusData as { errorDescription?: string; errorMsg?: string }).errorDescription ||
        (statusData as { errorMsg?: string }).errorMsg ||
        '任务失败';
      throw new Error(`**❌ ${label} 任务失败**\n\n**错误消息：** ${errorMsg}`);
    }
  }
  throw new Error(`**❌ ${label} 任务失败**\n\n**错误消息：** 轮询超时，未获取到生成结果 URL`);
}

export async function pollVideoTaskUntilUrl(
  taskId: string,
  opts: {
    maxAttempts?: number;
    intervalMs?: number;
    onProgress?: PollProgressFn;
    failLabel?: string;
    stabilize?: (url: string) => Promise<string>;
  } = {}
): Promise<string> {
  const maxAttempts = opts.maxAttempts ?? 180;
  const intervalMs = opts.intervalMs ?? 2000;
  const label = opts.failLabel || 'video';
  let attempts = 0;
  while (attempts < maxAttempts) {
    await new Promise((r) => setTimeout(r, intervalMs));
    attempts++;
    opts.onProgress?.();
    const statusData = await getTaskStatus(taskId);
    if (!statusData) continue;
    const status = statusData.status;
    if (status === 'TRANSFER_SUCCESS') {
      const resourceUrl = pickVideoResourceUrlFromTaskStatus(statusData);
      if (resourceUrl) {
        return opts.stabilize ? opts.stabilize(resourceUrl) : resourceUrl;
      }
      continue;
    }
    if (status === 'SUCCESS' || status === '2' || status === '5') continue;
    if (['3', 'FAIL', '6', 'TRANSFER_FAIL'].includes(String(status))) {
      const errorMsg =
        (statusData as { errorDescription?: string; errorMsg?: string }).errorDescription ||
        (statusData as { errorMsg?: string }).errorMsg ||
        '视频生成失败';
      throw new Error(`**❌ ${label} 任务失败**\n\n**错误消息：** ${errorMsg}`);
    }
  }
  throw new Error(`**❌ ${label} 任务失败**\n\n**错误消息：** 视频生成超时`);
}

/** 创建 count 个独立任务（每个 generateNum=1），并行轮询，返回 URL 列表。 */
export async function runParallelGenerationTasks(
  count: number,
  createTask: (index: number) => Promise<string | null>,
  pollTask: (taskId: string, index: number) => Promise<string>,
  onTaskCreated?: (taskId: string, index: number) => void
): Promise<string[]> {
  const taskIds: string[] = [];
  const errors: string[] = [];
  for (let i = 0; i < count; i++) {
    try {
      const taskId = await createTask(i);
      if (taskId) {
        taskIds.push(taskId);
        onTaskCreated?.(taskId, i);
      } else {
        errors.push(`任务 ${i + 1}: 创建失败（无 taskId）`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`任务 ${i + 1}: ${msg}`);
    }
  }
  if (taskIds.length === 0) {
    throw new Error(
      `**❌ 批量任务创建失败**\n\n所有任务创建都失败了。\n\n**错误详情：**\n${errors.join('\n')}`
    );
  }
  const pollResults = await Promise.allSettled(
    taskIds.map((taskId, idx) => pollTask(taskId, idx))
  );
  const urls: string[] = [];
  pollResults.forEach((result, idx) => {
    if (result.status === 'fulfilled' && result.value) {
      urls.push(result.value);
    } else {
      const msg =
        result.status === 'rejected'
          ? result.reason instanceof Error
            ? result.reason.message
            : String(result.reason)
          : `任务 ${idx + 1} 轮询失败`;
      errors.push(`任务 ${idx + 1}: ${msg}`);
    }
  });
  if (urls.length === 0) {
    throw new Error(
      `**❌ 批量生成失败**\n\n未获取到任何结果 URL。\n\n**错误详情：**\n${errors.join('\n')}`
    );
  }
  return urls;
}
