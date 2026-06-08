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

export function parseLocalMediaRef(ref: string): { scope: string; nodeId: string; slot: LocalMediaSlot; index: number } | null {
  if (!ref.startsWith('flowgen-local:')) return null;
  const parts = ref.split(':');
  if (parts.length < 4) return null;
  const scope = parts[1];
  const nodeId = parts[2];
  const slot = parts[3] as LocalMediaSlot;
  if (!['main', 'firstFrame', 'lastFrame', 'ref', 'jimeng', 'omniVideo'].includes(slot)) return null;
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
