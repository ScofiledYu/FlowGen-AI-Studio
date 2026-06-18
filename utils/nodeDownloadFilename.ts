import { NodeType, type NodeData } from '../types';
import { FACTORY_NODE_LABELS } from './outputNodeNaming';

const GENERIC_FILENAME_RE =
  /^(proxy-file|proxy-image|file|thumb|download|node_image)(\.[a-z0-9]+)?$/i;
const GENERIC_GENERATED_RE =
  /^(Generated|Video|Imported|Extracted_Frame|Error|New_Node|Asset_Image)_/i;

function sanitizeFilenameStem(stem: string): string {
  return stem.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
}

export function isGenericDownloadFilename(name: string): boolean {
  const trimmed = String(name || '').trim();
  if (!trimmed) return true;
  if (GENERIC_FILENAME_RE.test(trimmed)) return true;
  const base = trimmed.replace(/\.[a-z0-9]{2,5}$/i, '');
  if (GENERIC_GENERATED_RE.test(base)) return true;
  return false;
}

export function isGenericDownloadLabel(label: string): boolean {
  const trimmed = String(label || '').trim();
  if (!trimmed) return true;
  return FACTORY_NODE_LABELS.has(trimmed.toLowerCase());
}

export function inferNodeDownloadExtension(opts: {
  nodeType?: string;
  imagePreview?: string;
  imageName?: string;
}): string {
  if (opts.nodeType === NodeType.MOV) return 'mov';
  const preview = String(opts.imagePreview || '');
  const fromPreview = preview.match(/\.(jpg|jpeg|png|gif|webp|bmp|mp4|webm|avi|mkv|flv|wmv|m4v)(\?|$)/i);
  if (fromPreview) return fromPreview[1].toLowerCase();
  const fromName = String(opts.imageName || '').match(/\.(jpg|jpeg|png|gif|webp|bmp|mov|mp4|webm|avi|mkv|flv|wmv|m4v)$/i);
  if (fromName) return fromName[1].toLowerCase();
  return 'png';
}

/** Unwrap nested /proxy-file?url=… chains and take the last path segment as filename. */
export function deriveDownloadFilenameFromUrl(input: string): string {
  const resolveInnerProxyUrl = (raw: string): string => {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return '';
    try {
      const u = new URL(trimmed, 'http://local.invalid');
      const p = u.pathname.toLowerCase();
      if ((p === '/proxy-file' || p === '/proxy-image') && u.searchParams.get('url')) {
        return resolveInnerProxyUrl(u.searchParams.get('url') || '');
      }
      return u.toString();
    } catch {
      return trimmed;
    }
  };
  const normalized = resolveInnerProxyUrl(input);
  if (!normalized) return '';
  try {
    const u = new URL(normalized, 'http://local.invalid');
    const seg = decodeURIComponent((u.pathname.split('/').filter(Boolean).pop() || '').trim());
    if (!seg || isGenericDownloadFilename(seg)) return '';
    return seg;
  } catch {
    const bare = normalized.split('#')[0].split('?')[0];
    const seg = decodeURIComponent((bare.split('/').filter(Boolean).pop() || '').trim());
    return isGenericDownloadFilename(seg) ? '' : seg;
  }
}

function withExtension(stem: string, extension: string): string {
  const cleanStem = sanitizeFilenameStem(stem.replace(/\.[a-z0-9]{2,5}$/i, ''));
  const safeStem = cleanStem || 'node';
  return `${safeStem}.${extension}`;
}

/**
 * Resolve download filename for a canvas node.
 * Priority: customName (Node Name) > meaningful imageName > non-factory label > URL segment > node id.
 */
export function resolveNodeDownloadFilename(
  data: Partial<NodeData>,
  opts: {
    nodeType?: string;
    nodeId?: string;
    imagePreview?: string;
    urlFallback?: string;
  } = {}
): string {
  const imagePreview = opts.imagePreview ?? data.imagePreview;
  const extension = inferNodeDownloadExtension({
    nodeType: opts.nodeType,
    imagePreview,
    imageName: data.imageName,
  });

  const customName = data.customName?.trim();
  if (customName) {
    return withExtension(customName, extension);
  }

  const imageName = data.imageName?.trim();
  if (imageName && !isGenericDownloadFilename(imageName)) {
    if (/\.[a-z0-9]{2,5}$/i.test(imageName)) {
      return sanitizeFilenameStem(imageName);
    }
    return withExtension(imageName, extension);
  }

  const label = data.label?.trim();
  if (label && !isGenericDownloadLabel(label)) {
    return withExtension(label, extension);
  }

  const fromUrl = deriveDownloadFilenameFromUrl(opts.urlFallback || imagePreview || '');
  if (fromUrl) {
    return sanitizeFilenameStem(fromUrl);
  }

  const idSuffix = opts.nodeId ? `_${opts.nodeId.slice(-6)}` : '';
  return `node${idSuffix}.${extension}`;
}
