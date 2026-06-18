import React, { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react';
import {
  resolveDisplayMediaUrl,
  flowgenAssetFileUrlFromMediaUrl,
  isFlowgenAssetThumbUrl,
} from '../services/flowgenApi';
import { resolveUrlForVideoCapture } from '../utils/videoThumbnail';
import { deleteLocalMediaRef, getLocalMediaBlob } from '../utils/localNodeMediaStore';
import { isPersistableMediaUrl } from '../utils/workspaceMediaPersist';

function revokeBlobPreviewUrl(url: string | undefined) {
  if (url && url.startsWith('blob:')) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  }
}

function safeCreateObjectURL(file: Blob): string | undefined {
  try {
    return URL.createObjectURL(file);
  } catch {
    return undefined;
  }
}

/** 侧栏视频预览：跨域 CDN 直连常 403/无首帧，与画布节点一致走同源代理；blob/data 保持原样 */
function inspectorVideoDisplaySrc(url: string | undefined): string {
  if (!url) return '';
  return resolveUrlForVideoCapture(url);
}

/** 首尾帧槽展示：本地 blob/data 优先，避免残留 COS URL 盖住新上传图导致裂图 */
function resolveInspectorFramePreviewUrl(
  imageUrl?: string | null,
  imageData?: string | null
): string | undefined {
  const url = String(imageUrl || '').trim();
  const data = String(imageData || '').trim();
  if (data && data.startsWith('blob:')) return data;
  if (data && /^data:image\//i.test(data)) {
    const resolved = resolveDisplayMediaUrl(data);
    if (resolved) return resolved;
  }
  if (url && isPersistableMediaUrl(url)) {
    const resolved = resolveDisplayMediaUrl(url);
    if (resolved) return resolved;
  }
  if (data) {
    const resolved = resolveDisplayMediaUrl(data);
    if (resolved) return resolved;
  }
  if (url) {
    const resolved = resolveDisplayMediaUrl(url);
    if (resolved) return resolved;
  }
  return undefined;
}

function patchFirstFrameFromPreviewUpdate(img?: string): {
  firstFrameImage?: string;
  firstFrameImageUrl?: string;
  firstFrameLocalRef?: string;
} {
  if (!img) {
    return {
      firstFrameImage: undefined,
      firstFrameImageUrl: undefined,
      firstFrameLocalRef: undefined,
    };
  }
  if (/^https?:\/\//i.test(img) || img.startsWith('/flowgen-api/')) {
    return { firstFrameImage: img, firstFrameImageUrl: img, firstFrameLocalRef: undefined };
  }
  return { firstFrameImage: img, firstFrameImageUrl: undefined };
}

function patchLastFrameFromPreviewUpdate(img?: string): {
  lastFrameImage?: string;
  lastFrameImageUrl?: string;
  lastFrameLocalRef?: string;
} {
  if (!img) {
    return {
      lastFrameImage: undefined,
      lastFrameImageUrl: undefined,
      lastFrameLocalRef: undefined,
    };
  }
  if (/^https?:\/\//i.test(img) || img.startsWith('/flowgen-api/')) {
    return { lastFrameImage: img, lastFrameImageUrl: img, lastFrameLocalRef: undefined };
  }
  return { lastFrameImage: img, lastFrameImageUrl: undefined };
}

function withSeedanceImageTabFramePatch(
  data: {
    seedanceTabConfigs?: NodeData['seedanceTabConfigs'];
    prompt?: string;
    negativePrompt?: string;
    firstFrameLocalRef?: string;
    lastFrameLocalRef?: string;
  },
  patch: ReturnType<typeof patchFirstFrameFromPreviewUpdate> | ReturnType<typeof patchLastFrameFromPreviewUpdate>
): { seedanceTabConfigs: NodeData['seedanceTabConfigs'] } {
  const tabs = { ...(data.seedanceTabConfigs || {}) };
  const imageTab = {
    ...(tabs.image || {}),
    prompt: data.prompt,
    negativePrompt: data.negativePrompt,
    firstFrameLocalRef: data.firstFrameLocalRef,
    lastFrameLocalRef: data.lastFrameLocalRef,
    ...patch,
  };
  tabs.image = imageTab;
  return { seedanceTabConfigs: tabs };
}

async function createVideoPosterLite(file: File): Promise<string | undefined> {
  return new Promise((resolve) => {
    const objUrl = safeCreateObjectURL(file);
    if (!objUrl) {
      resolve(undefined);
      return;
    }
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    let resolved = false;
    const MIN_BRIGHTNESS = 0.03;
    const samplePoints = [0.35, 0.65];
    let sampleIdx = 0;
    let best: { dataUrl?: string; brightness: number } = { dataUrl: undefined, brightness: 0 };
    const cleanup = () => {
      video.onloadedmetadata = null;
      video.onloadeddata = null;
      video.onseeked = null;
      video.onerror = null;
      video.src = '';
      video.load();
      URL.revokeObjectURL(objUrl);
    };
    const finish = (v?: string) => {
      if (resolved) return;
      resolved = true;
      window.clearTimeout(timer);
      cleanup();
      resolve(v);
    };
    const captureNow = (): { dataUrl?: string; brightness: number } => {
      try {
        const w = Math.max(1, video.videoWidth || 320);
        const h = Math.max(1, video.videoHeight || 180);
        const max = 320;
        const scale = Math.min(1, max / Math.max(w, h));
        const cw = Math.max(1, Math.round(w * scale));
        const ch = Math.max(1, Math.round(h * scale));
        const canvas = document.createElement('canvas');
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext('2d');
        if (!ctx) return { dataUrl: undefined, brightness: 0 };
        ctx.drawImage(video, 0, 0, cw, ch);
        const sc = document.createElement('canvas');
        sc.width = 64;
        sc.height = 64;
        const sctx = sc.getContext('2d');
        if (!sctx) return { dataUrl: undefined, brightness: 0 };
        sctx.drawImage(canvas, 0, 0, 64, 64);
        const arr = sctx.getImageData(0, 0, 64, 64).data;
        let total = 0;
        for (let i = 0; i < arr.length; i += 4) total += (arr[i] + arr[i + 1] + arr[i + 2]) / 3;
        const brightness = total / (arr.length / 4) / 255;
        return { dataUrl: canvas.toDataURL('image/jpeg', 0.78), brightness };
      } catch {
        return { dataUrl: undefined, brightness: 0 };
      }
    };
    const seekTo = (ratio: number) => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const target = duration > 0 ? Math.min(Math.max(duration * ratio, 0.08), Math.max(0.08, duration - 0.08)) : 0.08;
      try { video.currentTime = target; } catch { /* ignore */ }
    };
    const timer = window.setTimeout(() => {
      finish(best.dataUrl);
    }, 5000);
    video.onloadedmetadata = () => {
      sampleIdx = 0;
      seekTo(samplePoints[sampleIdx]);
    };
    video.onloadeddata = () => {
      if (resolved) return;
      const cap = captureNow();
      if (cap.brightness > best.brightness) best = cap;
    };
    video.onseeked = () => {
      if (resolved) return;
      requestAnimationFrame(() => {
        const cap = captureNow();
        if (cap.brightness > best.brightness) best = cap;
        if (best.brightness >= MIN_BRIGHTNESS) return finish(best.dataUrl);
        sampleIdx += 1;
        if (sampleIdx < samplePoints.length) seekTo(samplePoints[sampleIdx]);
        else finish(best.dataUrl);
      });
    };
    video.onerror = () => finish(best.dataUrl);
    video.src = objUrl;
  });
}
import { ChevronDown, Image as ImageIcon, Plus, Type, Sparkles, X, Settings2, Play, Pause, Loader2, Ratio, Monitor, Layers, UploadCloud, ArrowRightLeft, Clock, Zap, SlidersHorizontal, Film, Ban, Info, Search, Trash2, FileText, Music } from 'lucide-react';
import {
  MODEL_IMAGE_2,
  MODEL_NANO_BANANA_2,
  NodeData,
  NodeType,
  isImage2Model,
  isNanoBanana2Model,
} from '../types';
import {
  IMAGE2_ASPECT_OPTIONS,
  image2AspectForSize,
  image2CoerceSizeForAspect,
  image2SizesForAspect,
} from '../utils/image2Model';
import {
  compactImage2PanelReferences,
  image2MaxReferenceSlots,
  image2PanelRefsPatchIfChanged,
  image2MainPatchOnModelSwitch,
  clearInheritedPanelRefsOnFrameModelSwitch,
  patchImage2ReferenceAtRefSlot,
} from '../utils/image2PanelRefs';
import {
  formatSeedanceDurationLabel,
  parseSeedanceDurationSeconds,
  SEEDANCE_DURATION_DEFAULT_LABEL,
  SEEDANCE_DURATION_MAX,
  SEEDANCE_DURATION_MIN,
} from '../utils/seedanceDuration';
import {
  normalizeSeedanceAspectForTextRef,
  SEEDANCE_TEXT_REF_ASPECT_RATIOS,
  getSeedanceDefaultAspectRatio,
  getSeedanceDefaultResolution,
  getSeedance20PanelDefaultsPatch,
  shouldMigrateSeedance20AspectToDefault,
} from '../utils/seedanceAspectRatio';
import {
  compressImageForPreview,
  normalizeInspectorIngestImageUrl,
  shouldSkipCompress,
} from '../utils/imageCompress';
import { useReactFlow } from 'reactflow';
import { KlingOmniVideoThumb, isOmniVideoItemUrl } from './KlingOmniVideoThumb';
import {
  uploadImage,
  listKlingSubjects,
  saveKlingSubject,
  deleteKlingSubject,
  uiCategoryToKlingSubjectTag,
  type KlingSubjectRecord,
} from '../services/aitop';
import {
  migrateLegacyOmniVideoToInstructionSlot,
  getOmniInstructionVideoDisplayUrl,
  getOmniVideoTabDisplayUrl,
} from '../utils/omniVideoFields';
import {
  buildPromptMediaRefContextFromNode,
  buildPromptMediaRefLabels,
  filterMediaRefs,
  getActiveAtMention,
  isDuplicateOfMainImagePreview,
  isLikelyMainVideoUrl,
  mainAwareRefImageSlotLabel,
  panelReferenceSlotLabel,
  seedanceReferenceSlotLabel,
  omniMixedRefSlotCaption,
  matchAllPromptMediaTokens,
  scanPromptAppendAllTokens,
  getNodeInspectorPromptText,
  buildNodePromptUpdatePatch,
  buildCanonicalInspectorPromptPatch,
  buildInspectorPromptMentionItems,
  scanPromptAppendMediaTokensForNode,
  buildPromptMediaRefContextForRun,
  remapPromptPanelImageTokensToAssetTokens,
  refImageOrdinalForSlot,
  type PromptMediaRefItem,
} from '../utils/promptMediaRefs';
import {
  panelReferenceDisplaySlots,
  panelReferenceLabelImagePreview,
  shouldDedupePanelRefsAgainstMainPreview,
  shouldShowPanelMainImageSlot,
} from '../utils/referencedMediaRun';
import {
  FLOWGEN_MEDIA_URL_DROP,
  type FlowgenMediaUrlDropDetail,
} from '../utils/middleButtonMediaDrag';
import { extractInspectorDragUrl, extractInspectorDragUrls } from '../utils/inspectorMediaDrop';
import {
  alignReferenceImageLabels,
  appendPromptReferencedAssetDisplayEntries,
  buildPanelReferenceDisplayEntries,
  dedupePanelReferenceDisplayEntries,
  filterPanelReferenceDisplayEntriesExcludingMainPreview,
  panelRefDisplayDedupeKey,
  panelReferencesAlreadyContainAsset,
  panelReferencesAlreadyContainUrl,
  resolvePanelReferenceDisplayCaption,
  projectAssetDisplayNameFromUrl,
  referenceImagesDedupePatchIfNeeded,
  removeReferenceImageAt,
  resolveFirstLastFramePanelDisplayLabel,
  resolveMainImagePanelDisplayLabel,
  resolvePanelReferenceSlotDisplayUrl,
  resolveReferenceSlotDisplayLabel,
  tryAppendReferenceImageWithLabel,
  upgradeReferenceImageLabelsFromAssets,
  type ProjectAssetLabelRow,
} from '../utils/referenceImageSlotLabels';

/** 首尾帧拖放区：须在模块级定义，避免 NodeInspector 重渲染时组件类型变化导致 <img> 反复卸载闪动 */
const FrameDropZone = React.memo(function FrameDropZone({
  nodeId: zoneNodeId,
  frameType,
  label,
  image,
  imageUrl,
  imageData,
  onImageUpdate,
  displayUrl,
  showImage = true,
  compact = false,
  mediaRefCaption,
}: {
  nodeId: string;
  frameType: 'firstFrame' | 'lastFrame';
  label: string;
  /** @deprecated 使用 imageUrl + imageData */
  image?: string;
  imageUrl?: string;
  imageData?: string;
  onImageUpdate: (img?: string) => void;
  displayUrl?: string;
  showImage?: boolean;
  compact?: boolean;
  /** 与创意描述 @ 引用一致，如 图片1 / 图片2 */
  mediaRefCaption?: string;
}) {
  const [isZoneDragOver, setIsZoneDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasImage = Boolean(
    String(imageUrl || '').trim() ||
      String(imageData || '').trim() ||
      String(image || '').trim()
  );
  const displaySrc = useMemo(
    () =>
      resolveInspectorFramePreviewUrl(imageUrl, imageData) ||
      (image ? resolveDisplayMediaUrl(image) : ''),
    [imageUrl, imageData, image]
  );

  const registerOriginal = (file: File) => {
    window.dispatchEvent(
      new CustomEvent('flowgen:register-original-image', {
        detail: { nodeId: zoneNodeId, file, type: frameType },
      })
    );
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsZoneDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif)$/i.test(file.name)) {
        registerOriginal(file);
        compressImageForPreview(file)
          .then(onImageUpdate)
          .catch(() => {
            const reader = new FileReader();
            reader.onload = (ev) => {
              if (ev.target?.result) onImageUpdate(ev.target.result as string);
            };
            reader.readAsDataURL(file);
          });
      }
      return;
    }
    const internalUrl = extractInspectorDragUrl(e.dataTransfer);
    if (internalUrl) {
      void normalizeInspectorIngestImageUrl(internalUrl).then(onImageUpdate);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      registerOriginal(file);
      compressImageForPreview(file)
        .then((dataUrl) => onImageUpdate(dataUrl))
        .catch(() => {
          const reader = new FileReader();
          reader.onload = (ev) => {
            if (ev.target?.result) onImageUpdate(ev.target.result as string);
          };
          reader.readAsDataURL(file);
        });
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div
      className={`
                flex-1 rounded-lg border-2 border-dashed relative overflow-hidden transition-all group cursor-pointer
                ${compact ? 'h-full' : 'aspect-[4/3]'}
                ${isZoneDragOver ? 'border-brand-500 bg-brand-500/10' : 'border-gray-700 bg-gray-950/50 hover:border-gray-600'}
            `}
      data-flowgen-media-drop="1"
      data-flowgen-node-id={zoneNodeId}
      data-flowgen-drop-zone={frameType === 'firstFrame' ? 'first-frame' : 'last-frame'}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsZoneDragOver(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsZoneDragOver(false);
      }}
      onDrop={handleDrop}
      onClick={() => fileInputRef.current?.click()}
    >
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept="image/*"
        onChange={handleFileSelect}
      />

      {hasImage ? (
        <>
          {showImage && displaySrc ? (
            <img src={displaySrc} alt={label} className="w-full h-full object-cover" />
          ) : null}
          {!mediaRefCaption && (
            <div
              className={`absolute top-1 left-1 bg-black/70 text-white font-bold rounded z-10 pointer-events-none ${compact ? 'text-[8px] px-1.5 py-0.5' : 'text-[9px] px-1.5 py-0.5'}`}
            >
              {label === '首帧图' ? '[首帧图]' : label === '尾帧图' ? '[尾帧图]' : label}
            </div>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onImageUpdate(undefined);
            }}
            className="absolute top-1 right-1 p-1 bg-black/60 hover:bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-all z-10 backdrop-blur-sm"
            title="Remove image"
          >
            <X size={12} />
          </button>
          {mediaRefCaption ? (
            <div className="absolute bottom-0 left-0 right-0 bg-black/70 backdrop-blur-sm z-10 pointer-events-none">
              <div
                className={`text-center text-white font-medium ${compact ? 'text-[9px] py-1' : 'text-[10px] py-1'}`}
              >
                {mediaRefCaption}
              </div>
            </div>
          ) : (
            <div className="absolute bottom-0 left-0 right-0 bg-black/70 backdrop-blur-sm">
              <div
                className={`text-center text-gray-300 font-medium pointer-events-none ${compact ? 'text-[9px] py-0.5' : 'text-[10px] py-1'}`}
              >
                {label}
              </div>
              {displayUrl && (
                <div className="px-1 pb-1">
                  <div className="bg-gray-900/80 rounded px-1.5 py-0.5 text-[8px] text-gray-400 font-mono truncate select-all pointer-events-auto">
                    {displayUrl}
                  </div>
                </div>
              )}
            </div>
          )}
          {!showImage && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-gray-500 pointer-events-none bg-gray-950/30">
              <div className="p-2 rounded-md border border-dashed border-gray-600 bg-gray-900/50">
                <ImageIcon size={16} />
              </div>
              <span className="text-[10px] font-medium">已设置 {label}</span>
              {displayUrl && (
                <span className="text-[8px] text-gray-600 font-mono truncate max-w-[90%]">
                  {displayUrl.substring(0, 30)}...
                </span>
              )}
            </div>
          )}
        </>
      ) : (
        <div
          className={`absolute inset-0 flex flex-col items-center justify-center text-gray-600 pointer-events-none ${compact ? 'gap-1' : 'gap-1.5'}`}
        >
          <div
            className={`rounded-md border border-dashed border-gray-700 ${compact ? 'p-1' : 'p-1.5'}`}
          >
            <Plus size={compact ? 12 : 14} />
          </div>
          <span className={`${compact ? 'text-[9px]' : 'text-[10px]'} font-medium`}>{label}</span>
        </div>
      )}
    </div>
  );
});

function patchVideoPlayingMap(
  prev: Record<string, boolean>,
  id: string,
  playing: boolean
): Record<string, boolean> {
  if (prev[id] === playing) return prev;
  return { ...prev, [id]: playing };
}

/** 运行中锁定侧栏媒体 URL，避免上传/写回时 src 切换导致 <video>/<img> 反复重载闪动 */
function useStableInspectorMediaUrl(
  url: string | undefined,
  lockWhileRunning: boolean
): string | undefined {
  const lockRef = useRef<string | undefined>();
  return useMemo(() => {
    if (!url) {
      lockRef.current = undefined;
      return undefined;
    }
    if (lockWhileRunning) {
      if (!lockRef.current) lockRef.current = url;
      return lockRef.current;
    }
    lockRef.current = undefined;
    return url;
  }, [url, lockWhileRunning]);
}

/** Omni 指令/视频参考 tab 顶栏视频预览：模块级 + memo，避免 progress 轮询触发整段重挂载 */
const InspectorOmniTabVideoPreview = React.memo(function InspectorOmniTabVideoPreview({
  nodeId,
  omniTab,
  displayUrl,
  posterUrl,
  mainPreview,
  onRemove,
  onVideoPlayStateChange,
  onTogglePlay,
  videoRefRegister,
  isPlaying,
}: {
  nodeId: string;
  omniTab: 'instruction' | 'video';
  displayUrl: string;
  posterUrl?: string;
  mainPreview?: string;
  onRemove: () => void;
  onVideoPlayStateChange: (videoId: string, playing: boolean) => void;
  onTogglePlay: (videoId: string) => void;
  videoRefRegister: (videoId: string, el: HTMLVideoElement | null) => void;
  isPlaying: boolean;
}) {
  const videoId = `omni-video-preview-${nodeId}-${omniTab}`;
  const videoSrc = useMemo(() => inspectorVideoDisplaySrc(displayUrl), [displayUrl]);
  const isMainVideo = useMemo(() => {
    const mainPrev = mainPreview?.trim();
    return Boolean(mainPrev && isLikelyMainVideoUrl(mainPrev) && mainPrev === displayUrl);
  }, [mainPreview, displayUrl]);
  const showPoster = Boolean(posterUrl && !isPlaying);

  return (
    <div className="p-2 rounded-lg border border-gray-800 bg-gray-950/30 flex items-center gap-2">
      <div className="relative w-28 h-16 rounded overflow-hidden bg-gray-900 shrink-0 border border-gray-800">
        {showPoster && posterUrl ? (
          <img
            src={posterUrl}
            alt=""
            className="absolute inset-0 z-[1] w-full h-full object-cover pointer-events-none"
          />
        ) : null}
        <video
          id={videoId}
          ref={(el) => videoRefRegister(videoId, el)}
          src={videoSrc}
          className="w-full h-full object-cover"
          controls
          preload="auto"
          playsInline
          muted
          style={
            showPoster ? { opacity: 0, pointerEvents: 'none' as const } : undefined
          }
          onPlay={() => onVideoPlayStateChange(videoId, true)}
          onPause={() => onVideoPlayStateChange(videoId, false)}
          onEnded={() => onVideoPlayStateChange(videoId, false)}
        />
        <div className="absolute bottom-0 left-0 right-0 z-[2] bg-black/70 text-white text-[9px] font-medium text-center py-0.5 pointer-events-none">
          {isMainVideo ? '主视频' : '视频1'}
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] text-gray-300 truncate">
          {isMainVideo ? '已选主视频' : '已选视频素材'}
        </p>
        <p className="text-[9px] text-gray-500 truncate">将用于可灵3.0 Omni 的指令/视频参考</p>
      </div>
      <button
        type="button"
        title={isPlaying ? '暂停视频' : '播放视频'}
        onClick={() => onTogglePlay(videoId)}
        className="p-1.5 rounded hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
      >
        {isPlaying ? <Pause size={14} /> : <Play size={14} />}
      </button>
      <button
        type="button"
        title="移除视频素材"
        onClick={onRemove}
        className="p-1.5 rounded hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
      >
        <X size={14} />
      </button>
    </div>
  );
});

interface NodeInspectorProps {
  nodeId: string;
  data: NodeData;
  nodeType?: string; // 节点类型
  onUpdate: (newData: Partial<NodeData>) => void;
  onRun: (nodeId: string) => Promise<void>; // Added onRun callback
  /** 项目资产库 @ 项（扫描 @素材 用；不在标题栏展示 chip） */
  projectAssetRefItems?: PromptMediaRefItem[];
  /** 资产库 slug/名称/URL，用于参考格底栏展示资产名 */
  projectAssetLabelRows?: ProjectAssetLabelRow[];
  /** 已进入服务端项目（有资产库时可展示「扫描 @素材」） */
  projectAssetLibraryEnabled?: boolean;
}

function clampInspectorNum(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

const FLOWGEN_INSPECTOR_HEIGHTS_LS_KEY = 'flowgen:node-inspector-heights:v1';

type InspectorPanelHeights = {
  /** 素材区（Tab / 参考图等）可视最大高度，增大后上方可展示更多内容 */
  assetsScrollMaxPx: number;
  promptTextMinPx: number;
  negativeBlockMinPx: number;
};

const DEFAULT_INSPECTOR_PANEL_HEIGHTS: InspectorPanelHeights = {
  assetsScrollMaxPx: 400,
  promptTextMinPx: 140,
  negativeBlockMinPx: 112,
};

/** 侧栏可拖拽区高度上下限（与 beginInspectorResize 内 clamp 保持一致） */
const INSPECTOR_RESIZE_LIMITS = {
  assetsMin: 200,
  assetsMax: 1000,
  promptMin: 72,
  promptMax: 800,
  negativeMin: 72,
  negativeMax: 680,
} as const;

function loadInspectorPanelHeights(): InspectorPanelHeights {
  if (typeof window === 'undefined') return DEFAULT_INSPECTOR_PANEL_HEIGHTS;
  try {
    const raw = localStorage.getItem(FLOWGEN_INSPECTOR_HEIGHTS_LS_KEY);
    if (!raw) return DEFAULT_INSPECTOR_PANEL_HEIGHTS;
    const j = JSON.parse(raw) as Partial<InspectorPanelHeights>;
    return {
      assetsScrollMaxPx: clampInspectorNum(
        Number(j.assetsScrollMaxPx) || DEFAULT_INSPECTOR_PANEL_HEIGHTS.assetsScrollMaxPx,
        INSPECTOR_RESIZE_LIMITS.assetsMin,
        INSPECTOR_RESIZE_LIMITS.assetsMax
      ),
      promptTextMinPx: clampInspectorNum(
        Number(j.promptTextMinPx) || DEFAULT_INSPECTOR_PANEL_HEIGHTS.promptTextMinPx,
        INSPECTOR_RESIZE_LIMITS.promptMin,
        INSPECTOR_RESIZE_LIMITS.promptMax
      ),
      negativeBlockMinPx: clampInspectorNum(
        Number(j.negativeBlockMinPx) || DEFAULT_INSPECTOR_PANEL_HEIGHTS.negativeBlockMinPx,
        INSPECTOR_RESIZE_LIMITS.negativeMin,
        INSPECTOR_RESIZE_LIMITS.negativeMax
      ),
    };
  } catch {
    return DEFAULT_INSPECTOR_PANEL_HEIGHTS;
  }
}

/** 可拖动分隔条：视觉与侧栏各区块的 `border-b border-gray-800` 分割线一致，仅增加可拖拽热区 */
function InspectorResizeHandle({
  onPointerDown,
  title = '上下拖动调整区域高度',
}: {
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  title?: string;
}) {
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      title={title}
      onPointerDown={onPointerDown}
      className="flex-none shrink-0 w-full cursor-row-resize touch-none select-none border-b border-gray-800 bg-gray-900 py-2 hover:bg-gray-800/20"
    />
  );
}

type PromptRefHighlightKind = 'mainImage' | 'mainVideo' | 'image' | 'video' | 'audio' | 'projectAsset';

function promptRefKindFromToken(token: string): PromptRefHighlightKind {
  if (token === '@主图' || token === '@首帧图' || token === '@尾帧图') return 'mainImage';
  if (token === '@主视频') return 'mainVideo';
  if (token.startsWith('@视频')) return 'video';
  if (token.startsWith('@音频')) return 'audio';
  if (token.startsWith('@资产:')) return 'projectAsset';
  return 'image';
}

function extractPromptRefHighlights(text: string): Array<{ token: string; kind: PromptRefHighlightKind }> {
  const src = String(text || '');
  if (!src.trim()) return [];
  // 匹配所有 @引用：主图/主视频/首帧图/尾帧图/图片n/视频n/音频n/资产:slug
  // 资产slug匹配到下一个空格或@，避免贪婪匹配连续的中文字符
  const re =
    /@(主图|主视频|首帧图|尾帧图|图片\d*|视频\d*|音频\d*|资产:[^\s@，。；：、,.!?／/与和及]+)/g;
  const out: Array<{ token: string; kind: PromptRefHighlightKind }> = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null = null;
  while ((m = re.exec(src)) !== null) {
    const token = `@${m[1]}`;
    if (seen.has(token)) continue;
    seen.add(token);
    out.push({ token, kind: promptRefKindFromToken(token) });
  }
  return out;
}

function promptRefTokenTextClass(kind: PromptRefHighlightKind): string {
  if (kind === 'mainImage') return 'text-blue-400';
  if (kind === 'mainVideo') return 'text-sky-400';
  if (kind === 'image') return 'text-purple-400';
  if (kind === 'video') return 'text-amber-400';
  if (kind === 'projectAsset') return 'text-fuchsia-400'; // 资产类使用紫红色
  return 'text-teal-400';
}

function renderPlainPromptSegment(segment: string, keyBase: string): React.ReactNode[] {
  if (!segment) return [];
  /** 每行首个「：」前为绿色标签；换行用纯文本 \n 插入，勿用 Fragment 分行（避免与 textarea 换行不一致） */
  const nodes: React.ReactNode[] = [];
  let start = 0;
  let idx = 0;
  while (start <= segment.length) {
    const nl = segment.indexOf('\n', start);
    const end = nl === -1 ? segment.length : nl;
    const line = segment.slice(start, end);
    const colonIdx = line.indexOf('：');
    if (colonIdx > 0) {
      nodes.push(
        <span key={`${keyBase}-g-${idx++}`} className="text-green-400">
          {line.slice(0, colonIdx)}
        </span>
      );
      nodes.push(
        <span key={`${keyBase}-t-${idx++}`} className="text-gray-200">
          {line.slice(colonIdx)}
        </span>
      );
    } else if (line.length > 0) {
      nodes.push(
        <span key={`${keyBase}-t-${idx++}`} className="text-gray-200">
          {line}
        </span>
      );
    }
    if (nl === -1) break;
    nodes.push('\n');
    start = nl + 1;
  }
  return nodes;
}

/** 创意描述 textarea 与高亮层必须共用同一套排版，否则透明字 + overlay 会导致 caret 错位 */
const INSPECTOR_PROMPT_TYPO_CLASS =
  'block w-full box-border p-0 m-0 border-0 align-top text-xs font-mono font-normal leading-[18px] whitespace-pre-wrap [overflow-wrap:anywhere] [word-break:normal] tracking-normal [font-variant-ligatures:none]';

const INSPECTOR_PROMPT_TEXT_CLASS = `${INSPECTOR_PROMPT_TYPO_CLASS} max-h-[min(88vh,860px)] shrink-0`;

function renderPromptWithTokenHighlights(
  text: string,
  projectAssets?: ProjectAssetLabelRow[]
): React.ReactNode {
  const src = String(text || '');
  if (!src) return null;
  const tokens = matchAllPromptMediaTokens(src, projectAssets);
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let idx = 0;
  for (const { token, index } of tokens) {
    if (index > last) {
      nodes.push(...renderPlainPromptSegment(src.slice(last, index), `txt-${idx++}`));
    }
    const kind = promptRefKindFromToken(token);
    nodes.push(
      <span key={`tok-${idx++}`} className={promptRefTokenTextClass(kind)}>
        {token}
      </span>
    );
    last = index + token.length;
  }
  if (last < src.length) {
    nodes.push(...renderPlainPromptSegment(src.slice(last), `tail-${idx++}`));
  }
  return nodes.length > 0 ? nodes : null;
}

function NodeInspector({
  nodeId,
  data,
  nodeType,
  onUpdate,
  onRun,
  projectAssetRefItems = [],
  projectAssetLabelRows = [],
  projectAssetLibraryEnabled = false,
}: NodeInspectorProps) {
  type SubjectCategory = '人物' | '动物' | '道具' | '服饰' | '场景' | '特效' | '其他';
  type LibraryItem = {
    id: string;
    url: string;
    thumbnail?: string;
    name?: string;
    category?: SubjectCategory;
    tags?: string[];
    description?: string;
    views?: string[];
    /** 服务端 elementId，可选 */
    elementId?: string;
    /** 更新时间（接口若有返回则展示） */
    updatedAt?: string;
  };
  const SUBJECT_CATEGORIES: SubjectCategory[] = ['人物', '动物', '道具', '服饰', '场景', '特效', '其他'];
  /** 接口 tag → 界面分类（与 AITOP100 文档枚举一致；含旧错误别名的兼容） */
  const KLING_TAG_TO_CATEGORY: Record<string, SubjectCategory> = {
    PERSON: '人物',
    ANIMAL: '动物',
    PROP: '道具',
    CLOTHES: '服饰',
    SCENE: '场景',
    EFFECT: '特效',
    OTHER: '其他',
    CHARACTER: '人物',
    COSTUME: '服饰',
  };
  const [runningByNode, setRunningByNode] = useState<Record<string, boolean>>({});
  const [isDragOverRefs, setIsDragOverRefs] = useState(false);
  const [seedanceRefDropOver, setSeedanceRefDropOver] = useState(false);
  const [videoPlayingMap, setVideoPlayingMap] = useState<Record<string, boolean>>({});
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const isMountedRef = useRef(true);
  const [klingOmniTab, setKlingOmniTab] = useState<'multi' | 'instruction' | 'video' | 'frames'>('multi');

  const { getNodes, getEdges } = useReactFlow();
  const mainPreviewDisplaySrc = useMemo(
    () => resolveDisplayMediaUrl(data.imagePreview),
    [data.imagePreview]
  );
  // 展示态：优先用节点真实状态；本地态仅用于点击后的短暂反馈
  const isCurrentNodeRunning = data.status === 'running' || Boolean(runningByNode[nodeId]);

  /**
   * 大批量拖图时避免 Promise.all 同时压缩过多图片，降低主线程/内存峰值。
   * 不改业务结果，只把压缩过程改成小批顺序推进。
   */
  const compressImagesInBatches = useCallback(
    async (files: File[], options?: { batchSize?: number }): Promise<string[]> => {
      const out: string[] = [];
      const batchSize = Math.max(1, options?.batchSize ?? 2);
      for (let start = 0; start < files.length; start += batchSize) {
        const batch = files.slice(start, start + batchSize);
        const batchResults = await Promise.all(
          batch.map(async (file) => {
            try {
              return await compressImageForPreview(file);
            } catch {
              return await new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onload = (ev) => resolve((ev.target?.result as string) || '');
                reader.onerror = () => resolve('');
                reader.readAsDataURL(file);
              });
            }
          })
        );
        out.push(...batchResults.filter(Boolean));
        // 给浏览器一个喘息机会，避免大批量图片压缩长时间独占主线程
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
      return out;
    },
    []
  );

  useEffect(() => {
    // 必须在挂载时显式置 true。开发环境 Strict Mode 会先卸载再挂载，useRef 初始值不会重跑，若只在上层 cleanup 里写 false，会永远卡在 false，导致运行按钮无反应。
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  /** 旧 persisted 名称 → Nano Banana 2.0，并迁移 modelConfigs 键 */
  useEffect(() => {
    const m = data.selectedModel;
    if (m !== 'Nano Banana Pro(生图)' && m !== 'Nano Banana Pro') return;
    const mc = { ...(data.modelConfigs || {}) } as Record<string, unknown>;
    const legacyKey = 'Nano Banana Pro(生图)';
    const legacyCfg = mc[legacyKey];
    if (legacyCfg && !mc[MODEL_NANO_BANANA_2]) {
      mc[MODEL_NANO_BANANA_2] = legacyCfg;
      delete mc[legacyKey];
    }
    onUpdate({ selectedModel: MODEL_NANO_BANANA_2, modelConfigs: mc as NodeData['modelConfigs'] });
  }, [data.selectedModel, onUpdate]);

  /** 从画布“当前选中节点”里优先取视频 URL（保证补齐的视频就是用户选中的那个视频节点） */
  const getSelectedVideoUrl = (): string | undefined => {
    const nodes = getNodes();
    const selected = nodes.filter((n) => (n as any)?.selected);
    if (selected.length === 0) return undefined;

    const isVideoUrl = (url?: string): boolean => {
      if (!url) return false;
      return (
        /\.(mov|mp4|webm|avi|mkv|flv|wmv|m4v)(\?|$)/i.test(url) ||
        url.startsWith('blob:') ||
        /video/i.test(url)
      );
    };

    const pickFromNode = (n: any): string | undefined => {
      const d: any = n?.data || {};
      if (isVideoUrl(d.imagePreview)) return d.imagePreview;
      if (isVideoUrl(d.klingOmniInstructionVideoUrl)) return d.klingOmniInstructionVideoUrl;
      if (isVideoUrl(d.klingOmniInstructionVideoPreviewUrl)) return d.klingOmniInstructionVideoPreviewUrl;
      if (isVideoUrl(d.klingOmniVideoUrl)) return d.klingOmniVideoUrl;
      if (isVideoUrl(d.generationParams?.klingOmniVideoUrl)) return d.generationParams.klingOmniVideoUrl;
      if (isVideoUrl((d.generationParams as any)?.klingOmniInstructionVideoUrl))
        return (d.generationParams as any).klingOmniInstructionVideoUrl;
      const thumbs = d.generatedThumbnails;
      if (Array.isArray(thumbs)) {
        const vt = thumbs.find((t: any) => t?.type === 'video' && isVideoUrl(t?.url));
        if (vt?.url) return vt.url;
      }
      return undefined;
    };

    // 只要选中了视频节点（MOV/OUTPUT），就优先用它；否则再看其它被选中的节点
    const ranked = selected
      .slice()
      .sort((a: any, b: any) => {
        const rank = (x: any) => (x?.type === NodeType.MOV ? 3 : x?.type === NodeType.OUTPUT ? 2 : 0);
        return rank(b) - rank(a);
      });
    for (const n of ranked) {
      const u = pickFromNode(n);
      if (u) return u;
    }
    return undefined;
  };

  /** 从节点数据里抽取视频 URL（兼容 MOV/OUTPUT/Omni 的多种存储位置） */
  const pickVideoUrlFromNode = (n: any): string | undefined => {
    const isVideoUrl = (url?: string): boolean => {
      if (!url) return false;
      return (
        /\.(mov|mp4|webm|avi|mkv|flv|wmv|m4v)(\?|$)/i.test(url) ||
        url.startsWith('blob:') ||
        /video/i.test(url)
      );
    };
    const d: any = n?.data || {};
    if (isVideoUrl(d.imagePreview)) return d.imagePreview;
    if (isVideoUrl(d.klingOmniInstructionVideoUrl)) return d.klingOmniInstructionVideoUrl;
    if (isVideoUrl(d.klingOmniInstructionVideoPreviewUrl)) return d.klingOmniInstructionVideoPreviewUrl;
    if (isVideoUrl(d.klingOmniVideoUrl)) return d.klingOmniVideoUrl;
    if (isVideoUrl(d.generationParams?.klingOmniVideoUrl)) return d.generationParams.klingOmniVideoUrl;
    if (isVideoUrl((d.generationParams as any)?.klingOmniInstructionVideoUrl))
      return (d.generationParams as any).klingOmniInstructionVideoUrl;
    const thumbs = d.generatedThumbnails;
    if (Array.isArray(thumbs)) {
      const vt = thumbs.find((t: any) => t?.type === 'video' && isVideoUrl(t?.url));
      if (vt?.url) return vt.url;
    }
    return undefined;
  };

  /**
   * Omni 指令/视频参考：从当前节点向上游找到“最近的视频链路”。
   * - depth 越小越优先（更近的父节点链路）
   * - MOV > OUTPUT > 其它（更像“素材视频节点”）
   * - 若同层多分支，优先选画布位置更近的那条分支（更符合用户视觉链路）
   */
  const findNearestUpstreamVideoUrl = (): string | undefined => {
    const nodes = getNodes();
    const edges = getEdges();
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const start = byId.get(nodeId);
    const startPos = (start as any)?.position as { x: number; y: number } | undefined;
    const rank = (n: any) =>
      n?.type === NodeType.MOV ? 3 : n?.type === NodeType.OUTPUT ? 2 : n?.type === NodeType.PROCESSOR ? 1 : 0;
    const dist2 = (n: any) => {
      if (!startPos || !n?.position) return Number.POSITIVE_INFINITY;
      const dx = (n.position.x ?? 0) - startPos.x;
      const dy = (n.position.y ?? 0) - startPos.y;
      return dx * dx + dy * dy;
    };

    const visited = new Set<string>();
    let queue: Array<{ id: string; depth: number }> = edges
      .filter((ed) => ed.target === nodeId)
      .map((ed) => ({ id: ed.source, depth: 1 }));

    const sortQueue = (arr: Array<{ id: string; depth: number }>) => {
      arr.sort((a, b) => {
        if (a.depth !== b.depth) return a.depth - b.depth;
        const na = byId.get(a.id);
        const nb = byId.get(b.id);
        const r = rank(nb) - rank(na);
        if (r !== 0) return r;
        return dist2(na) - dist2(nb);
      });
    };
    sortQueue(queue);

    while (queue.length > 0) {
      const cur = queue.shift();
      if (!cur) break;
      if (visited.has(cur.id)) continue;
      visited.add(cur.id);
      const n = byId.get(cur.id);
      const u = pickVideoUrlFromNode(n);
      if (u) return u;
      if (cur.depth >= 8) continue;
      const parents = edges
        .filter((ed) => ed.target === cur.id)
        .map((ed) => ({ id: ed.source, depth: cur.depth + 1 }));
      if (parents.length) {
        queue.push(...parents);
        sortQueue(queue);
      }
    }
    return undefined;
  };
  
  // Ref for the main upload area (Keling mode)
  const mainUploadInputRef = useRef<HTMLInputElement>(null);
  /** 多图参考区：本地上传（Nano / 可灵 Omni 等） */
  const refUploadInputRef = useRef<HTMLInputElement>(null);
  /** 拖放/上传回调中读取最新节点数据，避免异步闭包陈旧 */
  const nodeDataRef = useRef(data);
  nodeDataRef.current = data;
  // Ref for prompt textarea (for inserting image references)
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);
  const promptHighlightRef = useRef<HTMLDivElement>(null);
  const promptHighlightInnerRef = useRef<HTMLDivElement>(null);
  /** 受控 prompt 重渲染后恢复光标（避免空格/换行后 caret 错位） */
  const pendingPromptSelectionRef = useRef<{ start: number; end: number } | null>(null);
  
  // State for library file selector modal
  const [showLibraryModal, setShowLibraryModal] = useState(false);
  const [libraryImages, setLibraryImages] = useState<LibraryItem[]>([]);
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(false);
  const [libraryKeyword, setLibraryKeyword] = useState('');
  const [libraryDetailOpenId, setLibraryDetailOpenId] = useState<string | null>(null);
  const [libraryCategoryFilter, setLibraryCategoryFilter] = useState<'全部' | SubjectCategory>('全部');
  const [selectedLibraryIds, setSelectedLibraryIds] = useState<string[]>([]);
  const [showCreateSubjectForm, setShowCreateSubjectForm] = useState(false);
  const [newSubjectName, setNewSubjectName] = useState('');
  const [newSubjectDataUrl, setNewSubjectDataUrl] = useState('');
  const [newSubjectOtherViewUrls, setNewSubjectOtherViewUrls] = useState<string[]>([]);
  /** 标签（下拉），未选为空；映射接口 tag */
  const [newSubjectTag, setNewSubjectTag] = useState<SubjectCategory | ''>('');
  const [newSubjectDescription, setNewSubjectDescription] = useState('');
  const [isCreatingSubject, setIsCreatingSubject] = useState(false);
  const [subjectMainDropOver, setSubjectMainDropOver] = useState(false);
  const [subjectOtherViewsDropOver, setSubjectOtherViewsDropOver] = useState(false);
  const subjectMainFrontInputRef = useRef<HTMLInputElement>(null);
  const subjectOtherViewsInputRef = useRef<HTMLInputElement>(null);
  /** 拖放后部分浏览器会触发一次 click，避免误弹文件框 */
  const suppressSubjectMainClickRef = useRef(false);
  const suppressSubjectOtherClickRef = useRef(false);

  const isKeling = data.selectedModel?.includes('可灵');
  const isKelingOmni = data.selectedModel === '可灵3.0 Omni';
  const isJimeng = data.selectedModel === '即梦3.0 Pro';
  const isVidu = data.selectedModel === 'vidu 2.0';
  const isSeedance15 = data.selectedModel === 'seedance1.5-pro';
  const isSeedance20 = ['seedance2.0 (高质量版)', 'seedance2.0 (急速版)'].includes(data.selectedModel || '');
  const isSeedance20HighQuality = data.selectedModel === 'seedance2.0 (高质量版)';
  const isSeedance = isSeedance15 || isSeedance20;
  const seedanceMode = data.seedanceGenerationMode || 'text';

  const applyFirstFrameUpdate = useCallback(
    (img?: string, meta?: { displayName?: string }) => {
      const patch = patchFirstFrameFromPreviewUpdate(img);
      if (!img && data.firstFrameLocalRef) {
        void deleteLocalMediaRef(data.firstFrameLocalRef);
      }
      const next: Partial<NodeData> = { ...patch };
      if (!img) {
        next.firstFrameImageLabel = undefined;
      } else {
        const name =
          meta?.displayName?.trim() ||
          projectAssetDisplayNameFromUrl(img, projectAssetLabelRows) ||
          '';
        if (name) next.firstFrameImageLabel = name;
      }
      if (isSeedance20 && seedanceMode === 'image') {
        Object.assign(next, withSeedanceImageTabFramePatch(data, patch));
      }
      onUpdate(next);
    },
    [data, isSeedance20, seedanceMode, onUpdate, projectAssetLabelRows]
  );

  const applyLastFrameUpdate = useCallback(
    (img?: string, meta?: { displayName?: string }) => {
      const patch = patchLastFrameFromPreviewUpdate(img);
      if (!img && data.lastFrameLocalRef) {
        void deleteLocalMediaRef(data.lastFrameLocalRef);
      }
      const next: Partial<NodeData> = { ...patch };
      if (!img) {
        next.lastFrameImageLabel = undefined;
      } else {
        const name =
          meta?.displayName?.trim() ||
          projectAssetDisplayNameFromUrl(img, projectAssetLabelRows) ||
          '';
        if (name) next.lastFrameImageLabel = name;
      }
      if (isSeedance20 && seedanceMode === 'image') {
        Object.assign(next, withSeedanceImageTabFramePatch(data, patch));
      }
      onUpdate(next);
    },
    [data, isSeedance20, seedanceMode, onUpdate, projectAssetLabelRows]
  );

  /** 刷新后：顶层首尾帧被剥离时，从 seedance 图生 tab 快照或持久化 COS 链接恢复 */
  useEffect(() => {
    if (!isSeedance20 || seedanceMode !== 'image') return;
    const tab = data.seedanceTabConfigs?.image;
    if (!tab) return;
    const patch: Partial<NodeData> = {};
    if (
      !data.firstFrameImage &&
      !data.firstFrameImageUrl &&
      !data.firstFrameLocalRef
    ) {
      const f = tab.firstFrameImageUrl || tab.firstFrameImage;
      if (f && isPersistableMediaUrl(f)) {
        Object.assign(patch, patchFirstFrameFromPreviewUpdate(f));
      } else if (tab.firstFrameLocalRef) {
        patch.firstFrameLocalRef = tab.firstFrameLocalRef;
      }
    }
    if (
      !data.lastFrameImage &&
      !data.lastFrameImageUrl &&
      !data.lastFrameLocalRef
    ) {
      const l = tab.lastFrameImageUrl || tab.lastFrameImage;
      if (l && isPersistableMediaUrl(l)) {
        Object.assign(patch, patchLastFrameFromPreviewUpdate(l));
      } else if (tab.lastFrameLocalRef) {
        patch.lastFrameLocalRef = tab.lastFrameLocalRef;
      }
    }
    if (Object.keys(patch).length > 0) onUpdate(patch);
  }, [
    nodeId,
    isSeedance20,
    seedanceMode,
    data.firstFrameImage,
    data.firstFrameImageUrl,
    data.firstFrameLocalRef,
    data.lastFrameImage,
    data.lastFrameImageUrl,
    data.lastFrameLocalRef,
    data.seedanceTabConfigs?.image,
    onUpdate,
  ]);

  /** 有 firstFrameLocalRef / lastFrameLocalRef 时从 IDB 恢复 blob 预览（刷新或切回图生 tab） */
  const frameHydrateTokenRef = useRef<{ nodeId: string; first?: string; last?: string }>({
    nodeId: '',
  });
  useEffect(() => {
    if (frameHydrateTokenRef.current.nodeId !== nodeId) {
      frameHydrateTokenRef.current = { nodeId };
    }
    let cancelled = false;
    const hydrateSlot = async (
      ref: string | undefined,
      imgKey: 'firstFrameImage' | 'lastFrameImage',
      urlKey: 'firstFrameImageUrl' | 'lastFrameImageUrl',
      tokenKey: 'first' | 'last'
    ) => {
      if (!ref) return;
      const cur = data[imgKey];
      const curUrl = data[urlKey];
      if (cur && isPersistableMediaUrl(cur)) return;
      if (curUrl && isPersistableMediaUrl(curUrl)) return;
      if (cur && typeof cur === 'string' && cur.startsWith('blob:')) {
        frameHydrateTokenRef.current[tokenKey] = ref;
        return;
      }
      if (frameHydrateTokenRef.current[tokenKey] === ref) return;
      const blob = await getLocalMediaBlob(ref);
      if (!blob || cancelled) return;
      revokeBlobPreviewUrl(typeof cur === 'string' ? cur : undefined);
      frameHydrateTokenRef.current[tokenKey] = ref;
      onUpdate({ [imgKey]: URL.createObjectURL(blob) });
    };
    void hydrateSlot(data.firstFrameLocalRef, 'firstFrameImage', 'firstFrameImageUrl', 'first');
    void hydrateSlot(data.lastFrameLocalRef, 'lastFrameImage', 'lastFrameImageUrl', 'last');
    return () => {
      cancelled = true;
    };
  }, [
    nodeId,
    data.firstFrameLocalRef,
    data.lastFrameLocalRef,
    data.firstFrameImage,
    data.firstFrameImageUrl,
    data.lastFrameImage,
    data.lastFrameImageUrl,
    onUpdate,
  ]);

  /** 1080p 仅高质量版：旧数据或切换模型后纠正 */
  useEffect(() => {
    if (!isSeedance || isSeedance20HighQuality) return;
    if (data.seedanceResolution !== '1080p') return;
    onUpdate({ seedanceResolution: '720p' });
  }, [isSeedance, isSeedance20HighQuality, data.seedanceResolution, onUpdate]);

  /** Seedance 2.0：仅选中节点且字段未设置时补默认，勿监听分辨率/比例以免抢用户点击 */
  useEffect(() => {
    if (!isSeedance20) return;
    const patch = getSeedance20PanelDefaultsPatch({
      selectedModel: data.selectedModel,
      seedanceResolution: data.seedanceResolution,
      seedanceAspectRatio: data.seedanceAspectRatio,
    });
    if (patch) onUpdate(patch);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅 nodeId 切换时补默认
  }, [nodeId, isSeedance20]);

  /** Seedance 参考生：打开面板时写回去重后的 referenceImages（分镜克隆/旧数据常留同资产双槽） */
  useLayoutEffect(() => {
    if (!isSeedance20 || seedanceMode !== 'reference') return;
    const patch = referenceImagesDedupePatchIfNeeded(data, {
      dedupeAgainstMain: shouldDedupePanelRefsAgainstMainPreview(data),
      projectAssets: projectAssetLabelRows,
    });
    if (!patch) return;
    const tabs = { ...(data.seedanceTabConfigs || {}) } as NonNullable<NodeData['seedanceTabConfigs']>;
    const refTab = { ...(tabs.reference || {}) };
    refTab.prompt = getInspectorPromptValue();
    refTab.referenceImages = patch.referenceImages;
    refTab.referenceImageLabels = patch.referenceImageLabels;
    tabs.reference = refTab;
    onUpdate({
      ...buildNodePromptUpdatePatch(data, getInspectorPromptValue()),
      ...patch,
      seedanceTabConfigs: tabs,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在槽位/主图变化时去重
  }, [
    nodeId,
    isSeedance20,
    seedanceMode,
    data.referenceImages,
    data.referenceImageLabels,
    data.imagePreview,
    data.panelMainSlotVisible,
    projectAssetLabelRows,
  ]);

  /** Seedance 参考生：泛称「图片n」升级为资产库展示名（分镜克隆/旧节点） */
  useLayoutEffect(() => {
    if (!isSeedance20 || seedanceMode !== 'reference') return;
    if (!projectAssetLabelRows.length) return;
    const refs = data.referenceImages || [];
    if (!refs.length) return;
    const upgraded = upgradeReferenceImageLabelsFromAssets(
      refs,
      data.referenceImageLabels,
      projectAssetLabelRows
    );
    const prev = alignReferenceImageLabels(refs, data.referenceImageLabels);
    if (upgraded.every((l, i) => l === (prev[i] || ''))) return;
    const tabs = { ...(data.seedanceTabConfigs || {}) } as NonNullable<NodeData['seedanceTabConfigs']>;
    const refTab = { ...(tabs.reference || {}) };
    refTab.referenceImageLabels = upgraded;
    tabs.reference = refTab;
    onUpdate({ referenceImageLabels: upgraded, seedanceTabConfigs: tabs });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 槽位/资产库变化时升级底栏名
  }, [
    nodeId,
    isSeedance20,
    seedanceMode,
    data.referenceImages,
    data.referenceImageLabels,
    projectAssetLabelRows,
  ]);

  /** Nano Banana 2.0：打开面板时写回去重后的 referenceImages（主图勿重复进「图片1」槽） */
  useLayoutEffect(() => {
    if (!isNanoBanana2Model(data.selectedModel)) return;
    const patch = referenceImagesDedupePatchIfNeeded(data, {
      dedupeAgainstMain: shouldDedupePanelRefsAgainstMainPreview(data),
      projectAssets: projectAssetLabelRows,
    });
    if (!patch) return;
    onUpdate(patch);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在槽位/主图变化时去重
  }, [
    nodeId,
    data.selectedModel,
    data.referenceImages,
    data.referenceImageLabels,
    data.imagePreview,
    data.panelMainSlotVisible,
    projectAssetLabelRows,
  ]);

  /** 仅 Nano Banana 2.0 走多图参考/拖入规则（勿把「非视频模型」都当 Nano） */
  const isNano = isNanoBanana2Model(data.selectedModel);
  const isImage2 = isImage2Model(data.selectedModel);
  const maxStandardRefImages = isImage2 ? 3 : 14;

  const seedanceRefDisplayEntries = useMemo(() => {
    const prompt = getNodeInspectorPromptText(data);
    if (!isSeedance20 || seedanceMode !== 'reference') {
      return buildPanelReferenceDisplayEntries(data.referenceImages);
    }
    const base = buildPanelReferenceDisplayEntries(data.referenceImages, {
      imagePreview: data.imagePreview,
      dedupeAgainstMain: shouldDedupePanelRefsAgainstMainPreview(data),
      referenceImageLabels: data.referenceImageLabels,
      projectAssets: projectAssetLabelRows,
    });
    let entries = appendPromptReferencedAssetDisplayEntries(
      base,
      prompt,
      projectAssetLabelRows,
      data.referenceImageLabels
    );
    entries = dedupePanelReferenceDisplayEntries(
      entries,
      data.referenceImageLabels,
      projectAssetLabelRows
    );
    if (shouldShowPanelMainImageSlot(data)) {
      entries = filterPanelReferenceDisplayEntriesExcludingMainPreview(
        entries,
        data.imagePreview,
        data.imageName,
        data.referenceImageLabels,
        projectAssetLabelRows
      );
    }
    // 主图格已在参考区展示时勿再补一条（Input 仅 imagePreview 会主图+参考各一张）
    if (
      !entries.length &&
      data.imagePreview?.trim() &&
      data.imageName?.trim() &&
      !isLikelyMainVideoUrl(data.imagePreview) &&
      !shouldShowPanelMainImageSlot(data)
    ) {
      const name = data.imageName.trim();
      const row = projectAssetLabelRows.find(
        (a) => a.name.trim() === name || a.slug === name
      );
      if (row?.url || entries.length === 0) {
        entries = [
          {
            url: resolvePanelReferenceSlotDisplayUrl(
              data.imagePreview,
              name,
              projectAssetLabelRows
            ),
            slotIndex: 0,
          },
        ];
      }
    }
    return entries;
  }, [
    isSeedance20,
    seedanceMode,
    data,
    data.referenceImages,
    data.referenceImageLabels,
    data.imagePreview,
    data.panelMainSlotVisible,
    projectAssetLabelRows,
  ]);

  const seedanceShowMainInRefGrid = useMemo(() => {
    if (!isSeedance20 || seedanceMode !== 'reference') return false;
    const p = data.imagePreview?.trim();
    if (!p || isLikelyMainVideoUrl(p) || !shouldShowPanelMainImageSlot(data)) return false;
    const mainKey = panelRefDisplayDedupeKey(p, data.imageName, projectAssetLabelRows);
    if (!mainKey) return true;
    const refs = data.referenceImages || [];
    const dupInRefs = refs.some((raw, i) => {
      const u = String(raw || '').trim();
      if (!u) return false;
      const cap = data.referenceImageLabels?.[i];
      const k = panelRefDisplayDedupeKey(
        resolvePanelReferenceSlotDisplayUrl(u, cap, projectAssetLabelRows),
        cap,
        projectAssetLabelRows
      );
      return k === mainKey;
    });
    return !dupInRefs;
  }, [
    isSeedance20,
    seedanceMode,
    data.imagePreview,
    data.imageName,
    data.panelMainSlotVisible,
    data.referenceImages,
    data.referenceImageLabels,
    projectAssetLabelRows,
  ]);

  const image2RefEntries = useMemo(() => {
    if (!isImage2) return [] as { url: string; slotIndex: number }[];
    const base = buildPanelReferenceDisplayEntries(data.referenceImages, {
      imagePreview: data.imagePreview,
      dedupeAgainstMain: shouldDedupePanelRefsAgainstMainPreview(data),
      referenceImageLabels: data.referenceImageLabels,
      projectAssets: projectAssetLabelRows,
    });
    return dedupePanelReferenceDisplayEntries(
      appendPromptReferencedAssetDisplayEntries(
        base,
        getNodeInspectorPromptText(data),
        projectAssetLabelRows,
        data.referenceImageLabels
      ),
      data.referenceImageLabels,
      projectAssetLabelRows
    );
  }, [
    isImage2,
    data,
    data.referenceImages,
    data.referenceImageLabels,
    data.imagePreview,
    data.panelMainSlotVisible,
    projectAssetLabelRows,
  ]);

  const image2ExtraRefImages = useMemo(
    () => image2RefEntries.map((e) => e.url),
    [image2RefEntries]
  );

  const image2ShowMainInRefGrid = useMemo(() => {
    if (!isImage2) return false;
    const p = data.imagePreview?.trim();
    return Boolean(p && !isLikelyMainVideoUrl(p)) && shouldShowPanelMainImageSlot(data);
  }, [isImage2, data.imagePreview, data.panelMainSlotVisible]);

  const image2RefSlotFilledCount = image2ShowMainInRefGrid
    ? 1 + image2ExtraRefImages.length
    : image2ExtraRefImages.length;

  /** 修正历史数据：referenceImages 条数多于面板格，删除后不应「冒出」旧图 */
  useEffect(() => {
    if (!isImage2) return;
    const patch = image2PanelRefsPatchIfChanged(data);
    if (patch) onUpdate(patch);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅 image2 参考槽与主图变化时压紧
  }, [
    isImage2,
    nodeId,
    data.referenceImages,
    data.referenceImageLabels,
    data.imagePreview,
    data.panelMainSlotVisible,
  ]);

  const hasInspectorNegative = Boolean(isKeling || isJimeng || isVidu || isSeedance);
  const [inspectorPanelHeights, setInspectorPanelHeights] =
    useState<InspectorPanelHeights>(loadInspectorPanelHeights);
  const inspectorHeightsRef = useRef(inspectorPanelHeights);
  inspectorHeightsRef.current = inspectorPanelHeights;

  useEffect(() => {
    try {
      localStorage.setItem(FLOWGEN_INSPECTOR_HEIGHTS_LS_KEY, JSON.stringify(inspectorPanelHeights));
    } catch {
      /* ignore */
    }
  }, [inspectorPanelHeights]);

  type InspectorResizeKind = 'assetsPrompt' | 'promptNegative' | 'negativeOrTail';

  const beginInspectorResize = useCallback(
    (kind: InspectorResizeKind, e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const startY = e.clientY;
      const start = { ...inspectorHeightsRef.current };
      const onMove = (ev: PointerEvent) => {
        const dy = ev.clientY - startY;
        if (kind === 'assetsPrompt') {
          // 第一条：只调素材区可视高度，下方整块随布局下移
          setInspectorPanelHeights({
            ...start,
            assetsScrollMaxPx: clampInspectorNum(
              start.assetsScrollMaxPx + dy,
              INSPECTOR_RESIZE_LIMITS.assetsMin,
              INSPECTOR_RESIZE_LIMITS.assetsMax
            ),
          });
        } else if (kind === 'promptNegative') {
          // 第二条：只调创意描述，负向提示高度不变，其下整体下移
          setInspectorPanelHeights({
            ...start,
            promptTextMinPx: clampInspectorNum(
              start.promptTextMinPx + dy,
              INSPECTOR_RESIZE_LIMITS.promptMin,
              INSPECTOR_RESIZE_LIMITS.promptMax
            ),
          });
        } else if (hasInspectorNegative) {
          setInspectorPanelHeights({
            ...start,
            negativeBlockMinPx: clampInspectorNum(
              start.negativeBlockMinPx + dy,
              INSPECTOR_RESIZE_LIMITS.negativeMin,
              INSPECTOR_RESIZE_LIMITS.negativeMax
            ),
          });
        } else {
          setInspectorPanelHeights({
            ...start,
            promptTextMinPx: clampInspectorNum(
              start.promptTextMinPx + dy,
              INSPECTOR_RESIZE_LIMITS.promptMin,
              INSPECTOR_RESIZE_LIMITS.promptMax
            ),
          });
        }
      };
      const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    },
    [hasInspectorNegative]
  );

  const promptMediaRefContext = useMemo(
    () => ({
      isKelingOmni,
      klingOmniTab,
      isJimeng,
      isNano,
      isImage2,
      isKeling: Boolean(isKeling),
      isVidu,
      isSeedance15,
      isSeedance20,
      seedanceMode,
      projectAssets: projectAssetLabelRows,
    }),
    [
    isKelingOmni,
    klingOmniTab,
    isJimeng,
    isNano,
    isImage2,
    isKeling,
    isVidu,
    isSeedance15,
    isSeedance20,
    seedanceMode,
      projectAssetLabelRows,
    ]
  );

  const promptMediaRefLabels = useMemo(
    () => buildPromptMediaRefLabels(data, promptMediaRefContext),
    [data, promptMediaRefContext]
  );

  /** @ 下拉仅面板已拖入素材；项目库全量用「扫描 @素材」 */
  const promptMentionItems = useMemo(
    () => buildInspectorPromptMentionItems(data, promptMediaRefContext),
    [data, promptMediaRefContext]
  );

  const mainImageSlotCaption = useMemo(() => {
    const p = data.imagePreview?.trim();
    if (!p) return '主图';
    return resolveMainImagePanelDisplayLabel(p, {
      imageName: data.imageName,
      projectAssets: projectAssetLabelRows,
      video: isLikelyMainVideoUrl(p),
    });
  }, [data.imagePreview, data.imageName, projectAssetLabelRows]);

  const projectAssetScanRows = useMemo(
    () =>
      projectAssetRefItems
        .filter((i) => i.kind === 'projectAsset')
        .map((i) => ({
          name: i.label.replace(/^素材·/, ''),
          slug: i.insertText.replace(/^@资产:/, ''),
        })),
    [projectAssetRefItems]
  );

  const [mentionOpen, setMentionOpen] = useState(false);
  /** 与 syncMentionFromPrompt 同步，避免重渲染/失焦时 textarea.selectionStart 滞后导致下拉过滤错或为空 */
  const [mentionCtx, setMentionCtx] = useState<{ atIndex: number; query: string } | null>(null);
  const [mentionHighlight, setMentionHighlight] = useState(0);
  /** 与 state 同步比较，避免同一次 @ 上下文重复 setState / 重置高亮 */
  const lastMentionSyncRef = useRef<{ atIndex: number; query: string } | null>(null);

  const applyInspectorReferenceFromUrlStringRef = useRef<
    (url: string, opts?: { kind?: 'image' | 'video'; assetName?: string }) => Promise<void>
  >(async () => {});
  const seedanceReferenceFromUrlRef = useRef<
    (url: string, kind?: 'image' | 'video', meta?: { assetName?: string }) => void
  >(() => {});
  const firstFrameFromUrlRef = useRef<
    (url: string, kind?: 'image' | 'video', meta?: { assetName?: string }) => void
  >(() => {});
  const lastFrameFromUrlRef = useRef<
    (url: string, kind?: 'image' | 'video', meta?: { assetName?: string }) => void
  >(() => {});

  const flMediaCaptions = useMemo(
    () => ({
      first: resolveFirstLastFramePanelDisplayLabel(data, 'first', projectAssetLabelRows),
      last: resolveFirstLastFramePanelDisplayLabel(data, 'last', projectAssetLabelRows),
    }),
    [
      data.firstFrameImage,
      data.firstFrameImageUrl,
      data.firstFrameImageLabel,
      data.lastFrameImage,
      data.lastFrameImageUrl,
      data.lastFrameImageLabel,
      projectAssetLabelRows,
    ]
  );
  useEffect(() => {
    if (promptMentionItems.length === 0) {
      setMentionOpen(false);
      setMentionCtx(null);
      lastMentionSyncRef.current = null;
    }
  }, [promptMentionItems.length]);

  const mentionDropdownItems = useMemo(() => {
    if (!mentionOpen || !mentionCtx) return [];
    return filterMediaRefs(promptMentionItems, mentionCtx.query);
  }, [mentionOpen, mentionCtx, promptMentionItems]);

  useEffect(() => {
    const onWin = (ev: Event) => {
      const d = (ev as CustomEvent<FlowgenMediaUrlDropDetail>).detail;
      if (!d?.targetNodeId || d.targetNodeId !== nodeId) return;
      if (d.dropZone === 'reference') {
        const items =
          d.assets && d.assets.length > 0
            ? d.assets.map((a) => ({
                url: a.url,
                kind: a.mime.startsWith('video/') ? ('video' as const) : ('image' as const),
                assetName: a.assetName,
              }))
            : [{ url: d.url, kind: d.kind, assetName: d.assetName }];
        for (const item of items) {
          void applyInspectorReferenceFromUrlStringRef.current(item.url, {
            kind: item.kind,
            assetName: item.assetName,
          });
        }
      } else if (d.dropZone === 'seedance-reference') {
        seedanceReferenceFromUrlRef.current(d.url, d.kind, {
          assetName: d.assetName,
        });
      } else if (d.dropZone === 'first-frame') {
        firstFrameFromUrlRef.current(d.url, d.kind, { assetName: d.assetName });
      } else if (d.dropZone === 'last-frame') {
        lastFrameFromUrlRef.current(d.url, d.kind, { assetName: d.assetName });
      }
    };
    window.addEventListener(FLOWGEN_MEDIA_URL_DROP, onWin);
    return () => window.removeEventListener(FLOWGEN_MEDIA_URL_DROP, onWin);
  }, [nodeId]);

  /** 仅可灵3.0 Omni 显示「从主体库文件选择」入口 */
  const supportsSubjectLibraryPicker =
    data.selectedModel === '可灵3.0 Omni';

  useEffect(() => {
    if (!supportsSubjectLibraryPicker && showLibraryModal) {
      setShowLibraryModal(false);
    }
  }, [supportsSubjectLibraryPicker, showLibraryModal]);

  /** 关闭主体库弹窗时重置表单（仅使用 newSubjectTag，勿引用已删除的 setNewSubjectCategory / setNewSubjectTagsText） */
  useEffect(() => {
    if (!showLibraryModal) {
      setLibraryKeyword('');
      setLibraryDetailOpenId(null);
      setLibraryCategoryFilter('全部');
      setSelectedLibraryIds([]);
      setShowCreateSubjectForm(false);
      setNewSubjectName('');
      setNewSubjectDataUrl('');
      setNewSubjectOtherViewUrls([]);
      setNewSubjectTag('');
      setNewSubjectDescription('');
    }
  }, [showLibraryModal]);

  // Kling 3.0 Omni：参考图片按 tab 分隔存储，避免相互污染显示/生成输入
  const getKlingOmniRefImages = (tab: 'multi' | 'instruction' | 'video'): string[] => {
    if (tab === 'multi') return data.klingOmniMultiReferenceImages || [];
    if (tab === 'instruction') return data.klingOmniInstructionReferenceImages || [];
    return data.klingOmniVideoReferenceImages || [];
  };

  const getKlingOmniRefElementIds = (tab: 'multi' | 'instruction' | 'video'): (string | undefined)[] => {
    const raw =
      tab === 'multi'
        ? data.klingOmniMultiReferenceElementIds
        : tab === 'instruction'
          ? data.klingOmniInstructionReferenceElementIds
          : data.klingOmniVideoReferenceElementIds;
    return raw ? [...raw] : [];
  };

  const updateKlingOmniRefImages = (
    tab: 'multi' | 'instruction' | 'video',
    next: string[],
    opts?: { elementIds?: (string | undefined)[] }
  ) => {
    const oldUrls = getKlingOmniRefImages(tab);
    const oldEids = getKlingOmniRefElementIds(tab);
    let nextElementIds: (string | undefined)[];
    if (opts?.elementIds && opts.elementIds.length === next.length) {
      nextElementIds = opts.elementIds;
    } else {
      nextElementIds = next.map((url, i) =>
        i < oldUrls.length && url === oldUrls[i] ? oldEids[i] : undefined
      );
    }
    if (tab === 'multi') {
      onUpdate({ klingOmniMultiReferenceImages: next, klingOmniMultiReferenceElementIds: nextElementIds });
    } else if (tab === 'instruction') {
      onUpdate({
        klingOmniInstructionReferenceImages: next,
        klingOmniInstructionReferenceElementIds: nextElementIds,
      });
    } else {
      onUpdate({ klingOmniVideoReferenceImages: next, klingOmniVideoReferenceElementIds: nextElementIds });
    }
  };

  const klingOmniActiveRefImages = isKelingOmni
    ? klingOmniTab === 'multi'
      ? getKlingOmniRefImages('multi')
      : klingOmniTab === 'instruction'
        ? getKlingOmniRefImages('instruction')
        : klingOmniTab === 'video'
          ? getKlingOmniRefImages('video')
          : []
    : data.referenceImages || [];

  /** 多图 / 指令 / 视频 tab：主图仅 imagePreview + 独立「主图」格（与 multi 一致） */
  const omniInspectorShowMainImageSlot = useMemo(() => {
    if (!isKelingOmni) return false;
    if (klingOmniTab !== 'multi' && klingOmniTab !== 'instruction' && klingOmniTab !== 'video') {
      return false;
    }
    const p = data.imagePreview?.trim();
    return Boolean(p && !isLikelyMainVideoUrl(p) && shouldShowPanelMainImageSlot(data));
  }, [isKelingOmni, klingOmniTab, data.imagePreview, data.panelMainSlotVisible]);

  /** 当前 Omni tab 对应的视频槽展示 URL（指令槽与视频参考槽互不共用） */
  const omniTabVideoDisplayUrl =
    klingOmniTab === 'instruction'
      ? getOmniInstructionVideoDisplayUrl(data)
      : klingOmniTab === 'video'
        ? getOmniVideoTabDisplayUrl(data)
        : undefined;

  const stableOmniTabVideoDisplayUrl = useStableInspectorMediaUrl(
    omniTabVideoDisplayUrl,
    isCurrentNodeRunning
  );

  const omniTabVideoPosterUrl = useMemo(() => {
    const u = stableOmniTabVideoDisplayUrl;
    if (!u) return undefined;
    const movs = data.referenceMovs || [];
    const normalizeMediaUrl = (raw?: string) => {
      const v = (raw || '').trim();
      if (!v) return '';
      try {
        const parsed = new URL(v, window.location.origin);
        return `${parsed.origin}${parsed.pathname}`;
      } catch {
        return v.split('?')[0].split('#')[0];
      }
    };
    const target = normalizeMediaUrl(u);
    const hit = movs.find((m) => normalizeMediaUrl(m.url) === target);
    if (hit?.posterDataUrl) return hit.posterDataUrl;
    return undefined;
  }, [stableOmniTabVideoDisplayUrl, data.referenceMovs]);

  const registerInspectorVideoRef = useCallback((videoId: string, el: HTMLVideoElement | null) => {
    videoRefs.current[videoId] = el;
  }, []);

  const setVideoPlayState = useCallback((videoId: string, playing: boolean) => {
    setVideoPlayingMap((prev) => patchVideoPlayingMap(prev, videoId, playing));
  }, []);

  const getKlingOmniTabText = (tab: 'multi' | 'instruction' | 'video' | 'frames') => {
    if (tab === 'multi') {
      return {
        prompt: data.klingOmniMultiPrompt ?? data.prompt ?? '',
        negativePrompt: data.klingOmniMultiNegativePrompt ?? data.negativePrompt ?? '',
      };
    }
    if (tab === 'instruction') {
      return {
        prompt: data.klingOmniInstructionPrompt ?? data.prompt ?? '',
        negativePrompt: data.klingOmniInstructionNegativePrompt ?? data.negativePrompt ?? '',
      };
    }
    if (tab === 'video') {
      return {
        prompt: data.klingOmniVideoPrompt ?? data.prompt ?? '',
        negativePrompt: data.klingOmniVideoNegativePrompt ?? data.negativePrompt ?? '',
      };
    }
    return {
      prompt: data.klingOmniFramesPrompt ?? data.prompt ?? '',
      negativePrompt: data.klingOmniFramesNegativePrompt ?? data.negativePrompt ?? '',
    };
  };

  /** 与 getNodeInspectorPromptText / setPromptByContext 一致，避免 Seedance 分 tab 字段与顶层 prompt 不同步 */
  const getInspectorPromptValue = (): string => getNodeInspectorPromptText(data);
  const inspectorPromptValue = getInspectorPromptValue();

  /** 参考槽/资产库变化时规范 @（勿监听 prompt，避免输入过程中被改写） */
  useLayoutEffect(() => {
    const patch = buildCanonicalInspectorPromptPatch(data, projectAssetLabelRows);
    if (!patch) return;
    onUpdate(patch);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅参考槽与资产库变化时规范 @
  }, [
    nodeId,
    data.selectedModel,
    data.seedanceGenerationMode,
    data.referenceImages,
    data.referenceImageLabels,
    data.imagePreview,
    data.imageName,
    data.firstFrameImage,
    data.firstFrameImageUrl,
    data.lastFrameImage,
    data.lastFrameImageUrl,
    data.firstFrameImageLabel,
    data.lastFrameImageLabel,
    data.klingOmniTab,
    data.klingOmniMultiReferenceImages,
    data.klingOmniInstructionReferenceImages,
    data.klingOmniVideoReferenceImages,
    projectAssetLabelRows,
  ]);
  const promptRefHighlights = useMemo(
    () => extractPromptRefHighlights(inspectorPromptValue),
    [inspectorPromptValue]
  );

  const setPromptByContext = (prompt: string) => {
    if (isKelingOmni) {
      const patch: any = { prompt };
      if (klingOmniTab === 'multi') patch.klingOmniMultiPrompt = prompt;
      else if (klingOmniTab === 'instruction') patch.klingOmniInstructionPrompt = prompt;
      else if (klingOmniTab === 'video') patch.klingOmniVideoPrompt = prompt;
      else patch.klingOmniFramesPrompt = prompt;
      onUpdate(patch);
      return;
    }
    if (isSeedance20) {
      const tabs = { ...(data.seedanceTabConfigs || {}) } as any;
      const cur = { ...(tabs[seedanceMode] || {}) };
      cur.prompt = prompt;
      tabs[seedanceMode] = cur;
      onUpdate({ prompt, seedanceTabConfigs: tabs });
      return;
    }
    onUpdate({ prompt });
  };

  const setNegativePromptByContext = (negativePrompt: string) => {
    if (isKelingOmni) {
      const patch: any = { negativePrompt };
      if (klingOmniTab === 'multi') patch.klingOmniMultiNegativePrompt = negativePrompt;
      else if (klingOmniTab === 'instruction') patch.klingOmniInstructionNegativePrompt = negativePrompt;
      else if (klingOmniTab === 'video') patch.klingOmniVideoNegativePrompt = negativePrompt;
      else patch.klingOmniFramesNegativePrompt = negativePrompt;
      onUpdate(patch);
      return;
    }
    if (isSeedance20) {
      const tabs = { ...(data.seedanceTabConfigs || {}) } as any;
      const cur = { ...(tabs[seedanceMode] || {}) };
      cur.negativePrompt = negativePrompt;
      tabs[seedanceMode] = cur;
      onUpdate({ negativePrompt, seedanceTabConfigs: tabs });
      return;
    }
    onUpdate({ negativePrompt });
  };

  const syncMentionFromPrompt = (text: string, cursor: number) => {
    if (promptMentionItems.length === 0) {
      setMentionOpen(false);
      setMentionCtx(null);
      lastMentionSyncRef.current = null;
      return;
    }
    const m = getActiveAtMention(text, cursor);
    if (!m) {
      setMentionOpen(false);
      setMentionCtx(null);
      lastMentionSyncRef.current = null;
      return;
    }
    // 只在“刚输入 @”或下拉已开启的连续输入中展示建议，避免点击已有 @图片1/@视频1 时自动弹窗
    const justTypedAt = cursor > 0 && text[cursor - 1] === '@';
    if (!mentionOpen && !justTypedAt) {
      setMentionOpen(false);
      setMentionCtx(null);
      lastMentionSyncRef.current = null;
      return;
    }
    const next = { atIndex: m.atIndex, query: m.query };
    const filtered = filterMediaRefs(promptMentionItems, m.query);
    if (filtered.length === 0) {
      setMentionOpen(false);
      setMentionCtx(null);
      lastMentionSyncRef.current = null;
      return;
    }
    const prevSnap = lastMentionSyncRef.current;
    const ctxChanged = !prevSnap || prevSnap.atIndex !== next.atIndex || prevSnap.query !== next.query;
    lastMentionSyncRef.current = next;
    setMentionCtx((s) => (s && s.atIndex === next.atIndex && s.query === next.query ? s : next));
    setMentionOpen(true);
    if (ctxChanged) setMentionHighlight(0);
  };

  const applyPromptMentionPick = (item: PromptMediaRefItem) => {
    const ta = promptTextareaRef.current;
    const text = getInspectorPromptValue();
    const cursor = ta ? ta.selectionStart ?? text.length : text.length;
    const mLive = getActiveAtMention(text, cursor);
    const atIndex = mentionCtx?.atIndex ?? mLive?.atIndex;
    if (atIndex == null) return;
    const before = text.slice(0, atIndex);
    const after = text.slice(cursor);
    const newText = before + item.insertText + after;
    const newPos = before.length + item.insertText.length;
    pendingPromptSelectionRef.current = { start: newPos, end: newPos };
    setPromptByContext(newText);
    setMentionOpen(false);
    setMentionCtx(null);
    lastMentionSyncRef.current = null;
    requestAnimationFrame(() => promptTextareaRef.current?.focus());
  };

  const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const el = e.target;
    const v = el.value;
    const cursor = el.selectionStart ?? v.length;
    const selEnd = el.selectionEnd ?? cursor;
    pendingPromptSelectionRef.current = { start: cursor, end: selEnd };
    setPromptByContext(v);
    syncMentionFromPrompt(v, cursor);
  };

  /** 根据项目素材名在文中补全 @资产:…（与手动 @ 下拉分离，下拉不含资产库项） */
  const runScanProjectAssetsOnPrompt = useCallback(() => {
    const ta = promptTextareaRef.current;
    const text = ta?.value ?? getInspectorPromptValue();
    const next = scanPromptAppendMediaTokensForNode(
      data,
      projectAssetRefItems,
      text,
      projectAssetLabelRows
    );
    if (next !== text) setPromptByContext(next);
  }, [data, projectAssetRefItems, projectAssetLabelRows, getInspectorPromptValue]);

  /** 粘贴为纯文本（如从 AI 对话 Ctrl+C 复制），不触发自动 @ 扫描 */
  const handlePromptPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const plain = e.clipboardData.getData('text/plain');
    if (typeof plain !== 'string' || plain.length === 0) return;
    e.preventDefault();
    const ta = e.currentTarget;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    const text = getInspectorPromptValue();
    const newText = text.slice(0, start) + plain + text.slice(end);
    setPromptByContext(newText);
    const pos = start + plain.length;
    pendingPromptSelectionRef.current = { start: pos, end: pos };
    requestAnimationFrame(() => {
      ta.focus();
      syncMentionFromPrompt(newText, pos);
    });
  };
  const syncPromptHighlightScroll = useCallback((el: HTMLTextAreaElement) => {
    const hl = promptHighlightRef.current;
    const inner = promptHighlightInnerRef.current;
    if (!hl) return;
    hl.scrollTop = el.scrollTop;
    hl.scrollLeft = el.scrollLeft;
    if (inner) {
      inner.style.minHeight = `${el.scrollHeight}px`;
      inner.style.width = `${el.clientWidth}px`;
    }
  }, []);

  useLayoutEffect(() => {
    const ta = promptTextareaRef.current;
    if (!ta) return;
    const pending = pendingPromptSelectionRef.current;
    if (pending) {
      pendingPromptSelectionRef.current = null;
      const len = ta.value.length;
      const start = Math.min(pending.start, len);
      const end = Math.min(pending.end, len);
      try {
        ta.setSelectionRange(start, end);
      } catch {
        /* ignore */
      }
    }
    syncPromptHighlightScroll(ta);
  }, [inspectorPromptValue, syncPromptHighlightScroll]);

  useEffect(() => {
    const ta = promptTextareaRef.current;
    if (!ta || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => syncPromptHighlightScroll(ta));
    ro.observe(ta);
    return () => ro.disconnect();
  }, [syncPromptHighlightScroll, nodeId]);

  const handlePromptKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    const text = ta.value;
    const cursor = ta.selectionStart ?? 0;
    const m = getActiveAtMention(text, cursor);
    if (e.key === 'Escape') {
      setMentionOpen(false);
      setMentionCtx(null);
      lastMentionSyncRef.current = null;
      return;
    }
    if (promptMentionItems.length === 0) return;
    const q = m?.query ?? (mentionOpen && mentionCtx ? mentionCtx.query : undefined);
    if (q === undefined) return;
    const filtered = filterMediaRefs(promptMentionItems, q);
    if (filtered.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setMentionOpen(true);
      setMentionHighlight((h) => (h + 1) % filtered.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setMentionOpen(true);
      setMentionHighlight((h) => (h - 1 + filtered.length) % filtered.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const pick = filtered[mentionHighlight % filtered.length] ?? filtered[0];
      if (pick) applyPromptMentionPick(pick);
    }
  };

  const switchSeedance20Tab = (target: 'text' | 'image' | 'reference') => {
    const tabs = { ...(data.seedanceTabConfigs || {}) } as any;
    const current = seedanceMode;
    const currentSnapshot: any = {
      prompt: getInspectorPromptValue(),
      negativePrompt: data.negativePrompt || '',
    };
    if (current === 'image') {
      currentSnapshot.firstFrameImage = data.firstFrameImage;
      currentSnapshot.lastFrameImage = data.lastFrameImage;
      currentSnapshot.firstFrameImageUrl = data.firstFrameImageUrl;
      currentSnapshot.lastFrameImageUrl = data.lastFrameImageUrl;
      currentSnapshot.firstFrameLocalRef = data.firstFrameLocalRef;
      currentSnapshot.lastFrameLocalRef = data.lastFrameLocalRef;
    }
    if (current === 'reference') {
      currentSnapshot.referenceImages = data.referenceImages ? [...data.referenceImages] : [];
      currentSnapshot.referenceImageLabels = data.referenceImageLabels
        ? [...data.referenceImageLabels]
        : [];
      currentSnapshot.referenceMovs = data.referenceMovs ? [...data.referenceMovs] : [];
      currentSnapshot.referenceAudios = data.referenceAudios ? [...data.referenceAudios] : [];
    }
    tabs[current] = currentSnapshot;

    const next = tabs[target] || {};
    const patch: any = {
      seedanceGenerationMode: target,
      seedanceTabConfigs: tabs,
      prompt: next.prompt || '',
      negativePrompt: next.negativePrompt || '',
    };
    if (target === 'image') {
      patch.firstFrameImage = next.firstFrameImage;
      patch.lastFrameImage = next.lastFrameImage;
      patch.firstFrameImageUrl = next.firstFrameImageUrl;
      patch.lastFrameImageUrl = next.lastFrameImageUrl;
      patch.firstFrameLocalRef = next.firstFrameLocalRef;
      patch.lastFrameLocalRef = next.lastFrameLocalRef;
      patch.referenceImages = [];
      patch.referenceMovs = [];
      patch.referenceAudios = [];
      if (shouldMigrateSeedance20AspectToDefault(data.seedanceAspectRatio)) {
        patch.seedanceAspectRatio = getSeedanceDefaultAspectRatio(data.selectedModel);
      }
    } else if (target === 'reference') {
      const refPatch = referenceImagesDedupePatchIfNeeded(
        {
          referenceImages: next.referenceImages || [],
          referenceImageLabels: next.referenceImageLabels || [],
          imagePreview: data.imagePreview,
          panelMainSlotVisible: data.panelMainSlotVisible,
        },
        {
          dedupeAgainstMain: shouldDedupePanelRefsAgainstMainPreview(data),
          projectAssets: projectAssetLabelRows,
        }
      );
      patch.referenceImages = refPatch?.referenceImages ?? (next.referenceImages || []);
      patch.referenceImageLabels =
        refPatch?.referenceImageLabels ?? (next.referenceImageLabels || []);
      patch.referenceMovs = next.referenceMovs || [];
      patch.referenceAudios = next.referenceAudios || [];
      if (refPatch) {
        tabs.reference = {
          ...(tabs.reference || {}),
          referenceImages: refPatch.referenceImages,
          referenceImageLabels: refPatch.referenceImageLabels,
        };
        patch.seedanceTabConfigs = tabs;
      }
      patch.seedanceReferenceRatioMode = data.seedanceReferenceRatioMode || 'force';
      patch.firstFrameImage = undefined;
      patch.lastFrameImage = undefined;
      patch.firstFrameImageUrl = undefined;
      patch.lastFrameImageUrl = undefined;
      if (shouldMigrateSeedance20AspectToDefault(data.seedanceAspectRatio)) {
        patch.seedanceAspectRatio = getSeedanceDefaultAspectRatio(data.selectedModel);
      }
    } else {
      patch.firstFrameImage = undefined;
      patch.lastFrameImage = undefined;
      patch.firstFrameImageUrl = undefined;
      patch.lastFrameImageUrl = undefined;
      patch.referenceImages = [];
      patch.referenceMovs = [];
      patch.referenceAudios = [];
      if (shouldMigrateSeedance20AspectToDefault(data.seedanceAspectRatio)) {
        patch.seedanceAspectRatio = getSeedanceDefaultAspectRatio(data.selectedModel);
      }
    }
    onUpdate(patch);
  };

  // 切换节点或 data.klingOmniTab 变化时与节点数据对齐，避免素材引用 @ 列表仍用上一节点的 tab
  useEffect(() => {
    if (!isKelingOmni) return;
    setKlingOmniTab((data.klingOmniTab || 'multi') as 'multi' | 'instruction' | 'video' | 'frames');
  }, [isKelingOmni, nodeId, data.klingOmniTab]);

  useEffect(() => {
    if (data.selectedModel !== '可灵3.0 Omni') return;
    // 仅在旧数据（没有显式 tab 状态）时做一次迁移，避免把“视频参考”新填的视频误搬到“指令变换”。
    if (data.klingOmniTab) return;
    const patch = migrateLegacyOmniVideoToInstructionSlot(data);
    if (patch) onUpdate(patch);
  }, [data.selectedModel, data.klingOmniTab, data.klingOmniVideoUrl, data.klingOmniVideoPreviewUrl]);

  /**
   * 统一默认装载规则（在模型/Tab 切换时执行，而不是点击运行时）：
   * - 主预览为图片：可进首帧/多图参考首张
   * - 主预览为视频：可进视频素材槽
   * 仅在目标槽位为空时补齐，不覆盖用户手动设置。
   */
  useEffect(() => {
    const main = (data.imagePreview || '').trim();
    if (!main) return;
    const mainIsVideo = isLikelyMainVideoUrl(main);
    const patch: Partial<NodeData> = {};

    const hasRefImage = (list?: string[]) => Boolean(list && list.length > 0);
    const hasRefMov = Boolean((data.referenceMovs || []).length > 0);
    const hasFirstFrame = Boolean(
      data.firstFrameImage || data.firstFrameImageUrl || data.firstFrameLocalRef
    );

    // 首帧类模型：主图默认进首帧
    if (
      !mainIsVideo &&
      !hasFirstFrame &&
      (
        data.selectedModel === '可灵 2.5 Turbo' ||
        data.selectedModel === 'vidu 2.0' ||
        data.selectedModel === 'seedance1.5-pro' ||
        (isSeedance20 && seedanceMode === 'image') ||
        isJimeng ||
        (isKelingOmni && klingOmniTab === 'frames')
      )
    ) {
      const frameMain =
        isFlowgenAssetThumbUrl(main) ? flowgenAssetFileUrlFromMediaUrl(main) : main;
      // 主图 blob 与首帧勿共用同一 object URL（运行/刷新时 revoke 主图会连带首帧裂图）
      if (isSeedance20 && seedanceMode === 'image' && data.imageLocalRef) {
        patch.firstFrameLocalRef = data.imageLocalRef;
      } else {
        patch.firstFrameImage = frameMain;
      patch.firstFrameImageUrl = undefined;
    }
      const frameLabel =
        projectAssetDisplayNameFromUrl(frameMain, projectAssetLabelRows) ||
        projectAssetDisplayNameFromUrl(main, projectAssetLabelRows) ||
        '';
      if (frameLabel) patch.firstFrameImageLabel = frameLabel;
    }

    // Seedance2.0 参考生视频：主图仅走 imagePreview + @主图；referenceImages 仅 @图片1/@图片2…
    if (isSeedance20 && seedanceMode === 'reference' && mainIsVideo && !hasRefMov) {
        patch.referenceMovs = [{ url: main }];
    }

    // Omni：按当前 tab 装载默认素材
    if (isKelingOmni) {
      const tab = klingOmniTab;
      // 多图参考：主图仅 imagePreview + 独立「主图」格展示，不写入 multi 数组（避免运行后出现重复「图片1」）
      if (tab === 'multi' && !mainIsVideo && !hasRefImage(data.klingOmniMultiReferenceImages)) {
        /* no-op */
      }
      if (tab === 'instruction') {
        // 主图仅 imagePreview + 独立「主图」格，不写入 instruction 参考数组（与 multi 一致）
        if (
          mainIsVideo &&
          !data.klingOmniInstructionVideoUrl &&
          !data.klingOmniInstructionVideoPreviewUrl &&
          !data.klingOmniInstructionVideoManuallyCleared
        ) {
          patch.klingOmniInstructionVideoPreviewUrl = main;
          patch.klingOmniInstructionVideoUrl = undefined;
          patch.referenceMovs = [{ url: main }];
        }
      }
      if (tab === 'video') {
        // 主图仅 imagePreview + 独立「主图」格，不写入 video 参考数组（与 multi 一致）
        if (
          mainIsVideo &&
          !data.klingOmniVideoUrl &&
          !data.klingOmniVideoPreviewUrl &&
          !data.klingOmniVideoManuallyCleared
        ) {
          patch.klingOmniVideoPreviewUrl = main;
          patch.klingOmniVideoUrl = undefined;
          patch.referenceMovs = [{ url: main }];
        }
      }
    }

    if (isKelingOmni && omniInspectorShowMainImageSlot) {
      const mainPrev = main;
      const stripDup = (list?: string[]) => {
        if (!list?.length) return undefined;
        const next = list.filter((u) => !isDuplicateOfMainImagePreview(u, mainPrev));
        return next.length === list.length ? undefined : next;
      };
      if (klingOmniTab === 'instruction') {
        const next = stripDup(data.klingOmniInstructionReferenceImages);
        if (next) patch.klingOmniInstructionReferenceImages = next;
      }
      if (klingOmniTab === 'video') {
        const next = stripDup(data.klingOmniVideoReferenceImages);
        if (next) patch.klingOmniVideoReferenceImages = next;
      }
    }

    if (Object.keys(patch).length > 0) {
      if (isImage2 && localStorage.getItem('flowgen:debugImage2') === '1') {
        try {
          const pr = (patch as Partial<NodeData>).referenceImages;
          console.info(
            `[FlowGen:image2-debug] inspector-default-fill ${JSON.stringify(
              {
                nodeId,
                patchKeys: Object.keys(patch),
                newRefCount: Array.isArray(pr) ? pr.length : 0,
              },
              null,
              2
            )}`
          );
        } catch {
          /* ignore */
        }
      }
      onUpdate(patch);
    }
  }, [
    data.selectedModel,
    data.imagePreview,
    data.imageLocalRef,
    data.firstFrameImage,
    data.firstFrameImageUrl,
    data.firstFrameLocalRef,
    data.referenceImages,
    data.referenceMovs,
    data.jimengGenerationMode,
    data.klingOmniMultiReferenceImages,
    data.klingOmniInstructionReferenceImages,
    data.klingOmniVideoReferenceImages,
    data.klingOmniInstructionVideoUrl,
    data.klingOmniInstructionVideoPreviewUrl,
    data.klingOmniInstructionVideoManuallyCleared,
    data.klingOmniVideoUrl,
    data.klingOmniVideoPreviewUrl,
    data.klingOmniVideoManuallyCleared,
    isNano,
    isImage2,
    isJimeng,
    isSeedance20,
    isKelingOmni,
    seedanceMode,
    klingOmniTab,
    omniInspectorShowMainImageSlot,
    onUpdate,
  ]);

  /** 修复历史数据：首帧与主图共用同一 blob URL，运行失败后首帧槽裂图 */
  useEffect(() => {
    if (!isSeedance20 || seedanceMode !== 'image') return;
    const main = (data.imagePreview || '').trim();
    const ff = (data.firstFrameImage || '').trim();
    if (!main || !ff || ff !== main || !main.startsWith('blob:')) return;
    if (!data.imageLocalRef || data.firstFrameLocalRef) return;
    let cancelled = false;
    void (async () => {
      const blob = await getLocalMediaBlob(data.imageLocalRef!);
      if (!blob || cancelled) return;
      onUpdate({
        firstFrameLocalRef: data.imageLocalRef,
        firstFrameImage: URL.createObjectURL(blob),
        firstFrameImageUrl: undefined,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [
    isSeedance20,
    seedanceMode,
    data.imagePreview,
    data.firstFrameImage,
    data.imageLocalRef,
    data.firstFrameLocalRef,
    onUpdate,
  ]);

  // --- Handlers ---
  
  const handleModelChange = (model: string) => {
    const oldModel = data.selectedModel;
    const isSwitchingModel = oldModel && oldModel !== model;
    
    if (isSwitchingModel) {
      // 保存当前模型的配置
      const currentModelConfigs = { ...(data.modelConfigs || {}) };
      
      if (isNanoBanana2Model(oldModel)) {
        currentModelConfigs[MODEL_NANO_BANANA_2] = {
          prompt: data.prompt,
          negativePrompt: data.negativePrompt,
          aspectRatio: data.aspectRatio,
          numberOfImages: data.numberOfImages,
          referenceImages: data.referenceImages ? [...data.referenceImages] : undefined,
        };
      } else if (isImage2Model(oldModel)) {
        const img2Compact = compactImage2PanelReferences(data);
        currentModelConfigs.image2 = {
          prompt: data.prompt,
          negativePrompt: data.negativePrompt,
          numberOfImages: data.numberOfImages,
          referenceImages: img2Compact.referenceImages.length
            ? [...img2Compact.referenceImages]
            : undefined,
          referenceImageLabels: img2Compact.referenceImageLabels.length
            ? [...img2Compact.referenceImageLabels]
            : undefined,
          imagePreview: data.imagePreview,
          imageName: data.imageName,
          image2Style: data.image2Style,
          image2AspectRatio: data.image2AspectRatio,
          image2ImageSize: data.image2ImageSize,
        };
      } else if (oldModel === '可灵 2.5 Turbo') {
        // 保存可灵的配置
        currentModelConfigs['可灵 2.5 Turbo'] = {
          prompt: data.prompt,
          negativePrompt: data.negativePrompt,
          firstFrameImage: data.firstFrameImage,
          lastFrameImage: data.lastFrameImage,
          firstFrameImageUrl: data.firstFrameImageUrl,
          lastFrameImageUrl: data.lastFrameImageUrl,
          quality: data.quality,
          duration: data.duration,
          creativityLevel: data.creativityLevel,
          numberOfImages: data.numberOfImages,
          aspectRatio: data.aspectRatio,
        };
      } else if (oldModel === '可灵3.0 Omni') {
        currentModelConfigs['可灵3.0 Omni'] = {
          prompt: data.prompt,
          negativePrompt: data.negativePrompt,
          firstFrameImage: data.firstFrameImage,
          lastFrameImage: data.lastFrameImage,
          firstFrameImageUrl: data.firstFrameImageUrl,
          lastFrameImageUrl: data.lastFrameImageUrl,
          quality: data.quality,
          duration: data.duration,
          numberOfImages: data.numberOfImages,
          aspectRatio: data.aspectRatio,
          klingAudioSync: data.klingAudioSync,
          referenceImages: data.referenceImages ? [...data.referenceImages] : undefined,
          klingOmniMultiReferenceImages: data.klingOmniMultiReferenceImages ? [...data.klingOmniMultiReferenceImages] : undefined,
          klingOmniInstructionReferenceImages: data.klingOmniInstructionReferenceImages ? [...data.klingOmniInstructionReferenceImages] : undefined,
          klingOmniVideoReferenceImages: data.klingOmniVideoReferenceImages ? [...data.klingOmniVideoReferenceImages] : undefined,
          klingOmniMultiReferenceElementIds: data.klingOmniMultiReferenceElementIds
            ? [...data.klingOmniMultiReferenceElementIds]
            : undefined,
          klingOmniInstructionReferenceElementIds: data.klingOmniInstructionReferenceElementIds
            ? [...data.klingOmniInstructionReferenceElementIds]
            : undefined,
          klingOmniVideoReferenceElementIds: data.klingOmniVideoReferenceElementIds
            ? [...data.klingOmniVideoReferenceElementIds]
            : undefined,
          klingOmniMultiPrompt: data.klingOmniMultiPrompt,
          klingOmniMultiNegativePrompt: data.klingOmniMultiNegativePrompt,
          klingOmniInstructionPrompt: data.klingOmniInstructionPrompt,
          klingOmniInstructionNegativePrompt: data.klingOmniInstructionNegativePrompt,
          klingOmniVideoPrompt: data.klingOmniVideoPrompt,
          klingOmniVideoNegativePrompt: data.klingOmniVideoNegativePrompt,
          klingOmniFramesPrompt: data.klingOmniFramesPrompt,
          klingOmniFramesNegativePrompt: data.klingOmniFramesNegativePrompt,
          klingOmniTab: data.klingOmniTab,
          klingOmniVideoPreviewUrl: data.klingOmniVideoPreviewUrl,
          klingOmniVideoUrl: data.klingOmniVideoUrl,
          klingOmniInstructionVideoPreviewUrl: data.klingOmniInstructionVideoPreviewUrl,
          klingOmniInstructionVideoUrl: data.klingOmniInstructionVideoUrl,
        };
      } else if (oldModel === '即梦3.0 Pro') {
        currentModelConfigs['即梦3.0 Pro'] = {
          prompt: data.prompt,
          negativePrompt: data.negativePrompt,
          jimengGenerationMode: data.jimengGenerationMode,
          jimengProfessionalMode: data.jimengProfessionalMode,
          jimengResolution: data.jimengResolution,
          jimengVideoRatio: data.jimengVideoRatio,
          duration: data.duration,
          numberOfImages: data.numberOfImages,
          firstFrameImage: data.firstFrameImage,
          firstFrameImageUrl: data.firstFrameImageUrl,
          jimengImages: data.jimengImages ? [...data.jimengImages] : undefined,
        };
      } else if (oldModel === 'vidu 2.0') {
        currentModelConfigs['vidu 2.0'] = {
          prompt: data.prompt,
          negativePrompt: data.negativePrompt,
          firstFrameImage: data.firstFrameImage,
          lastFrameImage: data.lastFrameImage,
          firstFrameImageUrl: data.firstFrameImageUrl,
          lastFrameImageUrl: data.lastFrameImageUrl,
          viduDuration: data.viduDuration,
          viduClarity: data.viduClarity,
          viduMotionRange: data.viduMotionRange,
          aspectRatio: data.aspectRatio,
          numberOfImages: data.numberOfImages,
        };
      } else if (['seedance1.5-pro', 'seedance2.0 (高质量版)', 'seedance2.0 (急速版)'].includes(oldModel || '')) {
        (currentModelConfigs as any)[oldModel as string] = {
          prompt: data.prompt,
          negativePrompt: data.negativePrompt,
          firstFrameImage: data.firstFrameImage,
          lastFrameImage: data.lastFrameImage,
          firstFrameImageUrl: data.firstFrameImageUrl,
          lastFrameImageUrl: data.lastFrameImageUrl,
          numberOfImages: data.numberOfImages,
          seedanceResolution:
            (oldModel === 'seedance2.0 (急速版)' || oldModel === 'seedance1.5-pro') &&
            data.seedanceResolution === '1080p'
              ? '720p'
              : data.seedanceResolution,
          seedanceAspectRatio: data.seedanceAspectRatio,
          seedanceDuration: data.seedanceDuration,
          seedanceGenerateAudio: data.seedanceGenerateAudio,
          seedanceFixedCamera: data.seedanceFixedCamera,
          seedanceGenerationMode: data.seedanceGenerationMode,
          seedanceReferenceRatioMode: data.seedanceReferenceRatioMode,
          seedanceReferenceWebSearch: data.seedanceReferenceWebSearch,
          seedanceTabConfigs: data.seedanceTabConfigs,
          referenceImages: data.referenceImages ? [...data.referenceImages] : undefined,
          referenceMovs: data.referenceMovs ? [...data.referenceMovs] : undefined,
          referenceAudios: data.referenceAudios ? [...data.referenceAudios] : undefined,
        };
      }
      
      // 准备更新数据：先清空旧模型的属性，再应用新模型的配置
      const updateData: any = {
        selectedModel: model,
        modelConfigs: currentModelConfigs,
      };
      if (model !== MODEL_IMAGE_2) {
        updateData.image2Style = undefined;
        updateData.image2AspectRatio = undefined;
        updateData.image2ImageSize = undefined;
      }

      // 根据新模型类型，设置相应的属性
      if (model === MODEL_NANO_BANANA_2) {
        const nanoConfig = (
          currentModelConfigs[MODEL_NANO_BANANA_2] ||
          (currentModelConfigs as Record<string, unknown>)['Nano Banana Pro(生图)'] ||
          {}
        ) as NonNullable<NodeData['modelConfigs']>['Nano Banana 2.0'];
        // 恢复 Nano Banana 2.0 的配置
        updateData.prompt = nanoConfig.prompt || '';
        updateData.negativePrompt = nanoConfig.negativePrompt || '';
        updateData.aspectRatio = nanoConfig.aspectRatio || '1:1';
        updateData.numberOfImages = nanoConfig.numberOfImages || '1张';
        updateData.referenceImages = nanoConfig.referenceImages || [];
        // 清空可灵特有的属性
        updateData.firstFrameImage = undefined;
        updateData.lastFrameImage = undefined;
        updateData.firstFrameImageUrl = undefined;
        updateData.lastFrameImageUrl = undefined;
        updateData.quality = undefined;
        updateData.duration = undefined;
        updateData.creativityLevel = undefined;
      } else if (model === MODEL_IMAGE_2) {
        const img2 = (currentModelConfigs.image2 || {}) as NonNullable<NodeData['modelConfigs']>['image2'];
        updateData.prompt = img2.prompt ?? '';
        updateData.negativePrompt = img2.negativePrompt ?? '';
        updateData.numberOfImages = img2.numberOfImages || '1张';
        updateData.referenceImages = img2.referenceImages != null ? [...img2.referenceImages] : [];
        updateData.referenceImageLabels =
          img2.referenceImageLabels != null ? [...img2.referenceImageLabels] : undefined;
        Object.assign(updateData, image2MainPatchOnModelSwitch(currentModelConfigs.image2, data));
        const ar = img2.image2AspectRatio || '1:1';
        updateData.image2AspectRatio = ar;
        updateData.image2ImageSize = image2CoerceSizeForAspect(ar, img2.image2ImageSize);
        updateData.image2Style = img2.image2Style === 'natural' ? 'natural' : 'vivid';
        updateData.firstFrameImage = undefined;
        updateData.lastFrameImage = undefined;
        updateData.firstFrameImageUrl = undefined;
        updateData.lastFrameImageUrl = undefined;
        updateData.quality = undefined;
        updateData.duration = undefined;
        updateData.creativityLevel = undefined;
        const img2Compact = compactImage2PanelReferences({
          imagePreview: updateData.imagePreview,
          panelMainSlotVisible: data.panelMainSlotVisible,
          referenceImages: updateData.referenceImages || [],
          referenceImageLabels: updateData.referenceImageLabels,
        });
        updateData.referenceImages = img2Compact.referenceImages;
        updateData.referenceImageLabels = img2Compact.referenceImageLabels;
      } else if (model === '可灵 2.5 Turbo') {
        // 加载可灵的配置
        const kelingConfig = currentModelConfigs['可灵 2.5 Turbo'] || {};
        // 恢复可灵的配置
        updateData.prompt = kelingConfig.prompt || '';
        updateData.negativePrompt = kelingConfig.negativePrompt || '';
        updateData.firstFrameImage = kelingConfig.firstFrameImage;
        updateData.lastFrameImage = kelingConfig.lastFrameImage;
        updateData.firstFrameImageUrl = kelingConfig.firstFrameImageUrl;
        updateData.lastFrameImageUrl = kelingConfig.lastFrameImageUrl;
        updateData.quality = kelingConfig.quality || '高质量';
        updateData.duration = kelingConfig.duration || '5s';
        updateData.creativityLevel = kelingConfig.creativityLevel ?? 50;
        updateData.numberOfImages = kelingConfig.numberOfImages || '1条';
        updateData.aspectRatio = kelingConfig.aspectRatio || '16:9';
        updateData.klingAudioSync = undefined;
        Object.assign(updateData, clearInheritedPanelRefsOnFrameModelSwitch());
      } else if (model === '可灵3.0 Omni') {
        const omniConfig = currentModelConfigs['可灵3.0 Omni'] || {};
        const legacyRefImages = omniConfig.referenceImages || [];
        const legacyTab = omniConfig.klingOmniTab || 'multi';
        const activeTab = (omniConfig.klingOmniTab || 'multi') as 'multi' | 'instruction' | 'video' | 'frames';
        const activeTabPrompt =
          activeTab === 'multi'
            ? (omniConfig.klingOmniMultiPrompt ?? omniConfig.prompt ?? '')
            : activeTab === 'instruction'
              ? (omniConfig.klingOmniInstructionPrompt ?? omniConfig.prompt ?? '')
              : activeTab === 'video'
                ? (omniConfig.klingOmniVideoPrompt ?? omniConfig.prompt ?? '')
                : (omniConfig.klingOmniFramesPrompt ?? omniConfig.prompt ?? '');
        const activeTabNegativePrompt =
          activeTab === 'multi'
            ? (omniConfig.klingOmniMultiNegativePrompt ?? omniConfig.negativePrompt ?? '')
            : activeTab === 'instruction'
              ? (omniConfig.klingOmniInstructionNegativePrompt ?? omniConfig.negativePrompt ?? '')
              : activeTab === 'video'
                ? (omniConfig.klingOmniVideoNegativePrompt ?? omniConfig.negativePrompt ?? '')
                : (omniConfig.klingOmniFramesNegativePrompt ?? omniConfig.negativePrompt ?? '');
        updateData.prompt = activeTabPrompt;
        updateData.negativePrompt = activeTabNegativePrompt;
        updateData.firstFrameImage = omniConfig.firstFrameImage;
        updateData.lastFrameImage = omniConfig.lastFrameImage;
        updateData.firstFrameImageUrl = omniConfig.firstFrameImageUrl;
        updateData.lastFrameImageUrl = omniConfig.lastFrameImageUrl;
        updateData.quality = omniConfig.quality || '高质量';
        updateData.duration = omniConfig.duration || '5s';
        updateData.numberOfImages = omniConfig.numberOfImages || '1条';
        updateData.aspectRatio = omniConfig.aspectRatio || '16:9';
        updateData.klingAudioSync = omniConfig.klingAudioSync ?? false;
        updateData.klingOmniTab = omniConfig.klingOmniTab || 'multi';
        updateData.klingOmniVideoPreviewUrl = omniConfig.klingOmniVideoPreviewUrl;
        updateData.klingOmniVideoUrl = omniConfig.klingOmniVideoUrl;
        updateData.klingOmniInstructionVideoPreviewUrl = omniConfig.klingOmniInstructionVideoPreviewUrl;
        updateData.klingOmniInstructionVideoUrl = omniConfig.klingOmniInstructionVideoUrl;
        updateData.klingOmniMultiPrompt = omniConfig.klingOmniMultiPrompt ?? omniConfig.prompt ?? '';
        updateData.klingOmniMultiNegativePrompt = omniConfig.klingOmniMultiNegativePrompt ?? omniConfig.negativePrompt ?? '';
        updateData.klingOmniInstructionPrompt = omniConfig.klingOmniInstructionPrompt ?? omniConfig.prompt ?? '';
        updateData.klingOmniInstructionNegativePrompt = omniConfig.klingOmniInstructionNegativePrompt ?? omniConfig.negativePrompt ?? '';
        updateData.klingOmniVideoPrompt = omniConfig.klingOmniVideoPrompt ?? omniConfig.prompt ?? '';
        updateData.klingOmniVideoNegativePrompt = omniConfig.klingOmniVideoNegativePrompt ?? omniConfig.negativePrompt ?? '';
        updateData.klingOmniFramesPrompt = omniConfig.klingOmniFramesPrompt ?? omniConfig.prompt ?? '';
        updateData.klingOmniFramesNegativePrompt = omniConfig.klingOmniFramesNegativePrompt ?? omniConfig.negativePrompt ?? '';
        updateData.creativityLevel = undefined;
        updateData.klingOmniMultiReferenceImages = omniConfig.klingOmniMultiReferenceImages ?? (legacyTab === 'multi' ? legacyRefImages : []);
        updateData.klingOmniInstructionReferenceImages = omniConfig.klingOmniInstructionReferenceImages ?? (legacyTab === 'instruction' ? legacyRefImages : []);
        updateData.klingOmniVideoReferenceImages = omniConfig.klingOmniVideoReferenceImages ?? (legacyTab === 'video' ? legacyRefImages : []);
        updateData.klingOmniMultiReferenceElementIds = omniConfig.klingOmniMultiReferenceElementIds;
        updateData.klingOmniInstructionReferenceElementIds = omniConfig.klingOmniInstructionReferenceElementIds;
        updateData.klingOmniVideoReferenceElementIds = omniConfig.klingOmniVideoReferenceElementIds;
        Object.assign(updateData, clearInheritedPanelRefsOnFrameModelSwitch());
      } else if (model === '即梦3.0 Pro') {
        const jimengConfig = currentModelConfigs['即梦3.0 Pro'] || {};
        updateData.prompt = jimengConfig.prompt || '';
        updateData.negativePrompt = jimengConfig.negativePrompt || '';
        updateData.jimengGenerationMode = jimengConfig.jimengGenerationMode || 'text';
        updateData.jimengProfessionalMode = jimengConfig.jimengProfessionalMode ?? false;
        updateData.jimengResolution = jimengConfig.jimengResolution || '1080p';
        updateData.jimengVideoRatio = jimengConfig.jimengVideoRatio || '自动匹配';
        updateData.duration = jimengConfig.duration || '5s';
        updateData.numberOfImages = jimengConfig.numberOfImages || '1条';
        updateData.firstFrameImage = jimengConfig.firstFrameImage;
        updateData.firstFrameImageUrl = jimengConfig.firstFrameImageUrl;
         updateData.jimengImages = [];
        Object.assign(updateData, clearInheritedPanelRefsOnFrameModelSwitch());
        updateData.lastFrameImage = undefined;
        updateData.lastFrameImageUrl = undefined;
        updateData.quality = undefined;
        updateData.creativityLevel = undefined;
        updateData.aspectRatio = undefined;
      } else if (model === 'vidu 2.0') {
        const viduConfig = currentModelConfigs['vidu 2.0'] || {};
        updateData.prompt = viduConfig.prompt || '';
        updateData.negativePrompt = viduConfig.negativePrompt || '';
        updateData.firstFrameImage = viduConfig.firstFrameImage;
        updateData.lastFrameImage = viduConfig.lastFrameImage;
        updateData.firstFrameImageUrl = viduConfig.firstFrameImageUrl;
        updateData.lastFrameImageUrl = viduConfig.lastFrameImageUrl;
        updateData.viduDuration = viduConfig.viduDuration || '4s';
        updateData.viduClarity = viduConfig.viduClarity || '1080p';
        updateData.viduMotionRange = viduConfig.viduMotionRange || '自动';
        updateData.aspectRatio = viduConfig.aspectRatio || '16:9';
        updateData.numberOfImages = viduConfig.numberOfImages || '1条';
        Object.assign(updateData, clearInheritedPanelRefsOnFrameModelSwitch());
        updateData.quality = undefined;
        updateData.creativityLevel = undefined;
        updateData.jimengImages = undefined;
        updateData.jimengResolution = undefined;
        updateData.jimengVideoRatio = undefined;
      } else if (['seedance1.5-pro', 'seedance2.0 (高质量版)', 'seedance2.0 (急速版)'].includes(model)) {
        const seedanceConfig = (currentModelConfigs as any)[model] || {};
        const defaultSeedanceGenerateAudio = false;
        updateData.prompt = seedanceConfig.prompt || '';
        updateData.negativePrompt = seedanceConfig.negativePrompt || '';
        updateData.firstFrameImage = seedanceConfig.firstFrameImage;
        updateData.lastFrameImage = seedanceConfig.lastFrameImage;
        updateData.firstFrameImageUrl = seedanceConfig.firstFrameImageUrl;
        updateData.lastFrameImageUrl = seedanceConfig.lastFrameImageUrl;
        updateData.numberOfImages = seedanceConfig.numberOfImages || '1条';
        updateData.seedanceResolution =
          seedanceConfig.seedanceResolution || getSeedanceDefaultResolution(model);
        if (
          (model === 'seedance2.0 (急速版)' || model === 'seedance1.5-pro') &&
          updateData.seedanceResolution === '1080p'
        ) {
          updateData.seedanceResolution = '720p';
        }
        updateData.seedanceAspectRatio =
          seedanceConfig.seedanceAspectRatio ?? getSeedanceDefaultAspectRatio(model);
        const seedanceDefaults = getSeedance20PanelDefaultsPatch({
          selectedModel: model,
          seedanceResolution: updateData.seedanceResolution,
          seedanceAspectRatio: updateData.seedanceAspectRatio,
        });
        if (seedanceDefaults) Object.assign(updateData, seedanceDefaults);
        updateData.seedanceDuration = seedanceConfig.seedanceDuration || SEEDANCE_DURATION_DEFAULT_LABEL;
        updateData.seedanceGenerateAudio =
          seedanceConfig.seedanceGenerateAudio ?? defaultSeedanceGenerateAudio;
        updateData.seedanceFixedCamera = seedanceConfig.seedanceFixedCamera ?? false;
        updateData.seedanceReferenceRatioMode =
          seedanceConfig.seedanceReferenceRatioMode ?? 'force';
        updateData.seedanceReferenceWebSearch =
          seedanceConfig.seedanceReferenceWebSearch ??
          (seedanceConfig as { seedanceImageWebSearch?: boolean }).seedanceImageWebSearch ??
          false;
        updateData.seedanceGenerationMode =
          model === 'seedance1.5-pro'
            ? 'image'
            : (seedanceConfig.seedanceGenerationMode || 'text');
        updateData.seedanceTabConfigs = seedanceConfig.seedanceTabConfigs || {};
        /** 仅「参考生视频」tab 使用顶层 reference*；图/文 tab 与 switchSeedance20Tab 一致，避免脏参考图在图生视频下出现「图片1」 */
        if (updateData.seedanceGenerationMode === 'reference') {
          updateData.referenceImages = seedanceConfig.referenceImages || [];
          updateData.referenceMovs = seedanceConfig.referenceMovs || [];
          updateData.referenceAudios = seedanceConfig.referenceAudios || [];
          updateData.referenceImageLabels = seedanceConfig.referenceImageLabels
            ? [...seedanceConfig.referenceImageLabels]
            : undefined;
        } else {
          updateData.referenceImages = [];
          updateData.referenceMovs = [];
          updateData.referenceAudios = [];
          updateData.referenceImageLabels = undefined;
        }
        updateData.quality = undefined;
        updateData.klingAudioSync = undefined;
        updateData.creativityLevel = undefined;
        updateData.jimengImages = undefined;
        updateData.viduDuration = undefined;
        updateData.viduClarity = undefined;
        updateData.viduMotionRange = undefined;
        updateData.aspectRatio = undefined;
      }
      
      // 更新节点数据
      onUpdate(updateData);
    } else {
      // 首次选择模型
      if (model === '即梦3.0 Pro') {
        onUpdate({
          selectedModel: model,
          jimengGenerationMode: 'text',
          jimengProfessionalMode: false,
          jimengResolution: '1080p',
          jimengVideoRatio: '自动匹配',
          duration: '5s',
          numberOfImages: '1条',
          jimengImages: [],
        });
      } else if (model === 'vidu 2.0') {
        onUpdate({
          selectedModel: model,
          viduDuration: '4s',
          viduClarity: '1080p',
          viduMotionRange: '自动',
          aspectRatio: '16:9',
          numberOfImages: '1条',
        });
      } else if (['seedance1.5-pro', 'seedance2.0 (高质量版)', 'seedance2.0 (急速版)'].includes(model)) {
        const defaultSeedanceGenerateAudio = false;
        onUpdate({
          selectedModel: model,
          numberOfImages: '1条',
          seedanceResolution: getSeedanceDefaultResolution(model),
          seedanceAspectRatio: getSeedanceDefaultAspectRatio(model),
          seedanceDuration: SEEDANCE_DURATION_DEFAULT_LABEL,
          seedanceGenerateAudio: defaultSeedanceGenerateAudio,
          seedanceFixedCamera: false,
          seedanceReferenceRatioMode: 'force',
          seedanceReferenceWebSearch: false,
          seedanceGenerationMode: model === 'seedance1.5-pro' ? 'image' : 'text',
          seedanceTabConfigs: {},
          referenceImages: [],
          referenceMovs: [],
          referenceAudios: [],
        });
      } else if (model === '可灵3.0 Omni') {
        setKlingOmniTab('multi');
        onUpdate({
          selectedModel: model,
          prompt: '',
          negativePrompt: '',
          quality: '高质量',
          duration: '5s',
          numberOfImages: '1条',
          aspectRatio: '16:9',
          klingAudioSync: false,
          klingOmniTab: 'multi',
          klingOmniMultiPrompt: '',
          klingOmniMultiNegativePrompt: '',
          klingOmniInstructionPrompt: '',
          klingOmniInstructionNegativePrompt: '',
          klingOmniVideoPrompt: '',
          klingOmniVideoNegativePrompt: '',
          klingOmniFramesPrompt: '',
          klingOmniFramesNegativePrompt: '',
          klingOmniInstructionVideoPreviewUrl: undefined,
          klingOmniInstructionVideoUrl: undefined,
          klingOmniVideoPreviewUrl: undefined,
          klingOmniVideoUrl: undefined,
        });
      } else if (model === MODEL_IMAGE_2) {
        onUpdate({
          selectedModel: model,
          prompt: '',
          negativePrompt: '',
          numberOfImages: '1张',
          referenceImages: [],
          image2AspectRatio: '1:1',
          image2ImageSize: '1024x1024',
          image2Style: 'vivid',
        });
      } else {
        onUpdate({ selectedModel: model });
      }
    }
  };

  const isInspectorIncomingVideoUrl = (
    url: string,
    kind?: 'image' | 'video'
  ): boolean => {
    if (kind === 'image') return false;
    if (kind === 'video') return true;
    return isLikelyMainVideoUrl(url);
  };

  const applyInspectorReferenceFromUrlString = async (
    internalCandidate: string,
    opts?: { kind?: 'image' | 'video'; assetName?: string }
  ) => {
    if (!internalCandidate) return;
    const d = nodeDataRef.current;
    const isKelingOmni = d.selectedModel === '可灵3.0 Omni';
    const omniVideoEnabled = isKelingOmni && (klingOmniTab === 'instruction' || klingOmniTab === 'video');
    const hasOmniVideoForTab =
      klingOmniTab === 'instruction'
        ? Boolean(d.klingOmniInstructionVideoPreviewUrl || d.klingOmniInstructionVideoUrl)
        : klingOmniTab === 'video'
          ? Boolean(d.klingOmniVideoPreviewUrl || d.klingOmniVideoUrl)
          : false;
    const isOmniVideoManuallyCleared =
      klingOmniTab === 'instruction'
        ? Boolean(d.klingOmniInstructionVideoManuallyCleared)
        : klingOmniTab === 'video'
          ? Boolean(d.klingOmniVideoManuallyCleared)
          : false;
    const getUpstreamMovVideoUrl = (): string | undefined => {
      if (!omniVideoEnabled || hasOmniVideoForTab || isOmniVideoManuallyCleared) return undefined;
      return getSelectedVideoUrl() || findNearestUpstreamVideoUrl();
    };

    const effectiveHasOmniVideo = hasOmniVideoForTab;
    const incomingIsVideo = isInspectorIncomingVideoUrl(internalCandidate, opts?.kind);

    if (omniVideoEnabled && incomingIsVideo) {
      const isUploaded = internalCandidate.includes('aitop100app-1251510006');
      if (klingOmniTab === 'instruction') {
        onUpdate({
          klingOmniInstructionVideoPreviewUrl: isUploaded ? undefined : internalCandidate,
          klingOmniInstructionVideoUrl: isUploaded ? internalCandidate : undefined,
          klingOmniInstructionVideoManuallyCleared: false,
          referenceMovs: [{ url: internalCandidate }],
        });
      } else {
        onUpdate({
          klingOmniVideoPreviewUrl: isUploaded ? undefined : internalCandidate,
          klingOmniVideoUrl: isUploaded ? internalCandidate : undefined,
          klingOmniVideoManuallyCleared: false,
          referenceMovs: [{ url: internalCandidate }],
        });
      }
      return;
    }
    if (isKelingOmni && klingOmniTab === 'multi' && incomingIsVideo) {
      return;
    }
    // Nano / image2 多图参考仅支持图片：不接收视频 URL（中键拖入、链上拖入等）
    if ((isNano || isImage2) && incomingIsVideo) {
      return;
    }

    if (isJimeng) {
      if (incomingIsVideo) return;
      const displayName =
        opts?.assetName?.trim() ||
        projectAssetDisplayNameFromUrl(internalCandidate, projectAssetLabelRows) ||
        '';
      void normalizeInspectorIngestImageUrl(internalCandidate).then((img) =>
        applyFirstFrameUpdate(img, displayName ? { displayName } : undefined)
      );
      return;
    }

    // image 2：无有效主图时，拖入多图参考区先写入主预览（与画布拖入一致，面板首张显示主图）
    if (isImage2 && !incomingIsVideo) {
      const main = d.imagePreview?.trim();
      if (!main || isLikelyMainVideoUrl(main)) {
        const applyMain = (img: string) => {
          const name =
            opts?.assetName?.trim() ||
            projectAssetDisplayNameFromUrl(img, projectAssetLabelRows) ||
            '';
          onUpdate({
            imagePreview: img,
            panelMainSlotVisible: undefined,
            ...(name ? { imageName: name } : {}),
          });
        };
        void normalizeInspectorIngestImageUrl(internalCandidate).then(applyMain);
        return;
      }
    }

    const currentRefs = isKelingOmni
      ? klingOmniTab === 'multi'
        ? (d.klingOmniMultiReferenceImages || [])
        : klingOmniTab === 'instruction'
          ? (d.klingOmniInstructionReferenceImages || [])
          : (d.klingOmniVideoReferenceImages || [])
      : (d.referenceImages || []);
    if (isKelingOmni) {
      const maxRefImages = klingOmniTab === 'multi' ? 7 : (effectiveHasOmniVideo ? 4 : 7);
      if (currentRefs.length >= maxRefImages) return;
    } else {
      if (currentRefs.length >= maxStandardRefImages) return;
    }

    window.dispatchEvent(new CustomEvent('flowgen:register-original-image', { detail: { nodeId, referenceAppend: [null] } }));
    const addOne = (img: string) => {
      const latest = nodeDataRef.current;
      const resolveDisplayName = () => {
        const fromMeta = opts?.assetName?.trim();
        if (fromMeta) return fromMeta;
        return projectAssetDisplayNameFromUrl(img, projectAssetLabelRows) || '';
      };
      if (isKelingOmni) {
        const cur =
          klingOmniTab === 'multi'
            ? (latest.klingOmniMultiReferenceImages || [])
            : klingOmniTab === 'instruction'
              ? (latest.klingOmniInstructionReferenceImages || [])
              : (latest.klingOmniVideoReferenceImages || []);
        const labels = alignReferenceImageLabels(cur, latest.referenceImageLabels);
        const next = tryAppendReferenceImageWithLabel(cur, labels, img, resolveDisplayName());
        if (!next.added) return;
        const maxRefImages = klingOmniTab === 'multi' ? 7 : (hasOmniVideoForTab ? 4 : 7);
        updateKlingOmniRefImages(
          klingOmniTab as 'multi' | 'instruction' | 'video',
          next.referenceImages.slice(0, maxRefImages)
        );
        onUpdate({
          referenceImageLabels: next.referenceImageLabels.slice(0, 9),
        });
        return;
      }
      if (isImage2) {
        const maxRefs = image2MaxReferenceSlots(latest);
        const compacted = compactImage2PanelReferences(latest);
        if (compacted.referenceImages.length >= maxRefs) return;
        const refSlot = compacted.referenceImages.length;
        const name = resolveDisplayName();
        onUpdate(
          patchImage2ReferenceAtRefSlot(latest, refSlot, img, name || undefined)
        );
        return;
      }
      const cur = latest.referenceImages || [];
      const labels = alignReferenceImageLabels(cur, latest.referenceImageLabels);
      const next = tryAppendReferenceImageWithLabel(cur, labels, img, resolveDisplayName());
      if (!next.added) return;
      onUpdate({
        referenceImages: next.referenceImages.slice(0, maxStandardRefImages),
        referenceImageLabels: next.referenceImageLabels.slice(0, maxStandardRefImages),
      });
    };
    void normalizeInspectorIngestImageUrl(internalCandidate).then(addOne);
  };
  applyInspectorReferenceFromUrlStringRef.current = applyInspectorReferenceFromUrlString;

  const handleRefDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOverRefs(false);

    const localFiles =
      e.dataTransfer.files && e.dataTransfer.files.length > 0
        ? Array.from(e.dataTransfer.files)
        : [];

    if (localFiles.length > 0) {
      await ingestInspectorReferenceLocalFiles(localFiles);
      return;
    }

    const internalUrls = extractInspectorDragUrls(e.dataTransfer);
    if (internalUrls.length > 0) {
      for (const url of internalUrls) {
        await applyInspectorReferenceFromUrlString(url);
      }
    }
  };

  const ingestInspectorReferenceLocalFiles = async (files: File[]) => {
    const d = nodeDataRef.current;
    const isKelingOmni = d.selectedModel === '可灵3.0 Omni';
    const omniVideoEnabled = isKelingOmni && (klingOmniTab === 'instruction' || klingOmniTab === 'video');
    const hasOmniVideoForTab =
      klingOmniTab === 'instruction'
        ? Boolean(d.klingOmniInstructionVideoPreviewUrl || d.klingOmniInstructionVideoUrl)
        : klingOmniTab === 'video'
          ? Boolean(d.klingOmniVideoPreviewUrl || d.klingOmniVideoUrl)
          : false;
    const isOmniVideoManuallyCleared =
      klingOmniTab === 'instruction'
        ? Boolean(d.klingOmniInstructionVideoManuallyCleared)
        : klingOmniTab === 'video'
          ? Boolean(d.klingOmniVideoManuallyCleared)
          : false;

    const imageFiles = files.filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif)$/i.test(f.name));
    const videoFiles = files.filter((f) => f.type.startsWith('video/'));

      if (omniVideoEnabled && videoFiles.length > 0) {
        const videoFile = videoFiles[0];
        window.dispatchEvent(
          new CustomEvent('flowgen:register-original-image', {
          detail: { nodeId, file: videoFile, type: 'klingOmniVideo' },
          })
        );
        if (klingOmniTab === 'instruction') {
        revokeBlobPreviewUrl(d.klingOmniInstructionVideoPreviewUrl);
          const previewUrl = safeCreateObjectURL(videoFile);
          if (!previewUrl) return;
          const posterDataUrl = await createVideoPosterLite(videoFile);
          onUpdate({
            klingOmniInstructionVideoPreviewUrl: previewUrl,
            klingOmniInstructionVideoUrl: undefined,
            klingOmniInstructionVideoManuallyCleared: false,
            referenceMovs: [{ url: previewUrl, ...(posterDataUrl ? { posterDataUrl } : {}) }],
          });
        } else {
        revokeBlobPreviewUrl(d.klingOmniVideoPreviewUrl);
        const previewUrl = safeCreateObjectURL(videoFile);
          if (!previewUrl) return;
          const posterDataUrl = await createVideoPosterLite(videoFile);
        onUpdate({
          klingOmniVideoPreviewUrl: previewUrl,
          klingOmniVideoUrl: undefined,
            klingOmniVideoManuallyCleared: false,
            referenceMovs: [{ url: previewUrl, ...(posterDataUrl ? { posterDataUrl } : {}) }],
          });
        }
      }

    if (imageFiles.length === 0) return;

    if (isJimeng) {
      const first = imageFiles[0];
      window.dispatchEvent(
        new CustomEvent('flowgen:register-original-image', {
          detail: { nodeId, file: first, type: 'firstFrame' },
        })
      );
      void compressImageForPreview(first)
        .then((img) => onUpdate(patchFirstFrameFromPreviewUpdate(img)))
        .catch(() => {
          const reader = new FileReader();
          reader.onload = (ev) => {
            if (ev.target?.result) onUpdate(patchFirstFrameFromPreviewUpdate(ev.target.result as string));
          };
          reader.readAsDataURL(first);
        });
      return;
    }

    if (isImage2) {
      const latest = nodeDataRef.current;
      const main = latest.imagePreview?.trim();
      const needsMain = !main || isLikelyMainVideoUrl(main);
      if (needsMain) {
        const first = imageFiles[0];
        const rest = imageFiles.slice(1);
        window.dispatchEvent(
          new CustomEvent('flowgen:register-original-image', {
            detail: { nodeId, file: first, type: 'main' },
          })
        );
        const mainUrl = await compressImageForPreview(first).catch(() => '');
        if (!mainUrl) return;
        const patch: Partial<NodeData> = {
          imagePreview: mainUrl,
          panelMainSlotVisible: undefined,
        };
        if (rest.length > 0) {
          window.dispatchEvent(
            new CustomEvent('flowgen:register-original-image', {
              detail: { nodeId, referenceAppend: rest },
            })
          );
          const refUrls = await compressImagesInBatches(rest, { batchSize: 2 });
          onUpdate({ ...patch, referenceImages: refUrls.slice(0, 2) });
        } else {
          onUpdate(patch);
        }
        return;
      }
      const latestAfterMain = nodeDataRef.current;
      const maxRefs = image2MaxReferenceSlots(latestAfterMain);
      const compacted = compactImage2PanelReferences(latestAfterMain);
      const available = Math.max(0, maxRefs - compacted.referenceImages.length);
      if (available === 0) return;
      const toProcess = imageFiles.slice(0, available);
      window.dispatchEvent(
        new CustomEvent('flowgen:register-original-image', {
          detail: { nodeId, referenceAppend: toProcess },
        })
      );
      const newImages = await compressImagesInBatches(toProcess, { batchSize: 2 });
      let working: NodeData = { ...latestAfterMain };
      for (const img of newImages) {
        const c = compactImage2PanelReferences(working);
        if (c.referenceImages.length >= maxRefs) break;
        working = {
          ...working,
          ...patchImage2ReferenceAtRefSlot(working, c.referenceImages.length, img),
        };
      }
      const finalCompact = compactImage2PanelReferences(working);
      onUpdate({
        referenceImages: finalCompact.referenceImages,
        referenceImageLabels: finalCompact.referenceImageLabels,
      });
      return;
    }

    const latest = nodeDataRef.current;
    const currentRefs = isKelingOmni
      ? klingOmniTab === 'multi'
        ? (latest.klingOmniMultiReferenceImages || [])
        : klingOmniTab === 'instruction'
          ? (latest.klingOmniInstructionReferenceImages || [])
          : (latest.klingOmniVideoReferenceImages || [])
      : (latest.referenceImages || []);
    const nextHasVideo = omniVideoEnabled ? videoFiles.length > 0 || hasOmniVideoForTab : hasOmniVideoForTab;
    const omniMaxRefImages = klingOmniTab === 'multi' ? 7 : nextHasVideo ? 4 : 7;
      const maxForThisModel = isKelingOmni ? omniMaxRefImages : maxStandardRefImages;
      const availableSlots = Math.max(0, maxForThisModel - currentRefs.length);
      if (availableSlots === 0) return;
      const toProcess = imageFiles.slice(0, availableSlots);

    window.dispatchEvent(
      new CustomEvent('flowgen:register-original-image', { detail: { nodeId, referenceAppend: toProcess } })
    );
    const newImages = await compressImagesInBatches(toProcess, { batchSize: 2 });
    const fresh = nodeDataRef.current;
    const baseRefs = isKelingOmni
      ? klingOmniTab === 'multi'
        ? (fresh.klingOmniMultiReferenceImages || [])
        : klingOmniTab === 'instruction'
          ? (fresh.klingOmniInstructionReferenceImages || [])
          : (fresh.klingOmniVideoReferenceImages || [])
      : (fresh.referenceImages || []);
    let nextRefs = [...baseRefs];
    let nextLabels = alignReferenceImageLabels(baseRefs, fresh.referenceImageLabels);
    for (const img of newImages) {
      if (nextRefs.length >= maxForThisModel) break;
      const appended = tryAppendReferenceImageWithLabel(nextRefs, nextLabels, img);
      if (!appended.added) continue;
      nextRefs = appended.referenceImages;
      nextLabels = appended.referenceImageLabels;
    }
    nextRefs = nextRefs.slice(0, maxForThisModel);
    nextLabels = nextLabels.slice(0, maxForThisModel);
        if (isKelingOmni) {
      updateKlingOmniRefImages(klingOmniTab as 'multi' | 'instruction' | 'video', nextRefs);
      onUpdate({ referenceImageLabels: nextLabels });
        } else {
      onUpdate({ referenceImages: nextRefs, referenceImageLabels: nextLabels });
    }
  };

  const handleRefUploadInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (refUploadInputRef.current) refUploadInputRef.current.value = '';
    if (files.length === 0) return;
    void ingestInspectorReferenceLocalFiles(files);
  };

  const openRefFilePicker = (accept: string) => {
    const el = refUploadInputRef.current;
    if (!el) return;
    el.accept = accept;
    el.multiple = true;
    el.click();
  };

  const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
      if (!isDragOverRefs) setIsDragOverRefs(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (isDragOverRefs) setIsDragOverRefs(false);
  };

  const removeRefImage = (index: number) => {
    window.dispatchEvent(new CustomEvent('flowgen:register-original-image', { detail: { nodeId, referenceRemoveIndex: index } }));
    if (isKelingOmni) {
      const tab = klingOmniTab === 'frames' ? 'multi' : klingOmniTab;
      const current =
        tab === 'multi'
          ? (data.klingOmniMultiReferenceImages || [])
          : tab === 'instruction'
            ? (data.klingOmniInstructionReferenceImages || [])
            : (data.klingOmniVideoReferenceImages || []);
      const newRefs = [...current];
      newRefs.splice(index, 1);
      const eids = getKlingOmniRefElementIds(tab);
      const padded = current.map((_, i) => eids[i]);
      const newEids = [...padded];
      newEids.splice(index, 1);
      updateKlingOmniRefImages(tab, newRefs, { elementIds: newEids });
      return;
    }
    const removed = removeReferenceImageAt(
      data.referenceImages || [],
      data.referenceImageLabels,
      index
    );
    onUpdate(removed);
  };

  const removeImage2RefSlot = (slotIdx: number) => {
    if (image2ShowMainInRefGrid && slotIdx === 0) {
      return;
    }
    const refIndex = image2ShowMainInRefGrid ? slotIdx - 1 : slotIdx;
    const compacted = compactImage2PanelReferences(data);
    const refs = [...compacted.referenceImages];
    const labels = [...compacted.referenceImageLabels];
    if (refIndex < 0 || refIndex >= refs.length) return;
    refs.splice(refIndex, 1);
    labels.splice(refIndex, 1);
    onUpdate({
      referenceImages: refs,
      referenceImageLabels: labels,
    });
  };

  const removeSeedanceReferenceMov = (index: number) => {
    const movs = [...(data.referenceMovs || [])];
    revokeBlobPreviewUrl(movs[index]?.url);
    movs.splice(index, 1);
    onUpdate({ referenceMovs: movs });
  };

  const addSeedanceReferenceVideoUrl = (videoUrl: string) => {
    if (!videoUrl) return;
    const current = [...(data.referenceMovs || [])];
    // Seedance 2.0 参考生视频：最多 3 条视频，重复 URL 不重复添加
    if (current.some((m) => m.url === videoUrl)) return;
    if (current.length >= 3) return;
    onUpdate({ referenceMovs: [...current, { url: videoUrl }] });
  };

  seedanceReferenceFromUrlRef.current = (
    url: string,
    kind?: 'image' | 'video',
    meta?: { assetName?: string }
  ) => {
    if (!url) return;
    if (isInspectorIncomingVideoUrl(url, kind)) {
      addSeedanceReferenceVideoUrl(url);
      return;
    }
    const d = nodeDataRef.current;
    const cur = [...(d.referenceImages || [])];
    if (cur.length >= 9) return;
    const curLabels = d.referenceImageLabels;
    if (
      panelReferencesAlreadyContainAsset(cur, curLabels, url, meta?.assetName, projectAssetLabelRows) ||
      panelReferencesAlreadyContainUrl(cur, url)
    ) {
      return;
    }
    window.dispatchEvent(new CustomEvent('flowgen:register-original-image', { detail: { nodeId, referenceAppend: [null] } }));
    const add = (img: string) => {
      const latest = nodeDataRef.current;
      const refs = [...(latest.referenceImages || [])];
      const labels = [...(latest.referenceImageLabels || [])];
      let displayName = meta?.assetName?.trim();
      if (!displayName) {
        displayName = projectAssetDisplayNameFromUrl(img, projectAssetLabelRows) || '';
      }
      const next = tryAppendReferenceImageWithLabel(
        refs,
        labels,
        img,
        displayName,
        projectAssetLabelRows
      );
      if (!next.added) return;
      const cappedRefs = next.referenceImages.slice(0, 9);
      const cappedLabels = alignReferenceImageLabels(
        cappedRefs,
        next.referenceImageLabels
      ).slice(0, 9);
      const newIdx = cappedRefs.length - 1;
      if (!String(cappedLabels[newIdx] || '').trim() && !displayName) {
        const ord = refImageOrdinalForSlot(
          newIdx,
          cappedRefs,
          latest.imagePreview
        );
        if (ord >= 1) cappedLabels[newIdx] = `图片${ord}`;
      }
      onUpdate({
        referenceImages: cappedRefs,
        referenceImageLabels: cappedLabels,
      });
    };
    void normalizeInspectorIngestImageUrl(url).then(add);
  };

  const toggleVideoById = (id: string) => {
    const el = videoRefs.current[id];
    if (!el) return;
    const markPlaying = (playing: boolean) =>
      setVideoPlayingMap((prev) => patchVideoPlayingMap(prev, id, playing));

    try {
      if (!el.paused && !el.ended) {
        el.pause();
        markPlaying(false);
        return;
      }
      // 避免“已播到末尾再次点击看起来没动”的假暂停感
      if (el.ended || (Number.isFinite(el.duration) && el.duration > 0 && el.currentTime >= el.duration - 0.05)) {
        try { el.currentTime = 0; } catch { /* ignore */ }
      }
      if (el.readyState < 2) {
        try { el.load(); } catch { /* ignore */ }
      }
      const startPlay = async () => {
        try {
          const p = el.play();
          if (p && typeof p.then === 'function') await p;
          markPlaying(true);
        } catch {
          // 某些浏览器首次 play 可能 reject，静音重试一次
          try {
            el.muted = true;
            await el.play();
            markPlaying(true);
          } catch {
            markPlaying(false);
          }
        }
      };

      if (el.readyState >= 2) {
        void startPlay();
        return;
      }
      const onCanPlay = () => {
        el.removeEventListener('canplay', onCanPlay);
        void startPlay();
      };
      el.addEventListener('canplay', onCanPlay, { once: true });
      // 双保险：极端情况下 canplay 不触发时，稍后也尝试一次
      window.setTimeout(() => {
        void startPlay();
      }, 180);
    } catch {
      /* ignore */
    }
  };

  const removeSeedanceReferenceAudio = (index: number) => {
    const auds = [...(data.referenceAudios || [])];
    revokeBlobPreviewUrl(auds[index]?.url);
    auds.splice(index, 1);
    onUpdate({ referenceAudios: auds });
  };

  const handleSeedanceReferenceFiles = async (files: File[]) => {
    if (!isSeedance20 || seedanceMode !== 'reference' || files.length === 0) return;
    const imageFiles = files.filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif)$/i.test(f.name));
    const videoFiles = files.filter((f) => f.type.startsWith('video/'));
    const audioFiles = files.filter((f) => f.type.startsWith('audio/'));

    const d0 = nodeDataRef.current;
    const refs = [...(d0.referenceImages || [])];
    const imgSlots = Math.max(0, 9 - refs.length);
    let nextImages = refs;
    let nextLabels = [...(d0.referenceImageLabels || [])];
    while (nextLabels.length < refs.length) nextLabels.push('');
    if (imgSlots > 0 && imageFiles.length > 0) {
      const toProcess = imageFiles.slice(0, imgSlots);
      window.dispatchEvent(
        new CustomEvent('flowgen:register-original-image', { detail: { nodeId, referenceAppend: toProcess } })
      );
      try {
        const newImages = await Promise.all(toProcess.map((f) => compressImageForPreview(f)));
        nextImages = [...refs];
        for (const img of newImages) {
          if (nextImages.length >= 9) break;
          const appended = tryAppendReferenceImageWithLabel(
            nextImages,
            nextLabels,
            img,
            undefined,
            projectAssetLabelRows
          );
          if (!appended.added) continue;
          nextImages = appended.referenceImages;
          nextLabels = appended.referenceImageLabels;
        }
      } catch {
        const fallback = await Promise.all(
          toProcess.map(
            (f) =>
              new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (ev) => {
                  const r = ev.target?.result;
                  if (typeof r === 'string') resolve(r);
                  else reject(new Error('read failed'));
                };
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(f);
              })
          )
        );
        nextImages = [...refs];
        for (const img of fallback) {
          if (nextImages.length >= 9) break;
          const appended = tryAppendReferenceImageWithLabel(
            nextImages,
            nextLabels,
            img,
            undefined,
            projectAssetLabelRows
          );
          if (!appended.added) continue;
          nextImages = appended.referenceImages;
          nextLabels = appended.referenceImageLabels;
        }
      }
    }

    let movs = [...(d0.referenceMovs || [])];
    for (const vf of videoFiles) {
      if (movs.length >= 3) break;
      const previewUrl = safeCreateObjectURL(vf);
      if (!previewUrl) continue;
      const posterDataUrl = await createVideoPosterLite(vf);
      movs = [...movs, { url: previewUrl, ...(posterDataUrl ? { posterDataUrl } : {}) }];
    }
    movs = movs.slice(0, 3);
    let auds = [...(d0.referenceAudios || [])];
    const audRoom = Math.max(0, 3 - auds.length);
    const audTake = audioFiles.slice(0, audRoom);
    if (audTake.length > 0) {
      window.dispatchEvent(
        new CustomEvent('flowgen:register-original-image', { detail: { nodeId, referenceAudioAppend: audTake } })
      );
      const nextAudioItems = audTake
        .map((f) => {
          const url = safeCreateObjectURL(f);
          return url ? { url } : null;
        })
        .filter((x): x is { url: string } => Boolean(x));
      auds = [...auds, ...nextAudioItems].slice(0, 3);
    }

    onUpdate({
      referenceImages: nextImages,
      referenceImageLabels: nextLabels.slice(0, 9),
      referenceMovs: movs,
      referenceAudios: auds,
    });
  };

  const handleSeedanceReferenceDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    if (!seedanceRefDropOver) setSeedanceRefDropOver(true);
  };

  const handleSeedanceReferenceDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (seedanceRefDropOver) setSeedanceRefDropOver(false);
  };

  const handleSeedanceReferenceDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (seedanceRefDropOver) setSeedanceRefDropOver(false);

    const localFiles =
      e.dataTransfer.files && e.dataTransfer.files.length > 0
        ? Array.from(e.dataTransfer.files)
        : [];
    if (localFiles.length > 0) {
      void handleSeedanceReferenceFiles(localFiles);
      return;
    }

    const internalUrls = extractInspectorDragUrls(e.dataTransfer);
    if (internalUrls.length > 0) {
      for (const url of internalUrls) seedanceReferenceFromUrlRef.current(url);
    }
  };

  const handleImage2ReferenceFile = (slotIdx: number, file: File | undefined) => {
    if (!isImage2 || !file || !file.type.startsWith('image/')) return;
    if (file.size > 10 * 1024 * 1024) {
      alert('单张图片不超过 10MB');
      return;
    }
    if (slotIdx < 0 || slotIdx > 2) return;
    const needsMain = !image2ShowMainInRefGrid;
    if (needsMain && slotIdx === 0) {
      window.dispatchEvent(
        new CustomEvent('flowgen:register-original-image', {
          detail: { nodeId, file, type: 'main' },
        })
      );
      void compressImageForPreview(file).then((mainUrl) =>
        onUpdate({ imagePreview: mainUrl, panelMainSlotVisible: undefined })
      );
      return;
    }
    const refSlot = image2ShowMainInRefGrid ? slotIdx - 1 : slotIdx;
    if (refSlot < 0) return;
    const isReplace = slotIdx < image2RefSlotFilledCount;
    if (!isReplace && image2RefSlotFilledCount >= 3) return;
    window.dispatchEvent(
      new CustomEvent('flowgen:register-original-image', {
        detail: { nodeId, referenceAppend: [file] },
      })
    );
    void compressImageForPreview(file).then((dataUrl) => {
      const latest = nodeDataRef.current;
      onUpdate(
        patchImage2ReferenceAtRefSlot(latest, refSlot, dataUrl)
      );
    });
  };

  const handleRun = async () => {
      if (isCurrentNodeRunning) return;
      try {
        try {
          if (isImage2 && localStorage.getItem('flowgen:debugImage2') === '1') {
            console.info(
              `[FlowGen:image2-debug] inspector-click-run ${JSON.stringify(
                {
                  nodeId,
                  refsCount: (data.referenceImages || []).length,
                  refs: (data.referenceImages || []).map((u, i) => ({
                    idx: i,
                    len: String(u || '').length,
                    head: String(u || '').slice(0, 48),
                    tail: String(u || '').slice(-48),
                  })),
                },
                null,
                2
              )}`
            );
          }
        } catch {
          /* ignore */
        }
        onUpdate({ status: 'running', progress: 0, errorMessage: undefined });
        setRunningByNode((prev) => ({ ...prev, [nodeId]: true }));
        await onRun(nodeId);
      } catch (err) {
        try {
          if (isImage2 && localStorage.getItem('flowgen:debugImage2') === '1') {
            console.info(
              `[FlowGen:image2-debug] inspector-run-catch ${JSON.stringify(
                {
                  nodeId,
                  message: err instanceof Error ? err.message : String(err || ''),
                  stack: err instanceof Error ? err.stack : undefined,
                },
                null,
                2
              )}`
            );
          }
        } catch {
          /* ignore */
        }
        try {
          window.dispatchEvent(new CustomEvent('flowgen:run-node', { detail: { nodeId } }));
        } catch {
          /* ignore */
        }
        const msg = err instanceof Error ? err.message : String(err || '触发运行失败');
        onUpdate({ status: 'error', errorMessage: msg });
      } finally {
        if (isMountedRef.current) {
          setRunningByNode((prev) => ({ ...prev, [nodeId]: false }));
        }
      }
  };

  const handleSwapFrames = () => {
      window.dispatchEvent(new CustomEvent('flowgen:register-original-image', { detail: { nodeId, type: 'swapFrames' } }));
      const temp = data.firstFrameImage;
      onUpdate({
          firstFrameImage: data.lastFrameImage,
          lastFrameImage: temp
      });
  };

  const handleMainUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
        const file = e.target.files[0];
        const frameType: 'firstFrame' | 'lastFrame' = !data.firstFrameImage ? 'firstFrame' : !data.lastFrameImage ? 'lastFrame' : 'firstFrame';
        window.dispatchEvent(new CustomEvent('flowgen:register-original-image', { detail: { nodeId, file, type: frameType } }));
        const apply = (result: string) => {
          if (!data.firstFrameImage) onUpdate({ firstFrameImage: result });
          else if (!data.lastFrameImage) onUpdate({ lastFrameImage: result });
          else onUpdate({ firstFrameImage: result });
        };
        compressImageForPreview(file).then(apply).catch(() => {
          const reader = new FileReader();
          reader.onload = (ev) => { if (ev.target?.result) apply(ev.target.result as string); };
          reader.readAsDataURL(file);
        });
    }
    if (mainUploadInputRef.current) mainUploadInputRef.current.value = '';
  };

  const TAG_PREFIX_RE = /^【标签：(人物|动物|道具|服饰|场景|特效|其他)】\s*/;

  /** 描述中可选前缀「【标签：人物】」用于在接口 tag 为 OTHER 时仍能还原界面分类 */
  const parseCategoryFromDescriptionPrefix = (desc?: string): SubjectCategory | undefined => {
    if (!desc) return undefined;
    const m = desc.match(/^【标签：(人物|动物|道具|服饰|场景|特效|其他)】/);
    if (m && SUBJECT_CATEGORIES.includes(m[1] as SubjectCategory)) return m[1] as SubjectCategory;
    return undefined;
  };

  const stripTagPrefixFromDescription = (desc?: string): string | undefined => {
    if (!desc?.trim()) return undefined;
    const stripped = desc.replace(TAG_PREFIX_RE, '').trim();
    return stripped || undefined;
  };

  const mapApiSubjectToLibraryItem = (rec: KlingSubjectRecord, idx: number): LibraryItem => {
    const id =
      rec.id != null && String(rec.id) !== ''
        ? String(rec.id)
        : `row_${idx}_${String(rec.elementId ?? rec.element_id ?? idx)}`;
    const url = String(rec.elementFrontalImage ?? '');
    const name = rec.elementName != null ? String(rec.elementName) : undefined;
    const tag = rec.tag != null ? String(rec.tag) : '';
    const tagNorm = tag ? tag.toUpperCase() : '';
    const rawDesc = rec.elementDescription != null ? String(rec.elementDescription) : undefined;
    const categoryFromPrefix = parseCategoryFromDescriptionPrefix(rawDesc);
    const fromTag = tagNorm ? (KLING_TAG_TO_CATEGORY[tagNorm] as SubjectCategory | undefined) : undefined;
    /** 描述前缀优先：接口常回 tag=OTHER，否则会先映射成「其他」盖住用户选的分类 */
    const category: SubjectCategory = categoryFromPrefix || fromTag || '其他';
    const description = stripTagPrefixFromDescription(rawDesc) ?? rawDesc;
    const views = Array.isArray(rec.elementRefers) ? rec.elementRefers.map((u) => String(u)) : undefined;
    const eid = rec.elementId ?? rec.element_id;
    const rawTime =
      (rec as { updateTime?: string }).updateTime ??
      (rec as { updatedAt?: string }).updatedAt ??
      (rec as { createTime?: string }).createTime ??
      (rec as { gmtModified?: string }).gmtModified;
    return {
      id,
      url,
      thumbnail: url || undefined,
      name,
      category,
      description,
      views,
      elementId: eid != null && String(eid) !== '' ? String(eid) : undefined,
      updatedAt: rawTime != null ? String(rawTime) : undefined,
    };
  };

  const ensureAitopCosImageUrl = async (uri: string): Promise<string | null> => {
    if (!uri?.trim()) return null;
    if (uri.includes('aitop100app-1251510006.cos.ap-shanghai.myqcloud.com')) return uri;
    return uploadImage(uri);
  };

  /** 可灵主体库 GET /api/v1/kLingMainLibrary/page */
  const loadLibraryImages = async () => {
    setIsLoadingLibrary(true);
    try {
      const result = await listKlingSubjects(1, 100);
      if (!result) {
          setLibraryImages([]);
        return;
      }
      const mapped = result.records
        .map((rec, idx) => mapApiSubjectToLibraryItem(rec, idx))
        .filter((it) => !!it.url);
      setLibraryImages(mapped);
    } catch (error) {
      setLibraryImages([]);
    } finally {
      setIsLoadingLibrary(false);
    }
  };

  // 选择主体库文件
  const handleSelectLibraryImage = (imageUrl: string, closeModal = true, elementId?: string) => {
    // 可灵3.0 Omni：从主体库选择时按当前 tab 写入对应参考图列表（附带主体 elementId，供 Omni imageList 使用）
    if (isKelingOmni && klingOmniTab !== 'frames') {
      const tab = klingOmniTab as 'multi' | 'instruction' | 'video';
      const hasOmniVideo =
        tab === 'instruction'
          ? Boolean(data.klingOmniInstructionVideoPreviewUrl || data.klingOmniInstructionVideoUrl)
          : tab === 'video'
            ? Boolean(data.klingOmniVideoPreviewUrl || data.klingOmniVideoUrl)
            : false;
      const maxRefImages = klingOmniTab === 'multi' ? 7 : (hasOmniVideo ? 4 : 7);
      const currentRefs =
        tab === 'multi'
          ? (data.klingOmniMultiReferenceImages || [])
          : tab === 'instruction'
            ? (data.klingOmniInstructionReferenceImages || [])
            : (data.klingOmniVideoReferenceImages || []);

      if (currentRefs.length >= maxRefImages) return;

      const nextRefs = [...currentRefs, imageUrl].slice(0, maxRefImages);
      const currentEids = getKlingOmniRefElementIds(tab);
      const nextEids = [...currentEids, elementId].slice(0, nextRefs.length);
      updateKlingOmniRefImages(tab, nextRefs, { elementIds: nextEids });
      if (closeModal) setShowLibraryModal(false);
      return;
    }
    if (isImage2) {
      const maxRefs = image2MaxReferenceSlots(data);
      const compacted = compactImage2PanelReferences(data);
      if (compacted.referenceImages.length >= maxRefs) {
        if (closeModal) setShowLibraryModal(false);
        return;
      }
      const libName =
        libraryImages.find((it) => it.url === imageUrl)?.name?.trim() ||
        projectAssetDisplayNameFromUrl(imageUrl, projectAssetLabelRows) ||
        '';
      onUpdate(
        patchImage2ReferenceAtRefSlot(
          data,
          compacted.referenceImages.length,
          imageUrl,
          libName || undefined
        )
      );
      if (closeModal) setShowLibraryModal(false);
      return;
    }
    if (isNano) {
      const currentRefs = data.referenceImages || [];
      if (currentRefs.length >= maxStandardRefImages) return;
      const labels = alignReferenceImageLabels(currentRefs, data.referenceImageLabels);
      const libName =
        libraryImages.find((it) => it.url === imageUrl)?.name?.trim() || '';
      const next = tryAppendReferenceImageWithLabel(
        currentRefs,
        labels,
        imageUrl,
        libName || projectAssetDisplayNameFromUrl(imageUrl, projectAssetLabelRows) || ''
      );
      if (!next.added) {
        if (closeModal) setShowLibraryModal(false);
        return;
      }
      onUpdate({
        referenceImages: next.referenceImages.slice(0, maxStandardRefImages),
        referenceImageLabels: next.referenceImageLabels.slice(0, maxStandardRefImages),
      });
      if (closeModal) setShowLibraryModal(false);
      return;
    }
    if (isJimeng) {
      const libName =
        libraryImages.find((it) => it.url === imageUrl)?.name?.trim() ||
        projectAssetDisplayNameFromUrl(imageUrl, projectAssetLabelRows) ||
        '';
      applyFirstFrameUpdate(imageUrl, libName ? { displayName: libName } : undefined);
      if (closeModal) setShowLibraryModal(false);
      return;
    }
    if (isKeling || isVidu || isSeedance) {
      // 可灵 / vidu / seedance：填充首帧图或尾帧图（主体库仅对上述三款中的可灵2.5与 vidu 开放入口；Omni 首尾帧 tab 亦走此逻辑）
      const libName =
        libraryImages.find((it) => it.url === imageUrl)?.name?.trim() ||
        projectAssetDisplayNameFromUrl(imageUrl, projectAssetLabelRows) ||
        '';
      const nameMeta = libName ? { displayName: libName } : undefined;
      if (!data.firstFrameImage && !data.firstFrameImageUrl) {
        applyFirstFrameUpdate(imageUrl, nameMeta);
      } else if (!data.lastFrameImage && !data.lastFrameImageUrl) {
        applyLastFrameUpdate(imageUrl, nameMeta);
      } else {
        applyFirstFrameUpdate(imageUrl, nameMeta);
      }
    }
    if (closeModal) setShowLibraryModal(false);
  };

  const toggleLibrarySelect = (id: string) => {
    setSelectedLibraryIds((prev) => prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]);
  };

  const handleConfirmLibrarySelection = () => {
    if (!selectedLibraryIds.length) {
      alert('请先选择至少一个主体库文件');
      return;
    }
    const selectedItems = libraryImages.filter((it) => selectedLibraryIds.includes(it.id));
    selectedItems.forEach((it) => handleSelectLibraryImage(it.url, false, it.elementId));
    setShowLibraryModal(false);
  };

  const handleDeleteLibraryImage = async (id: string) => {
    const target = libraryImages.find((it) => it.id === id);
    if (!target) return;
    const ok = confirm(`确认删除主体「${target.name || '未命名'}」吗？（将同步删除云端记录）`);
    if (!ok) return;
    const res = await deleteKlingSubject(id);
    if (!res.ok) {
      alert(res.message || '删除失败');
      return;
    }
    setLibraryImages((prev) => prev.filter((it) => it.id !== id));
    setSelectedLibraryIds((prev) => prev.filter((v) => v !== id));
  };

  const handleCreateSubject = async () => {
    if (!newSubjectDataUrl?.trim()) {
      alert('请上传主要参考图（正面图）');
      return;
    }
    if (newSubjectOtherViewUrls.length < 1) {
      alert('请至少上传 1 张其他视角图');
      return;
    }
    if (!newSubjectName.trim()) {
      alert('请填写主体姓名');
      return;
    }
    if (newSubjectName.trim().length > 20) {
      alert('主体姓名不能超过 20 个字符');
      return;
    }
    if (!newSubjectTag) {
      alert('请选择标签');
      return;
    }
    if (!newSubjectDescription.trim()) {
      alert('请填写描述');
      return;
    }
    if (newSubjectDescription.trim().length > 100) {
      alert('描述不能超过 100 个字符');
      return;
    }
    setIsCreatingSubject(true);
    try {
      const frontalUploaded = await ensureAitopCosImageUrl(newSubjectDataUrl);
      if (!frontalUploaded) {
        alert('正面图上传失败，请重试');
        return;
      }
      const referUrls: string[] = [];
      for (const u of newSubjectOtherViewUrls) {
        const up = await ensureAitopCosImageUrl(u);
        if (!up) {
          alert('其他视角图上传失败，请重试');
          return;
        }
        referUrls.push(up);
      }
      // tag 使用文档枚举 PERSON/ANIMAL/…/OTHER（见 AITOP100）；描述不再强制加前缀，旧数据仍可从「【标签：」前缀解析分类
      const tag = uiCategoryToKlingSubjectTag(newSubjectTag as SubjectCategory);
      const elementRefers = referUrls.slice(0, 3);
      const result = await saveKlingSubject({
        elementName: newSubjectName.trim(),
        elementDescription: newSubjectDescription.trim(),
        elementFrontalImage: frontalUploaded,
        elementRefers,
        tag,
      });
      if (result.ok === false) {
        alert(`创建主体失败：${result.message}`);
        return;
      }
      await loadLibraryImages();
      setShowCreateSubjectForm(false);
      setNewSubjectName('');
      setNewSubjectDataUrl('');
      setNewSubjectOtherViewUrls([]);
      setNewSubjectTag('');
      setNewSubjectDescription('');
      setLibraryCategoryFilter('全部');
      setLibraryKeyword('');
    } finally {
      setIsCreatingSubject(false);
    }
  };

  const applyMainSubjectFile = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (ev) => setNewSubjectDataUrl((ev.target?.result as string) || '');
    reader.readAsDataURL(file);
  };

  const onMainSubjectDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSubjectMainDropOver(false);
    const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/'));
    if (file) {
      suppressSubjectMainClickRef.current = true;
      window.setTimeout(() => {
        suppressSubjectMainClickRef.current = false;
      }, 400);
      applyMainSubjectFile(file);
    }
  };

  const onOtherViewsDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSubjectOtherViewsDropOver(false);
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    Promise.all(
      files.map(
        (f) =>
          new Promise<string>((resolve) => {
            const r = new FileReader();
            r.onload = (ev) => resolve((ev.target?.result as string) || '');
            r.readAsDataURL(f);
          })
      )
    ).then((urls) => {
      if (urls.length) {
        suppressSubjectOtherClickRef.current = true;
        window.setTimeout(() => {
          suppressSubjectOtherClickRef.current = false;
        }, 400);
      }
      setNewSubjectOtherViewUrls((prev) => [...prev, ...urls].filter(Boolean).slice(0, 3));
    });
  };

  const filteredLibraryImages = libraryImages.filter((it) => {
    const passCategory = libraryCategoryFilter === '全部' || it.category === libraryCategoryFilter;
    const kw = libraryKeyword.trim().toLowerCase();
    const passKeyword =
      !kw ||
      `${it.name || ''} ${it.category || ''} ${it.description || ''} ${(it.tags || []).join(' ')}`
        .toLowerCase()
        .includes(kw);
    return passCategory && passKeyword;
  });

  const formatLibraryUpdatedAt = (raw?: string) => {
    if (!raw?.trim()) return '';
    const t = Date.parse(raw);
    if (!Number.isNaN(t)) return new Date(t).toLocaleString('zh-CN', { hour12: false });
    return raw.trim();
  };

  const librarySubjectThumbUrls = (it: LibraryItem) =>
    [...new Set([it.url, ...(it.views || [])].filter(Boolean))].slice(0, 8);

  firstFrameFromUrlRef.current = (url: string, kind?: 'image' | 'video', meta?: { assetName?: string }) => {
    if (!url || isInspectorIncomingVideoUrl(url, kind)) return;
    const displayName =
      meta?.assetName?.trim() ||
      projectAssetDisplayNameFromUrl(url, projectAssetLabelRows) ||
      '';
    void normalizeInspectorIngestImageUrl(url).then((img) =>
      applyFirstFrameUpdate(img, displayName ? { displayName } : undefined)
    );
  };
  lastFrameFromUrlRef.current = (url: string, kind?: 'image' | 'video', meta?: { assetName?: string }) => {
    if (!url || isInspectorIncomingVideoUrl(url, kind)) return;
    const displayName =
      meta?.assetName?.trim() ||
      projectAssetDisplayNameFromUrl(url, projectAssetLabelRows) ||
      '';
    void normalizeInspectorIngestImageUrl(url).then((img) =>
      applyLastFrameUpdate(img, displayName ? { displayName } : undefined)
    );
  };

  return (
    <aside
      data-flowgen-node-inspector
      className="w-full min-w-0 bg-gray-900 flex flex-col h-full z-20 shadow-2xl overflow-x-hidden overflow-y-auto animate-[slideIn_0.2s_ease-out]"
    >
      <style>{`
        @keyframes slideIn {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>

      {/* Header (Fixed) */}
      <div className="flex-none p-4 border-b border-gray-800 bg-gray-900 flex items-center justify-between z-10">
         <div className="flex items-center gap-2">
            <Settings2 className="text-brand-500 w-4 h-4" />
            <h2 className="font-bold text-sm tracking-wide text-gray-200">Node Properties</h2>
         </div>
         <span className="text-[10px] font-mono text-gray-500 bg-gray-800 px-2 py-1 rounded border border-gray-700">
           {data.customName?.trim() || data.label}
         </span>
      </div>
      
      {/* Scrollable Content Container */}
      <div className="flex-1 flex flex-col min-h-0 custom-scrollbar overflow-y-auto">
          <input
            type="file"
            ref={refUploadInputRef}
            className="hidden"
            multiple
            accept="image/*"
            onChange={handleRefUploadInputChange}
          />

          <div className="p-4 border-b border-gray-800 bg-gray-900/50 flex-shrink-0">
             <div className="flex items-center gap-2 mb-2">
                <Type className="text-brand-500 w-3 h-3" />
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Node Name</span>
             </div>
             <input
               type="text"
               value={data.customName ?? ''}
               onChange={(e) => onUpdate({ customName: e.target.value })}
               placeholder={data.label}
               className="w-full bg-gray-950 border border-gray-700 hover:border-brand-500 text-gray-200 text-xs rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-500/50"
             />
          </div>
          
          {/* SECTION 1: MODEL SELECTION */}
          <div className="p-4 border-b border-gray-800 bg-gray-900/50 flex-shrink-0">
             <div className="flex items-center gap-2 mb-2">
                <Sparkles className="text-brand-500 w-3 h-3" />
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Model</span>
             </div>
             <div className="relative group">
                <select
                  value={data.selectedModel || MODEL_NANO_BANANA_2}
                  onChange={(e) => handleModelChange(e.target.value)}
                  className="w-full bg-gray-950 border border-gray-700 hover:border-brand-500 text-gray-200 text-xs rounded-lg px-3 py-2.5 pr-8 focus:outline-none focus:ring-2 focus:ring-brand-500/50 appearance-none transition-all cursor-pointer"
                >
                   <option value={MODEL_NANO_BANANA_2}>{MODEL_NANO_BANANA_2}</option>
                   <option value={MODEL_IMAGE_2}>{MODEL_IMAGE_2}</option>
                   <option value="可灵 2.5 Turbo">可灵 2.5 Turbo</option>
                   <option value="可灵3.0 Omni">可灵3.0 Omni</option>
                   <option value="即梦3.0 Pro">即梦3.0 Pro</option>
                   <option value="vidu 2.0">vidu 2.0</option>
                   <option value="seedance1.5-pro">seedance1.5-pro</option>
                   <option value="seedance2.0 (高质量版)">seedance2.0 (高质量版)</option>
                   <option value="seedance2.0 (急速版)">seedance2.0 (急速版)</option>
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
             </div>
          </div>

          {/* SECTION 2: UPLOAD AREA (For Nano Banana) */}
          {!isKeling && !isJimeng && !isVidu && !isSeedance && (
            <div className="border-b border-gray-800 bg-gray-900/30 flex-shrink-0 p-4">
              {supportsSubjectLibraryPicker && (
                <div className="flex gap-2 mb-2">
                <button
                    type="button"
                  onClick={() => {
                    setShowLibraryModal(true);
                    loadLibraryImages();
                  }}
                    className="w-full flex flex-col items-center justify-center p-3 border-2 border-dashed border-gray-800 rounded-xl bg-gray-950/30 text-center gap-1.5 cursor-pointer hover:border-gray-700 transition-colors group"
                >
                  <ImageIcon className="text-gray-600 w-6 h-6 group-hover:text-gray-500 transition-colors" />
                    <div className="text-xs font-semibold text-gray-400 group-hover:text-gray-300">从主体库文件选择</div>
                </button>
              </div>
              )}
              <div className="text-[10px] text-red-300 px-2 py-2 leading-relaxed text-center bg-red-500/10 border border-red-500/30 rounded-lg">
                {isImage2 ? (
                  <>⚠ 支持 1–3 张 JPG/PNG 图片，单张不超过 10MB</>
                ) : (
                  <>⚠ 支持JPG / PNG格式, 文件大小不超过10MB, 最多添加14张参考图</>
                )}
              </div>
            </div>
          )}

          {/* SECTION 2: ASSETS / FIRST-LAST FRAME（底部分隔由可拖动 ResizeHandle 承担；第一条可拉高素材区可视高度） */}
          <div className="bg-gray-900/30 flex-shrink-0 min-h-0 flex flex-col">
            <div
              className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar flex flex-col"
              style={{ maxHeight: inspectorPanelHeights.assetsScrollMaxPx }}
            >
            {isKelingOmni ? (
                /* === KLING 3.0 OMNI TABS === */
                <div className="p-4 flex flex-col gap-3">
                    <div className="flex items-center gap-1.5">
                        {[
                            { id: 'multi' as const, label: '多图参考' },
                            { id: 'instruction' as const, label: '指令变换' },
                            { id: 'video' as const, label: '视频参考' },
                            { id: 'frames' as const, label: '首尾帧' },
                        ].map((tab) => (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => {
                                    setKlingOmniTab(tab.id);
                                    const tabText = getKlingOmniTabText(tab.id);
                                    const mainPrev = data.imagePreview?.trim();
                                    const tabPatch: Partial<NodeData> = {
                                      klingOmniTab: tab.id,
                                      prompt: tabText.prompt,
                                      negativePrompt: tabText.negativePrompt,
                                    };
                                    if (
                                      mainPrev &&
                                      !isLikelyMainVideoUrl(mainPrev) &&
                                      (tab.id === 'instruction' || tab.id === 'video')
                                    ) {
                                      const stripDup = (list?: string[]) => {
                                        if (!list?.length) return undefined;
                                        const next = list.filter(
                                          (u) => !isDuplicateOfMainImagePreview(u, mainPrev)
                                        );
                                        return next.length === list.length ? undefined : next;
                                      };
                                      const inst = stripDup(data.klingOmniInstructionReferenceImages);
                                      const vid = stripDup(data.klingOmniVideoReferenceImages);
                                      if (inst) tabPatch.klingOmniInstructionReferenceImages = inst;
                                      if (vid) tabPatch.klingOmniVideoReferenceImages = vid;
                                    }
                                    onUpdate(tabPatch);
                                    requestAnimationFrame(() => {
                                      const el = promptTextareaRef.current;
                                      if (!el) return;
                                      const len = tabText.prompt.length;
                                      el.focus();
                                      el.setSelectionRange(len, len);
                                    });
                                }}
                                className={`px-2.5 py-1.5 text-[10px] font-bold rounded-lg transition-colors ${
                                    klingOmniTab === tab.id
                                        ? 'bg-brand-500 text-gray-950'
                                        : 'bg-gray-900 text-gray-400 hover:text-gray-300 hover:bg-gray-800'
                                }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    {klingOmniTab === 'frames' ? (
                        <>
                            <div className="flex items-center gap-2 mb-1">
                                <ArrowRightLeft className="text-brand-500 w-3 h-3" />
                                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">首尾帧</span>
                            </div>
                                    <input
                                        type="file"
                                        ref={mainUploadInputRef}
                                        className="hidden"
                                        accept="image/*"
                                        onChange={handleMainUpload}
                                    />
                            <div className="text-[10px] text-red-300 px-2 py-2 leading-relaxed text-center bg-red-500/10 border border-red-500/30 rounded-lg">
                                ⚠ 添加首帧图，或者同时添加首尾帧图，并文字描述场景过渡、运镜轨迹或角色动作。
                            </div>
                            <div className="flex items-center gap-3 h-24">
                                <FrameDropZone
                                    nodeId={nodeId}
                                    frameType="firstFrame"
                                    label="首帧图"
                                    imageUrl={data.firstFrameImageUrl}
                                    imageData={data.firstFrameImage}
                                    onImageUpdate={applyFirstFrameUpdate}
                                    displayUrl={data.firstFrameImageUrl}
                                    showImage={true}
                                    mediaRefCaption={flMediaCaptions.first}
                                />
                                <div className="h-full flex items-center justify-center">
                                    <button
                                        onClick={handleSwapFrames}
                                        className="p-1.5 rounded-full hover:bg-gray-800 text-gray-500 hover:text-brand-500 transition-colors"
                                        title="Swap Start/End Frames"
                                    >
                                        <ArrowRightLeft className="w-4 h-4" />
                                    </button>
                                </div>
                                <FrameDropZone
                                    nodeId={nodeId}
                                    frameType="lastFrame"
                                    label="尾帧图"
                                    imageUrl={data.lastFrameImageUrl}
                                    imageData={data.lastFrameImage}
                                    onImageUpdate={applyLastFrameUpdate}
                                    displayUrl={data.lastFrameImageUrl}
                                    showImage={true}
                                    mediaRefCaption={flMediaCaptions.last}
                                />
                            </div>
                        </>
                    ) : (
                        <>
                            {supportsSubjectLibraryPicker && (
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => { setShowLibraryModal(true); loadLibraryImages(); }}
                                        className="w-full flex flex-col items-center justify-center p-3 border-2 border-dashed border-gray-800 rounded-xl bg-gray-950/30 text-center gap-1.5 cursor-pointer hover:border-gray-700 transition-colors group"
                                >
                                    <ImageIcon className="text-gray-600 w-6 h-6 group-hover:text-gray-500 transition-colors" />
                                        <div className="text-xs font-semibold text-gray-400 group-hover:text-gray-300">从主体库文件选择</div>
                                </button>
                            </div>
                            )}
                            <div className="text-[10px] text-red-300 px-2 py-2 leading-relaxed bg-red-500/10 border border-red-500/30 rounded-lg">
                                {klingOmniTab === 'multi' && (
                                  <p className="text-center">⚠ 上传 1-7 张参考图或主体，你可以自由组合人物、角色、道具、服装、场景等元素。</p>
                                )}
                                {(klingOmniTab === 'instruction' || klingOmniTab === 'video') && (
                                  <div className="space-y-0.5">
                                    {klingOmniTab === 'instruction' && (
                                      <p>⚠ 输入文字、图片或主体，轻松对原视频进行内容修改编辑、景别视角切换、风格重绘等，拖入的内容支持图片和视频。</p>
                                    )}
                                    {klingOmniTab === 'video' && (
                                      <p>⚠ 基于 3-10s 视频作为参考，配合文字/图片/主体，续写下一分镜；或复刻视频动作/运镜，生成全新画面，拖入内容支持图片和视频。</p>
                                    )}
                                    <p>● 仅支持 1 段 MP4/MOV（3-10s，720-2160px，24-60fps，≤200MB；输出 24fps）</p>
                            </div>
                                )}
                            </div>
                            {klingOmniTab !== 'multi' && stableOmniTabVideoDisplayUrl && (
                                <InspectorOmniTabVideoPreview
                                  nodeId={nodeId}
                                  omniTab={klingOmniTab as 'instruction' | 'video'}
                                  displayUrl={stableOmniTabVideoDisplayUrl}
                                  posterUrl={omniTabVideoPosterUrl}
                                  mainPreview={data.imagePreview}
                                  videoRefRegister={registerInspectorVideoRef}
                                  isPlaying={Boolean(
                                    videoPlayingMap[
                                      `omni-video-preview-${nodeId}-${klingOmniTab}`
                                    ]
                                  )}
                                  onVideoPlayStateChange={setVideoPlayState}
                                  onTogglePlay={toggleVideoById}
                                  onRemove={() => {
                                    window.dispatchEvent(
                                      new CustomEvent('flowgen:register-original-image', {
                                        detail: { nodeId, type: 'klingOmniVideoRemove' },
                                      })
                                    );
                                    if (klingOmniTab === 'instruction') {
                                      onUpdate({
                                        klingOmniInstructionVideoPreviewUrl: undefined,
                                        klingOmniInstructionVideoUrl: undefined,
                                        klingOmniInstructionVideoManuallyCleared: true,
                                        referenceMovs: [],
                                      });
                                    } else {
                                      onUpdate({
                                        klingOmniVideoPreviewUrl: undefined,
                                        klingOmniVideoUrl: undefined,
                                        klingOmniVideoManuallyCleared: true,
                                        referenceMovs: [],
                                      });
                                    }
                                  }}
                                />
                            )}
                            <div
                                className={`
                                    min-h-[140px] rounded-lg border-2 border-dashed transition-all duration-200 overflow-y-auto custom-scrollbar relative
                                    ${isDragOverRefs ? 'border-brand-500 bg-brand-500/10' : 'border-gray-800 bg-gray-950/50 hover:border-gray-700'}
                                `}
                                data-flowgen-media-drop="1"
                                data-flowgen-node-id={nodeId}
                                data-flowgen-drop-zone="reference"
                                onDragOver={handleDragOver}
                                onDragLeave={handleDragLeave}
                                onDrop={handleRefDrop}
                            >
                                {(
                                    ((klingOmniActiveRefImages || []).length === 0) &&
                                    !omniInspectorShowMainImageSlot &&
                                    !(
                                        (klingOmniTab === 'instruction' || klingOmniTab === 'video') &&
                                        stableOmniTabVideoDisplayUrl
                                    )
                                ) ? (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-600 gap-2 p-3 pointer-events-none">
                                        {(klingOmniTab === 'instruction' || klingOmniTab === 'video') ? (
                                            <div className={`text-[10px] px-2 py-0.5 rounded bg-gray-900/40 border border-gray-800 text-center ${isDragOverRefs ? 'text-brand-300 border-brand-500/30' : 'text-gray-400'}`}>
                                                视频（必填：可来自视频素材或输出视频节点）及图片
                                            </div>
                                        ) : (
                                            <span className={`text-[10px] ${isDragOverRefs ? 'text-brand-300' : 'opacity-60'}`}>拖入图片 / 中键从画布拖入</span>
                                        )}
                                        <Plus className={`w-5 h-5 ${isDragOverRefs ? 'text-brand-400' : 'opacity-40'}`} />
                                        <button
                                          type="button"
                                          onClick={() =>
                                            openRefFilePicker(
                                              klingOmniTab === 'multi' ? 'image/*' : 'image/*,video/*'
                                            )
                                          }
                                          className="mt-1 px-3 py-1.5 text-[10px] font-medium rounded-lg border border-gray-700 bg-gray-900 text-gray-300 hover:border-brand-500/50 hover:text-brand-300 transition-colors pointer-events-auto"
                                        >
                                          上传文件
                                        </button>
                                    </div>
                                ) : (
                                    <div className="p-2 grid grid-cols-3 gap-2">
                                        {(() => {
                                          const omniRefSlots = panelReferenceDisplaySlots(
                                            klingOmniActiveRefImages
                                          )
                                            .map(({ url, slotIndex }) => ({
                                              img: url,
                                              origIdx: slotIndex,
                                            }))
                                            .filter(
                                              ({ img }) =>
                                                !shouldDedupePanelRefsAgainstMainPreview(data) ||
                                                !isDuplicateOfMainImagePreview(
                                                  img,
                                                  data.imagePreview
                                                )
                                            );
                                          const cells: Array<
                                            | { kind: 'main' }
                                            | { kind: 'ref'; img: string; origIdx: number; slotIdx: number }
                                          > = omniInspectorShowMainImageSlot ? [{ kind: 'main' }] : [];
                                          omniRefSlots.forEach(({ img, origIdx }, slotIdx) => {
                                            cells.push({ kind: 'ref', img, origIdx, slotIdx });
                                          });
                                          return cells.map((cell, cellIdx) => {
                                            if (cell.kind === 'main') {
                                              return (
                                                <div
                                                  key="omni-main"
                                                  className="group relative aspect-square rounded overflow-hidden border border-brand-500/40 bg-black"
                                                >
                                                  <img
                                                    src={mainPreviewDisplaySrc}
                                                    alt="main"
                                                    className="w-full h-full object-cover"
                                                  />
                                  <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white text-[9px] font-medium text-center py-0.5 pointer-events-none z-[1]">
                                                    {mainImageSlotCaption}
                                                  </div>
                                                </div>
                                              );
                                            }
                                            const { img, origIdx, slotIdx } = cell;
                                            const isVid = isOmniVideoItemUrl(img);
                                            const caption = isVid
                                              ? omniMixedRefSlotCaption(
                                                  origIdx,
                                              klingOmniActiveRefImages,
                                                  panelReferenceLabelImagePreview(data)
                                                )
                                              : resolveReferenceSlotDisplayLabel(
                                                  origIdx,
                                                  klingOmniActiveRefImages,
                                                  data.referenceImageLabels,
                                                  panelReferenceLabelImagePreview(data),
                                                  'panelSlot',
                                                  projectAssetLabelRows,
                                                  data.imageName
                                            );
                                            return (
                                            <div key={`ref-${img}`} className="group relative aspect-square rounded overflow-hidden border border-gray-800 bg-black">
                                                {isVid ? (
                                                    <KlingOmniVideoThumb src={img} className="w-full h-full object-cover" alt="ref" />
                                                ) : (
                                                <img src={resolveDisplayMediaUrl(img)} alt="ref" className="w-full h-full object-cover" />
                                                )}
                                                <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white text-[9px] font-medium text-center py-0.5 pointer-events-none z-[1]">
                                                  {caption}
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => removeRefImage(origIdx)}
                                                    className="absolute top-1 right-1 p-0.5 bg-black/60 hover:bg-red-500 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity z-[2]"
                                                    title="移除"
                                                >
                                                    <X size={12} />
                                                </button>
                                            </div>
                                            );
                                          });
                                        })()}
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>
            ) : isJimeng ? (
                /* === 即梦3.0 Pro UI === */
                <div className="p-4 flex flex-col gap-3">
                            <div className="text-[10px] text-red-300 px-2 py-2 leading-relaxed text-center bg-red-500/10 border border-red-500/30 rounded-lg">
                                ⚠ 支持 JPG/PNG；首帧必选（即梦 API 仅单图图生）；单张 ≤ 4.7MB。创意描述请用 @首帧图 或 @主图。
                            </div>
                              <div className="p-2 rounded-lg border border-gray-800 bg-gray-950/40">
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center gap-2">
                                    <ImageIcon className="w-3 h-3 text-blue-400" />
                                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">首帧图</span>
                                  </div>
                                <span className="text-[10px] text-gray-500">{(data.firstFrameImageUrl || data.firstFrameImage) ? '1/1' : '0/1'}</span>
                                </div>
                              <div className="h-20">
                                <FrameDropZone
                                  nodeId={nodeId}
                                  frameType="firstFrame"
                                  label="首帧图"
                                  imageUrl={data.firstFrameImageUrl}
                                  imageData={data.firstFrameImage}
                                  onImageUpdate={applyFirstFrameUpdate}
                                  displayUrl={data.firstFrameImageUrl}
                                  showImage={true}
                                  compact={true}
                                  mediaRefCaption={
                                    data.firstFrameImage || data.firstFrameImageUrl
                                      ? flMediaCaptions.first
                                      : undefined
                                  }
                                />
                                      </div>
                              <p className="text-[9px] text-gray-500 mt-1.5">中键从画布/资产库拖入；或拖入本地图片</p>
                            </div>
                </div>
            ) : isSeedance20 ? (
                /* === Seedance2.0 三 Tab 资产区 === */
                <div className="p-4 flex flex-col gap-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                        {(
                            [
                                {
                                    id: 'text' as const,
                                    label: '文生视频',
                                    Icon: Type,
                                    active: 'bg-emerald-600 text-white shadow-sm shadow-emerald-950/40',
                                    idle: 'bg-gray-900 text-emerald-400/90 hover:bg-emerald-950/35 hover:text-emerald-300',
                                },
                                {
                                    id: 'image' as const,
                                    label: '图生视频',
                                    Icon: ImageIcon,
                                    active: 'bg-blue-600 text-white shadow-sm shadow-blue-950/40',
                                    idle: 'bg-gray-900 text-blue-400 hover:bg-blue-950/35 hover:text-blue-300',
                                },
                                {
                                    id: 'reference' as const,
                                    label: '参考生视频',
                                    Icon: Layers,
                                    active: 'bg-blue-600 text-white shadow-sm shadow-blue-950/40',
                                    idle: 'bg-gray-900 text-blue-400 hover:bg-blue-950/35 hover:text-blue-300',
                                },
                            ] as const
                        ).map((tab) => {
                            const TabIcon = tab.Icon;
                            const on = seedanceMode === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    type="button"
                                    onClick={() => switchSeedance20Tab(tab.id)}
                                    className={`inline-flex items-center justify-center gap-1 px-2.5 py-1.5 text-[10px] font-bold rounded-lg transition-colors ${
                                        on ? tab.active : tab.idle
                                    }`}
                                >
                                    <TabIcon className="w-3 h-3 shrink-0 opacity-95" aria-hidden />
                                    {tab.label}
                                </button>
                            );
                        })}
                    </div>

                    {seedanceMode === 'text' && (
                        <div className="text-[10px] text-red-300 px-2 py-2 leading-relaxed text-center bg-red-500/10 border border-red-500/30 rounded-lg">
                            ⚠ 文生视频以文字描述为主，请在下方提示词中写清主体、场景、运镜与风格。
                              </div>
                            )}

                    {seedanceMode === 'image' && (
                        <>
                            <div className="text-[10px] text-red-300 px-2 py-2 leading-relaxed text-left bg-red-500/10 border border-red-500/30 rounded-lg space-y-1.5">
                                <p className="text-center font-medium">⚠ 图生视频 · 素材要求</p>
                                <p>首帧必选；若使用尾帧，则首尾帧共 2 张。每张图须满足：</p>
                                <ul className="list-disc pl-4 space-y-0.5">
                                    <li>格式：JPEG、PNG</li>
                                    <li>宽高比（宽/高）：(0.4, 2.5)</li>
                                    <li>宽、高边长（px）：(300, 6000)</li>
                                    <li>大小：单张 &lt; 30 MB</li>
                                    <li>数量：仅首帧 1 张；首尾帧模式 2 张</li>
                                </ul>
                </div>
                            <div className="flex items-center gap-3 h-24">
                                <FrameDropZone
                                    nodeId={nodeId}
                                    frameType="firstFrame"
                                    label="首帧图"
                                    imageUrl={data.firstFrameImageUrl}
                                    imageData={data.firstFrameImage}
                                    onImageUpdate={applyFirstFrameUpdate}
                                    displayUrl={data.firstFrameImageUrl}
                                    showImage={true}
                                    mediaRefCaption={flMediaCaptions.first}
                                />
                                <FrameDropZone
                                    nodeId={nodeId}
                                    frameType="lastFrame"
                                    label="尾帧图(选填)"
                                    imageUrl={data.lastFrameImageUrl}
                                    imageData={data.lastFrameImage}
                                    onImageUpdate={applyLastFrameUpdate}
                                    displayUrl={data.lastFrameImageUrl}
                                    showImage={true}
                                    mediaRefCaption={flMediaCaptions.last}
                                />
                    </div>
                        </>
                    )}

                    {seedanceMode === 'reference' && (
                        <>
                            {/* 说明区：默认展开（更精简） */}
                            <div className="text-[10px] text-red-300 px-2 py-1.5 leading-relaxed bg-red-500/10 border border-red-500/30 rounded-lg">
                              <p className="font-medium">
                                ⚠ 参考生视频素材：图片≤9、视频≤3、音频≤3（拖入即可）
                              </p>
                              <p className="text-gray-400/90 mt-1">
                                本地文件：拖到下方虚线区或「图片」格；画布节点/资产库：按住<strong className="text-gray-300">鼠标中键</strong>拖到此处。
                              </p>
                              <div className="mt-1.5 space-y-1.5 text-gray-300/80">
                                <p>图片：JPEG/PNG；宽高比 0.4～2.5；边长 300～6000px；单张 &lt; 30MB</p>
                                <p>视频：MP4/MOV；480p/720p；单段 2～15s，总时长 ≤ 15s；单个 &lt; 50MB；FPS 24～60</p>
                                <p>音频：WAV/MP3；单段 2～15s，总时长 ≤ 15s；单个 &lt; 15MB</p>
                              </div>
                            </div>
                            <div
                              data-flowgen-media-drop="1"
                              data-flowgen-node-id={nodeId}
                              data-flowgen-drop-zone="seedance-reference"
                              onDragOver={handleSeedanceReferenceDragOver}
                              onDragLeave={handleSeedanceReferenceDragLeave}
                              onDrop={handleSeedanceReferenceDrop}
                              className={`rounded-xl border border-transparent p-1 -m-1 transition-colors ${
                                seedanceRefDropOver ? 'border-blue-500/55 bg-blue-500/10' : ''
                              }`}
                            >
                            <div
                              className="min-h-[220px] rounded-xl border-2 border-dashed border-gray-800 bg-gray-950/30 p-2 flex flex-col gap-2"
                              onDragOver={handleSeedanceReferenceDragOver}
                              onDrop={handleSeedanceReferenceDrop}
                            >
                              <div className="grid grid-cols-3 gap-2">
                                  <div
                                      onDragOver={handleSeedanceReferenceDragOver}
                                      onDrop={handleSeedanceReferenceDrop}
                                      onClick={() => {
                                          const input = document.createElement('input');
                                          input.type = 'file';
                                          input.accept = 'image/*';
                                          input.multiple = true;
                                          input.onchange = (e) => {
                                              const list = (e.target as HTMLInputElement).files;
                                              if (!list?.length) return;
                                              void handleSeedanceReferenceFiles(Array.from(list));
                                          };
                                          input.click();
                                      }}
                                      className="flex flex-col items-center justify-center p-4 border border-blue-500/25 rounded-xl bg-blue-950/25 text-center gap-1.5 cursor-pointer hover:border-blue-500/45 hover:bg-blue-950/40 transition-colors group"
                                  >
                                      <ImageIcon className="text-blue-400 w-6 h-6 group-hover:text-blue-300 transition-colors" />
                                      <div className="text-xs font-semibold text-blue-200/90 group-hover:text-blue-100">图片</div>
                                  </div>
                                  <div
                                      onDragOver={handleSeedanceReferenceDragOver}
                                      onDrop={handleSeedanceReferenceDrop}
                                      onClick={() => {
                                          const input = document.createElement('input');
                                          input.type = 'file';
                                          input.accept = 'video/*';
                                          input.multiple = true;
                                          input.onchange = (e) => {
                                              const list = (e.target as HTMLInputElement).files;
                                              if (!list?.length) return;
                                              void handleSeedanceReferenceFiles(Array.from(list));
                                          };
                                          input.click();
                                      }}
                                      className="flex flex-col items-center justify-center p-4 border border-sky-500/25 rounded-xl bg-sky-950/20 text-center gap-1.5 cursor-pointer hover:border-sky-500/45 hover:bg-sky-950/35 transition-colors group"
                                  >
                                      <Film className="text-sky-400 w-6 h-6 group-hover:text-sky-300 transition-colors" />
                                      <div className="text-xs font-semibold text-sky-200/90 group-hover:text-sky-100">视频</div>
                                  </div>
                                  <div
                                      onDragOver={handleSeedanceReferenceDragOver}
                                      onDrop={handleSeedanceReferenceDrop}
                                      onClick={() => {
                                          const input = document.createElement('input');
                                          input.type = 'file';
                                          input.accept = 'audio/*,.wav,.mp3,audio/wav,audio/mpeg';
                                          input.multiple = true;
                                          input.onchange = (e) => {
                                              const list = (e.target as HTMLInputElement).files;
                                              if (!list?.length) return;
                                              void handleSeedanceReferenceFiles(Array.from(list));
                                          };
                                          input.click();
                                      }}
                                      className="flex flex-col items-center justify-center p-4 border border-violet-500/25 rounded-xl bg-violet-950/20 text-center gap-1.5 cursor-pointer hover:border-violet-500/45 hover:bg-violet-950/35 transition-colors group"
                                  >
                                      <Music className="text-violet-400 w-6 h-6 group-hover:text-violet-300 transition-colors" />
                                      <div className="text-xs font-semibold text-violet-200/90 group-hover:text-violet-100">音频</div>
                                  </div>
                              </div>
                              {(() => {
                                const hasAny =
                                  seedanceShowMainInRefGrid ||
                                  seedanceRefDisplayEntries.length > 0 ||
                                  (data.referenceMovs || []).length > 0 ||
                                  (data.referenceAudios || []).length > 0;

                                if (!hasAny) {
                                  return (
                                    <div className="flex-1 flex items-center justify-center rounded-lg border border-dashed border-gray-800 bg-gray-950/20">
                                      <div className="text-center text-gray-600 leading-relaxed">
                                        <div className={`text-[10px] ${seedanceRefDropOver ? 'text-blue-300' : ''}`}>
                                          拖入图片 / 视频 / 音频到此区域
                                        </div>
                                        {seedanceRefDropOver && (
                                          <div className="text-[10px] text-blue-400 mt-1">松开以添加素材</div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                }

                                return (
                                  <div className="flex-1 rounded-lg border border-gray-800 bg-gray-950/20 p-2 overflow-y-auto custom-scrollbar">
                                    {(data.referenceMovs || []).length > 0 && (
                                      <div className="space-y-2 mb-2">
                                        {(data.referenceMovs || []).map((m, vi) => (
                                          <div
                                            key={`ref-mov-card-${vi}`}
                                            className="p-2 rounded-lg border border-gray-800 bg-gray-950/30 flex items-center gap-2"
                                          >
                                            <div className="relative w-28 h-16 rounded overflow-hidden bg-gray-900 shrink-0 border border-gray-800">
                                              {m.posterDataUrl &&
                                                !videoPlayingMap[`seedance-ref-video-${nodeId}-${vi}`] && (
                                                  <img
                                                    src={m.posterDataUrl}
                                                    alt=""
                                                    className="absolute inset-0 z-[1] w-full h-full object-cover pointer-events-none"
                                                  />
                                                )}
                                              <video
                                                id={`seedance-ref-video-${nodeId}-${vi}`}
                                                ref={(el) => {
                                                  videoRefs.current[`seedance-ref-video-${nodeId}-${vi}`] = el;
                                                }}
                                                src={inspectorVideoDisplaySrc(m.url)}
                                                className="w-full h-full object-cover"
                                                controls
                                                preload="auto"
                                                playsInline
                                                muted
                                                style={
                                                  m.posterDataUrl &&
                                                  !videoPlayingMap[`seedance-ref-video-${nodeId}-${vi}`]
                                                    ? { opacity: 0, pointerEvents: 'none' as const }
                                                    : undefined
                                                }
                                                onPlay={() =>
                                                  setVideoPlayState(`seedance-ref-video-${nodeId}-${vi}`, true)
                                                }
                                                onPause={() =>
                                                  setVideoPlayState(`seedance-ref-video-${nodeId}-${vi}`, false)
                                                }
                                                onEnded={() =>
                                                  setVideoPlayState(`seedance-ref-video-${nodeId}-${vi}`, false)
                                                }
                                              />
                                              <div className="absolute bottom-0 left-0 right-0 z-[2] bg-black/70 text-white text-[9px] font-medium text-center py-0.5 pointer-events-none">
                                                {(() => {
                                                  const mainPrev = data.imagePreview?.trim();
                                                  const isMainVideo =
                                                    !!mainPrev &&
                                                    isLikelyMainVideoUrl(mainPrev) &&
                                                    mainPrev === m.url;
                                                  return isMainVideo ? '主视频' : `视频${vi + 1}`;
                                                })()}
                                              </div>
                                            </div>
                                            <div className="flex-1 min-w-0">
                                              <p className="text-[10px] text-gray-300 truncate">已选视频素材</p>
                                              <p className="text-[9px] text-gray-500 truncate">用于 Seedance 2.0 参考生视频</p>
                                            </div>
                                            <button
                                              type="button"
                                              title={
                                                videoPlayingMap[`seedance-ref-video-${nodeId}-${vi}`] ? '暂停视频' : '播放视频'
                                              }
                                              onClick={() => toggleVideoById(`seedance-ref-video-${nodeId}-${vi}`)}
                                              className="p-1.5 rounded hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
                                            >
                                              {videoPlayingMap[`seedance-ref-video-${nodeId}-${vi}`] ? (
                                                <Pause size={14} />
                                              ) : (
                                                <Play size={14} />
                                              )}
                                            </button>
                                            <button
                                              type="button"
                                              title="移除视频素材"
                                              onClick={() => removeSeedanceReferenceMov(vi)}
                                              className="p-1.5 rounded hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
                                            >
                                              <X size={14} />
                                            </button>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                    <div className="grid grid-cols-3 gap-2">
                                      {seedanceShowMainInRefGrid && data.imagePreview && (
                                        <div className="group relative aspect-square rounded overflow-hidden border border-brand-500/50 bg-black">
                                          <img
                                            src={mainPreviewDisplaySrc}
                                            alt=""
                                            className="w-full h-full object-cover"
                                          />
                                          <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white text-[9px] font-medium text-center py-0.5 pointer-events-none z-[1]">
                                            {mainImageSlotCaption}
                                          </div>
                                        </div>
                                      )}
                                      {seedanceRefDisplayEntries.map(({ url, slotIndex }) => (
                                        <div
                                          key={`ref-img-slot-${slotIndex}`}
                                          className="group relative aspect-square rounded overflow-hidden border border-gray-800 bg-black"
                                        >
                                          <img src={resolveDisplayMediaUrl(url)} alt="" className="w-full h-full object-cover" />
                                          <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white text-[9px] font-medium text-center py-0.5 pointer-events-none z-[1]">
                                            {resolvePanelReferenceDisplayCaption(
                                              slotIndex,
                                              url,
                                              data.referenceImages,
                                              data.referenceImageLabels,
                                              panelReferenceLabelImagePreview(data),
                                              'seedanceSlot',
                                              projectAssetLabelRows,
                                              data.imageName
                                            )}
                                          </div>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              removeRefImage(slotIndex);
                                            }}
                                            className="absolute top-1 right-1 p-0.5 bg-black/60 hover:bg-red-500 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity z-[2]"
                                            title="移除"
                                          >
                                            <X size={12} />
                                          </button>
                                        </div>
                                      ))}
                                      {(data.referenceAudios || []).map((a, ai) => (
                                        <div
                                          key={`ref-aud-${ai}`}
                                          className="group relative flex flex-col justify-end rounded overflow-hidden border border-gray-800 bg-gray-950 min-h-[88px] p-2"
                                        >
                                          <div className="flex items-center gap-1.5 text-gray-500 mb-1">
                                            <Music className="w-3.5 h-3.5 shrink-0" />
                                            <span className="text-[9px] text-gray-400 truncate">音频</span>
                                          </div>
                                          <audio src={a.url} controls className="w-full h-8" preload="metadata" />
                                          <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white text-[9px] font-medium text-center py-0.5 pointer-events-none">
                                            音频{ai + 1}
                                          </div>
                                          <button
                                            type="button"
                                            onClick={() => removeSeedanceReferenceAudio(ai)}
                                            className="absolute top-1 right-1 p-0.5 bg-black/60 hover:bg-red-500 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity z-[2]"
                                            title="移除"
                                          >
                                            <X size={12} />
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                            </div>
                        </>
                    )}
                </div>
            ) : (isKeling || isVidu || isSeedance15) ? (
                /* === KELING / VIDU / SEEDANCE 首尾帧 UI（与 Input 节点一致，Output Mov 节点也显示）=== */
                <div className="p-4 flex flex-col gap-3">
                    <div className="flex items-center gap-2 mb-1">
                        <ArrowRightLeft className="text-brand-500 w-3 h-3" />
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">首尾帧</span>
                    </div>

                            <input 
                                type="file" 
                                ref={mainUploadInputRef}
                                className="hidden" 
                                accept="image/*"
                                onChange={handleMainUpload}
                            />
                    {supportsSubjectLibraryPicker && (
                        <div className="flex gap-2">
                        <button
                                type="button"
                            onClick={() => {
                                setShowLibraryModal(true);
                                loadLibraryImages();
                            }}
                                className="w-full flex flex-col items-center justify-center p-3 border-2 border-dashed border-gray-800 rounded-xl bg-gray-950/30 text-center gap-1.5 cursor-pointer hover:border-gray-700 transition-colors group"
                        >
                            <ImageIcon className="text-gray-600 w-6 h-6 group-hover:text-gray-500 transition-colors" />
                                <div className="text-xs font-semibold text-gray-400 group-hover:text-gray-300">从主体库文件选择</div>
                        </button>
                    </div>
                    )}
                    
                    <div className="text-[10px] text-red-300 px-2 py-2 leading-relaxed text-center bg-red-500/10 border border-red-500/30 rounded-lg">
                        ⚠ 支持JPG / PNG格式, 文件大小不超过10MB, 尺寸不小于300px
                    </div>

                    <div className="flex items-center gap-3 h-24">
                        <FrameDropZone 
                            nodeId={nodeId}
                            frameType="firstFrame"
                            label="首帧图" 
                            imageUrl={data.firstFrameImageUrl}
                            imageData={data.firstFrameImage}
                            onImageUpdate={applyFirstFrameUpdate}
                            displayUrl={data.firstFrameImageUrl}
                            showImage={true}
                            mediaRefCaption={flMediaCaptions.first}
                        />
                        
                        <div className="h-full flex items-center justify-center">
                            <button 
                                onClick={handleSwapFrames}
                                className="p-1.5 rounded-full hover:bg-gray-800 text-gray-500 hover:text-brand-500 transition-colors"
                                title="Swap Start/End Frames"
                            >
                                <ArrowRightLeft className="w-4 h-4" />
                            </button>
                        </div>

                        <FrameDropZone 
                            nodeId={nodeId}
                            frameType="lastFrame"
                            label="尾帧图" 
                            imageUrl={data.lastFrameImageUrl}
                            imageData={data.lastFrameImage}
                            onImageUpdate={applyLastFrameUpdate}
                            displayUrl={data.lastFrameImageUrl}
                            showImage={true}
                            mediaRefCaption={flMediaCaptions.last}
                        />
                    </div>
                </div>
            ) : isImage2 ? (
                <div className="p-4 flex flex-col gap-3">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <ImageIcon className="text-blue-400 w-3 h-3" />
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                          多图参考（选填）
                        </span>
                      </div>
                      <span className="text-[10px] text-gray-500">
                        {Math.min(3, image2RefSlotFilledCount)}/3
                      </span>
                    </div>
                    <div
                      className={`rounded-lg border bg-gray-950/40 p-3 transition-colors ${
                        isDragOverRefs ? 'border-brand-500/60 bg-brand-500/5' : 'border-gray-700'
                      }`}
                      data-flowgen-media-drop="1"
                      data-flowgen-node-id={nodeId}
                      data-flowgen-drop-zone="reference"
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleRefDrop}
                    >
                      <div className="flex gap-2">
                        {[0, 1, 2].map((slotIdx) => {
                          const isMainSlot = image2ShowMainInRefGrid && slotIdx === 0;
                          const refOffset = image2ShowMainInRefGrid ? 1 : 0;
                          const refEntry = !isMainSlot
                            ? image2RefEntries[slotIdx - refOffset]
                            : undefined;
                          const showAdd =
                            slotIdx === image2RefSlotFilledCount && image2RefSlotFilledCount < 3;
                          const displayUrl = isMainSlot ? data.imagePreview : refEntry?.url;
                          const slotLabel = isMainSlot
                            ? mainImageSlotCaption
                            : resolveReferenceSlotDisplayLabel(
                                refEntry?.slotIndex ?? 0,
                                data.referenceImages,
                                data.referenceImageLabels,
                                panelReferenceLabelImagePreview(data),
                                'panelSlot',
                                projectAssetLabelRows,
                                data.imageName
                              );
                          return (
                            <div key={slotIdx} className="flex-1 min-w-0">
                              {displayUrl ? (
                                <div
                                  className={`group relative aspect-[4/3] rounded-lg overflow-hidden border bg-gray-900 ${
                                    isMainSlot ? 'border-brand-500/50' : 'border-gray-700'
                                  }`}
                                >
                                  <img
                                    src={
                                      isMainSlot
                                        ? mainPreviewDisplaySrc
                                        : resolveDisplayMediaUrl(displayUrl)
                                    }
                                    alt=""
                                    className="w-full h-full object-cover"
                                  />
                                  <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white text-[9px] font-medium text-center py-0.5 pointer-events-none">
                                    {slotLabel}
                                  </div>
                                  {!isMainSlot && (
                                  <button
                                    type="button"
                                    title="移除"
                                    onClick={() => removeImage2RefSlot(slotIdx)}
                                    className="absolute top-1 right-1 p-0.5 bg-black/60 hover:bg-red-500 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity z-[2]"
                                  >
                                    <X size={12} />
                                  </button>
                                  )}
                                </div>
                              ) : showAdd ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const inp = document.createElement('input');
                                    inp.type = 'file';
                                    inp.accept = 'image/jpeg,image/png,.jpg,.jpeg,.png';
                                    inp.onchange = () => handleImage2ReferenceFile(slotIdx, inp.files?.[0]);
                                    inp.click();
                                  }}
                                  onDragOver={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    e.dataTransfer.dropEffect = 'copy';
                                  }}
                                  onDrop={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    void handleRefDrop(e);
                                  }}
                                  className="w-full aspect-[4/3] rounded-lg border border-dashed border-gray-600 bg-gray-900/60 hover:border-gray-500 flex flex-col items-center justify-center gap-1.5 text-gray-400 transition-colors cursor-pointer"
                                >
                                  <UploadCloud className="w-6 h-6" />
                                  <span className="text-[11px] text-gray-500">上传图片</span>
                                </button>
                              ) : (
                                <div className="w-full aspect-[4/3] rounded-lg border border-dashed border-gray-800 bg-gray-950/50 flex flex-col items-center justify-center gap-1 text-gray-600 opacity-70 pointer-events-none">
                                  <UploadCloud className="w-5 h-5 opacity-50" />
                                  <span className="text-[10px]">上传图片</span>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <Sparkles className="text-brand-500 w-3 h-3" />
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">风格</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {(
                        [
                          {
                            id: 'vivid' as const,
                            title: '生动',
                            sub: '超写实且极具戏剧性',
                          },
                          {
                            id: 'natural' as const,
                            title: '自然',
                            sub: '更自然、不那么写实',
                          },
                        ] as const
                      ).map((card) => {
                        const selected =
                          card.id === 'natural'
                            ? data.image2Style === 'natural'
                            : (data.image2Style ?? 'vivid') === 'vivid';
                        return (
                          <button
                            key={card.id}
                            type="button"
                            onClick={() => onUpdate({ image2Style: card.id })}
                            className={`relative rounded-xl overflow-hidden text-left min-h-[88px] border-2 transition-all ${
                              selected ? 'border-amber-400 ring-1 ring-amber-400/40' : 'border-transparent'
                            }`}
                          >
                            <div
                              className="absolute inset-0"
                              style={{
                                background:
                                  card.id === 'vivid'
                                    ? 'linear-gradient(135deg, #1a4d2e 0%, #0f2918 45%, #3d2914 100%)'
                                    : 'linear-gradient(135deg, #1e3a5f 0%, #1a2838 50%, #2d4a22 100%)',
                              }}
                            />
                            <div className="absolute inset-0 bg-black/45" />
                            <div className="relative z-[1] p-3 flex flex-col justify-end h-full min-h-[88px]">
                              <div className="text-xs font-bold text-white tracking-wide">{card.title}</div>
                              <div className="text-[10px] text-white/85 leading-snug mt-0.5">{card.sub}</div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
            ) : (
                /* === STANDARD MULTI-IMAGE UI === */
                <div className="flex flex-col h-64">
                    <div className="p-4 pb-2 flex-none">
                        <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                                <ImageIcon className="text-blue-400 w-3 h-3" />
                                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">多图参考</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => openRefFilePicker('image/*')}
                                className="text-[10px] px-2 py-0.5 rounded border border-gray-700 text-gray-400 hover:text-brand-300 hover:border-brand-500/40"
                              >
                                上传
                              </button>
                            <span className="text-[10px] text-gray-500">
                              {(isNano
                                ? panelReferenceDisplaySlots(data.referenceImages).filter(
                                    ({ url }) => !isLikelyMainVideoUrl(url)
                                  )
                                : panelReferenceDisplaySlots(data.referenceImages)
                              ).length}
                              /14
                            </span>
                            </div>
                        </div>
                    </div>
                    {(() => {
                      /** Nano 多图参考仅图片：主预览为视频时不占参考格，也不当作「已有一张参考」 */
                      const nanoHideVideoMain =
                        isNano && !!data.imagePreview && isLikelyMainVideoUrl(data.imagePreview);
                      const showMainInRefGrid =
                        Boolean(data.imagePreview) &&
                        shouldShowPanelMainImageSlot(data) &&
                        !nanoHideVideoMain;
                      const refList = data.referenceImages || [];
                      let refDisplayEntries = buildPanelReferenceDisplayEntries(refList, {
                        imagePreview: data.imagePreview,
                        dedupeAgainstMain:
                          isNano && shouldDedupePanelRefsAgainstMainPreview(data),
                        referenceImageLabels: data.referenceImageLabels,
                        projectAssets: projectAssetLabelRows,
                      });
                      if (isNano && showMainInRefGrid) {
                        refDisplayEntries = filterPanelReferenceDisplayEntriesExcludingMainPreview(
                          refDisplayEntries,
                          data.imagePreview,
                          data.imageName,
                          data.referenceImageLabels,
                          projectAssetLabelRows
                        );
                      }
                      const refSlots = refDisplayEntries
                        .filter(({ url }) => !isNano || !isLikelyMainVideoUrl(url))
                        .map(({ url, slotIndex }) => ({ img: url, idx: slotIndex }));
                      const showEmptyHint = refSlots.length === 0 && !showMainInRefGrid;
                      return (
                    <div 
                        className={`
                            flex-1 mx-3 mb-2 rounded-lg border-2 border-dashed transition-all duration-200 overflow-y-auto custom-scrollbar relative
                            ${isDragOverRefs ? 'border-brand-500 bg-brand-500/10' : 'border-gray-800 bg-gray-950/50 hover:border-gray-700'}
                        `}
                        data-flowgen-media-drop="1"
                        data-flowgen-node-id={nodeId}
                        data-flowgen-drop-zone="reference"
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleRefDrop}
                    >
                        {showEmptyHint ? (
                            <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-600 gap-2 p-3 pointer-events-none">
                            <Plus className={`w-5 h-5 ${isDragOverRefs ? 'text-brand-400' : 'opacity-40'}`} />
                            <span className={`text-[10px] text-center ${isDragOverRefs ? 'text-brand-300' : 'opacity-60'}`}>
                              拖入图片 / 中键从画布拖入
                            </span>
                            <button
                              type="button"
                              onClick={() => openRefFilePicker('image/*')}
                              className="mt-1 px-3 py-1.5 text-[10px] font-medium rounded-lg border border-gray-700 bg-gray-900 text-gray-300 hover:border-brand-500/50 hover:text-brand-300 transition-colors pointer-events-auto"
                            >
                              上传图片
                            </button>
                            </div>
                        ) : (
                            <div className="p-2 grid grid-cols-3 gap-2">
                            {showMainInRefGrid && (
                              <div className="group relative aspect-square rounded overflow-hidden border border-brand-500/40 bg-black">
                                {isLikelyMainVideoUrl(data.imagePreview) ? (
                                  <video
                                    src={mainPreviewDisplaySrc}
                                    className="w-full h-full object-cover"
                                    muted
                                    playsInline
                                    controls
                                    preload="metadata"
                                  />
                                ) : (
                                  <img src={mainPreviewDisplaySrc} alt="main" className="w-full h-full object-cover" />
                                )}
                                <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white text-[9px] font-medium text-center py-0.5 pointer-events-none">
                                  {mainImageSlotCaption}
                                </div>
                              </div>
                            )}
                            {refSlots.map(({ img, idx }) => (
                                <div key={idx} className="group relative aspect-square rounded overflow-hidden border border-gray-800 bg-black">
                                <img src={resolveDisplayMediaUrl(img)} alt="ref" className="w-full h-full object-cover" />
                                <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white text-[9px] font-medium text-center py-0.5 pointer-events-none">
                                  {resolveReferenceSlotDisplayLabel(
                                    idx,
                                    refList,
                                    data.referenceImageLabels,
                                    panelReferenceLabelImagePreview(data),
                                    'panelSlot',
                                    projectAssetLabelRows,
                                    data.imageName
                                  )}
                                </div>
                                <button 
                                    type="button"
                                    onClick={() => removeRefImage(idx)}
                                    className="absolute top-1 right-1 p-0.5 bg-black/60 hover:bg-red-500 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity"
                                    title="移除"
                                >
                                    <X size={12} />
                                </button>
                                </div>
                            ))}
                            </div>
                        )}
                    </div>
                      );
                    })()}
                </div>
            )}
            </div>
          </div>

          <InspectorResizeHandle
            title="拖动：仅调整素材区高度，下方整体上移或下移"
            onPointerDown={(e) => beginInspectorResize('assetsPrompt', e)}
          />

          {/* SECTION 4–5: 创意描述 + 不希望呈现的内容（紧贴素材区下方，全模型统一顺序） */}
          {/* SECTION 4: PROMPT — 与输入区同一背景，避免标题与 textarea 之间出现“分割线”观感 */}
          {/* 一律 flex-none：若用 flex-1 + textarea h-full，在可滚侧栏里会溢出盖住下方「画面比例」等区块（Nano 等） */}
          <div className="flex flex-col flex-none bg-gray-900">
            <div className="px-3 pt-3 pb-1.5 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-2">
                <Type className="text-purple-400 w-3 h-3" />
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">创意描述</span>
              </div>
              {projectAssetLibraryEnabled && (
                <div className="flex flex-wrap items-center gap-1.5 justify-end max-w-[70%]">
                  <span className="text-[9px] text-gray-500 shrink-0">素材引用:</span>
                  <button
                    type="button"
                    onClick={runScanProjectAssetsOnPrompt}
                    disabled={projectAssetScanRows.length === 0}
                    className="text-[9px] px-1.5 py-0.5 rounded border border-fuchsia-500/40 text-fuchsia-300 hover:bg-fuchsia-500/15 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                    title={
                      projectAssetScanRows.length > 0
                        ? '根据当前项目素材名，在文中补全 @资产:…'
                        : '项目素材库为空或仍在加载，暂无法扫描'
                    }
                  >
                    扫描 @素材
                  </button>
                </div>
              )}
            </div>

            <div className="px-3 pt-0 pb-3 flex flex-col gap-1 relative">
                {mentionDropdownItems.length > 0 && (
                  <div
                    className={`absolute left-3 right-3 top-0 rounded-lg border border-gray-700 bg-gray-950 shadow-lg z-30 overflow-visible ${
                      mentionDropdownItems.length > 6 ? 'grid grid-cols-2 gap-0' : 'flex flex-col'
                    }`}
                  >
                    {mentionDropdownItems.map((it, i) => (
                      <button
                        key={`${it.insertText}-${i}`}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => applyPromptMentionPick(it)}
                        className={`w-full text-left px-2 py-1.5 text-xs font-mono ${
                          i === mentionHighlight % mentionDropdownItems.length
                            ? 'bg-brand-500/25 text-brand-200'
                            : 'text-gray-200 hover:bg-gray-800'
                        }`}
                      >
                        <span className="text-brand-300">{it.insertText}</span>
                        <span className="text-gray-300 ml-2">
                          {it.kind === 'projectAsset'
                            ? it.label.replace(/^素材·/, '') || it.label
                            : it.label}
                        </span>
                        <span className="text-gray-500 ml-1 text-xs">
                          {it.kind === 'mainImage'
                            ? '主图'
                            : it.kind === 'mainVideo'
                              ? '主视频'
                              : it.kind === 'image'
                                ? it.refFrameIndex === 0
                                  ? '首帧'
                                  : it.refFrameIndex === 1
                                    ? '尾帧'
                                    : '图片'
                                : it.kind === 'video'
                                  ? '视频'
                                  : it.kind === 'projectAsset'
                                    ? '项目'
                                    : '音频'}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="relative">
                  {inspectorPromptValue.length > 0 && (
                    <div
                      ref={promptHighlightRef}
                      className="absolute inset-0 z-[1] pointer-events-none overflow-hidden custom-scrollbar"
                      aria-hidden
                    >
                      <div ref={promptHighlightInnerRef} className={`${INSPECTOR_PROMPT_TYPO_CLASS} text-gray-200`}>
                        {renderPromptWithTokenHighlights(inspectorPromptValue, projectAssetLabelRows)}
                      </div>
                    </div>
                  )}
                  <textarea
                      ref={promptTextareaRef}
                      style={{ minHeight: inspectorPanelHeights.promptTextMinPx }}
                      className={`relative z-[2] block bg-transparent resize-none overflow-y-scroll focus:outline-none custom-scrollbar placeholder:text-gray-700 selection:bg-brand-500/30 ${INSPECTOR_PROMPT_TEXT_CLASS} ${
                        inspectorPromptValue.length > 0
                          ? 'text-transparent [caret-color:rgb(229,231,235)] [-webkit-text-fill-color:transparent]'
                          : 'text-gray-200'
                      }`}
                      placeholder={
                          isJimeng
                            ? promptMentionItems.length > 0
                              ? '模板：先写【身份锁定：严格保持@主图人物身份与面部不变】→ 再写【仅允许变化】→ 再写【禁止变化】→ 最后写【画面要求】。输入 @ 可引用主图/主视频与拖入素材（@图片1/@视频1；简写 @图片/@视频=第1项）'
                              : '模板：先写【身份锁定】→【仅允许变化】→【禁止变化】→【画面要求】'
                            : isSeedance20 && seedanceMode === 'text'
                              ? '模板：先写【身份锁定】→【仅允许变化】→【禁止变化】→【画面要求】'
                              : promptMentionItems.length > 0
                                ? '模板：先写【身份锁定：严格保持@主图人物脸/年龄不变】→【仅允许变化】→【禁止变化】→【画面要求】。输入 @ 可引用主图/主视频、首尾帧与面板已拖入素材；项目库素材请用「扫描 @素材」'
                                : '模板：先写【身份锁定】→【仅允许变化】→【禁止变化】→【画面要求】。有主预览或参考素材后可输入 @'
                      }
                      value={inspectorPromptValue}
                      onChange={handlePromptChange}
                      onKeyDown={handlePromptKeyDown}
                      onPaste={handlePromptPaste}
                      onScroll={(e) => syncPromptHighlightScroll(e.currentTarget)}
                      onFocus={(e) => syncPromptHighlightScroll(e.currentTarget)}
                      onSelect={(e) => syncPromptHighlightScroll(e.currentTarget)}
                      onKeyUp={(e) => syncPromptHighlightScroll(e.currentTarget)}
                      onClick={(e) => syncPromptHighlightScroll(e.currentTarget)}
                  />
                </div>
            </div>
          </div>

          {hasInspectorNegative ? (
            <InspectorResizeHandle
              title="拖动：仅调整创意描述高度，负向提示及以下整体上移或下移"
              onPointerDown={(e) => beginInspectorResize('promptNegative', e)}
            />
          ) : (
            <InspectorResizeHandle
              title="拖动：仅调整创意描述高度，参数区整体上移或下移"
              onPointerDown={(e) => beginInspectorResize('negativeOrTail', e)}
            />
          )}

          {/* SECTION 5: NEGATIVE PROMPT (Only visible for Keling/即梦/Vidu/Seedance Video models) */}
          {(isKeling || isJimeng || isVidu || isSeedance) && (
            <div className="flex flex-col flex-shrink-0 bg-gray-900">
                <div className="p-3 flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-2">
                    <Ban className="text-red-400 w-3 h-3" />
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">不希望呈现的内容（选项）</span>
                </div>
                </div>

                <div className="flex-1 p-3 bg-gray-950/30 min-h-0">
                    <textarea
                        style={{ minHeight: inspectorPanelHeights.negativeBlockMinPx }}
                        className="w-full h-full bg-transparent text-gray-200 text-xs resize-none focus:outline-none placeholder:text-gray-700 font-mono leading-normal custom-scrollbar"
                        placeholder="例如：模糊，低质量，变形..."
                        value={data.negativePrompt || ''}
                        onChange={(e) => setNegativePromptByContext(e.target.value)}
                    />
                </div>
            </div>
          )}

          {hasInspectorNegative && (
            <InspectorResizeHandle
              title="拖动：仅调整负向提示高度，参数区整体上移或下移"
              onPointerDown={(e) => beginInspectorResize('negativeOrTail', e)}
            />
          )}

          {/* SECTION 3: SETTINGS */}
          <div className="border-b border-gray-800 bg-gray-900/50 p-4 space-y-4 flex-none">
            {isJimeng ? (
                /* === 即梦3.0 Pro SETTINGS === */
                <>
                    {/* 专业模式 */}
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">专业模式</span>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={data.jimengProfessionalMode ?? false}
                            onClick={() => onUpdate({ jimengProfessionalMode: !(data.jimengProfessionalMode ?? false) })}
                            className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500/50 ${
                                data.jimengProfessionalMode ? 'bg-brand-500' : 'bg-gray-700'
                            }`}
                        >
                            <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition ${
                                data.jimengProfessionalMode ? 'translate-x-4' : 'translate-x-0.5'
                            }`} />
                        </button>
                    </div>
                    {/* 生成数量 */}
                    <div className="space-y-1">
                        <div className="flex items-center gap-2 text-gray-400">
                            <Film size={12} />
                            <span className="text-[10px] font-bold uppercase tracking-wider">生成数量</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <input
                                type="range"
                                min={1}
                                max={4}
                                value={parseInt((data.numberOfImages || '1条').replace('条', ''), 10) || 1}
                                onChange={(e) => onUpdate({ numberOfImages: `${e.target.value}条` })}
                                className="flex-1 h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-brand-500"
                            />
                            <span className="text-xs font-mono text-brand-400 w-6">{parseInt((data.numberOfImages || '1条').replace('条', ''), 10) || 1}</span>
                        </div>
                    </div>
                    {/* 分辨率 */}
                    <div className="space-y-1">
                        <div className="flex items-center gap-2 text-gray-400">
                            <Monitor size={12} />
                            <span className="text-[10px] font-bold uppercase tracking-wider">分辨率</span>
                        </div>
                        <div className="inline-block px-3 py-1.5 rounded-lg bg-gray-800 text-gray-300 text-xs font-medium border border-gray-700">
                            {data.jimengResolution || '1080p'}
                        </div>
                    </div>
                    {/* 视频比例 */}
                    <div className="space-y-1">
                        <div className="flex items-center gap-2 text-gray-400">
                            <Ratio size={12} />
                            <span className="text-[10px] font-bold uppercase tracking-wider">视频比例</span>
                        </div>
                        <div className="inline-block px-3 py-1.5 rounded-lg bg-gray-800 text-gray-300 text-xs font-medium border border-gray-700">
                            {data.jimengVideoRatio || '自动匹配'}
                        </div>
                    </div>
                    {/* 时长 */}
                    <div className="space-y-1">
                        <div className="flex items-center gap-2 text-gray-400">
                            <Clock size={12} />
                            <span className="text-[10px] font-bold uppercase tracking-wider">时长</span>
                        </div>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => onUpdate({ duration: '5s' })}
                                className={`flex-1 py-2 px-3 text-xs font-medium rounded-lg border transition-colors ${
                                    (data.duration || '5s') === '5s'
                                        ? 'bg-brand-500/20 text-brand-400 border-brand-500/30'
                                        : 'bg-gray-950 border-gray-700 text-gray-500 hover:border-gray-600'
                                }`}
                            >
                                5秒
                            </button>
                            <button
                                type="button"
                                onClick={() => onUpdate({ duration: '10s' })}
                                className={`flex-1 py-2 px-3 text-xs font-medium rounded-lg border transition-colors ${
                                    data.duration === '10s'
                                        ? 'bg-brand-500/20 text-brand-400 border-brand-500/30'
                                        : 'bg-gray-950 border-gray-700 text-gray-500 hover:border-gray-600'
                                }`}
                            >
                                10秒
                            </button>
                        </div>
                    </div>
                </>
            ) : isVidu ? (
                /* === VIDU 2.0 SETTINGS（参考图片规格）=== */
                <>
                    {/* 时长 */}
                    <div className="space-y-1">
                        <div className="flex items-center gap-2 text-gray-400">
                            <Info size={12} className="text-gray-500 shrink-0" />
                            <Clock size={12} />
                            <span className="text-[10px] font-bold uppercase tracking-wider">时长</span>
                        </div>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => onUpdate({ viduDuration: '4s' })}
                                className={`flex-1 py-2 px-3 text-xs font-medium rounded-lg border transition-colors ${
                                    (data.viduDuration || '4s') === '4s'
                                        ? 'bg-brand-500/20 text-brand-400 border-brand-500/30'
                                        : 'bg-gray-950 border-gray-700 text-gray-500 hover:border-gray-600'
                                }`}
                            >
                                4秒
                            </button>
                            <button
                                type="button"
                                onClick={() => onUpdate({ viduDuration: '8s' })}
                                className={`flex-1 py-2 px-3 text-xs font-medium rounded-lg border transition-colors ${
                                    data.viduDuration === '8s'
                                        ? 'bg-brand-500/20 text-brand-400 border-brand-500/30'
                                        : 'bg-gray-950 border-gray-700 text-gray-500 hover:border-gray-600'
                                }`}
                            >
                                8秒
                            </button>
                        </div>
                    </div>
                    {/* 清晰度 */}
                    <div className="space-y-1">
                        <div className="flex items-center gap-2 text-gray-400">
                            <Info size={12} className="text-gray-500 shrink-0" />
                            <Monitor size={12} />
                            <span className="text-[10px] font-bold uppercase tracking-wider">清晰度</span>
                        </div>
                        <div className="flex gap-2 flex-wrap">
                            {(['360p', '720p', '1080p'] as const).map((q) => (
                                <button
                                    key={q}
                                    type="button"
                                    onClick={() => onUpdate({ viduClarity: q })}
                                    className={`flex-1 min-w-0 py-2 px-2 text-xs font-medium rounded-lg border transition-colors ${
                                        (data.viduClarity || '1080p') === q
                                            ? 'bg-brand-500/20 text-brand-400 border-brand-500/30'
                                            : 'bg-gray-950 border-gray-700 text-gray-500 hover:border-gray-600'
                                    }`}
                                >
                                    {q}
                                </button>
                            ))}
                        </div>
                    </div>
                    {/* 运动幅度 */}
                    <div className="space-y-1">
                        <div className="flex items-center gap-2 text-gray-400">
                            <Info size={12} className="text-gray-500 shrink-0" />
                            <SlidersHorizontal size={12} />
                            <span className="text-[10px] font-bold uppercase tracking-wider">运动幅度</span>
                        </div>
                        <div className="flex gap-2 flex-wrap">
                            {(['自动', '小', '中', '大'] as const).map((m) => (
                                <button
                                    key={m}
                                    type="button"
                                    onClick={() => onUpdate({ viduMotionRange: m })}
                                    className={`flex-1 min-w-0 py-2 px-2 text-xs font-medium rounded-lg border transition-colors ${
                                        (data.viduMotionRange || '自动') === m
                                            ? 'bg-brand-500/20 text-brand-400 border-brand-500/30'
                                            : 'bg-gray-950 border-gray-700 text-gray-500 hover:border-gray-600'
                                    }`}
                                >
                                    {m}
                                </button>
                            ))}
                        </div>
                    </div>
                    {/* 宽高比 */}
                    <div className="space-y-1">
                        <div className="flex items-center gap-2 text-gray-400">
                            <Ratio size={12} />
                            <span className="text-[10px] font-bold uppercase tracking-wider">宽高比</span>
                        </div>
                        <div className="flex gap-2">
                            {(['16:9', '9:16', '1:1'] as const).map((r) => (
                                <button
                                    key={r}
                                    type="button"
                                    onClick={() => onUpdate({ aspectRatio: r })}
                                    className={`flex-1 py-2 px-2 text-xs font-medium rounded-lg border transition-colors ${
                                        (data.aspectRatio || '16:9') === r
                                            ? 'bg-brand-500/20 text-brand-400 border-brand-500/30'
                                            : 'bg-gray-950 border-gray-700 text-gray-500 hover:border-gray-600'
                                    }`}
                                >
                                    {r}
                                </button>
                            ))}
                        </div>
                    </div>
                    {/* 数量 */}
                    <div className="space-y-1">
                        <div className="flex items-center gap-2 text-gray-400">
                            <Film size={12} />
                            <span className="text-[10px] font-bold uppercase tracking-wider">数量</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <input
                                type="range"
                                min={1}
                                max={4}
                                value={Math.min(4, Math.max(1, parseInt((data.numberOfImages || '1条').replace('条', ''), 10) || 1))}
                                onChange={(e) => onUpdate({ numberOfImages: `${e.target.value}条` })}
                                className="flex-1 h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-brand-500"
                            />
                            <span className="text-xs font-mono text-brand-400 w-6">{parseInt((data.numberOfImages || '1条').replace('条', ''), 10) || 1}</span>
                        </div>
                    </div>
                </>
            ) : isSeedance ? (
                /* === seedance1.5-pro SETTINGS（参考图片）=== */
                <>
                    {/* 生成数量 */}
                    <div className="space-y-1">
                        <div className="flex items-center gap-2 text-gray-400">
                            <Film size={12} />
                            <span className="text-[10px] font-bold uppercase tracking-wider">生成数量</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <input
                                type="range"
                                min={1}
                                max={4}
                                value={Math.min(4, Math.max(1, parseInt((data.numberOfImages || '1条').replace('条', ''), 10) || 1))}
                                onChange={(e) => onUpdate({ numberOfImages: `${e.target.value}条` })}
                                className="flex-1 h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-brand-500"
                            />
                            <span className="text-xs font-mono text-brand-400 w-6">{parseInt((data.numberOfImages || '1条').replace('条', ''), 10) || 1}</span>
                        </div>
                    </div>
                    {/* 分辨率 */}
                    <div className="space-y-1">
                        <div className="flex items-center gap-2 text-gray-400">
                            <Info size={12} className="text-gray-500 shrink-0" />
                            <Monitor size={12} />
                            <span className="text-[10px] font-bold uppercase tracking-wider">分辨率</span>
                        </div>
                        <div className="flex gap-2 flex-wrap">
                            {(isSeedance20HighQuality
                              ? (['480p', '720p', '1080p'] as const)
                              : (['480p', '720p'] as const)
                            ).map((q) => (
                                <button
                                    key={q}
                                    type="button"
                                    onClick={() => onUpdate({ seedanceResolution: q })}
                                    className={`flex-1 min-w-[4.5rem] py-2 px-3 text-xs font-medium rounded-lg border transition-colors ${
                                        (data.seedanceResolution || getSeedanceDefaultResolution(data.selectedModel)) === q
                                            ? 'bg-brand-500/20 text-brand-400 border-brand-500/30'
                                            : 'bg-gray-950 border-gray-700 text-gray-500 hover:border-gray-600'
                                    }`}
                                >
                                    {q}
                                </button>
                            ))}
                        </div>
                    </div>
                    {/* 视频比例：2.0 文生/参考生为六宫格（蓝系，与参考生视频素材区一致）；图生 / 1.5 为自动匹配 */}
                    {isSeedance20 ? (
                        <div className="space-y-1">
                            <div className="flex items-start gap-2">
                                <div className="flex flex-col gap-0.5 shrink-0 pt-1.5 w-[4.75rem]">
                                    <div className="flex items-center gap-1.5 text-blue-400">
                                        <Ratio size={12} className="shrink-0" aria-hidden />
                                        <span className="text-[10px] font-bold uppercase tracking-wider text-blue-200/90 leading-tight">
                                            视频比例
                                        </span>
                                    </div>
                                </div>
                                <div className="flex-1 min-w-0 space-y-1.5">
                                    <div className="grid grid-cols-4 gap-1.5">
                                        {SEEDANCE_TEXT_REF_ASPECT_RATIOS.slice(0, 4).map((r) => {
                                            const raw = data.seedanceAspectRatio?.trim();
                                            const cur =
                                              raw &&
                                              (SEEDANCE_TEXT_REF_ASPECT_RATIOS as readonly string[]).includes(raw)
                                                ? raw
                                                : normalizeSeedanceAspectForTextRef(raw);
                                            const sel = cur === r;
                                            return (
                                                <button
                                                    key={r}
                                                    type="button"
                                                    onClick={() => onUpdate({ seedanceAspectRatio: r })}
                                                    className={`py-2 px-1 text-xs font-semibold rounded-lg border transition-colors ${
                                                        sel
                                                            ? 'bg-blue-600 text-white border-blue-500 shadow-sm shadow-blue-950/35'
                                                            : 'bg-blue-950/25 text-blue-200/75 border-blue-500/25 hover:border-blue-500/45 hover:bg-blue-950/40'
                                                    }`}
                                                >
                                                    {r}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <div className="grid grid-cols-4 gap-1.5">
                                        {SEEDANCE_TEXT_REF_ASPECT_RATIOS.slice(4, 6).map((r) => {
                                            const raw = data.seedanceAspectRatio?.trim();
                                            const cur =
                                              raw &&
                                              (SEEDANCE_TEXT_REF_ASPECT_RATIOS as readonly string[]).includes(raw)
                                                ? raw
                                                : normalizeSeedanceAspectForTextRef(raw);
                                            const sel = cur === r;
                                            return (
                                                <button
                                                    key={r}
                                                    type="button"
                                                    onClick={() => onUpdate({ seedanceAspectRatio: r })}
                                                    className={`col-span-2 py-2 px-1 text-xs font-semibold rounded-lg border transition-colors ${
                                                        sel
                                                            ? 'bg-blue-600 text-white border-blue-500 shadow-sm shadow-blue-950/35'
                                                            : 'bg-blue-950/25 text-blue-200/75 border-blue-500/25 hover:border-blue-500/45 hover:bg-blue-950/40'
                                                    }`}
                                                >
                                                    {r}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-1">
                            <div className="flex items-center gap-2">
                                <Info size={12} className="text-gray-500 shrink-0" />
                                <div className="flex items-center gap-1.5 text-blue-400">
                                    <Ratio size={12} className="shrink-0" aria-hidden />
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-blue-200/90">
                                        视频比例
                                    </span>
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => onUpdate({ seedanceAspectRatio: '自动匹配' })}
                                    className={`flex-1 py-2 px-3 text-xs font-medium rounded-lg border transition-colors ${
                                        (data.seedanceAspectRatio || '自动匹配') === '自动匹配'
                                            ? 'bg-blue-600 text-white border-blue-500 shadow-sm shadow-blue-950/30'
                                            : 'bg-blue-950/25 text-blue-200/70 border-blue-500/25 hover:border-blue-500/45 hover:bg-blue-950/40'
                                    }`}
                                >
                                    自动匹配
                                </button>
                            </div>
                        </div>
                    )}
                    {isSeedance20 && seedanceMode === 'reference' && (
                        <div className="space-y-1">
                            <div className="flex items-center gap-2 text-gray-400">
                                <Info size={12} className="text-gray-500 shrink-0" />
                                <span className="text-[10px] font-bold uppercase tracking-wider">比例策略</span>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => onUpdate({ seedanceReferenceRatioMode: 'force' })}
                                    className={`flex-1 py-2 px-3 text-xs font-medium rounded-lg border transition-colors ${
                                        (data.seedanceReferenceRatioMode || 'force') === 'force'
                                            ? 'bg-brand-500/20 text-brand-400 border-brand-500/30'
                                            : 'bg-gray-950 border-gray-700 text-gray-500 hover:border-gray-600'
                                    }`}
                                >
                                    强制比例
                                </button>
                                <button
                                    type="button"
                                    onClick={() => onUpdate({ seedanceReferenceRatioMode: 'auto' })}
                                    className={`flex-1 py-2 px-3 text-xs font-medium rounded-lg border transition-colors ${
                                        data.seedanceReferenceRatioMode === 'auto'
                                            ? 'bg-blue-600 text-white border-blue-500 shadow-sm shadow-blue-950/30'
                                            : 'bg-blue-950/25 text-blue-200/70 border-blue-500/25 hover:border-blue-500/45 hover:bg-blue-950/40'
                                    }`}
                                >
                                    自动匹配
                                </button>
                            </div>
                        </div>
                    )}
                    {/* 时长：1.5 Pro / 2.0 均为 4–15s */}
                    <div className="space-y-1">
                        <div className="flex items-center gap-2 text-gray-400">
                            <Info size={12} className="text-gray-500 shrink-0" />
                            <Clock size={12} />
                            <span className="text-[10px] font-bold uppercase tracking-wider">时长</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <input
                                type="range"
                                min={SEEDANCE_DURATION_MIN}
                                max={SEEDANCE_DURATION_MAX}
                                step={1}
                                value={parseSeedanceDurationSeconds(data.seedanceDuration)}
                                onChange={(e) =>
                                    onUpdate({
                                        seedanceDuration: formatSeedanceDurationLabel(Number(e.target.value)),
                                    })
                                }
                                className="flex-1 h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-brand-500"
                            />
                            <span className="text-xs font-mono text-brand-400 w-8 tabular-nums">
                                {parseSeedanceDurationSeconds(data.seedanceDuration)}s
                            </span>
                        </div>
                    </div>
                    {/* 生成音频 */}
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">生成音频</span>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={data.seedanceGenerateAudio ?? false}
                            onClick={() =>
                                onUpdate({
                                    seedanceGenerateAudio: !(data.seedanceGenerateAudio ?? false),
                                })
                            }
                            className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500/50 ${
                                (data.seedanceGenerateAudio ?? false)
                                    ? 'bg-brand-500'
                                    : 'bg-gray-700'
                            }`}
                        >
                            <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition ${
                                (data.seedanceGenerateAudio ?? false)
                                    ? 'translate-x-4'
                                    : 'translate-x-0.5'
                            }`} />
                        </button>
                    </div>
                    {isSeedance20 && seedanceMode === 'reference' && (
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">联网搜索</span>
                            <button
                                type="button"
                                role="switch"
                                aria-checked={data.seedanceReferenceWebSearch ?? false}
                                onClick={() =>
                                    onUpdate({ seedanceReferenceWebSearch: !(data.seedanceReferenceWebSearch ?? false) })
                                }
                                className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/50 ${
                                    data.seedanceReferenceWebSearch ? 'bg-blue-500' : 'bg-gray-700'
                                }`}
                            >
                                <span
                                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition ${
                                        data.seedanceReferenceWebSearch ? 'translate-x-4' : 'translate-x-0.5'
                                    }`}
                                />
                            </button>
                        </div>
                    )}
                    {isSeedance15 && (
                    <div className="space-y-1">
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">固定镜头</span>
                            <button
                                type="button"
                                role="switch"
                                aria-checked={data.seedanceFixedCamera ?? false}
                                onClick={() => onUpdate({ seedanceFixedCamera: !(data.seedanceFixedCamera ?? false) })}
                                className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500/50 ${
                                    data.seedanceFixedCamera ? 'bg-brand-500' : 'bg-gray-700'
                                }`}
                            >
                                <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition ${
                                    data.seedanceFixedCamera ? 'translate-x-4' : 'translate-x-0.5'
                                }`} />
                            </button>
                        </div>
                        <p className="text-[10px] text-red-300 leading-relaxed px-2 py-2 bg-red-500/10 border border-red-500/30 rounded-lg">⚠ 开启后视频画面固定,未开启则根据Prompt产生运镜</p>
                    </div>
                    )}
                </>
            ) : isKelingOmni ? (
                /* === KLING 3.0 OMNI SETTINGS === */
                <>
                    {klingOmniTab !== 'frames' && (
                        <div className="space-y-1">
                            <div className="flex items-center gap-2 text-gray-400">
                                <Ratio size={12} />
                                <span className="text-[10px] font-bold uppercase tracking-wider">画面比例</span>
                            </div>
                            <div className="flex gap-2">
                                {(['16:9', '9:16', '1:1'] as const).map((r) => (
                                    <button
                                        key={r}
                                        type="button"
                                        onClick={() => onUpdate({ aspectRatio: r })}
                                        className={`flex-1 py-2 px-2 text-xs font-medium rounded-lg border transition-colors ${
                                            (data.aspectRatio || '16:9') === r
                                                ? 'bg-brand-500/20 text-brand-400 border-brand-500/30'
                                                : 'bg-gray-950 border-gray-700 text-gray-500 hover:border-gray-600'
                                        }`}
                                    >
                                        {r}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">音画同步</span>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={data.klingAudioSync ?? false}
                            onClick={() => onUpdate({ klingAudioSync: !(data.klingAudioSync ?? false) })}
                            className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500/50 ${
                                data.klingAudioSync ? 'bg-brand-500' : 'bg-gray-700'
                            }`}
                        >
                            <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition ${
                                data.klingAudioSync ? 'translate-x-4' : 'translate-x-0.5'
                            }`} />
                        </button>
                    </div>

                    <div className="flex gap-3">
                        <div className="space-y-1 flex-1">
                            <div className="flex items-center gap-2 text-gray-400">
                                <Zap size={12} />
                                <span className="text-[10px] font-bold uppercase tracking-wider">品质</span>
                            </div>
                            <div className="relative">
                                <select
                                  value={data.quality || '高质量'}
                                  onChange={(e) => onUpdate({ quality: e.target.value })}
                                  className="w-full bg-gray-950 border border-gray-700 hover:border-brand-500 text-gray-200 text-xs rounded px-2 py-2 pr-6 appearance-none focus:outline-none focus:ring-1 focus:ring-brand-500"
                                >
                                    <option value="高质量">高质量</option>
                                    <option value="标准">标准</option>
                                </select>
                                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500 pointer-events-none" />
                            </div>
                        </div>
                        <div className="space-y-1 flex-1">
                            <div className="flex items-center gap-2 text-gray-400">
                                <Clock size={12} />
                                <span className="text-[10px] font-bold uppercase tracking-wider">时长</span>
                            </div>
                            <div className="relative">
                                <select
                                  value={data.duration || '5s'}
                                  onChange={(e) => onUpdate({ duration: e.target.value })}
                                  className="w-full bg-gray-950 border border-gray-700 hover:border-brand-500 text-gray-200 text-xs rounded px-2 py-2 pr-6 appearance-none focus:outline-none focus:ring-1 focus:ring-brand-500"
                                >
                                    <option value="5s">5s</option>
                                    <option value="10s">10s</option>
                                </select>
                                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500 pointer-events-none" />
                            </div>
                        </div>
                        <div className="space-y-1 flex-1">
                            <div className="flex items-center gap-2 text-gray-400">
                                <Film size={12} />
                                <span className="text-[10px] font-bold uppercase tracking-wider">数量</span>
                            </div>
                            <div className="relative">
                                <select
                                  value={data.numberOfImages || '1条'}
                                  onChange={(e) => onUpdate({ numberOfImages: e.target.value })}
                                  className="w-full bg-gray-950 border border-gray-700 hover:border-brand-500 text-gray-200 text-xs rounded px-2 py-2 pr-6 appearance-none focus:outline-none focus:ring-1 focus:ring-brand-500"
                                >
                                    <option value="1条">1条</option>
                                    <option value="2条">2条</option>
                                    <option value="3条">3条</option>
                                    <option value="4条">4条</option>
                                </select>
                                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500 pointer-events-none" />
                            </div>
                        </div>
                    </div>
                </>
            ) : isKeling ? (
                /* === KELING VIDEO SETTINGS === */
                <>
                    {/* Aspect Ratio */}
                    <div className="space-y-1">
                        <div className="flex items-center gap-2 text-gray-400">
                            <Ratio size={12} />
                            <span className="text-[10px] font-bold uppercase tracking-wider">画面尺寸</span>
                        </div>
                        <div className="relative">
                            <select
                            value={data.aspectRatio || '16:9'}
                            onChange={(e) => onUpdate({ aspectRatio: e.target.value })}
                            className="w-full bg-gray-950 border border-gray-700 hover:border-brand-500 text-gray-200 text-xs rounded px-2 py-2 pr-6 appearance-none focus:outline-none focus:ring-1 focus:ring-brand-500"
                            >
                                {['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3', '4:5', '5:4', '21:9'].map(ratio => (
                                    <option key={ratio} value={ratio}>{ratio}</option>
                                ))}
                            </select>
                            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500 pointer-events-none" />
                        </div>
                    </div>

                    <div className="flex gap-3">
                        {/* Quality */}
                        <div className="space-y-1 flex-1">
                            <div className="flex items-center gap-2 text-gray-400">
                                <Zap size={12} />
                                <span className="text-[10px] font-bold uppercase tracking-wider">品质</span>
                            </div>
                            <div className="relative">
                                <select
                                value={data.quality || '高质量'}
                                onChange={(e) => onUpdate({ quality: e.target.value })}
                                className="w-full bg-gray-950 border border-gray-700 hover:border-brand-500 text-gray-200 text-xs rounded px-2 py-2 pr-6 appearance-none focus:outline-none focus:ring-1 focus:ring-brand-500"
                                >
                                    <option value="高质量">高质量</option>
                                    <option value="标准">标准</option>
                                </select>
                                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500 pointer-events-none" />
                            </div>
                        </div>

                        {/* Duration */}
                        <div className="space-y-1 flex-1">
                            <div className="flex items-center gap-2 text-gray-400">
                                <Clock size={12} />
                                <span className="text-[10px] font-bold uppercase tracking-wider">时长</span>
                            </div>
                            <div className="relative">
                                <select
                                value={data.duration || '5s'}
                                onChange={(e) => onUpdate({ duration: e.target.value })}
                                className="w-full bg-gray-950 border border-gray-700 hover:border-brand-500 text-gray-200 text-xs rounded px-2 py-2 pr-6 appearance-none focus:outline-none focus:ring-1 focus:ring-brand-500"
                                >
                                    <option value="5s">5s</option>
                                    <option value="10s">10s</option>
                                </select>
                                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500 pointer-events-none" />
                            </div>
                        </div>
                    </div>

                    {/* Video Count */}
                    <div className="space-y-1">
                        <div className="flex items-center gap-2 text-gray-400">
                            <Film size={12} />
                            <span className="text-[10px] font-bold uppercase tracking-wider">视频数量</span>
                        </div>
                        <div className="relative">
                            <select
                            value={data.numberOfImages || '1条'}
                            onChange={(e) => onUpdate({ numberOfImages: e.target.value })}
                            className="w-full bg-gray-950 border border-gray-700 hover:border-brand-500 text-gray-200 text-xs rounded px-2 py-2 pr-6 appearance-none focus:outline-none focus:ring-1 focus:ring-brand-500"
                            >
                                <option value="1条">1条</option>
                                <option value="2条">2条</option>
                                <option value="3条">3条</option>
                                <option value="4条">4条</option>
                            </select>
                            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500 pointer-events-none" />
                        </div>
                    </div>

                    {/* Creativity Slider */}
                    <div className="space-y-2 pt-1">
                        <div className="flex items-center justify-between text-gray-400">
                             <div className="flex items-center gap-2">
                                 <SlidersHorizontal size={12} />
                                 <span className="text-[10px] font-bold uppercase tracking-wider">创意相关</span>
                             </div>
                             <span className="text-[10px] font-mono text-brand-400">{data.creativityLevel ?? 50}</span>
                        </div>
                        <div className="relative px-1">
                            <input 
                               type="range"
                               min="0"
                               max="100"
                               value={data.creativityLevel ?? 50}
                               onChange={(e) => onUpdate({ creativityLevel: parseInt(e.target.value) })}
                               className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-brand-500 hover:accent-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/50"
                            />
                            <div className="flex justify-between mt-1.5">
                                <span className="text-[9px] text-gray-500 font-medium">创意想象力</span>
                                <span className="text-[9px] text-gray-500 font-medium">创意相关性</span>
                            </div>
                        </div>
                    </div>
                </>
            ) : isImage2 ? (
                <>
                    <div className="space-y-1">
                        <div className="flex items-center gap-2 text-gray-400">
                            <Ratio size={12} />
                            <span className="text-[10px] font-bold uppercase tracking-wider">画面比例</span>
                        </div>
                        <div className="relative">
                            <select
                                value={data.image2AspectRatio || '1:1'}
                                onChange={(e) => {
                                    const ar = e.target.value;
                                    onUpdate({
                                        image2AspectRatio: ar,
                                        image2ImageSize: image2CoerceSizeForAspect(ar, data.image2ImageSize),
                                    });
                                }}
                                className="w-full bg-gray-950 border border-gray-700 hover:border-brand-500 text-gray-200 text-xs rounded px-2 py-2 pr-6 appearance-none focus:outline-none focus:ring-1 focus:ring-brand-500"
                            >
                                {IMAGE2_ASPECT_OPTIONS.map((ratio) => (
                                    <option key={ratio} value={ratio}>
                                        {ratio}
                                    </option>
                                ))}
                            </select>
                            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500 pointer-events-none" />
                        </div>
                    </div>
                    <div className="space-y-1">
                        <div className="flex items-center gap-2 text-gray-400">
                            <Monitor size={12} />
                            <span className="text-[10px] font-bold uppercase tracking-wider">图像尺寸（清晰度）</span>
                        </div>
                        <div className="relative">
                            <select
                                value={image2CoerceSizeForAspect(
                                    data.image2AspectRatio || '1:1',
                                    data.image2ImageSize
                                )}
                                onChange={(e) => {
                                    const sz = e.target.value;
                                    const implied = image2AspectForSize(sz);
                                    onUpdate({
                                        image2ImageSize: sz,
                                        ...(implied ? { image2AspectRatio: implied } : {}),
                                    });
                                }}
                                className="w-full bg-gray-950 border border-gray-700 hover:border-brand-500 text-gray-200 text-xs rounded px-2 py-2 pr-6 appearance-none focus:outline-none focus:ring-1 focus:ring-brand-500"
                            >
                                {image2SizesForAspect(data.image2AspectRatio || '1:1').map((s) => (
                                    <option key={s} value={s}>
                                        {s}
                                    </option>
                                ))}
                            </select>
                            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500 pointer-events-none" />
                        </div>
                    </div>
                    <div className="space-y-1">
                        <div className="flex items-center gap-2 text-gray-400">
                            <Layers size={12} />
                            <span className="text-[10px] font-bold uppercase tracking-wider">图像数量</span>
                        </div>
                        <div className="relative">
                            <select
                                value={data.numberOfImages || '1张'}
                                onChange={(e) => onUpdate({ numberOfImages: e.target.value })}
                                className="w-full bg-gray-950 border border-gray-700 hover:border-brand-500 text-gray-200 text-xs rounded px-2 py-2 pr-6 appearance-none focus:outline-none focus:ring-1 focus:ring-brand-500"
                            >
                                <option value="1张">1张</option>
                                <option value="2张">2张</option>
                                <option value="3张">3张</option>
                                <option value="4张">4张</option>
                            </select>
                            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500 pointer-events-none" />
                        </div>
                    </div>
                </>
            ) : (
                /* === NANO / STANDARD IMAGE SETTINGS === */
                <>
                    {/* Aspect Ratio */}
                    <div className="space-y-1">
                        <div className="flex items-center gap-2 text-gray-400">
                            <Ratio size={12} />
                            <span className="text-[10px] font-bold uppercase tracking-wider">画面比例</span>
                        </div>
                        <div className="relative">
                            <select
                            value={data.aspectRatio || '1:1'}
                            onChange={(e) => onUpdate({ aspectRatio: e.target.value })}
                            className="w-full bg-gray-950 border border-gray-700 hover:border-brand-500 text-gray-200 text-xs rounded px-2 py-2 pr-6 appearance-none focus:outline-none focus:ring-1 focus:ring-brand-500"
                            >
                                {['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16', '4:5', '5:4', '21:9'].map(ratio => (
                                    <option key={ratio} value={ratio}>{ratio}</option>
                                ))}
                            </select>
                            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500 pointer-events-none" />
                        </div>
                    </div>

                    <div className="flex gap-3">
                        {/* Resolution */}
                        <div className="space-y-1 flex-1">
                            <div className="flex items-center gap-2 text-gray-400">
                                <Monitor size={12} />
                                <span className="text-[10px] font-bold uppercase tracking-wider">清晰度</span>
                            </div>
                            <div className="relative">
                                <select
                                value={data.resolution || '1K'}
                                onChange={(e) => onUpdate({ resolution: e.target.value })}
                                className="w-full bg-gray-950 border border-gray-700 hover:border-brand-500 text-gray-200 text-xs rounded px-2 py-2 pr-6 appearance-none focus:outline-none focus:ring-1 focus:ring-brand-500"
                                >
                                    <option value="1K">1K</option>
                                    <option value="2K">2K</option>
                                    <option value="4K">4K</option>
                                </select>
                                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500 pointer-events-none" />
                            </div>
                        </div>

                        {/* Number of Images */}
                        <div className="space-y-1 flex-1">
                            <div className="flex items-center gap-2 text-gray-400">
                                <Layers size={12} />
                                <span className="text-[10px] font-bold uppercase tracking-wider">图像数量</span>
                            </div>
                            <div className="relative">
                                <select
                                value={data.numberOfImages || '1张'}
                                onChange={(e) => onUpdate({ numberOfImages: e.target.value })}
                                className="w-full bg-gray-950 border border-gray-700 hover:border-brand-500 text-gray-200 text-xs rounded px-2 py-2 pr-6 appearance-none focus:outline-none focus:ring-1 focus:ring-brand-500"
                                >
                                    <option value="1张">1张</option>
                                    <option value="2张">2张</option>
                                    <option value="3张">3张</option>
                                    <option value="4张">4张</option>
                                </select>
                                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500 pointer-events-none" />
                            </div>
                        </div>
                    </div>
                </>
            )}
          </div>

      </div>

      {/* Footer (Fixed Run Button) */}
      <div className="p-3 border-t border-gray-800 bg-gray-900 flex-none z-10">
            <button
                type="button"
                onClick={handleRun}
                disabled={isCurrentNodeRunning}
                className={`
                    w-full py-2.5 rounded-lg flex items-center justify-center gap-2 font-semibold text-xs transition-all
                    bg-brand-600 hover:bg-brand-500 text-white shadow-lg shadow-brand-500/20 active:scale-95 disabled:opacity-70 disabled:cursor-not-allowed disabled:hover:bg-brand-600
                `}
            >
                {isCurrentNodeRunning ? (
                    <>
                        <Loader2 size={12} className="animate-spin" />
                        <span>Generating...</span>
                    </>
                ) : (
                    <>
                        <Play size={12} fill="currentColor" />
                        <span>运行</span>
                    </>
                )}
            </button>
      </div>

      {/* 主体库文件选择模态框 */}
      {showLibraryModal && supportsSubjectLibraryPicker && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-[90vw] h-[80vh] max-w-6xl flex flex-col overflow-hidden">
            {/* 模态框头部 */}
            <div className="flex items-center justify-between p-4 border-b border-gray-800 flex-shrink-0">
              <div className="flex items-center gap-2">
                <ImageIcon className="text-brand-500 w-5 h-5" />
                <h2 className="text-lg font-bold text-white">从主体库文件选择</h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowCreateSubjectForm((v) => !v)}
                  className="px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold"
                >
                  {showCreateSubjectForm ? '收起新建' : '创建主体'}
                </button>
              <button
                onClick={() => setShowLibraryModal(false)}
                className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
              >
                <X size={20} />
              </button>
              </div>
            </div>

            {/* 查询区 */}
            <div className="p-4 border-b border-gray-800 flex-shrink-0 bg-gray-900/50">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                  <input
                    value={libraryKeyword}
                    onChange={(e) => setLibraryKeyword(e.target.value)}
                    placeholder="搜索主体名称或分类"
                    className="w-full pl-8 pr-3 py-2 rounded-lg bg-gray-950 border border-gray-700 text-gray-200 text-sm"
                  />
                </div>
                <select
                  value={libraryCategoryFilter}
                  onChange={(e) => setLibraryCategoryFilter(e.target.value as '全部' | SubjectCategory)}
                  className="w-full px-3 py-2 rounded-lg bg-gray-950 border border-gray-700 text-gray-200 text-sm"
                >
                  <option value="全部">全部分类</option>
                  {SUBJECT_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <div className="text-xs text-gray-400 flex items-center md:justify-end">
                  已选 {selectedLibraryIds.length} / 可见 {filteredLibraryImages.length}
                </div>
              </div>
            </div>

            {/* 创建区 */}
            {showCreateSubjectForm && (
              <div className="p-4 border-b border-gray-800 bg-gray-900/40 flex-shrink-0">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="rounded-lg border border-gray-700 bg-gray-950/60 p-3">
                    <div className="text-xs text-gray-300 mb-2">
                      * 添加主要参考图（正面图）
                      <span className="text-gray-500 ml-1">· 点击或拖入图片</span>
                    </div>
                    <div
                      role="button"
                      tabIndex={0}
                      aria-label="上传正面参考图，支持点击或拖入"
                      onKeyDown={(ev) => {
                        if (ev.key === 'Enter' || ev.key === ' ') {
                          ev.preventDefault();
                          subjectMainFrontInputRef.current?.click();
                        }
                      }}
                      onClick={() => {
                        if (suppressSubjectMainClickRef.current) return;
                        subjectMainFrontInputRef.current?.click();
                      }}
                      onDragOver={(ev) => {
                        ev.preventDefault();
                        ev.stopPropagation();
                      }}
                      onDragEnter={(ev) => {
                        ev.preventDefault();
                        setSubjectMainDropOver(true);
                      }}
                      onDragLeave={(ev) => {
                        ev.preventDefault();
                        if (!(ev.currentTarget as HTMLElement).contains(ev.relatedTarget as Node)) {
                          setSubjectMainDropOver(false);
                        }
                      }}
                      onDrop={onMainSubjectDrop}
                      className={`h-32 rounded border border-dashed flex items-center justify-center text-gray-400 cursor-pointer transition-colors overflow-hidden ${
                        subjectMainDropOver
                          ? 'border-brand-500 bg-brand-500/15 ring-2 ring-brand-500/30'
                          : 'border-gray-700 hover:border-gray-600'
                      }`}
                    >
                      <input
                        ref={subjectMainFrontInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) applyMainSubjectFile(file);
                          e.target.value = '';
                        }}
                      />
                      {newSubjectDataUrl ? (
                        <img src={newSubjectDataUrl} alt="main-subject" className="w-full h-full object-cover rounded" />
                      ) : (
                        <div className="text-center text-xs px-2 pointer-events-none">
                          <div className="text-2xl mb-1">+</div>
                          <div>添加正面图（必填）</div>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="rounded-lg border border-gray-700 bg-gray-950/60 p-3">
                    <div className="text-xs text-gray-300 mb-2">
                      * 添加其他视角图（必填 1 张，最多 3 张；仅传其他视角，正面图单独上传）
                      <span className="text-gray-500 ml-1">· 点击或拖入，可多次添加</span>
                    </div>
                    <div
                      role="button"
                      tabIndex={0}
                      aria-label="上传其他视角图，支持点击或拖入"
                      onKeyDown={(ev) => {
                        if (ev.key === 'Enter' || ev.key === ' ') {
                          ev.preventDefault();
                          subjectOtherViewsInputRef.current?.click();
                        }
                      }}
                      onClick={() => {
                        if (suppressSubjectOtherClickRef.current) return;
                        subjectOtherViewsInputRef.current?.click();
                      }}
                      onDragOver={(ev) => {
                        ev.preventDefault();
                        ev.stopPropagation();
                      }}
                      onDragEnter={(ev) => {
                        ev.preventDefault();
                        setSubjectOtherViewsDropOver(true);
                      }}
                      onDragLeave={(ev) => {
                        ev.preventDefault();
                        if (!(ev.currentTarget as HTMLElement).contains(ev.relatedTarget as Node)) {
                          setSubjectOtherViewsDropOver(false);
                        }
                      }}
                      onDrop={onOtherViewsDrop}
                      className={`h-32 rounded border border-dashed flex items-center justify-center text-gray-400 cursor-pointer transition-colors overflow-hidden ${
                        subjectOtherViewsDropOver
                          ? 'border-brand-500 bg-brand-500/15 ring-2 ring-brand-500/30'
                          : 'border-gray-700 hover:border-gray-600'
                      }`}
                    >
                      <input
                        ref={subjectOtherViewsInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          const files = Array.from(e.target.files || []).slice(0, 3);
                          if (!files.length) return;
                          Promise.all(
                            files.map(
                              (f) =>
                                new Promise<string>((resolve) => {
                                  const r = new FileReader();
                                  r.onload = (ev) => resolve((ev.target?.result as string) || '');
                                  r.readAsDataURL(f);
                                })
                            )
                          ).then((urls) => {
                            setNewSubjectOtherViewUrls(urls.filter(Boolean).slice(0, 3));
                          });
                          e.target.value = '';
                        }}
                      />
                      {newSubjectOtherViewUrls.length ? (
                        <div className="w-full grid grid-cols-3 gap-2 p-2 pointer-events-none">
                          {newSubjectOtherViewUrls.map((u, i) => (
                            <img key={i} src={u} alt={`view-${i}`} className="w-full h-20 object-cover rounded" />
                          ))}
                        </div>
                      ) : (
                        <div className="text-center text-xs px-2 pointer-events-none">
                          <div className="text-2xl mb-1">+</div>
                          <div>添加其他视角图</div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">* 主体姓名</label>
                    <input
                      value={newSubjectName}
                      onChange={(e) => setNewSubjectName(e.target.value)}
                      placeholder="请输入简短名称（20字内）"
                      className="w-full px-3 py-2 rounded-lg bg-gray-950 border border-gray-700 text-gray-200 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">* 标签</label>
                    <select
                      value={newSubjectTag}
                      onChange={(e) =>
                        setNewSubjectTag((e.target.value || '') as SubjectCategory | '')
                      }
                      className="w-full px-3 py-2 rounded-lg bg-gray-950 border border-gray-700 text-gray-200 text-sm"
                    >
                      <option value="">请选择标签</option>
                      {SUBJECT_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    <p className="text-[10px] text-gray-500 mt-1">同步至接口 tag：PERSON / ANIMAL / PROP / CLOTHES / SCENE / EFFECT / OTHER</p>
                  </div>
                </div>

                <div className="mt-3">
                  <label className="text-xs text-gray-400 mb-1 block">* 描述</label>
                  <textarea
                    value={newSubjectDescription}
                    onChange={(e) => setNewSubjectDescription(e.target.value)}
                    placeholder="请描述主体核心特征，以及希望保留/忽略的细节（100字内）"
                    className="w-full px-3 py-2 rounded-lg bg-gray-950 border border-gray-700 text-gray-200 text-sm min-h-[84px]"
                  />
                </div>

                <div className="mt-3 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    disabled={isCreatingSubject}
                    onClick={() => setShowCreateSubjectForm(false)}
                    className="px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 text-sm disabled:opacity-50"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={isCreatingSubject}
                    onClick={() => void handleCreateSubject()}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm disabled:opacity-50"
                  >
                    {isCreatingSubject ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        创建中…
                      </>
                    ) : (
                      '创建'
                    )}
                  </button>
                </div>
                {newSubjectDataUrl && (
                  <div className="mt-3 w-24 h-24 rounded border border-gray-700 overflow-hidden">
                    <img src={newSubjectDataUrl} alt="new-subject" className="w-full h-full object-cover" />
                  </div>
                )}
              </div>
            )}

            {/* 模态框内容 */}
            <div className="flex-1 overflow-y-auto p-4">
              {isLoadingLibrary ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="animate-spin text-brand-500 w-8 h-8" />
                  <span className="ml-3 text-gray-400">加载中...</span>
                </div>
              ) : filteredLibraryImages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-500">
                  <ImageIcon className="w-16 h-16 mb-4 opacity-50" />
                  <p className="text-sm">暂无主体库文件</p>
                  <p className="text-xs mt-2 text-gray-600 text-center max-w-md">
                    可点击「创建主体」新建；若列表异常请检查网络与 api-key（与 aitop 其它接口相同）
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {filteredLibraryImages.map((image) => (
                    <div key={image.id} className="flex flex-col gap-1 min-w-0">
                      <div
                        onClick={() => toggleLibrarySelect(image.id)}
                        className={`group relative aspect-square rounded-xl overflow-hidden border-2 cursor-pointer transition-all bg-gray-950 ${
                          selectedLibraryIds.includes(image.id) ? 'border-brand-500 ring-2 ring-brand-500/40' : 'border-gray-800 hover:border-brand-500'
                        }`}
                    >
                      <img
                        src={image.thumbnail || image.url}
                          alt={image.name || '主体库文件'}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent pt-8 pb-2 px-2 flex items-end justify-between gap-1">
                          <div className="min-w-0 flex-1">
                            <p className="text-xs text-white truncate">{image.name || '未命名'}</p>
                            <p className="text-[10px] text-gray-300">{image.category || '其他'}</p>
                        </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setLibraryDetailOpenId((id) => (id === image.id ? null : image.id));
                            }}
                            className="shrink-0 p-1.5 rounded-md bg-white/20 hover:bg-white/35 text-white backdrop-blur-sm border border-white/20"
                            title="查看主体描述与参考图"
                          >
                            <FileText className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="absolute top-1 right-1 flex flex-col gap-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleDeleteLibraryImage(image.id);
                            }}
                            className="p-1 rounded bg-black/60 hover:bg-red-600 text-white"
                            title="删除主体"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      {libraryDetailOpenId === image.id && (
                        <div className="rounded-lg border border-gray-600 bg-gray-900/95 p-3 text-left shadow-xl space-y-2">
                          <div className="flex gap-1.5 overflow-x-auto pb-1">
                            {librarySubjectThumbUrls(image).map((u) => (
                              <img
                                key={u}
                                src={u}
                                alt=""
                                className="h-14 w-14 shrink-0 rounded object-cover border border-gray-700"
                              />
                            ))}
                          </div>
                          {image.updatedAt && (
                            <p className="text-[11px] text-gray-500">
                              更新于 {formatLibraryUpdatedAt(image.updatedAt)}
                            </p>
                          )}
                          <div className="rounded-md bg-gray-950/80 border border-gray-700/80 p-2 space-y-1.5">
                            <div>
                              <span className="text-[10px] text-gray-500">主体名称</span>
                              <p className="text-xs text-gray-200 break-words">{image.name || '—'}</p>
                        </div>
                            <div>
                              <span className="text-[10px] text-gray-500">主体描述</span>
                              <p className="text-xs text-gray-300 whitespace-pre-wrap break-words leading-relaxed max-h-40 overflow-y-auto">
                                {image.description?.trim() ? image.description : '暂无描述'}
                              </p>
                      </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 模态框底部 */}
            <div className="p-4 border-t border-gray-800 flex-shrink-0 flex items-center justify-between">
              <div className="text-xs text-gray-500">
                共 {libraryImages.length} 个主体（当前筛选 {filteredLibraryImages.length}）
              </div>
              <div className="flex items-center gap-2">
              <button
                onClick={() => setShowLibraryModal(false)}
                className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors text-sm"
              >
                取消
              </button>
                <button
                  onClick={handleConfirmLibrarySelection}
                  className="px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-white transition-colors text-sm font-semibold"
                >
                  确认使用（{selectedLibraryIds.length}）
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

export { NodeInspector };
export default NodeInspector;