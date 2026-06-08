import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Trash2, Image as ImageIcon, Search, Plus, Pencil, GripVertical } from 'lucide-react';
import {
  deleteAsset,
  listAssets,
  patchAsset,
  replaceAssetFile,
  uploadAsset,
} from '../../services/flowgenApi';
import { AssetThumbCell } from './AssetThumbCell';
import { AssetLightboxMedia } from './AssetLightboxMedia';
import {
  clearAssetThumbCache,
  getCachedAssetThumbDisplayUrl,
  primeAssetThumbUrls,
  pruneAssetThumbCache,
} from '../../utils/assetThumbLoader';
import { withAssetAccessToken } from '../../services/flowgenApi';
import { normalizeAssetCategoryForDisplay, uiCategoryToKlingSubjectTag } from '../../services/aitop';
import { buildProjectAssetSlugRows } from '../../utils/promptMediaRefs';
import { isImageAssetMime, normalizeAssetMime } from '../../utils/assetMime';
import {
  startMiddleButtonMediaDrag,
  type FlowgenAssetDragItem,
} from '../../utils/middleButtonMediaDrag';

export type ProjectAssetRow = {
  id: string;
  name: string;
  url: string;
  thumbUrl?: string;
  mime: string;
  category: string;
  /** 服务器磁盘上是否仍有原文件（false 时缩略图无法加载，需删除后重新上传） */
  fileOnDisk?: boolean;
};

/** 与侧栏可灵 Omni「主体库」分类一致（NodeInspector SUBJECT_CATEGORIES） */
export const SUBJECT_TAGS = ['人物', '动物', '道具', '服饰', '场景', '特效', '其他'] as const;

function normalizeCategory(raw: string | undefined): string {
  return normalizeAssetCategoryForDisplay(raw);
}

function pickMediaFile(fileList: FileList | File[]): File | undefined {
  return Array.from(fileList).find((x) => x.type.startsWith('image/') || x.type.startsWith('video/'));
}

const ASSET_LIB_BOUNDS_KEY = 'flowgen:assetLibraryBounds';
const MIN_PANEL_W = 400;
const MIN_PANEL_H = 280;

function readSavedPanelBounds(): { x: number; y: number; w: number; h: number } | null {
  try {
    const raw = sessionStorage.getItem(ASSET_LIB_BOUNDS_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as { x?: unknown; y?: unknown; w?: unknown; h?: unknown };
    if (
      typeof o.x !== 'number' ||
      typeof o.y !== 'number' ||
      typeof o.w !== 'number' ||
      typeof o.h !== 'number' ||
      !Number.isFinite(o.x + o.y + o.w + o.h)
    )
      return null;
    return { x: o.x, y: o.y, w: o.w, h: o.h };
  } catch {
    return null;
  }
}

function persistPanelBounds(b: { x: number; y: number; w: number; h: number }) {
  try {
    sessionStorage.setItem(ASSET_LIB_BOUNDS_KEY, JSON.stringify(b));
  } catch {
    /* ignore */
  }
}

const MODAL_MAX_W_PX = 448;

function initialCenteredModalPosition(): { x: number; y: number } {
  if (typeof window === 'undefined') return { x: 24, y: 24 };
  const m = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(MODAL_MAX_W_PX, vw - 2 * m);
  const h = Math.min(580, vh - 2 * m);
  const x = Math.max(m, (vw - w) / 2);
  const y = Math.max(m, (vh - h) / 2);
  return clampModalPosition({ x, y });
}

function clampModalPosition(pos: { x: number; y: number }): { x: number; y: number } {
  if (typeof window === 'undefined') return pos;
  const m = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(MODAL_MAX_W_PX, vw - 2 * m);
  const h = Math.min(580, vh - 2 * m);
  return {
    x: Math.min(Math.max(pos.x, m), vw - w - m),
    y: Math.min(Math.max(pos.y, m), vh - h - m),
  };
}

function clampPanelBounds(b: { x: number; y: number; w: number; h: number }) {
  if (typeof window === 'undefined') return b;
  const fin = (n: number, fallback: number) =>
    typeof n === 'number' && Number.isFinite(n) ? n : fallback;
  const bx = fin(b.x, 8);
  const by = fin(b.y, 8);
  const bw = fin(b.w, MIN_PANEL_W);
  const bh = fin(b.h, MIN_PANEL_H);
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const m = 8;
  const w = Math.min(Math.max(bw, MIN_PANEL_W), vw - 2 * m);
  const h = Math.min(Math.max(bh, MIN_PANEL_H), vh - 2 * m);
  const x = Math.min(Math.max(bx, m), vw - w - m);
  const y = Math.min(Math.max(by, m), vh - h - m);
  return { x, y, w, h };
}

function defaultPanelBounds(): { x: number; y: number; w: number; h: number } {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const m = 8;
  const w = Math.min(1152, vw - 2 * m);
  const h = Math.min(Math.floor(vh * 0.92), 900);
  const x = Math.max(m, (vw - w) / 2);
  const y = Math.max(m, (vh - h) / 2);
  return clampPanelBounds({ x, y, w, h });
}

export function ProjectAssetLibrary({
  projectId,
  open,
  onClose,
  onChanged,
  onCreateNodesFromAssets,
  canManageAssets = false,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
  /** 将当前勾选的可拖拽素材在画布中创建为节点 */
  onCreateNodesFromAssets?: (items: FlowgenAssetDragItem[]) => void;
  /** 项目管理员 / 平台管理员可增删改；普通用户仅可搜索、选择与引用 */
  canManageAssets?: boolean;
}) {
  const [assets, setAssets] = useState<ProjectAssetRow[]>([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  /** 记录最后一次点击的素材 ID，用于 Shift+点击范围选择 */
  const lastSelectedIdRef = useRef<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createDragOver, setCreateDragOver] = useState(false);
  const [createFile, setCreateFile] = useState<File | null>(null);
  const [createPreviewUrl, setCreatePreviewUrl] = useState('');
  const [createName, setCreateName] = useState('');
  const [createTag, setCreateTag] = useState<string>('其他');
  const [createBusy, setCreateBusy] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editDragOver, setEditDragOver] = useState(false);
  const [editRow, setEditRow] = useState<ProjectAssetRow | null>(null);
  const [editName, setEditName] = useState('');
  const [editTag, setEditTag] = useState('');
  const [editNewFile, setEditNewFile] = useState<File | null>(null);
  const [editLocalPreview, setEditLocalPreview] = useState('');
  const [editBusy, setEditBusy] = useState(false);

  const [panelBounds, setPanelBounds] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const panelDragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const panelResizeRef = useRef<{ sx: number; sy: number; ow: number; oh: number } | null>(null);

  const [createModalPos, setCreateModalPos] = useState<{ x: number; y: number }>(initialCenteredModalPosition);
  const [editModalPos, setEditModalPos] = useState<{ x: number; y: number }>(initialCenteredModalPosition);
  const createModalDragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const editModalDragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  /** 双击网格项：全屏预览原图/视频 */
  const [lightboxAsset, setLightboxAsset] = useState<ProjectAssetRow | null>(null);

  const refresh = useCallback(async () => {
    setErr('');
    setLoading(true);
    try {
      const r = await listAssets(projectId);
      const list = (r.assets || []).map((a) => ({
        id: a.id,
        name: a.name,
        url: a.url,
        thumbUrl: a.thumbUrl,
        mime: normalizeAssetMime(a.mime, a.name),
        category: normalizeAssetCategoryForDisplay(a.category),
        fileOnDisk: (a as { fileOnDisk?: boolean }).fileOnDisk !== false,
      }));
      setAssets(list);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) {
      setSelectedIds(new Set());
      setQ('');
      setCategoryFilter('');
      setLightboxAsset(null);
    }
  }, [open]);

  useEffect(() => {
    if (!lightboxAsset) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxAsset(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxAsset]);

  useLayoutEffect(() => {
    if (!open) return;
    setPanelBounds((prev) => {
      if (prev) return clampPanelBounds(prev);
      const saved = readSavedPanelBounds();
      return saved ? clampPanelBounds(saved) : defaultPanelBounds();
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => {
      setPanelBounds((b) => (b ? clampPanelBounds(b) : b));
      setCreateModalPos((p) => clampModalPosition(p));
      setEditModalPos((p) => clampModalPosition(p));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    pruneAssetThumbCache(assets.map((a) => a.thumbUrl || a.url));
  }, [open, assets]);

  useEffect(() => {
    if (open) return;
    clearAssetThumbCache();
  }, [open]);

  /** 打开后预取首屏若干张，滚动前即可见 */
  useEffect(() => {
    if (!open || assets.length === 0) return;
    primeAssetThumbUrls(assets, 40);
  }, [open, assets]);

  const resetCreateForm = useCallback(() => {
    setCreateFile(null);
    setCreateName('');
    setCreateTag('其他');
    setCreateDragOver(false);
    setCreatePreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return '';
    });
  }, []);

  const closeCreateModal = useCallback(() => {
    setCreateOpen(false);
    resetCreateForm();
  }, [resetCreateForm]);

  const onPickCreateFile = useCallback((f: File | null) => {
    setCreateFile(f);
    setCreatePreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return f ? URL.createObjectURL(f) : '';
    });
  }, []);

  const resetEditForm = useCallback(() => {
    setEditRow(null);
    setEditName('');
    setEditTag('');
    setEditNewFile(null);
    setEditDragOver(false);
    setEditLocalPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return '';
    });
  }, []);

  const closeEditModal = useCallback(() => {
    setEditOpen(false);
    resetEditForm();
  }, [resetEditForm]);

  const onPickEditFile = useCallback((f: File | null) => {
    setEditNewFile(f);
    setEditLocalPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return f ? URL.createObjectURL(f) : '';
    });
  }, []);

  const openEdit = useCallback((a: ProjectAssetRow) => {
    setErr('');
    setEditRow(a);
    setEditName(a.name);
    setEditTag(normalizeCategory(a.category));
    setEditNewFile(null);
    setEditLocalPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return '';
    });
    setEditModalPos(initialCenteredModalPosition());
    setEditOpen(true);
  }, []);

  const slugRows = useMemo(
    () => buildProjectAssetSlugRows(assets.map((a) => ({ id: a.id, name: a.name }))),
    [assets]
  );

  const slugById = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of slugRows) m.set(r.id, r.slug);
    return m;
  }, [slugRows]);

  const categoryOptions = useMemo(() => {
    const s = new Set<string>([...SUBJECT_TAGS]);
    for (const a of assets) {
      if (a.category) s.add(a.category);
    }
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  }, [assets]);

  /** 编辑下拉的选项 = 全库标签 + 当前行（避免受控 value 与 option 对不上） */
  const editTagPickerOptions = useMemo(() => {
    const s = new Set<string>(categoryOptions);
    if (editTag) s.add(editTag);
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  }, [categoryOptions, editTag]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return assets.filter((a) => {
      if (categoryFilter && a.category !== categoryFilter) return false;
      if (!qq) return true;
      const blob = `${a.name}\n${a.category}`.toLowerCase();
      return blob.includes(qq);
    });
  }, [assets, q, categoryFilter]);

  /** Shift 范围多选；Ctrl/Cmd 切换单项；普通点击切换勾选 */
  const handleRangeSelect = (id: string, shiftKey: boolean, replaceSelection = false) => {
    if (shiftKey) {
      let anchorId = lastSelectedIdRef.current;
      if (!anchorId || !filtered.some((a) => a.id === anchorId)) {
        anchorId = filtered.find((a) => selectedIds.has(a.id))?.id ?? null;
      }
      if (anchorId) {
        const ids = filtered.map((a) => a.id);
        const lastIndex = ids.indexOf(anchorId);
        const currentIndex = ids.indexOf(id);
        if (lastIndex !== -1 && currentIndex !== -1) {
          const start = Math.min(lastIndex, currentIndex);
          const end = Math.max(lastIndex, currentIndex);
          setSelectedIds((prev) => {
            const next = replaceSelection ? new Set<string>() : new Set(prev);
            for (let i = start; i <= end; i++) {
              next.add(ids[i]);
            }
            return next;
          });
          lastSelectedIdRef.current = id;
          return;
        }
      }
    }

    if (replaceSelection) {
      setSelectedIds(new Set([id]));
      lastSelectedIdRef.current = id;
      return;
    }

    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    lastSelectedIdRef.current = id;
  };

  const isDraggableAsset = (a: ProjectAssetRow) =>
    isImageAssetMime(a.mime, a.name) || a.mime.startsWith('video/');

  /** 中键拖出：若当前项已在多选集合内则带上全部已选，否则只拖当前项 */
  const beginMiddleDragFromAsset = useCallback(
    (anchor: ProjectAssetRow, e: React.PointerEvent) => {
      if (e.button !== 1 || !isDraggableAsset(anchor)) return;
      const payloads: FlowgenAssetDragItem[] =
        selectedIds.has(anchor.id) && selectedIds.size > 1
          ? filtered
              .filter((a) => selectedIds.has(a.id) && isDraggableAsset(a))
              .map((a) => ({
                assetId: a.id,
                assetName: a.name,
                url: a.url,
                thumbUrl: a.thumbUrl,
                mime: a.mime,
              }))
          : [
              {
                assetId: anchor.id,
                assetName: anchor.name,
                url: anchor.url,
                thumbUrl: anchor.thumbUrl,
                mime: anchor.mime,
              },
            ];
      if (payloads.length === 0) return;
      const primary = payloads[0];
      startMiddleButtonMediaDrag(e, {
        url: primary.url,
        kind: primary.mime.startsWith('video/') ? 'video' : 'image',
        sourceNodeId: payloads.length > 1 ? 'asset:multi' : `asset:${primary.assetId}`,
        assetId: primary.assetId,
        assetName: primary.assetName,
        assets: payloads,
      });
    },
    [filtered, selectedIds]
  );

  /** 将勾选素材在画布创建节点（与中键拖放逻辑一致） */
  const handleCreateNodes = () => {
    if (!onCreateNodesFromAssets || selectedIds.size === 0) return;
    const payloads: FlowgenAssetDragItem[] = filtered
      .filter((a) => selectedIds.has(a.id) && isDraggableAsset(a))
      .map((a) => ({
        assetId: a.id,
        assetName: a.name,
        url: a.url,
        thumbUrl: a.thumbUrl,
        mime: a.mime,
      }));
    if (payloads.length === 0) {
      alert('所选素材无法创建节点（仅支持图片与视频）');
      return;
    }
    onCreateNodesFromAssets(payloads);
  };

  const copyTokensForIds = (ids: string[]) => {
    const parts = ids
      .map((id) => slugById.get(id))
      .filter(Boolean)
      .map((slug) => `@资产:${slug}`);
    if (parts.length === 0) return;
    void navigator.clipboard.writeText(parts.join(' '));
  };

  const submitCreate = async () => {
    const name = createName.trim();
    if (!createFile) {
      setErr('请添加参考图');
      return;
    }
    if (!name) {
      setErr('请填写主体姓名');
      return;
    }
    setErr('');
    setCreateBusy(true);
    try {
      const expectedTag = normalizeCategory(createTag);
      const created = await uploadAsset(projectId, createFile, name, expectedTag);
      closeCreateModal();
      await refresh();
      try {
        const r = await listAssets(projectId);
        const row = r.assets?.find((a) => a.id === created.id);
        const got = row ? normalizeCategory(row.category) : '';
        if (row && got !== expectedTag) {
          console.warn('[flowgen] 刷新后列表中的标签与所选仍不一致（可检查 Network → GET .../assets）', {
            assetId: created.id,
            expected: expectedTag,
            listCategory: got,
          });
        }
      } catch {
        /* 校验失败不阻断 */
      }
      onChanged();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : '创建失败');
    } finally {
      setCreateBusy(false);
    }
  };

  const submitEdit = async () => {
    if (!editRow) return;
    const name = editName.trim();
    if (!name) {
      setErr('请填写主体姓名');
      return;
    }
    setErr('');
    setEditBusy(true);
    try {
      if (editNewFile) {
        await replaceAssetFile(projectId, editRow.id, editNewFile);
      }
      const catLabel = normalizeCategory(editTag);
      const metaChanged =
        name !== editRow.name || catLabel !== normalizeCategory(editRow.category);
      if (metaChanged) {
        const code = uiCategoryToKlingSubjectTag(catLabel);
        await patchAsset(projectId, editRow.id, {
          name,
          category: code,
          tag: code,
        });
      }
      closeEditModal();
      await refresh();
      onChanged();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : '保存失败');
    } finally {
      setEditBusy(false);
    }
  };

  const editPreviewSrc =
    editRow &&
    (editLocalPreview ||
      getCachedAssetThumbDisplayUrl(editRow.url, editRow.thumbUrl) ||
      (editRow.thumbUrl ? withAssetAccessToken(editRow.thumbUrl) : undefined));
  const editPreviewIsVideo =
    editLocalPreview && editNewFile
      ? editNewFile.type.startsWith('video/')
      : !!(editRow?.mime && editRow.mime.startsWith('video/'));

  if (!open) return null;

  if (typeof document === 'undefined') return null;

  const panelB = panelBounds ?? defaultPanelBounds();

  return createPortal(
    <>
      <div
        role="dialog"
        aria-labelledby="asset-library-title"
        className="fixed z-[60000] flex flex-col overflow-hidden rounded-2xl border border-gray-700/90 bg-[#0c0f18] text-white shadow-2xl pointer-events-auto"
        style={{
          left: panelB.x,
          top: panelB.y,
          width: panelB.w,
          height: panelB.h,
        }}
      >
        {/* Header：拖动 */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-800/80 bg-[#0f131d] px-5 py-4">
          <div
            className="flex min-w-0 flex-1 cursor-grab touch-none items-center gap-2 rounded-lg py-1 active:cursor-grabbing"
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              const cur = panelBounds ?? defaultPanelBounds();
              if (!panelBounds) setPanelBounds(cur);
              panelDragRef.current = { sx: e.clientX, sy: e.clientY, ox: cur.x, oy: cur.y };
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              const d = panelDragRef.current;
              if (!d) return;
              const dx = e.clientX - d.sx;
              const dy = e.clientY - d.sy;
              setPanelBounds((prev) => {
                const cur = prev ?? defaultPanelBounds();
                return clampPanelBounds({ x: d.ox + dx, y: d.oy + dy, w: cur.w, h: cur.h });
              });
            }}
            onPointerUp={(e) => {
              panelDragRef.current = null;
              setPanelBounds((prev) => {
                if (prev) persistPanelBounds(prev);
                return prev;
              });
              try {
                (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
              } catch {
                /* ignore */
              }
            }}
            onPointerCancel={(e) => {
              panelDragRef.current = null;
              try {
                (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
              } catch {
                /* ignore */
              }
            }}
          >
            <GripVertical className="h-5 w-5 shrink-0 text-gray-500" aria-hidden />
            <div className="pointer-events-none shrink-0 rounded-lg bg-brand-600/20 p-2 text-brand-400">
              <ImageIcon size={20} />
            </div>
            <div className="min-w-0 pointer-events-none">
              <h2 id="asset-library-title" className="truncate text-base font-semibold text-white">
                从资产库选择
              </h2>
              <p className="truncate text-[11px] text-gray-500">
                {canManageAssets
                  ? '拖动标题栏移动窗口；Shift+点击范围多选、Ctrl+点击增减；多选后可「创建节点」或中键拖到画布；双击查看大图。'
                  : '只读模式：可搜索并选择；Shift+点击范围多选、Ctrl+点击增减；多选后可「创建节点」或中键拖到画布；双击查看大图。'}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {canManageAssets ? (
            <button
              type="button"
              onClick={() => {
                setErr('');
                resetCreateForm();
                setCreateModalPos(initialCenteredModalPosition());
                setCreateOpen(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-brand-600 to-violet-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-brand-900/30 hover:from-brand-500 hover:to-violet-500"
            >
              <Plus className="h-4 w-4" />
              创建
            </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-800"
              aria-label="关闭"
            >
              <X size={22} />
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 px-5 py-3 border-b border-gray-800/60 bg-[#0c0f18]">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索主体名称或标签"
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-gray-900/90 border border-gray-700 text-sm text-gray-100 placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500/50"
            />
          </div>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="rounded-xl bg-gray-900 border border-gray-700 px-3 py-2 text-sm text-gray-200 min-w-[140px]"
          >
            <option value="">全部标签</option>
            {categoryOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <div className="text-sm text-gray-400 ml-auto whitespace-nowrap">
            已选 <span className="text-brand-400 font-medium">{selectedIds.size}</span> / 可见{' '}
            <span className="text-gray-200 font-medium">{filtered.length}</span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          {err && <p className="text-sm text-amber-400 mb-3">{err}</p>}
          {loading && <p className="text-sm text-gray-500 mb-3">加载中…</p>}

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 select-none">
            {filtered.map((a) => {
              const selected = selectedIds.has(a.id);
              return (
                <div
                  key={a.id}
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    if (e.shiftKey) {
                      e.preventDefault();
                      handleRangeSelect(a.id, true);
                      return;
                    }
                    if (e.ctrlKey || e.metaKey) {
                      e.preventDefault();
                      handleRangeSelect(a.id, false);
                      return;
                    }
                    handleRangeSelect(a.id, false, true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      if (e.shiftKey) handleRangeSelect(a.id, true);
                      else if (e.ctrlKey || e.metaKey) handleRangeSelect(a.id, false);
                      else handleRangeSelect(a.id, false, true);
                    }
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (a.mime.startsWith('image/') || a.mime.startsWith('video/')) {
                      setLightboxAsset(a);
                    }
                  }}
                  title={
                    a.mime.startsWith('image/') || a.mime.startsWith('video/')
                      ? `${a.name}（双击查看大图）`
                      : a.name
                  }
                  className={`relative aspect-square rounded-xl overflow-hidden border-2 bg-gray-950 cursor-pointer transition-all outline-none focus-visible:ring-2 focus-visible:ring-brand-500 select-none ${
                    selected
                      ? 'border-brand-500 ring-2 ring-brand-500/35 shadow-lg shadow-brand-900/20'
                      : 'border-gray-800 hover:border-gray-600'
                  }`}
                  onDragStart={(e) => e.preventDefault()}
                >
                  <AssetThumbCell
                    fileUrl={a.url}
                    thumbUrl={a.thumbUrl}
                    mime={a.mime}
                    assetId={a.id}
                    assetName={a.name}
                    fileOnDisk={a.fileOnDisk !== false}
                    onMiddleDragStart={(e) => beginMiddleDragFromAsset(a, e)}
                  />

                  {canManageAssets ? (
                  <button
                    type="button"
                    title="编辑"
                    onClick={(e) => {
                      e.stopPropagation();
                      openEdit(a);
                    }}
                    className="absolute top-2 left-2 p-1.5 rounded-lg bg-black/55 hover:bg-brand-600/90 text-white border border-white/10 backdrop-blur-sm z-10"
                  >
                    <Pencil size={14} />
                  </button>
                  ) : null}

                  {canManageAssets ? (
                  <button
                    type="button"
                    title="删除"
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (!confirm(`删除「${a.name}」？`)) return;
                      try {
                        await deleteAsset(projectId, a.id);
                        setSelectedIds((prev) => {
                          const n = new Set(prev);
                          n.delete(a.id);
                          return n;
                        });
                        await refresh();
                        onChanged();
                      } catch (ex) {
                        setErr(ex instanceof Error ? ex.message : '删除失败');
                      }
                    }}
                    className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/55 hover:bg-red-600/90 text-white border border-white/10 backdrop-blur-sm z-10"
                  >
                    <Trash2 size={14} />
                  </button>
                  ) : null}

                  {/* 底部信息栏 + 复选框 */}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/75 to-transparent pt-11 pb-2 px-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-white truncate drop-shadow-md">{a.name}</p>
                        <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded-md bg-white/15 text-gray-100 border border-white/10">
                          {a.category}
                        </span>
                      </div>
                      {/* 小复选框 - 底部右侧 */}
                      <div
                        className={`w-5 h-5 rounded border-2 flex items-center justify-center cursor-pointer transition-all flex-shrink-0 ${
                          selected
                            ? 'bg-brand-500 border-brand-500'
                            : 'bg-black/50 border-white/40 hover:border-white/70'
                        }`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (e.shiftKey) {
                            e.preventDefault();
                            handleRangeSelect(a.id, true);
                          } else if (e.ctrlKey || e.metaKey) {
                            e.preventDefault();
                            handleRangeSelect(a.id, false);
                          } else {
                            handleRangeSelect(a.id, false);
                          }
                        }}
                      >
                        {selected && (
                          <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {!loading && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-gray-500 gap-2">
              <ImageIcon size={44} className="opacity-35" />
              <p className="text-sm">
                {assets.length === 0
                  ? canManageAssets
                    ? '暂无素材，点击「创建」添加'
                    : '暂无素材（请联系项目管理员上传）'
                  : '没有符合筛选的素材'}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-t border-gray-800/80 bg-[#0f131d]">
          <p className="text-xs text-gray-500">
            共 <span className="text-gray-300 font-medium">{assets.length}</span> 个主体（当前筛选{' '}
            <span className="text-gray-300 font-medium">{filtered.length}</span>）
            {selectedIds.size > 0 && (
              <span className="ml-2 text-brand-400">已选 {selectedIds.size} 个</span>
            )}
          </p>
          <div className="flex items-center gap-2">
            {selectedIds.size > 0 && (
              <button
                type="button"
                onClick={handleCreateNodes}
                disabled={!onCreateNodesFromAssets}
                className={`px-3 py-1.5 rounded-lg text-sm border ${
                  onCreateNodesFromAssets
                    ? 'border-brand-500/50 text-brand-300 hover:bg-brand-500/10'
                    : 'border-gray-600 text-gray-500 cursor-not-allowed'
                }`}
              >
                创建节点 ({selectedIds.size})
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg text-sm border border-gray-600 text-gray-300 hover:bg-gray-800"
            >
              关闭
            </button>
          </div>
        </div>
        <div
          className="absolute bottom-0 right-0 z-20 h-7 w-7 cursor-se-resize touch-none rounded-tl-lg border-l border-t border-gray-500/40 bg-[#0f131d]/95"
          style={{ touchAction: 'none' }}
          aria-label="调整窗口大小"
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const cur = panelBounds ?? defaultPanelBounds();
            if (!panelBounds) setPanelBounds(cur);
            panelResizeRef.current = { sx: e.clientX, sy: e.clientY, ow: cur.w, oh: cur.h };
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const r = panelResizeRef.current;
            if (!r) return;
            const dw = e.clientX - r.sx;
            const dh = e.clientY - r.sy;
            setPanelBounds((prev) => {
              const cur = prev ?? defaultPanelBounds();
              return clampPanelBounds({ x: cur.x, y: cur.y, w: r.ow + dw, h: r.oh + dh });
            });
          }}
          onPointerUp={(e) => {
            panelResizeRef.current = null;
            setPanelBounds((prev) => {
              if (prev) persistPanelBounds(prev);
              return prev;
            });
            try {
              (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
            } catch {
              /* ignore */
            }
          }}
          onPointerCancel={(e) => {
            panelResizeRef.current = null;
            try {
              (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
            } catch {
              /* ignore */
            }
          }}
        />
      </div>

      {/* 大图预览 */}
      {lightboxAsset &&
        createPortal(
          <div
            className="fixed inset-0 z-[80015] flex items-center justify-center"
            role="dialog"
            aria-modal="true"
            aria-label={`预览 ${lightboxAsset.name}`}
          >
            <div
              className="absolute inset-0 bg-black/92 backdrop-blur-sm"
              role="presentation"
              onDoubleClick={() => setLightboxAsset(null)}
              onClick={() => setLightboxAsset(null)}
            />
            <div
              className="relative z-[80016] flex max-h-[92vh] max-w-[94vw] flex-col items-center gap-3 px-4 pointer-events-none"
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="pointer-events-auto fixed top-5 right-5 z-[80017] rounded-lg border border-gray-600 bg-gray-900/90 p-2.5 text-gray-300 hover:bg-gray-800 hover:text-white"
                aria-label="关闭预览"
                onClick={() => setLightboxAsset(null)}
              >
                <X size={22} />
              </button>
              <div className="pointer-events-auto flex min-h-0 min-w-0 flex-1 items-center justify-center">
                <AssetLightboxMedia asset={lightboxAsset} />
              </div>
              <div className="pointer-events-auto text-center">
                <p className="text-base font-medium text-white">{lightboxAsset.name}</p>
                <p className="mt-1 text-sm text-gray-400">{lightboxAsset.category}</p>
                <p className="mt-2 text-[11px] text-gray-600">Esc 或点击空白处关闭 · 双击空白处关闭</p>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* 创建主体 — 独立 portal，避免被主素材窗口层叠挡住 */}
      {createOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[80010]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-subject-title"
          >
            <div
              className="absolute inset-0 bg-black/80"
              role="presentation"
              onClick={closeCreateModal}
            />
            <div
              className="absolute z-[80011] w-[min(28rem,calc(100vw-2rem))] max-h-[90vh] flex flex-col rounded-2xl border border-gray-700 bg-[#121722] shadow-2xl overflow-hidden pointer-events-auto"
              style={{ left: createModalPos.x, top: createModalPos.y }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex shrink-0 items-stretch border-b border-gray-800 bg-[#121722]">
                <div
                  className="flex min-w-0 flex-1 cursor-grab touch-none items-center gap-2 px-5 py-4 active:cursor-grabbing rounded-tl-2xl"
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    createModalDragRef.current = {
                      sx: e.clientX,
                      sy: e.clientY,
                      ox: createModalPos.x,
                      oy: createModalPos.y,
                    };
                    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                  }}
                  onPointerMove={(e) => {
                    const d = createModalDragRef.current;
                    if (!d) return;
                    const dx = e.clientX - d.sx;
                    const dy = e.clientY - d.sy;
                    setCreateModalPos(clampModalPosition({ x: d.ox + dx, y: d.oy + dy }));
                  }}
                  onPointerUp={(e) => {
                    createModalDragRef.current = null;
                    try {
                      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
                    } catch {
                      /* ignore */
                    }
                  }}
                  onPointerCancel={(e) => {
                    createModalDragRef.current = null;
                    try {
                      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
                    } catch {
                      /* ignore */
                    }
                  }}
                >
                  <GripVertical className="h-5 w-5 shrink-0 text-gray-500" aria-hidden />
                  <div className="min-w-0 pointer-events-none">
                    <h3 id="create-subject-title" className="text-base font-semibold text-white">
                      创建主体
                    </h3>
                    <p className="text-[11px] text-gray-500 truncate">拖动左侧标题栏移动窗口</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeCreateModal}
                  className="shrink-0 px-4 py-3 hover:bg-gray-800 text-gray-400 rounded-tr-2xl"
                  aria-label="关闭"
                >
                  <X size={20} />
                </button>
              </div>
            <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1 min-h-0">
              <div>
                <label className="block text-xs text-gray-500 mb-2">添加参考图</label>
                <div
                  className={`rounded-xl border-2 border-dashed transition-colors overflow-hidden ${
                    createDragOver ? 'border-brand-400 bg-brand-500/10' : 'border-gray-600 bg-gray-900/50'
                  }`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onDragEnter={(e) => {
                    e.preventDefault();
                    setCreateDragOver(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    const rel = e.relatedTarget as Node | null;
                    if (rel && e.currentTarget.contains(rel)) return;
                    setCreateDragOver(false);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setCreateDragOver(false);
                    const f = pickMediaFile(e.dataTransfer.files);
                    if (f) onPickCreateFile(f);
                  }}
                >
                  <label className="flex flex-col items-center justify-center min-h-[160px] w-full cursor-pointer overflow-hidden">
                    {createPreviewUrl ? (
                      createFile?.type.startsWith('video/') ? (
                        <video src={createPreviewUrl} className="w-full max-h-52 object-contain" muted playsInline />
                      ) : (
                        <img src={createPreviewUrl} alt="" className="w-full max-h-52 object-contain" />
                      )
                    ) : (
                      <div className="py-8 px-4 text-center">
                        <p className="text-sm text-gray-400">点击选择图片或视频</p>
                        <p className="text-xs text-gray-600 mt-2">或将文件拖入此区域</p>
                      </div>
                    )}
                    <input
                      type="file"
                      accept="image/*,video/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0] ?? null;
                        e.target.value = '';
                        onPickCreateFile(f);
                      }}
                    />
                  </label>
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">主体姓名</label>
                <input
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="请输入主体名称"
                  className="w-full px-3 py-2 rounded-xl bg-gray-900 border border-gray-700 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">标签</label>
                <select
                  value={createTag}
                  onChange={(e) => setCreateTag(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-gray-900 border border-gray-700 text-sm text-gray-200"
                >
                  {categoryOptions.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-800 bg-[#0f131d]">
              <button
                type="button"
                onClick={closeCreateModal}
                className="px-4 py-2 rounded-lg text-sm border border-gray-600 text-gray-300 hover:bg-gray-800"
              >
                取消
              </button>
              <button
                type="button"
                disabled={createBusy}
                onClick={() => void submitCreate()}
                className="px-4 py-2 rounded-lg text-sm bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-50"
              >
                {createBusy ? '提交中…' : '确定'}
              </button>
            </div>
          </div>
          </div>,
          document.body
        )}

      {/* 编辑主体 */}
      {editOpen &&
        editRow &&
        createPortal(
          <div
            className="fixed inset-0 z-[80020]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-subject-title"
          >
            <div className="absolute inset-0 bg-black/80" role="presentation" onClick={closeEditModal} />
            <div
              className="absolute z-[80021] w-[min(28rem,calc(100vw-2rem))] max-h-[90vh] flex flex-col rounded-2xl border border-gray-700 bg-[#121722] shadow-2xl overflow-hidden pointer-events-auto"
              style={{ left: editModalPos.x, top: editModalPos.y }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex shrink-0 items-stretch border-b border-gray-800 bg-[#121722]">
                <div
                  className="flex min-w-0 flex-1 cursor-grab touch-none items-center gap-2 px-5 py-4 active:cursor-grabbing rounded-tl-2xl"
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    editModalDragRef.current = {
                      sx: e.clientX,
                      sy: e.clientY,
                      ox: editModalPos.x,
                      oy: editModalPos.y,
                    };
                    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                  }}
                  onPointerMove={(e) => {
                    const d = editModalDragRef.current;
                    if (!d) return;
                    const dx = e.clientX - d.sx;
                    const dy = e.clientY - d.sy;
                    setEditModalPos(clampModalPosition({ x: d.ox + dx, y: d.oy + dy }));
                  }}
                  onPointerUp={(e) => {
                    editModalDragRef.current = null;
                    try {
                      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
                    } catch {
                      /* ignore */
                    }
                  }}
                  onPointerCancel={(e) => {
                    editModalDragRef.current = null;
                    try {
                      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
                    } catch {
                      /* ignore */
                    }
                  }}
                >
                  <GripVertical className="h-5 w-5 shrink-0 text-gray-500" aria-hidden />
                  <div className="min-w-0 pointer-events-none">
                    <h3 id="edit-subject-title" className="text-base font-semibold text-white">
                      编辑主体
                    </h3>
                    <p className="text-[11px] text-gray-500 truncate">拖动左侧标题栏移动窗口</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeEditModal}
                  className="shrink-0 px-4 py-3 hover:bg-gray-800 text-gray-400 rounded-tr-2xl"
                  aria-label="关闭"
                >
                  <X size={20} />
                </button>
              </div>
            <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1 min-h-0">
              <div>
                <label className="block text-xs text-gray-500 mb-2">参考图</label>
                <div
                  className={`rounded-xl border-2 border-dashed transition-colors overflow-hidden ${
                    editDragOver ? 'border-brand-400 bg-brand-500/10' : 'border-gray-600 bg-gray-900/50'
                  }`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onDragEnter={(e) => {
                    e.preventDefault();
                    setEditDragOver(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    const rel = e.relatedTarget as Node | null;
                    if (rel && e.currentTarget.contains(rel)) return;
                    setEditDragOver(false);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setEditDragOver(false);
                    const f = pickMediaFile(e.dataTransfer.files);
                    if (f) onPickEditFile(f);
                  }}
                >
                  <label className="flex flex-col items-center justify-center min-h-[160px] w-full cursor-pointer overflow-hidden">
                    {editPreviewSrc ? (
                      editPreviewIsVideo ? (
                        <video src={editPreviewSrc} className="w-full max-h-52 object-contain" muted playsInline />
                      ) : (
                        <img src={editPreviewSrc} alt="" className="w-full max-h-52 object-contain" />
                      )
                    ) : (
                      <div className="py-8 text-gray-500 text-sm">预览加载中…</div>
                    )}
                    <input
                      type="file"
                      accept="image/*,video/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0] ?? null;
                        e.target.value = '';
                        onPickEditFile(f);
                      }}
                    />
                  </label>
                </div>
                <p className="text-[11px] text-gray-600 mt-2">
                  {editNewFile ? '将使用新文件替换原参考图。' : '点击或拖入可替换参考图（可选）'}
                </p>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">主体姓名</label>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="请输入主体名称"
                  className="w-full px-3 py-2 rounded-xl bg-gray-900 border border-gray-700 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">标签</label>
                <select
                  value={editTag}
                  onChange={(e) => setEditTag(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-gray-900 border border-gray-700 text-sm text-gray-200"
                >
                  {editTagPickerOptions.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-800 bg-[#0f131d] shrink-0">
              <button
                type="button"
                onClick={closeEditModal}
                className="px-4 py-2 rounded-lg text-sm border border-gray-600 text-gray-300 hover:bg-gray-800"
              >
                取消
              </button>
              <button
                type="button"
                disabled={editBusy}
                onClick={() => void submitEdit()}
                className="px-4 py-2 rounded-lg text-sm bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-50"
              >
                {editBusy ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
          </div>,
          document.body
        )}
    </>,
    document.body
  );
}
