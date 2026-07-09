import { isAitopCosUrl } from './aitopCosMediaUrl';
import { pickMediaResourceUrlFromTaskStatus } from './taskStatusImageUrl';

export const AITOP_TASK_FAIL_STATUSES = new Set(['3', 'FAIL', '6', 'TRANSFER_FAIL']);
export const AITOP_TASK_SUCCESS_STATUSES = new Set(['TRANSFER_SUCCESS', 'SUCCESS', '2', '5']);

export function parseAiTopTaskIds(raw?: string): string[] {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isVideoModelName(model?: string): boolean {
  const m = model || '';
  return ['Veo 3.1', '可灵', 'Keling', '即梦', 'vidu', 'seedance'].some((tag) => m.includes(tag));
}

export type AiTopPollConfig = { maxAttempts: number; intervalMs: number };

export function seedancePollConfigForModel(model?: string): AiTopPollConfig {
  if (model === 'seedance2.0 (急速版)') {
    return { maxAttempts: 720, intervalMs: 5000 };
  }
  if (model === 'seedance2.0 (高质量版)') {
    return { maxAttempts: 3600, intervalMs: 10000 };
  }
  return { maxAttempts: 240, intervalMs: 5000 };
}

export function defaultPollConfigForModel(model?: string): AiTopPollConfig {
  if (model?.includes('seedance')) return seedancePollConfigForModel(model);
  if (model === '即梦3.0 Pro') return { maxAttempts: 180, intervalMs: 5000 };
  if (model === 'vidu 2.0') return { maxAttempts: 240, intervalMs: 5000 };
  return { maxAttempts: 150, intervalMs: 2000 };
}

export function extractResourceUrlFromTaskStatus(statusData: unknown): string | undefined {
  return pickMediaResourceUrlFromTaskStatus(statusData);
}

export function isTerminalTaskFailure(status: unknown): boolean {
  return AITOP_TASK_FAIL_STATUSES.has(String(status || ''));
}

export function isTerminalTaskSuccess(status: unknown, resourceUrl?: string): boolean {
  const s = String(status || '');
  if (s === 'TRANSFER_SUCCESS') return !!resourceUrl;
  if (AITOP_TASK_SUCCESS_STATUSES.has(s)) return !!resourceUrl;
  return false;
}

/** 恢复失败时：判断是否为已知的上游永久失败（应标 error 而非 idle 重试） */
export function isKnownUpstreamFailureMessage(raw: string | undefined): boolean {
  return /上游拒绝了生成请求|任务失败|invalid_request_error|referenced_image_ids/i.test(
    String(raw || '')
  );
}

/** 恢复/轮询失败时：截断 AiTop 把多段 JSON 拼进 error.message 的冗长文案 */
export function sanitizeAiTopTaskFailureMessage(raw: string | undefined, model?: string): string {
  const t = String(raw || '').trim();
  if (!t) return '任务失败（无详细说明）';
  const modelLabel = model ? `${model} ` : '';
  if (/invalid_request_error/i.test(t) || /referenced_image_ids/i.test(t)) {
    const promptCount = (t.match(/"prompt"\s*:/g) || []).length;
    if (promptCount > 1) {
      return `${modelLabel}上游拒绝了生成请求（invalid_request_error）：检测到 ${promptCount} 段请求体被合并报错，多为 AiTop/image 2 侧批处理异常。请减少「生成张数」为 1 张后重试，或联系 AiTop 排查 taskId。`;
    }
    return `${modelLabel}上游拒绝了生成请求（invalid_request_error）：请检查 prompt 长度、参考图数量（image 2 最多 4 张）与尺寸是否合规后重试。`;
  }
  if (t.length > 480) {
    return `${modelLabel}任务失败：${t.slice(0, 480)}…（已截断，完整信息见控制台）`;
  }
  return t;
}

export type PollAiTopTaskOptions = {
  getTaskStatus: (taskId: string) => Promise<unknown>;
  pollConfig?: AiTopPollConfig;
  onProgress?: () => void;
  maxConsecutiveErrors?: number;
  /** 视频恢复：SUCCESS 且仍是 ark-acg 时继续等 TRANSFER_SUCCESS */
  requireAitopCos?: boolean;
  model?: string;
};

/**
 * 轮询 AiTop 直至成功拿到资源 URL、明确失败或超时。
 */
export async function pollAiTopTaskUntilResourceUrl(
  taskId: string,
  options: PollAiTopTaskOptions
): Promise<string> {
  const cfg = options.pollConfig ?? { maxAttempts: 150, intervalMs: 2000 };
  const maxConsecutiveErrors = options.maxConsecutiveErrors ?? 10;
  let consecutiveErrors = 0;
  let attempts = 0;

  while (attempts < cfg.maxAttempts) {
    await new Promise((r) => setTimeout(r, cfg.intervalMs));
    attempts++;
    options.onProgress?.();

    let statusData: unknown = null;
    try {
      statusData = await options.getTaskStatus(taskId);
      if (statusData) consecutiveErrors = 0;
    } catch {
      consecutiveErrors++;
      if (consecutiveErrors >= maxConsecutiveErrors) {
        throw new Error(`任务状态查询连续失败（Task ID: ${taskId}）`);
      }
      continue;
    }
    if (!statusData || typeof statusData !== 'object') continue;

    const status = (statusData as { status?: unknown }).status;
    const resourceUrl = extractResourceUrlFromTaskStatus(statusData);

    if (isTerminalTaskFailure(status)) {
      const sd = statusData as { errorDescription?: string; errorMsg?: string };
      const msg = sanitizeAiTopTaskFailureMessage(
        sd.errorDescription || sd.errorMsg || '任务失败',
        options.model
      );
      throw new Error(msg);
    }

    if (isTerminalTaskSuccess(status, resourceUrl) && resourceUrl) {
      if (
        options.requireAitopCos &&
        !isAitopCosUrl(resourceUrl) &&
        String(status) !== 'TRANSFER_SUCCESS'
      ) {
        continue;
      }
      return resourceUrl;
    }

    // SUCCESS 但尚无 URL：继续等 TRANSFER_SUCCESS
    if (AITOP_TASK_SUCCESS_STATUSES.has(String(status)) && !resourceUrl) {
      continue;
    }
  }

  throw new Error(`任务轮询超时（Task ID: ${taskId}）`);
}
