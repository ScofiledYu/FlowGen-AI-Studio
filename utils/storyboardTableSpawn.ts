import type { Node } from 'reactflow';
import type { NodeData } from '../types';
import { formatSeedanceDurationLabel } from './seedanceDuration.ts';
import {
  canonicalProjectAssetFileUrl,
  isProjectAssetLibraryImageUrl,
  parseProjectAssetIdsFromMediaUrl,
} from './projectAssetPreview.ts';
import { normalizeTemplateNodeDataForSpawn } from './normalizeTemplateNodeForSpawn.ts';

export { isProjectAssetLibraryImageUrl } from './projectAssetPreview.ts';

export const STORYBOARD_TABLE_ERR =
  '需选择表格，表格需包含镜头编号（或镜头编码）和单镜秒数的字段';
export const STORYBOARD_TEMPLATE_ERR = '需选择一个工作区节点作为模板';
export const STORYBOARD_TEMPLATE_ASSET_ERR =
  '分镜表生成下游节点：模板须使用项目资产库中的图片（从资产库拖入节点或绑定 /assets/…/file 链接），不支持本地文件或 blob 预览。';

function isEphemeralMediaUrl(url: string): boolean {
  const s = url.trim();
  return s.startsWith('blob:') || s.startsWith('data:') || s.startsWith('flowgen-local:');
}

function resolveSpawnProjectId(explicit?: string, data?: NodeData): string | undefined {
  const pid = String(explicit || '').trim();
  if (pid) return pid;
  return parseProjectAssetIdsFromMediaUrl(data?.imagePreview)?.projectId;
}

function isVideoLikeUrl(url: string): boolean {
  const u = url.trim();
  return (
    /\.(mov|mp4|webm|avi|mkv|m4v|flv|wmv)(\?|$)/i.test(u) ||
    /videosgenerations|\/video\//i.test(u) ||
    /^data:video\//i.test(u)
  );
}

function pushTemplateImageUrl(out: string[], url: unknown): void {
  if (typeof url !== 'string') return;
  const s = url.trim();
  if (!s || isVideoLikeUrl(s)) return;
  out.push(s);
}

/** 仅有 IndexedDB 本机预览、且没有资产库 URL 可继承时视为「仅本地」 */
export function hasLocalOnlyMediaBinding(data: NodeData, projectId?: string): boolean {
  const urls = collectTemplateAssetImageUrls(data, projectId);
  if (urls.some((u) => isProjectAssetLibraryImageUrl(u))) return false;
  if (parseProjectAssetIdsFromMediaUrl(data.imagePreview)) return false;

  const rawBind = data as NodeData & { projectAssetId?: string };
  /** 已绑定资产库：不因残留 imageLocalRef / blob 运行时预览判为仅本机 */
  if (rawBind.projectAssetId?.trim()) return false;

  const raw = data as NodeData & Record<string, unknown>;
  const refs = [raw.imageLocalRef, raw.firstFrameLocalRef, raw.lastFrameLocalRef];
  return refs.some((r) => typeof r === 'string' && r.trim().startsWith('flowgen-local:'));
}

/** 分镜克隆会继承的模板图片字段（仅图片 URL，不含参考视频） */
export function collectTemplateAssetImageUrls(data: NodeData, projectId?: string): string[] {
  const urls: string[] = [];
  const rawBind = data as NodeData & { projectAssetId?: string };
  const fromPreview = parseProjectAssetIdsFromMediaUrl(data.imagePreview);
  const pid = (projectId || fromPreview?.projectId || '').trim();
  const aid = (rawBind.projectAssetId || fromPreview?.assetId || '').trim();
  if (pid && aid) {
    const canonical = canonicalProjectAssetFileUrl(pid, aid);
    if (canonical) pushTemplateImageUrl(urls, canonical);
  }
  pushTemplateImageUrl(urls, data.imagePreview);
  if (Array.isArray(data.referenceImages)) {
    for (const u of data.referenceImages) pushTemplateImageUrl(urls, u);
  }
  pushTemplateImageUrl(urls, data.firstFrameImage);
  pushTemplateImageUrl(urls, data.firstFrameImageUrl);
  if (Array.isArray(data.jimengImages)) {
    for (const u of data.jimengImages) pushTemplateImageUrl(urls, u);
  }
  const raw = data as NodeData & Record<string, unknown>;
  for (const key of [
    'klingOmniMultiReferenceImages',
    'klingOmniInstructionReferenceImages',
    'klingOmniVideoReferenceImages',
  ]) {
    const arr = raw[key];
    if (Array.isArray(arr)) {
      for (const u of arr) pushTemplateImageUrl(urls, u);
    }
  }
  const tab = raw.seedanceTabConfigs as
    | {
        image?: { referenceImages?: string[] };
        reference?: { referenceImages?: string[] };
      }
    | undefined;
  if (tab?.image?.referenceImages) {
    for (const u of tab.image.referenceImages) pushTemplateImageUrl(urls, u);
  }
  if (tab?.reference?.referenceImages) {
    for (const u of tab.reference.referenceImages) pushTemplateImageUrl(urls, u);
  }
  return urls;
}

export function validateTemplateUsesProjectAssetLibrary(
  data: NodeData,
  projectId?: string
): { ok: true } | { ok: false; error: string } {
  const rawBind = data as NodeData & { projectAssetId?: string };
  const aid = (rawBind.projectAssetId || '').trim();
  const pid = resolveSpawnProjectId(projectId, data);
  if (aid && pid) {
    const bound = canonicalProjectAssetFileUrl(pid, aid);
    if (bound && isProjectAssetLibraryImageUrl(bound)) {
      return { ok: true };
    }
  }

  const urls = collectTemplateAssetImageUrls(data, projectId);
  const libraryUrls = urls.filter((u) => isProjectAssetLibraryImageUrl(u));

  if (hasLocalOnlyMediaBinding(data, projectId)) {
    return { ok: false, error: `${STORYBOARD_TEMPLATE_ASSET_ERR}（含本机 IndexedDB 预览，请改用资产库）` };
  }

  if (libraryUrls.length === 0) {
    if (urls.length === 0) {
      return { ok: false, error: `${STORYBOARD_TEMPLATE_ASSET_ERR}（未绑定资产库图片）` };
    }
    if (urls.some(isEphemeralMediaUrl)) {
      return { ok: false, error: `${STORYBOARD_TEMPLATE_ASSET_ERR}（含本地 blob/data 预览）` };
    }
    return {
      ok: false,
      error: `${STORYBOARD_TEMPLATE_ASSET_ERR}（须为项目资产库 /assets/…/file 或 thumb）`,
    };
  }

  return { ok: true };
}

/** 分镜模板节点是否已绑定项目资产库（归一化预览 URL 后再校验） */
export function checkStoryboardTemplateAssetBinding(
  rawData: NodeData,
  projectId?: string
): { ok: true } | { ok: false; error: string } {
  const resolvedProjectId = resolveSpawnProjectId(projectId, rawData);
  const templateData = normalizeTemplateNodeDataForSpawn(rawData, resolvedProjectId);
  return validateTemplateUsesProjectAssetLibrary(templateData, resolvedProjectId);
}

/** 镜头 ID 列：模型输出常见「镜头编号」或「镜头编码」 */
export const SHOT_ID_HEADER_ALIASES = ['镜头编号', '镜头编码'] as const;
export const SHOT_ID_HEADER = SHOT_ID_HEADER_ALIASES[0];
export const SHOT_DURATION_HEADER = '单镜秒数';
export const SHOT_DURATION_HEADER_ALIASES = ['单镜秒数', '时长', '镜头时长'] as const;

/** 表头单元格归一化：去 BOM / 空白，避免 Excel 导出带不可见字符 */
export function normalizeStoryboardHeaderCell(raw: unknown): string {
  return String(raw ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\u00A0/g, ' ')
    .trim();
}

function findHeaderIndex(headers: string[], aliases: readonly string[]): number {
  const normalized = headers.map((h) => normalizeStoryboardHeaderCell(h));
  for (const alias of aliases) {
    const idx = normalized.indexOf(normalizeStoryboardHeaderCell(alias));
    if (idx >= 0) return idx;
  }
  // 对话内表格：允许列名互相包含（如「时长」≈「单镜秒数」）
  for (let i = 0; i < normalized.length; i++) {
    const h = normalized[i];
    if (aliases.some((a) => h.includes(a) || a.includes(h))) return i;
  }
  return -1;
}

/** Excel 导入：仅精确匹配列名，禁止「编号」「时长」等模糊命中 */
export function findStrictStoryboardHeaderIndex(
  headers: string[],
  allowedNames: readonly string[]
): number {
  const normalized = headers.map((h) => normalizeStoryboardHeaderCell(h));
  for (const name of allowedNames) {
    const idx = normalized.indexOf(normalizeStoryboardHeaderCell(name));
    if (idx >= 0) return idx;
  }
  return -1;
}

export const STORYBOARD_EXCEL_SHOT_HEADERS = ['镜头编码', '镜头编号'] as const;
export const STORYBOARD_EXCEL_DURATION_HEADERS = ['单镜秒数'] as const;

export const STORYBOARD_EXCEL_FORMAT_ERR =
  'Excel 分镜表格式不正确：表头须包含「镜头编码」或「镜头编号」，以及「单镜秒数」两列（列名需与导出模板完全一致）。';

export type SpawnHighlight = 'green' | 'yellow' | 'red';

export interface StoryboardTableColumns {
  shotIdIdx: number;
  durationIdx: number;
  promptColumnIndices: { header: string; idx: number }[];
}

export interface StoryboardSpawnRow {
  shotId: string;
  durationRaw: string;
  prompt: string;
  durationPatch: Partial<NodeData>;
  spawnHighlight: SpawnHighlight;
}

export function resolveSingleTemplateNode(
  selectedNodes: Node[],
  selectedNode?: Node | null,
  /** 无选中时：画布上仅有一个带 projectAssetId 的节点则作模板 */
  canvasNodes?: Node[]
): Node | null {
  if (selectedNodes.length === 1) return selectedNodes[0];
  if (selectedNodes.length === 0 && selectedNode) return selectedNode;
  if (selectedNodes.length === 0 && canvasNodes?.length) {
    const withAsset = canvasNodes.filter(
      (n) => !!(n.data as NodeData & { projectAssetId?: string }).projectAssetId
    );
    if (withAsset.length === 1) return withAsset[0];
  }
  return null;
}

/** 对话内表格：缺列时返回中文列名（镜头编码含「镜头编号」别名） */
export function getMissingStoryboardRequiredHeaders(headers: string[]): string[] {
  const h = headers.map((x) => normalizeStoryboardHeaderCell(x));
  const missing: string[] = [];
  if (findHeaderIndex(h, SHOT_ID_HEADER_ALIASES) < 0) missing.push('镜头编码');
  if (findHeaderIndex(h, SHOT_DURATION_HEADER_ALIASES) < 0) missing.push('单镜秒数');
  return missing;
}

/** Excel 导入：仅精确列名 */
export function getMissingStoryboardExcelRequiredHeaders(headers: string[]): string[] {
  const h = headers.map((x) => normalizeStoryboardHeaderCell(x));
  const missing: string[] = [];
  if (findStrictStoryboardHeaderIndex(h, STORYBOARD_EXCEL_SHOT_HEADERS) < 0) {
    missing.push('镜头编码（或镜头编号）');
  }
  if (findStrictStoryboardHeaderIndex(h, STORYBOARD_EXCEL_DURATION_HEADERS) < 0) {
    missing.push('单镜秒数');
  }
  return missing;
}

export function parseStoryboardTableColumns(
  rows: string[][],
  options?: { strictExcelHeaders?: boolean }
): StoryboardTableColumns | null {
  if (!rows.length) return null;
  const headers = rows[0].map((h) => normalizeStoryboardHeaderCell(h));
  const strict = options?.strictExcelHeaders === true;
  const shotIdIdx = strict
    ? findStrictStoryboardHeaderIndex(headers, STORYBOARD_EXCEL_SHOT_HEADERS)
    : findHeaderIndex(headers, SHOT_ID_HEADER_ALIASES);
  const durationIdx = strict
    ? findStrictStoryboardHeaderIndex(headers, STORYBOARD_EXCEL_DURATION_HEADERS)
    : findHeaderIndex(headers, SHOT_DURATION_HEADER_ALIASES);
  if (shotIdIdx < 0 || durationIdx < 0) return null;

  const promptColumnIndices = headers
    .map((header, idx) => ({ header, idx }))
    .filter(({ idx }) => idx !== shotIdIdx && idx !== durationIdx);

  return { shotIdIdx, durationIdx, promptColumnIndices };
}

/** 在前若干行中定位分镜表表头行（Excel 严格模式） */
export function findStoryboardExcelHeaderRowIndex(matrix: string[][], scanRows = 12): number {
  const limit = Math.min(matrix.length, scanRows);
  for (let i = 0; i < limit; i++) {
    if (getMissingStoryboardExcelRequiredHeaders(matrix[i]).length === 0) return i;
  }
  return -1;
}

export function buildPromptFromRow(
  row: string[],
  promptColumns: { header: string; idx: number }[]
): string {
  const parts: string[] = [];
  for (const { header, idx } of promptColumns) {
    const cell = (row[idx] ?? '').trim();
    if (!cell) continue;
    parts.push(`${header}：${cell}`);
  }
  return parts.join('\n\n');
}

function parseSeconds(raw: string): number | null {
  const m = String(raw ?? '').trim().match(/(\d+)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

function isSeedanceModel(model: string): boolean {
  return (
    model === 'seedance1.5-pro' ||
    model === 'seedance2.0 (高质量版)' ||
    model === 'seedance2.0 (急速版)'
  );
}

function isViduModel(model: string): boolean {
  return model === 'vidu 2.0';
}

function isKelingOrJimengModel(model: string): boolean {
  return model.includes('可灵') || model === '即梦3.0 Pro';
}

export function applyShotDurationToNodeData(
  templateData: NodeData,
  durationRaw: string
): { patch: Partial<NodeData>; spawnHighlight: SpawnHighlight } {
  const sec = parseSeconds(durationRaw);
  if (sec === null) {
    return { patch: {}, spawnHighlight: 'red' };
  }

  const model = templateData.selectedModel || '';

  if (isSeedanceModel(model)) {
    const label = formatSeedanceDurationLabel(sec);
    return { patch: { seedanceDuration: label }, spawnHighlight: 'green' };
  }

  if (isViduModel(model)) {
    if (sec === 4 || sec === 8) {
      return { patch: { viduDuration: `${sec}s` as NodeData['viduDuration'] }, spawnHighlight: 'green' };
    }
    return { patch: {}, spawnHighlight: 'red' };
  }

  if (isKelingOrJimengModel(model)) {
    if (sec === 5 || sec === 10) {
      return { patch: { duration: `${sec}s` }, spawnHighlight: 'green' };
    }
    return { patch: {}, spawnHighlight: 'red' };
  }

  return { patch: {}, spawnHighlight: 'red' };
}

export function parseStoryboardSpawnRows(
  rows: string[][],
  templateData: NodeData,
  options?: { strictExcelHeaders?: boolean }
): StoryboardSpawnRow[] | { error: string } {
  const strict = options?.strictExcelHeaders === true;
  const cols = parseStoryboardTableColumns(rows, { strictExcelHeaders: strict });
  if (!cols) {
    return { error: strict ? STORYBOARD_EXCEL_FORMAT_ERR : STORYBOARD_TABLE_ERR };
  }

  const result: StoryboardSpawnRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const shotId = (row[cols.shotIdIdx] ?? '').trim();
    if (!shotId) continue;

    const durationRaw = (row[cols.durationIdx] ?? '').trim();
    const prompt = buildPromptFromRow(row, cols.promptColumnIndices);
    const { patch, spawnHighlight } = applyShotDurationToNodeData(templateData, durationRaw);

    result.push({
      shotId,
      durationRaw,
      prompt,
      durationPatch: patch,
      spawnHighlight,
    });
  }

  if (result.length === 0) {
    return { error: strict ? STORYBOARD_EXCEL_FORMAT_ERR : STORYBOARD_TABLE_ERR };
  }

  return result;
}

export function validateStoryboardTableSpawn(
  rows: string[][] | null | undefined,
  selectedNodes: Node[],
  selectedNode?: Node | null,
  /** 从画布读取最新节点 data，避免侧栏 props 快照过期 */
  getLiveTemplateData?: (templateNodeId: string) => NodeData | undefined,
  /** 有 projectAssetId 时用于拼标准 /assets/…/file 链（避免 blob 预览误判） */
  projectId?: string,
  /** 实时画布节点（用于无选中时的单资产模板回退） */
  canvasNodes?: Node[]
):
  | { ok: true; templateNode: Node; spawnRows: StoryboardSpawnRow[] }
  | { ok: false; error: string } {
  if (!rows || rows.length < 2) {
    return { ok: false, error: STORYBOARD_TABLE_ERR };
  }

  if (!parseStoryboardTableColumns(rows)) {
    return { ok: false, error: STORYBOARD_TABLE_ERR };
  }

  const templateNode = resolveSingleTemplateNode(selectedNodes, selectedNode, canvasNodes);
  if (!templateNode) {
    return { ok: false, error: STORYBOARD_TEMPLATE_ERR };
  }

  const rawTemplateData =
    getLiveTemplateData?.(templateNode.id) ?? (templateNode.data as NodeData);
  const resolvedProjectId = resolveSpawnProjectId(projectId, rawTemplateData);
  const templateData = normalizeTemplateNodeDataForSpawn(rawTemplateData, resolvedProjectId);

  const spawnPid = resolvedProjectId || resolveSpawnProjectId(undefined, templateData);
  const assetCheck = validateTemplateUsesProjectAssetLibrary(templateData, spawnPid);
  if (assetCheck.ok === false) {
    return { ok: false, error: assetCheck.error };
  }

  const spawnRows = parseStoryboardSpawnRows(rows, templateData);
  if ('error' in spawnRows) {
    return { ok: false, error: spawnRows.error };
  }

  return { ok: true, templateNode, spawnRows };
}

/** 画布 Excel 导入：严格表头 + 与对话分镜表相同的下游生成校验 */
export function validateStoryboardExcelTableSpawn(
  rows: string[][] | null | undefined,
  selectedNodes: Node[],
  selectedNode?: Node | null,
  getLiveTemplateData?: (templateNodeId: string) => NodeData | undefined,
  projectId?: string,
  canvasNodes?: Node[]
):
  | { ok: true; templateNode: Node; spawnRows: StoryboardSpawnRow[] }
  | { ok: false; error: string } {
  if (!rows || rows.length < 2) {
    return { ok: false, error: STORYBOARD_EXCEL_FORMAT_ERR };
  }

  const headerRowIdx = findStoryboardExcelHeaderRowIndex(rows);
  if (headerRowIdx < 0) {
    return { ok: false, error: STORYBOARD_EXCEL_FORMAT_ERR };
  }

  const tableRows = rows.slice(headerRowIdx);
  if (tableRows.length < 2) {
    return { ok: false, error: STORYBOARD_EXCEL_FORMAT_ERR };
  }

  if (!parseStoryboardTableColumns(tableRows, { strictExcelHeaders: true })) {
    return { ok: false, error: STORYBOARD_EXCEL_FORMAT_ERR };
  }

  const templateNode = resolveSingleTemplateNode(selectedNodes, selectedNode, canvasNodes);
  if (!templateNode) {
    return { ok: false, error: STORYBOARD_TEMPLATE_ERR };
  }

  const rawTemplateData =
    getLiveTemplateData?.(templateNode.id) ?? (templateNode.data as NodeData);
  const resolvedProjectId = resolveSpawnProjectId(projectId, rawTemplateData);
  const templateData = normalizeTemplateNodeDataForSpawn(rawTemplateData, resolvedProjectId);

  const spawnPid = resolvedProjectId || resolveSpawnProjectId(undefined, templateData);
  const assetCheck = validateTemplateUsesProjectAssetLibrary(templateData, spawnPid);
  if (assetCheck.ok === false) {
    return { ok: false, error: assetCheck.error };
  }

  const spawnRows = parseStoryboardSpawnRows(tableRows, templateData, {
    strictExcelHeaders: true,
  });
  if ('error' in spawnRows) {
    return { ok: false, error: spawnRows.error };
  }

  return { ok: true, templateNode, spawnRows };
}
