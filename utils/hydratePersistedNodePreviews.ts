import type { Edge, Node as RFNode } from 'reactflow';
import { NodeType } from '../types';
import { isEphemeralMediaUrl, isPersistableMediaUrl } from './workspaceMediaPersist';

const FLOWGEN_NODE_MEDIA_FILE_RE =
  /\/flowgen-api\/projects\/[^/]+\/node-media\/[^/]+\/file$/i;

export function isFlowgenNodeMediaFileUrl(url: string): boolean {
  const path = url.trim().split('?')[0];
  return FLOWGEN_NODE_MEDIA_FILE_RE.test(path);
}

export function isVideoPreviewUrl(url: string): boolean {
  const u = url.trim();
  if (!u) return false;
  return (
    /\.(mov|mp4|webm|avi|mkv|flv|wmv|m4v)(\?|$)/i.test(u) ||
    /^https?:\/\/.+\/video/i.test(u) ||
    /\/video\//i.test(u) ||
    isFlowgenNodeMediaFileUrl(u) ||
    u.includes('video')
  );
}

/** MOV 节点主预览：扩展 node-media / 文件名 等判定 */
export function isLikelyVideoMediaUrl(
  url: string | undefined,
  hints?: { nodeType?: string; imageName?: string }
): boolean {
  const u = String(url || '').trim();
  if (!u) return false;
  if (isVideoPreviewUrl(u)) return true;
  if (hints?.nodeType === NodeType.MOV || hints?.nodeType === NodeType.OUTPUT) {
    if (isFlowgenNodeMediaFileUrl(u)) return true;
    const name = String(hints.imageName || '');
    if (/\.(mov|mp4|webm|avi|mkv|m4v)(\?|$)/i.test(name)) return true;
  }
  return false;
}

function collectReferenceImageUrls(data: Record<string, unknown>, bucket: string[]): void {
  const pushArr = (arr: unknown) => {
    if (!Array.isArray(arr)) return;
    for (const u of arr) pushPersistableUrl(bucket, u, 'url');
  };
  pushArr(data.referenceImages);
  pushArr(data.jimengImages);
  const gp = data.generationParams;
  if (gp && typeof gp === 'object') {
    const g = gp as Record<string, unknown>;
    pushArr(g.referenceImages);
    pushArr(g.jimengImages);
  }
}

function pushPersistableUrl(bucket: string[], val: unknown, keyHint: string): void {
  if (typeof val !== 'string') return;
  const s = val.trim();
  if (!s || isEphemeralMediaUrl(s, keyHint) || !isPersistableMediaUrl(s)) return;
  if (!bucket.includes(s)) bucket.push(s);
}

const NODE_FRAME_URL_KEYS = [
  'firstFrameImageUrl',
  'lastFrameImageUrl',
  'klingOmniVideoUrl',
  'klingOmniVideoPreviewUrl',
  'klingOmniInstructionVideoUrl',
  'klingOmniInstructionVideoPreviewUrl',
] as const;

const GP_EXTRA_URL_KEYS = ['resourceUrl', 'outputUrl', 'videoUrl', 'imageUrl'] as const;

/**
 * 持久化时 imagePreview 的 blob/data: 会被剥离，但 generatedThumbnails / 首尾帧 URL 仍可能保留。
 * 从这些地方恢复主预览，避免刷新后画布显示 EMPTY、详情里 Source URL 有值却无图。
 */
export function pickPersistableMainPreviewUrl(
  data: Record<string, unknown>,
  nodeType?: string
): string | undefined {
  const preferVideo = nodeType === NodeType.MOV;
  const candidates: string[] = [];

  for (const k of NODE_FRAME_URL_KEYS) {
    pushPersistableUrl(candidates, data[k], k);
  }
  collectReferenceImageUrls(data, candidates);

  const gp = data.generationParams;
  if (gp && typeof gp === 'object') {
    const g = gp as Record<string, unknown>;
    for (const k of NODE_FRAME_URL_KEYS) {
      pushPersistableUrl(candidates, g[k], k);
    }
    for (const k of GP_EXTRA_URL_KEYS) {
      pushPersistableUrl(candidates, g[k], k);
    }
  }

  const thumbs = data.generatedThumbnails;
  if (Array.isArray(thumbs)) {
    for (let i = thumbs.length - 1; i >= 0; i--) {
      const row = thumbs[i];
      if (!row || typeof row !== 'object') continue;
      const url = (row as { url?: unknown }).url;
      const kind = (row as { type?: unknown }).type;
      if (typeof url !== 'string') continue;
      const s = url.trim();
      if (!isPersistableMediaUrl(s)) continue;
      if (preferVideo && kind === 'video') {
        candidates.unshift(s);
      } else if (!preferVideo && kind !== 'video') {
        candidates.unshift(s);
      } else {
        candidates.push(s);
      }
    }
  }

  if (preferVideo) {
    return (
      candidates.find((u) => isLikelyVideoMediaUrl(u, { nodeType: NodeType.MOV })) ??
      candidates[0]
    );
  }
  const imageOnly = candidates.filter((u) => !isVideoPreviewUrl(u));
  return imageOnly[0];
}

export function hydrateNodeImagePreviewFromPersisted<
  N extends { type?: string; data?: Record<string, unknown> },
>(node: N): N {
  if (!node?.data || typeof node.data !== 'object') return node;
  if (node.type === NodeType.CHAIN_FOLDER || node.type === NodeType.BACKDROP) return node;

  const preview = node.data.imagePreview;
  const previewStr = typeof preview === 'string' ? preview.trim() : '';
  const previewOk =
    previewStr && !isEphemeralMediaUrl(previewStr, 'imagePreview');
  const previewIsVideoOnNonMov =
    previewOk &&
    node.type !== NodeType.MOV &&
    isVideoPreviewUrl(previewStr);

  if (previewOk && !previewIsVideoOnNonMov) {
    return node;
  }

  const picked = pickPersistableMainPreviewUrl(node.data, node.type);
  if (!picked) return node;

  return { ...node, data: { ...node.data, imagePreview: picked } };
}

export function hydrateNodesImagePreviewFromPersisted<
  N extends { type?: string; data?: Record<string, unknown> },
>(nodes: N[]): N[] {
  return nodes.map(hydrateNodeImagePreviewFromPersisted);
}

/** 刷新后 videoPosterDataUrl（data:）已剥离时，用参考图 https 充当视频封面，避免黑屏直到截帧/播放 */
export function pickReferenceImagePosterUrl(data: Record<string, unknown>): string | undefined {
  const urls: string[] = [];
  collectReferenceImageUrls(data, urls);
  return urls.find((u) => !isVideoPreviewUrl(u));
}

function movPreviewLooksComplete(node: RFNode): boolean {
  const preview = String(node.data?.imagePreview || '').trim();
  if (!preview || isEphemeralMediaUrl(preview, 'imagePreview')) return false;
  return isLikelyVideoMediaUrl(preview, {
    nodeType: NodeType.MOV,
    imageName: node.data?.imageName,
  });
}

/**
 * Output Mov 节点常只存了被剥离的 blob 预览；从上游运行节点的 generatedThumbnails / imagePreview 补回视频 URL。
 */
export function hydrateMovNodesFromUpstream(nodes: RFNode[], edges: Edge[]): RFNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return nodes.map((node) => {
    if (node.type !== NodeType.MOV) return node;
    if (movPreviewLooksComplete(node)) return node;

    const inEdge = edges.find((e) => e.target === node.id);
    if (!inEdge) return node;
    const src = byId.get(inEdge.source);
    if (!src?.data) return node;

    const thumbs = src.data.generatedThumbnails || [];
    const lastVideo = [...thumbs].reverse().find((t) => t?.type === 'video' && t?.url);
    const srcPreview = String(src.data.imagePreview || '').trim();
    const pickUrl =
      (lastVideo?.url && isLikelyVideoMediaUrl(lastVideo.url, { nodeType: NodeType.MOV })
        ? lastVideo.url
        : undefined) ||
      (srcPreview && isLikelyVideoMediaUrl(srcPreview, { nodeType: NodeType.MOV })
        ? srcPreview
        : undefined);

    if (!pickUrl) return node;

    const taskId =
      node.data?.taskId ||
      node.data?.generationParams?.taskId ||
      lastVideo?.generationParams?.taskId ||
      src.data.taskId ||
      src.data.generationParams?.taskId;

    return {
      ...node,
      data: {
        ...node.data,
        imagePreview: pickUrl,
        ...(lastVideo?.posterDataUrl && !node.data.videoPosterDataUrl
          ? { videoPosterDataUrl: lastVideo.posterDataUrl }
          : {}),
        ...(taskId && !node.data.taskId ? { taskId: String(taskId) } : {}),
        ...(taskId && node.data.generationParams
          ? {
              generationParams: {
                ...node.data.generationParams,
                taskId: String(taskId),
              },
            }
          : taskId
            ? { generationParams: { taskId: String(taskId) } }
            : {}),
      },
    };
  });
}

export function hydrateGraphMediaFromPersisted(nodes: RFNode[], edges: Edge[]): RFNode[] {
  return hydrateMovNodesFromUpstream(
    nodes.map((n) => hydrateNodeImagePreviewFromPersisted(n)),
    edges
  );
}
