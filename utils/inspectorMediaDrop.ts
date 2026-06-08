/** 属性面板 HTML5 拖放：从 dataTransfer / window 缓冲读取内部图片 URL */

export function hasInspectorLocalFiles(dt: DataTransfer): boolean {
  return (dt.files?.length ?? 0) > 0;
}

function isUsableInternalDragUrl(url: string): boolean {
  const u = url.trim();
  if (!u || u.startsWith('file:')) return false;
  return (
    u.startsWith('http://') ||
    u.startsWith('https://') ||
    u.startsWith('data:') ||
    u.startsWith('blob:') ||
    u.startsWith('/')
  );
}

/** 仅读取应用内拖放（画布/资产库），不含桌面 file:// */
function extractFlowgenAppDragUrls(dt: DataTransfer): string[] {
  const winImages = (window as { __flowGenDragImages?: string[] }).__flowGenDragImages;
  if (Array.isArray(winImages) && winImages.length > 0) {
    return winImages.filter((u): u is string => typeof u === 'string' && isUsableInternalDragUrl(u));
  }

  const multi = dt.getData('application/flowgen/images');
  if (multi) {
    try {
      const parsed = JSON.parse(multi) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((u): u is string => typeof u === 'string' && isUsableInternalDragUrl(u));
      }
    } catch {
      /* ignore */
    }
  }

  const single = dt.getData('application/flowgen/image');
  if (single && isUsableInternalDragUrl(single)) return [single.trim()];

  return [];
}

export function extractInspectorDragUrls(dt: DataTransfer): string[] {
  const fromApp = extractFlowgenAppDragUrls(dt);
  if (fromApp.length > 0) return fromApp;

  // 桌面拖入文件时，浏览器常附带 file:// 的 text/plain，不能当作内部 URL（仅当确有文件时）
  if (hasInspectorLocalFiles(dt)) return [];

  const plain = dt.getData('text/plain');
  const uriList = dt.getData('text/uri-list');
  const first = [plain, uriList].find((u) => typeof u === 'string' && isUsableInternalDragUrl(u));
  return first ? [first.trim()] : [];
}

export function extractInspectorDragUrl(dt: DataTransfer): string | undefined {
  return extractInspectorDragUrls(dt)[0];
}

/** 构造供 handleRefDrop 等复用的合成拖放事件（本地上传 input） */
export function buildInspectorFileDropEvent(files: File[]): {
  preventDefault: () => void;
  stopPropagation: () => void;
  dataTransfer: DataTransfer;
} {
  const dt = new DataTransfer();
  for (const f of files) dt.items.add(f);
  return {
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
    dataTransfer: dt,
  };
}
