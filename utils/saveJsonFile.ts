/**
 * JSON 另存为：对齐顶栏「打开工程」——点击后立刻走系统文件对话框。
 * - 安全上下文（HTTPS / localhost）：`showSaveFilePicker` 系统「另存为」
 * - 内网 `http://IP`：无系统另存为；回退前用 `confirm` 原生对话框确认（避免静默下载）
 */

export type SaveJsonFileResult = 'picker' | 'download' | 'aborted';

type SavePickerWindow = {
  isSecureContext?: boolean;
  showSaveFilePicker?: (opts: unknown) => Promise<FileSystemFileHandle>;
};

/** Chromium 在非安全上下文仍可能挂有 API，调用会抛错；须同时检查 isSecureContext。 */
export function canUseSaveFilePicker(win: SavePickerWindow = typeof window !== 'undefined' ? window : {}): boolean {
  return typeof win.showSaveFilePicker === 'function' && win.isSecureContext === true;
}

function triggerAnchorDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * 将 JSON Blob 写到用户选择的路径（或经确认后下载）。
 * 须在用户手势（click）同步调用链内尽早 await，与 `handleLoadProject` 一致。
 */
export async function saveJsonBlob(
  blob: Blob,
  fileName: string,
  opts?: { confirmDownloadMessage?: string }
): Promise<SaveJsonFileResult> {
  const safeName = fileName.trim() || `export-${Date.now()}.json`;
  const win = window as SavePickerWindow;

  if (canUseSaveFilePicker(win) && win.showSaveFilePicker) {
    try {
      const fileHandle = await win.showSaveFilePicker({
        suggestedName: safeName,
        types: [
          {
            description: 'JSON Files',
            accept: { 'application/json': ['.json'] },
          },
        ],
      });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      return 'picker';
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'name' in err && (err as { name: string }).name === 'AbortError') {
        return 'aborted';
      }
      // SecurityError 等：走下方确认下载
    }
  }

  const msg =
    opts?.confirmDownloadMessage ??
    `将导出到浏览器下载目录：\n${safeName}\n\n（当前非 HTTPS/localhost，无法弹出系统「另存为」对话框）\n确定导出？`;
  if (!window.confirm(msg)) {
    return 'aborted';
  }

  triggerAnchorDownload(blob, safeName);
  return 'download';
}

export function ensureJsonFileName(name: string, fallbackBase: string): string {
  let fileName = name.trim() || fallbackBase;
  if (!fileName.toLowerCase().endsWith('.json')) {
    fileName += '.json';
  }
  return fileName;
}
