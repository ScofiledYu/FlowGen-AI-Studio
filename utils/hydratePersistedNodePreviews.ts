import type { Edge, Node as RFNode } from 'reactflow';
import type { GenerationParams, NodeData } from '../types';
import { NodeType } from '../types';
import {
  enrichPanelSourceFromGenerationSnapshot,
  resolveNodeSelectionPreviewUrl,
} from './nodeDetailsPreview';
import { isEphemeralMediaUrl, isPersistableMediaUrl } from './workspaceMediaPersist';
import { isDuplicateOfMainImagePreview } from './promptMediaRefs';
import { runNodeShouldHydratePreviewFromGpRefs } from './referencedMediaRun';

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
  // 如果 URL 本身明确是图片格式，不因 imageName 等 hint 误判为视频
  // 修复：MOV 节点 imagePreview 为 PNG 但 imageName 为 .mov 时，movPreviewLooksComplete 误判导致
  // hydrateMovNodesFromUpstream 跳过视频 URL 继承，PREVIEW MODE / 画布缩略图无法播放
  if (/\.(png|jpe?g|webp|gif|bmp|svg)(\?|$)/i.test(u)) return false;
  if (hints?.nodeType === NodeType.MOV || hints?.nodeType === NodeType.OUTPUT) {
    if (isFlowgenNodeMediaFileUrl(u)) return true;
    const name = String(hints.imageName || '');
    if (/\.(mov|mp4|webm|avi|mkv|m4v)(\?|$)/i.test(name)) return true;
  }
  return false;
}

function normalizePreviewUrlKey(url: string): string {
  const u = url.trim().split('?')[0].split('#')[0].replace(/\/+$/, '').toLowerCase();
  const m = u.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return m ? m[0].toLowerCase() : u;
}

/** 生图 OUTPUT 在 modelConfigs 里保留的生成结果预览（image2 / Nano 运行快照） */
export function getModelConfigOutputPreviewUrl(data: Record<string, unknown>): string | undefined {
  const mc = data.modelConfigs;
  if (!mc || typeof mc !== 'object') return undefined;
  for (const cfg of Object.values(mc as Record<string, unknown>)) {
    if (!cfg || typeof cfg !== 'object') continue;
    const p = (cfg as { imagePreview?: unknown }).imagePreview;
    if (typeof p !== 'string') continue;
    const s = p.trim();
    if (!s || isEphemeralMediaUrl(s, 'imagePreview') || !isPersistableMediaUrl(s)) continue;
    if (isVideoPreviewUrl(s)) continue;
    return s;
  }
  return undefined;
}

function collectPanelReferenceImageUrls(data: Record<string, unknown>, bucket: string[]): void {
  collectReferenceImageUrls(data, bucket);
}

/** OUTPUT 主预览误为参考槽图（如 seedance 图片3），而 modelConfigs 仍有生图结果 */
export function outputImagePreviewLooksLikePanelRefMismatch(
  data: Record<string, unknown>
): boolean {
  const preview = String(data.imagePreview || '').trim();
  const gen = getModelConfigOutputPreviewUrl(data);
  if (!preview || !gen || preview === gen) return false;
  if (normalizePreviewUrlKey(preview) === normalizePreviewUrlKey(gen)) return false;
  const refs: string[] = [];
  collectPanelReferenceImageUrls(data, refs);
  const pk = normalizePreviewUrlKey(preview);
  return refs.some((r) => r && normalizePreviewUrlKey(r) === pk);
}

function pushModelConfigOutputPreview(data: Record<string, unknown>, bucket: string[]): void {
  const gen = getModelConfigOutputPreviewUrl(data);
  if (gen) bucket.unshift(gen);
}

function pickUpstreamImageThumbForOutput(
  nodeId: string,
  nodes: RFNode[],
  edges: Edge[]
): string | undefined {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const inEdge = edges.find((e) => e.target === nodeId);
  if (!inEdge) return undefined;
  const src = byId.get(inEdge.source);
  if (!src?.data) return undefined;
  const thumbs = src.data.generatedThumbnails || [];
  const linked = thumbs.find(
    (t) =>
      t?.type === 'image' &&
      t.url &&
      (t.nodeId === nodeId || t.id === nodeId) &&
      isPersistableMediaUrl(String(t.url))
  );
  if (linked?.url) return String(linked.url).trim();
  const lastImage = [...thumbs]
    .reverse()
    .find((t) => t?.type === 'image' && t?.url && isPersistableMediaUrl(String(t.url)));
  return lastImage?.url ? String(lastImage.url).trim() : undefined;
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
  const isOutputPicture = nodeType === NodeType.OUTPUT;
  const isRunNode = nodeType === NodeType.INPUT || nodeType === NodeType.PROCESSOR;
  const candidates: string[] = [];

  if (!isRunNode) {
    pushModelConfigOutputPreview(data, candidates);
  }

  for (const k of NODE_FRAME_URL_KEYS) {
    pushPersistableUrl(candidates, data[k], k);
  }
  /** OUTPUT/MOV 的 referenceImages 是面板参考槽，不是生成结果，勿当作主预览 */
  if (!isOutputPicture && nodeType !== NodeType.MOV && !isRunNode) {
    collectPanelReferenceImageUrls(data, candidates);
  }

  const gp = data.generationParams;
  if (gp && typeof gp === 'object') {
    const g = gp as Record<string, unknown>;
    for (const k of NODE_FRAME_URL_KEYS) {
      pushPersistableUrl(candidates, g[k], k);
    }
    if (!isRunNode) {
      for (const k of GP_EXTRA_URL_KEYS) {
        pushPersistableUrl(candidates, g[k], k);
      }
    }
  }

  const thumbs = data.generatedThumbnails;
  if (Array.isArray(thumbs) && !isRunNode) {
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
  N extends { id?: string; type?: string; data?: Record<string, unknown> },
>(node: N, graph?: { nodes: RFNode[]; edges: Edge[] }): N {
  if (!node?.data || typeof node.data !== 'object') return node;
  if (node.type === NodeType.CHAIN_FOLDER || node.type === NodeType.BACKDROP) return node;

  if (node.type === NodeType.OUTPUT && outputImagePreviewLooksLikePanelRefMismatch(node.data)) {
    const gen = getModelConfigOutputPreviewUrl(node.data);
    if (gen) {
      return { ...node, data: { ...node.data, imagePreview: gen } };
    }
  }

  const preview = node.data.imagePreview;
  const previewStr = typeof preview === 'string' ? preview.trim() : '';
  const isRunNode = node.type === NodeType.INPUT || node.type === NodeType.PROCESSOR;
  const gp = node.data.generationParams as Partial<GenerationParams> | undefined;
  const gpOut = String(gp?.outputUrl || '').trim();
  const hasLocalMainRef = Boolean(
    String((node.data as { imageLocalRef?: string }).imageLocalRef || '').trim()
  );

  /** INPUT/PROCESSOR：生成结果仅进 generatedThumbnails，勿用 outputUrl 覆盖画布主预览 */
  if (
    isRunNode &&
    (!previewStr || isEphemeralMediaUrl(previewStr, 'imagePreview'))
  ) {
    const nodeData = node.data as Partial<NodeData>;
    const useGpRefs = runNodeShouldHydratePreviewFromGpRefs(nodeData);
    if (useGpRefs || !hasLocalMainRef) {
      const enriched = enrichPanelSourceFromGenerationSnapshot(nodeData, gp);
      const fromSelection = resolveNodeSelectionPreviewUrl(enriched);
      if (fromSelection && isPersistableMediaUrl(fromSelection)) {
        return { ...node, data: { ...node.data, imagePreview: fromSelection } };
      }
      const firstSnapRef = Array.isArray(gp?.referenceImages)
        ? gp!.referenceImages!.map((u) => String(u || '').trim()).find(
            (u) => u && isPersistableMediaUrl(u)
          )
        : undefined;
      if (firstSnapRef) {
        return { ...node, data: { ...node.data, imagePreview: firstSnapRef } };
      }
    }
  }

  // 如果当前 imagePreview 是 gp.referenceImages 中的 @参考图 signed URL，
  // 且节点有 imageLocalRef（主图本地备份），则重置为 ''，让后续 hydrateLocalMediaPreviews 从 IDB 恢复主图
  if (isRunNode && hasLocalMainRef && !runNodeShouldHydratePreviewFromGpRefs(node.data as Partial<NodeData>)) {
    const current = String((node.data as { imagePreview?: string }).imagePreview || '').trim();
    const panelRefs = ((node.data as { referenceImages?: string[] }).referenceImages || [])
      .map((u) => String(u || '').trim())
      .filter(Boolean);
    const gpRefs = Array.isArray(gp?.referenceImages)
      ? gp!.referenceImages!.map((u) => String(u || '').trim()).filter(Boolean)
      : [];
    const ref0 = String(panelRefs[0] || gpRefs[0] || '').trim();
    const looksLikePanelFirstRef = Boolean(ref0 && current === ref0);
    const matchesGpRef = gpRefs.some((r) => isDuplicateOfMainImagePreview(current, r));
    /** 跨机器 JSON：@主图 + 已持久化 COS 主预览须保留；仅剥离「面板首参考槽 / 非持久化 gp 参考 URL」以走 IDB */
    /** panelMainSlotVisible===false 时，imagePreview 已是运行后切换的参考图，不应清空 */
    const panelMainHidden = (node.data as { panelMainSlotVisible?: boolean }).panelMainSlotVisible === false;
    const shouldClearForLocalMainRestore =
      !current ||
      (looksLikePanelFirstRef && !panelMainHidden) ||
      (!isPersistableMediaUrl(current) && matchesGpRef);
    if (shouldClearForLocalMainRestore) {
      return { ...node, data: { ...node.data, imagePreview: '' } };
    }
  }

  if (
    !isRunNode &&
    gpOut &&
    isPersistableMediaUrl(gpOut) &&
    (!previewStr || isEphemeralMediaUrl(previewStr, 'imagePreview'))
  ) {
    return { ...node, data: { ...node.data, imagePreview: gpOut } };
  }

  const previewOk =
    previewStr && !isEphemeralMediaUrl(previewStr, 'imagePreview');
  const previewIsVideoOnNonMov =
    previewOk &&
    node.type !== NodeType.MOV &&
    isVideoPreviewUrl(previewStr);

  if (previewOk && !previewIsVideoOnNonMov) {
    return node;
  }

  let picked = pickPersistableMainPreviewUrl(node.data, node.type);
  if (
    !picked &&
    node.type === NodeType.OUTPUT &&
    node.id &&
    graph?.nodes?.length &&
    graph.edges
  ) {
    picked = pickUpstreamImageThumbForOutput(node.id, graph.nodes, graph.edges);
  }
  if (!picked) return node;

  return { ...node, data: { ...node.data, imagePreview: picked } };
}

export function hydrateNodesImagePreviewFromPersisted<
  N extends { id?: string; type?: string; data?: Record<string, unknown> },
>(nodes: N[], edges: Edge[] = []): N[] {
  const graph = { nodes: nodes as unknown as RFNode[], edges };
  return nodes.map((n) => hydrateNodeImagePreviewFromPersisted(n, graph));
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
    hydrateNodesImagePreviewFromPersisted(nodes, edges) as RFNode[],
    edges
  );
}
