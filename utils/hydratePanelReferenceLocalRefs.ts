import type { NodeData } from '../types';
import { getLocalMediaBlob } from './localNodeMediaStore';
import { supportsMainBackupLocalRefHydrate } from './referencedMediaRun';
import { isEphemeralMediaUrl, isPersistableMediaUrl } from './workspaceMediaPersist';

export function alignPanelReferenceSlotsFromLocalRefs(
  images: string[] | undefined,
  localRefs: string[] | undefined
): { images: string[]; localRefs: string[] } {
  const lr = [...(localRefs || [])];
  const im = [...(images || [])];
  const maxLen = Math.max(im.length, lr.length);
  return {
    images: Array.from({ length: maxLen }, (_, i) => im[i] ?? ''),
    localRefs: lr,
  };
}

/**
 * 切模型恢复：有 localRef 的槽剥离 blob/data（它模型态可能已 revoke），强制从 IDB 重 hydrate。
 * 无 localRef 时仅剥离 data:，保留 blob:（拖入后 IDB 写入尚未完成）。
 */
export function stripRestoredUrlForLocalRefHydrate(
  url: string | undefined,
  localRef: string | undefined
): string {
  const s = String(url || '').trim();
  const lr = String(localRef || '').trim();
  if (!s) return '';
  if (lr) {
    if (s.startsWith('data:') || s.startsWith('blob:')) return '';
    return s;
  }
  if (s.startsWith('data:')) return '';
  return s;
}

export function stripRestoredPanelRefsForLocalRefHydrate(
  images: string[] | undefined,
  localRefs: string[] | undefined
): string[] {
  const aligned = alignPanelReferenceSlotsFromLocalRefs(images, localRefs);
  return aligned.images.map((u, i) =>
    stripRestoredUrlForLocalRefHydrate(u, aligned.localRefs[i])
  );
}

/** handleModelChange 恢复后统一剥离：参考图 / 主图 / 首尾帧 / Omni 多 tab */
export function stripRestoredNodeMediaForLocalRefHydrate(
  data: Partial<NodeData>
): Partial<NodeData> {
  const patch: Partial<NodeData> = {};

  if (data.referenceImageLocalRefs?.some(Boolean)) {
    patch.referenceImages = stripRestoredPanelRefsForLocalRefHydrate(
      data.referenceImages,
      data.referenceImageLocalRefs
    );
  }

  const omniFields: PanelReferenceLocalRefField[] = [
    'klingOmniMultiReferenceLocalRefs',
    'klingOmniInstructionReferenceLocalRefs',
    'klingOmniVideoReferenceLocalRefs',
  ];
  for (const field of omniFields) {
    const localRefs = data[field];
    if (!Array.isArray(localRefs) || !localRefs.some(Boolean)) continue;
    const imagesField = panelReferenceImagesFieldForLocalRefs(field);
    const stripped = stripRestoredPanelRefsForLocalRefHydrate(
      data[imagesField] as string[] | undefined,
      localRefs as string[]
    );
    (patch as Record<string, unknown>)[imagesField] = stripped;
  }

  const mainLocalRef = String(data.imageLocalRef || '').trim();
  if (mainLocalRef) {
    const preview = String(data.imagePreview || '').trim();
    if (preview.startsWith('data:')) {
      patch.imagePreview = undefined;
    }
    if (data.panelMainImageUrl) {
      const backup = String(data.panelMainImageUrl || '').trim();
      if (backup.startsWith('data:')) {
        patch.panelMainImageUrl = undefined;
      }
    }
  } else if (data.imagePreview && String(data.imagePreview).startsWith('data:')) {
    patch.imagePreview = undefined;
  }

  return patch;
}

export type PanelReferenceLocalRefField =
  | 'referenceImageLocalRefs'
  | 'klingOmniMultiReferenceLocalRefs'
  | 'klingOmniInstructionReferenceLocalRefs'
  | 'klingOmniVideoReferenceLocalRefs';

export function panelReferenceImagesFieldForLocalRefs(
  localRefField: PanelReferenceLocalRefField
): keyof NodeData {
  switch (localRefField) {
    case 'klingOmniMultiReferenceLocalRefs':
      return 'klingOmniMultiReferenceImages';
    case 'klingOmniInstructionReferenceLocalRefs':
      return 'klingOmniInstructionReferenceImages';
    case 'klingOmniVideoReferenceLocalRefs':
      return 'klingOmniVideoReferenceImages';
    default:
      return 'referenceImages';
  }
}

export function needsHydrateFromLocalRef(url: string | undefined): boolean {
  const s = String(url || '').trim();
  if (!s) return true;
  if (isPersistableMediaUrl(s)) return false;
  /** 内存中已有 blob 预览即可用；勿因同槽 localRef 反复从 IDB 重建（Omni 多图拖入会闪动） */
  if (s.startsWith('blob:')) return false;
  return isEphemeralMediaUrl(s, 'url');
}

/** 运行后 / 主图备份：blob+localRef 槽须异步复检是否 revoke，避免面板空白 */
export function panelShouldRecheckBlobHydrateAfterRun(data: Partial<NodeData>): boolean {
  if (data.panelMainSlotVisible === false) return true;
  if (String(data.panelMainImageUrl || '').trim().startsWith('blob:')) return true;
  const st = String(data.status || '').trim();
  return st === 'running' || st === 'completed';
}

export function panelHasBlobBackedLocalRefSlots(data: Partial<NodeData>): boolean {
  if (needsMainBackupHydrateFromLocalRef(data)) return true;
  const fields: PanelReferenceLocalRefField[] = [
    'referenceImageLocalRefs',
    'klingOmniMultiReferenceLocalRefs',
    'klingOmniInstructionReferenceLocalRefs',
    'klingOmniVideoReferenceLocalRefs',
  ];
  for (const field of fields) {
    const localRefs = [...((data[field] as string[] | undefined) || [])];
    if (!localRefs.some((r) => String(r || '').trim())) continue;
    const imagesField = panelReferenceImagesFieldForLocalRefs(field);
    const refs = [...((data[imagesField] as string[] | undefined) || [])];
    const maxLen = Math.max(refs.length, localRefs.length);
    for (let i = 0; i < maxLen; i++) {
      const localRef = String(localRefs[i] || '').trim();
      if (!localRef) continue;
      const cur = String(refs[i] || '').trim();
      if (!cur || cur.startsWith('blob:') || cur.startsWith('data:')) return true;
    }
  }
  return false;
}

export function panelNeedsPostRunBlobHydrateRecheck(data: Partial<NodeData>): boolean {
  return (
    panelShouldRecheckBlobHydrateAfterRun(data) && panelHasBlobBackedLocalRefSlots(data)
  );
}

/** localRefs 已有条目但 referenceImages 对应槽仍空/ephemeral：刷新后 IDB hydrate 尚未完成 */
export function panelRefsPendingLocalHydrate(
  data: Partial<NodeData>,
  localRefField: PanelReferenceLocalRefField = 'referenceImageLocalRefs'
): boolean {
  const imagesField = panelReferenceImagesFieldForLocalRefs(localRefField);
  const localRefs = [...((data[localRefField] as string[] | undefined) || [])];
  if (!localRefs.some((r) => String(r || '').trim())) return false;
  const refs = [...((data[imagesField] as string[] | undefined) || [])];
  const maxLen = Math.max(refs.length, localRefs.length);
  for (let i = 0; i < maxLen; i++) {
    const localRef = String(localRefs[i] || '').trim();
    if (!localRef) continue;
    if (needsHydrateFromLocalRef(refs[i])) return true;
  }
  return false;
}

/** image2 / Nano / seedance 参考生：panelMainImageUrl 缺失 / data: / 可能 revoke 的 blob → 须从 imageLocalRef hydrate */
export function needsMainBackupHydrateFromLocalRef(data: Partial<NodeData>): boolean {
  const localRef = String(data.imageLocalRef || '').trim();
  if (!localRef || !supportsMainBackupLocalRefHydrate(data)) return false;
  const backup = String(data.panelMainImageUrl || '').trim();
  if (!backup) {
    return data.panelMainSlotVisible === false;
  }
  if (backup.startsWith('data:')) return true;
  if (backup.startsWith('blob:')) return true;
  return false;
}

export function mainPanelPendingLocalHydrate(data: Partial<NodeData>): boolean {
  return needsMainBackupHydrateFromLocalRef(data);
}

export function anyPanelRefsPendingLocalHydrate(data: Partial<NodeData>): boolean {
  if (mainPanelPendingLocalHydrate(data)) return true;
  const fields: PanelReferenceLocalRefField[] = [
    'referenceImageLocalRefs',
    'klingOmniMultiReferenceLocalRefs',
    'klingOmniInstructionReferenceLocalRefs',
    'klingOmniVideoReferenceLocalRefs',
  ];
  return fields.some((f) => panelRefsPendingLocalHydrate(data, f));
}

/** 与 referenceImages 同槽下标；刷新后从 IndexedDB 恢复面板参考图预览 */
export async function hydratePanelReferenceUrlsFromLocalRefs(
  data: Partial<NodeData>,
  localRefField: PanelReferenceLocalRefField = 'referenceImageLocalRefs'
): Promise<Partial<NodeData> | undefined> {
  const imagesField = panelReferenceImagesFieldForLocalRefs(localRefField);
  const refs = [...((data[imagesField] as string[] | undefined) || [])];
  const localRefs = [...((data[localRefField] as string[] | undefined) || [])];
  const maxLen = Math.max(refs.length, localRefs.length);
  let changed = false;
  const nextRefs = [...refs];
  while (nextRefs.length < maxLen) nextRefs.push('');

  for (let i = 0; i < maxLen; i++) {
    const localRef = String(localRefs[i] || '').trim();
    if (!localRef) continue;
    const cur = String(nextRefs[i] || '').trim();
    if (isPersistableMediaUrl(cur)) continue;
    if (cur.startsWith('blob:')) {
      if (await isBlobPreviewUrlAlive(cur)) continue;
    } else if (!needsHydrateFromLocalRef(cur)) {
      continue;
    }
    const blob = await getLocalMediaBlob(localRef);
    if (!blob) continue;
    nextRefs[i] = URL.createObjectURL(blob);
    changed = true;
  }

  if (!changed) return undefined;
  return { [imagesField]: nextRefs } as Partial<NodeData>;
}

export async function isBlobPreviewUrlAlive(url: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    return res.ok;
  } catch {
    return false;
  }
}

/** 运行后 panelMainImageUrl 为 blob/data 被剥离或 revoke 时，用 imageLocalRef 恢复主图格备份 */
export async function hydratePanelMainImageUrlFromLocalRef(
  data: Partial<NodeData>
): Promise<Partial<NodeData> | undefined> {
  if (!needsMainBackupHydrateFromLocalRef(data)) return undefined;
  const backup = String(data.panelMainImageUrl || '').trim();
  if (backup.startsWith('blob:')) {
    if (await isBlobPreviewUrlAlive(backup)) return undefined;
  } else if (backup && !backup.startsWith('data:')) {
    return undefined;
  }
  const localRef = String(data.imageLocalRef || '').trim();
  if (!localRef) return undefined;
  const blob = await getLocalMediaBlob(localRef);
  if (!blob) return undefined;
  return { panelMainImageUrl: URL.createObjectURL(blob) };
}

/**
 * 运行后写 panelMainImageUrl：从 IDB 克隆独立 blob URL，避免与 imagePreview 共用同一 blob 被 revoke。
 */
export async function enrichPanelPreviewPatchWithFreshMainBackup(
  patch: Partial<NodeData>,
  data: Partial<NodeData>
): Promise<void> {
  if (patch.panelMainSlotVisible !== false && !String(patch.panelMainImageUrl || '').trim()) {
    return;
  }
  const localRef = String(data.imageLocalRef || '').trim();
  if (!localRef || !supportsMainBackupLocalRefHydrate(data)) return;
  const blob = await getLocalMediaBlob(localRef);
  if (!blob) return;
  patch.panelMainImageUrl = URL.createObjectURL(blob);
}

/** 首尾帧图从 IndexedDB 恢复（与多图参考同一机制：needsHydrateFromLocalRef 判定 + getLocalMediaBlob） */
export async function hydrateFrameLocalRefs(
  data: Partial<NodeData>
): Promise<Partial<NodeData> | undefined> {
  const patches: Partial<NodeData>[] = [];
  for (const slot of ['firstFrame', 'lastFrame'] as const) {
    const refKey = slot === 'firstFrame' ? 'firstFrameLocalRef' : 'lastFrameLocalRef';
    const imgKey = slot === 'firstFrame' ? 'firstFrameImage' : 'lastFrameImage';
    const urlKey = slot === 'firstFrame' ? 'firstFrameImageUrl' : 'lastFrameImageUrl';
    const frameRef = String((data as Record<string, unknown>)[refKey] as string || '').trim();
    if (!frameRef) continue;
    const cur = String((data as Record<string, unknown>)[imgKey] as string || '').trim();
    const curUrl = String((data as Record<string, unknown>)[urlKey] as string || '').trim();
    if (cur && !needsHydrateFromLocalRef(cur)) continue;
    if (curUrl && !needsHydrateFromLocalRef(curUrl)) continue;
    const blob = await getLocalMediaBlob(frameRef);
    if (!blob) continue;
    patches.push({ [imgKey]: URL.createObjectURL(blob) } as Partial<NodeData>);
  }
  if (!patches.length) return undefined;
  return Object.assign({}, ...patches);
}

export async function hydrateAllPanelReferenceLocalRefs(
  data: Partial<NodeData>
): Promise<Partial<NodeData> | undefined> {
  const patches: Partial<NodeData>[] = [];
  const fields: PanelReferenceLocalRefField[] = [
    'referenceImageLocalRefs',
    'klingOmniMultiReferenceLocalRefs',
    'klingOmniInstructionReferenceLocalRefs',
    'klingOmniVideoReferenceLocalRefs',
  ];
  for (const field of fields) {
    const localRefs = data[field];
    if (!Array.isArray(localRefs) || !localRefs.some(Boolean)) continue;
    const patch = await hydratePanelReferenceUrlsFromLocalRefs(data, field);
    if (patch) {
      patches.push(patch);
      data = { ...data, ...patch };
    }
  }
  const mainPatch = await hydratePanelMainImageUrlFromLocalRef(data);
  if (mainPatch) patches.push(mainPatch);
  const framePatch = await hydrateFrameLocalRefs(data);
  if (framePatch) patches.push(framePatch);
  if (!patches.length) return undefined;
  return Object.assign({}, ...patches);
}

export function setReferenceImageLocalRefAtIndex(
  localRefs: string[] | undefined,
  index: number,
  ref: string
): string[] {
  const out = [...(localRefs || [])];
  while (out.length <= index) out.push('');
  out[index] = ref;
  return out;
}

export function removeReferenceImageLocalRefAtIndex(
  localRefs: string[] | undefined,
  index: number
): { localRefs: string[]; removedRef?: string } {
  const out = [...(localRefs || [])];
  const removedRef = String(out[index] || '').trim() || undefined;
  if (index >= 0 && index < out.length) out.splice(index, 1);
  return { localRefs: out, removedRef };
}
