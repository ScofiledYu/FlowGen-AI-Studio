import type { Node } from 'reactflow';
import type { NodeData } from '../types';
import { NodeType } from '../types';
import {
  canonicalProjectAssetFileUrl,
  isProjectAssetLibraryImageUrl,
  parseProjectAssetIdsFromMediaUrl,
  resolveCanonicalProjectAssetPreviewUrl,
} from './projectAssetPreview.ts';

/** 分镜表模板：绑定资产库时强制 file 链并去掉本机 IndexedDB 标记 */
export function normalizeTemplateNodeDataForSpawn(
  data: NodeData,
  projectId?: string
): NodeData {
  const raw = data as NodeData & { projectAssetId?: string; imageLocalRef?: string };
  const fromUrl = parseProjectAssetIdsFromMediaUrl(data.imagePreview);
  const pid = (projectId || fromUrl?.projectId || '').trim();
  const aid = (raw.projectAssetId || fromUrl?.assetId || '').trim();

  if (pid && aid) {
    const fileUrl = canonicalProjectAssetFileUrl(pid, aid);
    const next = { ...data, imagePreview: fileUrl, projectAssetId: aid } as NodeData & {
      imageLocalRef?: string;
    };
    delete next.imageLocalRef;
    return next;
  }

  const canonical = resolveCanonicalProjectAssetPreviewUrl(data.imagePreview, pid || undefined, undefined);
  if (canonical && isProjectAssetLibraryImageUrl(canonical)) {
    const parsed = parseProjectAssetIdsFromMediaUrl(canonical);
    const next = {
      ...data,
      imagePreview: canonical,
      ...(parsed?.assetId ? { projectAssetId: parsed.assetId } : {}),
    } as NodeData & { imageLocalRef?: string };
    delete next.imageLocalRef;
    return next;
  }

  return data;
}

/** 工作区加载 / 资产库建节点后：去掉残留 imageLocalRef，统一 /assets/…/file */
export function normalizeGraphNodesProjectAssetBinding(
  nodes: Node[],
  projectId?: string | null
): Node[] {
  const pid = String(projectId || '').trim();
  if (!pid) return nodes;
  let changed = false;
  const out = nodes.map((n) => {
    const d = n.data as NodeData & { projectAssetId?: string; imageLocalRef?: string };
    // §10.70：imageLocalRef 是本地 IndexedDB 媒体引用，不是项目资产绑定，
    // 不应将其纳入 hasBinding 判断，否则会导致 normalizeTemplateNodeDataForSpawn 误删 imageLocalRef
    const hasBinding =
      !!d.projectAssetId?.trim() ||
      !!parseProjectAssetIdsFromMediaUrl(d.imagePreview);
    if (!hasBinding) return n;
    // §10.73：若 imageLocalRef 已存在，说明用户已用本地图片（中键拖入/本地上传）替换主图，
    // 此时即使 projectAssetId 因 onUpdate 时序竞态还残留，也不应被 normalizeTemplateNodeDataForSpawn
    // 用资产库 URL 覆盖 imagePreview 并删除 imageLocalRef，否则刷新后用户拖入的新图丢失。
    if (d.imageLocalRef?.trim()) return n;
    // INPUT/PROCESSOR 节点运行后 panelMainSlotVisible===false 表示缩略图已切换为参考图，
    // 此时不应将 imagePreview 替换为资产库 URL，避免刷新后缩略图显示错误
    if ((n.type === NodeType.INPUT || n.type === NodeType.PROCESSOR) && d.panelMainSlotVisible === false) {
      return n;
    }
    const nextData = normalizeTemplateNodeDataForSpawn(n.data, pid);
    if (nextData === n.data) return n;
    changed = true;
    return { ...n, data: nextData };
  });
  return changed ? out : nodes;
}
