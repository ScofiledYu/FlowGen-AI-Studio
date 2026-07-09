import type { NodeData, GenerationParams } from '../types';
import { NodeType } from '../types';
import { isEphemeralMediaUrl, isPersistableMediaUrl } from './workspaceMediaPersist';
import { pickPersistableMainPreviewUrl } from './hydratePersistedNodePreviews';

/** 生成结果 / Source URL 须为可持久化地址（AiTop COS、flowgen-api、https） */
export function isGeneratedOutputPersistableUrl(url?: string): boolean {
  const s = String(url || '').trim();
  if (!s || isEphemeralMediaUrl(s, 'imagePreview')) return false;
  return isPersistableMediaUrl(s);
}

/**
 * AiTop COS 成品 URL 优先级：imagesGenerations/videosGenerations 为生成结果，
 * openApi 多为上传/中间链（下载常偏小、分辨率不对）。
 */
export function rankAitopPersistableResultUrl(url: string): number {
  const u = String(url || '').trim().toLowerCase();
  if (u.includes('/imagesgenerations/')) return 300;
  if (u.includes('/videosgenerations/')) return 280;
  if (u.includes('/openapi/')) return 50;
  return 100;
}

function pickBestRankedPersistableUrl(candidates: (string | undefined)[]): string | undefined {
  const urls = candidates
    .map((u) => String(u || '').trim())
    .filter((u) => u && isGeneratedOutputPersistableUrl(u));
  if (!urls.length) return undefined;
  urls.sort((a, b) => rankAitopPersistableResultUrl(b) - rankAitopPersistableResultUrl(a));
  return urls[0];
}

/** 多候选 URL 中优先高等级 AiTop 成品链，其次其它 https 持久化链 */
export function preferPersistableResultUrl(candidates: (string | undefined)[]): string | undefined {
  const ranked = pickBestRankedPersistableUrl(candidates);
  if (ranked) return ranked;
  const urls = candidates.map((u) => String(u || '').trim()).filter(Boolean);
  return urls.find((u) => isGeneratedOutputPersistableUrl(u));
}

function gpOutputCandidates(gp?: GenerationParams): string[] {
  if (!gp) return [];
  const out: string[] = [];
  if (gp.outputUrl) out.push(gp.outputUrl);
  if (Array.isArray(gp.outputUrls)) out.push(...gp.outputUrls);
  const extra = gp as GenerationParams & {
    resourceUrl?: string;
    videoUrl?: string;
    imageUrl?: string;
  };
  if (extra.resourceUrl) out.push(extra.resourceUrl);
  if (extra.videoUrl) out.push(extra.videoUrl);
  if (extra.imageUrl) out.push(extra.imageUrl);
  return out;
}

/** 仅从 generationParams / generatedThumbnails 解析生图结果（不含 imagePreview，避免误拖主预览被当作输出） */
export function pickNodeGenerationResultPreviewUrl(
  data: Partial<NodeData>
): string | undefined {
  const gp = data.generationParams;
  const fromGp = preferPersistableResultUrl(gpOutputCandidates(gp));
  if (fromGp) return fromGp;
  for (const t of [...(data.generatedThumbnails || [])].reverse()) {
    if (t?.type === 'video') continue;
    const u = String(t?.url || '').trim();
    if (u && isGeneratedOutputPersistableUrl(u)) return u;
  }
  return undefined;
}

/** 从节点数据解析「本次生成结果」持久化 URL（OUTPUT/MOV/运行节点 thumbnails） */
export function pickGeneratedOutputUrlFromNodeData(
  data: Partial<NodeData>,
  nodeType?: NodeType
): string | undefined {
  const gp = data.generationParams;
  const candidates: (string | undefined)[] = [
    ...gpOutputCandidates(gp),
    data.imagePreview,
  ];
  for (const t of [...(data.generatedThumbnails || [])].reverse()) {
    if (t?.url) candidates.push(t.url);
  }
  const fromPick = pickPersistableMainPreviewUrl(data as Record<string, unknown>, nodeType);
  if (fromPick) candidates.unshift(fromPick);
  return preferPersistableResultUrl(candidates);
}

/** Node Details「Source URL」：已生成任务不得展示 blob/data 短标签 */
export function resolveNodeDetailsSourceUrl(
  data: Partial<NodeData>,
  nodeType: NodeType
): string {
  const hasCompletedRun = Boolean(
    data.generationParams?.taskId ||
      data.taskId ||
      data.generationParams?.generatedAt ||
      data.generatedAt
  );
  const persistable = pickGeneratedOutputUrlFromNodeData(data, nodeType);
  if (persistable && isGeneratedOutputPersistableUrl(persistable)) {
    return persistable;
  }
  if (hasCompletedRun) {
    return persistable || '';
  }
  const main = String(data.imagePreview || '').trim();
  if (main && isGeneratedOutputPersistableUrl(main)) return main;
  return main;
}

/** 任务状态 JSON 中提取最佳持久化结果 URL（拒绝在存在 https 时返回 blob/data） */
export function pickBestPersistableUrlFromStatusCandidates(
  candidates: (string | undefined)[]
): string | undefined {
  return pickBestRankedPersistableUrl(candidates) ?? preferPersistableResultUrl(candidates);
}

/** 下载时优先节点已持久化的生成结果 URL，再回退 imagePreview */
export function resolvePreferredNodeDownloadUrl(
  data: Partial<NodeData>,
  nodeType?: NodeType
): string | undefined {
  const fromResult = pickGeneratedOutputUrlFromNodeData(data, nodeType);
  if (fromResult && isGeneratedOutputPersistableUrl(fromResult)) return fromResult;
  const preview = String(data.imagePreview || '').trim();
  if (preview && isGeneratedOutputPersistableUrl(preview)) return preview;
  return preview || undefined;
}

export function collectStatusStringCandidates(
  statusData: unknown,
  keys: string[]
): string[] {
  if (!statusData || typeof statusData !== 'object') return [];
  const sd = statusData as Record<string, unknown>;
  const tryStr = (v: unknown) =>
    typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
  const out: string[] = [];
  const pushObj = (obj: Record<string, unknown>) => {
    for (const k of keys) {
      const s = tryStr(obj[k]);
      if (s) out.push(s);
    }
    for (const arrKey of ['imageUrls', 'resourceUrls', 'images', 'outputs', 'videos']) {
      const arr = obj[arrKey];
      if (!Array.isArray(arr)) continue;
      for (const item of arr) {
        if (typeof item === 'string') {
          const s = tryStr(item);
          if (s) out.push(s);
        } else if (item && typeof item === 'object') {
          const row = item as Record<string, unknown>;
          for (const k of keys) {
            const s = tryStr(row[k]);
            if (s) out.push(s);
          }
          const s = tryStr(row.url);
          if (s) out.push(s);
        }
      }
    }
  };
  pushObj(sd);
  if (sd.data && typeof sd.data === 'object') {
    pushObj(sd.data as Record<string, unknown>);
  }
  return out;
}
