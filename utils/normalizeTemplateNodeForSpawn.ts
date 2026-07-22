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
    const hasBinding =
      !!d.projectAssetId?.trim() ||
      !!parseProjectAssetIdsFromMediaUrl(d.imagePreview) ||
      (typeof d.imageLocalRef === 'string' && d.imageLocalRef.startsWith('flowgen-local:'));
    if (!hasBinding) return n;
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
