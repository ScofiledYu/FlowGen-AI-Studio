/** 画布本机拖入：blob + IndexedDB，避免 imagePreview 存超大 data URL */

import {
  canonicalProjectAssetFileUrl,
  parseProjectAssetIdsFromMediaUrl,
} from './projectAssetPreview.ts';

export function createLocalFileObjectUrl(file: File): string {
  return URL.createObjectURL(file);
}

/** Node Details / 参考图 URL 列表：短标签，不刷屏 blob/data */
export function formatMediaUrlForNodeDetails(
  url: string,
  opts?: { imageName?: string; projectId?: string; projectAssetId?: string }
): string {
  const s = (url || '').trim();
  if (!s) return '';
  const name = (opts?.imageName || '').trim() || '本地图片';
  const pid = (opts?.projectId || '').trim();
  const aid = (opts?.projectAssetId || '').trim();
  if (pid && aid && (s.startsWith('blob:') || s.startsWith('data:') || s.startsWith('flowgen-local:'))) {
    return canonicalProjectAssetFileUrl(pid, aid) || s;
  }
  const parsed = parseProjectAssetIdsFromMediaUrl(s);
  if (parsed && (s.startsWith('blob:') || s.startsWith('data:'))) {
    return canonicalProjectAssetFileUrl(parsed.projectId, parsed.assetId) || s;
  }
  if (s.startsWith('blob:')) return `blob: (${name})`;
  if (s.startsWith('data:')) {
    const kb = Math.round(s.length / 1024);
    return kb > 48 ? `data: (本机预览, ~${kb} KB)` : s;
  }
  if (s.startsWith('flowgen-local:')) return s;
  return s;
}

/** Node Details「Source URL」展示：不刷屏 base64；已绑定资产库时优先 file 链 */
export function formatNodeSourceUrlForDisplay(
  data: {
    imagePreview?: string;
    imageLocalRef?: string;
    imageName?: string;
    projectAssetId?: string;
  },
  projectId?: string
): string {
  const raw = data as { projectAssetId?: string };
  const pid = (projectId || '').trim();
  const aid = (raw.projectAssetId || '').trim();
  if (pid && aid) {
    const canonical = canonicalProjectAssetFileUrl(pid, aid);
    const main = (data.imagePreview || '').trim();
    if (
      !main ||
      main.startsWith('blob:') ||
      main.startsWith('data:') ||
      main.startsWith('flowgen-local:')
    ) {
      return canonical;
    }
  }
  const fromUrl = parseProjectAssetIdsFromMediaUrl(data.imagePreview);
  if (fromUrl) {
    const main = (data.imagePreview || '').trim();
    if (main.startsWith('blob:') || main.startsWith('data:')) {
      return canonicalProjectAssetFileUrl(fromUrl.projectId, fromUrl.assetId) || main;
    }
  }

  const main = (data.imagePreview || '').trim();
  const localRef = (data.imageLocalRef || '').trim();
  const name = (data.imageName || '').trim() || '本地图片';

  if (localRef) {
    if (main && !/^data:/i.test(main)) {
      if (main.startsWith('blob:')) return `blob: (${name})`;
      return main;
    }
    return localRef;
  }

  if (main.startsWith('data:')) {
    const kb = Math.round(main.length / 1024);
    return kb > 48 ? `data: (本机预览, ~${kb} KB)` : main;
  }

  return main;
}
