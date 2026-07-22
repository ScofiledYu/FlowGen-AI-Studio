import React, { memo, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Handle, Position, NodeProps, useReactFlow, useStore, useStoreApi } from 'reactflow';
import { Image as ImageIcon, GripHorizontal, AlertCircle, Loader2, PlayCircle, Film, Maximize2, Upload, Download, FileText, Layers, Ratio, Monitor, Pause, Folder, ChevronRight, FolderOpen, Clock } from 'lucide-react';
import { NodeType, GenerationParams } from '../../types';
import { FLOW_MAX_THUMBNAILS_PER_NODE } from '../../utils/flowLimits';
import { prepareCanvasNodeImagePreview } from '../../utils/imageCompress';
import { createLocalFileObjectUrl } from '../../utils/canvasLocalPreview';
import { resolveUrlForVideoCapture } from '../../utils/videoThumbnail';
import {
  isLikelyVideoMediaUrl,
  isVideoPreviewUrl,
  pickReferenceImagePosterUrl,
} from '../../utils/hydratePersistedNodePreviews';
import { resolveCanvasNodePreviewUrl } from '../../utils/referencedMediaRun';
import { resolvePreferredNodeDownloadUrl } from '../../utils/generatedOutputUrl';
import { remoteMediaUrlPreferSameOriginProxy, resolveDownloadFetchUrl } from '../../utils/remoteMediaFetch';
import { resolveNodeDownloadFilename } from '../../utils/nodeDownloadFilename';
import { buildDownloadTaskFileUrl } from '../../utils/aitopBilling';
import { captureVideoMiddleFrameQueued } from '../../utils/videoPosterQueue';
import { materializePosterDataUrl } from '../../utils/workspaceMediaPersist';
import { startMiddleButtonMediaDrag, isMiddleButtonMediaDragActive } from '../../utils/middleButtonMediaDrag';
import { buildCanvasMiddleDragStartPayload, debugLogCanvasMiddleDragPayload, isAltMiddlePanGesture, resolveCanvasNodeMiddleDragUrl } from '../../utils/canvasMiddleDrag';
import { logMiddleDrag, summarizeMiddleDragUrl } from '../../utils/middleDragDebug';
import {
  canvasPreviewLodImageClass,
  maxThumbnailsForLod,
  resolveLodNodePreviewSrc,
} from '../../utils/canvasPreviewLod';
import {
  CANVAS_REFRESH_PAUSE_EVENT,
  CANVAS_VIEWPORT_MOVING_EVENT,
  getCanvasRefreshPaused,
  getCanvasViewportMoving,
  resolvePreviewLodWithPause,
  resolveVisibleThumbCountWhenPaused,
  selectViewportZoomForNode,
  shouldDeferVideoDecodeWhenPaused,
  shouldRenderNodeThumbnailsWhenPaused,
} from '../../utils/canvasRefreshPause';
import {
  isFlowgenProtectedAssetFileUrl,
  resolveDisplayMediaUrl,
  stripAssetAccessTokenFromUrl,
  withAssetAccessToken,
} from '../../services/flowgenApi';

/** 小缩略图 poster：与 FlowEditor 一致用 captureVideoMiddleFrame（多时间点取亮帧），避免 loadeddata 截到片头黑帧 */
function VideoPoster({
  posterDataUrl,
  fallbackPosterDataUrl,
  src,
  thumbId,
  ownerNodeId,
  onPosterGenerated,
  enableCapture = true,
  className,
  alt = ''
}: {
  posterDataUrl?: string | null;
  fallbackPosterDataUrl?: string | null;
  src?: string;
  thumbId?: string;
  ownerNodeId?: string;
  onPosterGenerated?: (thumbId: string, dataUrl: string) => void;
  enableCapture?: boolean;
  className?: string;
  alt?: string;
}) {
  const toRenderableSrc = useCallback((raw?: string | null) => {
    const base = resolveDisplayMediaUrl(raw);
    if (!base) return '';
    if (/[?&](access_token|token)=/i.test(base)) return base;
    const bare = stripAssetAccessTokenFromUrl(base);
    return isFlowgenProtectedAssetFileUrl(bare) ? withAssetAccessToken(bare) : base;
  }, []);
  const [loadedPoster, setLoadedPoster] = useState<string | null>(null);
  const [captureFailed, setCaptureFailed] = useState(false);
  const fallbackTimerRef = useRef<number | null>(null);

  useEffect(() => {
    // 有 fallback 仍尝试截帧；fallback 仅在截帧失败时展示，避免参考图抢先占位并阻止 capture
    if (!enableCapture || !src || !thumbId || !ownerNodeId || !onPosterGenerated || posterDataUrl) return;
    let cancelled = false;
    setCaptureFailed(false);
    setLoadedPoster(null);
    if (fallbackTimerRef.current != null) {
      window.clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
    // 快速降级：避免 generatedThumbnails 长时间显示灰色占位（与 0327 一致；截帧晚到仍写入 poster，避免列表小图空白）
    fallbackTimerRef.current = window.setTimeout(() => {
      if (!cancelled) setCaptureFailed(true);
    }, 1200);
    captureVideoMiddleFrameQueued(src).then((dataUrl) => {
      if (cancelled) return;
      if (fallbackTimerRef.current != null) {
        window.clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
      if (!dataUrl) {
        setCaptureFailed(true);
        return;
      }
      setLoadedPoster(dataUrl);
      onPosterGenerated(thumbId, dataUrl);
    });
    return () => {
      cancelled = true;
      if (fallbackTimerRef.current != null) {
        window.clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
    };
  }, [src, thumbId, ownerNodeId, onPosterGenerated, posterDataUrl, fallbackPosterDataUrl, enableCapture]);

  const finalPoster = posterDataUrl || loadedPoster || fallbackPosterDataUrl;
  if (finalPoster) {
    return <img src={toRenderableSrc(finalPoster)} alt={alt} className={className} />;
  }
  // 与截帧逻辑一致：跨域 CDN 直连常 403，缩略图区用同源代理拉流，首帧才能显示（否则只能点播放后才解码出画面）
  const fallbackVideoSrc = src ? resolveUrlForVideoCapture(src) : '';

  return (
    <span className="relative block w-full h-full">
      {fallbackVideoSrc ? (
        <>
          <video
            src={toRenderableSrc(fallbackVideoSrc)}
            className="absolute inset-0 w-full h-full object-cover"
            muted
            playsInline
            preload="auto"
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="bg-black/60 rounded-full p-1.5 backdrop-blur-sm border border-white/30">
              <PlayCircle className="w-4 h-4 text-white/80" />
            </div>
          </div>
          {!captureFailed && (
            <div className="absolute right-0.5 top-0.5 bg-black/55 rounded p-0.5 border border-white/20">
              <Loader2 className="w-3 h-3 text-white/70 animate-spin" />
            </div>
          )}
        </>
      ) : (
        <div className="absolute inset-0 bg-gray-600/90 flex items-center justify-center">
          <Loader2 className="w-5 h-5 text-white/80 shrink-0 animate-spin" />
        </div>
      )}
    </span>
  );
}

const THUMBNAIL_INITIAL_RENDER_COUNT = 1;
const THUMBNAIL_REVEAL_BATCH = 1;
const THUMBNAIL_REVEAL_INTERVAL_MS = 220;

function normalizeVideoUrlForMatch(raw?: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (s.startsWith('blob:') || s.startsWith('data:')) return s;
  try {
    if (s.startsWith('/proxy-file?') || s.startsWith('/proxy-image?')) {
      const u0 = new URL(s, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
      const inner = u0.searchParams.get('url') || '';
      if (inner) return normalizeVideoUrlForMatch(inner);
      return `${u0.origin}${u0.pathname}`;
    }
    const u = new URL(s, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    u.searchParams.delete('access_token');
    u.searchParams.delete('token');
    const host = u.host.toLowerCase();
    const path = u.pathname.replace(/\/+$/g, '');
    const qs = u.searchParams.toString();
    return `${u.protocol}//${host}${path}${qs ? `?${qs}` : ''}`;
  } catch {
    return s.replace(/[?&](access_token|token)=[^&]*/gi, '').replace(/[?&]$/g, '');
  }
}

function normalizeLegacyThumbVideoUrl(raw?: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    const path = u.pathname.toLowerCase();
    if (path === '/proxy-image') {
      const inner = (u.searchParams.get('url') || '').trim();
      if (!inner) return s;
      const looksLikeVideo =
        /\.(mov|mp4|webm|avi|mkv|flv|wmv|m4v)(\?|$)/i.test(inner) ||
        /mime_type=video/i.test(inner) ||
        /\/video\//i.test(inner);
      if (looksLikeVideo) return `/proxy-file?url=${encodeURIComponent(inner)}`;
    }
  } catch {
    // ignore and fallback
  }
  return s;
}

// --- MAIN NODE COMPONENT ---
const CustomNode = ({ id, data, type, selected }: NodeProps) => {
  const { setNodes, getNodes } = useReactFlow();
  const storeApi = useStoreApi();
  const [isDragOver, setIsDragOver] = useState(false);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [nodeVideoSrc, setNodeVideoSrc] = useState('');
  const nodeVideoFallbackTriedRef = useRef(false);
  const [visibleThumbCount, setVisibleThumbCount] = useState(THUMBNAIL_INITIAL_RENDER_COUNT);
  const [isDragPerformanceMode, setIsDragPerformanceMode] = useState(false);
  const [isCanvasRefreshPaused, setIsCanvasRefreshPaused] = useState(() => getCanvasRefreshPaused());
  const [isCanvasViewportMoving, setIsCanvasViewportMoving] = useState(() => getCanvasViewportMoving());
  const [lodPreviewFallbackFile, setLodPreviewFallbackFile] = useState(false);
  const localImageInputRef = useRef<HTMLInputElement>(null);

  const isInput = type === NodeType.INPUT;
  const isProcessor = type === NodeType.PROCESSOR;
  const isOutput = type === NodeType.OUTPUT;
  const isMov = type === NodeType.MOV;

  // 节点锚点可视化规则：
  // 1) “没连线”的节点把锚点设为透明（DOM 仍保留），避免 ReactFlow 边端点计算错位。
  // 2) 左右锚点样式保持一致。
  // 仅订阅与本节点相关的连线布尔值，避免「任一边变化 → 全图每个节点重渲染」
  const hasIncoming = useStore((s) => {
    for (const e of s.edges) {
      if (e.target === id) return true;
    }
    return false;
  });
  const hasOutgoing = useStore((s) => {
    for (const e of s.edges) {
      if (e.source === id) return true;
    }
    return false;
  });
  /** 暂停刷新时非选中节点固定 zoom 常量，避免缩放触发全图重渲染 */
  const viewportZoom = useStore((s) =>
    selectViewportZoomForNode(
      s.transform[2],
      isCanvasRefreshPaused,
      selected,
      isCanvasViewportMoving
    )
  );
  const previewLod = useMemo(
    () =>
      resolvePreviewLodWithPause(
        viewportZoom,
        selected,
        isCanvasRefreshPaused,
        isCanvasViewportMoving
      ),
    [viewportZoom, selected, isCanvasRefreshPaused, isCanvasViewportMoving]
  );
  useEffect(() => {
    setLodPreviewFallbackFile(false);
  }, [data.imagePreview, previewLod]);

  // Use generationParams for display if available (Snapshot of creation), otherwise use current data
  const displayParams: GenerationParams = data.generationParams || data;

  // --- Drag & Drop Handlers for Node ---
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation(); // Stop propagation to prevent canvas drop
    
    // Visual feedback logic
    if (event.dataTransfer.types.some(t => t === 'Files' || t === 'application/flowgen/image' || t === 'application/flowgen/images')) {
        event.dataTransfer.dropEffect = 'copy';
        setIsDragOver(true);
    }
  }, []);

  const onDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);
  }, []);

  const applyLocalMediaFile = useCallback(
    (file: File) => {
      const isImage = file.type.startsWith('image/');
      const isVideo = file.type.startsWith('video/');
      if (!isImage && !(isMov && isVideo)) return;

      const registerOriginal = () =>
        window.dispatchEvent(
          new CustomEvent('flowgen:register-original-image', { detail: { nodeId: id, file, type: 'main' } })
        );

      if (isVideo) {
        const objectUrl = URL.createObjectURL(file);
        setNodes((nds) =>
          nds.map((n) =>
            n.id === id
              ? { ...n, data: { ...n.data, imagePreview: objectUrl, imageName: file.name } }
              : n
          )
        );
        registerOriginal();
        return;
      }

      const objectUrl = createLocalFileObjectUrl(file);
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== id) return n;
          const next = {
            ...n.data,
            imagePreview: objectUrl,
            imageName: file.name,
          } as typeof n.data & { projectAssetId?: string };
          delete next.projectAssetId;
          return { ...n, data: next };
        })
      );
      registerOriginal();
    },
    [id, isMov, setNodes]
  );

  const openLocalMediaPicker = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    localImageInputRef.current?.click();
  }, []);

  const onLocalMediaInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (file) applyLocalMediaFile(file);
    },
    [applyLocalMediaFile]
  );

  const canPickLocalMedia = isInput || isProcessor || isOutput || isMov;
  const showEmptyPickLocal = !data.imagePreview && canPickLocalMedia && data.status !== 'running';
  const storyboardShotPreviewText = (data.storyboardShotPreviewText || '').trim();

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation(); // Prevent creating a new node on canvas
    setIsDragOver(false);

    let newImage = '';
    let newName = '';

    // 1. Handle Internal Drag (from Sidebar) - Multi-Image Check
    // TRY WINDOW FIRST
    let images: string[] = (window as any).__flowGenDragImages || [];
    
    if (images.length === 0) {
        const internalImagesStr = event.dataTransfer.getData('application/flowgen/images');
        if (internalImagesStr) {
            try { images = JSON.parse(internalImagesStr) as string[]; } catch(e) {}
        }
    }
    
    if (images && images.length > 0) {
        // If dropping multiple on a single node, just take the first one
        newImage = images[0];
        newName = 'Ref_Image_Multi.png';
    }
    
    // Legacy single image check
    const internalImage = event.dataTransfer.getData('application/flowgen/image');
    if (!newImage && internalImage) {
        newImage = internalImage;
        newName = 'Ref_Image.png';
    }

    // 2. Handle External File Drag (from Desktop)
    if (!newImage && event.dataTransfer.files && event.dataTransfer.files.length > 0) {
        applyLocalMediaFile(event.dataTransfer.files[0]);
        return;
    }

    // Apply internal image update (optionally compress if large to avoid re-storing huge base64)
    if (newImage) {
        const apply = (img: string) => {
            setNodes((nds) => nds.map((n) => {
                if (n.id === id) {
                    return { ...n, data: { ...n.data, imagePreview: img, imageName: newName } };
                }
                return n;
            }));
        };
        void prepareCanvasNodeImagePreview(newImage)
          .then(apply)
          .catch(() => apply(newImage));
    }
  }, [id, setNodes, applyLocalMediaFile]);

  const handleDownload = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    const src = data.imagePreview;
    if (!src) return;

    const filename = resolveNodeDownloadFilename(data, {
      nodeType: type,
      nodeId: id,
      imagePreview: src,
      urlFallback: src,
    });
    const triggerBlobDownload = (blob: Blob, name: string) => {
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = name;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    };
    const latestTaskId = String(data.taskId || data.generationParams?.taskId || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .pop();

    const preferredUrl = resolvePreferredNodeDownloadUrl(data, type as NodeType) || src;

    try {
      // 优先节点已持久化成品 URL（与画布一致），避免 task 返回 openApi 低分辨率链
      if (preferredUrl) {
        try {
          const fetchUrl = resolveDownloadFetchUrl(preferredUrl);
          if (fetchUrl.startsWith('data:') || fetchUrl.startsWith('blob:')) {
            const directResp = await fetch(fetchUrl);
            if (!directResp.ok) throw new Error(`Direct source fetch failed: ${directResp.status}`);
            triggerBlobDownload(await directResp.blob(), filename);
            return;
          }
          if (fetchUrl.startsWith('/proxy-file?') || remoteMediaUrlPreferSameOriginProxy(fetchUrl)) {
            const proxyTarget = fetchUrl.startsWith('/')
              ? fetchUrl
              : `/proxy-file?url=${encodeURIComponent(fetchUrl)}`;
            const proxyResp = await fetch(proxyTarget);
            if (!proxyResp.ok) throw new Error(`Proxy download failed: ${proxyResp.status}`);
            const proxyBlob = await proxyResp.blob();
            if (!proxyBlob.size) throw new Error('Proxy returned empty file');
            triggerBlobDownload(proxyBlob, filename);
            return;
          }
          const response = await fetch(fetchUrl, {
            mode: fetchUrl.startsWith('/') ? 'same-origin' : 'cors',
            credentials: 'omit',
            cache: 'no-cache',
          });
          if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
          triggerBlobDownload(await response.blob(), filename);
          return;
        } catch {
          /* 回退 taskId */
        }
      }

      // 有 taskId 时走服务端 task 下载（签名过期时兜底）
      if (latestTaskId) {
        const taskResp = await fetch(buildDownloadTaskFileUrl(latestTaskId));
        if (taskResp.ok) {
          const taskBlob = await taskResp.blob();
          if (taskBlob.size > 0) {
            triggerBlobDownload(taskBlob, filename);
            return;
          }
        }
      }

      const fetchUrl = resolveDownloadFetchUrl(preferredUrl);

      // data/blob URL 可直接下载
      if (fetchUrl.startsWith('data:') || fetchUrl.startsWith('blob:')) {
        const directResp = await fetch(fetchUrl);
        if (!directResp.ok) throw new Error(`Direct source fetch failed: ${directResp.status}`);
        const directBlob = await directResp.blob();
        triggerBlobDownload(directBlob, filename);
        return;
      }

      // 对象存储等无 CORS：直接同源代理，避免控制台 CORS 报错与无效直连
      if (fetchUrl.startsWith('/proxy-file?') || remoteMediaUrlPreferSameOriginProxy(fetchUrl)) {
        const proxyTarget = fetchUrl.startsWith('/')
          ? fetchUrl
          : `/proxy-file?url=${encodeURIComponent(fetchUrl)}`;
        const proxyResp = await fetch(proxyTarget);
        if (!proxyResp.ok) throw new Error(`Proxy download failed: ${proxyResp.status}`);
        const proxyBlob = await proxyResp.blob();
        if (!proxyBlob.size) throw new Error('Proxy returned empty file');
        triggerBlobDownload(proxyBlob, filename);
        return;
      }
      try {
        const response = await fetch(fetchUrl, {
          mode: fetchUrl.startsWith('/') ? 'same-origin' : 'cors',
          credentials: 'omit',
          cache: 'no-cache',
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        triggerBlobDownload(blob, filename);
        return;
      } catch {
        const proxyUrl = `/proxy-file?url=${encodeURIComponent(fetchUrl)}`;
        const proxyResp = await fetch(proxyUrl);
        if (!proxyResp.ok) {
          throw new Error(`Proxy download failed: ${proxyResp.status}`);
        }
        const proxyBlob = await proxyResp.blob();
        if (!proxyBlob.size) throw new Error('Proxy returned empty file');
        triggerBlobDownload(proxyBlob, filename);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`下载失败：${msg}\n请稍后重试；若持续失败，可能是源站链接已失效。`);
    }
  }, [data, type, id]);

  const isVideoUrl = useCallback(
    (url: string | undefined): boolean =>
      isLikelyVideoMediaUrl(url, { nodeType: type, imageName: data.imageName }),
    [type, data.imageName]
  );

  const beginCanvasMiddleDrag = useCallback(
    (e: React.MouseEvent | React.PointerEvent) => {
      if (e.button !== 1 || isMiddleButtonMediaDragActive()) return;
      if (isAltMiddlePanGesture(e.nativeEvent)) return;
      const previewUrl = resolveCanvasNodeMiddleDragUrl(data, type);
      if (!previewUrl) {
        logMiddleDrag('canvas:pointerdown:skip-no-preview-url', {
          nodeId: id,
          imageName: data.imageName,
          hasImagePreview: Boolean(data.imagePreview),
        });
        return;
      }
      const allNodes = storeApi.getState().getNodes?.() ?? getNodes();
      const payload = buildCanvasMiddleDragStartPayload({
        allNodes,
        sourceNodeId: id,
        sourceData: data,
      });
      if (!payload) {
        logMiddleDrag('canvas:pointerdown:skip-no-payload', {
          nodeId: id,
          previewUrl: summarizeMiddleDragUrl(previewUrl),
        });
        return;
      }
      debugLogCanvasMiddleDragPayload({ sourceNodeId: id, allNodes, payload });
      logMiddleDrag('canvas:pointerdown:start', {
        nodeId: id,
        x: e.clientX,
        y: e.clientY,
        previewUrl: summarizeMiddleDragUrl(previewUrl),
      });
      e.preventDefault();
      e.stopPropagation();
      startMiddleButtonMediaDrag(e as React.PointerEvent, payload);
    },
    [data, getNodes, id, storeApi]
  );

  const handleNodeMiddleDragStart = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 1) return;
      if (isAltMiddlePanGesture(e.nativeEvent)) return;
      const target = e.target as Element;
      if (target.closest('.nodrag, button, a, input, textarea, select, [role="combobox"]')) return;
      beginCanvasMiddleDrag(e);
    },
    [beginCanvasMiddleDrag]
  );

  // ????????
  const handleVideoPlay = useCallback(() => {
    setIsVideoPlaying(true);
  }, []);

  const handleVideoPause = useCallback(() => {
    setIsVideoPlaying(false);
  }, []);

  const handleVideoEnded = useCallback(() => {
    setIsVideoPlaying(false);
  }, []);

  /** 按视口缩放 LOD：远=占位 / 资产 thumb，近=清晰原图（含 access_token） */
  const canvasMainPreviewUrl = useMemo(
    () => resolveCanvasNodePreviewUrl(data),
    [
      data.imagePreview,
      data.panelMainImageUrl,
      data.referenceImages,
      data.referenceImageLabels,
      data.generationParams,
      data.panelMainSlotVisible,
      data.prompt,
      data.selectedModel,
      data.modelConfigs,
      data.taskId,
    ]
  );
  const displayImagePreview = useMemo(
    () => resolveLodNodePreviewSrc(canvasMainPreviewUrl ? String(canvasMainPreviewUrl) : '', previewLod),
    [canvasMainPreviewUrl, previewLod]
  );
  const mainPreviewSrc = useMemo(() => {
    if (!lodPreviewFallbackFile || previewLod !== 'low' || !canvasMainPreviewUrl) {
      return displayImagePreview || (canvasMainPreviewUrl ? String(canvasMainPreviewUrl) : '');
    }
    return resolveLodNodePreviewSrc(String(canvasMainPreviewUrl), 'high');
  }, [displayImagePreview, canvasMainPreviewUrl, lodPreviewFallbackFile, previewLod]);
  const previewLodImageClass = canvasPreviewLodImageClass(previewLod);
  // 主预览为视频 URL 时（含 processor 上误写的 mp4）：走 <video> + 代理，避免 <img> 裂图
  const mainVideoUrl =
    displayImagePreview &&
    isLikelyVideoMediaUrl(displayImagePreview, { nodeType: type, imageName: data.imageName })
      ? displayImagePreview
      : '';
  const mainVideoDisplaySrc = mainVideoUrl ? resolveUrlForVideoCapture(mainVideoUrl) : '';
  const toRenderableSrc = useCallback((raw?: string | null) => {
    const base = resolveDisplayMediaUrl(raw);
    if (!base) return '';
    if (/[?&](access_token|token)=/i.test(base)) return base;
    const bare = stripAssetAccessTokenFromUrl(base);
    return isFlowgenProtectedAssetFileUrl(bare) ? withAssetAccessToken(bare) : base;
  }, []);
  /** 刷新后 data: 封面被剥离；用参考图 https 先顶上，截帧完成后再换 videoPosterDataUrl */
  const referencePosterUrl = useMemo(
    () => pickReferenceImagePosterUrl(data as Record<string, unknown>),
    [data.referenceImages, data.jimengImages, data.generationParams]
  );
  const normPosterKey = (u: string) =>
    u.split('#')[0].split('?')[0].replace(/\/+$/, '').toLowerCase();
  const referenceImagePosterKeys = useMemo(() => {
    const keys = new Set<string>();
    const push = (u?: string) => {
      if (!u || typeof u !== 'string') return;
      const k = normPosterKey(u.trim());
      if (k) keys.add(k);
    };
    for (const u of data.referenceImages || []) push(u);
    for (const u of data.jimengImages || []) push(u);
    const gp = data.generationParams as { referenceImages?: string[]; jimengImages?: string[] } | undefined;
    for (const u of gp?.referenceImages || []) push(u);
    for (const u of gp?.jimengImages || []) push(u);
    return keys;
  }, [data.referenceImages, data.jimengImages, data.generationParams]);
  /** generated outputs 小缩略图：拒绝把参考图/首尾帧误当作视频 poster */
  const isReferenceLikePoster = useCallback(
    (posterUrl?: string | null): boolean => {
      if (!posterUrl || typeof posterUrl !== 'string') return false;
      const k = normPosterKey(posterUrl.trim());
      if (!k) return false;
      if (referenceImagePosterKeys.has(k)) return true;
      const gp = data.generationParams as
        | {
            firstFrameImage?: string;
            firstFrameImageUrl?: string;
            lastFrameImage?: string;
            lastFrameImageUrl?: string;
          }
        | undefined;
      const frameUrls = [
        data.firstFrameImage,
        data.firstFrameImageUrl,
        data.lastFrameImage,
        data.lastFrameImageUrl,
        gp?.firstFrameImage,
        gp?.firstFrameImageUrl,
        gp?.lastFrameImage,
        gp?.lastFrameImageUrl,
      ];
      for (const u of frameUrls) {
        if (u && normPosterKey(String(u)) === k) return true;
      }
      return false;
    },
    [
      referenceImagePosterKeys,
      data.firstFrameImage,
      data.firstFrameImageUrl,
      data.lastFrameImage,
      data.lastFrameImageUrl,
      data.generationParams,
    ]
  );
  const resolveGeneratedThumbPoster = useCallback(
    (posterDataUrl?: string | null) => {
      const p = typeof posterDataUrl === 'string' ? posterDataUrl.trim() : '';
      if (!p) return undefined;
      return p;
    },
    []
  );
  // MOV：有生成结果视频时只用截帧 poster，不用参考图顶替（截帧前走 <video> + 异步 capture）
  const mainPosterSrc = useMemo(() => {
    const vp = typeof data.videoPosterDataUrl === 'string' ? data.videoPosterDataUrl.trim() : '';
    if (vp) return vp;
    if (isMov && mainVideoUrl) return undefined;
    return referencePosterUrl;
  }, [
    data.videoPosterDataUrl,
    isMov,
    mainVideoUrl,
    referencePosterUrl
  ]);
  const deferVideoDecode = shouldDeferVideoDecodeWhenPaused(
    isCanvasRefreshPaused,
    selected,
    !!mainPosterSrc,
    isVideoPlaying
  );
  useEffect(() => {
    const onDragPerfMode = (event: Event) => {
      const customEvent = event as CustomEvent<{ active?: boolean }>;
      setIsDragPerformanceMode(Boolean(customEvent.detail?.active));
    };
    window.addEventListener('flowgen:drag-perf-mode', onDragPerfMode as EventListener);
    return () => {
      window.removeEventListener('flowgen:drag-perf-mode', onDragPerfMode as EventListener);
    };
  }, []);
  useEffect(() => {
    const onCanvasRefreshPaused = (event: Event) => {
      const customEvent = event as CustomEvent<{ active?: boolean }>;
      setIsCanvasRefreshPaused(Boolean(customEvent.detail?.active));
    };
    window.addEventListener(CANVAS_REFRESH_PAUSE_EVENT, onCanvasRefreshPaused as EventListener);
    return () => {
      window.removeEventListener(CANVAS_REFRESH_PAUSE_EVENT, onCanvasRefreshPaused as EventListener);
    };
  }, []);
  useEffect(() => {
    const onViewportMoving = (event: Event) => {
      const customEvent = event as CustomEvent<{ active?: boolean }>;
      setIsCanvasViewportMoving(Boolean(customEvent.detail?.active));
    };
    window.addEventListener(CANVAS_VIEWPORT_MOVING_EVENT, onViewportMoving as EventListener);
    return () => {
      window.removeEventListener(CANVAS_VIEWPORT_MOVING_EVENT, onViewportMoving as EventListener);
    };
  }, []);
  useEffect(() => {
    if (!mainVideoUrl) {
      setNodeVideoSrc('');
      return;
    }
    nodeVideoFallbackTriedRef.current = false;
    // 默认优先同源代理；播放失败时再回退原始直链
    setNodeVideoSrc(mainVideoDisplaySrc || mainVideoUrl);
  }, [mainVideoDisplaySrc, mainVideoUrl]);
  useEffect(() => {
    if (isDragPerformanceMode && isVideoPlaying) {
      videoRef.current?.pause();
      setIsVideoPlaying(false);
    }
  }, [isDragPerformanceMode, isVideoPlaying]);

  const playNodeVideoWithFallback = useCallback(async () => {
    if (!videoRef.current) return;
    try {
      await videoRef.current.play();
      return;
    } catch {
      if (mainVideoUrl && nodeVideoSrc !== mainVideoUrl) {
        nodeVideoFallbackTriedRef.current = true;
        setNodeVideoSrc(mainVideoUrl);
        requestAnimationFrame(() => {
          videoRef.current?.play().catch(() => {});
        });
      }
    }
  }, [mainVideoUrl, nodeVideoSrc]);

  // 从正在播放的 <video> 元素直接截当前帧；用于“用户已播放但 URL 截帧失败”的兜底回填
  const capturePosterFromPlayingElement = useCallback((): string | null => {
    const v = videoRef.current;
    if (!v) return null;
    if (v.videoWidth <= 0 || v.videoHeight <= 0) return null;
    try {
      const MAX_OUT_DIM = 640;
      const srcW = Math.max(1, v.videoWidth);
      const srcH = Math.max(1, v.videoHeight);
      const scale = Math.min(1, MAX_OUT_DIM / Math.max(srcW, srcH));
      const outW = Math.max(1, Math.round(srcW * scale));
      const outH = Math.max(1, Math.round(srcH * scale));
      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(v, 0, 0, outW, outH);
      return canvas.toDataURL('image/jpeg', 0.85);
    } catch {
      return null;
    }
  }, []);

  /**
   * 将当前节点视频封面同步到：
   * 1) 当前节点 data.videoPosterDataUrl
   * 2) 其他节点 generatedThumbnails 中指向当前节点(nodeId===id)的视频项
   */
  const applyCapturedPosterAcrossGraph = useCallback(
    (posterUrl: string) => {
      const mainUrl = (mainVideoUrl || '').trim();
      const mainUrlKey = normalizeVideoUrlForMatch(mainUrl);
      setNodes((nds) =>
        nds.map((n) => {
          let changed = false;
          let nextData = n.data;
          const nodePreviewKey = normalizeVideoUrlForMatch(String(nextData.imagePreview || ''));
          const shouldPatchNodePoster =
            n.id === id || (!!mainUrlKey && nodePreviewKey === mainUrlKey);
          if (shouldPatchNodePoster && nextData.videoPosterDataUrl !== posterUrl) {
            nextData = { ...nextData, videoPosterDataUrl: posterUrl };
            changed = true;
          }
          if (Array.isArray(nextData.generatedThumbnails) && nextData.generatedThumbnails.length > 0) {
            let thumbsChanged = false;
            const thumbs = nextData.generatedThumbnails.map((t) => {
              if (t.type !== 'video') return t;
              const byNodeId = String(t.nodeId || '') === id;
              const byVideoUrl =
                !!mainUrlKey &&
                normalizeVideoUrlForMatch(String(t.url || '')) === mainUrlKey;
              const byCurrentNodeFallback = n.id === id && !t.posterDataUrl;
              if (!byNodeId && !byVideoUrl && !byCurrentNodeFallback) return t;
              if (t.posterDataUrl === posterUrl) return t;
              thumbsChanged = true;
              return { ...t, posterDataUrl: posterUrl };
            });
            if (thumbsChanged) {
              nextData = { ...nextData, generatedThumbnails: thumbs };
              changed = true;
            }
          }
          return changed ? { ...n, data: nextData } : n;
        })
      );
    },
    [id, mainVideoUrl, setNodes]
  );

  // 播放/暂停（与 0327 参考工程一致：<video> 始终挂载，用透明度隐藏，避免条件挂载导致 ref/play 异常）
  const handleVideoPlayPause = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (isVideoPlaying) {
      videoRef.current?.pause();
      setIsVideoPlaying(false);
    } else {
      setIsVideoPlaying(true);
      void playNodeVideoWithFallback();
    }
  }, [isVideoPlaying, playNodeVideoWithFallback]);

  // ??poster ????????setIsVideoPlaying(true)?video ????????????? play
  useEffect(() => {
    if (!isVideoPlaying || !isMov || !isVideoUrl(data.imagePreview)) return;
    const playWhenReady = () => {
      if (videoRef.current) {
        void playNodeVideoWithFallback();
        return true;
      }
      return false;
    };
    if (!playWhenReady()) {
      const t = setTimeout(playWhenReady, 50);
      return () => clearTimeout(t);
    }
  }, [isVideoPlaying, isMov, data.imagePreview, playNodeVideoWithFallback]);

  // 大图 poster：只要是 MOV 且当前没有 poster，就截帧写回（与 0327 一致，保证“至少有一张缩略图”）
  useEffect(() => {
    if (!mainVideoUrl || data.videoPosterDataUrl || isDragPerformanceMode || isCanvasRefreshPaused) return;
    let cancelled = false;
    captureVideoMiddleFrameQueued(mainVideoUrl).then(async (poster) => {
      if (cancelled || !poster) return;
      const m = typeof window !== 'undefined' ? window.location.hash.match(/\/workspace\/([^/?#]+)/) : null;
      const stored = await materializePosterDataUrl(poster, m?.[1]);
      const finalPoster = stored || poster;
      if (cancelled) return;
      applyCapturedPosterAcrossGraph(finalPoster);
      setTimeout(() => window.dispatchEvent(new CustomEvent('flowgen:persist-request')), 300);
    });
    return () => {
      cancelled = true;
    };
  }, [mainVideoUrl, data.videoPosterDataUrl, isDragPerformanceMode, isCanvasRefreshPaused, applyCapturedPosterAcrossGraph]);

  /**
   * 用户点播放后，强制再尝试一次“由当前视频截图”覆盖封面：
   * 即便前面兜底显示了首帧/参考图，也会在可截帧时替换成视频帧，保证最终缩略图来源是视频本身。
   */
  useEffect(() => {
    if (!isVideoPlaying || !mainVideoUrl || isCanvasRefreshPaused) return;
    let cancelled = false;
    const run = async () => {
      // 优先从已播放的视频元素抓帧（最贴近用户当下看到的画面）
      for (let i = 0; i < 4; i++) {
        if (cancelled) return;
        if (i > 0) await new Promise((r) => setTimeout(r, 380));
        const direct = capturePosterFromPlayingElement();
        if (!direct) continue;
        const m = typeof window !== 'undefined' ? window.location.hash.match(/\/workspace\/([^/?#]+)/) : null;
        const storedDirect = await materializePosterDataUrl(direct, m?.[1]);
        const finalDirectPoster = storedDirect || direct;
        if (cancelled) return;
        applyCapturedPosterAcrossGraph(finalDirectPoster);
        setTimeout(() => window.dispatchEvent(new CustomEvent('flowgen:persist-request')), 300);
        return;
      }

      // 元素抓帧失败时，再走 URL 截帧队列
      const poster = await captureVideoMiddleFrameQueued(mainVideoUrl);
      if (cancelled || !poster) return;
      const m = typeof window !== 'undefined' ? window.location.hash.match(/\/workspace\/([^/?#]+)/) : null;
      const stored = await materializePosterDataUrl(poster, m?.[1]);
      const finalPoster = stored || poster;
      if (cancelled) return;
      applyCapturedPosterAcrossGraph(finalPoster);
      setTimeout(() => window.dispatchEvent(new CustomEvent('flowgen:persist-request')), 300);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [isVideoPlaying, mainVideoUrl, isCanvasRefreshPaused, applyCapturedPosterAcrossGraph, capturePosterFromPlayingElement]);

  // 旧节点兼容：只要选中视频节点就主动尝试截帧，不依赖“节点卡片内播放态”
  useEffect(() => {
    if (!selected || !mainVideoUrl || isCanvasRefreshPaused) return;
    let cancelled = false;
    const run = async () => {
      const waits = [0, 1200, 2600];
      for (const w of waits) {
        if (cancelled) return;
        if (w > 0) await new Promise((r) => setTimeout(r, w));
        const poster = await captureVideoMiddleFrameQueued(mainVideoUrl);
        if (!poster) continue;
        const m = typeof window !== 'undefined' ? window.location.hash.match(/\/workspace\/([^/?#]+)/) : null;
        const stored = await materializePosterDataUrl(poster, m?.[1]);
        const finalPoster = stored || poster;
        if (cancelled) return;
        applyCapturedPosterAcrossGraph(finalPoster);
        setTimeout(() => window.dispatchEvent(new CustomEvent('flowgen:persist-request')), 300);
        return;
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [selected, mainVideoUrl, isCanvasRefreshPaused, applyCapturedPosterAcrossGraph]);

  // ??????? poster ??? generatedThumbnails
  const handleThumbPosterGenerated = useCallback((thumbId: string, dataUrl: string) => {
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id !== id) return n;
        const thumbs = (n.data.generatedThumbnails || []).map((t) =>
          t.id === thumbId ? { ...t, posterDataUrl: dataUrl } : t
        );
        return { ...n, data: { ...n.data, generatedThumbnails: thumbs } };
      })
    );
    setTimeout(() => window.dispatchEvent(new CustomEvent('flowgen:persist-request')), 300);
  }, [id, setNodes]);

  // INPUT/PROCESSOR/OUTPUT/MOV 都允许展示 generated outputs（与 0327 一致）；条数上限仅裁剪渲染
  const thumbnailsForUi = (data.generatedThumbnails || []).slice(0, FLOW_MAX_THUMBNAILS_PER_NODE);
  const totalThumbnailCount = data.generatedThumbnails?.length || 0;
  const shouldShowThumbTotalSuffix = totalThumbnailCount > FLOW_MAX_THUMBNAILS_PER_NODE;
  const thumbCountLabel = `Generated Outputs (${thumbnailsForUi.length}${
    shouldShowThumbTotalSuffix ? ` / ${totalThumbnailCount}` : ''
  })`;
  // 仅随缩略图条数变化重置揭示进度；勿依赖 isDragPerformanceMode，否则拖拽开始会清空定时器并把 count 置 1，
  // 松手后易与分批揭示状态错乱，表现为「放手后缩略图有时不出来」。
  useEffect(() => {
    const total = thumbnailsForUi.length;
    if (isCanvasRefreshPaused) {
      setVisibleThumbCount(
        resolveVisibleThumbCountWhenPaused(
          total,
          true,
          selected,
          THUMBNAIL_INITIAL_RENDER_COUNT
        )
      );
      return;
    }
    if (total <= THUMBNAIL_INITIAL_RENDER_COUNT) {
      setVisibleThumbCount(total);
      return;
    }
    setVisibleThumbCount(THUMBNAIL_INITIAL_RENDER_COUNT);
    let cancelled = false;
    let timerId = 0;
    const reveal = () => {
      if (cancelled) return;
      setVisibleThumbCount((prev) => {
        if (prev >= total) return prev;
        const next = Math.min(prev + THUMBNAIL_REVEAL_BATCH, total);
        if (next < total) {
          timerId = window.setTimeout(reveal, THUMBNAIL_REVEAL_INTERVAL_MS);
        }
        return next;
      });
    };
    timerId = window.setTimeout(reveal, THUMBNAIL_REVEAL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timerId) window.clearTimeout(timerId);
    };
  }, [thumbnailsForUi.length, isCanvasRefreshPaused, selected]);
  const visibleThumbnailsForUi = thumbnailsForUi.slice(0, visibleThumbCount);
  const hasThumbnails =
    (isInput || isProcessor || isOutput || isMov) &&
    !!data.generatedThumbnails &&
    data.generatedThumbnails.length > 0;
  /** 与旧版一致：拖动/平移时仍渲染主预览与缩略图（MiniMap 导航与拖入立即可见） */
  const shouldRenderRichPreview = !!data.imagePreview;
  const previewAreaRef = useRef<HTMLDivElement>(null);
  const shouldRenderThumbnails = shouldRenderNodeThumbnailsWhenPaused(
    hasThumbnails,
    previewLod,
    isCanvasRefreshPaused,
    selected
  );
  const lodMaxThumbCount = maxThumbnailsForLod(previewLod, thumbnailsForUi.length);
  const visibleThumbnailsLod = visibleThumbnailsForUi.slice(0, lodMaxThumbCount);
  // 极端场景防护：限制同节点同时触发视频截帧的数量，避免解码风暴导致崩溃
  const maxCaptureThumbs = 3;
  let captureSlotsLeft = maxCaptureThumbs;

  const chainFolderChildIds = data.chainFolderChildIds || [];
  const chainFolderLabel = data.chainFolderLabel || ((isMov || isOutput) ? '上游' : '下游');
  const hasChainFolderStrip =
    (isInput || isProcessor || isMov || isOutput) &&
    chainFolderChildIds.length > 0 &&
    data.chainFolderExpanded !== true;

  const expandChainFolderFromNode = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      window.dispatchEvent(
        new CustomEvent('flowgen:expand-chain-folder', { detail: { rootId: id } })
      );
    },
    [id]
  );

  const defaultBorderClass =
    data.status === 'error'
      ? 'border-red-500'
      : data.scheduledRunQueued
        ? 'border-amber-400 hover:border-amber-300 ring-2 ring-amber-400/40'
        : data.spawnHighlight === 'green'
        ? 'border-green-500 hover:border-green-400'
        : data.spawnHighlight === 'yellow'
          ? 'border-yellow-500 hover:border-yellow-400'
          : data.spawnHighlight === 'red'
            ? 'border-red-500 hover:border-red-400'
          : 'border-gray-800 hover:border-gray-700';

  const scheduledQueued = data.scheduledRunQueued === true;

  return (
    <div 
      className={`
        relative w-[200px] bg-gray-950 rounded-xl border-2 shadow-xl flex flex-col overflow-visible group transition-all duration-300
        ${selected ? `border-brand-500 ring-4 ring-brand-500/20${scheduledQueued ? ' shadow-[inset_0_0_0_2px_rgba(251,191,36,0.55)]' : ''}` : defaultBorderClass}
        ${isDragOver ? '!border-brand-400 !ring-4 !ring-brand-400/50 scale-105 z-50' : ''}
      `}
      data-flowgen-media-drop="1"
      data-flowgen-node-id={id}
      data-flowgen-drop-zone="node-main"
      onMouseDownCapture={handleNodeMiddleDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Input Handle */}
      {!isInput && (
        <Handle
          type="target"
          position={Position.Left}
          className={`!bg-brand-500 !border-2 !border-white !w-3.5 !h-3.5 transition-transform hover:scale-125 ${
            hasIncoming ? '!opacity-100 !pointer-events-auto' : '!opacity-0 !pointer-events-none'
          } !-left-[6px]`}
        />
      )}

      {/* Header (Label) */}
      <div className="absolute top-0 left-0 right-0 z-10 p-2 bg-gradient-to-b from-black/90 via-black/50 to-transparent flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-2">
            <div className={`p-1 rounded backdrop-blur-sm ${selected ? 'bg-brand-500/20 text-brand-400' : 'bg-gray-800/50 text-gray-500'}`}>
              {isMov ? <Film size={12} /> : <GripHorizontal size={12} />}
            </div>
            <span className="text-[10px] font-bold text-white shadow-sm tracking-wide truncate max-w-[120px]">
              {data.customName?.trim() || data.label}
            </span>
            {scheduledQueued && (
              <span
                className="pointer-events-none flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/95 text-amber-950 shadow-sm shrink-0"
                title="已加入定时运行队列"
              >
                <Clock size={10} strokeWidth={2.5} />
                定时
              </span>
            )}
        </div>
      </div>

      {/* Info Strip removed - ???????? detail ????*/}

      {/* Main Storyboard Image — 中键按住并拖到其他节点/侧栏素材区可传递当前预览 URL */}
      <div
        ref={previewAreaRef}
        className="nopan w-full aspect-[4/3] bg-gray-900 flex items-center justify-center overflow-hidden relative"
        onAuxClick={(e) => {
          if (e.button === 1) e.preventDefault();
        }}
      >
        
        {/* Drop Overlay */}
        {isDragOver && (
            <div className="absolute inset-0 z-20 bg-brand-500/40 backdrop-blur-sm flex flex-col items-center justify-center animate-in fade-in duration-200">
                <Upload className="text-white w-8 h-8 mb-2 animate-bounce" />
                <span className="text-xs font-bold text-white drop-shadow-md">Drop to Replace</span>
            </div>
        )}

        {storyboardShotPreviewText ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-slate-800 via-slate-900 to-black text-gray-100 pointer-events-none px-3 text-center">
            <span className="text-[10px] uppercase tracking-[0.22em] text-gray-400 mb-2">镜头号</span>
            <span className="font-mono font-bold text-lg leading-none break-all drop-shadow-[0_2px_8px_rgba(0,0,0,0.55)]">
              {storyboardShotPreviewText}
            </span>
          </div>
        ) : shouldRenderRichPreview && data.imagePreview ? (
          <>
            {/* ??????URL????????*/}
            {mainVideoUrl ? (
              <div className="absolute inset-0">
                {mainPosterSrc && !isVideoPlaying && (
                  <img
                    src={toRenderableSrc(mainPosterSrc)}
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                )}
                {!deferVideoDecode && (
                <video
                  ref={videoRef}
                  src={nodeVideoSrc || mainVideoDisplaySrc || displayImagePreview}
                  className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                  preload={isCanvasRefreshPaused && !selected ? 'none' : 'auto'}
                  onError={() => {
                    // 某些客户端代理链路会返回 500/ECONNRESET；失败时自动退回直链再试一次。
                    if (!mainVideoUrl) return;
                    if (nodeVideoSrc !== mainVideoUrl && !nodeVideoFallbackTriedRef.current) {
                      nodeVideoFallbackTriedRef.current = true;
                      setNodeVideoSrc(mainVideoUrl);
                      return;
                    }
                    setIsVideoPlaying(false);
                  }}
                  onPlay={handleVideoPlay}
                  onPause={handleVideoPause}
                  onEnded={handleVideoEnded}
                  loop={false}
                  muted={false}
                  playsInline
                  style={
                    isVideoPlaying
                      ? { opacity: 1, zIndex: 0 }
                      : mainPosterSrc
                        ? { opacity: 0, zIndex: -1 }
                        : { opacity: 1, zIndex: 0 }
                  }
                />
                )}
                <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
                  <div
                    className={`pointer-events-auto cursor-pointer bg-black/60 rounded-full p-3 backdrop-blur-sm border border-white/30 transition-all hover:bg-brand-500/90 hover:scale-110 ${isVideoPlaying ? 'opacity-50' : 'opacity-100'}`}
                    onClick={handleVideoPlayPause}
                  >
                    {isVideoPlaying ? (
                      <Pause className="text-white w-10 h-10 fill-white/30" />
                    ) : (
                      <PlayCircle className="text-white w-10 h-10 fill-white/30" />
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <>
                <img
                    src={mainPreviewSrc}
                    alt="Node Content"
                    loading={previewLod === 'high' || selected ? 'eager' : 'lazy'}
                    decoding="async"
                    fetchPriority={selected ? 'high' : previewLod === 'low' ? 'low' : 'auto'}
                    onError={() => {
                      if (previewLod === 'low' && !lodPreviewFallbackFile) {
                        setLodPreviewFallbackFile(true);
                      }
                    }}
                    className={`w-full h-full object-cover pointer-events-none ${previewLod === 'high' ? 'transition-transform duration-300 group-hover:scale-105' : ''} ${isMov ? 'opacity-80' : ''} ${previewLodImageClass}`}
                />
                {/* Play Overlay for MOV nodes (when it's an image, not video) */}
                {isMov && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="bg-black/50 rounded-full p-2 backdrop-blur-sm border border-white/20 group-hover:bg-brand-500/80 transition-colors">
                            <PlayCircle className="text-white w-8 h-8 fill-white/20" />
                        </div>
                    </div>
                )}
              </>
            )}
          </>
        ) : data.imagePreview ? (
          <div className="text-gray-600 flex flex-col items-center gap-1 pointer-events-none">
              {isMov ? <Film size={20} /> : <ImageIcon size={20} />}
              <span className="text-[8px] uppercase tracking-wider font-semibold">Preview Deferred</span>
          </div>
        ) : (
          <div className="text-gray-700 flex flex-col items-center gap-2 px-3 pointer-events-auto z-[5]">
              {showEmptyPickLocal && (
                <input
                  ref={localImageInputRef}
                  type="file"
                  accept={isMov ? 'image/*,video/*' : 'image/*'}
                  className="hidden"
                  onChange={onLocalMediaInputChange}
                  onClick={(e) => e.stopPropagation()}
                />
              )}
              <ImageIcon size={20} />
              <span className="text-[8px] uppercase tracking-wider font-semibold">Empty</span>
              {showEmptyPickLocal && (
                <button
                  type="button"
                  onClick={openLocalMediaPicker}
                  className="mt-0.5 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-gray-800/90 border border-gray-600 text-[10px] text-gray-200 hover:bg-brand-600/80 hover:border-brand-500/60 hover:text-white transition-colors shadow-sm"
                  title="从本机选择图片或视频（MOV 节点）"
                >
                  <FolderOpen className="w-3.5 h-3.5 shrink-0" />
                  <span>选择本地文件</span>
                </button>
              )}
              {showEmptyPickLocal && (
                <span className="text-[9px] text-gray-500 text-center leading-snug">或拖入图片到此处</span>
              )}
          </div>
        )}

        {/* Error Overlay */}
        {data.status === 'error' && (
          <div className="absolute inset-0 bg-red-900/80 backdrop-blur-sm flex flex-col items-center justify-center p-2 text-center animate-in fade-in duration-200">
             <AlertCircle className="text-white w-6 h-6 mb-1" />
             <p className="text-[10px] text-white font-medium leading-tight">
               {data.errorMessage || "Generation Failed"}
             </p>
          </div>
        )}

        {/* Running Overlay (Spinner + Progress) */}
        {data.status === 'running' && (
           <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px] flex flex-col items-center justify-center z-20">
              <Loader2 className="w-8 h-8 text-emerald-400 animate-spin mb-2 drop-shadow-[0_0_8px_rgba(52,211,153,0.45)]" />
              <div className="text-[18px] font-mono font-bold text-emerald-300 tabular-nums tracking-tight drop-shadow-[0_0_12px_rgba(16,185,129,0.55),0_2px_8px_rgba(0,0,0,0.85)] bg-emerald-950/80 border border-emerald-400/40 rounded-md px-2.5 py-1">
                {data.progress || 0}%
              </div>
           </div>
        )}
      </div>

      {/* Progress Bar (Visible only when running) */}
      {data.status === 'running' && (
        <div className="h-1 w-full bg-gray-800">
          <div 
            className="h-full bg-emerald-500 transition-all duration-300 ease-out shadow-[0_0_12px_rgba(16,185,129,0.75)]" 
            style={{ width: `${data.progress || 0}%` }}
          />
        </div>
      )}

      {/* Footer Info (Status indicators & Image Name) */}
      <div className="bg-gray-900 border-t border-gray-800 p-2 flex flex-col gap-1.5">
         {/* Top Row: Status + Model + Refs */}
         <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
                <div className={`w-1.5 h-1.5 rounded-full ${data.status === 'running' ? 'bg-emerald-400 animate-pulse shadow-[0_0_6px_rgba(52,211,153,0.7)]' : data.status === 'completed' ? 'bg-green-400' : data.status === 'error' ? 'bg-red-500' : 'bg-gray-600'}`} />
                <span className="text-[9px] text-gray-400 font-semibold font-mono uppercase tracking-tight">
                  {data.selectedModel ? data.selectedModel.split(' ')[0] : 'NANO'}
                </span>
            </div>
            {/* Show count badge if > 1 */}
            {displayParams.numberOfImages && displayParams.numberOfImages !== '1' && (
                <span className="text-[8px] text-purple-400 font-mono bg-purple-400/10 px-1 rounded">{displayParams.numberOfImages}</span>
            )}
         </div>
         
         {/* Bottom Row: Image Name & Action Buttons */}
         <div className="flex items-center justify-between gap-2 border-t border-gray-800/50 pt-1.5 mt-0.5">
             <span className="text-[8px] text-gray-500 font-mono truncate flex-1" title={data.imageName || 'Untitled'}>
               {data.imageName || 'IMG_0000.PNG'}
             </span>
             
             <div className="flex items-center gap-0.5">
                 {/* Download Button */}
                 <button 
                    onClick={handleDownload}
                    className="nodrag p-1 rounded hover:bg-gray-800 text-gray-600 hover:text-brand-400 transition-colors" 
                    title="Download"
                 >
                    <Download size={10} />
                 </button>

                 {/* Expand Button */}
                 <button 
                    className="custom-node-expand-btn nodrag p-1 rounded hover:bg-gray-800 text-gray-600 hover:text-brand-400 transition-colors" 
                    title="View Details"
                 >
                    <Maximize2 size={10} />
                 </button>
             </div>
         </div>
      </div>

      {/* Output Handle - Not for Mov nodes if it's the end of chain, but allow for now just in case */}
      <Handle
        type="source"
        position={Position.Right}
        // MOV 节点需要 source handle（用于视频链路继续“再生视频”时的边起点锚定）
        className={`!bg-brand-500 !border-2 !border-white !w-3.5 !h-3.5 transition-transform hover:scale-125 shadow-[0_0_10px_rgba(99,102,241,0.5)] ${
          hasOutgoing ? '!opacity-100 !pointer-events-auto' : '!opacity-0 !pointer-events-none'
        } !-right-[6px]`}
      />

      {/* Generated Thumbnails：参与文档流高度，避免 absolute 撑不开 RF 节点导致与下一行/折叠条重叠 */}
      {shouldRenderThumbnails && (() => {
        return (
          <div
            className={`relative z-20 w-full mt-1.5 border-t border-gray-800 bg-gray-900/95 backdrop-blur-sm px-2 pt-2 pb-2 ${
              hasChainFolderStrip ? '' : 'rounded-b-lg'
            }`}
          >
            <div className="text-[8px] text-gray-500 mb-1.5 font-semibold uppercase tracking-wider">
              {thumbCountLabel}
            </div>
          <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto overflow-x-hidden pr-0.5">
            {visibleThumbnailsLod.map((thumb) => {
              const thumbVideoSrc = thumb.type === 'video' ? normalizeLegacyThumbVideoUrl(thumb.url) : thumb.url;
              const thumbPoster = resolveGeneratedThumbPoster(thumb.posterDataUrl);
              const needCapture = thumb.type === 'video' && !thumbPoster;
              const enableCapture = needCapture && captureSlotsLeft > 0;
              if (enableCapture) captureSlotsLeft -= 1;
              const handleThumbnailClick = (e: React.MouseEvent) => {
                e.stopPropagation();
                // 始终带上该条历史快照，由 FlowEditor 重建整份 Node Details（非仅换预览）
                window.dispatchEvent(
                  new CustomEvent('flowgen:preview-node', {
                    detail: {
                      sourceNodeId: id,
                      thumb: {
                        id: thumb.id,
                        url: thumb.url,
                        type: thumb.type,
                        nodeId: thumb.nodeId,
                        name: thumb.name,
                        generationParams: thumb.generationParams,
                        posterDataUrl: thumb.posterDataUrl,
                      },
                    },
                  })
                );
              };

              const thumbDisplayName =
                (thumb.name && String(thumb.name).trim()) ||
                (thumb.type === 'video' ? 'Video.mov' : 'Generated.png');
              return (
                <div key={thumb.id} className="w-[58px] shrink-0">
                  <div
                    onClick={handleThumbnailClick}
                    className="relative w-12 h-12 rounded border border-gray-700 hover:border-brand-500 cursor-pointer overflow-hidden group transition-all hover:scale-110 bg-gray-800"
                    title={thumbDisplayName}
                  >
                    {thumb.type === 'video' ? (
                      <>
                        <VideoPoster
                          posterDataUrl={thumbPoster}
                          src={thumbVideoSrc}
                          thumbId={thumb.id}
                          ownerNodeId={id}
                          onPosterGenerated={handleThumbPosterGenerated}
                          enableCapture={enableCapture}
                          className="w-full h-full object-cover"
                          alt=""
                        />
                        {/* ??Output Mov Node ????????????????????????? */}
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <div className="bg-black/60 rounded-full p-1.5 backdrop-blur-sm border border-white/30 group-hover:bg-brand-500/90 transition-all group-hover:scale-110">
                            <PlayCircle className="w-4 h-4 text-white/80" />
                          </div>
                        </div>
                      </>
                    ) : (
                      <img
                        src={toRenderableSrc(thumb.url)}
                        alt="Generated"
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover"
                      />
                    )}
                  </div>
                  <div className="mt-0.5 text-[8px] leading-tight text-gray-300 truncate" title={thumbDisplayName}>
                    {thumbDisplayName}
                  </div>
                </div>
              );
            })}
            {visibleThumbCount < thumbnailsForUi.length && (
              <div className="w-full text-[8px] text-gray-500 px-0.5 pt-0.5">
                正在分批加载缩略图... {visibleThumbCount}/{thumbnailsForUi.length}
              </div>
            )}
          </div>
        </div>
        );
      })()}

      {(isInput || isProcessor || isMov || isOutput) && hasChainFolderStrip && (
        <div className="relative z-20 w-full border-t border-violet-500/35 bg-gray-950/95 backdrop-blur-sm px-2 py-1.5 rounded-b-lg flex items-center gap-2 select-none">
          <Folder className="w-3.5 h-3.5 text-violet-400 shrink-0" />
          <button
            type="button"
            className="nodrag flex flex-1 min-w-0 items-center gap-1.5 text-left rounded px-0.5 py-0.5 hover:bg-gray-800/80 transition-colors"
            onClick={expandChainFolderFromNode}
            title="展开：下游节点排在根节点右侧（顺序不变），移除打组标识；同一排右侧的节点会整体右移让出空间"
          >
            <ChevronRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />
            <span className="text-[10px] font-semibold text-gray-200 truncate">
              {chainFolderLabel} ({chainFolderChildIds.length}) · 点击展开
            </span>
          </button>
        </div>
      )}
    </div>
  );
};

// CustomNode ???????????????
export default memo(CustomNode, (prevProps, nextProps) => {
  if (prevProps.id !== nextProps.id ||
      prevProps.type !== nextProps.type ||
      prevProps.selected !== nextProps.selected) {
    return false;
  }

  const prevData = prevProps.data;
  const nextData = nextProps.data;

  if (!prevData && !nextData) return true;
  if (!prevData || !nextData) return false;

  // 与 status/progress/imagePreview/label/generatedThumbnails/videoPosterDataUrl 对齐；缩略图需逐项比 poster，避免异步截帧后不刷新
  const keyFields: (keyof typeof prevData)[] = [
    'status',
    'progress',
    'imagePreview',
    'label',
    'customName',
    'errorMessage',
    'videoPosterDataUrl',
    'spawnHighlight',
    'scheduledRunQueued',
  ];

  for (const field of keyFields) {
    if (prevData[field] !== nextData[field]) return false;
  }

  const prevThumbs = prevData.generatedThumbnails;
  const nextThumbs = nextData.generatedThumbnails;
  if (prevThumbs?.length !== nextThumbs?.length) return false;
  if (prevThumbs && nextThumbs) {
    for (let i = 0; i < prevThumbs.length; i++) {
      const a = prevThumbs[i];
      const b = nextThumbs[i];
      if (a?.id !== b?.id || a?.url !== b?.url || a?.type !== b?.type || a?.nodeId !== b?.nodeId) return false;
      if (a?.posterDataUrl !== b?.posterDataUrl) return false;
    }
  } else if (!!prevThumbs !== !!nextThumbs) {
    return false;
  }

  const prevFold = prevData.chainFolderChildIds;
  const nextFold = nextData.chainFolderChildIds;
  if ((prevFold?.length ?? 0) !== (nextFold?.length ?? 0)) return false;
  if (prevFold && nextFold) {
    for (let i = 0; i < prevFold.length; i++) {
      if (prevFold[i] !== nextFold[i]) return false;
    }
  }
  if (prevData.chainFolderLabel !== nextData.chainFolderLabel) return false;

  return true;
});
