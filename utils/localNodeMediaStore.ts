/**
 * 本机节点媒体：文件存 IndexedDB，workspace 只存 flowgen-local: 短引用。
 * 仅当前浏览器配置可恢复预览；运行时可从 IDB 取原 File 上传（与 originals 内存一致）。
 */

const DB_NAME = 'flowgen-local-media-v1';
const STORE = 'blobs';

export type LocalMediaSlot =
  | 'main'
  | 'firstFrame'
  | 'lastFrame'
  | 'ref'
  | 'jimeng'
  | 'omniVideo';

export function buildLocalMediaScope(userId: string, projectId: string | null): string {
  return `${userId || 'local'}_${projectId || 'local'}`;
}

export function buildLocalMediaRef(scope: string, nodeId: string, slot: LocalMediaSlot, index = 0): string {
  if (slot === 'ref' || slot === 'jimeng') {
    return `flowgen-local:${scope}:${nodeId}:${slot}:${index}`;
  }
  return `flowgen-local:${scope}:${nodeId}:${slot}`;
}

/** 模型名 → IDB 路径段（各模型首尾帧独立存储，避免切模型互相覆盖） */
export function modelFrameLocalRefKey(model: string): string {
  const m = String(model || 'default').trim();
  if (!m) return 'default';
  return (
    m
      .replace(/\s+/g, '_')
      .replace(/[()（）]/g, '')
      .replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g, '')
      .slice(0, 48) || 'default'
  );
}

export function isLegacyFrameLocalRef(ref: string | undefined): boolean {
  if (!ref?.startsWith('flowgen-local:')) return false;
  const parts = ref.split(':');
  return parts.length === 4 && (parts[3] === 'firstFrame' || parts[3] === 'lastFrame');
}

/** 各模型独立首尾帧 IDB 键：flowgen-local:scope:nodeId:lastFrame:可灵_2_5_Turbo */
export function buildModelScopedFrameLocalRef(
  scope: string,
  nodeId: string,
  slot: 'firstFrame' | 'lastFrame',
  model: string
): string {
  return `flowgen-local:${scope}:${nodeId}:${slot}:${modelFrameLocalRefKey(model)}`;
}

export function isScopedFrameLocalRef(ref: string | undefined): boolean {
  if (!ref?.startsWith('flowgen-local:')) return false;
  const parts = ref.split(':');
  return parts.length === 5 && (parts[3] === 'firstFrame' || parts[3] === 'lastFrame');
}

/** Seedance2.0 急速/高质量共用面板 IDB 键（型号切换面板统一） */
export function usesUnifiedSeedance20PanelLocalRef(model: string): boolean {
  const m = String(model || '').trim();
  return m === 'seedance2.0 (高质量版)' || m === 'seedance2.0 (急速版)';
}

/** @deprecated 使用 usesUnifiedSeedance20PanelLocalRef */
export function usesUnifiedFrameLocalRef(model: string): boolean {
  return usesUnifiedSeedance20PanelLocalRef(model);
}

export function isLegacyMainLocalRef(ref: string | undefined): boolean {
  if (!ref?.startsWith('flowgen-local:')) return false;
  const parts = ref.split(':');
  return parts.length === 4 && parts[3] === 'main';
}

export function isLegacyReferenceLocalRef(ref: string | undefined): boolean {
  if (!ref?.startsWith('flowgen-local:')) return false;
  const parts = ref.split(':');
  return parts.length === 5 && parts[3] === 'ref' && Number.isFinite(Number(parts[4]));
}

/** 主图预览：非 SD2.0 各模型独立 IDB 键 */
export function buildMainLocalRefForModel(scope: string, nodeId: string, model: string): string {
  if (usesUnifiedSeedance20PanelLocalRef(model)) {
    return buildLocalMediaRef(scope, nodeId, 'main');
  }
  return `flowgen-local:${scope}:${nodeId}:main:${modelFrameLocalRefKey(model)}`;
}

/** 参考图槽：非 SD2.0 各模型独立 IDB 键 */
export function buildReferenceLocalRefForModel(
  scope: string,
  nodeId: string,
  model: string,
  index: number
): string {
  if (usesUnifiedSeedance20PanelLocalRef(model)) {
    return buildLocalMediaRef(scope, nodeId, 'ref', index);
  }
  return `flowgen-local:${scope}:${nodeId}:ref:${modelFrameLocalRefKey(model)}:${index}`;
}

export type KlingOmniPanelTab = 'multi' | 'instruction' | 'video' | 'frames';

const KLING_OMNI_MODEL_KEY = modelFrameLocalRefKey('可灵3.0 Omni');

export function klingOmniTabScopedModelKey(tab: KlingOmniPanelTab): string {
  return `${KLING_OMNI_MODEL_KEY}_${tab}`;
}

/** 可灵3.0 Omni：四 tab 参考图独立 IDB 键 */
export function buildKlingOmniReferenceLocalRefForTab(
  scope: string,
  nodeId: string,
  tab: KlingOmniPanelTab,
  index: number
): string {
  return `flowgen-local:${scope}:${nodeId}:ref:${klingOmniTabScopedModelKey(tab)}:${index}`;
}

/** 可灵3.0 Omni 首尾帧 tab 独立 IDB 键（与其它模型首尾帧隔离） */
export function buildKlingOmniFrameLocalRefForTab(
  scope: string,
  nodeId: string,
  slot: 'firstFrame' | 'lastFrame'
): string {
  return `flowgen-local:${scope}:${nodeId}:${slot}:${klingOmniTabScopedModelKey('frames')}`;
}

/** 旧版按 tab 拆分的主图 IDB 键（已改回四 tab 共用主图，迁移至模型级 main 键） */
export function isKlingOmniTabScopedMainLocalRef(ref: string | undefined): boolean {
  if (!ref?.startsWith('flowgen-local:')) return false;
  const parts = ref.split(':');
  if (parts.length !== 5 || parts[3] !== 'main') return false;
  const key = parts[4];
  return (
    key === `${KLING_OMNI_MODEL_KEY}_multi` ||
    key === `${KLING_OMNI_MODEL_KEY}_instruction` ||
    key === `${KLING_OMNI_MODEL_KEY}_video` ||
    key === `${KLING_OMNI_MODEL_KEY}_frames`
  );
}

/** @deprecated 主图已四 tab 共用，请用 buildMainLocalRefForModel(scope, nodeId, '可灵3.0 Omni') */
export function buildKlingOmniMainLocalRefForTab(
  scope: string,
  nodeId: string,
  tab: KlingOmniPanelTab
): string {
  return buildMainLocalRefForModel(scope, nodeId, '可灵3.0 Omni');
}

/** 旧版 Omni 共用模型键（无 tab 后缀）→ 需按 tab 迁移 */
export function isLegacyKlingOmniSharedReferenceLocalRef(ref: string | undefined): boolean {
  if (!ref?.startsWith('flowgen-local:')) return false;
  const parts = ref.split(':');
  return parts.length === 6 && parts[3] === 'ref' && parts[4] === KLING_OMNI_MODEL_KEY;
}

export function isLegacyKlingOmniSharedMainLocalRef(ref: string | undefined): boolean {
  if (!ref?.startsWith('flowgen-local:')) return false;
  const parts = ref.split(':');
  return parts.length === 5 && parts[3] === 'main' && parts[4] === KLING_OMNI_MODEL_KEY;
}

export function isLegacyKlingOmniSharedFrameLocalRef(ref: string | undefined): boolean {
  if (!ref?.startsWith('flowgen-local:')) return false;
  const parts = ref.split(':');
  return (
    parts.length === 5 &&
    (parts[3] === 'firstFrame' || parts[3] === 'lastFrame') &&
    parts[4] === KLING_OMNI_MODEL_KEY
  );
}

/** 按模型选择首尾帧 IDB 键：Seedance2.0 两型号共享 legacy 键，其余 per-model */
export function buildFrameLocalRefForModel(
  scope: string,
  nodeId: string,
  slot: 'firstFrame' | 'lastFrame',
  model: string
): string {
  if (usesUnifiedSeedance20PanelLocalRef(model)) {
    return buildLocalMediaRef(scope, nodeId, slot);
  }
  return buildModelScopedFrameLocalRef(scope, nodeId, slot, model);
}

export function parseLocalMediaRef(ref: string): {
  scope: string;
  nodeId: string;
  slot: LocalMediaSlot;
  index: number;
  modelKey?: string;
} | null {
  if (!ref.startsWith('flowgen-local:')) return null;
  const parts = ref.split(':');
  if (parts.length < 4) return null;
  const scope = parts[1];
  const nodeId = parts[2];
  const slot = parts[3] as LocalMediaSlot;
  if (!['main', 'firstFrame', 'lastFrame', 'ref', 'jimeng', 'omniVideo'].includes(slot)) return null;

  if (slot === 'main' || slot === 'firstFrame' || slot === 'lastFrame') {
    if (parts.length === 4) return { scope, nodeId, slot, index: 0 };
    if (parts.length === 5) return { scope, nodeId, slot, index: 0, modelKey: parts[4] };
  }

  if (slot === 'ref' || slot === 'jimeng') {
    if (parts.length === 5) {
      const idx = Number(parts[4]);
      if (Number.isFinite(idx)) return { scope, nodeId, slot, index: idx };
    }
    if (parts.length === 6 && slot === 'ref') {
      const idx = Number(parts[5]);
      return {
        scope,
        nodeId,
        slot,
        index: Number.isFinite(idx) ? idx : 0,
        modelKey: parts[4],
      };
    }
  }

  const index = parts[4] != null ? Number(parts[4]) : 0;
  return { scope, nodeId, slot, index: Number.isFinite(index) ? index : 0 };
}

function idbKey(ref: string): string {
  return ref;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
  });
}

export async function putLocalMediaFile(ref: string, file: File | Blob): Promise<void> {
  const db = await openDb();
  const blob = file instanceof File ? file : file;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
    tx.objectStore(STORE).put(blob, idbKey(ref));
  });
}

export async function getLocalMediaBlob(ref: string): Promise<Blob | null> {
  try {
    const db = await openDb();
    return await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      tx.onerror = () => reject(tx.error);
      const req = tx.objectStore(STORE).get(idbKey(ref));
      req.onsuccess = () => {
        db.close();
        resolve((req.result as Blob) || null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function getLocalMediaFile(ref: string): Promise<File | null> {
  const blob = await getLocalMediaBlob(ref);
  if (!blob) return null;
  const parsed = parseLocalMediaRef(ref);
  const name = parsed ? `${parsed.slot}-${parsed.nodeId}` : 'local-media';
  return new File([blob], name, { type: blob.type || 'application/octet-stream' });
}

export async function deleteLocalMediaRef(ref: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
      tx.objectStore(STORE).delete(idbKey(ref));
    });
  } catch {
    /* ignore */
  }
}

export function revokeBlobPreviewUrl(url: string | undefined) {
  if (typeof url === 'string' && url.startsWith('blob:')) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  }
}
