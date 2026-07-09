import React, { Suspense, useState, useRef, useCallback, useEffect, useMemo } from 'react';
import ReactFlow, {
  ReactFlowProvider,
  addEdge,
  useNodesState,
  useEdgesState,
  Controls,
  Background,
  Connection,
  Edge,
  Node as RFNode,
  BackgroundVariant,
  Panel,
  useReactFlow,
  OnConnectStart,
  OnConnectEnd,
  OnConnectStartParams,
  XYPosition,
  ConnectionLineComponentProps,
  OnSelectionChangeParams,
  NodeMouseHandler,
  NodeDragHandler,
  SelectionMode,
} from 'reactflow';
// CSS is loaded via index.html

import {
  GenerationParams,
  MODEL_IMAGE_2,
  MODEL_NANO_BANANA_2,
  NodeData,
  NodeType,
  isImage2Model,
  isNanoBanana2Model,
} from '../types';
import {
  BATCH_RUN_NODE_INTERVAL_MS,
  applyScheduledRunQueueHighlight,
  collectSelectedRunQueue,
  collectStoryboardGreenRunQueue,
  removeScheduledRunQueueHighlightId,
  resolveBatchRunQueueByIds,
  snapshotBatchRunNodeIds,
} from '../utils/batchRunQueue';
import { parseSeedanceDurationSeconds, SEEDANCE_DURATION_DEFAULT_LABEL } from '../utils/seedanceDuration';
import {
  applyRunPanelFieldsToGenerationParams,
  buildNanoBananaDetailsReferenceImages,
  pickReferenceMovPoster,
  sanitizeDetailsReferenceImageUrls,
  mergeOmniMultiTabReferenceImagesForDetails,
  mergeSeedanceImageModeDetailsReferenceImages,
  buildNodeDetailsReferencePreview,
  buildSeedanceReferenceDetailsFromSnapshot,
  buildImageGenOutputReferenceDetailsFromSnapshot,
  buildOmniInstructionVideoTabDetailsReferencePreview,
  buildOmniMultiTabDetailsReferencePreview,
  buildOmniPanelSourceForNodeDetails,
  buildNodeDetailsVideoLabelSource,
  buildReferenceVideoDetailItems,
  collectOmniMultiTabReferenceMovsForDetails,
  enrichPanelSourceFromGenerationSnapshot,
  inferSeedanceReferenceDetailLabelsFromPrompt,
  resolveNodeDetailsHeroImageUrl,
  shouldIncludeImagePreviewInNodeDetailsUrlPool,
  seedanceReferenceMovsForOutputDetails,
} from '../utils/nodeDetailsPreview';
import { resolveNodeDetailsSourceUrl } from '../utils/generatedOutputUrl';
import {
  parseStoryboardSpawnRows,
  STORYBOARD_TEMPLATE_ERR,
  isProjectAssetLibraryImageUrl,
  checkStoryboardTemplateAssetBinding,
  validateStoryboardExcelTableSpawn,
  validateTemplateUsesProjectAssetLibrary,
} from '../utils/storyboardTableSpawn';
import {
  buildStillImageOutputSpawnPatch,
  resolveSpawnOutputDefaultModel,
} from '../utils/spawnOutputNode';
import { parseStoryboardExcelFile } from '../utils/parseStoryboardExcel';
import {
  parseProjectAssetIdsFromMediaUrl,
  resolveCanonicalProjectAssetPreviewUrl,
} from '../utils/projectAssetPreview';
import {
  formatMediaUrlForNodeDetails,
  formatNodeSourceUrlForDisplay,
} from '../utils/canvasLocalPreview';
import {
  normalizeGraphNodesProjectAssetBinding,
  normalizeTemplateNodeDataForSpawn,
} from '../utils/normalizeTemplateNodeForSpawn';
import {
  getSeedanceDefaultResolution,
  normalizeSeedanceAspectForTextRef,
} from '../utils/seedanceAspectRatio';
import { prepareImageForSeedanceModelUpload } from '../utils/seedanceImageUpload';
import {
  ensureAitopCosAudioUrl,
  ensureAitopCosVideoUrl,
  isAitopCosUrl,
} from '../utils/aitopCosMediaUrl';
import { flowEditorEdgeTypes, flowEditorNodeTypes, flowEditorProOptions } from './flowEditorReactFlowTypes';
import { DragDropContext } from './DragDropContext';
import { ErrorBoundary } from './ErrorBoundary';
import { Sidebar } from './Sidebar';
import { ChatPanel } from './ChatPanel';
import { Play, Download, Trash2, UploadCloud, Search, X, Clapperboard, Hand, MousePointer, LayoutGrid, Film, ChevronRight, StopCircle, Workflow, FileText, Info, Layers, Ratio, Monitor, Copy, Link as LinkIcon, ArrowRightLeft, Save, Frame, ImagePlus, GitBranch, Clock, Calendar, ChevronDown } from 'lucide-react';
import {
  uploadImage,
  uploadVideo,
  uploadAudio,
  createNanoTask,
  createImage2Task,
  getTaskStatus,
  createKlingVideoTask,
  createKlingOmniVideoTask,
  createJimengVideoTask,
  createViduVideoTask,
  createDoubaoSeedanceVideoTask,
  setAitopBillingContext,
} from '../services/aitop';
import {
  IMAGE2_MAX_API_IMAGES,
  image2CoerceSizeForAspect,
  image2NormalizeAspectRatio,
  image2NormalizeQualityLevel,
  image2ResolveQuality,
} from '../utils/image2Model';
import { resolvePanelGenerateCount } from '../utils/panelGenerateCount';
import {
  pollImageTaskUntilUrl,
  pollVideoTaskUntilUrl,
  runParallelGenerationTasks,
} from '../utils/multiGenerateTasks';
import { probeRemotePngDimensions } from '../utils/probeRemoteImageDimensions';
import { getImageAspectRatioFromSource } from '../utils/imageRatio';
import { remoteMediaUrlPreferSameOriginProxy, resolveDownloadFetchUrl } from '../utils/remoteMediaFetch';
import {
  compressImageForPreview,
  prepareCanvasNodeImagePreview,
  shouldSkipCompress,
} from '../utils/imageCompress';
import { resolveUrlForVideoCapture } from '../utils/videoThumbnail';
import { captureVideoMiddleFrameQueued } from '../utils/videoPosterQueue';
import { profileSync } from '../utils/runtimeProfile';
import { hasReasonableNodePosition, sanitizeLoadedNodePosition } from '../utils/sanitizeNodePosition';
import { NodeDetailsRefMovThumb } from './KlingOmniVideoThumb';
import {
  FLOW_MAX_PERSISTED_NODES,
  FLOW_MAX_PERSISTED_EDGES,
  FLOW_MAX_THUMBNAILS_PER_NODE,
  FLOW_MAX_UNDO_HISTORY,
} from '../utils/flowLimits';
import {
  sanitizePersistValueDeep,
  sanitizeStoryboardImagesForPersist,
  sanitizeChatForPersist,
} from '../utils/persistSanitize';
import { resolveOmniInstructionRunVideoUrl, resolveOmniVideoTabRunVideoUrl } from '../utils/omniVideoFields';
import {
  FLOWGEN_MEDIA_URL_DROP,
  type FlowgenAssetDragItem,
  type FlowgenMediaUrlDropDetail,
  isAssetLibraryMediaDragSource,
  isCanvasNodeMediaDragSource,
} from '../utils/middleButtonMediaDrag';
import {
  resolveInspectorNodeIdOnSelectionChange,
  shouldIgnoreNodeClickForInspector,
} from '../utils/inspectorAnchorSelection';
import { setFlowgenInspectorAnchorId } from '../utils/inspectorAnchorSession';
import { installCanvasMiddleDragBridge } from '../utils/canvasMiddleDragBridge';
import { buildClearCanvasSelectionPatch } from '../utils/canvasSelectionPreserve';
import {
  buildPromptMediaRefContextFromNode,
  buildPromptMediaRefContextForRun,
  resolvePromptPlaceholders,
  collectProjectAssetUrlsFromPrompt,
  collectReferencedMediaFromPrompt,
  collectSeedanceReferencedMediaFromPrompt,
  getNodeInspectorPromptText,
  getCanonicalInspectorPromptText,
  buildNodePromptUpdatePatch,
  buildCanonicalInspectorPromptPatch,
  buildReferenceIndexOptionsFromPlan,
  filterProjectAssetsForReferencedPlan,
  buildProjectAssetPromptRefItems,
  buildProjectAssetSlugRows,
  buildProjectAssetSlugUrlMap,
  buildScannedNodePromptPatch,
  isDuplicateOfMainImagePreview,
  isLikelyMainVideoUrl,
  type PromptMediaRefItem,
  type ResolvePromptPlaceholdersOptions,
} from '../utils/promptMediaRefs';
import {
  buildSeedanceImageModePanelPersistPatchFromPlan,
  enrichSpawnedStoryboardNodeData,
} from '../utils/enrichSpawnedStoryboardNode';
import {
  outputNodePanelReferenceImagesFromRun,
  sanitizeOutputLikeNodeDataOnLoad,
  panelReferenceSlotsFromGenerationParamsSnapshot,
} from '../utils/panelRefPersistence';
import { shouldAppendRunMediaDiagnostics, formatAitopPlatformSupportHint } from '../utils/runErrorDisplay';
import { getAitopBillingContext, buildDownloadTaskFileUrl } from '../utils/aitopBilling';
import {
  assignSeedanceUploadedRefsToPanelSlotsByUrlMatch,
  assignStartEndUrlsFromImagePlan,
  buildFirstLastFramePanelPatchFromPlan,
  buildPanelReferenceImagesAfterUpload,
  MAIN_IMAGE_REF_TOKENS,
  OMNI_MULTI_FIRST_FRAME_TOKENS,
  buildPanelImagePreviewPatchAfterRun,
  buildRunNodeImagePreviewPatch,
  enrichPlanImagesWithPanelSlotIndexes,
  mergeAndPrunePanelReferenceImagesAfterUpload,
  panelMergeOptionsForReferencedUpload,
  promptPlanReferencesMainImage,
  planImagesReferenceMainImageAsset,
  promptPlanReferencesPanelImages,
  mergePanelReferenceImagesPreservingSlots,
  mergeSeedancePanelReferenceImagesAfterUpload,
  mergeSeedancePanelReferenceMovsAfterUpload,
  populateUploadedRefBySlotFromMediaPlan,
  splitSeedanceUploadedReferenceImages,
  uploadReferencedImageEntry,
  resolveReferencedImageUploadSource,
  panelReferenceImagesForUpload,
  assertDistinctUploadedRefsForPlan,
  buildReferenceOnlyImagesForApiPayload,
  buildSeedanceReferenceImagesApiPayload,
  buildSeedanceReferenceApiLabelsFromPlan,
  buildOmniMultiGenerationParamsLabels,
  buildOmniMultiApiImageList,
  shouldPreferRunReferencePreviewOverLocalMain,
  type UploadReferencedImageContext,
} from '../utils/referencedMediaRun';
import {
  resolveReferenceImageLabelsAfterPanelRun,
  type ProjectAssetLabelRow,
} from '../utils/referenceImageSlotLabels';
import {
  getWorkspace,
  putWorkspace,
  listAssets,
  getStoredUser,
  canManageProjectAssets,
  listProjects,
  getAssetFileBlob,
  resolveDisplayMediaUrl,
  isFlowgenProtectedAssetFileUrl,
  isFlowgenAssetThumbUrl,
  flowgenAssetFileUrlFromMediaUrl,
  stripAssetAccessTokenFromUrl,
} from '../services/flowgenApi';
import {
  buildLocalMediaRef,
  buildLocalMediaScope,
  buildFrameLocalRefForModel,
  buildKlingOmniFrameLocalRefForTab,
  buildKlingOmniReferenceLocalRefForTab,
  buildMainLocalRefForModel,
  buildModelScopedFrameLocalRef,
  buildReferenceLocalRefForModel,
  deleteLocalMediaRef,
  getLocalMediaBlob,
  getLocalMediaFile,
  isLegacyFrameLocalRef,
  isLegacyKlingOmniSharedFrameLocalRef,
  isLegacyKlingOmniSharedMainLocalRef,
  isLegacyKlingOmniSharedReferenceLocalRef,
  isKlingOmniTabScopedMainLocalRef,
  isLegacyMainLocalRef,
  isLegacyReferenceLocalRef,
  putLocalMediaFile,
  usesUnifiedSeedance20PanelLocalRef,
  revokeBlobPreviewUrl,
  type KlingOmniPanelTab,
} from '../utils/localNodeMediaStore';
import {
  isKlingOmniModel,
  klingOmniTabFromReferenceLocalRefField,
  snapshotKlingOmniTabConfigsWithLivePanel,
} from '../utils/klingOmniTabPanelIsolation';
import {
  hydrateAllPanelReferenceLocalRefs,
  enrichPanelPreviewPatchWithFreshMainBackup,
  type PanelReferenceLocalRefField,
  setReferenceImageLocalRefAtIndex,
} from '../utils/hydratePanelReferenceLocalRefs';
import {
  isEphemeralMediaUrl,
  isPersistableMediaUrl,
  materializePosterDataUrl,
} from '../utils/workspaceMediaPersist';
import {
  getModelConfigOutputPreviewUrl,
  hydrateGraphMediaFromPersisted,
  hydrateNodeImagePreviewFromPersisted,
  hydrateNodesImagePreviewFromPersisted,
  isVideoPreviewUrl,
  outputImagePreviewLooksLikePanelRefMismatch,
  pickReferenceImagePosterUrl,
} from '../utils/hydratePersistedNodePreviews';
import { parseProjectSkill, type ProjectSkillConfig } from '../utils/projectSkill';
import {
  chatCanvasSessionStorageKey,
  legacyProjectViewportStorageKey,
  legacyProjectWorkspaceDataStorageKey,
  projectViewportStorageKey,
  projectWorkspaceBackupStorageKey,
  projectWorkspaceDataStorageKey,
  resolveChatStorageScope,
} from '../utils/chatStorageScope';
import { setCanvasRefreshPaused, setCanvasViewportMoving } from '../utils/canvasRefreshPause';
import type { PersistedCanvasChatV1 } from './ChatPanel';
import { ProjectAssetLibrary } from './flowgen/ProjectAssetLibrary';
import { FlowgenMiniMap } from './flowgen/FlowgenMiniMap';
import { dedupeReferenceImageUrlsForSlotFallback } from '../utils/referenceImageUrlDedupe';
import { pickVideoResourceUrlFromTaskStatus } from '../utils/taskStatusVideoUrl';
import { resolvePreferredNodeDownloadUrl } from '../utils/generatedOutputUrl';
import { pickImageResourceUrlFromTaskStatus } from '../utils/taskStatusImageUrl';
import { normalizeNodeRunStateForPersist, prepareNodesAfterWorkspaceLoad, clearRunRecoveryHints, mergeRunPersistPatchesIntoNodes, mergeRunRecoveryFieldsFromLocalSnapshot, reconcileSourceRunStateAfterOutputNodesRemoved, clearStaleRunTaskBeforeFreshRun } from '../utils/runRecovery';
import { resolveNodeDownloadFilename } from '../utils/nodeDownloadFilename';
import {
  fixMisnamedOutputNodesOnGraph,
  resolveOutputNodeNamingFromUpstream,
} from '../utils/outputNodeNaming';
import { useAiTopRunRecovery } from '../hooks/useAiTopRunRecovery';

const NodeInspector = React.lazy(() => import('./NodeInspector'));

const INSPECTOR_WIDTH_LS_KEY = 'flowgen:inspector-width-px';
/** 与原先 Tailwind w-80 一致 */
const INSPECTOR_W_DEFAULT = 320;
const INSPECTOR_W_MIN = 280;
const INSPECTOR_W_MAX = 1200;

function clampInspectorWidth(px: number): number {
  if (typeof window === 'undefined') {
    return Math.min(INSPECTOR_W_MAX, Math.max(INSPECTOR_W_MIN, px));
  }
  const w = window.innerWidth;
  const maxByViewport = Math.max(INSPECTOR_W_MIN + 40, Math.min(Math.floor(w * 0.82), w - 180));
  const cap = Math.min(INSPECTOR_W_MAX, maxByViewport);
  return Math.min(cap, Math.max(INSPECTOR_W_MIN, Math.round(px)));
}

function readStoredInspectorWidth(): number {
  if (typeof window === 'undefined') return INSPECTOR_W_DEFAULT;
  const raw = localStorage.getItem(INSPECTOR_WIDTH_LS_KEY);
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return INSPECTOR_W_DEFAULT;
  return clampInspectorWidth(n);
}

/** 旧版独立 CHAIN_FOLDER 节点 → 合并到对应根节点 data（刷新/加载后仍可用） */
function mergeLegacyChainFolderNodesIntoRoots(nodes: RFNode[]): RFNode[] {
  const folders = nodes.filter((n) => n.type === NodeType.CHAIN_FOLDER);
  if (folders.length === 0) return nodes;
  const byRoot = new Map<string, string[]>();
  for (const f of folders) {
    const d = f.data as NodeData | undefined;
    const rid = d?.chainFolderRootId;
    const ids = d?.chainFolderChildIds || [];
    if (rid && ids.length) byRoot.set(rid, ids);
  }
  return nodes
    .filter((n) => n.type !== NodeType.CHAIN_FOLDER)
    .map((n) => {
      const ids = byRoot.get(n.id);
      if (!ids?.length) return n;
      if (n.type !== NodeType.INPUT && n.type !== NodeType.PROCESSOR) return n;
      return {
        ...n,
        data: { ...n.data, chainFolderChildIds: ids, chainFolderExpanded: false },
      };
    });
}

/** 移除链路折叠状态：删独立夹节点、清根上 chainFolder*、子节点恢复可见 */
function stripChainFolderNodesAndUnhide(nodes: RFNode[]): RFNode[] {
  return nodes
    .filter((n) => n.type !== NodeType.CHAIN_FOLDER)
    .map((n) => {
      const u = { ...n, hidden: false };
      const d = n.data as NodeData;
      if (d.chainFolderChildIds?.length) {
        return {
          ...u,
          data: {
            ...d,
            chainFolderChildIds: undefined,
            chainFolderExpanded: undefined,
            chainFolderLabel: undefined,
          },
        };
      }
      return u;
    });
}

function clearEdgesHiddenFlag(edges: Edge[]): Edge[] {
  return edges.map((e) => ({ ...e, hidden: undefined }));
}

/** 一次灌入/批量展开节点过多时，用 hidden + 分批 reveal，降低 React Flow 同时 mount 导致崩溃的概率（含刷新读盘、导入、粘贴、排序第二次「全部展开」） */
const FLOW_LAZY_HYDRATION_NODE_THRESHOLD = 22;
const FLOW_LAZY_HYDRATION_REVEAL_BATCH = 12;

function mapEdgesHiddenByEndpointNodes(nodes: RFNode[], edges: Edge[]): Edge[] {
  const nodeHidden = new Map(nodes.map((n) => [n.id, n.hidden === true]));
  return edges.map((e) => {
    const hide = Boolean(nodeHidden.get(e.source) || nodeHidden.get(e.target));
    if (hide) return { ...e, hidden: true };
    return { ...e, hidden: e.hidden };
  });
}

type FlowRfSetNodes = React.Dispatch<React.SetStateAction<RFNode[]>>;
type FlowRfSetEdges = React.Dispatch<React.SetStateAction<Edge[]>>;

/**
 * 将完整图写入 store：节点数较少则一次写入；否则先展示前若干节点，再在 rAF 中逐批解除 hidden。
 * `revealIdOrder` 仅描述需要分批露出的节点（如「本次导入」、排序工具第二次「全部展开」时由隐变显的节点）；不在集合内的节点保持原样（含 persisted hidden）。
 */
function hydrateGraphWithLazyReveal(
  fullNodes: RFNode[],
  fullEdges: Edge[],
  revealIdOrder: string[],
  setNodes: FlowRfSetNodes,
  setEdges: FlowRfSetEdges,
  options?: { onComplete?: () => void }
): void {
  const onComplete = options?.onComplete;
  if (revealIdOrder.length === 0 || revealIdOrder.length < FLOW_LAZY_HYDRATION_NODE_THRESHOLD) {
    setNodes(fullNodes);
    setEdges(fullEdges);
    onComplete?.();
    return;
  }

  const revealSet = new Set(revealIdOrder);
  const persistedHidden = new Map(fullNodes.map((n) => [n.id, n.hidden === true]));

  const apply = (revealedCount: number) => {
    const revealedIds = new Set(revealIdOrder.slice(0, revealedCount));
    const nextNodes = fullNodes.map((n) => {
      if (!revealSet.has(n.id)) return n;
      const pending = !revealedIds.has(n.id);
      return { ...n, hidden: pending || Boolean(persistedHidden.get(n.id)) };
    });
    const nextEdges = mapEdgesHiddenByEndpointNodes(nextNodes, fullEdges);
    setNodes(nextNodes);
    setEdges(nextEdges);
  };

  const firstBatch = Math.min(FLOW_LAZY_HYDRATION_REVEAL_BATCH, revealIdOrder.length);
  apply(firstBatch);

  if (firstBatch >= revealIdOrder.length) {
    onComplete?.();
    return;
  }

  let revealed = firstBatch;
  const tick = () => {
    revealed = Math.min(revealed + FLOW_LAZY_HYDRATION_REVEAL_BATCH, revealIdOrder.length);
    apply(revealed);
    if (revealed >= revealIdOrder.length) {
      onComplete?.();
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/**
 * 从输入/处理根节点沿出边收集下游 id；不跨入其他 INPUT/PROCESSOR；已占用 id 跳过（多根共享下游时先到先得）。
 */
function collectDownstreamForInputChain(
  rootId: string,
  nodes: RFNode[],
  edges: Edge[],
  globalClaimed: Set<string>
): string[] {
  const isEntryRoot = (n: RFNode) => n.type === NodeType.INPUT || n.type === NodeType.PROCESSOR;
  const out: string[] = [];
  const seen = new Set<string>();
  const queue: string[] = [];
  for (const e of edges) {
    if (e.source === rootId) queue.push(e.target);
  }
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    if (globalClaimed.has(id)) continue;
    const n = nodes.find((x) => x.id === id);
    if (!n) continue;
    if (id !== rootId && isEntryRoot(n)) continue;
    globalClaimed.add(id);
    out.push(id);
    for (const e of edges) {
      if (e.source === id) queue.push(e.target);
    }
  }
  return out;
}

/**
 * 从 MOV/OUTPUT 根节点沿入边收集上游 id；不跨入其他 MOV/OUTPUT；已占用 id 跳过（多根共享上游时先到先得）。
 */
function collectUpstreamForOutputChain(
  rootId: string,
  nodes: RFNode[],
  edges: Edge[],
  globalClaimed: Set<string>
): string[] {
  void globalClaimed;
  // 按“链接顺序”展开上游：从根往上递归，先直接父节点，再沿该父节点继续回溯；保持 edges 原始顺序。
  const nodeIdSet = new Set(nodes.map((n) => n.id));
  const incomingByTarget = new Map<string, string[]>();
  for (const e of edges) {
    if (!nodeIdSet.has(e.source) || !nodeIdSet.has(e.target)) continue;
    const arr = incomingByTarget.get(e.target) || [];
    arr.push(e.source);
    incomingByTarget.set(e.target, arr);
  }

  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (targetId: string) => {
    const parents = incomingByTarget.get(targetId) || [];
    for (const sid of parents) {
      if (sid === rootId || seen.has(sid)) continue;
      seen.add(sid);
      out.push(sid);
      visit(sid);
    }
  };
  visit(rootId);
  return out;
}

/** 内嵌「下游」条的大致高度（与 CustomNode 内条一致） */
const CHAIN_FOLDER_VIS_H = 52;

/** INPUT/PROCESSOR 卡片纵向占位：主卡片 + 产出缩略图 + 内嵌打组条 */
function estimateInputProcessorGridHeight(node: RFNode): number {
  const data = node.data as NodeData | undefined;
  const base = 280;
  let h = base;
  const n = data?.generatedThumbnails?.length ?? 0;
  if (n > 0) h += 24 + 160;
  if ((data?.chainFolderChildIds?.length ?? 0) > 0) {
    h += CHAIN_FOLDER_VIS_H + 10;
  }
  return h;
}

/** 背景框仅作画布分组，不打开右侧属性面板 */
function shouldOpenInspectorForNode(node: Pick<RFNode, 'type'> | null | undefined): boolean {
  return Boolean(node && node.type !== NodeType.BACKDROP);
}

/** 创建 Backdrop 时用的外接矩形：优先 measured，INPUT/PROCESSOR 用估算高度包住缩略图条 */
function getNodeBoundingRectForBackdrop(n: RFNode): { left: number; top: number; right: number; bottom: number } {
  const ext = n as RFNode & { measured?: { width: number; height: number } };
  const mw = ext.measured?.width && ext.measured.width > 48 ? ext.measured.width : undefined;
  const mh = ext.measured?.height && ext.measured.height > 48 ? ext.measured.height : undefined;
  let w = typeof n.width === 'number' && n.width > 48 ? n.width : mw;
  let h = typeof n.height === 'number' && n.height > 48 ? n.height : mh;

  if (n.type === NodeType.INPUT || n.type === NodeType.PROCESSOR) {
    const estW = 220;
    const estH = estimateInputProcessorGridHeight(n);
    w = Math.max(w ?? estW, estW);
    h = Math.max(h ?? estH, estH);
  } else {
    const fallback = chainExpandLayoutRect(n);
    const fw = fallback.right - fallback.left;
    const fh = fallback.bottom - fallback.top;
    w = w ?? fw;
    h = h ?? fh;
  }

  return {
    left: n.position.x,
    top: n.position.y,
    right: n.position.x + w,
    bottom: n.position.y + h,
  };
}

function parseCssPxForBackdrop(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  if (typeof v === 'string') {
    const m = v.trim().match(/^([\d.]+)px$/i);
    if (m) {
      const n = parseFloat(m[1]);
      if (!Number.isNaN(n) && n > 0) return n;
    }
  }
  return undefined;
}

/** 背景框在流坐标下的外接矩形（与创建时 width/height、resize 后 store 一致） */
function getBackdropFlowRect(b: RFNode): { left: number; top: number; right: number; bottom: number } {
  const st = b.style as React.CSSProperties | undefined;
  let w = typeof b.width === 'number' && b.width >= 48 ? b.width : undefined;
  let h = typeof b.height === 'number' && b.height >= 48 ? b.height : undefined;
  w = w ?? parseCssPxForBackdrop(st?.width);
  h = h ?? parseCssPxForBackdrop(st?.height);
  w = w ?? 280;
  h = h ?? 200;
  return {
    left: b.position.x,
    top: b.position.y,
    right: b.position.x + w,
    bottom: b.position.y + h,
  };
}

function backdropFlowZIndex(b: RFNode): number {
  const st = b.style as React.CSSProperties | undefined;
  const z = st?.zIndex;
  if (typeof z === 'number' && Number.isFinite(z)) return z;
  if (typeof z === 'string') {
    const n = parseInt(z, 10);
    if (!Number.isNaN(n)) return n;
  }
  return 0;
}

function rectCenterForBackdropMembership(r: { left: number; top: number; right: number; bottom: number }): XYPosition {
  return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
}

function pointInsideBackdropFrame(
  p: XYPosition,
  frame: { left: number; top: number; right: number; bottom: number }
): boolean {
  if (
    ![p.x, p.y, frame.left, frame.right, frame.top, frame.bottom].every(
      (v) => typeof v === 'number' && Number.isFinite(v)
    )
  ) {
    return false;
  }
  return p.x >= frame.left && p.x <= frame.right && p.y >= frame.top && p.y <= frame.bottom;
}

/** 存在参考输入视频时，首帧语义应对齐参考视频，勿把参考图写入 firstFrame / 首尾帧槽 */
function hasReferenceInputVideos(refMovCount: number): boolean {
  return refMovCount > 0;
}

function withoutFirstFrameFieldsWhenRefVideo<T extends Record<string, unknown>>(
  snap: T,
  omit: boolean
): T {
  if (!omit) return snap;
  const next = { ...snap };
  delete next.firstFrameImage;
  delete next.firstFrameImageUrl;
  delete next.lastFrameImage;
  delete next.lastFrameImageUrl;
  return next as T;
}

/**
 * 批量同步多个节点的 backdrop 归属，避免逐个节点重复扫描所有 Backdrop。
 */
function syncBackdropMembershipForNodes(nodes: RFNode[], movedIds: string[]): RFNode[] {
  const dedupIds = Array.from(new Set(movedIds)).filter(Boolean);
  if (dedupIds.length === 0) return nodes;
  const movedSet = new Set(dedupIds);
  const nodeById = new Map(nodes.map((n) => [n.id, n] as const));
  const backdrops = nodes.filter((x) => x.type === NodeType.BACKDROP);
  if (backdrops.length === 0) return nodes;

  const targets = new Map<string, string | null>();
  for (const movedId of dedupIds) {
    const moved = nodeById.get(movedId);
    if (!moved || moved.type === NodeType.BACKDROP || moved.type === NodeType.CHAIN_FOLDER) continue;
    const nodeRect = getNodeBoundingRectForBackdrop(moved);
    if (
      ![nodeRect.left, nodeRect.right, nodeRect.top, nodeRect.bottom].every(
        (v) => typeof v === 'number' && Number.isFinite(v)
      ) ||
      nodeRect.right <= nodeRect.left ||
      nodeRect.bottom <= nodeRect.top
    ) {
      continue;
    }
    const c = rectCenterForBackdropMembership(nodeRect);
    let targetId: string | null = null;
    let bestZ = -Infinity;
    let bestId = '';
    for (const b of backdrops) {
      const br = getBackdropFlowRect(b);
      if (!pointInsideBackdropFrame(c, br)) continue;
      const z = backdropFlowZIndex(b);
      if (z > bestZ || (z === bestZ && b.id > bestId)) {
        bestZ = z;
        bestId = b.id;
        targetId = b.id;
      }
    }
    targets.set(movedId, targetId);
  }
  if (targets.size === 0) return nodes;

  let changed = false;
  const next = nodes.map((node) => {
    if (node.type !== NodeType.BACKDROP) return node;
    const d = node.data as NodeData;
    const ids = [...(d.backdropChildIds || [])];
    let nextIds = ids.filter((id) => !(movedSet.has(id) && targets.has(id)));
    for (const [movedId, targetId] of targets) {
      if (targetId === node.id && !nextIds.includes(movedId)) {
        nextIds.push(movedId);
      }
    }
    if (nextIds.length === ids.length && nextIds.every((id, idx) => id === ids[idx])) {
      return node;
    }
    changed = true;
    return { ...node, data: { ...d, backdropChildIds: nextIds } };
  });
  return changed ? next : nodes;
}

/** 节点中心落在背景框内则视为框内成员（用于拖入后联动、拖框移动） */
function collectNodeIdsInsideBackdropFrame(backdrop: RFNode, nodes: RFNode[]): string[] {
  const br = getBackdropFlowRect(backdrop);
  const out: string[] = [];
  for (const n of nodes) {
    if (n.id === backdrop.id || n.type === NodeType.BACKDROP || n.type === NodeType.CHAIN_FOLDER) {
      continue;
    }
    const nr = getNodeBoundingRectForBackdrop(n);
    if (
      ![nr.left, nr.right, nr.top, nr.bottom].every((v) => typeof v === 'number' && Number.isFinite(v)) ||
      nr.right <= nr.left ||
      nr.bottom <= nr.top
    ) {
      continue;
    }
    const c = rectCenterForBackdropMembership(nr);
    if (pointInsideBackdropFrame(c, br)) out.push(n.id);
  }
  return out;
}

/** 按几何范围刷新某背景框的 backdropChildIds，并从其它框移除被「吞并」的节点 */
function setBackdropChildrenFromGeometry(nodes: RFNode[], backdropId: string): RFNode[] {
  const backdrop = nodes.find((n) => n.id === backdropId && n.type === NodeType.BACKDROP);
  if (!backdrop) return nodes;
  const inside = new Set(collectNodeIdsInsideBackdropFrame(backdrop, nodes));
  const insideArr = [...inside];
  let changed = false;
  const next = nodes.map((n) => {
    if (n.type !== NodeType.BACKDROP) return n;
    const d = n.data as NodeData;
    const prev = d.backdropChildIds || [];
    const nextIds =
      n.id === backdropId ? insideArr : prev.filter((id) => !inside.has(id));
    if (nextIds.length === prev.length && nextIds.every((id, i) => id === prev[i])) return n;
    changed = true;
    return { ...n, data: { ...d, backdropChildIds: nextIds } };
  });
  return changed ? next : nodes;
}

const INPUT_LAYOUT_GAP_Y = 64;

/**
 * 兼容旧工程：历史行距偏紧时，按估算卡片高度把后续 INPUT/PROCESSOR 行整体下移。
 */
function normalizePersistedInputRowsWithFolders(nodes: RFNode[], edges: Edge[]): RFNode[] {
  const merged = mergeLegacyChainFolderNodesIntoRoots(nodes);
  const hasCollapsed = merged.some(
    (n) =>
      (n.type === NodeType.INPUT || n.type === NodeType.PROCESSOR) &&
      !!((n.data as NodeData)?.chainFolderChildIds?.length ?? 0)
  );
  if (!hasCollapsed) return merged;

  const roots = merged
    .filter((n) => (n.type === NodeType.INPUT || n.type === NodeType.PROCESSOR) && !n.hidden)
    .sort((a, b) => (a.position.y === b.position.y ? a.position.x - b.position.x : a.position.y - b.position.y));
  if (roots.length === 0) return merged;

  const rows: { rootIds: string[]; originalTop: number }[] = [];
  const ROW_MERGE_THRESHOLD = 120;
  for (const r of roots) {
    const last = rows[rows.length - 1];
    if (!last || Math.abs(r.position.y - last.originalTop) > ROW_MERGE_THRESHOLD) {
      rows.push({ rootIds: [r.id], originalTop: r.position.y });
    } else {
      last.rootIds.push(r.id);
      if (r.position.y < last.originalTop) last.originalTop = r.position.y;
    }
  }
  if (rows.length <= 1) return merged;

  const GAP_Y = INPUT_LAYOUT_GAP_Y;
  const rowNewTop: number[] = [];
  let prevBottom = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowDepth = Math.max(
      280,
      ...row.rootIds.map((id) => {
        const node = merged.find((n) => n.id === id);
        if (!node) return 280;
        return estimateInputProcessorGridHeight(node);
      })
    );
    const targetTop = i === 0 ? row.originalTop : Math.max(row.originalTop, prevBottom + GAP_Y);
    rowNewTop[i] = targetTop;
    prevBottom = targetTop + rowDepth;
  }

  const moveById = new Map<string, number>();
  rows.forEach((row, idx) => {
    const delta = rowNewTop[idx] - row.originalTop;
    if (Math.abs(delta) < 1) return;
    row.rootIds.forEach((id) => moveById.set(id, delta));
  });
  if (moveById.size === 0) return merged;

  return merged.map((n) => {
    const rootDelta = moveById.get(n.id);
    if (typeof rootDelta === 'number') {
      return { ...n, position: { x: n.position.x, y: n.position.y + rootDelta } };
    }
    return n;
  });
}

const CHAIN_EXPAND_W = 200;
const CHAIN_EXPAND_H = 280;
const CHAIN_EXPAND_GAP = 50;

function chainExpandLayoutRect(n: RFNode): { left: number; top: number; right: number; bottom: number } {
  if (n.type === NodeType.CHAIN_FOLDER) {
    return {
      left: n.position.x,
      top: n.position.y,
      right: n.position.x + CHAIN_EXPAND_W,
      bottom: n.position.y + CHAIN_FOLDER_VIS_H,
    };
  }
  const h = n.height || CHAIN_EXPAND_H;
  const w = n.width || CHAIN_EXPAND_W;
  return {
    left: n.position.x,
    top: n.position.y,
    right: n.position.x + w,
    bottom: n.position.y + h,
  };
}

/**
 * 将当前可见图按“层级列 + 列内纵排”重排，提升展开后的整体工整度。
 * 规则：INPUT/PROCESSOR 或无入边节点作为第 0 层，其余按最长父链 +1。
 */
function layoutVisibleNodesByLevels(nodes: RFNode[], edges: Edge[]): RFNode[] {
  const visibleNodes = nodes.filter(
    (n) => !n.hidden && n.type !== NodeType.CHAIN_FOLDER && n.type !== NodeType.BACKDROP
  );
  if (visibleNodes.length === 0) return nodes;

  const visibleIdSet = new Set(visibleNodes.map((n) => n.id));
  const visibleEdges = edges.filter(
    (e) => !e.hidden && visibleIdSet.has(e.source) && visibleIdSet.has(e.target)
  );

  const incoming: Record<string, string[]> = {};
  visibleNodes.forEach((n) => (incoming[n.id] = []));
  visibleEdges.forEach((e) => incoming[e.target].push(e.source));

  const ranks: Record<string, number> = {};
  const roots = visibleNodes.filter(
    (n) => n.type === NodeType.INPUT || n.type === NodeType.PROCESSOR || incoming[n.id].length === 0
  );
  roots.forEach((n) => (ranks[n.id] = 0));

  for (let i = 0; i < visibleNodes.length; i++) {
    let changed = false;
    for (const e of visibleEdges) {
      const sr = ranks[e.source];
      if (sr === undefined) continue;
      if (ranks[e.target] === undefined || ranks[e.target] <= sr) {
        ranks[e.target] = sr + 1;
        changed = true;
      }
    }
    if (!changed) break;
  }

  const byRank = new Map<number, RFNode[]>();
  visibleNodes.forEach((n) => {
    const r = ranks[n.id] ?? 0;
    const arr = byRank.get(r) || [];
    arr.push(n);
    byRank.set(r, arr);
  });

  const START_X = 60;
  const START_Y = 70;
  const COL_GAP_X = 280;
  const ROW_GAP_Y = 36;
  const ITEM_H = 280;

  const posById = new Map<string, { x: number; y: number }>();
  const sortedRanks = Array.from(byRank.keys()).sort((a, b) => a - b);
  for (const r of sortedRanks) {
    const col = byRank.get(r)!;
    col.sort((a, b) => {
      const na = ((a.data as NodeData)?.customName || (a.data as NodeData)?.label || '').toString();
      const nb = ((b.data as NodeData)?.customName || (b.data as NodeData)?.label || '').toString();
      const byName = na.localeCompare(nb, undefined, { numeric: true, sensitivity: 'base' });
      if (byName !== 0) return byName;
      return a.position.y - b.position.y;
    });
    col.forEach((n, idx) => {
      posById.set(n.id, {
        x: START_X + r * COL_GAP_X,
        y: START_Y + idx * (ITEM_H + ROW_GAP_Y),
      });
    });
  }

  return nodes.map((n) => {
    const p = posById.get(n.id);
    if (!p) return n;
    return { ...n, position: p };
  });
}

/**
 * 展开链路折叠：子节点按 chainFolderChildIds 顺序排在根节点右侧纵向展开；清除根上打组数据（条在节点内）；
 * 同一纵向带内、根节点右侧的其它节点整体右移以保持顺序；解除相关边 hidden。
 */
function applyChainFolderExpandLayout(
  nodes: RFNode[],
  edges: Edge[],
  target: { folderId?: string; rootId?: string }
): { nodes: RFNode[]; edges: Edge[] } | null {
  let rootId: string | undefined;
  let orderIds: string[] = [];
  let legacyFolderId: string | undefined;

  if (target.folderId) {
    const folder = nodes.find((n) => n.id === target.folderId && n.type === NodeType.CHAIN_FOLDER);
    if (!folder) return null;
    legacyFolderId = folder.id;
    rootId = folder.data.chainFolderRootId;
    orderIds = folder.data.chainFolderChildIds || [];
  } else if (target.rootId) {
    rootId = target.rootId;
    const r = nodes.find((n) => n.id === rootId);
    if (!r || (r.type !== NodeType.INPUT && r.type !== NodeType.PROCESSOR && r.type !== NodeType.MOV && r.type !== NodeType.OUTPUT)) return null;
    orderIds = (r.data as NodeData).chainFolderChildIds || [];
    if (orderIds.length === 0) return null;
  } else {
    return null;
  }

  if (!rootId) return null;

  const root = nodes.find((n) => n.id === rootId);
  if (!root) return null;

  const expandLabel =
    ((root.data as NodeData | undefined)?.chainFolderLabel ||
      (target.folderId
        ? (nodes.find((n) => n.id === target.folderId)?.data as NodeData | undefined)?.chainFolderLabel
        : undefined) ||
      '下游') as '上游' | '下游';
  const isUpstreamExpand = expandLabel === '上游';

  const positions = new Map<string, { x: number; y: number }>();
  const startX = isUpstreamExpand
    ? root.position.x - CHAIN_EXPAND_W - CHAIN_EXPAND_GAP
    : root.position.x + CHAIN_EXPAND_W + CHAIN_EXPAND_GAP;
  let cy = root.position.y;
  for (const cid of orderIds) {
    if (!nodes.some((n) => n.id === cid)) continue;
    positions.set(cid, { x: startX, y: cy });
    cy += CHAIN_EXPAND_H + CHAIN_EXPAND_GAP;
  }

  const rootR = chainExpandLayoutRect(root);
  let bb = { ...rootR };
  for (const [, p] of positions) {
    bb.left = Math.min(bb.left, p.x);
    bb.right = Math.max(bb.right, p.x + CHAIN_EXPAND_W);
    bb.top = Math.min(bb.top, p.y);
    bb.bottom = Math.max(bb.bottom, p.y + CHAIN_EXPAND_H);
  }
  const PAD = 24;
  bb = {
    left: bb.left - PAD,
    top: bb.top - PAD,
    right: bb.right + PAD,
    bottom: bb.bottom + PAD,
  };

  const expandedIds = new Set<string>([rootId, ...positions.keys()]);

  let next = legacyFolderId ? nodes.filter((n) => n.id !== legacyFolderId) : nodes;
  next = next.map((n) => {
    if (n.id === rootId) {
      const d = n.data as NodeData;
      return {
        ...n,
        data: {
          ...d,
          // 展开后移除打组标识（按当前产品要求）
          chainFolderChildIds: undefined,
          chainFolderExpanded: true,
          chainFolderLabel: undefined,
        },
      };
    }
    if (positions.has(n.id)) {
      const p = positions.get(n.id)!;
      return { ...n, position: { x: p.x, y: p.y }, hidden: false };
    }
    if (orderIds.includes(n.id)) {
      return { ...n, hidden: false };
    }
    return n;
  });

  const subtreeEdgeIds = new Set([rootId, ...positions.keys()]);
  const nextEdges = edges.map((e) =>
    subtreeEdgeIds.has(e.source) || subtreeEdgeIds.has(e.target) ? { ...e, hidden: undefined } : e
  );

  /**
   * 仅推动“根节点所在这一排”的后续节点：
   * - 纵向带以根节点高度为基准（而不是整块展开高度），避免把其它行误推走。
   * - 横向从根节点 x 起，整体右移同一 delta，保持原有先后顺序。
   */
  const rootBandTop = rootR.top - 40;
  const rootBandBottom = rootR.bottom + 40;
  if (!isUpstreamExpand) {
    const sliceLeft = root.position.x;
    const floorX = bb.right + CHAIN_EXPAND_GAP;
    const corridorIds = next
      .filter((n) => {
        if (expandedIds.has(n.id)) return false;
        const r = chainExpandLayoutRect(n);
        if (r.left < sliceLeft) return false;
        if (r.bottom < rootBandTop || r.top > rootBandBottom) return false;
        return true;
      })
      .map((n) => n.id);
    if (corridorIds.length > 0) {
      const candSet = new Set(corridorIds);
      const minLeft = Math.min(
        ...Array.from(candSet).map((id) => {
          const n = next.find((x) => x.id === id);
          return n ? chainExpandLayoutRect(n).left : Infinity;
        })
      );
      if (Number.isFinite(minLeft) && minLeft < floorX) {
        const delta = floorX - minLeft;
        next = next.map((n) =>
          candSet.has(n.id) ? { ...n, position: { x: n.position.x + delta, y: n.position.y } } : n
        );
      }
    }
  } else {
    // 上游展开：把“根节点左侧同排”节点整体左移让位
    const rootRight = root.position.x + (root.width || CHAIN_EXPAND_W);
    const floorLeft = bb.left - CHAIN_EXPAND_GAP;
    const corridorIds = next
      .filter((n) => {
        if (expandedIds.has(n.id)) return false;
        const r = chainExpandLayoutRect(n);
        if (r.right > rootRight) return false;
        if (r.bottom < rootBandTop || r.top > rootBandBottom) return false;
        return true;
      })
      .map((n) => n.id);
    if (corridorIds.length > 0) {
      const candSet = new Set(corridorIds);
      const maxRight = Math.max(
        ...Array.from(candSet).map((id) => {
          const n = next.find((x) => x.id === id);
          return n ? chainExpandLayoutRect(n).right : Number.NEGATIVE_INFINITY;
        })
      );
      if (Number.isFinite(maxRight) && maxRight > floorLeft) {
        const delta = maxRight - floorLeft;
        next = next.map((n) =>
          candSet.has(n.id) ? { ...n, position: { x: n.position.x - delta, y: n.position.y } } : n
        );
      }
    }
  }

  // 纵向避让：展开列会向下生长，若压到下方同列节点，则整体下推该列
  const columnLeft = isUpstreamExpand ? bb.left : startX - PAD;
  const columnRight = isUpstreamExpand ? root.position.x + (root.width || CHAIN_EXPAND_W) + PAD : bb.right;
  const floorY = bb.bottom + CHAIN_EXPAND_GAP;
  const underIds = next
    .filter((n) => {
      if (expandedIds.has(n.id)) return false;
      const r = chainExpandLayoutRect(n);
      if (r.right < columnLeft || r.left > columnRight) return false;
      if (r.top <= rootR.bottom + 8) return false;
      return true;
    })
    .map((n) => n.id);
  if (underIds.length > 0) {
    const candSet = new Set(underIds);
    const minTop = Math.min(
      ...Array.from(candSet).map((id) => {
        const n = next.find((x) => x.id === id);
        return n ? chainExpandLayoutRect(n).top : Infinity;
      })
    );
    if (Number.isFinite(minTop) && minTop < floorY) {
      const delta = floorY - minTop;
      next = next.map((n) =>
        candSet.has(n.id) ? { ...n, position: { x: n.position.x, y: n.position.y + delta } } : n
      );
    }
  }

  return { nodes: next, edges: nextEdges };
}

export type FlowEditorProjectActions = {
  openSaveDialog: () => void;
  quickSave: () => void;
  loadProject: () => void;
  newProject: () => void;
  canvasRefreshPaused: boolean;
  canvasPerfAdvanced: boolean;
  toggleCanvasRefresh: () => void;
  toggleCanvasPerfAdvanced: () => void;
};

type FlowEditorProps = {
  projectName?: string;
  onProjectNameChange?: (name: string) => void;
  onProjectActionsChange?: (actions: FlowEditorProjectActions | null) => void;
  /** 服务端项目 id：有值时画布/对话与 scoped localStorage + workspace API 同步 */
  serverProjectId?: string | null;
  /** 由路由在 GET workspace 完成后传入；undefined 表示非多用户路由 */
  workspaceHydration?: { version: number; payload: unknown } | null;
};

/** 加载持久化数据后裁剪单节点缩略图条数，防止极端工程拖垮渲染 */
function capNodeGeneratedThumbnailsDeep(n: any): any {
  if (!n || typeof n !== 'object') return n;
  const data = n.data;
  if (!data || typeof data !== 'object') return n;
  const thumbs = data.generatedThumbnails;
  if (Array.isArray(thumbs) && thumbs.length > FLOW_MAX_THUMBNAILS_PER_NODE) {
    return {
      ...n,
      data: {
        ...data,
        generatedThumbnails: thumbs.slice(-FLOW_MAX_THUMBNAILS_PER_NODE),
      },
    };
  }
  return n;
}

/** 服务端 workspace 自动保存防抖（秒级），值过大会导致刷新前改动来不及落盘 */
const REMOTE_WORKSPACE_SAVE_DEBOUNCE_MS = 3000;
/** 本地快照自动保存防抖，避免仅依赖离页 keepalive 导致强刷场景丢数据 */
const LOCAL_SNAPSHOT_SAVE_DEBOUNCE_MS = 15000;
/** fetch keepalive 请求体上限约 64KB（含头），超限则仅依赖本地快照 + 常规防抖落盘 */
const KEEPALIVE_FETCH_MAX_BODY_BYTES = 58_000;

function estimateJsonUtf8Bytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function buildPersistSnapshot(
  nodes: RFNode[],
  edges: Edge[],
  storyboardImages: string[]
): { nodes: RFNode[]; edges: Edge[]; storyboardImages: string[]; savedAt: string } {
  const sanitizedNodes = nodes
    .map((n) => sanitizePersistValueDeep(n))
    .filter(Boolean)
    .map(capNodeGeneratedThumbnailsDeep)
    .map((n) => normalizeNodeRunStateForPersist(n))
    .slice(0, FLOW_MAX_PERSISTED_NODES);
  const sanitizedStoryboard = sanitizeStoryboardImagesForPersist(storyboardImages);
  return {
    nodes: sanitizedNodes,
    edges: edges.slice(0, FLOW_MAX_PERSISTED_EDGES),
    storyboardImages: sanitizedStoryboard,
    savedAt: new Date().toISOString(),
  };
}

type FlowViewportSnapshot = {
  x: number;
  y: number;
  zoom: number;
};

type FlowgenWorkspacePayloadV1 = {
  v: 1;
  graph: { nodes: RFNode[]; edges: Edge[]; storyboardImages: string[]; savedAt?: string } | null;
  viewport: FlowViewportSnapshot | null;
  /** @deprecated 旧版单份对话；新数据写入 chatByUser */
  chat?: PersistedCanvasChatV1 | null;
  /** 按用户 id 隔离的侧栏对话快照 */
  chatByUser?: Record<string, PersistedCanvasChatV1 | null | undefined>;
  projectName?: string;
};

function readPersistedViewport(storageKey: string, legacyKey?: string | null): FlowViewportSnapshot | null {
  try {
    const raw = localStorage.getItem(storageKey) || (legacyKey ? localStorage.getItem(legacyKey) : null);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const x = Number(parsed?.x);
    const y = Number(parsed?.y);
    const zoom = Number(parsed?.zoom);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(zoom)) return null;
    return { x, y, zoom };
  } catch {
    return null;
  }
}

/**
 * OUTPUT/MOV 节点从源节点继承的面板态字段（白名单）。
 * 仅保留生成结果展示与模型配置参数；**创意描述 / 图片 / 视频 / 音频 / 首尾帧参考一律不继承**，
 * 其完整值仅存于 `generationParams` 快照供 Node Details 只读展示。
 */
const OUTPUT_NODE_INHERIT_KEYS: Array<keyof NodeData> = [
  'aspectRatio',
  'resolution',
  'numberOfImages',
  'quality',
  'duration',
  'creativityLevel',
  'klingAudioSync',
  'klingOmniTab',
  'jimengGenerationMode',
  'jimengProfessionalMode',
  'jimengResolution',
  'jimengVideoRatio',
  'viduDuration',
  'viduClarity',
  'viduMotionRange',
  'seedanceResolution',
  'seedanceAspectRatio',
  'seedanceDuration',
  'seedanceGenerateAudio',
  'seedanceFixedCamera',
  'seedanceGenerationMode',
  'seedanceReferenceRatioMode',
  'seedanceReferenceWebSearch',
  'image2Style',
  'image2AspectRatio',
  'image2ImageSize',
  'image2Quality',
  'image2QualityLevel',
];

function buildInheritedOutputDataFromSnapshot(snapshot: Partial<NodeData>): Partial<NodeData> {
  const picked: Partial<NodeData> = {};
  for (const key of OUTPUT_NODE_INHERIT_KEYS) {
    const value = snapshot[key];
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      (picked as any)[key] = [...value];
    } else if (value && typeof value === 'object') {
      (picked as any)[key] = JSON.parse(JSON.stringify(value));
    } else {
      (picked as any)[key] = value;
    }
  }
  return {
    ...picked,
    status: 'idle',
    progress: 0,
    errorMessage: undefined,
    generatedThumbnails: undefined,
    customName: undefined,
    chatHistory: undefined,
    generationParams: undefined,
  };
}

/** 结构签名用：不把 imagePreview / 大段参考图 URL 打进 JSON，避免多节点时每次改动都序列化数 MB */
function stripHeavyFieldsFromNodeDataForSig(data: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!data || typeof data !== 'object') return {};
  const d: Record<string, unknown> = { ...data };
  delete d.videoPosterDataUrl;
  const preview = d.imagePreview;
  if (typeof preview === 'string') {
    d.imagePreview = `len:${preview.length}`;
  }
  const urlArrayKeys = [
    'referenceImages',
    'jimengImages',
    'klingOmniMultiReferenceImages',
    'klingOmniInstructionReferenceImages',
    'klingOmniVideoReferenceImages',
  ] as const;
  for (const key of urlArrayKeys) {
    const arr = d[key];
    if (Array.isArray(arr)) d[key] = arr.length;
  }
  if (Array.isArray(d.generatedThumbnails)) {
    d.generatedThumbnails = (d.generatedThumbnails as unknown[]).map((t) => {
      if (!t || typeof t !== 'object') return t;
      const row = { ...(t as Record<string, unknown>) };
      delete row.posterDataUrl;
      const url = row.url;
      if (typeof url === 'string') row.url = `len:${url.length}`;
      return row;
    });
  }
  return d;
}

/**
 * 仅用于“是否需要保存 history / 立即持久化”的轻量签名。
 * 忽略 poster / 预览大图等纯展示字段，避免这些高频补写触发整图深拷贝与序列化。
 */
function buildStructuralGraphSignature(
  nodes: RFNode[],
  edges: Edge[],
  storyboardImages: string[]
): string {
  const normalizedNodes = nodes.map((n) => {
    const data = stripHeavyFieldsFromNodeDataForSig(n.data as Record<string, unknown> | undefined);
    return {
      id: n.id,
      type: n.type,
      hidden: n.hidden === true,
      position: n.position,
      data,
    };
  });
  const normalizedEdges = edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    hidden: e.hidden === true,
  }));
  return JSON.stringify({
    nodes: normalizedNodes,
    edges: normalizedEdges,
    storyboardImages,
  });
}

/** 撤销栈对比用：忽略节点坐标，便于拖动画布结束时只 patch 位置而不深拷贝整图 data */
function buildStructuralGraphSignatureExcludingPosition(
  nodes: RFNode[],
  edges: Edge[],
  storyboardImages: string[]
): string {
  const normalizedNodes = nodes.map((n) => {
    const data = stripHeavyFieldsFromNodeDataForSig(n.data as Record<string, unknown> | undefined);
    return { id: n.id, type: n.type, hidden: n.hidden === true, data };
  });
  const normalizedEdges = edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    hidden: e.hidden === true,
  }));
  return JSON.stringify({
    nodes: normalizedNodes,
    edges: normalizedEdges,
    storyboardImages,
  });
}

/** Node Details「Used Parameters」：与侧栏 Tab 文案一致 */
function formatSeedanceGenerationModeForDetails(
  mode: string | undefined,
  modelName: string
): string {
  // 1.5 无生成模式 tab，详情里不应展示该字段
  if (modelName.trim() === 'seedance1.5-pro') return '';
  const m = mode ?? 'text';
  if (m === 'text') return '文生视频';
  if (m === 'image') return '图生视频';
  if (m === 'reference') return '参考生视频';
  return m;
}

function formatKlingOmniTabForDetails(tab: string | undefined): string {
  switch (tab ?? 'multi') {
    case 'multi':
      return '多图参考';
    case 'instruction':
      return '指令变换';
    case 'video':
      return '视频参考';
    case 'frames':
      return '首尾帧';
    default:
      return tab ?? 'multi';
  }
}

function formatGeneratedAtForDetails(value?: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('zh-CN', { hour12: false });
}

/** Node Details 标题下：有 Tab 的模型展示一行摘要 */
function nodeDetailsTabSummaryLine(p: {
  model?: string;
  seedanceGenerationMode?: string;
  klingOmniTab?: string;
  jimengGenerationMode?: 'text' | 'image';
}): string | null {
  const m = (p.model || '').trim();
  if (['seedance2.0 (高质量版)', 'seedance2.0 (急速版)'].includes(m)) {
    return `${m} 生成模式：${formatSeedanceGenerationModeForDetails(p.seedanceGenerationMode, m)}`;
  }
  if (m === '可灵3.0 Omni') {
    return `${m} 生成模式：${formatKlingOmniTabForDetails(p.klingOmniTab)}`;
  }
  // 即梦3.0 Pro：Node Details 不展示“生成模式”摘要（用户要求）
  return null;
}

const MANUAL_SAVE_REMINDER_INTERVAL_MS = 20 * 60 * 1000;
const MANUAL_SAVE_REMINDER_COOLDOWN_MS = 10 * 60 * 1000;

// Start with an empty canvas
const initialNodes: RFNode[] = [];

const initialEdges: Edge[] = [];

let id = 0;
const getId = () => `node_${id++}_${Date.now()}`;

/** Ctrl+C / Ctrl+V 画布节点剪贴板（与导出 JSON 结构相近，带标记以免误解析） */
const FLOWGEN_CLIPBOARD_MARKER = '__flowgenFlowClipboard' as const;
const FLOWGEN_CLIPBOARD_VERSION = 1;

type FlowgenClipboardNode = {
  id: string;
  type: string;
  position: XYPosition;
  data: NodeData;
  width?: number;
  height?: number;
  style?: React.CSSProperties;
};

type FlowgenClipboardPayload = {
  [FLOWGEN_CLIPBOARD_MARKER]: true;
  version: number;
  nodes: FlowgenClipboardNode[];
  edges: Array<{
    id: string;
    source: string;
    target: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
    animated?: boolean;
    style?: React.CSSProperties;
    type?: string;
  }>;
};

/** 解析画布节点剪贴板 JSON；无效或非 FlowGen 载荷时返回 null */
function tryParseFlowgenClipboardForPaste(
  text: string
): { raw: Record<string, unknown>; nodesIn: FlowgenClipboardNode[] } | null {
  if (!text?.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const raw = parsed as Record<string, unknown>;
  if (raw[FLOWGEN_CLIPBOARD_MARKER] !== true || !Array.isArray(raw.nodes)) return null;
  const nodesIn = raw.nodes as FlowgenClipboardNode[];
  if (nodesIn.length === 0) return null;
  return { raw, nodesIn };
}

/** Ctrl+V 粘贴：保留可持久化生成预览与缩略图条；清除 taskId/运行态，避免误恢复旧任务 */
function stripPastedFlowNodeHistory(nodeType: string, data: NodeData): NodeData {
  const next: NodeData = {
    ...data,
    status: 'idle',
    progress: 0,
    errorMessage: undefined,
    taskId: undefined,
  };
  const persistableThumbs = (data.generatedThumbnails || [])
    .filter((t) => t?.url && isPersistableMediaUrl(String(t.url)))
    .map((t) => ({ ...t }));
  next.generatedThumbnails = persistableThumbs.length ? persistableThumbs : undefined;

  if (nodeType === NodeType.MOV || nodeType === NodeType.OUTPUT) {
    const preview = String(data.imagePreview || '').trim();
    const genFromMc = getModelConfigOutputPreviewUrl(data as unknown as Record<string, unknown>);
    const previewPersistable =
      preview && isPersistableMediaUrl(preview) && !isEphemeralMediaUrl(preview, 'imagePreview');
    const keepOutputPreview =
      previewPersistable &&
      (nodeType === NodeType.MOV
        ? isVideoPreviewUrl(preview)
        : !isVideoPreviewUrl(preview) &&
          (!outputImagePreviewLooksLikePanelRefMismatch(data as unknown as Record<string, unknown>) ||
            preview === genFromMc));
    next.imagePreview = keepOutputPreview ? preview : genFromMc || undefined;
    if (!keepOutputPreview && !genFromMc) {
      next.videoPosterDataUrl = undefined;
      next.generatedAt = undefined;
      next.imageName = undefined;
    }
  }
  if (next.generationParams) {
    const gp = { ...next.generationParams } as GenerationParams;
    delete gp.taskId;
    delete gp.generatedAt;
    next.generationParams = gp;
  }
  return next;
}

/**
 * 分镜表批量生成下游：继承模板主预览（浅拷贝，各节点共享同一 URL 字符串引用，不 JSON 深拷贝）。
 * 仍清除缩略图条与生成历史；MOV/OUTPUT 模板按 stripPastedFlowNodeHistory 规则不带主预览。
 */
function stripSpawnedStoryboardNodeData(nodeType: string, data: NodeData): NodeData {
  const next = stripPastedFlowNodeHistory(nodeType, data);
  next.generatedThumbnails = undefined;
  return next;
}

/** 图结构调试（默认静默） */
function logFlowGenGraph(_phase: string, _payload: Record<string, unknown>) {}
function logRefDebug(_stage: string, _payload: Record<string, unknown>) {}

/** 运行期调试占位：完整 preload 仅由 services/aitop.ts 在首次创建任务时打印一次 */
function logPreloadDebug(_payload: Record<string, unknown>) {}

function logModelRequest(_model: string, _payload: Record<string, unknown>) {}

/**
 * image 2 多图参考串位/重复排查。
 * 控制台执行：`localStorage.setItem('flowgen:debugImage2','1')` 后刷新页面，再点运行；
 * 关闭：`localStorage.removeItem('flowgen:debugImage2')`
 */
function summarizeImageRefUrlForDebug(u: unknown, idx: number): string {
  const s = typeof u === 'string' ? u.trim() : '';
  if (!s) return `#${idx}:<empty>`;
  const len = s.length;
  if (/^data:image\//i.test(s)) {
    const mime = s.match(/^data:([^;,]+)/)?.[1] || 'image';
    return `#${idx}:data:${mime} len=${len}`;
  }
  if (/^blob:/i.test(s)) return `#${idx}:blob len=${len}`;
  if (s.includes('aitop100app')) return `#${idx}:aitop…${s.slice(-36)} len=${len}`;
  return `#${idx}:url len=${len} tail=${s.slice(-48)}`;
}

function logImage2Debug(stage: string, payload: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  try {
    if (localStorage.getItem('flowgen:debugImage2') !== '1') return;
    console.info(`[FlowGen:image2-debug] ${stage} ${JSON.stringify(payload, null, 2)}`);
  } catch {
    if (localStorage.getItem('flowgen:debugImage2') !== '1') return;
    console.info('[FlowGen:image2-debug]', stage, payload);
  }
}

/** Seedance 参考生视频等：从连入边向上游找第一条可用视频 URL（MOV/OUTPUT/缩略图） */
function findUpstreamVideoUrlForProcessorNode(
  targetId: string,
  getNodes: () => RFNode[],
  getEdges: () => Edge[]
): string | undefined {
  const nodes = getNodes();
  const edges = getEdges();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const visited = new Set<string>();
  let queue: Array<{ id: string; depth: number }> = edges
    .filter((ed) => ed.target === targetId)
    .map((ed) => ({ id: ed.source, depth: 1 }));
  queue.sort((a, b) => {
    const na = byId.get(a.id);
    const nb = byId.get(b.id);
    const rank = (n: RFNode | undefined) => {
      if (!n) return 0;
      if (n.type === NodeType.MOV) return 3;
      if (n.type === NodeType.OUTPUT) return 2;
      if (n.type === NodeType.PROCESSOR) return 1;
      return 0;
    };
    return rank(nb) - rank(na);
  });
  const isVideoUrl = (url?: string): boolean => {
    if (!url) return false;
    return (
      /\.(mov|mp4|webm|avi|mkv|flv|wmv|m4v)(\?|$)/i.test(url) ||
      url.startsWith('blob:') ||
      /video/i.test(url)
    );
  };
  while (queue.length > 0) {
    const cur = queue.shift();
    if (!cur || visited.has(cur.id)) continue;
    visited.add(cur.id);
    const n = byId.get(cur.id);
    const url = (n?.data as any)?.imagePreview as string | undefined;
    const thumbnails = (n?.data as any)?.generatedThumbnails;
    if (Array.isArray(thumbnails)) {
      const videoThumb = thumbnails.find((t: any) => t?.type === 'video' && isVideoUrl(t?.url));
      if (videoThumb?.url) return videoThumb.url;
    }
    if (isVideoUrl(url)) return url;
    if (cur.depth >= 8) continue;
    const parents = edges.filter((ed) => ed.target === cur.id).map((ed) => ed.source);
    for (const pid of parents) queue.push({ id: pid, depth: cur.depth + 1 });
  }
  return undefined;
}

/** 图生视频首尾帧选材：blob 多为本地图片预览，勿与视频混判（否则主图 blob 无法回落到首帧） */
function looksLikeVideoUrlForSeedanceRef(url: string): boolean {
  if (!url) return false;
  if (/^data:image\//i.test(url)) return false;
  if (/\.(png|jpe?g|webp|gif|bmp|svg)(\?|$)/i.test(url)) return false;
  if (url.startsWith('blob:')) return false;
  return (
    /\.(mov|mp4|webm|avi|mkv|flv|wmv|m4v)(\?|$)/i.test(url) ||
    /^data:video\//i.test(url) ||
    /kechuangai\.com\/ksc2\//i.test(url)
  );
}

/** 将 File 转为 dataURL，用于上传时使用原图 */
const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });

// Custom Connection Line Component
const CustomConnectionLine = ({ fromX, fromY, toX, toY }: ConnectionLineComponentProps) => {
  return (
    <g>
      <path
        fill="none"
        stroke="#6366f1"
        strokeWidth={2.5}
        className="animated"
        d={`M${fromX},${fromY} C ${fromX + 80},${fromY} ${toX - 80},${toY} ${toX},${toY}`}
        style={{ strokeDasharray: '5,5', animation: 'flow 0.5s linear infinite' }}
      />
      <circle 
        cx={toX} 
        cy={toY} 
        r={6} 
        fill="#6366f1" 
        stroke="#1a202c" 
        strokeWidth={2}
        className="drop-shadow-md"
      />
    </g>
  );
};

const FlowEditor = ({
  projectName,
  onProjectNameChange,
  onProjectActionsChange,
  serverProjectId = null,
  workspaceHydration,
}: FlowEditorProps) => {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const setFlowCanvasWrapperRef = useCallback((el: HTMLDivElement | null) => {
    reactFlowWrapper.current = el;
  }, []);
  const [nodes, setNodes, onNodesChangeBase] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const { screenToFlowPosition, fitView, getNodes, getEdges, setViewport, getViewport } = useReactFlow();
  const projectAssetBySlugRef = useRef<Map<string, string>>(new Map());
  const projectAssetResolveOptsRef = useRef<ResolvePromptPlaceholdersOptions>({});
  const buildRunPromptCtx = (data: NodeData) =>
    buildPromptMediaRefContextForRun(
      data,
      projectAssetResolveOptsRef.current.projectAssets
    );
  const [projectAssetRefItems, setProjectAssetRefItems] = useState<PromptMediaRefItem[]>([]);
  const [projectAssetLabelRows, setProjectAssetLabelRows] = useState<ProjectAssetLabelRow[]>([]);
  const [assetLibraryOpen, setAssetLibraryOpen] = useState(false);
  const [inspectorWidth, setInspectorWidth] = useState(readStoredInspectorWidth);
  const inspectorWidthRef = useRef(inspectorWidth);
  inspectorWidthRef.current = inspectorWidth;

  useEffect(() => {
    const onResize = () => setInspectorWidth((w) => clampInspectorWidth(w));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const startResizeInspector = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = inspectorWidthRef.current;
    let last = startW;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      last = clampInspectorWidth(startW + (startX - ev.clientX));
      setInspectorWidth(last);
    };
    const onUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      try {
        localStorage.setItem(INSPECTOR_WIDTH_LS_KEY, String(last));
      } catch {
        /* ignore */
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  const workspaceVersionRef = useRef(0);
  const latestChatSnapshotRef = useRef<PersistedCanvasChatV1 | null>(null);
  const chatByUserRef = useRef<Record<string, PersistedCanvasChatV1>>({});
  const remoteSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRemoteWorkspaceSigRef = useRef('');
  /** 离开画布前最后一次有效图（防卸载后延迟保存读到空 getNodes） */
  const latestRemoteGraphRef = useRef<{
    nodes: RFNode[];
    edges: Edge[];
    storyboardImages: string[];
  } | null>(null);
  const isEditorMountedRef = useRef(true);
  const saveRemoteWorkspaceNowRef = useRef<
    (
      graphOverride?: {
        nodes: RFNode[];
        edges: Edge[];
        storyboardImages?: string[];
      },
      options?: {
        force?: boolean;
        versionRetry?: boolean;
        allowEmptyGraph?: boolean;
        keepalive?: boolean;
        networkRetry?: boolean;
      }
    ) => Promise<void>
  >(async () => {});
  const isGlobalRunningRef = useRef(false);
  const chatStorageScope = useMemo(
    () => resolveChatStorageScope(getStoredUser()?.id, serverProjectId ?? null),
    [serverProjectId]
  );
  const [projectSkill, setProjectSkill] = useState<ProjectSkillConfig | null>(null);
  const reloadProjectSkill = useCallback(() => {
    if (!serverProjectId) {
      setProjectSkill(null);
      return;
    }
    void listProjects()
      .then((r) => {
        const p = r.projects.find((x) => x.id === serverProjectId);
        setProjectSkill(parseProjectSkill(p?.extendedJson));
      })
      .catch(() => setProjectSkill(null));
  }, [serverProjectId]);

  useEffect(() => {
    reloadProjectSkill();
  }, [reloadProjectSkill]);

  /** 进入项目后：生图/生视频请求携带域账号与 scoreProjectId（AITOP 项目 id） */
  useEffect(() => {
    const user = getStoredUser();
    if (serverProjectId && user?.username) {
      setAitopBillingContext({
        domainAccount: user.username,
        scoreProjectId: serverProjectId,
      });
    } else {
      setAitopBillingContext(null);
    }
    return () => setAitopBillingContext(null);
  }, [serverProjectId]);

  useEffect(() => {
    if (!serverProjectId) return;
    const onSkillUpdated = (ev: Event) => {
      const pid = (ev as CustomEvent<{ projectId?: string }>).detail?.projectId;
      if (pid && pid !== serverProjectId) return;
      reloadProjectSkill();
    };
    const onFocus = () => reloadProjectSkill();
    window.addEventListener('flowgen:project-skill-updated', onSkillUpdated);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('flowgen:project-skill-updated', onSkillUpdated);
      window.removeEventListener('focus', onFocus);
    };
  }, [serverProjectId, reloadProjectSkill]);
  const canvasChatStorageKey = useMemo(
    () => chatCanvasSessionStorageKey(chatStorageScope),
    [chatStorageScope]
  );
  const STORAGE_KEY = useMemo(
    () => projectWorkspaceDataStorageKey(chatStorageScope),
    [chatStorageScope]
  );
  const STORAGE_BACKUP_KEY = useMemo(
    () => projectWorkspaceBackupStorageKey(chatStorageScope),
    [chatStorageScope]
  );
  const LAST_VIEWPORT_KEY = useMemo(
    () => projectViewportStorageKey(chatStorageScope),
    [chatStorageScope]
  );
  const legacyProjectDataKey = chatStorageScope.projectId
    ? legacyProjectWorkspaceDataStorageKey(chatStorageScope.projectId)
    : null;
  const legacyViewportKey = chatStorageScope.projectId
    ? legacyProjectViewportStorageKey(chatStorageScope.projectId)
    : null;
  const [bootPayload, setBootPayload] = useState<'pending' | 'local' | string>(() =>
    serverProjectId ? 'pending' : 'local'
  );

  const sidebarInitialChatV1 = useMemo((): PersistedCanvasChatV1 | null | undefined => {
    if (!serverProjectId || workspaceHydration == null) return undefined;
    const raw = workspaceHydration.payload;
    if (!raw || typeof raw !== 'object') return null;
    const p = raw as Partial<FlowgenWorkspacePayloadV1>;
    const uid = getStoredUser()?.id;
    if (uid && p.chatByUser && typeof p.chatByUser === 'object') {
      const mine = p.chatByUser[uid];
      if (mine) return mine as PersistedCanvasChatV1;
    }
    return null;
  }, [serverProjectId, workspaceHydration]);

  const reloadProjectAssets = useCallback(async () => {
    if (!serverProjectId) {
      projectAssetBySlugRef.current = new Map();
      projectAssetResolveOptsRef.current = {};
      setProjectAssetRefItems([]);
      setProjectAssetLabelRows([]);
      return;
    }
    try {
      const r = await listAssets(serverProjectId);
      const rows = r.assets.map((a) => ({ id: a.id, name: a.name }));
      const slugRows = buildProjectAssetSlugRows(rows);
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const rowUrls = slugRows.map((s) => {
        const u = r.assets.find((x) => x.id === s.id)?.url || '';
        return {
          slug: s.slug,
          name: s.name,
          url: u.startsWith('http') ? u : `${origin}${u}`,
        };
      });
      const slugUrlMap = buildProjectAssetSlugUrlMap(rowUrls);
      projectAssetBySlugRef.current = slugUrlMap;
      projectAssetResolveOptsRef.current = {
        projectAssets: rowUrls,
      };
      setProjectAssetRefItems(buildProjectAssetPromptRefItems(rows));
      setProjectAssetLabelRows(rowUrls);
    } catch {
      projectAssetBySlugRef.current = new Map();
      projectAssetResolveOptsRef.current = {};
      setProjectAssetRefItems([]);
      setProjectAssetLabelRows([]);
    }
  }, [serverProjectId]);
  /** 输入/处理网格按钮：true=本次点击「排序并打组」，false=本次「同规则排序并全部展开」；每次执行后取反 */
  const inputArrangeFoldOnNextClickRef = useRef(true);
  /** 视频输出网格按钮：true=本次点击「排序并打组上游」，false=本次「同规则排序并全部展开」；每次执行后取反 */
  const movArrangeFoldOnNextClickRef = useRef(true);
  const [isLayouting, setIsLayouting] = useState(false);
  /** 工具栏全图自动布局：首次点击前快照；再次点击恢复 */
  const autoLayoutSnapshotRef = useRef<{ nodes: RFNode[]; edges: Edge[] } | null>(null);
  /** 与 writeText 同步；HTTP/无权限时 readText 失败，仍可在本标签页内粘贴最近一次 Ctrl+C 的节点 */
  const internalFlowNodeClipboardRef = useRef<string | null>(null);
  /** Backdrop 拖动：记录起点与子节点初始坐标，用于联动平移 */
  const backdropDragStateRef = useRef<{
    backdropId: string;
    backdropStart: XYPosition;
    childPositions: Map<string, XYPosition>;
  } | null>(null);
  const backdropDragRafRef = useRef<number | null>(null);
  const backdropDragPendingOffsetRef = useRef<XYPosition | null>(null);
  const backdropDragLastAppliedOffsetRef = useRef<XYPosition | null>(null);
  const backdropDragLastCommitAtRef = useRef(0);

  useEffect(() => {
    return () => {
      if (backdropDragRafRef.current != null) {
        window.cancelAnimationFrame(backdropDragRafRef.current);
        backdropDragRafRef.current = null;
      }
      backdropDragPendingOffsetRef.current = null;
      backdropDragLastAppliedOffsetRef.current = null;
    };
  }, []);

  // 自定义 onNodesChange：在节点删除时清理相关缩略图
  const onNodesChange = useCallback((changes: any[]) => {
    // 先执行默认的节点变化处理
    onNodesChangeBase(changes);
    
    // 检测是否有节点被删除
    const deletedNodeIds = changes
      .filter(change => change.type === 'remove')
      .map(change => change.id);
    
    const resizedBackdropIds = changes
      .filter((ch: { type?: string; id?: string }) => ch.type === 'dimensions' && ch.id)
      .map((ch: { id: string }) => ch.id)
      .filter((id, idx, arr) => arr.indexOf(id) === idx);

    if (resizedBackdropIds.length > 0) {
      setNodes((currentNodes) => {
        let next = currentNodes;
        for (const bid of resizedBackdropIds) {
          const b = next.find((n) => n.id === bid && n.type === NodeType.BACKDROP);
          if (b) next = setBackdropChildrenFromGeometry(next, bid);
        }
        return next;
      });
    }

    if (deletedNodeIds.length > 0) {
      const edgesNow = getEdges();
      // 清理缩略图 + 源节点旧 taskId（防止 recovery/重跑把已删 MOV/OUTPUT 恢复回来）
      setNodes((currentNodes) => {
        const afterThumbs = currentNodes.map((node) => {
          const thumbnails = node.data.generatedThumbnails || [];
          if (thumbnails.length === 0) {
            return node;
          }
          const remainingThumbnails = thumbnails.filter((thumb) => {
            if (thumb.nodeId && deletedNodeIds.includes(thumb.nodeId)) {
              return false;
            }
            return true;
          });
          if (remainingThumbnails.length !== thumbnails.length) {
            return {
              ...node,
              data: {
                ...node.data,
                generatedThumbnails: remainingThumbnails.length > 0 ? remainingThumbnails : undefined,
              },
            };
          }
          return node;
        });
        const reconciled = reconcileSourceRunStateAfterOutputNodesRemoved(
          afterThumbs,
          edgesNow,
          deletedNodeIds
        );
        return reconciled.nodes;
      });
    }
  }, [onNodesChangeBase, setNodes, getEdges]);
  const [isDragOver, setIsDragOver] = useState(false);
  
  // State for Storyboard Images (Lifted from Sidebar)
  const [storyboardImages, setStoryboardImages] = useState<string[]>([]);

  const localMediaScope = useMemo(
    () => buildLocalMediaScope(chatStorageScope.userId, chatStorageScope.projectId),
    [chatStorageScope]
  );

  const saveRemoteWorkspaceNow = useCallback(async (
    graphOverride?: {
      nodes: RFNode[];
      edges: Edge[];
      storyboardImages?: string[];
    },
    options?: {
      force?: boolean;
      versionRetry?: boolean;
      allowEmptyGraph?: boolean;
      keepalive?: boolean;
      networkRetry?: boolean;
    }
  ) => {
    if (!serverProjectId) return;
    if (!getStoredUser()) return;
    if (!isEditorMountedRef.current && !options?.force) return;
    let nodesToSave = graphOverride?.nodes ?? getNodes();
    if (pendingRunPersistPatchesRef.current.size > 0) {
      nodesToSave = mergeRunPersistPatchesIntoNodes(
        nodesToSave,
        pendingRunPersistPatchesRef.current
      );
    }
    let edgesToSave = graphOverride?.edges ?? getEdges();
    let storyboardToSave = graphOverride?.storyboardImages ?? storyboardImages;
    let allowEmptyGraph = false;
    let graphIsIntentionallyEmpty = false;
    try {
      const vp = getViewport();
      const snapRef = latestRemoteGraphRef.current;
      // 仅防抖自动保存时防「卸载后误读空 getNodes」；离开页 force 或用户清空画布不恢复旧节点
      if (
        !options?.allowEmptyGraph &&
        !options?.force &&
        nodesToSave.length === 0 &&
        snapRef &&
        snapRef.nodes.length > 0
      ) {
        nodesToSave = snapRef.nodes;
        edgesToSave = snapRef.edges;
        storyboardToSave = snapRef.storyboardImages;
      }
      graphIsIntentionallyEmpty =
        nodesToSave.length === 0 && (!snapRef || snapRef.nodes.length === 0);
      allowEmptyGraph =
        !!options?.allowEmptyGraph ||
        (options?.force === true && nodesToSave.length === 0) ||
        graphIsIntentionallyEmpty;
      const snap = buildPersistSnapshot(nodesToSave, edgesToSave, storyboardToSave);
      const uid = getStoredUser()?.id || 'local';
      const chatByUser: Record<string, PersistedCanvasChatV1> = {};
      for (const [k, v] of Object.entries(chatByUserRef.current)) {
        chatByUser[k] = sanitizeChatForPersist(v) as PersistedCanvasChatV1;
      }
      if (latestChatSnapshotRef.current) {
        chatByUser[uid] = sanitizeChatForPersist(latestChatSnapshotRef.current) as PersistedCanvasChatV1;
      }
      const payload: FlowgenWorkspacePayloadV1 = {
        v: 1,
        graph: snap,
        viewport: { x: vp.x, y: vp.y, zoom: vp.zoom },
        chatByUser,
        projectName: projectName || '',
      };
      const sig = JSON.stringify({
        g: buildStructuralGraphSignature(snap.nodes, snap.edges, snap.storyboardImages),
        v: payload.viewport,
        c: Object.keys(chatByUser)
          .sort()
          .map((k) => [k, chatByUser[k]?.messages?.length ?? 0]),
        p: payload.projectName,
      });
      if (!options?.force && sig === lastRemoteWorkspaceSigRef.current) return;
      const putBody = {
        payload,
        version: workspaceVersionRef.current,
        ...(allowEmptyGraph ? { allowEmptyGraph: true } : {}),
      };
      if (
        options?.keepalive &&
        estimateJsonUtf8Bytes(putBody) > KEEPALIVE_FETCH_MAX_BODY_BYTES
      ) {
        // 大图离页 keepalive 必失败；flushOnLeave 已写 localStorage
        return;
      }
      const res = await putWorkspace(serverProjectId, {
        ...putBody,
        ...(options?.keepalive ? { keepalive: true } : {}),
      });
      workspaceVersionRef.current = res.version;
      lastRemoteWorkspaceSigRef.current = sig;
      try {
        writeProjectSnapshotToStorage(snap);
      } catch {
        /* ignore local snapshot failures */
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('空画布') || msg.includes('EMPTY_GRAPH_REJECTED')) {
        console.warn('[flowgen] workspace save rejected: empty graph would wipe project', e);
        return;
      }
      const transient =
        msg.includes('无法连接 FlowGen API') ||
        msg.toLowerCase() === 'failed to fetch' ||
        msg.toLowerCase().includes('network');
      if (transient && !options?.networkRetry && !options?.keepalive) {
        await new Promise((r) => setTimeout(r, 800));
        await saveRemoteWorkspaceNow(graphOverride, { ...options, networkRetry: true });
        return;
      }
      if (transient && options?.keepalive) {
        let localOk = false;
        try {
          const snap = buildPersistSnapshot(nodesToSave, edgesToSave, storyboardToSave);
          writeProjectSnapshotToStorage(snap);
          localOk = true;
        } catch {
          /* 服务端不可达时仍尝试落本地，刷新后可 mergeRunRecoveryFieldsFromLocalSnapshot */
        }
        if (!localOk) {
          console.warn('[flowgen] 离页保存失败：本地快照与服务端均未写入', msg);
        }
        return;
      }
      const conflict = msg === '版本冲突' || msg.includes('版本冲突');
      if (conflict && !options?.versionRetry) {
        try {
          const ws = await getWorkspace(serverProjectId);
          workspaceVersionRef.current = ws.version;
          const serverPayload = ws.payload as Partial<FlowgenWorkspacePayloadV1> | null;
          const serverNodeCount = Array.isArray(serverPayload?.graph?.nodes)
            ? serverPayload.graph.nodes.length
            : 0;
          const localNodeCount = nodesToSave.length;
          if (serverNodeCount > localNodeCount && !allowEmptyGraph) {
            console.warn(
              '[flowgen] workspace save skipped after conflict: server has more nodes',
              { serverNodeCount, localNodeCount }
            );
            window.dispatchEvent(
              new CustomEvent('flowgen:workspace-stale-conflict', {
                detail: { serverNodeCount, localNodeCount, serverVersion: ws.version },
              })
            );
            return;
          }
          await saveRemoteWorkspaceNow(graphOverride, { ...options, versionRetry: true });
          return;
        } catch (retryErr) {
          console.warn('[flowgen] workspace save retry after conflict failed', retryErr);
        }
      }
      console.warn('[flowgen] workspace save failed', e);
      if (graphOverride?.nodes?.length) {
        window.dispatchEvent(
          new CustomEvent('flowgen:workspace-save-failed', {
            detail: { message: msg },
          })
        );
      }
    }
  }, [
    serverProjectId,
    storyboardImages,
    projectName,
    getNodes,
    getEdges,
    getViewport,
  ]);

  saveRemoteWorkspaceNowRef.current = saveRemoteWorkspaceNow;

  const scheduleRemoteWorkspaceSave = useCallback(() => {
    if (!serverProjectId) return;
    if (!getStoredUser()) return;
    if (!isEditorMountedRef.current) return;
    if (remoteSaveTimerRef.current) clearTimeout(remoteSaveTimerRef.current);
    remoteSaveTimerRef.current = setTimeout(() => {
      remoteSaveTimerRef.current = null;
      if (!isEditorMountedRef.current) return;
      void saveRemoteWorkspaceNowRef.current();
    }, REMOTE_WORKSPACE_SAVE_DEBOUNCE_MS);
  }, [serverProjectId]);

  const flushRemoteWorkspaceSave = useCallback(
    (
      graphOverride?: {
        nodes: RFNode[];
        edges: Edge[];
        storyboardImages?: string[];
      },
      options?: {
        force?: boolean;
        versionRetry?: boolean;
        allowEmptyGraph?: boolean;
        keepalive?: boolean;
        networkRetry?: boolean;
      }
    ) => {
      if (!serverProjectId) return;
      if (remoteSaveTimerRef.current) {
        clearTimeout(remoteSaveTimerRef.current);
        remoteSaveTimerRef.current = null;
      }
      void saveRemoteWorkspaceNow(graphOverride, options);
    },
    [serverProjectId, saveRemoteWorkspaceNow]
  );

  const onCanvasChatSnapshot = useCallback(
    (body: PersistedCanvasChatV1) => {
      latestChatSnapshotRef.current = body;
      const uid = getStoredUser()?.id || 'local';
      chatByUserRef.current = { ...chatByUserRef.current, [uid]: body };
      scheduleRemoteWorkspaceSave();
    },
    [scheduleRemoteWorkspaceSave]
  );

  const hydratePersistedRemotePreviews = useCallback(() => {
    const edges = getEdges();
    setNodes((nds) => {
      const next = hydrateGraphMediaFromPersisted(nds, edges);
      return next.some((n, i) => n !== nds[i]) ? next : nds;
    });
  }, [getEdges, setNodes]);

  const hydrateLocalMediaPreviews = useCallback(async () => {
    const current = getNodes();
    const patches: Array<{ id: string; data: Partial<NodeData> }> = [];
    for (const n of current) {
      const nodePatch: Partial<NodeData> = {};
      const boundAsset = (n.data as NodeData & { projectAssetId?: string }).projectAssetId;
      const model = String(n.data.selectedModel || 'default').trim();
      const migrateRefToModelScoped = async (
        curRef: string,
        kind: 'main' | 'firstFrame' | 'lastFrame' | 'ref',
        refIndex = 0,
        omniRefField?: PanelReferenceLocalRefField
      ): Promise<string | undefined> => {
        if (model === '可灵3.0 Omni') {
          if (kind === 'ref' && omniRefField) {
            const tab = klingOmniTabFromReferenceLocalRefField(omniRefField);
            if (tab) {
              const targetRef = buildKlingOmniReferenceLocalRefForTab(
                localMediaScope,
                n.id,
                tab,
                refIndex
              );
              if (curRef === targetRef) return undefined;
              const legacy =
                isLegacyReferenceLocalRef(curRef) ||
                isLegacyKlingOmniSharedReferenceLocalRef(curRef) ||
                curRef === buildReferenceLocalRefForModel(localMediaScope, n.id, model, refIndex);
              if (!legacy) return undefined;
              const blob = await getLocalMediaBlob(curRef);
              if (blob) await putLocalMediaFile(targetRef, blob);
              return targetRef;
            }
          }
          if (kind === 'main') {
            const targetRef = buildMainLocalRefForModel(localMediaScope, n.id, model);
            if (curRef === targetRef) return undefined;
            const legacy =
              isLegacyMainLocalRef(curRef) ||
              isLegacyKlingOmniSharedMainLocalRef(curRef) ||
              isKlingOmniTabScopedMainLocalRef(curRef);
            if (!legacy) return undefined;
            const blob = await getLocalMediaBlob(curRef);
            if (blob) await putLocalMediaFile(targetRef, blob);
            return targetRef;
          }
          if (kind === 'firstFrame' || kind === 'lastFrame') {
            const targetRef = buildKlingOmniFrameLocalRefForTab(localMediaScope, n.id, kind);
            if (curRef === targetRef) return undefined;
            const legacy =
              isLegacyFrameLocalRef(curRef) ||
              isLegacyKlingOmniSharedFrameLocalRef(curRef) ||
              curRef === buildFrameLocalRefForModel(localMediaScope, n.id, kind, model);
            if (!legacy) return undefined;
            const blob = await getLocalMediaBlob(curRef);
            if (blob) await putLocalMediaFile(targetRef, blob);
            return targetRef;
          }
          return undefined;
        }
        if (usesUnifiedSeedance20PanelLocalRef(model)) {
          const sharedRef =
            kind === 'main'
              ? buildLocalMediaRef(localMediaScope, n.id, 'main')
              : kind === 'ref'
                ? buildLocalMediaRef(localMediaScope, n.id, 'ref', refIndex)
                : buildLocalMediaRef(localMediaScope, n.id, kind);
          if (curRef === sharedRef) return undefined;
          const blob = await getLocalMediaBlob(curRef);
          if (blob) await putLocalMediaFile(sharedRef, blob);
          return sharedRef;
        }
        const targetRef =
          kind === 'main'
            ? buildMainLocalRefForModel(localMediaScope, n.id, model)
            : kind === 'ref'
              ? buildReferenceLocalRefForModel(localMediaScope, n.id, model, refIndex)
              : buildModelScopedFrameLocalRef(localMediaScope, n.id, kind, model);
        if (curRef === targetRef) return undefined;
        const isLegacy =
          kind === 'main'
            ? isLegacyMainLocalRef(curRef)
            : kind === 'ref'
              ? isLegacyReferenceLocalRef(curRef)
              : isLegacyFrameLocalRef(curRef);
        if (!isLegacy) return undefined;
        const blob = await getLocalMediaBlob(curRef);
        if (blob) await putLocalMediaFile(targetRef, blob);
        return targetRef;
      };

      for (const slot of ['firstFrame', 'lastFrame'] as const) {
        const refKey = slot === 'firstFrame' ? 'firstFrameLocalRef' : 'lastFrameLocalRef';
        const curRef = String(n.data[refKey] || '').trim();
        if (!curRef) continue;
        const migrated = await migrateRefToModelScoped(curRef, slot);
        if (migrated) nodePatch[refKey] = migrated;
      }

      if (!boundAsset && n.data.imageLocalRef) {
        const mainRef = String(n.data.imageLocalRef || '').trim();
        if (mainRef) {
          const migratedMain = await migrateRefToModelScoped(mainRef, 'main');
          if (migratedMain) nodePatch.imageLocalRef = migratedMain;
        }
      }

      const refLocalFields: PanelReferenceLocalRefField[] = [
        'referenceImageLocalRefs',
        'klingOmniMultiReferenceLocalRefs',
        'klingOmniInstructionReferenceLocalRefs',
        'klingOmniVideoReferenceLocalRefs',
      ];
      for (const field of refLocalFields) {
        const localRefs = [...((n.data[field] as string[] | undefined) || [])];
        let fieldChanged = false;
        for (let i = 0; i < localRefs.length; i++) {
          const curRef = String(localRefs[i] || '').trim();
          if (!curRef) continue;
          const migrated = await migrateRefToModelScoped(curRef, 'ref', i, field);
          if (migrated) {
            localRefs[i] = migrated;
            fieldChanged = true;
          }
        }
        if (fieldChanged) nodePatch[field] = localRefs as NodeData[typeof field];
      }

      if (!boundAsset) {
        const ref = n.data.imageLocalRef;
        if (ref) {
          if (
            !shouldPreferRunReferencePreviewOverLocalMain(n.data) &&
            (!n.data.imagePreview || isEphemeralMediaUrl(n.data.imagePreview, 'imagePreview'))
          ) {
            const blob = await getLocalMediaBlob(ref);
            if (blob) nodePatch.imagePreview = URL.createObjectURL(blob);
          }
        }
        // 首尾帧 hydrate 由 hydrateAllPanelReferenceLocalRefs 统一处理（与多图参考同一机制）
      }
      const panelRefPatch = await hydrateAllPanelReferenceLocalRefs({ ...n.data, ...nodePatch });
      if (panelRefPatch) Object.assign(nodePatch, panelRefPatch);
      if (Object.keys(nodePatch).length > 0) {
        patches.push({ id: n.id, data: nodePatch });
      }
    }
    if (patches.length === 0) return;
    setNodes((nds) =>
      nds.map((n) => {
        const p = patches.find((x) => x.id === n.id);
        if (!p) return n;
        const next = { ...n.data };
        if (p.data.imagePreview) {
          revokeBlobPreviewUrl(n.data.imagePreview);
          next.imagePreview = p.data.imagePreview;
        }
        if (p.data.firstFrameImage) {
          revokeBlobPreviewUrl(n.data.firstFrameImage);
          next.firstFrameImage = p.data.firstFrameImage;
        }
        if (p.data.lastFrameImage) {
          revokeBlobPreviewUrl(n.data.lastFrameImage);
          next.lastFrameImage = p.data.lastFrameImage;
        }
        if (p.data.panelMainImageUrl) {
          revokeBlobPreviewUrl(n.data.panelMainImageUrl);
          next.panelMainImageUrl = p.data.panelMainImageUrl;
        }
        if (p.data.referenceImages) {
          // 仅 revoke 被替换的旧 blob URL（保留新数组中仍存在的 blob:，避免误回收未变化槽）
          const newRefs = p.data.referenceImages;
          const kept = new Set(newRefs.filter((u) => u && u.startsWith('blob:')));
          (n.data.referenceImages || []).forEach((u) => {
            if (u && u.startsWith('blob:') && !kept.has(u)) revokeBlobPreviewUrl(u);
          });
          next.referenceImages = newRefs;
        }
        if (p.data.klingOmniMultiReferenceImages) {
          const newRefs = p.data.klingOmniMultiReferenceImages;
          const kept = new Set(newRefs.filter((u) => u && u.startsWith('blob:')));
          (n.data.klingOmniMultiReferenceImages || []).forEach((u) => {
            if (u && u.startsWith('blob:') && !kept.has(u)) revokeBlobPreviewUrl(u);
          });
          next.klingOmniMultiReferenceImages = newRefs;
        }
        if (p.data.klingOmniInstructionReferenceImages) {
          const newRefs = p.data.klingOmniInstructionReferenceImages;
          const kept = new Set(newRefs.filter((u) => u && u.startsWith('blob:')));
          (n.data.klingOmniInstructionReferenceImages || []).forEach((u) => {
            if (u && u.startsWith('blob:') && !kept.has(u)) revokeBlobPreviewUrl(u);
          });
          next.klingOmniInstructionReferenceImages = newRefs;
        }
        if (p.data.klingOmniVideoReferenceImages) {
          const newRefs = p.data.klingOmniVideoReferenceImages;
          const kept = new Set(newRefs.filter((u) => u && u.startsWith('blob:')));
          (n.data.klingOmniVideoReferenceImages || []).forEach((u) => {
            if (u && u.startsWith('blob:') && !kept.has(u)) revokeBlobPreviewUrl(u);
          });
          next.klingOmniVideoReferenceImages = newRefs;
        }
        return { ...n, data: next };
      })
    );
    for (const p of patches) {
      const node = current.find((x) => x.id === p.id);
      if (!node) continue;
      if (node.data.imageLocalRef) {
        const f = await getLocalMediaFile(node.data.imageLocalRef);
        if (f) getOriginals(p.id).main = f;
      }
      if (node.data.firstFrameLocalRef) {
        const f = await getLocalMediaFile(node.data.firstFrameLocalRef);
        if (f) getOriginals(p.id).firstFrame = f;
      }
      if (node.data.lastFrameLocalRef) {
        const f = await getLocalMediaFile(node.data.lastFrameLocalRef);
        if (f) getOriginals(p.id).lastFrame = f;
      }
      const refLocalFields: PanelReferenceLocalRefField[] = [
        'referenceImageLocalRefs',
        'klingOmniMultiReferenceLocalRefs',
        'klingOmniInstructionReferenceLocalRefs',
        'klingOmniVideoReferenceLocalRefs',
      ];
      for (const field of refLocalFields) {
        const refs = node.data[field];
        if (!Array.isArray(refs)) continue;
        for (let i = 0; i < refs.length; i++) {
          const localRef = String(refs[i] || '').trim();
          if (!localRef) continue;
          const f = await getLocalMediaFile(localRef);
          if (!f) continue;
          const bucket = getOriginals(p.id).referenceImages || [];
          while (bucket.length <= i) bucket.push(undefined as unknown as File);
          bucket[i] = f;
          getOriginals(p.id).referenceImages = bucket;
        }
      }
    }
  }, [getNodes, setNodes]);

  const attachLocalMainRef = useCallback(
    async (nodeId: string, file: File) => {
      const existing = getNodes().find((n) => n.id === nodeId);
      const existingData = existing?.data as NodeData & { projectAssetId?: string };
      if (existingData?.projectAssetId) return;
      if (
        existingData?.imagePreview &&
        isProjectAssetLibraryImageUrl(existingData.imagePreview)
      ) {
        return;
      }
      const ref = buildMainLocalRefForModel(
        localMediaScope,
        nodeId,
        String(existingData?.selectedModel || 'default').trim()
      );
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId
            ? {
                ...n,
                data: {
                  ...n.data,
                  imageLocalRef: ref,
                  imageName: file.name || n.data.imageName,
                },
              }
            : n
        )
      );
      try {
        await putLocalMediaFile(ref, file);
        getOriginals(nodeId).main = file;
        window.dispatchEvent(new CustomEvent('flowgen:persist-request'));
        if (serverProjectId) scheduleRemoteWorkspaceSave();
      } catch (e) {
        console.warn('[flowgen] local media IDB write failed', e);
      }
    },
    [getNodes, localMediaScope, setNodes, serverProjectId, scheduleRemoteWorkspaceSave]
  );

  const attachLocalFrameRef = useCallback(
    async (nodeId: string, file: File, slot: 'firstFrame' | 'lastFrame') => {
      const node = getNodes().find((n) => n.id === nodeId);
      const model = String(node?.data?.selectedModel || 'default').trim();
      const ref = isKlingOmniModel(model)
        ? buildKlingOmniFrameLocalRefForTab(localMediaScope, nodeId, slot)
        : buildFrameLocalRefForModel(localMediaScope, nodeId, slot, model);
      const refKey = slot === 'firstFrame' ? 'firstFrameLocalRef' : 'lastFrameLocalRef';
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId
            ? {
                ...n,
                data: {
                  ...n.data,
                  [refKey]: ref,
                },
              }
            : n
        )
      );
      try {
        await putLocalMediaFile(ref, file);
        const o = getOriginals(nodeId);
        if (slot === 'firstFrame') o.firstFrame = file;
        else o.lastFrame = file;
        window.dispatchEvent(new CustomEvent('flowgen:persist-request'));
        if (serverProjectId) scheduleRemoteWorkspaceSave();
      } catch (e) {
        console.warn('[flowgen] local frame IDB write failed', e);
      }
    },
    [localMediaScope, setNodes, serverProjectId, scheduleRemoteWorkspaceSave]
  );

  const attachLocalReferenceRefs = useCallback(
    async (
      nodeId: string,
      startIndex: number,
      files: File[],
      localRefField: PanelReferenceLocalRefField = 'referenceImageLocalRefs'
    ) => {
      if (files.length === 0) return [];
      const existing = getNodes().find((n) => n.id === nodeId);
      const existingData = existing?.data as NodeData & { projectAssetId?: string };
      if (existingData?.projectAssetId) return [];
      const model = String(existingData?.selectedModel || 'default').trim();
      const omniTab = klingOmniTabFromReferenceLocalRefField(localRefField);
      let nextLocalRefs = [...(existingData?.[localRefField] || [])];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!(file instanceof File)) continue;
        const slotIndex = startIndex + i;
        const ref =
          isKlingOmniModel(model) && omniTab
            ? buildKlingOmniReferenceLocalRefForTab(localMediaScope, nodeId, omniTab, slotIndex)
            : buildReferenceLocalRefForModel(localMediaScope, nodeId, model, slotIndex);
        try {
          await putLocalMediaFile(ref, file);
          nextLocalRefs = setReferenceImageLocalRefAtIndex(nextLocalRefs, slotIndex, ref);
          const o = getOriginals(nodeId);
          const bucket = o.referenceImages || [];
          while (bucket.length <= slotIndex) bucket.push(undefined as unknown as File);
          bucket[slotIndex] = file;
          o.referenceImages = bucket;
        } catch (e) {
          console.warn('[flowgen] local reference media IDB write failed', e);
        }
      }
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== nodeId) return n;
          const existing = [...((n.data[localRefField] as string[] | undefined) || [])];
          const merged = [...existing];
          const maxLen = Math.max(merged.length, nextLocalRefs.length);
          while (merged.length < maxLen) merged.push('');
          for (let i = 0; i < nextLocalRefs.length; i++) {
            const v = String(nextLocalRefs[i] || '').trim();
            if (v) merged[i] = v;
          }
          nextLocalRefs = merged;
          return {
            ...n,
            data: {
              ...n.data,
              [localRefField]: merged,
            },
          };
        })
      );
      window.dispatchEvent(new CustomEvent('flowgen:persist-request'));
      if (serverProjectId) scheduleRemoteWorkspaceSave();
      return nextLocalRefs;
    },
    [getNodes, localMediaScope, setNodes, serverProjectId, scheduleRemoteWorkspaceSave]
  );

  /** 资产库拖放 /「创建节点」：在画布指定 flow 坐标批量新建图片或视频节点 */
  const createNodesFromAssetItems = useCallback(
    async (base: { x: number; y: number }, items: FlowgenAssetDragItem[]) => {
      if (items.length === 0) return;

      const currentCount = getNodes().length;
      const room = FLOW_MAX_PERSISTED_NODES - currentCount;
      if (room <= 0) {
        alert(`节点数量已达上限（${FLOW_MAX_PERSISTED_NODES}），无法继续添加`);
        return;
      }
      const batch = items.slice(0, room);
      if (batch.length < items.length) {
        alert(
          `节点上限 ${FLOW_MAX_PERSISTED_NODES}，当前 ${currentCount} 个，仅创建前 ${batch.length} 个素材节点`
        );
      }

      const NODE_OFFSET = 48;
      const CONCURRENCY = 4;
      const built: Array<{ node: RFNode; file: File | null }> = [];

      if (batch.length >= 3) {
        suppressHistoryUntilRef.current = Date.now() + 3200;
      }

      try {
        for (let start = 0; start < batch.length; start += CONCURRENCY) {
          const chunk = batch.slice(start, start + CONCURRENCY);
          const chunkBuilt = await Promise.all(
            chunk.map(async (item, j) => {
              const index = start + j;
              const isVid =
                item.mime.startsWith('video/') ||
                /\.(mov|mp4|webm|avi|mkv|flv|wmv|m4v)(\?|$)/i.test(item.url) ||
                /video/i.test(item.url);
              const nodeId = getId();
              const fileName = item.assetName || (isVid ? 'asset.mp4' : 'asset.png');
              const assetUrl = item.url?.trim() || '';
              const assetProjectId =
                serverProjectId ||
                parseProjectAssetIdsFromMediaUrl(assetUrl)?.projectId ||
                '';
              const canonicalFile = resolveCanonicalProjectAssetPreviewUrl(
                assetUrl,
                assetProjectId || undefined,
                item.assetId
              );
              const fetchUrl = canonicalFile || assetUrl;

              let preview: string;
              let file: File | null = null;

              if (isVid) {
                preview =
                  isPersistableMediaUrl(fetchUrl) ? fetchUrl : URL.createObjectURL(await getAssetFileBlob(fetchUrl));
                void getAssetFileBlob(fetchUrl)
                  .then((blob) => {
                    getOriginals(nodeId).main = new File([blob], fileName, {
                      type: blob.type || 'video/mp4',
                    });
                  })
                  .catch(() => {});
              } else if (canonicalFile || (item.assetId && assetProjectId)) {
                preview =
                  canonicalFile ||
                  resolveCanonicalProjectAssetPreviewUrl(
                    undefined,
                    assetProjectId,
                    item.assetId
                  );
                void getAssetFileBlob(preview)
                  .then((blob) => {
                    getOriginals(nodeId).main = new File([blob], fileName, {
                      type: blob.type || 'image/png',
                    });
                  })
                  .catch(() => {});
              } else if (item.assetId) {
                throw new Error(`无法解析素材 ${item.assetId} 的资产库路径，请从项目列表进入工作区后重试`);
              } else {
                const blob = await getAssetFileBlob(item.url);
                file = new File([blob], fileName, {
                  type: blob.type || 'image/png',
                });
                preview = await prepareCanvasNodeImagePreview(file);
              }

              const boundData = normalizeTemplateNodeDataForSpawn(
                {
                  label: isVid ? 'Output Mov Node' : 'Input Picture Node',
                  imagePreview: preview,
                  imageName: fileName,
                  projectAssetId: item.assetId,
                  selectedModel: MODEL_NANO_BANANA_2,
                  status: 'idle',
                  imageLocalRef: undefined,
                },
                assetProjectId || serverProjectId || undefined
              );

              const node: RFNode = {
                id: nodeId,
                type: isVid ? NodeType.MOV : NodeType.PROCESSOR,
                position: {
                  x: base.x + index * NODE_OFFSET,
                  y: base.y + index * NODE_OFFSET,
                },
                data: boundData,
                selected: true,
              };
              return { node, file: item.assetId ? null : file };
            })
          );
          built.push(...chunkBuilt);
        }

        const newNodes = built.map((x) => x.node);
        const mergedNodes = [
          ...getNodes().map((n) => (n.selected ? { ...n, selected: false } : n)),
          ...newNodes,
        ];
        const currentEdges = getEdges();

        if (newNodes.length >= 10) {
          hydrateGraphWithLazyReveal(
            mergedNodes,
            currentEdges,
            newNodes.map((n) => n.id),
            setNodes,
            setEdges
          );
        } else {
          setNodes(mergedNodes);
        }

        for (const { node, file } of built) {
          if (file && !(node.data as NodeData & { projectAssetId?: string }).projectAssetId) {
            void attachLocalMainRef(node.id, file);
          }
        }
        setTimeout(() => window.dispatchEvent(new CustomEvent('flowgen:persist-request')), 300);
        scheduleRemoteWorkspaceSave();
      } catch {
        alert('无法从资产库创建节点，请确认已登录且素材文件可访问');
      }
    },
    [getNodes, setNodes, attachLocalMainRef, scheduleRemoteWorkspaceSave, serverProjectId]
  );

  const [graphHydrationReady, setGraphHydrationReady] = useState(false);

  const recoveryWatchKey = useMemo(
    () =>
      nodes
        .map((n) => {
          const taskId = String(n.data?.taskId || n.data?.generationParams?.taskId || '').trim();
          return [
            n.id,
            taskId,
            n.data?.status || '',
            n.data?.runRecoveryPending ? '1' : '0',
          ].join(':');
        })
        .join('|'),
    [nodes]
  );

  useAiTopRunRecovery({
    graphHydrationReady,
    recoveryWatchKey,
    getNodes,
    getEdges,
    setNodes,
    setEdges,
    createNodeId: getId,
    onPersistRequest: () => window.dispatchEvent(new CustomEvent('flowgen:persist-request')),
    isNodeLiveRunActive: (nodeId) => activeRunIdsRef.current.has(nodeId),
  });

  // Undo/Redo History
  interface HistoryState {
    nodes: RFNode[];
    edges: Edge[];
    storyboardImages: string[];
  }
  const [history, setHistory] = useState<HistoryState[]>([{
    nodes: initialNodes,
    edges: initialEdges,
    storyboardImages: []
  }]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const historyIndexRef = useRef(0); // 使用 ref 存储当前索引，避免闭包问题
  const isUndoRedoRef = useRef(false); // 标记是否正在执行撤销/重做，避免触发历史记录保存

  // Auto-save to localStorage（按用户 + 项目隔离，见 STORAGE_KEY 等 useMemo）
  const LAST_SELECTED_NODE_KEY = 'flowgen-last-selected-node-id';
  const RUNTIME_CRASH_LOG_KEY = 'flowgen-runtime-crash-log';
  /** 仅最后一条，同步写入；localStorage 满或整页崩溃前便于 DevTools / Application 查看 */
  const RUNTIME_CRASH_LAST_KEY = 'flowgen-runtime-crash-last';
  const persistedViewportRef = useRef<FlowViewportSnapshot | null>(
    readPersistedViewport(LAST_VIEWPORT_KEY, legacyViewportKey)
  );
  const [shouldFitViewOnInit] = useState(() => !persistedViewportRef.current);
  const isInitialLoadRef = useRef(true);
  const hasLoadedRef = useRef(false);
  /** 本页 FlowEditor 正在 handleNodeRun 轮询的节点 id（避免 useAiTopRunRecovery 重复抢状态） */
  const activeRunIdsRef = useRef(new Set<string>());
  /** taskId / runRecovery* 写入 React 状态前，先同步进下一次 persist 快照（避免 force persist 竞态丢 taskId） */
  const pendingRunPersistPatchesRef = useRef(new Map<string, Partial<NodeData>>());
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const historySaveTimeoutRef = useRef<NodeJS.Timeout | null>(null); // 历史记录防抖，避免图片/节点多时频繁深拷贝卡顿
  const persistRequestTimeoutRef = useRef<number | null>(null); // 合批立即持久化请求，避免 poster/缩略图短时间内频繁整图序列化
  const lastHistoryStructuralSigRef = useRef<string>('');
  const lastHistoryStructuralSigExclPositionRef = useRef<string>('');
  const lastPersistStructuralSigRef = useRef<string>('');
  const lastHistoryNodesSourceRef = useRef<RFNode[] | null>(null);
  const lastHistoryEdgesSourceRef = useRef<Edge[] | null>(null);
  const lastHistoryNodesCloneRef = useRef<RFNode[] | null>(null);
  const lastHistoryEdgesCloneRef = useRef<Edge[] | null>(null);
  const hasShownStorageWarningRef = useRef(false); // 标记是否已显示过存储警告
  const hasUnsavedManualChangesRef = useRef(false);
  const lastManualSaveAtRef = useRef(Date.now());
  const lastManualSaveReminderAtRef = useRef(0);
  const dragPerfModeDepthRef = useRef(0);
  /** 分镜表批量建节点后短暂跳过撤销深拷贝，避免紧接着拖画布时主线程卡死 */
  const suppressHistoryUntilRef = useRef(0);
  const lastProjectSnapshotSerializedRef = useRef<string>('');
  const lastViewportSerializedRef = useRef<string>('');
  const lastSelectedNodeIdPersistedRef = useRef<string | null>(null);
  const lastCrashLogDownloadAtRef = useRef(0);
  const [isDragPerformanceMode, setIsDragPerformanceMode] = useState(false);
  /** Phase1：暂停富预览异步刷新（poster/缩略图/LOD）；Phase2 高级：另暂停 history/自动保存 */
  const [isCanvasRefreshPaused, setIsCanvasRefreshPaused] = useState(false);
  const [isCanvasPerfAdvanced, setIsCanvasPerfAdvanced] = useState(false);
  const isGraphSideEffectPaused =
    isDragPerformanceMode || (isCanvasRefreshPaused && isCanvasPerfAdvanced);
  const isGraphSideEffectPausedRef = useRef(false);
  useEffect(() => {
    isGraphSideEffectPausedRef.current = isGraphSideEffectPaused;
  }, [isGraphSideEffectPaused]);
  const [showManualSaveReminder, setShowManualSaveReminder] = useState(false);

  const writeProjectSnapshotToStorage = useCallback((payload: { nodes: RFNode[]; edges: Edge[]; storyboardImages: string[]; savedAt: string }) => {
    const serialized = profileSync('persist-snapshot-stringify', () => JSON.stringify(payload), {
      nodes: payload.nodes.length,
      edges: payload.edges.length,
      storyboard: payload.storyboardImages.length,
    });
    if (serialized === lastProjectSnapshotSerializedRef.current) return;
    try {
      const currentPrimary = localStorage.getItem(STORAGE_KEY);
      if (currentPrimary && currentPrimary !== serialized) {
        localStorage.setItem(STORAGE_BACKUP_KEY, currentPrimary);
      }
    } catch {
      /* ignore backup promotion failures */
    }
    localStorage.setItem(STORAGE_KEY, serialized);
    lastProjectSnapshotSerializedRef.current = serialized;
  }, [STORAGE_KEY, STORAGE_BACKUP_KEY]);

  const persistImportedGraphSnapshot = useCallback(
    (nodes: RFNode[], edges: Edge[], images: string[]) => {
      const snap = buildPersistSnapshot(nodes, edges, images);
      try {
        writeProjectSnapshotToStorage(snap);
      } catch {
        /* ignore local quota */
      }
      lastRemoteWorkspaceSigRef.current = '';
      flushRemoteWorkspaceSave(
        { nodes: snap.nodes as RFNode[], edges: snap.edges, storyboardImages: snap.storyboardImages },
        { force: true }
      );
    },
    [flushRemoteWorkspaceSave, writeProjectSnapshotToStorage]
  );

  const writeViewportToStorage = useCallback((viewport: FlowViewportSnapshot) => {
    persistedViewportRef.current = viewport;
    try {
      const serialized = JSON.stringify(viewport);
      if (serialized === lastViewportSerializedRef.current) return;
      localStorage.setItem(LAST_VIEWPORT_KEY, serialized);
      lastViewportSerializedRef.current = serialized;
    } catch {
      /* ignore viewport persistence failures */
    }
  }, [LAST_VIEWPORT_KEY]);
  const triggerCrashLogDownload = useCallback((kind: 'window-error' | 'unhandled-rejection', item: Record<string, unknown>) => {
    try {
      const now = Date.now();
      // 防止同一轮崩溃级联触发时连续下载多个文件
      if (now - lastCrashLogDownloadAtRef.current < 15000) return;
      lastCrashLogDownloadAtRef.current = now;
      const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
      const filename = `flowgen-crash-${kind}-${stamp}.json`;
      const content = JSON.stringify(item, null, 2);
      const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      requestAnimationFrame(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      });
    } catch {
      /* ignore crash log file download failures */
    }
  }, []);
  const appendRuntimeCrashLog = useCallback((kind: 'window-error' | 'unhandled-rejection', payload: Record<string, unknown>) => {
    const nextItem = {
      ts: new Date().toISOString(),
      kind,
      payload,
    };
    // 同步输出：不依赖存储/下载；只要 DevTools 曾打开且保留日志，崩溃后仍可能看到
    try {
      console.error(`[FlowGen:crash] ${kind}`, payload);
    } catch {
      /* ignore */
    }
    try {
      sessionStorage.setItem(RUNTIME_CRASH_LAST_KEY, JSON.stringify(nextItem));
    } catch {
      /* ignore */
    }
    try {
      const prevRaw = localStorage.getItem(RUNTIME_CRASH_LOG_KEY);
      const prev = prevRaw ? JSON.parse(prevRaw) : [];
      const merged = Array.isArray(prev) ? [...prev, nextItem].slice(-80) : [nextItem];
      localStorage.setItem(RUNTIME_CRASH_LOG_KEY, JSON.stringify(merged));
      triggerCrashLogDownload(kind, nextItem);
    } catch {
      /* ignore crash log write failures */
    }
  }, [triggerCrashLogDownload]);
  const restoreViewportFromStorage = useCallback((delayMs = 0) => {
    const apply = () => {
      const viewport = persistedViewportRef.current || readPersistedViewport(LAST_VIEWPORT_KEY);
      if (!viewport) return;
      persistedViewportRef.current = viewport;
      window.requestAnimationFrame(() => {
        setViewport(viewport, { duration: 0 });
      });
    };
    if (delayMs > 0) {
      window.setTimeout(apply, delayMs);
      return;
    }
    apply();
  }, [setViewport]);
  
  // Undo function
  const handleUndo = useCallback(() => {
    const currentIndex = historyIndexRef.current;
    if (currentIndex > 0) {
      setHistory((prevHistory) => {
        const prevState = prevHistory[currentIndex - 1];
        isUndoRedoRef.current = true;
        setNodes(prevState.nodes);
        setEdges(prevState.edges);
        setStoryboardImages(prevState.storyboardImages);
        setHistoryIndex(currentIndex - 1);
        historyIndexRef.current = currentIndex - 1;
        return prevHistory;
      });
    }
  }, [setNodes, setEdges]);

  // Redo function
  const handleRedo = useCallback(() => {
    const currentIndex = historyIndexRef.current;
    setHistory((prevHistory) => {
      if (currentIndex < prevHistory.length - 1) {
        const nextState = prevHistory[currentIndex + 1];
        isUndoRedoRef.current = true;
        setNodes(nextState.nodes);
        setEdges(nextState.edges);
        setStoryboardImages(nextState.storyboardImages);
        setHistoryIndex(currentIndex + 1);
        historyIndexRef.current = currentIndex + 1;
      }
      return prevHistory;
    });
  }, [setNodes, setEdges]);

  // Save history when nodes or edges change - 节点多时延长防抖，避免整图深拷贝阻塞主线程
  useEffect(() => {
    if (isInitialLoadRef.current || !hasLoadedRef.current) return;
    // 拖拽中位置变化高频，先跳过；拖拽结束后会自动补入一次历史快照。
    if (isGraphSideEffectPaused) return;
    if (Date.now() < suppressHistoryUntilRef.current) return;
    if (isUndoRedoRef.current) {
      isUndoRedoRef.current = false;
      return;
    }
    const historyDebounceMs =
      nodes.length > 24 ? 1600 : nodes.length > 12 ? 1000 : 400;
    if (historySaveTimeoutRef.current) clearTimeout(historySaveTimeoutRef.current);
    historySaveTimeoutRef.current = setTimeout(() => {
      historySaveTimeoutRef.current = null;
      try {
        const structuralSig = buildStructuralGraphSignature(nodes, edges, storyboardImages);
        if (structuralSig === lastHistoryStructuralSigRef.current) return;

        const structuralSigExclPos = buildStructuralGraphSignatureExcludingPosition(
          nodes,
          edges,
          storyboardImages
        );
        const positionOnly =
          structuralSigExclPos === lastHistoryStructuralSigExclPositionRef.current &&
          lastHistoryStructuralSigExclPositionRef.current.length > 0;

        if (positionOnly) {
          const liveById = new Map(nodes.map((n) => [n.id, n]));
          setHistory((prevHistory) => {
            const currentIndex = historyIndexRef.current;
            const snap = prevHistory[currentIndex];
            if (!snap) return prevHistory;
            const patchedNodes = snap.nodes.map((sn) => {
              const live = liveById.get(sn.id);
              if (!live) return sn;
              return {
                ...sn,
                position: live.position,
                positionAbsolute: live.positionAbsolute,
                dragging: live.dragging,
              };
            });
            const next = [...prevHistory];
            next[currentIndex] = { ...snap, nodes: patchedNodes };
            lastHistoryNodesCloneRef.current = patchedNodes;
            lastHistoryNodesSourceRef.current = nodes;
            return next;
          });
          lastHistoryStructuralSigRef.current = structuralSig;
          return;
        }

        const clonedNodes =
          lastHistoryNodesSourceRef.current === nodes && lastHistoryNodesCloneRef.current
            ? lastHistoryNodesCloneRef.current
            : profileSync(
                'history-clone-nodes',
                () => JSON.parse(JSON.stringify(nodes)),
                { nodes: nodes.length }
              );
        const clonedEdges =
          lastHistoryEdgesSourceRef.current === edges && lastHistoryEdgesCloneRef.current
            ? lastHistoryEdgesCloneRef.current
            : profileSync(
                'history-clone-edges',
                () => JSON.parse(JSON.stringify(edges)),
                { edges: edges.length }
              );
        lastHistoryNodesSourceRef.current = nodes;
        lastHistoryEdgesSourceRef.current = edges;
        lastHistoryNodesCloneRef.current = clonedNodes;
        lastHistoryEdgesCloneRef.current = clonedEdges;
        const currentState: HistoryState = {
          nodes: clonedNodes,
          edges: clonedEdges,
          storyboardImages: [...storyboardImages],
        };
        setHistory((prevHistory) => {
          const currentIndex = historyIndexRef.current;
          const newHistory = prevHistory.slice(0, currentIndex + 1);
          newHistory.push(currentState);
          let newIndex = newHistory.length - 1;
          if (newHistory.length > FLOW_MAX_UNDO_HISTORY) {
            newHistory.shift();
            newIndex = newHistory.length - 1;
          }
          historyIndexRef.current = newIndex;
          return newHistory;
        });
        lastHistoryStructuralSigRef.current = structuralSig;
        lastHistoryStructuralSigExclPositionRef.current = structuralSigExclPos;
      } catch (e) {
      }
    }, historyDebounceMs);
    return () => {
      if (historySaveTimeoutRef.current) clearTimeout(historySaveTimeoutRef.current);
    };
  }, [nodes, edges, storyboardImages, isGraphSideEffectPaused]);

  useEffect(() => {
    if (isInitialLoadRef.current || !hasLoadedRef.current) return;
    if (!serverProjectId) return;
    const snap = buildPersistSnapshot(
      mergeRunPersistPatchesIntoNodes(nodes, pendingRunPersistPatchesRef.current),
      edges,
      storyboardImages
    );
    latestRemoteGraphRef.current = {
      nodes: snap.nodes as RFNode[],
      edges: snap.edges,
      storyboardImages: snap.storyboardImages,
    };
  }, [nodes, edges, storyboardImages, serverProjectId]);

  useEffect(() => {
    if (!serverProjectId || isInitialLoadRef.current || !hasLoadedRef.current) return;
    if (isGraphSideEffectPaused) return;
    scheduleRemoteWorkspaceSave();
  }, [nodes, edges, storyboardImages, serverProjectId, isGraphSideEffectPaused, scheduleRemoteWorkspaceSave]);

  useEffect(() => {
    if (!serverProjectId) return;
    isEditorMountedRef.current = true;
    const flushOnLeave = (mode: 'hide' | 'unload') => {
      window.dispatchEvent(new CustomEvent('flowgen:flush-canvas-chat'));
      const nodes = getNodes();
      const edges = getEdges();
      const lastSnap = latestRemoteGraphRef.current;
      const hasHydrated = hasLoadedRef.current || graphHydrationReady;
      const shouldUseSnap =
        nodes.length === 0 &&
        !!lastSnap &&
        lastSnap.nodes.length > 0 &&
        lastSnap.edges.length >= 0;
      // 尚未完成水合时不要把“空图”写回服务端，避免强制刷新连击导致工作区被空覆盖
      if (!hasHydrated && nodes.length === 0 && !shouldUseSnap) return;
      const nodesToSave = shouldUseSnap ? lastSnap.nodes : nodes;
      const edgesToSave = shouldUseSnap ? lastSnap.edges : edges;
      const storyboardToSave = shouldUseSnap ? lastSnap.storyboardImages : storyboardImages;
      const mergedNodes = mergeRunPersistPatchesIntoNodes(
        nodesToSave,
        pendingRunPersistPatchesRef.current
      );
      const snap = buildPersistSnapshot(mergedNodes, edgesToSave, storyboardToSave);
      try {
        writeProjectSnapshotToStorage(snap);
      } catch {
        /* ignore */
      }
      void saveRemoteWorkspaceNowRef.current(
        {
          nodes: snap.nodes as RFNode[],
          edges: snap.edges,
          storyboardImages: snap.storyboardImages,
        },
        mode === 'unload'
          ? { force: true, allowEmptyGraph: false, keepalive: true }
          : { force: true, allowEmptyGraph: false, networkRetry: true }
      );
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushOnLeave('hide');
    };
    const onBeforeUnload = () => flushOnLeave('unload');
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      isEditorMountedRef.current = false;
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onVisibility);
      if (remoteSaveTimerRef.current) {
        clearTimeout(remoteSaveTimerRef.current);
        remoteSaveTimerRef.current = null;
      }
      if (persistRequestTimeoutRef.current != null) {
        window.clearTimeout(persistRequestTimeoutRef.current);
        persistRequestTimeoutRef.current = null;
      }
      flushOnLeave('unload');
    };
  }, [serverProjectId, flushRemoteWorkspaceSave, graphHydrationReady, storyboardImages, getNodes, getEdges, writeProjectSnapshotToStorage]);

  /** 工程从磁盘/服务端加载完成后：先恢复 https 主预览，再从 IndexedDB 恢复本机预览 */
  useEffect(() => {
    if (!graphHydrationReady || nodes.length === 0) return;
    hydratePersistedRemotePreviews();
    void hydrateLocalMediaPreviews();
  }, [graphHydrationReady, localMediaScope, hydratePersistedRemotePreviews, hydrateLocalMediaPreviews, nodes.length]);

  /** 纠正历史 MOV/OUTPUT 误显示为 Input Picture Node 的标题 */
  useEffect(() => {
    if (!graphHydrationReady) return;
    setNodes((nds) => fixMisnamedOutputNodesOnGraph(nds));
  }, [graphHydrationReady, setNodes]);

  useEffect(() => {
    if (!serverProjectId) {
      setBootPayload('local');
      void reloadProjectAssets();
      return;
    }
    if (workspaceHydration == null) return;
    workspaceVersionRef.current = workspaceHydration.version;
    const raw = workspaceHydration.payload;
    const p = (raw && typeof raw === 'object' ? raw : null) as Partial<FlowgenWorkspacePayloadV1> | null;
    if (p?.chatByUser && typeof p.chatByUser === 'object') {
      const next: Record<string, PersistedCanvasChatV1> = {};
      for (const [k, v] of Object.entries(p.chatByUser)) {
        if (v && typeof v === 'object') next[k] = v as PersistedCanvasChatV1;
      }
      chatByUserRef.current = next;
    }
    if (p?.projectName && !serverProjectId) onProjectNameChange?.(p.projectName);
    if (p?.viewport) {
      persistedViewportRef.current = p.viewport;
      try {
        localStorage.setItem(LAST_VIEWPORT_KEY, JSON.stringify(p.viewport));
      } catch {
        /* ignore */
      }
    }
    if (p?.graph && Array.isArray(p.graph.nodes) && p.graph.nodes.length > 0) {
      setBootPayload(
        JSON.stringify({
          nodes: p.graph.nodes,
          edges: p.graph.edges || [],
          storyboardImages: p.graph.storyboardImages || [],
        })
      );
    } else {
      setBootPayload('');
    }
    void reloadProjectAssets();
  }, [
    serverProjectId,
    workspaceHydration,
    reloadProjectAssets,
    onProjectNameChange,
    LAST_VIEWPORT_KEY,
  ]);

  // Load saved data on mount
  useEffect(() => {
    const schedulePostLoadInit = () => {
      if (persistedViewportRef.current) {
        restoreViewportFromStorage(40);
        restoreViewportFromStorage(220);
      }
      setTimeout(() => {
        const initialState: HistoryState = {
          nodes: getNodes(),
          edges: getEdges(),
          storyboardImages: [],
        };
        setHistory([initialState]);
        setHistoryIndex(0);
        historyIndexRef.current = 0;
        lastHistoryStructuralSigRef.current = buildStructuralGraphSignature(initialState.nodes, initialState.edges, initialState.storyboardImages);
        lastPersistStructuralSigRef.current = lastHistoryStructuralSigRef.current;
      }, 200);
      setTimeout(() => {
        isInitialLoadRef.current = false;
        hasLoadedRef.current = true;
        setGraphHydrationReady(true);
        hydratePersistedRemotePreviews();
        void hydrateLocalMediaPreviews();
        if (!persistedViewportRef.current) {
          const loaded = getNodes().filter(
            (n) => n.type !== NodeType.BACKDROP && n.type !== NodeType.CHAIN_FOLDER
          );
          const fitTargets = loaded.filter(hasReasonableNodePosition);
          if (fitTargets.length > 0) {
            requestAnimationFrame(() => {
              fitView({
                nodes: fitTargets,
                padding: 0.18,
                maxZoom: 1.15,
                duration: 0,
              });
            });
          }
        }
      }, 100);
    };

    const loadPersistedProject = (raw: string, options?: { mergeLocalRunRecovery?: boolean }) => {
      const parsed = JSON.parse(raw);
      const sanitizeNodeForLoad = (n: any) => sanitizePersistValueDeep(n);

      const loadedEdges: Edge[] =
        parsed.edges && Array.isArray(parsed.edges) && parsed.edges.length > 0
          ? parsed.edges.slice(0, FLOW_MAX_PERSISTED_EDGES)
          : [];

      let loadedNodes: RFNode[] | null = null;
      if (parsed.nodes && Array.isArray(parsed.nodes) && parsed.nodes.length > 0) {
        let rawLoaded = mergeLegacyChainFolderNodesIntoRoots(
          parsed.nodes
            .slice(0, FLOW_MAX_PERSISTED_NODES)
            .map(sanitizeNodeForLoad)
            .filter(Boolean)
            .map(capNodeGeneratedThumbnailsDeep)
        ) as RFNode[];
        if (options?.mergeLocalRunRecovery && serverProjectId) {
          try {
            const localRaw = localStorage.getItem(STORAGE_KEY);
            rawLoaded = mergeRunRecoveryFieldsFromLocalSnapshot(rawLoaded, localRaw);
          } catch {
            /* ignore local merge failures */
          }
        }
        rawLoaded = rawLoaded
            .map((n) => normalizeNodeRunStateForPersist(n))
            .map((n) => sanitizeOutputLikeNodeDataOnLoad(n))
            .map(sanitizeLoadedNodePosition);
        rawLoaded = hydrateGraphMediaFromPersisted(rawLoaded, loadedEdges);
        rawLoaded = normalizeGraphNodesProjectAssetBinding(rawLoaded, serverProjectId);
        loadedNodes = normalizePersistedInputRowsWithFolders(rawLoaded, loadedEdges);
      }

      if (loadedNodes && loadedNodes.length > 0) {
        hydrateGraphWithLazyReveal(
          loadedNodes,
          loadedEdges,
          loadedNodes.map((n) => n.id),
          setNodes,
          setEdges,
          { onComplete: schedulePostLoadInit }
        );
      } else {
        if (loadedEdges.length > 0) {
          setEdges(loadedEdges);
        }
        schedulePostLoadInit();
      }

      if (parsed.storyboardImages && Array.isArray(parsed.storyboardImages) && parsed.storyboardImages.length > 0) {
        setStoryboardImages(sanitizePersistValueDeep(parsed.storyboardImages));
      }
    };

    try {
      if (bootPayload === 'pending') {
        return;
      }
      if (bootPayload === 'local') {
        let savedData = localStorage.getItem(STORAGE_KEY);
        if (!savedData && legacyProjectDataKey) {
          savedData = localStorage.getItem(legacyProjectDataKey);
        }
        if (!savedData) {
          savedData = localStorage.getItem('flowgen-project-data');
        }
        if (!savedData) {
          schedulePostLoadInit();
          return;
        }
        loadPersistedProject(savedData);
        return;
      }
      if (bootPayload === '') {
        // 兼容：服务端当前返回空图时，优先回退本机最近一次快照，避免强刷/连刷期间误丢工作区
        try {
          const localSnapshotRaw = localStorage.getItem(STORAGE_KEY);
          if (localSnapshotRaw) {
            const parsedLocal = JSON.parse(localSnapshotRaw) as {
              nodes?: unknown[];
              savedAt?: string;
            };
            if (Array.isArray(parsedLocal?.nodes) && parsedLocal.nodes.length > 0) {
              loadPersistedProject(localSnapshotRaw);
              return;
            }
          }
        } catch {
          /* ignore fallback parse errors */
        }
        schedulePostLoadInit();
        return;
      }
      loadPersistedProject(bootPayload, { mergeLocalRunRecovery: true });
    } catch (error) {
      try {
        const backupData = localStorage.getItem(STORAGE_BACKUP_KEY);
        if (backupData) {
          loadPersistedProject(backupData);
          localStorage.setItem(STORAGE_KEY, backupData);
          return;
        }
      } catch {
        /* ignore backup recovery errors */
      }
      isInitialLoadRef.current = false;
      hasLoadedRef.current = true;
      setGraphHydrationReady(true);
    }
  }, [
    bootPayload,
    STORAGE_KEY,
    STORAGE_BACKUP_KEY,
    legacyProjectDataKey,
    getEdges,
    getNodes,
    restoreViewportFromStorage,
    setNodes,
    setEdges,
    setStoryboardImages,
    hydrateLocalMediaPreviews,
    hydratePersistedRemotePreviews,
    serverProjectId,
  ]); // bootPayload：服务端工程或本地 localStorage

  const triggerViewportContentRefresh = useCallback(() => {
    const dispatch = () => window.dispatchEvent(new CustomEvent('flowgen:viewport-content-refresh'));
    window.requestAnimationFrame(() => {
      dispatch();
      window.requestAnimationFrame(dispatch);
    });
    window.setTimeout(dispatch, 80);
    window.setTimeout(dispatch, 220);
  }, []);
  useEffect(() => {
    triggerViewportContentRefresh();
  }, [triggerViewportContentRefresh]);
  const enterDragPerformanceMode = useCallback(() => {
    dragPerfModeDepthRef.current += 1;
    if (dragPerfModeDepthRef.current === 1) {
      setIsDragPerformanceMode(true);
      window.dispatchEvent(new CustomEvent('flowgen:drag-perf-mode', { detail: { active: true } }));
    }
  }, []);
  const exitDragPerformanceMode = useCallback(() => {
    dragPerfModeDepthRef.current = Math.max(0, dragPerfModeDepthRef.current - 1);
    if (dragPerfModeDepthRef.current === 0) {
      setIsDragPerformanceMode(false);
      window.dispatchEvent(new CustomEvent('flowgen:drag-perf-mode', { detail: { active: false } }));
    }
  }, []);

  const catchUpGraphSideEffects = useCallback(() => {
    if (!hasLoadedRef.current || isInitialLoadRef.current) return;
    try {
      const currentNodes = getNodes();
      const currentEdges = getEdges();
      const snap = buildPersistSnapshot(currentNodes, currentEdges, storyboardImages);
      writeProjectSnapshotToStorage(snap);
      lastPersistStructuralSigRef.current = buildStructuralGraphSignature(
        currentNodes,
        currentEdges,
        storyboardImages
      );
    } catch {
      /* ignore */
    }
    flushRemoteWorkspaceSave();
  }, [getNodes, getEdges, storyboardImages, writeProjectSnapshotToStorage, flushRemoteWorkspaceSave]);

  const resumeCanvasRefresh = useCallback(() => {
    const wasAdvanced = isCanvasPerfAdvanced;
    setIsCanvasRefreshPaused(false);
    setCanvasRefreshPaused(false);
    hydratePersistedRemotePreviews();
    triggerViewportContentRefresh();
    if (wasAdvanced) {
      catchUpGraphSideEffects();
    }
  }, [
    isCanvasPerfAdvanced,
    hydratePersistedRemotePreviews,
    triggerViewportContentRefresh,
    catchUpGraphSideEffects,
  ]);

  const pauseCanvasRefresh = useCallback(() => {
    setCanvasRefreshPaused(true);
    setIsCanvasRefreshPaused(true);
  }, []);

  const toggleCanvasRefreshPaused = useCallback(() => {
    if (isCanvasRefreshPaused) {
      resumeCanvasRefresh();
    } else {
      pauseCanvasRefresh();
    }
  }, [isCanvasRefreshPaused, pauseCanvasRefresh, resumeCanvasRefresh]);
  const viewportMovingRef = useRef(false);
  const viewportMoveIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isViewportMoving, setIsViewportMoving] = useState(false);
  const clearViewportMovingClass = useCallback(() => {
    viewportMovingRef.current = false;
    setIsViewportMoving(false);
    setCanvasViewportMoving(false);
  }, []);
  const persistViewportAfterMove = useCallback(() => {
    const viewport = getViewport();
    if (!viewport) return;
    writeViewportToStorage({
      x: viewport.x,
      y: viewport.y,
      zoom: viewport.zoom,
    });
    triggerViewportContentRefresh();
    if (serverProjectId && !isGraphSideEffectPausedRef.current) scheduleRemoteWorkspaceSave();
  }, [
    getViewport,
    writeViewportToStorage,
    triggerViewportContentRefresh,
    serverProjectId,
    scheduleRemoteWorkspaceSave,
  ]);
  const handleViewportMoveStart = useCallback(() => {
    if (viewportMoveIdleTimerRef.current) {
      clearTimeout(viewportMoveIdleTimerRef.current);
      viewportMoveIdleTimerRef.current = null;
    }
    if (!viewportMovingRef.current) {
      viewportMovingRef.current = true;
      setIsViewportMoving(true);
      setCanvasViewportMoving(true);
    }
  }, []);
  const handleViewportMove = useCallback(() => {
    if (!viewportMovingRef.current) {
      viewportMovingRef.current = true;
      setIsViewportMoving(true);
      setCanvasViewportMoving(true);
    }
    if (viewportMoveIdleTimerRef.current) clearTimeout(viewportMoveIdleTimerRef.current);
    viewportMoveIdleTimerRef.current = setTimeout(() => {
      viewportMoveIdleTimerRef.current = null;
      clearViewportMovingClass();
    }, 140);
  }, [clearViewportMovingClass]);
  const handleViewportMoveEnd = useCallback(() => {
    if (viewportMoveIdleTimerRef.current) {
      clearTimeout(viewportMoveIdleTimerRef.current);
      viewportMoveIdleTimerRef.current = null;
    }
    clearViewportMovingClass();
    persistViewportAfterMove();
  }, [clearViewportMovingClass, persistViewportAfterMove]);

  // 监听「请求立即持久化」：如 taskId 写入 / poster 回退后触发，保证刷新前落盘
  useEffect(() => {
    const onPersist = (ev: Event) => {
      const force = (ev as CustomEvent<{ force?: boolean }>)?.detail?.force === true;
      if (isGraphSideEffectPausedRef.current && !force) return;
      const runPersist = () => {
        try {
          const currentNodes = mergeRunPersistPatchesIntoNodes(
            getNodes(),
            pendingRunPersistPatchesRef.current
          );
          const currentEdges = getEdges();
          const structuralSig = buildStructuralGraphSignature(currentNodes, currentEdges, storyboardImages);
          if (!force && structuralSig === lastPersistStructuralSigRef.current) return;
          writeProjectSnapshotToStorage(buildPersistSnapshot(currentNodes, currentEdges, storyboardImages));
          lastPersistStructuralSigRef.current = structuralSig;
          flushRemoteWorkspaceSave(undefined, force ? { force: true } : undefined);
        } catch (_) { /* ignore */ }
      };
      if (force) {
        if (persistRequestTimeoutRef.current != null) {
          window.clearTimeout(persistRequestTimeoutRef.current);
          persistRequestTimeoutRef.current = null;
        }
        runPersist();
        return;
      }
      if (persistRequestTimeoutRef.current != null) {
        window.clearTimeout(persistRequestTimeoutRef.current);
      }
      persistRequestTimeoutRef.current = window.setTimeout(() => {
        persistRequestTimeoutRef.current = null;
        runPersist();
      }, 900);
    };
    window.addEventListener('flowgen:persist-request', onPersist);
    return () => {
      window.removeEventListener('flowgen:persist-request', onPersist);
      if (persistRequestTimeoutRef.current != null) {
        window.clearTimeout(persistRequestTimeoutRef.current);
        persistRequestTimeoutRef.current = null;
      }
    };
  }, [getNodes, getEdges, storyboardImages, writeProjectSnapshotToStorage, flushRemoteWorkspaceSave]);

  /** 画布空白区标记为中键投放目标（资产库 / 节点拖出 → 新建节点） */
  useEffect(() => {
    const markPane = () => {
      const pane = reactFlowWrapper.current?.querySelector('.react-flow__pane');
      if (!pane) return;
      pane.setAttribute('data-flowgen-media-drop', '1');
      pane.setAttribute('data-flowgen-drop-zone', 'canvas-pane');
    };
    markPane();
    const t = window.setTimeout(markPane, 120);
    return () => window.clearTimeout(t);
  }, [nodes.length, graphHydrationReady]);

  /** 中键拖放：节点间主预览区写入 imagePreview（画布空白区不再创建新节点） */
  useEffect(() => {
    const onWin = (ev: Event) => {
      const d = (ev as CustomEvent<FlowgenMediaUrlDropDetail>).detail;
      if (!d) return;

      // 画布空白区投放：不再创建新节点（保留节点面板投放功能）
      if (d.dropZone === 'canvas-pane') {
        return;
      }

      if (!d.targetNodeId || d.sourceNodeId === d.targetNodeId) return;
      if (d.dropZone !== 'node-main') return;
      const fromAssetLibrary = isAssetLibraryMediaDragSource(d.sourceNodeId);
      const isVid =
        d.kind === 'video' ||
        /\.(mov|mp4|webm|avi|mkv|flv|wmv|m4v)(\?|$)/i.test(d.url) ||
        d.url.startsWith('blob:') ||
        /video/i.test(d.url);
      const applyAssetToNodeMain = (preview: string) => {
        const canonical =
          fromAssetLibrary && d.assetId && serverProjectId
            ? resolveCanonicalProjectAssetPreviewUrl(d.url, serverProjectId, d.assetId)
            : isPersistableMediaUrl(d.url)
              ? flowgenAssetFileUrlFromMediaUrl(stripAssetAccessTokenFromUrl(d.url))
              : preview;
        const nextPreview =
          canonical && isProjectAssetLibraryImageUrl(canonical) ? canonical : preview;
        setNodes((nds) =>
          nds.map((n) => {
            if (n.id !== d.targetNodeId) return n;
            const dropProjectId =
              serverProjectId ||
              parseProjectAssetIdsFromMediaUrl(d.url)?.projectId ||
              undefined;
            const nextData = normalizeTemplateNodeDataForSpawn(
              {
                ...n.data,
                imagePreview: nextPreview,
                imageName: d.assetName?.trim() || n.data.imageName || `asset_${d.assetId || 'main'}`,
                ...(fromAssetLibrary && d.assetId ? { projectAssetId: d.assetId } : {}),
              } as NodeData,
              dropProjectId
            );
            return { ...n, data: nextData };
          })
        );
        setTimeout(() => window.dispatchEvent(new CustomEvent('flowgen:persist-request')), 300);
        scheduleRemoteWorkspaceSave();
      };
      if (isVid) {
        applyAssetToNodeMain(d.url);
        return;
      }
      if (fromAssetLibrary && d.assetId && serverProjectId) {
        applyAssetToNodeMain(
          resolveCanonicalProjectAssetPreviewUrl(d.url, serverProjectId, d.assetId) || d.url
        );
        return;
      }
      void prepareCanvasNodeImagePreview(d.url)
        .then(applyAssetToNodeMain)
        .catch(() => {
          if (shouldSkipCompress(d.url)) applyAssetToNodeMain(d.url);
          else compressImageForPreview(d.url).then(applyAssetToNodeMain).catch(() => applyAssetToNodeMain(d.url));
        });
    };
    window.addEventListener(FLOWGEN_MEDIA_URL_DROP, onWin);
    return () => window.removeEventListener(FLOWGEN_MEDIA_URL_DROP, onWin);
  }, [
    createNodesFromAssetItems,
    screenToFlowPosition,
    setNodes,
    serverProjectId,
    scheduleRemoteWorkspaceSave,
  ]);

  // Auto-save when nodes or edges change (but not on initial load) - 使用防抖（降低频率，减少卡顿）
  useEffect(() => {
    // 跳过初始加载时的保存
    if (isInitialLoadRef.current || !hasLoadedRef.current) return;
    // 拖拽中不重置自动保存计时器，减少高频 effect 开销。
    if (isGraphSideEffectPaused) return;
    
    // 清除之前的定时器
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    // 设置防抖：3 分钟无操作后再保存，避免频繁序列化大工程导致卡顿
    // 注意：此处不要 set saving——否则在整段等待期内会一直显示「保存中」，容易误导
    saveTimeoutRef.current = setTimeout(() => {
      const currentNodes = getNodes();
      const currentEdges = getEdges();
      const doSave = () => {
        try {
          const dataToSave = buildPersistSnapshot(currentNodes, currentEdges, storyboardImages);
          writeProjectSnapshotToStorage(dataToSave);
          lastPersistStructuralSigRef.current = buildStructuralGraphSignature(currentNodes, currentEdges, storyboardImages);
        } catch (error) {
        
        // 如果数据太大，提示用户手动保存或清理（只提示一次）
        if (error instanceof Error && (error.message.includes('QuotaExceededError') || error.name === 'QuotaExceededError')) {
          
          // 只提示一次
          if (!hasShownStorageWarningRef.current) {
            hasShownStorageWarningRef.current = true;
            
            // 检查 localStorage 使用情况
            let storageInfo = '';
            let currentProjectSize = '';
            try {
              // 计算总使用量
              let totalSize = 0;
              for (let key in localStorage) {
                if (localStorage.hasOwnProperty(key)) {
                  const value = localStorage.getItem(key);
                  if (value) {
                    totalSize += value.length;
                  }
                }
              }
              const sizeInMB = (totalSize / 1024 / 1024).toFixed(2);
              storageInfo = `\n\n当前 localStorage 总使用: ${sizeInMB} MB`;
              
              // 计算当前工程大小
              const currentData = localStorage.getItem(STORAGE_KEY);
              if (currentData) {
                const projectSizeInMB = (currentData.length / 1024 / 1024).toFixed(2);
                currentProjectSize = `\n当前工程数据: ${projectSizeInMB} MB`;
              }
            } catch (e) {
              // 忽略检查错误
            }
            
            // 使用更友好的提示，提供清理选项
            const message = 
              '⚠️ 自动存储空间已满\n\n' +
              '• 再次刷新页面内容会丢失\n' +
              '• 建议：点击"保存"按钮手动保存工程到文件' +
              storageInfo +
              currentProjectSize +
              '\n\n是否清理当前工程的自动保存数据以释放空间？\n' +
              '（清理后可以继续使用，但请记得手动保存）';
            
            const userChoice = confirm(message);
            
            if (userChoice) {
              // 清理当前工程的自动保存数据
              try {
                // 先尝试清理当前工程数据
                localStorage.removeItem(STORAGE_KEY);
                localStorage.removeItem(STORAGE_BACKUP_KEY);
                localStorage.removeItem(LAST_VIEWPORT_KEY);
                
                // 验证清理是否成功
                const remaining = localStorage.getItem(STORAGE_KEY);
                if (remaining) {
                  // 如果还有数据，说明清理失败，可能是其他原因
                }
                
                // 重置警告标记，允许再次提示（如果清理后还是不够）
                hasShownStorageWarningRef.current = false;
                
                // 尝试再次保存，看看是否成功
                setTimeout(() => {
                  try {
                    const testNodes = getNodes();
                    const testEdges = getEdges();
                    const testData = buildPersistSnapshot(testNodes, testEdges, storyboardImages);
                    writeProjectSnapshotToStorage(testData);
                  } catch (retryError) {
                    // 如果还是失败，说明空间确实不足
                    // 不重置标记，避免频繁提示
                    hasShownStorageWarningRef.current = true;
                  }
                }, 100);
                
              } catch (e) {
                // 清理失败时，保持警告标记，避免频繁提示
                hasShownStorageWarningRef.current = true;
                alert('❌ 清理失败，请手动清理浏览器缓存\n\nF12 → Application → Local Storage → 删除 flowgen-project-data\n\n或使用控制台命令：localStorage.removeItem("flowgen-project-data")');
              }
            } else {
              // 用户取消清理，保持警告标记，避免频繁提示
              // 但允许在页面刷新后再次提示
              // hasShownStorageWarningRef.current 保持为 true
            }
          }
        } else {
          // 其他错误：静默失败，控制台已输出
        }
      }
      };
      // 在空闲时执行序列化+写入，避免大工程时阻塞主线程导致卡顿
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(doSave, { timeout: 6000 });
      } else {
        setTimeout(doSave, 0);
      }
    }, LOCAL_SNAPSHOT_SAVE_DEBOUNCE_MS);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [nodes, edges, storyboardImages, getNodes, getEdges, writeProjectSnapshotToStorage, isGraphSideEffectPaused]);

  // 画布变化后标记为“建议手动保存”
  useEffect(() => {
    if (isInitialLoadRef.current || !hasLoadedRef.current) return;
    if (isGraphSideEffectPaused) return;
    hasUnsavedManualChangesRef.current = true;
  }, [nodes, edges, storyboardImages, isGraphSideEffectPaused]);

  // 定时提醒用户手动保存工程，降低异常关闭时丢失风险
  useEffect(() => {
    const timer = setInterval(() => {
      if (!hasLoadedRef.current || !hasUnsavedManualChangesRef.current) return;
      const now = Date.now();
      if (now - lastManualSaveAtRef.current < MANUAL_SAVE_REMINDER_INTERVAL_MS) return;
      if (now - lastManualSaveReminderAtRef.current < MANUAL_SAVE_REMINDER_COOLDOWN_MS) return;
      lastManualSaveReminderAtRef.current = now;
      setShowManualSaveReminder(true);
    }, 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  // Selection State
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  /** 左键点选打开的 Inspector 目标；Shift 框选/多选时不随画布 selection 切换 */
  const inspectorAnchorIdRef = useRef<string | null>(null);
  /** 框选拖拽期间/刚结束时，忽略 pane click 与空 selection 对 Inspector 的清除 */
  const suppressInspectorClearRef = useRef(false);
  /** Shift 框选/追加选区：保留 Inspector 锚点供中键拖入 */
  const preserveInspectorAnchorRef = useRef(false);
  const shiftHeldRef = useRef(false);
  const getNodesForMiddleDragRef = useRef(getNodes);
  getNodesForMiddleDragRef.current = getNodes;

  const releaseCanvasMultiSelectAfterInspectorDrop = useCallback(
    (targetNodeId: string) => {
      const targetNode = getNodes().find((n) => n.id === targetNodeId);
      if (targetNode && shouldOpenInspectorForNode(targetNode)) {
        inspectorAnchorIdRef.current = targetNodeId;
        setFlowgenInspectorAnchorId(targetNodeId);
        setSelectedNodeId(targetNodeId);
        preserveInspectorAnchorRef.current = true;
        suppressInspectorClearRef.current = true;
      } else {
        inspectorAnchorIdRef.current = null;
        setFlowgenInspectorAnchorId(null);
        setSelectedNodeId(null);
        preserveInspectorAnchorRef.current = false;
        suppressInspectorClearRef.current = false;
      }

      setNodes((nds) => {
        const patch = buildClearCanvasSelectionPatch(nds);
        return patch ?? nds;
      });

      window.setTimeout(() => {
        preserveInspectorAnchorRef.current = false;
        suppressInspectorClearRef.current = false;
      }, 80);
    },
    [getNodes, setNodes]
  );

  useEffect(() => {
    return installCanvasMiddleDragBridge(() => getNodesForMiddleDragRef.current());
  }, []);

  /** 画布中键拖入面板后释放 Shift 框选，Inspector 切到投放目标节点 */
  useEffect(() => {
    const onDrop = (ev: Event) => {
      const d = (ev as CustomEvent<FlowgenMediaUrlDropDetail>).detail;
      if (!d || !isCanvasNodeMediaDragSource(d.sourceNodeId)) return;
      const inspectorZones = new Set([
        'reference',
        'seedance-reference',
        'first-frame',
        'last-frame',
        'node-main',
      ]);
      if (!inspectorZones.has(d.dropZone)) return;
      if (!d.targetNodeId?.trim()) return;
      releaseCanvasMultiSelectAfterInspectorDrop(d.targetNodeId);
    };
    window.addEventListener(FLOWGEN_MEDIA_URL_DROP, onDrop);
    return () => {
      window.removeEventListener(FLOWGEN_MEDIA_URL_DROP, onDrop);
    };
  }, [releaseCanvasMultiSelectAfterInspectorDrop]);

  // Default to Selection (Pointer) Mode as requested
  const [isSelectionMode, setIsSelectionMode] = useState(true);
  const isAltMiddleMouseActiveRef = useRef(false);
  const [isAltMiddlePanActive, setIsAltMiddlePanActive] = useState(false); 

  // Execution State
  const [isGlobalRunning, setIsGlobalRunning] = useState(false);
  const [batchRunProgress, setBatchRunProgress] = useState<{ current: number; total: number } | null>(
    null
  );
  const [batchRunKind, setBatchRunKind] = useState<'storyboard' | 'selected' | null>(null);
  const batchRunKindRef = useRef<'storyboard' | 'selected'>('storyboard');
  /** 「选择运行」：生成 MOV 时继承队列中上一节点的显示名 */
  const selectedBatchNamingPrevRef = useRef<Partial<NodeData> | undefined>(undefined);
  const stopExecutionRef = useRef(false);
  useEffect(() => {
    isGlobalRunningRef.current = isGlobalRunning;
    if (!isGlobalRunning && serverProjectId && hasLoadedRef.current && !isInitialLoadRef.current) {
      scheduleRemoteWorkspaceSave();
    }
  }, [isGlobalRunning, serverProjectId, scheduleRemoteWorkspaceSave]);

  // Modal Preview State (Now holds the full node data for details)
  const [previewNode, setPreviewNode] = useState<RFNode | null>(null);
  const [inlineRefMovPlayingUrl, setInlineRefMovPlayingUrl] = useState<string | null>(null);
  useEffect(() => {
    setInlineRefMovPlayingUrl(null);
  }, [previewNode?.id]);
  // 预览面板保持与画布节点数据同步：否则重新生成后仍显示旧快照（Source URL / Reference Images）
  useEffect(() => {
    if (!previewNode) return;
    const latest = nodes.find((n) => n.id === previewNode.id);
    if (!latest) return;
    if (latest !== previewNode) {
      setPreviewNode(latest);
    }
  }, [nodes, previewNode]);
  
  // Save Project Dialog State
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [pendingNewProjectAfterSave, setPendingNewProjectAfterSave] = useState(false);
  const [saveFileName, setSaveFileName] = useState('');
  const [saveFilePath, setSaveFilePath] = useState('');
  /** 通过系统「打开文件」选中的 JSON；保存时可写回该路径（需 Chrome/Edge 等） */
  const projectJsonFileHandleRef = useRef<FileSystemFileHandle | null>(null);

  // 上传时使用原图（主图、参考图、首尾帧）：仅同会话内外都拖入的 File 时保留，刷新后仍用压缩图
  type OriginalsMap = {
    main?: File;
    referenceImages?: (File | null)[];
    referenceAudios?: File[];
    firstFrame?: File;
    lastFrame?: File;
    jimengImages?: (File | null)[];
    klingOmniVideo?: File;
  };
  const originalImagesRef = useRef<Map<string, OriginalsMap>>(new Map());
  const getOriginals = (nodeId: string): OriginalsMap => {
    if (!originalImagesRef.current.has(nodeId)) originalImagesRef.current.set(nodeId, {});
    return originalImagesRef.current.get(nodeId)!;
  };

  // Function to create preview node from thumbnail data
  const createPreviewNodeFromThumbnail = useCallback((thumbnail: { id: string; url: string; type: 'image' | 'video'; nodeId?: string; generationParams?: GenerationParams }, sourceNode: RFNode) => {
    if (thumbnail.nodeId) {
      // Try to find the actual output node
      const outputNode = getNodes().find(n => n.id === thumbnail.nodeId);
      if (outputNode) {
        setPreviewNode(outputNode);
        return;
      }
    }
    // If node not found, create a temporary preview node
    const tempNode: RFNode = {
      id: thumbnail.id,
      type: thumbnail.type === 'video' ? NodeType.MOV : NodeType.OUTPUT,
      position: sourceNode.position,
      data: {
        label: thumbnail.type === 'video' ? 'Output Mov Node' : 'Output Picture Node',
        imagePreview: thumbnail.url,
        generationParams: thumbnail.generationParams || sourceNode.data.generationParams,
        taskId:
          thumbnail.generationParams?.taskId ||
          sourceNode.data.taskId ||
          sourceNode.data.generationParams?.taskId,
        imageName: thumbnail.type === 'video' ? 'Video.mov' : 'Generated.png',
        status: 'completed'
      }
    };
    setPreviewNode(tempNode);
  }, [getNodes]);

  // Video Sequence Player State
  const [isVideoPlayerOpen, setIsVideoPlayerOpen] = useState(false);
  const [videoPlaylist, setVideoPlaylist] = useState<string[]>([]);
  const [currentVideoIndex, setCurrentVideoIndex] = useState(0);

  // Context Menu State
  const [nodeContextMenu, setNodeContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [runScheduleMenu, setRunScheduleMenu] = useState<{ x: number; y: number; action: 'selected' | 'all' } | null>(null);
  const [customTimePicker, setCustomTimePicker] = useState<{ action: 'selected' | 'all'; defaultValue: string } | null>(null);
  const customTimeInputRef = useRef<HTMLInputElement>(null);
  const scheduledRunTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pendingScheduledRun, setPendingScheduledRun] = useState<{
    action: 'selected' | 'all';
    nodeIds: string[];
    fireAt: number;
  } | null>(null);
  /** 画布「定时」角标：等待到点 + 批量执行中逐节点清除（与 pendingScheduledRun 分离） */
  const [scheduledRunBadgeNodeIds, setScheduledRunBadgeNodeIds] = useState<string[] | null>(null);
  useEffect(() => {
    return () => {
      if (scheduledRunTimeoutRef.current) clearTimeout(scheduledRunTimeoutRef.current);
    };
  }, []);
  const storyboardExcelInputRef = useRef<HTMLInputElement>(null);
  const pendingStoryboardTemplateIdRef = useRef<string | null>(null);

  const { selectedNode, selectedNodes } = useMemo(() => {
    let nextSelectedNode: RFNode | undefined;
    const nextSelectedNodes: RFNode[] = [];
    for (const node of nodes) {
      if (selectedNodeId && node.id === selectedNodeId) {
        nextSelectedNode = node;
      }
      if (node.selected) {
        nextSelectedNodes.push(node);
      }
    }
    return {
      selectedNode: nextSelectedNode,
      selectedNodes: nextSelectedNodes,
    };
  }, [nodes, selectedNodeId]);
  const [stablePanelSelectedNode, setStablePanelSelectedNode] = useState<RFNode | null>(null);
  const [stablePanelSelectedNodes, setStablePanelSelectedNodes] = useState<RFNode[]>([]);
  const panelSelectedNode = isGraphSideEffectPaused ? (stablePanelSelectedNode || selectedNode || null) : selectedNode;
  const inspectorPanelNode =
    panelSelectedNode && shouldOpenInspectorForNode(panelSelectedNode) ? panelSelectedNode : null;

  // 持久化最后选中的节点，刷新后若节点仍存在则恢复右侧 Inspector
  useEffect(() => {
    try {
      if (selectedNodeId) {
        if (lastSelectedNodeIdPersistedRef.current === selectedNodeId) return;
        localStorage.setItem(LAST_SELECTED_NODE_KEY, selectedNodeId);
        lastSelectedNodeIdPersistedRef.current = selectedNodeId;
      } else {
        if (lastSelectedNodeIdPersistedRef.current === null) return;
        localStorage.removeItem(LAST_SELECTED_NODE_KEY);
        lastSelectedNodeIdPersistedRef.current = null;
      }
    } catch {
      /* ignore */
    }
  }, [selectedNodeId]);
  useEffect(() => {
    if (isGraphSideEffectPaused) return;
    setStablePanelSelectedNode(selectedNode || null);
  }, [selectedNode, isGraphSideEffectPaused]);

  useEffect(() => {
    if (!hasLoadedRef.current) return;
    if (selectedNodeId && selectedNode) return;
    try {
      const lastSelectedNodeId = localStorage.getItem(LAST_SELECTED_NODE_KEY);
      if (!lastSelectedNodeId) return;
      const existing = nodes.find((n) => n.id === lastSelectedNodeId);
      if (existing && shouldOpenInspectorForNode(existing)) {
        inspectorAnchorIdRef.current = lastSelectedNodeId;
        setFlowgenInspectorAnchorId(lastSelectedNodeId);
        setSelectedNodeId(lastSelectedNodeId);
      } else if (!selectedNodeId) {
        localStorage.removeItem(LAST_SELECTED_NODE_KEY);
      }
    } catch {
      /* ignore */
    }
  }, [nodes, selectedNodeId, selectedNode]);

  useEffect(() => {
    if (!selectedNodeId) return;
    if (selectedNode) return;
    try {
      const persisted = localStorage.getItem(LAST_SELECTED_NODE_KEY);
      if (persisted === selectedNodeId) {
        localStorage.removeItem(LAST_SELECTED_NODE_KEY);
      }
    } catch {
      /* ignore */
    }
    inspectorAnchorIdRef.current = null;
    setFlowgenInspectorAnchorId(null);
    setSelectedNodeId(null);
  }, [selectedNodeId, selectedNode]);

  // Focus the editor on mount
  useEffect(() => {
    if (reactFlowWrapper.current) {
      reactFlowWrapper.current.focus();
    }
  }, []);

  // 框选拖拽期间避免 pane click / 空 selection 误关 Inspector（仅框选时启用，空白单击不关）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') shiftHeldRef.current = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') shiftHeldRef.current = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // Listen for thumbnail click events from CustomNode
  useEffect(() => {
    const handlePreviewNode = (event: CustomEvent<RFNode>) => {
      const node = event.detail;
      setPreviewNode(node);
      if (node?.id && getNodes().some((n) => n.id === node.id)) {
        setSelectedNodeId(node.id);
      }
    };
    window.addEventListener('flowgen:preview-node', handlePreviewNode as EventListener);
    return () => {
      window.removeEventListener('flowgen:preview-node', handlePreviewNode as EventListener);
    };
  }, [getNodes]);

  // 节点/Inspector 拖入外部文件时注册原图（主图、参考图、首尾帧、即梦多图），上传时优先用原图
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent<{
        nodeId: string;
        file?: File;
        type?: 'main' | 'firstFrame' | 'lastFrame' | 'swapFrames' | 'klingOmniVideo' | 'klingOmniVideoRemove';
        referenceAppend?: (File | null)[];
        referenceAppendStartIndex?: number;
        referenceLocalRefField?: PanelReferenceLocalRefField;
        referenceAppendAckId?: string;
        referenceRemoveIndex?: number;
        referenceAudioAppend?: File[];
        jimengAppend?: (File | null)[];
        jimengRemoveIndex?: number;
      }>).detail;
      if (!d?.nodeId) return;
      const o = getOriginals(d.nodeId);
      if (d.type === 'main' && d.file instanceof File) {
        o.main = d.file;
        const node = getNodes().find((n) => n.id === d.nodeId);
        const nd = node?.data as NodeData & { projectAssetId?: string };
        const skipLocal =
          !!nd?.projectAssetId ||
          !!(nd?.imagePreview && isProjectAssetLibraryImageUrl(nd.imagePreview));
        if (!skipLocal) void attachLocalMainRef(d.nodeId, d.file);
      }
      else if (d.type === 'firstFrame' && d.file instanceof File) {
        o.firstFrame = d.file;
        void attachLocalFrameRef(d.nodeId, d.file, 'firstFrame');
      } else if (d.type === 'lastFrame' && d.file instanceof File) {
        o.lastFrame = d.file;
        void attachLocalFrameRef(d.nodeId, d.file, 'lastFrame');
      }
      else if (d.type === 'klingOmniVideo' && d.file instanceof File) o.klingOmniVideo = d.file;
      else if (d.type === 'klingOmniVideoRemove') o.klingOmniVideo = undefined;
      else if (d.type === 'swapFrames') {
        [o.firstFrame, o.lastFrame] = [o.lastFrame, o.firstFrame];
      } else if (d.referenceAppend) {
        o.referenceImages = [...(o.referenceImages || []), ...d.referenceAppend];
        const files = d.referenceAppend.filter((f): f is File => f instanceof File);
        if (files.length > 0) {
          const node = getNodes().find((n) => n.id === d.nodeId);
          const localRefField = d.referenceLocalRefField || 'referenceImageLocalRefs';
          const imagesField =
            localRefField === 'klingOmniMultiReferenceLocalRefs'
              ? 'klingOmniMultiReferenceImages'
              : localRefField === 'klingOmniInstructionReferenceLocalRefs'
                ? 'klingOmniInstructionReferenceImages'
                : localRefField === 'klingOmniVideoReferenceLocalRefs'
                  ? 'klingOmniVideoReferenceImages'
                  : 'referenceImages';
          const startIndex =
            d.referenceAppendStartIndex ??
            ((node?.data[imagesField as keyof NodeData] as string[] | undefined) || []).length;
          void attachLocalReferenceRefs(d.nodeId, startIndex, files, localRefField).then((localRefs) => {
            // 通知 NodeInspector IndexedDB 写入已完成
            if (d.referenceAppendAckId) {
              window.dispatchEvent(
                new CustomEvent('flowgen:reference-files-registered', {
                  detail: {
                    ackId: d.referenceAppendAckId,
                    localRefField,
                    localRefs,
                  },
                })
              );
            }
          });
        }
      } else if (d.referenceAudioAppend?.length) {
        o.referenceAudios = [...(o.referenceAudios || []), ...d.referenceAudioAppend];
      } else if (d.referenceRemoveIndex !== undefined) {
        (o.referenceImages || []).splice(d.referenceRemoveIndex, 1);
      } else if (d.jimengAppend) {
        o.jimengImages = [...(o.jimengImages || []), ...d.jimengAppend];
      } else if (d.jimengRemoveIndex !== undefined) {
        (o.jimengImages || []).splice(d.jimengRemoveIndex, 1);
      }
    };
    window.addEventListener('flowgen:register-original-image', handler as EventListener);
    return () => window.removeEventListener('flowgen:register-original-image', handler as EventListener);
  }, [attachLocalMainRef, attachLocalFrameRef, attachLocalReferenceRefs, getNodes]);

  useEffect(() => {
    const onExpandChainFolder = (ev: Event) => {
      const d = (ev as CustomEvent<{ folderId?: string; rootId?: string }>).detail;
      if (!d?.folderId && !d?.rootId) return;
      const curNodes = getNodes();
      const curEdges = getEdges();
      const res = applyChainFolderExpandLayout(curNodes, curEdges, {
        folderId: d.folderId,
        rootId: d.rootId,
      });
      if (!res) return;
      setNodes(res.nodes);
      setEdges(res.edges);
      setSelectedNodeId((sid) => (d.folderId && sid === d.folderId ? null : sid));
    };
    window.addEventListener('flowgen:expand-chain-folder', onExpandChainFolder as EventListener);
    return () => window.removeEventListener('flowgen:expand-chain-folder', onExpandChainFolder as EventListener);
  }, [getNodes, getEdges, setNodes, setEdges, setSelectedNodeId]);

  // --- Layout Helper Functions ---

  // Helper to trace back storyboard index
  const getStoryboardIndex = useCallback((node: RFNode, currentNodes: RFNode[], currentEdges: Edge[]): number => {
    // A. If node is an Input node, try to match its image directly
    const selfIndex = storyboardImages.indexOf(node.data?.imagePreview);
    if (selfIndex !== -1) return selfIndex;

    // B. If node is an Output/Mov node, trace back to its parent (Source)
    const incomingEdges = currentEdges.filter(e => e.target === node.id);
    
    // Check all parents, take the minimum index found
    for (const edge of incomingEdges) {
        const parentNode = currentNodes.find(n => n.id === edge.source);
        if (parentNode) {
            // Check parent directly
            const parentIndex = storyboardImages.indexOf(parentNode.data?.imagePreview);
            if (parentIndex !== -1) return parentIndex;

            // Optional: Look one level deeper (Grandparent)
            const grandParentEdges = currentEdges.filter(e => e.target === parentNode.id);
            for (const gpEdge of grandParentEdges) {
                const grandParent = currentNodes.find(n => n.id === gpEdge.source);
                if (grandParent) {
                     const gpIndex = storyboardImages.indexOf(grandParent.data?.imagePreview);
                     if (gpIndex !== -1) return gpIndex;
                }
            }
        }
    }
    
    return 999999; // Not found in storyboard
  }, [storyboardImages]);

  /** 画布排序：优先按节点显示名（customName，否则 label），数字编号按自然序（001 在 002、010 之前） */
  const compareNodesByDisplayName = useCallback((a: RFNode, b: RFNode): number => {
    const hasCustomA = !!a.data?.customName?.trim();
    const hasCustomB = !!b.data?.customName?.trim();
    if (hasCustomA !== hasCustomB) return hasCustomA ? -1 : 1;
    const nameA = (a.data?.customName?.trim() || a.data?.label || '').trim();
    const nameB = (b.data?.customName?.trim() || b.data?.label || '').trim();
    return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
  }, []);

  // 1. Arrange Nodes by Type (Separate Area)
  const arrangeNodesByType = useCallback((type: NodeType) => {
    if (isLayouting) return;
    setIsLayouting(true);
    let currentNodes = getNodes();
    let currentEdges = getEdges();

    const doInputFold = type === NodeType.INPUT && inputArrangeFoldOnNextClickRef.current;
    const doMovFold = type === NodeType.MOV && movArrangeFoldOnNextClickRef.current;

    if (type === NodeType.INPUT || (type === NodeType.MOV && doMovFold)) {
      currentNodes = stripChainFolderNodesAndUnhide(currentNodes);
      currentEdges = clearEdgesHiddenFlag(currentEdges);
    }

    /** 排序/打组逻辑开始前各节点是否 hidden，用于「第二次点击全部展开」时只对「由隐变显」的节点做懒加载 */
    const hiddenBaselineBeforeArrange = new Map(currentNodes.map((n) => [n.id, n.hidden === true]));

    // Filter nodes of the specific type
    // For INPUT type, include PROCESSOR；for MOV button, sort terminal OUTPUT/MOV nodes (no outgoing edges).
    let targetNodes: RFNode[];
    if (type === NodeType.INPUT) {
      targetNodes = currentNodes.filter((n) => n.type === NodeType.INPUT || n.type === NodeType.PROCESSOR);
    } else if (type === NodeType.MOV) {
      if (!doMovFold) {
        // 第二次点击（展开）：优先取当前已打组的末层根节点，按手动展开同逻辑逐个展开
        targetNodes = currentNodes.filter(
          (n) =>
            (n.type === NodeType.OUTPUT || n.type === NodeType.MOV) &&
            (((n.data as NodeData)?.chainFolderChildIds || []).length > 0)
        );
      } else {
        const outgoingVisibleCount = new Map<string, number>();
        const incomingVisibleCount = new Map<string, number>();
        for (const n of currentNodes) outgoingVisibleCount.set(n.id, 0);
        for (const n of currentNodes) incomingVisibleCount.set(n.id, 0);
        for (const e of currentEdges) {
          if (e.hidden) continue;
          outgoingVisibleCount.set(e.source, (outgoingVisibleCount.get(e.source) || 0) + 1);
          incomingVisibleCount.set(e.target, (incomingVisibleCount.get(e.target) || 0) + 1);
        }
        const terminal = currentNodes.filter(
          (n) => (n.type === NodeType.OUTPUT || n.type === NodeType.MOV) && (outgoingVisibleCount.get(n.id) || 0) === 0
        );
        const withUpstream = currentNodes.filter(
          (n) => (n.type === NodeType.OUTPUT || n.type === NodeType.MOV) && (incomingVisibleCount.get(n.id) || 0) > 0
        );
        // 优先“最后一层输出”（无下游）；若为空再退回“有上游输出”；再退回全部 OUTPUT/MOV
        targetNodes =
          terminal.length > 0
            ? terminal
            : withUpstream.length > 0
              ? withUpstream
              : currentNodes.filter((n) => n.type === NodeType.OUTPUT || n.type === NodeType.MOV);
      }
    } else {
      targetNodes = currentNodes.filter((n) => n.type === type);
    }

    if (targetNodes.length === 0) {
      // 防卡死：MOV 第二次点击若无可展开分组（例如刚展开后标识已清空），自动回切到“下一次执行打组”
      if (type === NodeType.MOV && !doMovFold) {
        movArrangeFoldOnNextClickRef.current = true;
      }
      setIsLayouting(false);
      return;
    }

    // 优先按节点命名（001、002…）自然序；再按分镜索引；最后按画布位置
    targetNodes.sort((a, b) => {
      const byName = compareNodesByDisplayName(a, b);
      if (byName !== 0) return byName;
      const idxA = getStoryboardIndex(a, currentNodes, currentEdges);
      const idxB = getStoryboardIndex(b, currentNodes, currentEdges);
      if (idxA !== idxB) return idxA - idxB;
      return a.position.y - b.position.y;
    });

    // Calculate Bounding Box of ALL nodes to find a separate area
    const otherNodes =
      type === NodeType.INPUT
        ? currentNodes.filter((n) => n.type !== NodeType.INPUT && n.type !== NodeType.PROCESSOR)
        : currentNodes.filter((n) => n.type !== type);
    let startY = 50;

    if (otherNodes.length > 0) {
      const maxY = Math.max(...currentNodes.map((n) => n.position.y + (n.height || 280)));
      startY = maxY + 150;
    } else if (currentNodes.length > 0) {
      startY = 50;
    }

    const COLUMNS = 4;
    const START_X = 50;
    const GAP_X = 50;
    const GAP_Y = 50;
    const ITEM_WIDTH = 200;
    const ITEM_HEIGHT = 280;

    const rows = Math.ceil(targetNodes.length / COLUMNS);
    const rowTopY: number[] = [];
    if (type === NodeType.INPUT || type === NodeType.MOV) {
      const foldHeightByRootId = new Map<string, number>();
      if (doInputFold) {
        const dryClaimed = new Set<string>();
        for (const t of targetNodes) {
          const ids = collectDownstreamForInputChain(t.id, currentNodes, currentEdges, dryClaimed);
          const faux: RFNode =
            ids.length > 0
              ? { ...t, data: { ...t.data, chainFolderChildIds: ids } as NodeData }
              : t;
          foldHeightByRootId.set(t.id, estimateInputProcessorGridHeight(faux));
        }
      } else if (doMovFold) {
        for (const t of targetNodes) {
          // MOV 末端打组按“单根完整上游链”计算，不跨根去重，避免遗漏前序链路
          const ids = collectUpstreamForOutputChain(t.id, currentNodes, currentEdges, new Set<string>());
          const faux: RFNode =
            ids.length > 0
              ? {
                  ...t,
                  data: {
                    ...t.data,
                    chainFolderChildIds: ids,
                    chainFolderLabel: '上游',
                  } as NodeData,
                }
              : t;
          foldHeightByRootId.set(t.id, estimateInputProcessorGridHeight(faux));
        }
      }
      let yAcc = startY;
      for (let r = 0; r < rows; r++) {
        rowTopY[r] = yAcc;
        const slice = targetNodes.slice(r * COLUMNS, r * COLUMNS + COLUMNS);
        const rowDepth = Math.max(
          ITEM_HEIGHT,
          ...slice.map((t) =>
            (doInputFold || doMovFold)
              ? (foldHeightByRootId.get(t.id) ?? estimateInputProcessorGridHeight(t))
              : estimateInputProcessorGridHeight(t)
          )
        );
        yAcc += rowDepth + INPUT_LAYOUT_GAP_Y;
      }
    } else {
      for (let r = 0; r < rows; r++) {
        rowTopY[r] = startY + r * (ITEM_HEIGHT + GAP_Y);
      }
    }

    let newNodes = currentNodes.map((node) => {
      const shouldArrange =
        type === NodeType.INPUT
          ? node.type === NodeType.INPUT || node.type === NodeType.PROCESSOR
          : type === NodeType.MOV
            ? targetNodes.some((t) => t.id === node.id)
            : node.type === type;

      if (shouldArrange) {
        const index = targetNodes.findIndex((t) => t.id === node.id);
        const col = index % COLUMNS;
        const row = Math.floor(index / COLUMNS);

        return {
          ...node,
          position: {
            x: START_X + col * (ITEM_WIDTH + GAP_X),
            y: rowTopY[row] ?? startY + row * (ITEM_HEIGHT + INPUT_LAYOUT_GAP_Y),
          },
        };
      }
      return node;
    });

    let foldedRootsCount = 0;
    if (type === NodeType.INPUT && doInputFold) {
      const claimed = new Set<string>();
      const childToHide = new Set<string>();
      const foldByRoot = new Map<string, string[]>();
      for (const root of targetNodes) {
        const childIds = collectDownstreamForInputChain(root.id, newNodes, currentEdges, claimed);
        if (childIds.length === 0) continue;
        childIds.forEach((id) => childToHide.add(id));
        foldByRoot.set(root.id, childIds);
      }
      newNodes = newNodes
        .filter((n) => n.type !== NodeType.CHAIN_FOLDER)
        .map((n) => {
          if (childToHide.has(n.id)) return { ...n, hidden: true };
          const ids = foldByRoot.get(n.id);
          if (ids?.length && (n.type === NodeType.INPUT || n.type === NodeType.PROCESSOR)) {
            foldedRootsCount += 1;
            return {
              ...n,
              data: {
                ...n.data,
                chainFolderChildIds: ids,
                chainFolderExpanded: false,
                chainFolderLabel: '下游',
              } as NodeData,
            };
          }
          return n;
        });
      currentEdges = currentEdges.map((e) =>
        childToHide.has(e.source) || childToHide.has(e.target) ? { ...e, hidden: true } : e
      );
    } else if (type === NodeType.INPUT && !doInputFold) {
      // 与单次点击「下游」展开一致：按排序后的根顺序依次 applyChainFolderExpandLayout（含横向走廊让位、纵向避让）
      const expandClaimed = new Set<string>();
      const expandByRoot = new Map<string, string[]>();
      for (const t of targetNodes) {
        const ids = collectDownstreamForInputChain(t.id, newNodes, currentEdges, expandClaimed);
        if (ids.length > 0) expandByRoot.set(t.id, ids);
      }
      for (const t of targetNodes) {
        const ids = expandByRoot.get(t.id);
        if (!ids?.length) continue;
        newNodes = newNodes.map((n) =>
          n.id === t.id
            ? {
                ...n,
                data: {
                  ...n.data,
                  chainFolderChildIds: ids,
                  chainFolderExpanded: false,
                  chainFolderLabel: '下游',
                } as NodeData,
              }
            : n
        );
        const expanded = applyChainFolderExpandLayout(newNodes, currentEdges, { rootId: t.id });
        if (expanded) {
          newNodes = expanded.nodes;
          currentEdges = expanded.edges;
        }
      }
    } else if (type === NodeType.MOV && doMovFold) {
      const upstreamToHide = new Set<string>();
      const foldByRoot = new Map<string, string[]>();
      const targetRootIds = new Set(targetNodes.map((n) => n.id));
      const groupedRelationEdges = new Set<string>();
      for (const root of targetNodes) {
        // 每个末端节点独立收集全部上游（包括共享上游），确保“之前链接的所有节点”都进入该组
        let childIds = collectUpstreamForOutputChain(root.id, newNodes, currentEdges, new Set<string>());
        // 兜底1：若全链路收集为空但该根存在入边，则至少纳入直接父节点（可见边）
        if (childIds.length === 0) {
          const directParents = currentEdges
            .filter((e) => !e.hidden && e.target === root.id)
            .map((e) => e.source)
            .filter((sid, idx, arr) => sid !== root.id && arr.indexOf(sid) === idx);
          if (directParents.length > 0) {
            childIds = directParents;
          }
        }
        // 兜底2：若可见边仍为空，再从“全部边”取直接父节点，确保末层节点尽量带上游标识
        if (childIds.length === 0) {
          const directParentsAll = currentEdges
            .filter((e) => e.target === root.id)
            .map((e) => e.source)
            .filter((sid, idx, arr) => sid !== root.id && arr.indexOf(sid) === idx);
          if (directParentsAll.length > 0) {
            childIds = directParentsAll;
          }
        }
        if (childIds.length > 0) {
          childIds.forEach((sid) => groupedRelationEdges.add(`${sid}=>${root.id}`));
        }
        // 兜底：末端输出候选本身不参与被隐藏，否则会出现“有些输出看起来没打组”
        childIds.forEach((id) => {
          if (!targetRootIds.has(id)) upstreamToHide.add(id);
        });
        foldByRoot.set(root.id, childIds);
      }
      newNodes = newNodes
        .filter((n) => n.type !== NodeType.CHAIN_FOLDER)
        .map((n) => {
          // 末端模式：非目标 OUTPUT/MOV 统一隐藏，保证画面仅保留最后一层输出节点
          if ((n.type === NodeType.OUTPUT || n.type === NodeType.MOV) && !targetRootIds.has(n.id)) {
            return {
              ...n,
              hidden: true,
              data: {
                ...n.data,
                chainFolderChildIds: undefined,
                chainFolderExpanded: undefined,
                chainFolderLabel: undefined,
              } as NodeData,
            };
          }
          if (upstreamToHide.has(n.id)) return { ...n, hidden: true };
          const ids = foldByRoot.get(n.id);
          if (ids?.length && (n.type === NodeType.MOV || n.type === NodeType.OUTPUT)) {
            foldedRootsCount += 1;
            return {
              ...n,
              data: {
                ...n.data,
                chainFolderChildIds: ids,
                chainFolderExpanded: false,
                chainFolderLabel: '上游',
              } as NodeData,
            };
          }
          return n;
        });
      currentEdges = currentEdges.map((e) =>
        upstreamToHide.has(e.source) ||
        upstreamToHide.has(e.target) ||
        groupedRelationEdges.has(`${e.source}=>${e.target}`)
          ? { ...e, hidden: true }
          : e
      );
    } else if (type === NodeType.MOV && !doMovFold) {
      // 第二次点击：按根节点顺序逐个调用与手动点击一致的展开逻辑，自动让位占空间
      for (const t of targetNodes) {
        const expanded = applyChainFolderExpandLayout(newNodes, currentEdges, { rootId: t.id });
        if (expanded) {
          newNodes = expanded.nodes;
          currentEdges = expanded.edges;
        }
      }
    }

    if (type === NodeType.INPUT) {
      inputArrangeFoldOnNextClickRef.current = !inputArrangeFoldOnNextClickRef.current;
    } else if (type === NodeType.MOV) {
      movArrangeFoldOnNextClickRef.current = !movArrangeFoldOnNextClickRef.current;
    }

    const isBulkGraphExpand =
      (type === NodeType.INPUT && !doInputFold) || (type === NodeType.MOV && !doMovFold);
    let bulkExpandRevealIds: string[] | null = null;
    if (isBulkGraphExpand) {
      bulkExpandRevealIds = newNodes
        .filter((n) => hiddenBaselineBeforeArrange.get(n.id) === true && !n.hidden)
        .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
        .map((n) => n.id);
    }

    const scheduleArrangeFit = () => {
      setTimeout(() => {
        if (type === NodeType.INPUT || type === NodeType.MOV) {
          if (foldedRootsCount > 0) {
            const roots = targetNodes
              .map((t) => newNodes.find((n) => n.id === t.id))
              .filter(Boolean) as RFNode[];
            fitView({ nodes: roots, duration: 800, padding: 0.25 });
          } else {
            fitView({ duration: 800, padding: 0.18 });
          }
        } else {
          fitView({ nodes: targetNodes, duration: 800, padding: 0.2 });
        }
        setTimeout(() => setIsLayouting(false), 200);
      }, 50);
    };

    if (bulkExpandRevealIds && bulkExpandRevealIds.length >= FLOW_LAZY_HYDRATION_NODE_THRESHOLD) {
      hydrateGraphWithLazyReveal(newNodes, currentEdges, bulkExpandRevealIds, setNodes, setEdges, {
        onComplete: scheduleArrangeFit,
      });
    } else {
      setNodes(newNodes);
      setEdges(currentEdges);
      scheduleArrangeFit();
    }
  }, [
    isLayouting,
    getNodes,
    getEdges,
    setNodes,
    setEdges,
    fitView,
    getStoryboardIndex,
    compareNodesByDisplayName,
  ]);

  // 2. 工具栏：全图分层自动布局（DAG）；再点一次还原
  const handleAutoLayoutAll = useCallback(() => {
    if (isLayouting) return;
    setIsLayouting(true);
    if (autoLayoutSnapshotRef.current) {
      const snap = autoLayoutSnapshotRef.current;
      setNodes(snap.nodes);
      setEdges(snap.edges);
      autoLayoutSnapshotRef.current = null;
      setTimeout(() => {
        fitView({ duration: 800, padding: 0.1 });
        setTimeout(() => setIsLayouting(false), 200);
      }, 50);
      return;
    }

    const rawNodes = getNodes();
    const rawEdges = getEdges();
    autoLayoutSnapshotRef.current = {
      nodes: JSON.parse(JSON.stringify(rawNodes)),
      edges: JSON.parse(JSON.stringify(rawEdges)),
    };

    let currentNodes = stripChainFolderNodesAndUnhide(getNodes());
    const currentEdges = clearEdgesHiddenFlag(getEdges());

    const backdropNodes = currentNodes.filter((n) => n.type === NodeType.BACKDROP);
    currentNodes = currentNodes.filter((n) => n.type !== NodeType.BACKDROP);

    if (currentNodes.length === 0) {
      setIsLayouting(false);
      if (backdropNodes.length > 0) {
        setNodes(backdropNodes);
      }
      return;
    }

    const incomingEdges: Record<string, string[]> = {};
    currentNodes.forEach((n) => {
      incomingEdges[n.id] = [];
    });
    currentEdges.forEach((e) => {
      if (incomingEdges[e.target]) incomingEdges[e.target].push(e.source);
    });

    const ranks: Record<string, number> = {};
    const roots = currentNodes.filter(
      (n) =>
        n.type === NodeType.INPUT ||
        n.type === NodeType.PROCESSOR ||
        incomingEdges[n.id].length === 0
    );

    roots.sort((a, b) => {
      const byName = compareNodesByDisplayName(a, b);
      if (byName !== 0) return byName;
      return getStoryboardIndex(a, currentNodes, currentEdges) - getStoryboardIndex(b, currentNodes, currentEdges);
    });

    roots.forEach((n) => {
      ranks[n.id] = 0;
    });

    for (let i = 0; i < currentNodes.length; i++) {
      let changed = false;
      currentEdges.forEach((edge) => {
        const sourceRank = ranks[edge.source];
        if (sourceRank !== undefined) {
          if (ranks[edge.target] === undefined || ranks[edge.target] <= sourceRank) {
            ranks[edge.target] = sourceRank + 1;
            changed = true;
          }
        }
      });
      if (!changed) break;
    }

    const maxRank = Math.max(...Object.values(ranks), 0);
    const nodesByRank: RFNode[][] = Array.from({ length: maxRank + 1 }, () => []);

    currentNodes.forEach((n) => {
      const r = ranks[n.id] !== undefined ? ranks[n.id] : 0;
      nodesByRank[r].push(n);
    });

    const LAYER_WIDTH = 400;
    const NODE_HEIGHT = 320;
    let currentX = 50;

    nodesByRank.forEach((rankNodes, rIndex) => {
      if (rIndex === 0) {
        rankNodes.sort((a, b) => {
          const byName = compareNodesByDisplayName(a, b);
          if (byName !== 0) return byName;
          return (
            getStoryboardIndex(a, currentNodes, currentEdges) -
            getStoryboardIndex(b, currentNodes, currentEdges)
          );
        });
      } else {
        rankNodes.sort((a, b) => {
          const getParentsY = (nodeId: string) => {
            const parents = incomingEdges[nodeId]
              .map((pid) => currentNodes.find((n) => n.id === pid))
              .filter(Boolean) as RFNode[];
            if (parents.length === 0) return 0;
            return parents.reduce((sum, p) => sum + p.position.y, 0) / parents.length;
          };

          const avgA = getParentsY(a.id);
          const avgB = getParentsY(b.id);

          if (Math.abs(avgA - avgB) >= 10) {
            return avgA - avgB;
          }
          const sb =
            getStoryboardIndex(a, currentNodes, currentEdges) -
            getStoryboardIndex(b, currentNodes, currentEdges);
          if (sb !== 0) return sb;
          return compareNodesByDisplayName(a, b);
        });
      }

      let currentY = 50;
      rankNodes.forEach((node) => {
        node.position = { x: currentX, y: currentY };
        currentY += NODE_HEIGHT;
      });

      currentX += LAYER_WIDTH;
    });

    setNodes([...backdropNodes, ...currentNodes]);
    setEdges(currentEdges);

    setTimeout(() => {
      fitView({ duration: 800, padding: 0.1 });
      setTimeout(() => setIsLayouting(false), 200);
    }, 50);
  }, [isLayouting, getNodes, getEdges, setNodes, setEdges, fitView, getStoryboardIndex, compareNodesByDisplayName]);

  /** L 键：仅对当前选中节点竖排（每次执行排序，不还原） */
  const handleLayoutSelectedVertical = useCallback(() => {
    if (isLayouting) return;
    setIsLayouting(true);

    const rawNodes = getNodes();
    const rawEdges = getEdges();

    const layoutTargets = rawNodes
      .filter(
        (n) =>
          n.selected &&
          n.type !== NodeType.BACKDROP &&
          n.type !== NodeType.CHAIN_FOLDER
      )
      .map((n) => ({ ...n, position: { ...n.position } }));

    if (layoutTargets.length === 0) {
      setIsLayouting(false);
      return;
    }

    layoutTargets.sort((a, b) => {
      const byName = compareNodesByDisplayName(a, b);
      if (byName !== 0) return byName;
      const sb =
        getStoryboardIndex(a, rawNodes, rawEdges) - getStoryboardIndex(b, rawNodes, rawEdges);
      if (sb !== 0) return sb;
      return a.position.y - b.position.y || a.position.x - b.position.x;
    });

    const GAP_Y = 48;
    const DEFAULT_NODE_H = 320;
    const anchorX = Math.min(...layoutTargets.map((n) => n.position.x));
    let currentY = Math.min(...layoutTargets.map((n) => n.position.y));

    layoutTargets.forEach((node) => {
      node.position = { x: anchorX, y: currentY };
      const h = typeof node.height === 'number' && node.height > 0 ? node.height : DEFAULT_NODE_H;
      currentY += h + GAP_Y;
    });

    const posById = new Map(layoutTargets.map((n) => [n.id, n.position]));
    setNodes(
      rawNodes.map((n) => {
        const p = posById.get(n.id);
        return p ? { ...n, position: p } : n;
      })
    );

    setTimeout(() => {
      fitView({
        nodes: layoutTargets.map((n) => ({ id: n.id })),
        duration: 800,
        padding: 0.2,
      });
      setTimeout(() => setIsLayouting(false), 200);
    }, 50);
  }, [isLayouting, getNodes, getEdges, setNodes, setEdges, fitView, getStoryboardIndex, compareNodesByDisplayName]);

  // --- Video Sequencing Helper ---
  const handlePlaySequence = useCallback(() => {
      if (storyboardImages.length === 0) {
          alert("Storyboard is empty.");
          return;
      }

      const currentNodes = getNodes();
      const currentEdges = getEdges();
      const playlist: string[] = [];

      // Logic: Iterate through storyboard images in order
      storyboardImages.forEach(imgData => {
         const inputNode = currentNodes.find(n => 
             (n.type === NodeType.INPUT || n.type === NodeType.PROCESSOR) && 
             n.data.imagePreview === imgData
         );

         if (inputNode) {
             const edgesFromInput = currentEdges.filter(e => e.source === inputNode.id);
             edgesFromInput.forEach(edge => {
                 const targetNode = currentNodes.find(n => n.id === edge.target);
                 if (targetNode && targetNode.type === NodeType.MOV && targetNode.data.imagePreview) {
                     if (targetNode.data.imagePreview.match(/\.(mov|mp4|webm)/i) || targetNode.data.imagePreview.startsWith('blob:')) {
                         playlist.push(targetNode.data.imagePreview);
                     }
                 }
             });
         }
      });

      if (playlist.length === 0) {
          alert("No generated videos found linked to the storyboard images.");
      } else {
          setVideoPlaylist(playlist);
          setCurrentVideoIndex(0);
          setIsVideoPlayerOpen(true);
      }
  }, [storyboardImages, getNodes, getEdges]);

  // Alt+中键：临时平移画布（不切换手型工具，避免 mouseup 丢失后框选永久失效）
  useEffect(() => {
    const releaseAltMiddlePan = () => {
      if (!isAltMiddleMouseActiveRef.current) return;
      isAltMiddleMouseActiveRef.current = false;
      setIsAltMiddlePanActive(false);
    };

    const handleMouseDown = (event: MouseEvent) => {
      if (event.button === 1 && (event.altKey || event.getModifierState('Alt'))) {
        const target = event.target as HTMLElement;
        if (target.closest('.react-flow') || reactFlowWrapper.current?.contains(target)) {
          event.preventDefault();
          if (!isAltMiddleMouseActiveRef.current) {
            isAltMiddleMouseActiveRef.current = true;
            setIsAltMiddlePanActive(true);
          }
        }
      }
    };

    const handleMouseUp = (event: MouseEvent) => {
      if (event.button === 1) {
        releaseAltMiddlePan();
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Alt') {
        releaseAltMiddlePan();
      }
    };

    const handleContextMenu = (event: MouseEvent) => {
      if (event.button === 1 && (event.altKey || event.getModifierState('Alt'))) {
        event.preventDefault();
      }
    };

    window.addEventListener('mousedown', handleMouseDown, true);
    window.addEventListener('mouseup', handleMouseUp, true);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', releaseAltMiddlePan);
    window.addEventListener('contextmenu', handleContextMenu);
    
    return () => {
      window.removeEventListener('mousedown', handleMouseDown, true);
      window.removeEventListener('mouseup', handleMouseUp, true);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', releaseAltMiddlePan);
      window.removeEventListener('contextmenu', handleContextMenu);
    };
  }, []);

  const onSelectionStart = useCallback((event: React.MouseEvent) => {
    preserveInspectorAnchorRef.current = event.shiftKey;
    suppressInspectorClearRef.current = true;
  }, []);

  const onSelectionEnd = useCallback(() => {
    window.setTimeout(() => {
      preserveInspectorAnchorRef.current = false;
      suppressInspectorClearRef.current = false;
    }, 80);
  }, []);

  const onSelectionChange = useCallback(({ nodes }: OnSelectionChangeParams) => {
    const preserveAnchor =
      preserveInspectorAnchorRef.current ||
      (shiftHeldRef.current && Boolean(inspectorAnchorIdRef.current));
    setSelectedNodeId((prev) => {
      const result = resolveInspectorNodeIdOnSelectionChange({
        selectedNodeIds: nodes.map((n) => n.id),
        anchorId: inspectorAnchorIdRef.current,
        prevId: prev,
        suppressClear: suppressInspectorClearRef.current,
        preserveAnchor,
        shouldOpenInspector: (id) => {
          const n = nodes.find((x) => x.id === id);
          return n ? shouldOpenInspectorForNode(n) : false;
        },
      });
      inspectorAnchorIdRef.current = result.nextAnchor;
      setFlowgenInspectorAnchorId(result.nextAnchor);
      return result.nextId;
    });
  }, []);

  const updateNodeDataById = useCallback((nodeId: string, newData: Partial<NodeData>) => {
    if (!nodeId) return;
    setNodes((nds) => {
      let didChange = false;
      const nextNodes = nds.map((node) => {
        if (node.id !== nodeId) return node;
        const hasDiff = Object.entries(newData).some(([key, value]) => (node.data as any)[key] !== value);
        if (!hasDiff) return node;
        didChange = true;
        return { ...node, data: { ...node.data, ...newData } };
      });
      if (!didChange) return nds;
      const touchedNameLike = newData.customName !== undefined || newData.imageName !== undefined || newData.label !== undefined;
      if (!touchedNameLike) return nextNodes;

      const renamedNode = nextNodes.find((n) => n.id === nodeId);
      if (!renamedNode) return nextNodes;
      const nextOutputName =
        renamedNode.data.customName?.trim() ||
        renamedNode.data.imageName?.trim() ||
        renamedNode.data.label?.trim() ||
        'Untitled';

      // 同步更新所有「Generated Outputs」历史项名称，保证改名后历史列表与详情一致
      return nextNodes.map((n) => {
        const thumbs = n.data.generatedThumbnails;
        if (!Array.isArray(thumbs) || thumbs.length === 0) return n;
        let changed = false;
        const mapped = thumbs.map((t) => {
          if (t.nodeId !== nodeId) return t;
          changed = true;
          return { ...t, name: nextOutputName };
        });
        return changed ? { ...n, data: { ...n.data, generatedThumbnails: mapped } } : n;
      });
    });
  }, [setNodes]);

  // 更新多个选中节点的数据（支持按节点计算 patch，便于可灵 Omni / Seedance2 等多字段负向词）
  const updateSelectedNodesData = useCallback(
    (newData: Partial<NodeData> | ((node: RFNode) => Partial<NodeData>)) => {
      setNodes((nds) =>
        nds.map((node) => {
          if (!node.selected) return node;
          const patch = typeof newData === 'function' ? newData(node) : newData;
          const hasDiff = Object.entries(patch).some(([key, value]) => (node.data as any)[key] !== value);
          if (!hasDiff) return node;
          return { ...node, data: { ...node.data, ...patch } };
        })
      );
    },
    [setNodes]
  );

  /** 分镜表右键：按行克隆模板节点的下游节点并连线 */
  const spawnStoryboardDownstreamNodes = useCallback(
    (payload: { rows: string[][]; templateNodeId: string; strictExcelHeaders?: boolean }):
      | { ok: true; created: number }
      | { ok: false; error: string } => {
      const currentNodes = getNodes();
      const currentEdges = getEdges();
      const template = currentNodes.find((n) => n.id === payload.templateNodeId);
      if (!template) {
        return { ok: false, error: STORYBOARD_TEMPLATE_ERR };
      }

      const rawData = template.data as NodeData;
      const spawnProjectId =
        serverProjectId ||
        parseProjectAssetIdsFromMediaUrl(rawData.imagePreview)?.projectId;

      const templateData = normalizeTemplateNodeDataForSpawn(rawData, spawnProjectId);
      const assetCheck = validateTemplateUsesProjectAssetLibrary(templateData, spawnProjectId);
      if (assetCheck.ok === false) {
        return { ok: false, error: assetCheck.error };
      }

      const spawnRows = parseStoryboardSpawnRows(payload.rows, templateData, {
        strictExcelHeaders: payload.strictExcelHeaders,
      });
      if ('error' in spawnRows) {
        return { ok: false, error: spawnRows.error };
      }

      const room = FLOW_MAX_PERSISTED_NODES - currentNodes.length;
      if (room <= 0) {
        alert(`节点数量已达上限（${FLOW_MAX_PERSISTED_NODES}），无法继续创建`);
        return { ok: false, error: `节点数量已达上限（${FLOW_MAX_PERSISTED_NODES}）` };
      }

      let rowsToCreate = spawnRows;
      if (spawnRows.length > room) {
        alert(
          `节点数量上限为 ${FLOW_MAX_PERSISTED_NODES}，当前已有 ${currentNodes.length} 个，仅创建前 ${room} 个下游节点`
        );
        rowsToCreate = spawnRows.slice(0, room);
      }

      const outgoingCount = currentEdges.filter((e) => e.source === template.id).length;
      const templateType = String(template.type ?? '');
      const templateDataBase = stripSpawnedStoryboardNodeData(templateType, templateData);
      const newNodes: RFNode[] = [];
      const newEdges: Edge[] = [];
      const edgeAnimated = rowsToCreate.length <= 6;

      rowsToCreate.forEach((row, idx) => {
        const newId = getId();
        const promptPatch = buildScannedNodePromptPatch(
          { ...templateDataBase, ...row.durationPatch },
          projectAssetRefItems,
          row.prompt,
          projectAssetResolveOptsRef.current.projectAssets
        );
        const data: NodeData = enrichSpawnedStoryboardNodeData(
          {
            ...templateDataBase,
            label: row.shotId,
            // 分镜表批量生成时，将节点名/图片名统一成镜头号，便于后续缩略图追踪
            customName: row.shotId,
            imageName: row.shotId,
            // 画布卡片主预览区显示镜头号占位图（不改实际引用媒体）
            storyboardShotPreviewText: row.shotId,
            spawnHighlight: row.spawnHighlight,
            status: 'idle',
            ...row.durationPatch,
            ...promptPatch,
          },
          spawnProjectId,
          projectAssetBySlugRef.current,
          projectAssetResolveOptsRef.current.projectAssets
        );

        newNodes.push({
          id: newId,
          type: template.type,
          position: {
            x: template.position.x + 280,
            y: template.position.y + (outgoingCount + idx) * 250,
          },
          data,
          selected: idx === rowsToCreate.length - 1,
        });

        newEdges.push({
          id: `e${template.id}-${newId}`,
          source: template.id,
          target: newId,
          animated: edgeAnimated,
          style: { stroke: '#6366f1', strokeWidth: 2 },
        });
      });

      const cleared = currentNodes.map((n) => {
        if (n.id === template.id) {
          return {
            ...n,
            selected: false,
            data: { ...n.data, spawnHighlight: 'yellow' as const },
          };
        }
        if (n.selected) return { ...n, selected: false };
        return n;
      });
      const mergedNodes = [...cleared, ...newNodes];
      const mergedEdges = [...currentEdges, ...newEdges];

      suppressHistoryUntilRef.current = Date.now() + 4500;

      if (newNodes.length >= 10) {
        hydrateGraphWithLazyReveal(
          mergedNodes,
          mergedEdges,
          newNodes.map((n) => n.id),
          setNodes,
          setEdges
        );
      } else {
        setNodes(mergedNodes);
        setEdges(mergedEdges);
      }

      return { ok: true, created: rowsToCreate.length };
    },
    [
      getNodes,
      getEdges,
      setNodes,
      setEdges,
      projectAssetRefItems,
      serverProjectId,
    ]
  );

  const getLiveTemplateDataForSpawn = useCallback(
    (templateNodeId: string): NodeData | undefined => {
      const n = getNodes().find((x) => x.id === templateNodeId);
      return n?.data as NodeData | undefined;
    },
    [getNodes]
  );

  const beginSpawnStoryboardFromExcel = useCallback(() => {
    setNodeContextMenu(null);
    const currentNodes = getNodes();
    const liveSelected = currentNodes.filter(
      (n) =>
        n.selected &&
        n.type !== NodeType.BACKDROP &&
        n.type !== NodeType.CHAIN_FOLDER
    );
    if (liveSelected.length !== 1) {
      alert('请先在画布上选中 1 个节点作为模板，再按分镜表生成下游节点。');
      return;
    }
    const assetCheck = checkStoryboardTemplateAssetBinding(
      liveSelected[0].data as NodeData,
      serverProjectId ?? undefined
    );
    if (assetCheck.ok === false) {
      alert(assetCheck.error);
      return;
    }
    pendingStoryboardTemplateIdRef.current = liveSelected[0].id;
    storyboardExcelInputRef.current?.click();
  }, [getNodes, serverProjectId]);

  const handleStoryboardExcelFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0] ?? null;
      e.target.value = '';
      const templateId = pendingStoryboardTemplateIdRef.current;
      pendingStoryboardTemplateIdRef.current = null;
      if (!file || !templateId) return;

      const parsed = await parseStoryboardExcelFile(file);
      if (parsed.ok === false) {
        alert(parsed.error);
        return;
      }

      const currentNodes = getNodes();
      const liveSelected = currentNodes.filter((n) => n.id === templateId);
      const validation = validateStoryboardExcelTableSpawn(
        parsed.rows,
        liveSelected,
        liveSelected[0] ?? null,
        getLiveTemplateDataForSpawn,
        serverProjectId,
        currentNodes
      );
      if (validation.ok === false) {
        alert(validation.error);
        return;
      }

      const result = spawnStoryboardDownstreamNodes({
        rows: parsed.rows,
        templateNodeId: validation.templateNode.id,
        strictExcelHeaders: true,
      });
      if (result.ok === false) {
        alert(result.error);
      } else {
        alert(`已生成 ${result.created} 个下游节点`);
      }
    },
    [
      getNodes,
      getLiveTemplateDataForSpawn,
      serverProjectId,
      spawnStoryboardDownstreamNodes,
    ]
  );

  useEffect(() => {
    if (isGraphSideEffectPaused) return;
    setStablePanelSelectedNodes(selectedNodes);
  }, [selectedNodes, isGraphSideEffectPaused]);

  const toggleCanvasPerfAdvanced = useCallback(() => {
    setIsCanvasPerfAdvanced((prev) => {
      const next = !prev;
      if (next && isCanvasRefreshPaused) {
        setStablePanelSelectedNode(selectedNode || null);
        setStablePanelSelectedNodes(selectedNodes);
      }
      if (prev && !next && isCanvasRefreshPaused) {
        catchUpGraphSideEffects();
      }
      return next;
    });
  }, [
    isCanvasRefreshPaused,
    selectedNode,
    selectedNodes,
    catchUpGraphSideEffects,
  ]);

  // 导出选中的节点（包含连接关系）
  const handleExportNodes = useCallback(async () => {
    const currentNodes = getNodes();
    const currentEdges = getEdges();
    const nodesToExport = currentNodes.filter(n => n.selected);
    
    if (nodesToExport.length === 0) {
      alert('请先选择要导出的节点');
      setNodeContextMenu(null);
      return;
    }

    try {
      // 获取选中节点的ID集合
      const exportedNodeIds = new Set(nodesToExport.map(n => n.id));
      
      // 找出所有连接选中节点之间的边（边的source和target都在选中的节点中）
      const edgesToExport = currentEdges.filter(edge => 
        exportedNodeIds.has(edge.source) && exportedNodeIds.has(edge.target)
      );
      
      // 准备导出的数据
      const exportData = {
        nodes: nodesToExport.map(node => ({
          id: node.id,
          type: node.type,
          position: node.position,
          data: node.data,
          // 不包含 selected 状态，因为这是临时状态
        })),
        edges: edgesToExport.map(edge => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourceHandle,
          targetHandle: edge.targetHandle,
          animated: edge.animated,
          style: edge.style,
          // 保留边的其他属性
        })),
        exportedAt: new Date().toISOString(),
        nodeCount: nodesToExport.length,
        edgeCount: edgesToExport.length
      };

      const jsonStr = JSON.stringify(exportData, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });

      // 生成文件名
      const nodeLabels = nodesToExport.map(n => n.data.label || 'node').join('-');
      const fileName = `nodes-${nodeLabels.substring(0, 30)}-${Date.now()}.json`;

      // 尝试使用 File System Access API（现代浏览器）
      if ('showSaveFilePicker' in window) {
        try {
          const fileHandle = await (window as any).showSaveFilePicker({
            suggestedName: fileName,
            types: [{
              description: 'JSON Files',
              accept: { 'application/json': ['.json'] }
            }]
          });
          
          const writable = await fileHandle.createWritable();
          await writable.write(blob);
          await writable.close();
          
          setNodeContextMenu(null);
          alert(`✅ 已导出 ${nodesToExport.length} 个节点和 ${edgesToExport.length} 条连接关系到指定位置！`);
          return;
        } catch (err: any) {
          // 用户取消选择，不显示错误
          if (err.name === 'AbortError') {
            setNodeContextMenu(null);
            return;
          }
        }
      }

      // 传统下载方式
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      setNodeContextMenu(null);
      alert(`✅ 已导出 ${nodesToExport.length} 个节点和 ${edgesToExport.length} 条连接关系！请在浏览器下载对话框中确认保存位置。`);
    } catch (_error) {
      alert('❌ 导出节点失败，请重试或检查浏览器下载权限');
      setNodeContextMenu(null);
    }
  }, [getNodes, getEdges]);

  const copySelectedNodesToClipboard = useCallback(async () => {
    const currentNodes = getNodes();
    const currentEdges = getEdges();
    const selected = currentNodes.filter((n) => n.selected);
    if (selected.length === 0) return;
    const idSet = new Set(selected.map((n) => n.id));
    const edgesInternal = currentEdges.filter(
      (e) => idSet.has(e.source) && idSet.has(e.target)
    );
    const payload: FlowgenClipboardPayload = {
      [FLOWGEN_CLIPBOARD_MARKER]: true,
      version: FLOWGEN_CLIPBOARD_VERSION,
      nodes: selected.map((node) => ({
        id: node.id,
        type: String(node.type ?? ''),
        position: { ...node.position },
        data: JSON.parse(JSON.stringify(node.data)) as NodeData,
        width: node.width,
        height: node.height,
        style: node.style ? { ...node.style } : undefined,
      })),
      edges: edgesInternal.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        animated: e.animated,
        style: e.style as React.CSSProperties | undefined,
        type: e.type,
      })),
    };
    const serialized = JSON.stringify(payload);
    internalFlowNodeClipboardRef.current = serialized;
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(serialized);
      } catch (e) {
      }
    }
    // 非安全上下文下 navigator.clipboard 常为 undefined，不写控制台以免误导为「权限」问题
  }, [getNodes, getEdges]);

  /** Nuke 风格：为当前选中节点创建背景框（置于节点下层，拖动框体时带动子节点） */
  const handleCreateBackdropFromSelection = useCallback(() => {
    const nds = getNodes();
    const selected = nds.filter((n) => n.selected);
    const subjects = selected.filter(
      (n) => n.type !== NodeType.BACKDROP && n.type !== NodeType.CHAIN_FOLDER
    );
    if (subjects.length === 0) {
      alert('请先框选或选中至少一个画布节点（背景框、链路夹除外）');
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of subjects) {
      const r = getNodeBoundingRectForBackdrop(n);
      minX = Math.min(minX, r.left);
      minY = Math.min(minY, r.top);
      maxX = Math.max(maxX, r.right);
      maxY = Math.max(maxY, r.bottom);
    }
    const pad = 44;
    const bx = minX - pad;
    const by = minY - pad;
    const bw = Math.max(280, maxX - minX + pad * 2);
    const bh = Math.max(200, maxY - minY + pad * 2);
    const childIds = subjects.map((n) => n.id);
    const nid = getId();
    const backdrop: RFNode = {
      id: nid,
      type: NodeType.BACKDROP,
      position: { x: bx, y: by },
      width: bw,
      height: bh,
      style: { width: bw, height: bh, zIndex: -1 },
      selectable: true,
      draggable: true,
      selected: true,
      data: {
        label: 'Backdrop',
        backdropLabel: 'Backdrop',
        backdropRenamePending: true,
        backdropChildIds: childIds,
        backdropFill: 'rgba(99, 102, 241, 0.07)',
        backdropBorder: 'rgba(129, 140, 248, 0.55)',
      } as NodeData,
    };
    setNodes((prev) => {
      const cleared = prev.map((n) => ({ ...n, selected: false }));
      return [{ ...backdrop, selected: true }, ...cleared];
    });
    setSelectedNodeId(null);
    setNodeContextMenu(null);
  }, [getNodes, setNodes]);

  const onBackdropDragStart: NodeDragHandler = useCallback(
    (_, node) => {
      if (node.type !== NodeType.BACKDROP) {
        backdropDragStateRef.current = null;
        return;
      }
      const all = getNodes();
      const allById = new Map(all.map((n) => [n.id, n] as const));
      const childIdSet = new Set<string>([
        ...((node.data as NodeData).backdropChildIds || []),
        ...collectNodeIdsInsideBackdropFrame(node, all),
      ]);
      const childPositions = new Map<string, XYPosition>();
      for (const cid of childIdSet) {
        const c = allById.get(cid);
        if (c) childPositions.set(cid, { ...c.position });
      }
      backdropDragStateRef.current = {
        backdropId: node.id,
        backdropStart: { ...node.position },
        childPositions,
      };
    },
    [getNodes]
  );

  const onBackdropDrag: NodeDragHandler = useCallback(
    (_, node) => {
      const st = backdropDragStateRef.current;
      if (!st || node.type !== NodeType.BACKDROP || node.id !== st.backdropId) return;
      const dx = node.position.x - st.backdropStart.x;
      const dy = node.position.y - st.backdropStart.y;
      backdropDragPendingOffsetRef.current = { x: dx, y: dy };
      if (backdropDragRafRef.current != null) return;
      backdropDragRafRef.current = window.requestAnimationFrame(() => {
        backdropDragRafRef.current = null;
        const active = backdropDragStateRef.current;
        const offset = backdropDragPendingOffsetRef.current;
        backdropDragPendingOffsetRef.current = null;
        if (!active || !offset) return;
        const prev = backdropDragLastAppliedOffsetRef.current;
        if (prev && prev.x === offset.x && prev.y === offset.y) return;
        const now = Date.now();
        if (now - backdropDragLastCommitAtRef.current < 32) {
          backdropDragPendingOffsetRef.current = offset;
          return;
        }
        backdropDragLastCommitAtRef.current = now;
        backdropDragLastAppliedOffsetRef.current = offset;
        setNodes((nds) => {
          if (active.childPositions.size === 0) return nds;
          let nextNodes: RFNode[] | null = null;
          for (let i = 0; i < nds.length; i++) {
            const n = nds[i];
            const base = active.childPositions.get(n.id);
            if (!base) continue;
            const nx = base.x + offset.x;
            const ny = base.y + offset.y;
            if (n.position.x === nx && n.position.y === ny) continue;
            if (!nextNodes) nextNodes = nds.slice();
            nextNodes[i] = { ...n, position: { x: nx, y: ny } };
          }
          return nextNodes || nds;
        });
      });
    },
    [setNodes]
  );

  const onBackdropDragStop: NodeDragHandler = useCallback((_, node, draggedNodes) => {
    if (backdropDragRafRef.current != null) {
      window.cancelAnimationFrame(backdropDragRafRef.current);
      backdropDragRafRef.current = null;
    }
    const finalOffset = backdropDragPendingOffsetRef.current;
    const active = backdropDragStateRef.current;
    backdropDragPendingOffsetRef.current = null;
    backdropDragLastAppliedOffsetRef.current = null;
    backdropDragLastCommitAtRef.current = 0;
    if (active && finalOffset) {
      setNodes((nds) => {
        if (active.childPositions.size === 0) return nds;
        let nextNodes: RFNode[] | null = null;
        for (let i = 0; i < nds.length; i++) {
          const n = nds[i];
          const base = active.childPositions.get(n.id);
          if (!base) continue;
          const nx = base.x + finalOffset.x;
          const ny = base.y + finalOffset.y;
          if (n.position.x === nx && n.position.y === ny) continue;
          if (!nextNodes) nextNodes = nds.slice();
          nextNodes[i] = { ...n, position: { x: nx, y: ny } };
        }
        return nextNodes || nds;
      });
    }
    backdropDragStateRef.current = null;

    if (node.type === NodeType.BACKDROP) {
      setNodes((nds) => setBackdropChildrenFromGeometry(nds, node.id));
      return;
    }

    const raw = draggedNodes && draggedNodes.length > 0 ? draggedNodes : [node];
    const list = raw.filter((n) => n.type !== NodeType.BACKDROP && n.type !== NodeType.CHAIN_FOLDER);
    if (list.length === 0) return;

    setNodes((nds) => syncBackdropMembershipForNodes(nds, list.map((d) => d.id)));
  }, [setNodes]);
  const handleNodeDragStart: NodeDragHandler = useCallback((event, node, draggedNodes) => {
    enterDragPerformanceMode();
    onBackdropDragStart(event, node, draggedNodes);
  }, [enterDragPerformanceMode, onBackdropDragStart]);
  const handleNodeDragStop: NodeDragHandler = useCallback((event, node, draggedNodes) => {
    try {
      onBackdropDragStop(event, node, draggedNodes);
    } finally {
      exitDragPerformanceMode();
      triggerViewportContentRefresh();
    }
  }, [exitDragPerformanceMode, onBackdropDragStop, triggerViewportContentRefresh]);

  const pasteNodesFromClipboard = useCallback(async () => {
    let parsedPayload: { raw: Record<string, unknown>; nodesIn: FlowgenClipboardNode[] } | null = null;
    if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
      try {
        const sysText = await navigator.clipboard.readText();
        parsedPayload = tryParseFlowgenClipboardForPaste(sysText);
      } catch (e) {
      }
    }
    if (!parsedPayload && internalFlowNodeClipboardRef.current) {
      parsedPayload = tryParseFlowgenClipboardForPaste(internalFlowNodeClipboardRef.current);
    }
    if (!parsedPayload) return;

    const { raw, nodesIn: nodesInInitial } = parsedPayload;
    let nodesIn = nodesInInitial;

    const currentNodes = getNodes();
    const currentEdges = getEdges();
    const room = FLOW_MAX_PERSISTED_NODES - currentNodes.length;
    if (room <= 0) {
      alert(`节点数量已达上限（${FLOW_MAX_PERSISTED_NODES}），无法粘贴`);
      return;
    }
    if (nodesIn.length > room) {
      alert(
        `节点数量上限为 ${FLOW_MAX_PERSISTED_NODES}，当前已有 ${currentNodes.length} 个，仅粘贴前 ${room} 个`
      );
      nodesIn = nodesIn.slice(0, room);
    }

    const keptIds = new Set(nodesIn.map((n) => n.id));
    const edgesRaw = Array.isArray(raw.edges) ? raw.edges : [];
    const edgesIn = edgesRaw.filter(
      (e: { source?: string; target?: string }) =>
        e &&
        typeof e.source === 'string' &&
        typeof e.target === 'string' &&
        keptIds.has(e.source) &&
        keptIds.has(e.target)
    ) as FlowgenClipboardPayload['edges'];

    const idMap = new Map<string, string>();
    for (const n of nodesIn) {
      idMap.set(n.id, getId());
    }

    const center = screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    const ax = nodesIn.reduce((s, n) => s + n.position.x, 0) / nodesIn.length;
    const ay = nodesIn.reduce((s, n) => s + n.position.y, 0) / nodesIn.length;
    const dx = center.x - ax;
    const dy = center.y - ay;

    const newNodes: RFNode[] = nodesIn.map((n) => {
      const newId = idMap.get(n.id)!;
      const base = JSON.parse(JSON.stringify(n.data)) as NodeData;
      let data = stripPastedFlowNodeHistory(String(n.type ?? ''), base);
      if (data.generatedThumbnails?.length) {
        data = {
          ...data,
          generatedThumbnails: data.generatedThumbnails.map((t) => {
            const mappedNodeId = t.nodeId ? idMap.get(t.nodeId) : undefined;
            const mappedId = t.id ? idMap.get(t.id) : undefined;
            return {
              ...t,
              ...(mappedId ? { id: mappedId } : {}),
              ...(mappedNodeId ? { nodeId: mappedNodeId } : {}),
            };
          }),
        };
      }
      if (String(n.type) === NodeType.BACKDROP) {
        const oldIds = base.backdropChildIds || [];
        data = {
          ...data,
          backdropChildIds: oldIds.map((oid) => idMap.get(oid)).filter((x): x is string => !!x),
        };
      }
      const rf: RFNode = {
        id: newId,
        type: n.type,
        position: { x: n.position.x + dx, y: n.position.y + dy },
        data,
        selected: true,
      };
      if (String(n.type) === NodeType.BACKDROP) {
        const cn = n as FlowgenClipboardNode;
        if (typeof cn.width === 'number' && cn.width > 0) {
          rf.width = cn.width;
          rf.style = { ...(rf.style || {}), width: cn.width };
        }
        if (typeof cn.height === 'number' && cn.height > 0) {
          rf.height = cn.height;
          rf.style = { ...(rf.style || {}), height: cn.height };
        }
      }
      return rf;
    });

    const newEdges: Edge[] = edgesIn.map((e) => ({
      ...e,
      id: `e_${getId()}`,
      source: idMap.get(e.source)!,
      target: idMap.get(e.target)!,
    }));

    const maxE = FLOW_MAX_PERSISTED_EDGES;
    let finalEdges = [...currentEdges, ...newEdges];
    if (finalEdges.length > maxE) {
      const allowedNew = Math.max(0, maxE - currentEdges.length);
      if (allowedNew <= 0) {
        alert(`连线数量已达上限（${maxE}），无法粘贴`);
        return;
      }
      alert(`连线数量上限为 ${maxE}，仅保留前 ${allowedNew} 条新连线`);
      finalEdges = [...currentEdges, ...newEdges.slice(0, allowedNew)];
    }

    const clearedSelection = currentNodes.map((n) => ({ ...n, selected: false }));
    const mergedAfterPaste = [...clearedSelection, ...newNodes];
    if (newNodes.length >= FLOW_LAZY_HYDRATION_NODE_THRESHOLD) {
      hydrateGraphWithLazyReveal(
        mergedAfterPaste,
        finalEdges,
        newNodes.map((n) => n.id),
        setNodes,
        setEdges
      );
    } else {
      setNodes(mergedAfterPaste);
      setEdges(finalEdges);
    }

    if (newNodes.length === 1) {
      setSelectedNodeId(newNodes[0].id);
    } else {
      setSelectedNodeId(null);
    }

    requestAnimationFrame(() => {
      reactFlowWrapper.current?.focus();
    });
  }, [getNodes, getEdges, screenToFlowPosition, setNodes, setEdges]);

  // Keyboard: Esc / undo-redo / Ctrl+C 复制节点(JSON，含大图 Base64) / Ctrl+V 粘贴节点 / L 布局 / F 聚焦所选节点；有文本选区时 Ctrl+C 不劫持
  useEffect(() => {
    const isTextEntryTarget = (el: HTMLElement | null) => {
      if (!el) return false;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return true;
      if (el.closest('[data-flowgen-node-inspector], [data-flowgen-chat-panel]')) return true;
      return false;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        stopExecutionRef.current = true;
        setPreviewNode(null);
        setIsVideoPlayerOpen(false);
        setIsGlobalRunning(false);
        return;
      }

      const activeElement = document.activeElement as HTMLElement;
      const isInputFocused = isTextEntryTarget(activeElement);

      if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey) {
        if (!isInputFocused) {
          event.preventDefault();
          handleUndo();
        }
        return;
      }

      if ((event.ctrlKey || event.metaKey) && (event.key === 'y' || (event.key === 'z' && event.shiftKey))) {
        if (!isInputFocused) {
          event.preventDefault();
          handleRedo();
        }
        return;
      }

      if ((event.ctrlKey || event.metaKey) && (event.key === 'c' || event.key === 'C')) {
        let selectedPlainTextLen = 0;
        try {
          const sel = window.getSelection();
          selectedPlainTextLen = sel?.toString().trim().length ?? 0;
        } catch {
          /* ignore */
        }
        // 正在复制页面上选中的可见文字（如 Node Details 里的 Prompt 区块是 div，不是 input）
        if (!isInputFocused && selectedPlainTextLen > 0) {
          return;
        }
        if (!isInputFocused) {
          const selected = getNodes().filter((n) => n.selected);
          if (selected.length > 0) {
            event.preventDefault();
            void copySelectedNodesToClipboard();
          }
        }
        return;
      }

      if ((event.ctrlKey || event.metaKey) && (event.key === 'v' || event.key === 'V')) {
        if (isInputFocused) return;
        const internal = internalFlowNodeClipboardRef.current;
        if (internal && tryParseFlowgenClipboardForPaste(internal)) {
          event.preventDefault();
          void pasteNodesFromClipboard();
        }
        return;
      }

      if (isInputFocused) {
        return;
      }

      if (event.key.toLowerCase() === 'l') {
        event.preventDefault();
        event.stopPropagation();
        handleLayoutSelectedVertical();
        return;
      }

      if (event.key === 'f' || event.key === 'F') {
        const selected = getNodes().filter((n) => n.selected);
        if (selected.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        requestAnimationFrame(() => {
          fitView({
            nodes: selected.map((n) => ({ id: n.id })),
            duration: 450,
            padding: 0.2,
            minZoom: 0.08,
            maxZoom: 4,
          });
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [
    getNodes,
    fitView,
    handleLayoutSelectedVertical,
    handleUndo,
    handleRedo,
    copySelectedNodesToClipboard,
    pasteNodesFromClipboard,
  ]);

  // 创建 input picture node 的回调函数
  const handleCreateInputNode = useCallback((imageUrl: string) => {
    // 在画布中心位置创建节点
    const centerPosition = screenToFlowPosition({ 
      x: window.innerWidth / 2, 
      y: window.innerHeight / 2 
    });
    
    const newNode: RFNode = {
      id: getId(),
      type: NodeType.INPUT,
      position: centerPosition,
      data: { 
        label: 'Input Picture Node',
        imagePreview: imageUrl,
        selectedModel: MODEL_NANO_BANANA_2,
        imageName: `Extracted_Frame_${Date.now()}.jpg`,
        status: 'idle',
      },
      selected: true,
    };
    
    // 取消其他节点的选中状态，选中新节点
    setNodes((nds) => {
      const nextNodes = nds.map((n) => (n.selected ? { ...n, selected: false } : n));
      return [...nextNodes, newNode];
    });
  }, [screenToFlowPosition, setNodes]);


  const onPaneClick = useCallback((event?: React.MouseEvent) => {
    // 如果点击事件存在，检查是否点击在菜单上
    if (event) {
      const target = event.target as HTMLElement;
      // 如果点击的是菜单或其子元素，不关闭菜单
      if (target.closest('.node-context-menu') || target.closest('.run-schedule-menu')) {
        return;
      }
    }

    suppressInspectorClearRef.current = false;
    preserveInspectorAnchorRef.current = false;
    
    if (reactFlowWrapper.current) {
      reactFlowWrapper.current.focus();
    }
    setMenu(null);
    setNodeContextMenu(null); // Close context menu
    setRunScheduleMenu(null);
    setCustomTimePicker(null);
    inspectorAnchorIdRef.current = null;
    setFlowgenInspectorAnchorId(null);
    setSelectedNodeId(null);
  }, []);

  const openNodeContextMenuAtClient = useCallback((clientX: number, clientY: number) => {
    if (!reactFlowWrapper.current) return;
    const pane = reactFlowWrapper.current.getBoundingClientRect();
    setMenu(null);
    setNodeContextMenu({
      x: clientX - pane.left,
      y: clientY - pane.top,
    });
  }, []);

  const countContextMenuRunSubjects = useCallback((list: RFNode[]) => {
    return list.filter(
      (n) => n.type !== NodeType.BACKDROP && n.type !== NodeType.CHAIN_FOLDER
    ).length;
  }, []);

  // 画布空白区域右键菜单（支持框选后的节点）
  const onPaneContextMenu = useCallback(
    (event: React.MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('.react-flow__node')) {
        return;
      }

      event.preventDefault();

      const currentNodes = getNodes();
      const selectedNodes = currentNodes.filter((n) => n.selected);
      const subjectCount = countContextMenuRunSubjects(selectedNodes);

      if (subjectCount > 0) {
        openNodeContextMenuAtClient(event.clientX, event.clientY);
      } else if (reactFlowWrapper.current) {
        const pane = reactFlowWrapper.current.getBoundingClientRect();
        const flowPos = screenToFlowPosition({
          x: event.clientX - pane.left,
          y: event.clientY - pane.top,
        });
        setNodeContextMenu(null);
        setMenu({
          x: event.clientX - pane.left,
          y: event.clientY - pane.top,
          flowPosition: flowPos,
        });
      }
    },
    [getNodes, screenToFlowPosition, openNodeContextMenuAtClient, countContextMenuRunSubjects]
  );

  /** 框选虚线区域上右键（React Flow 不会走 onPaneContextMenu） */
  const onSelectionContextMenu = useCallback(
    (event: React.MouseEvent, selectedFlowNodes: RFNode[]) => {
      event.preventDefault();
      event.stopPropagation();
      if (countContextMenuRunSubjects(selectedFlowNodes) === 0) return;
      openNodeContextMenuAtClient(event.clientX, event.clientY);
    },
    [openNodeContextMenuAtClient, countContextMenuRunSubjects]
  );

  // --- Node Context Menu Handler ---
  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: RFNode) => {
      event.preventDefault(); // Block browser native menu
      event.stopPropagation(); // 阻止事件冒泡，避免触发 onPaneContextMenu
      
      // 获取当前所有选中的节点
      const currentNodes = getNodes();
      const selectedNodes = currentNodes.filter(n => n.selected);

      // 如果当前有多个节点被选中，且右键点击的节点也在选中列表中，保持多选状态
      // 如果右键点击的节点没有被选中，但有其他节点被选中，将当前节点加入选择并保持其他选择
      // 如果没有任何节点被选中，只选中当前节点
      if (selectedNodes.length > 0) {
          // 如果右键点击的节点不在选中列表中，将其加入选择
          if (!node.selected) {
              setNodes((nds) => nds.map((n) => {
                  const nextSelected = n.id === node.id || n.selected;
                  return n.selected === nextSelected ? n : { ...n, selected: nextSelected };
              }));
          }
          // 已在选中列表中时保持当前多选状态（不改变）
      } else {
          // 没有任何节点被选中，只选中当前节点
          setNodes((nds) => nds.map((n) => {
              const nextSelected = n.id === node.id;
              return n.selected === nextSelected ? n : { ...n, selected: nextSelected };
          }));
      }
      
      openNodeContextMenuAtClient(event.clientX, event.clientY);
    },
    [setNodes, getNodes, openNodeContextMenuAtClient]
  );

  // --- Drag-to-Create Connection State ---
  const connectingNodeId = useRef<string | null>(null);
  const connectingHandleType = useRef<string | null>(null);
  
  const [menu, setMenu] = useState<{ 
    x: number; 
    y: number; 
    flowPosition: XYPosition; 
  } | null>(null);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge({ 
      ...params, 
      animated: true, 
      style: { stroke: '#6366f1', strokeWidth: 2 } 
    }, eds)),
    [setEdges]
  );

  const onConnectStart: OnConnectStart = useCallback((_, { nodeId, handleType }: OnConnectStartParams) => {
    connectingNodeId.current = nodeId;
    connectingHandleType.current = handleType;
  }, []);

  const onConnectEnd: OnConnectEnd = useCallback(
    (event) => {
      if (!connectingNodeId.current) return;

      const targetIsPane = (event.target as Element).classList.contains('react-flow__pane');

      if (targetIsPane && reactFlowWrapper.current) {
        const clientX = (event as MouseEvent | TouchEvent).type.includes('touch') 
            ? (event as TouchEvent).changedTouches[0].clientX 
            : (event as MouseEvent).clientX;
        const clientY = (event as MouseEvent | TouchEvent).type.includes('touch') 
            ? (event as TouchEvent).changedTouches[0].clientY 
            : (event as MouseEvent).clientY;

        const { top, left } = reactFlowWrapper.current.getBoundingClientRect();
        
        const flowPos = screenToFlowPosition({
            x: clientX,
            y: clientY,
        });

        setMenu({
          x: clientX - left,
          y: clientY - top,
          flowPosition: flowPos,
        });
      }
    },
    [screenToFlowPosition]
  );

  const addNodeFromMenu = useCallback((type: NodeType, label: string) => {
    if (!menu || !connectingNodeId.current) return;

    const id = getId();
    const adjustedY = menu.flowPosition.y - 150; // Center the tall node
    
    const newNode: RFNode = {
      id,
      type,
      position: { x: menu.flowPosition.x, y: adjustedY },
      data: { label, description: `Auto-created ${label}`, imageName: 'New_Node.png' },
    };

    // Use spread syntax instead of concat
    setNodes((nds) => [...nds, newNode]);

    const newEdge: Edge = {
      id: `e${connectingNodeId.current}-${id}`,
      source: connectingHandleType.current === 'source' ? connectingNodeId.current : id,
      target: connectingHandleType.current === 'source' ? id : connectingNodeId.current,
      animated: true,
      style: { stroke: '#6366f1', strokeWidth: 2 },
    };

    // Use spread syntax instead of concat
    setEdges((eds) => [...eds, newEdge]);
    
    setMenu(null);
    connectingNodeId.current = null;
    connectingHandleType.current = null;
  }, [menu, setNodes, setEdges]);

  const closeMenu = useCallback(() => {
    setMenu(null);
    connectingNodeId.current = null;
    connectingHandleType.current = null;
  }, []);

  // --- React Drag & Drop Handlers ---
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (!isDragOver) setIsDragOver(true);
  }, [isDragOver]);

  const onDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    if (reactFlowWrapper.current && !reactFlowWrapper.current.contains(event.relatedTarget as Node)) {
       setIsDragOver((prev) => (prev ? false : prev));
    }
  }, []);

  // 按 Esc 关闭「Drop Image to Create Node」覆盖层
  useEffect(() => {
    if (!isDragOver) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsDragOver((prev) => (prev ? false : prev));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isDragOver]);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setIsDragOver((prev) => (prev ? false : prev));

      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });

      // 1. Handle Multi-Image Internal Drop
      // TRY READ FROM WINDOW FIRST (Safe from size limits)
      let images: string[] = (window as any).__flowGenDragImages || [];
      
      // Fallback to dataTransfer if window is empty
      if (images.length === 0) {
          const internalImagesStr = event.dataTransfer.getData('application/flowgen/images');
          if (internalImagesStr) {
             try { images = JSON.parse(internalImagesStr); } catch(e) {}
          }
      }
      
      // Also check for single image payload just in case (Legacy)
      const internalImage = event.dataTransfer.getData('application/flowgen/image');

      // INTERNAL SIDEBAR DROP - compress large images before storing
      if (Array.isArray(images) && images.length > 0) {
            Promise.all(images.map((img) => prepareCanvasNodeImagePreview(img).catch(() => img))).then(
              (compressedImages) => {
              const newNodes: RFNode[] = compressedImages.map((img, index) => {
                const offsetX = index * 40;
                const offsetY = index * 40;
                return {
                  id: getId(),
                  type: NodeType.PROCESSOR,
                  position: { x: position.x + offsetX, y: position.y + offsetY },
                  data: {
                    label: 'Input Picture Node',
                    imagePreview: img,
                    selectedModel: MODEL_NANO_BANANA_2,
                    imageName: `Imported_${index + 1}.png`,
                  },
                  selected: true,
                };
              });
              setNodes((nds) => {
                const cleared = nds.map((n) => (n.selected ? { ...n, selected: false } : n));
                return [...cleared, ...newNodes];
              });
            });
            return;
      }

      if (internalImage) {
          const apply = (img: string) => {
            const newNode: RFNode = {
              id: getId(),
              type: NodeType.PROCESSOR,
              position,
              data: {
                label: 'Input Picture Node',
                imagePreview: img,
                selectedModel: MODEL_NANO_BANANA_2,
                imageName: 'Asset_Image.png',
              },
              selected: true,
            };
            setNodes((nds) => {
              const cleared = nds.map((n) => (n.selected ? { ...n, selected: false } : n));
              return [...cleared, newNode];
            });
          };
          void prepareCanvasNodeImagePreview(internalImage)
            .then(apply)
            .catch(() => apply(internalImage));
          return;
      }

      // 2. Handle External File Drop — 先用 blob 立即可见，后台再压缩替换
      if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
          const validFiles = Array.from(event.dataTransfer.files).filter(f => f.type.startsWith('image/'));
          if (validFiles.length > 0) {
              const BATCH_SIZE = 3;
              const processBatch = (start: number) => {
                  const batch = validFiles.slice(start, start + BATCH_SIZE);
                  if (batch.length === 0) return;
                  const specs = batch.map((file, i) => {
                    const index = start + i;
                    const nodeId = getId();
                    const quickUrl = URL.createObjectURL(file);
                    const localRef = buildLocalMediaRef(localMediaScope, nodeId, 'main');
                    getOriginals(nodeId).main = file;
                    void putLocalMediaFile(localRef, file)
                      .then(() => {
                        window.dispatchEvent(new CustomEvent('flowgen:persist-request'));
                        if (serverProjectId) scheduleRemoteWorkspaceSave();
                      })
                      .catch((e) => console.warn('[flowgen] local media IDB write failed', e));
                    return { nodeId, file, index, quickUrl, localRef };
                  });
                  setNodes((nds) => {
                    const next: RFNode[] = nds.map((n) =>
                      n.selected ? ({ ...n, selected: false }) : n
                    );
                    specs.forEach((spec, i) => {
                      next.push({
                        id: spec.nodeId,
                        type: NodeType.PROCESSOR,
                        position: { x: position.x + spec.index * 240, y: position.y + spec.index * 60 },
                        data: {
                          label: 'Input Picture Node',
                          imagePreview: spec.quickUrl,
                          imageLocalRef: spec.localRef,
                          selectedModel: MODEL_NANO_BANANA_2,
                          imageName: spec.file.name,
                        },
                        selected:
                          start + batch.length >= validFiles.length && i === batch.length - 1,
                      });
                    });
                    return next;
                  });
                  if (start + BATCH_SIZE < validFiles.length) {
                    setTimeout(() => processBatch(start + BATCH_SIZE), 50);
                  }
              };
              processBatch(0);
          }
      }
    },
    [screenToFlowPosition, setNodes, localMediaScope, serverProjectId, scheduleRemoteWorkspaceSave]
  );

  const handleNodeRun = useCallback(async (targetNodeId?: string) => {
      // Use targetNodeId if provided (for automation), else fall back to selected
      const idToRun = targetNodeId || selectedNodeId;
      if (!idToRun) return;

      // 刷新后 ReactFlow store 可能短暂滞后，优先取 store，取不到时回退到本地 nodes state
      const currentNode = getNodes().find(n => n.id === idToRun) || nodes.find(n => n.id === idToRun);
      if (!currentNode) {
          updateNodeDataById(idToRun, { status: 'error', progress: 0, errorMessage: '未找到当前节点，请重试一次' });
          return;
      }
      if (isImage2Model(currentNode.data.selectedModel || '')) {
          logImage2Debug('handleNodeRun-enter', {
              nodeId: idToRun,
              nodeType: currentNode.type,
              status: currentNode.data.status,
              selectedModel: currentNode.data.selectedModel,
              refsCount: Array.isArray(currentNode.data.referenceImages) ? currentNode.data.referenceImages.length : 0,
          });
      }
      // 防重入：同一节点运行中再次触发会造成并发上传/轮询与高频状态写入，容易拖垮页面
      if (currentNode.data.status === 'running') return;

      activeRunIdsRef.current.add(idToRun);

      const stageRunPersistPatch = (patch: Partial<NodeData>) => {
        const prev = pendingRunPersistPatchesRef.current.get(idToRun) || {};
        const next: Partial<NodeData> = { ...prev, ...patch };
        if (patch.generationParams) {
          next.generationParams = {
            ...(prev.generationParams || {}),
            ...patch.generationParams,
          } as GenerationParams;
        }
        pendingRunPersistPatchesRef.current.set(idToRun, next);
      };

      /** 运行前：统一 tab/顶层创意描述，并把可识别的 @图片n 写成 @资产:展示名（各模型共用） */
      const promptCanonPatch = buildCanonicalInspectorPromptPatch(
        currentNode.data,
        projectAssetResolveOptsRef.current.projectAssets
      );
      if (promptCanonPatch) {
        updateNodeDataById(idToRun, promptCanonPatch);
      }
      const runDataBase: NodeData = promptCanonPatch
        ? ({ ...currentNode.data, ...promptCanonPatch } as NodeData)
        : (currentNode.data as NodeData);

      /** 本次运行开始时的节点数据快照（轮询/异步完成时 store 可能已被其它运行改掉，generationParams 必须以此为准） */
      const runStartDataSnapshot: NodeData = JSON.parse(JSON.stringify(runDataBase)) as NodeData;

      const originalsBoot = getOriginals(idToRun);
      if (!originalsBoot.main && currentNode.data.imageLocalRef) {
        const f = await getLocalMediaFile(currentNode.data.imageLocalRef);
        if (f) originalsBoot.main = f;
      }
      if (!originalsBoot.main && currentNode.data.imagePreview) {
        const persistedMain = String(currentNode.data.imagePreview).trim();
        if (isFlowgenProtectedAssetFileUrl(persistedMain)) {
          try {
            const filePath = flowgenAssetFileUrlFromMediaUrl(persistedMain);
            const blob = await getAssetFileBlob(filePath);
            originalsBoot.main = new File(
              [blob],
              currentNode.data.imageName || 'asset.png',
              { type: blob.type || 'image/png' }
            );
          } catch {
            /* 运行时再走 uploadImageCached */
          }
        }
      }

      logFlowGenGraph('handleNodeRun-start', {
        idToRun,
        targetNodeIdArg: targetNodeId ?? null,
        selectedNodeId,
        runNode: {
          id: currentNode.id,
          type: currentNode.type,
          label: currentNode.data?.label,
          model: currentNode.data?.selectedModel,
        },
      });

      // 前端防呆：可灵3.0 Omni 首尾帧模式下，不允许“只有尾帧没有首帧”
      if (currentNode.data.selectedModel === '可灵3.0 Omni') {
          const hasFirst = !!(currentNode.data.firstFrameImage || currentNode.data.firstFrameImageUrl || currentNode.data.imagePreview);
          const hasLast = !!(currentNode.data.lastFrameImage || currentNode.data.lastFrameImageUrl);
          if (!hasFirst && hasLast) {
              updateNodeDataById(idToRun, {
                  status: 'error',
                  progress: 0,
                  errorMessage: '可灵3.0 Omni：有尾帧时必须同时上传首帧图',
              });
              return;
          }
      }

      // 1. Reset State & Start Running（清旧 taskId，避免 recovery 用上一轮任务把已删下游节点 spawn 回来）
      updateNodeDataById(idToRun, {
        status: 'running',
        progress: 0,
        errorMessage: undefined,
        ...clearStaleRunTaskBeforeFreshRun(currentNode.data as NodeData),
        runRecoveryPending: true,
      });
      stageRunPersistPatch({ status: 'running', progress: 0, runRecoveryPending: true });
      if (isImage2Model(currentNode.data.selectedModel || '')) {
          logImage2Debug('handleNodeRun-mark-running', {
              nodeId: idToRun,
          });
      }

      let generatedImages: string[] = [];
      let image2ProbedOutputSize: string | undefined;
      const runTaskIds: string[] = [];
      let jimengFirstFrameUrlForUi: string | undefined;
      // Seedance2.0 参考生视频：记录本次运行实际使用的参考素材（含自动补槽），用于 Node Details 快照展示
      let seedanceReferenceSnapshot:
        | {
            /** API 实际上传顺序（写入 generationParams，供请求复盘） */
            referenceImages: string[];
            /** 与 referenceImages 一一对应，供 Node Details 底栏（如 @主图 → 主图） */
            referenceImageLabels?: string[];
            /** 属性面板 referenceImages 槽位（运行后写回节点，保留全部拖入图） */
            panelReferenceImages: string[];
            panelReferenceImageLabels?: string[];
            referenceMovs: Array<{ url: string; posterDataUrl?: string }>;
            referenceAudios: Array<{ url: string }>;
          }
        | null = null;
      /** Seedance 图生视频：上传后的首尾帧 URL，供 Node Details / 缩略图 poster（避免 blob 被误判为视频从参考图里滤掉） */
      let seedanceImageRunSnapshot: { startUrl?: string; endUrl?: string } | null = null;
      // 可灵3.0 Omni（instruction/video）：记录本次实际入参 reference image/video，避免 Node Details 与请求不一致
      let klingOmniReferenceSnapshot:
        | {
            referenceImages: string[];
            panelReferenceImages?: string[];
            referenceMovs: Array<{ url: string; posterDataUrl?: string }>;
          }
        | null = null;
      /**
       * 各模型在「开始轮询 / 异步等待」之前写入：实际上传后的 URL 与本次请求强相关字段。
       * 当用户在同一节点上切换模型或并发跑其它节点时，与 runStartDataSnapshot 合并生成 MOV/OUTPUT 的 generationParams，行为与可灵 2.x / Nano 一致。
       */
      let runCaptureForGp: Partial<NodeData> = {};
      /** Nano Banana：本次请求实际上传的图片 URL 列表（主图+参考），与 Node Details 展示一致 */
      let nanoRunReferenceSnapshot: string[] | null = null;
      let nanoPanelMergedRefs: string[] | null = null;
      /** Banana 运行后面板保留版标签（与 nanoPanelMergedRefs 等长·下标对齐），避免 gp-only 标签串位 */
      let nanoPanelMergedLabels: string[] | null = null;
      let omniMultiMergedRefs: string[] | null = null;
      let omniMultiMergedLabels: string[] | null = null;
      let omniMultiPreviewPatch: Partial<NodeData> | null = null;
      let omniTabPreviewPatch: Partial<NodeData> | null = null;
      let firstLastFramePanelPatch: Partial<NodeData> | null = null;
      let seedanceImageUploadedByToken: Map<string, string> | null = null;
      let seedanceImagePlanForPanel: ReturnType<typeof collectReferencedMediaFromPrompt> | null =
        null;
      /** Omni multi：本次 API imageList 顺序（首帧 + @图片n），供 generationParams / Node Details */
      let omniMultiApiRefSnapshot: string[] | null = null;
      let omniMediaPlanForGp: ReturnType<typeof collectReferencedMediaFromPrompt> | null = null;
      let omniMultiUploadedByTokenForGp: Map<string, string> | null = null;
      let omniMultiFirstFrameUrlForGp: string | undefined;
      let omniTabMergedRefs: string[] | null = null;
      let omniTabMergedLabels: string[] | null = null;
      let jimengMergedImages: string[] | null = null;
      /** image 2：记录界面四槽参考图对应的上传后 URL，供 Node Details 展示实际请求地址 */
      let image2ReferenceSnapshot: string[] | null = null;
      let image2PanelMergedRefs: string[] | null = null;
      let image2PanelMergedLabels: string[] | null = null;
      /** Seedance 参考生：运行后面板保留版 refs/labels（与 Banana/image2 同理，避免 mediaPatch/gp-only 串位） */
      let seedancePanelMergedRefs: string[] | null = null;
      let seedancePanelMergedLabels: string[] | null = null;
      const formatFileSize = (bytes?: number): string => {
        if (!bytes || !Number.isFinite(bytes)) return '-';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
      };
      const collectRunMediaDiagnostics = async (reasonText?: string): Promise<string> => {
        type Item = { role: string; kind: 'image' | 'video' | 'audio'; src?: string; file?: File };
        const d = currentNode.data;
        if (isImage2Model(d.selectedModel || '')) {
          logImage2Debug('diagnostics-start', {
            nodeId: idToRun,
            reasonText: String(reasonText || ''),
            refCount: Array.isArray(d.referenceImages) ? d.referenceImages.length : 0,
          });
        }
        const originals = getOriginals(idToRun);
        const items: Item[] = [];
        const push = (role: string, kind: Item['kind'], src?: string, file?: File) => {
          if (src || file) items.push({ role, kind, src, file });
        };
        push('主图', 'image', d.imagePreview, originals.main);
        (d.referenceImages || []).forEach((u, i) => push(`参考图${i + 1}`, 'image', u, originals.referenceImages?.[i] || undefined));
        push('首帧', 'image', d.firstFrameImageUrl || d.firstFrameImage, originals.firstFrame);
        push('尾帧', 'image', d.lastFrameImageUrl || d.lastFrameImage, originals.lastFrame);
        (d.jimengImages || []).forEach((u, i) => push(`即梦图${i + 1}`, 'image', u, originals.jimengImages?.[i] || undefined));
        (d.referenceMovs || []).forEach((m, i) => push(`参考视频${i + 1}`, 'video', m.url));
        (d.referenceAudios || []).forEach((a, i) => push(`参考音频${i + 1}`, 'audio', a.url));
        if (d.klingOmniInstructionVideoUrl || d.klingOmniInstructionVideoPreviewUrl) {
          push('Omni 指令视频', 'video', d.klingOmniInstructionVideoUrl || d.klingOmniInstructionVideoPreviewUrl, originals.klingOmniVideo);
        }
        if (d.klingOmniVideoUrl || d.klingOmniVideoPreviewUrl) {
          push('Omni 视频参考', 'video', d.klingOmniVideoUrl || d.klingOmniVideoPreviewUrl, originals.klingOmniVideo);
        }
        if (!items.length) return '';
        const MAX_DIAG_ITEMS = 12;
        const trimmedItems = items.slice(0, MAX_DIAG_ITEMS);

        const loadImageMeta = async (src?: string): Promise<string> =>
          new Promise((resolve) => {
            if (!src) return resolve('');
            // 防止大体积 data URL 在错误路径里反复解码导致页面卡死/崩溃
            if (/^data:image\//i.test(src) && src.length > 1_500_000) return resolve('');
            const img = new Image();
            let done = false;
            const t = window.setTimeout(() => {
              if (done) return;
              done = true;
              resolve('');
            }, 2500);
            const finish = (txt: string) => {
              if (done) return;
              done = true;
              window.clearTimeout(t);
              resolve(txt);
            };
            img.onload = () => finish(img.naturalWidth > 0 && img.naturalHeight > 0 ? `${img.naturalWidth}x${img.naturalHeight}` : '');
            img.onerror = () => finish('');
            img.src = src;
          });
        const loadVideoMeta = async (src?: string): Promise<string> =>
          new Promise((resolve) => {
            if (!src) return resolve('');
            if (/^data:video\//i.test(src) && src.length > 2_000_000) return resolve('');
            const v = document.createElement('video');
            let done = false;
            const t = window.setTimeout(() => {
              if (done) return;
              done = true;
              try { v.src = ''; v.load(); } catch { /* ignore */ }
              resolve('');
            }, 3500);
            const finish = (txt: string) => {
              if (done) return;
              done = true;
              window.clearTimeout(t);
              try { v.src = ''; v.load(); } catch { /* ignore */ }
              resolve(txt);
            };
            v.preload = 'metadata';
            v.onloadedmetadata = () => {
              const w = Number.isFinite(v.videoWidth) ? v.videoWidth : 0;
              const h = Number.isFinite(v.videoHeight) ? v.videoHeight : 0;
              const dsec = Number.isFinite(v.duration) ? v.duration : 0;
              const parts = [];
              if (w > 0 && h > 0) parts.push(`${w}x${h}`);
              if (dsec > 0) parts.push(`${dsec.toFixed(2)}s`);
              finish(parts.join(' / '));
            };
            v.onerror = () => finish('');
            v.src = src;
          });

        const reasonLower = String(reasonText || '').toLowerCase();
        const mayBeAspectIssue = /(比例|aspect\s*ratio|宽高比|分辨率|resolution)/i.test(reasonLower);
        const ratioToNumber = (raw?: string): number | null => {
          const txt = String(raw || '').trim();
          const m = txt.match(/(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)/);
          if (!m) return null;
          const a = Number(m[1]);
          const b = Number(m[2]);
          if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
          return a / b;
        };
        const expectedRatio = ratioToNumber(d.seedanceAspectRatio || d.image2AspectRatio || d.aspectRatio || undefined);
        const parseMediaRatio = (meta?: string): number | null => {
          if (!meta) return null;
          const m = meta.match(/(\d+)\s*x\s*(\d+)/i);
          if (!m) return null;
          const w = Number(m[1]);
          const h = Number(m[2]);
          if (!Number.isFinite(w) || !Number.isFinite(h) || h === 0) return null;
          return w / h;
        };
        const almostEqualRatio = (a: number, b: number): boolean => Math.abs(a - b) <= 0.03;

        const rows = await Promise.all(
          trimmedItems.map(async (it, idx) => {
            const filePart = it.file
              ? `本地文件=${it.file.name} (${it.file.type || 'unknown'}, ${formatFileSize(it.file.size)})`
              : '本地文件=-';
            const mediaMeta =
              it.kind === 'image'
                ? await loadImageMeta(it.src)
                : it.kind === 'video'
                  ? await loadVideoMeta(it.src)
                  : '';
            const metaPart = mediaMeta ? `, 媒体规格=${mediaMeta}` : '';
            return {
              role: it.role,
              kind: it.kind,
              src: it.src,
              mediaMeta,
              line: `- [${idx + 1}] ${it.role}（${it.kind}）${metaPart}，${filePart}`,
            };
          })
        );
        const lines = rows.map((r) => r.line);
        const suspectRoles: string[] = [];
        if (mayBeAspectIssue && expectedRatio) {
          rows.forEach((r) => {
            if (r.kind !== 'image') return;
            const got = parseMediaRatio(r.mediaMeta);
            if (!got) return;
            if (!almostEqualRatio(got, expectedRatio)) suspectRoles.push(r.role);
          });
        }
        const sameSrcRoleMap = new Map<string, string[]>();
        rows.forEach((r) => {
          const key = String(r.src || '').trim();
          if (!key) return;
          const arr = sameSrcRoleMap.get(key) || [];
          arr.push(r.role);
          sameSrcRoleMap.set(key, arr);
        });
        const reusedGroups: string[] = [];
        sameSrcRoleMap.forEach((roles) => {
          if (roles.length > 1) reusedGroups.push(roles.join('、'));
        });
        const summaryLines: string[] = [];
        const dedupSuspects = Array.from(new Set(suspectRoles));
        if (dedupSuspects.length > 0) {
          summaryLines.push(`- **疑似不符合规格素材框：** ${dedupSuspects.join('、')}`);
        }
        if (reusedGroups.length > 0) {
          summaryLines.push(`- **同一素材被多个框位复用：** ${reusedGroups.map((g) => `（${g}）`).join('、')}`);
        }
        if (items.length > trimmedItems.length) {
          summaryLines.push(`- **已截断排查列表：** 仅展示前 ${trimmedItems.length} 项（共 ${items.length} 项）`);
        }
        const summary = summaryLines.length ? `${summaryLines.join('\n')}\n` : '';
        const result = `\n\n**输入素材排查（用于定位哪张不符合规格）**\n${summary}${lines.join('\n')}`;
        if (isImage2Model(d.selectedModel || '')) {
          logImage2Debug('diagnostics-finish', {
            nodeId: idToRun,
            lineCount: lines.length,
            suspectRoles: dedupSuspects,
            reusedGroups,
          });
        }
        return result;
      };

      try {
        const model = currentNode.data.selectedModel || MODEL_NANO_BANANA_2;
        const fileDataUrlCache = new Map<File, Promise<string>>();
        const preparedImageSrcCache = new Map<string, Promise<string>>();
        const uploadedImageUrlCache = new Map<string, Promise<string | null>>();
        const uploadedVideoUrlCache = new Map<string, Promise<string | null>>();

        const fileToDataUrlCached = async (file: File): Promise<string> => {
            const cached = fileDataUrlCache.get(file);
            if (cached) return cached;
            const pending = fileToDataUrl(file);
            fileDataUrlCache.set(file, pending);
            return pending;
        };

        const prepareLocalImageSrcCached = async (
            src: string,
            extra?: { seedanceRatioLabel?: string | null }
        ): Promise<string> => {
            const key = JSON.stringify([src, extra?.seedanceRatioLabel || null]);
            const cached = preparedImageSrcCache.get(key);
            if (cached) return cached;
            const pending = prepareLocalImageSrc(src, extra);
            preparedImageSrcCache.set(key, pending);
            return pending;
        };

        const uploadImageCached = async (src: string): Promise<string | null> => {
            const cached = uploadedImageUrlCache.get(src);
            if (cached) return cached;
            const pending = uploadImage(src);
            uploadedImageUrlCache.set(src, pending);
            return pending;
        };

        const uploadVideoCached = async (src: string, filename?: string): Promise<string | null> => {
            const key = `${filename || ''}::${src}`;
            const cached = uploadedVideoUrlCache.get(key);
            if (cached) return cached;
            const pending = filename ? uploadVideo(src, filename) : uploadVideo(src);
            uploadedVideoUrlCache.set(key, pending);
            return pending;
        };

        const bumpRunningNodeProgress = (delta = 1, max = 95) => {
            setNodes((nds) => {
                const idx = nds.findIndex((n) => n.id === idToRun);
                if (idx < 0) return nds;
                const target = nds[idx];
                if (target.data.status !== 'running') return nds;
                const prev = Number(target.data.progress || 0);
                const next = Math.min(max, prev + delta);
                if (next === prev) return nds;
                stageRunPersistPatch({ runRecoveryProgress: next, runRecoveryPending: true });
                const nextNodes = nds.slice();
                nextNodes[idx] = {
                    ...target,
                    data: {
                        ...target.data,
                        progress: next,
                        runRecoveryProgress: next,
                        runRecoveryPending: true,
                    },
                };
                return nextNodes;
            });
        };

        const patchNodeDataById = (nodeId: string, patch: Partial<NodeData>) => {
            setNodes((nds) => {
                const idx = nds.findIndex((n) => n.id === nodeId);
                if (idx < 0) return nds;
                const target = nds[idx];
                const hasDiff = Object.entries(patch).some(([key, value]) => (target.data as any)[key] !== value);
                if (!hasDiff) return nds;
                const nextNodes = nds.slice();
                nextNodes[idx] = {
                    ...target,
                    data: {
                        ...target.data,
                        ...patch,
                    },
                };
                return nextNodes;
            });
        };

        /** 任务创建后立即写入节点并触发持久化，刷新/拉库后可按 taskId 恢复轮询 */
        const flushCriticalRunPersist = async () => {
            const mergedNodes = mergeRunPersistPatchesIntoNodes(
                getNodes(),
                pendingRunPersistPatchesRef.current
            );
            const currentEdges = getEdges();
            const snap = buildPersistSnapshot(mergedNodes, currentEdges, storyboardImages);
            try {
                writeProjectSnapshotToStorage(snap);
                lastPersistStructuralSigRef.current = buildStructuralGraphSignature(
                    mergedNodes,
                    currentEdges,
                    storyboardImages
                );
            } catch {
                /* ignore local snapshot failures */
            }
            await flushRemoteWorkspaceSave(
                {
                    nodes: snap.nodes as RFNode[],
                    edges: snap.edges,
                    storyboardImages: snap.storyboardImages,
                },
                { force: true, networkRetry: true }
            );
        };

        const appendRunTaskId = (taskId: string) => {
            if (!taskId) return;
            if (!runTaskIds.includes(taskId)) {
                runTaskIds.push(taskId);
            }
            const joined = runTaskIds.join(', ');
            const gpWithTask: GenerationParams = {
                ...(runStartDataSnapshot.generationParams || {}),
                taskId: joined,
            };
            stageRunPersistPatch({
                taskId: joined,
                runRecoveryPending: true,
                generationParams: gpWithTask,
            });
            patchNodeDataById(idToRun, {
                taskId: joined,
                runRecoveryPending: true,
                generationParams: gpWithTask,
            });
            window.dispatchEvent(
                new CustomEvent('flowgen:persist-request', { detail: { force: true } })
            );
            void flushCriticalRunPersist();
        };

        const syncModelConfigFromNodeData = (nextData: NodeData): NodeData['modelConfigs'] => {
            const currentConfigs = { ...(nextData.modelConfigs || {}) } as NonNullable<NodeData['modelConfigs']>;
            const selected = nextData.selectedModel || '';
            if (isNanoBanana2Model(selected)) {
                currentConfigs[MODEL_NANO_BANANA_2] = {
                    prompt: nextData.prompt,
                    negativePrompt: nextData.negativePrompt,
                    aspectRatio: nextData.aspectRatio,
                    numberOfImages: nextData.numberOfImages,
                    referenceImages: nextData.referenceImages ? [...nextData.referenceImages] : undefined,
                    referenceImageLabels: nextData.referenceImageLabels
                      ? [...nextData.referenceImageLabels]
                      : undefined,
                    referenceImageLocalRefs: nextData.referenceImageLocalRefs?.some(Boolean)
                      ? [...nextData.referenceImageLocalRefs]
                      : undefined,
                    ...(Object.prototype.hasOwnProperty.call(nextData, 'imagePreview')
                      ? { imagePreview: nextData.imagePreview }
                      : {}),
                    ...(Object.prototype.hasOwnProperty.call(nextData, 'imageName')
                      ? { imageName: nextData.imageName }
                      : {}),
                    ...(Object.prototype.hasOwnProperty.call(nextData, 'imageLocalRef')
                      ? { imageLocalRef: nextData.imageLocalRef }
                      : {}),
                    ...(Object.prototype.hasOwnProperty.call(nextData, 'panelMainImageUrl')
                      ? { panelMainImageUrl: nextData.panelMainImageUrl }
                      : {}),
                    ...(Object.prototype.hasOwnProperty.call(nextData, 'panelMainSlotVisible')
                      ? { panelMainSlotVisible: nextData.panelMainSlotVisible }
                      : {}),
                };
            } else if (isImage2Model(selected)) {
                currentConfigs.image2 = {
                    prompt: nextData.prompt,
                    negativePrompt: nextData.negativePrompt,
                    referenceImages: nextData.referenceImages
                      ? [...nextData.referenceImages].slice(0, IMAGE2_MAX_API_IMAGES)
                      : undefined,
                    referenceImageLabels: nextData.referenceImageLabels
                      ? [...nextData.referenceImageLabels]
                      : undefined,
                    ...(nextData.referenceImageLocalRefs?.some(Boolean)
                      ? { referenceImageLocalRefs: [...nextData.referenceImageLocalRefs] }
                      : {}),
                    numberOfImages: nextData.numberOfImages,
                    image2Style: nextData.image2Style,
                    image2AspectRatio: nextData.image2AspectRatio,
                    image2ImageSize: nextData.image2ImageSize,
                    image2Quality: nextData.image2Quality,
                    image2QualityLevel: nextData.image2QualityLevel,
                    ...(Object.prototype.hasOwnProperty.call(nextData, 'imagePreview')
                      ? { imagePreview: nextData.imagePreview }
                      : {}),
                    ...(Object.prototype.hasOwnProperty.call(nextData, 'imageLocalRef')
                      ? { imageLocalRef: nextData.imageLocalRef }
                      : {}),
                    ...(Object.prototype.hasOwnProperty.call(nextData, 'panelMainImageUrl')
                      ? { panelMainImageUrl: nextData.panelMainImageUrl }
                      : {}),
                    ...(Object.prototype.hasOwnProperty.call(nextData, 'panelMainSlotVisible')
                      ? { panelMainSlotVisible: nextData.panelMainSlotVisible }
                      : {}),
                };
            } else if (selected === '可灵 2.5 Turbo') {
                currentConfigs['可灵 2.5 Turbo'] = {
                    prompt: nextData.prompt,
                    negativePrompt: nextData.negativePrompt,
                    firstFrameImage: nextData.firstFrameImage,
                    lastFrameImage: nextData.lastFrameImage,
                    firstFrameImageUrl: nextData.firstFrameImageUrl,
                    lastFrameImageUrl: nextData.lastFrameImageUrl,
                    firstFrameLocalRef: nextData.firstFrameLocalRef,
                    lastFrameLocalRef: nextData.lastFrameLocalRef,
                    firstFrameImageLabel: nextData.firstFrameImageLabel,
                    lastFrameImageLabel: nextData.lastFrameImageLabel,
                    quality: nextData.quality,
                    duration: nextData.duration,
                    creativityLevel: nextData.creativityLevel,
                    numberOfImages: nextData.numberOfImages,
                    aspectRatio: nextData.aspectRatio,
                };
            } else if (selected === '可灵3.0 Omni') {
                currentConfigs['可灵3.0 Omni'] = {
                    prompt: nextData.prompt,
                    negativePrompt: nextData.negativePrompt,
                    firstFrameImage: nextData.firstFrameImage,
                    lastFrameImage: nextData.lastFrameImage,
                    firstFrameImageUrl: nextData.firstFrameImageUrl,
                    lastFrameImageUrl: nextData.lastFrameImageUrl,
                    firstFrameLocalRef: nextData.firstFrameLocalRef,
                    lastFrameLocalRef: nextData.lastFrameLocalRef,
                    firstFrameImageLabel: nextData.firstFrameImageLabel,
                    lastFrameImageLabel: nextData.lastFrameImageLabel,
                    quality: nextData.quality,
                    duration: nextData.duration,
                    numberOfImages: nextData.numberOfImages,
                    aspectRatio: nextData.aspectRatio,
                    klingAudioSync: nextData.klingAudioSync,
                    referenceImages: nextData.referenceImages ? [...nextData.referenceImages] : undefined,
                    klingOmniMultiReferenceImages: nextData.klingOmniMultiReferenceImages
                      ? [...nextData.klingOmniMultiReferenceImages]
                      : undefined,
                    klingOmniInstructionReferenceImages: nextData.klingOmniInstructionReferenceImages
                      ? [...nextData.klingOmniInstructionReferenceImages]
                      : undefined,
                    klingOmniVideoReferenceImages: nextData.klingOmniVideoReferenceImages
                      ? [...nextData.klingOmniVideoReferenceImages]
                      : undefined,
                    klingOmniMultiReferenceElementIds: nextData.klingOmniMultiReferenceElementIds
                      ? [...nextData.klingOmniMultiReferenceElementIds]
                      : undefined,
                    klingOmniInstructionReferenceElementIds: nextData.klingOmniInstructionReferenceElementIds
                      ? [...nextData.klingOmniInstructionReferenceElementIds]
                      : undefined,
                    klingOmniVideoReferenceElementIds: nextData.klingOmniVideoReferenceElementIds
                      ? [...nextData.klingOmniVideoReferenceElementIds]
                      : undefined,
                    klingOmniMultiPrompt: nextData.klingOmniMultiPrompt,
                    klingOmniMultiNegativePrompt: nextData.klingOmniMultiNegativePrompt,
                    klingOmniInstructionPrompt: nextData.klingOmniInstructionPrompt,
                    klingOmniInstructionNegativePrompt: nextData.klingOmniInstructionNegativePrompt,
                    klingOmniVideoPrompt: nextData.klingOmniVideoPrompt,
                    klingOmniVideoNegativePrompt: nextData.klingOmniVideoNegativePrompt,
                    klingOmniFramesPrompt: nextData.klingOmniFramesPrompt,
                    klingOmniFramesNegativePrompt: nextData.klingOmniFramesNegativePrompt,
                    klingOmniTab: nextData.klingOmniTab,
                    klingOmniTabConfigs: snapshotKlingOmniTabConfigsWithLivePanel(
                      nextData,
                      (nextData.klingOmniTab || 'multi') as KlingOmniPanelTab
                    ),
                    klingOmniVideoPreviewUrl: nextData.klingOmniVideoPreviewUrl,
                    klingOmniVideoUrl: nextData.klingOmniVideoUrl,
                    klingOmniInstructionVideoPreviewUrl: nextData.klingOmniInstructionVideoPreviewUrl,
                    klingOmniInstructionVideoUrl: nextData.klingOmniInstructionVideoUrl,
                };
            } else if (selected === '即梦3.0 Pro') {
                currentConfigs['即梦3.0 Pro'] = {
                    prompt: nextData.prompt,
                    negativePrompt: nextData.negativePrompt,
                    jimengGenerationMode: nextData.jimengGenerationMode,
                    jimengProfessionalMode: nextData.jimengProfessionalMode,
                    jimengResolution: nextData.jimengResolution,
                    jimengVideoRatio: nextData.jimengVideoRatio,
                    duration: nextData.duration,
                    numberOfImages: nextData.numberOfImages,
                    firstFrameImage: nextData.firstFrameImage,
                    firstFrameImageUrl: nextData.firstFrameImageUrl,
                    firstFrameLocalRef: nextData.firstFrameLocalRef,
                    firstFrameImageLabel: nextData.firstFrameImageLabel,
                    jimengImages: nextData.jimengImages ? [...nextData.jimengImages] : undefined,
                };
            } else if (selected === 'vidu 2.0') {
                currentConfigs['vidu 2.0'] = {
                    prompt: nextData.prompt,
                    negativePrompt: nextData.negativePrompt,
                    firstFrameImage: nextData.firstFrameImage,
                    lastFrameImage: nextData.lastFrameImage,
                    firstFrameImageUrl: nextData.firstFrameImageUrl,
                    lastFrameImageUrl: nextData.lastFrameImageUrl,
                    firstFrameLocalRef: nextData.firstFrameLocalRef,
                    lastFrameLocalRef: nextData.lastFrameLocalRef,
                    firstFrameImageLabel: nextData.firstFrameImageLabel,
                    lastFrameImageLabel: nextData.lastFrameImageLabel,
                    viduDuration: nextData.viduDuration,
                    viduClarity: nextData.viduClarity,
                    viduMotionRange: nextData.viduMotionRange,
                    aspectRatio: nextData.aspectRatio,
                    numberOfImages: nextData.numberOfImages,
                };
            } else if (['seedance1.5-pro', 'seedance2.0 (高质量版)', 'seedance2.0 (急速版)'].includes(selected)) {
                (currentConfigs as any)[selected] = {
                    prompt: getNodeInspectorPromptText(nextData),
                    negativePrompt: nextData.negativePrompt,
                    firstFrameImage: nextData.firstFrameImage,
                    lastFrameImage: nextData.lastFrameImage,
                    firstFrameImageUrl: nextData.firstFrameImageUrl,
                    lastFrameImageUrl: nextData.lastFrameImageUrl,
                    firstFrameLocalRef: nextData.firstFrameLocalRef,
                    lastFrameLocalRef: nextData.lastFrameLocalRef,
                    firstFrameImageLabel: nextData.firstFrameImageLabel,
                    lastFrameImageLabel: nextData.lastFrameImageLabel,
                    numberOfImages: nextData.numberOfImages,
                    seedanceResolution: nextData.seedanceResolution,
                    seedanceAspectRatio: nextData.seedanceAspectRatio,
                    seedanceDuration: nextData.seedanceDuration,
                    seedanceGenerateAudio: nextData.seedanceGenerateAudio,
                    seedanceFixedCamera: nextData.seedanceFixedCamera,
                    seedanceGenerationMode: nextData.seedanceGenerationMode,
                    seedanceReferenceRatioMode: nextData.seedanceReferenceRatioMode,
                    seedanceReferenceWebSearch: nextData.seedanceReferenceWebSearch,
                    seedanceTabConfigs: nextData.seedanceTabConfigs,
                    referenceImages: nextData.referenceImages ? [...nextData.referenceImages] : undefined,
                    referenceMovs: nextData.referenceMovs ? [...nextData.referenceMovs] : undefined,
                    referenceAudios: nextData.referenceAudios ? [...nextData.referenceAudios] : undefined,
                };
            }
            return currentConfigs;
        };

        /** Seedance：上传前约束边长 300～6000px、宽高比 0.4～2.5（资产库原图常 >6000px） */
        const prepareLocalImageSrc = async (
            src: string,
            extra?: { seedanceRatioLabel?: string | null }
        ): Promise<string> => {
            const s = String(src || '').trim();
            if (!s) return s;
            const isSeedanceModel = [
                'seedance1.5-pro',
                'seedance2.0 (高质量版)',
                'seedance2.0 (急速版)',
            ].includes(model);
            if (!isSeedanceModel) return s;
            if (
              isFlowgenProtectedAssetFileUrl(s) ||
              isFlowgenAssetThumbUrl(s) ||
              (s.includes('/flowgen-api/') && s.includes('/assets/'))
            ) {
              try {
                const blob = await getAssetFileBlob(flowgenAssetFileUrlFromMediaUrl(s));
                const fit = await prepareImageForSeedanceModelUpload(
                  new File([blob], 'seedance-asset.jpg', { type: blob.type || 'image/jpeg' }),
                  { targetRatioLabel: extra?.seedanceRatioLabel }
                );
                    logPreloadDebug({
                        model,
                        stage: 'seedance-image-fit',
                        from: 'flowgen-asset',
                        width: fit.width,
                        height: fit.height,
                        bytes: fit.bytes,
                        resized: fit.resized,
                    });
                return fit.dataUrl;
              } catch {
                /* 走下方通用路径 */
              }
            }
            if (s.includes('aitop100app-1251510006')) {
                try {
                    const fit = await prepareImageForSeedanceModelUpload(s, {
                      targetRatioLabel: extra?.seedanceRatioLabel,
                    });
                    logPreloadDebug({
                        model,
                        stage: 'seedance-image-fit',
                        from: 'cos-reupload',
                        width: fit.width,
                        height: fit.height,
                        bytes: fit.bytes,
                        resized: fit.resized,
                    });
                    return fit.dataUrl;
                } catch {
                    /* 走下方通用路径 */
                }
            }
            try {
                const fit = await prepareImageForSeedanceModelUpload(s, {
                  targetRatioLabel: extra?.seedanceRatioLabel,
                });
                logPreloadDebug({
                    model,
                    stage: 'seedance-image-fit',
                    width: fit.width,
                    height: fit.height,
                    bytes: fit.bytes,
                    resized: fit.resized,
                });
                return fit.dataUrl;
            } catch {
                throw new Error(
                    `${model} 图片预处理失败：需 JPEG/PNG、宽高比 0.4～2.5、边长 300～6000px。若为资产库或超宽全景图，请确认服务器能访问图片地址后重试。`
                );
            }
        };

        const prepareVideoUrlForModelDimensions = async (videoUrl: string): Promise<string> => videoUrl;
        const stabilizeVideoResourceUrl = async (
            videoUrl: string,
            options: { modelTag: string; taskId?: string }
        ): Promise<string> => {
            if (!videoUrl) return videoUrl;
            const safeModel = options.modelTag.replace(/[^\w-]+/g, '_');
            const safeTask = (options.taskId || `${Date.now()}`).replace(/[^\w-]+/g, '_');
            return ensureAitopCosVideoUrl(videoUrl, uploadVideoCached, {
                label: `${options.modelTag} 生成结果`,
                filename: `${safeModel}-${safeTask}.mp4`,
                taskId: options.taskId,
            });
        };

        // --- REAL API LOGIC FOR NANO BANANA ---
        if (isNanoBanana2Model(model)) {
            const nanoCtx = buildRunPromptCtx(currentNode.data);
            const rawNanoPrompt =
                getCanonicalInspectorPromptText(
                  runStartDataSnapshot,
                  projectAssetResolveOptsRef.current.projectAssets
                ) || 'A cute cyber-punk cat';
            const nanoMediaPlan = collectReferencedMediaFromPrompt(
                rawNanoPrompt,
                currentNode.data,
                nanoCtx,
                projectAssetBySlugRef.current,
                projectAssetResolveOptsRef.current.projectAssets
            );
            const nanoPrOpts = buildReferenceIndexOptionsFromPlan(
                nanoMediaPlan,
                projectAssetResolveOptsRef.current
            );
            const prompt = resolvePromptPlaceholders(
                rawNanoPrompt,
                currentNode.data,
                nanoCtx,
                nanoPrOpts
            );
            const imageUrls: string[] = [];

            const aspectRatio = currentNode.data.aspectRatio || "1:1";
            const finalImageCount = resolvePanelGenerateCount(currentNode.data);

            const originals = getOriginals(idToRun);
            const nanoPanelRefsBefore = [...(panelReferenceImagesForUpload(currentNode.data) || [])];
            const nanoUploadCtx: UploadReferencedImageContext = {
                originals,
                panelReferenceImages: nanoPanelRefsBefore,
                fileToDataUrlCached,
                prepareLocalImageSrcCached,
                uploadImageCached,
                flowgenAssetFileUrlFromMediaUrl,
                isFlowgenAssetThumbUrl,
            };
            const nanoUploadedByToken = new Map<string, string>();
            for (const entry of nanoMediaPlan.images.slice(0, 14)) {
                logPreloadDebug({
                    model: 'Nano Banana 2',
                    stage: 'nano-ref-upload',
                    token: entry.token,
                    imageIndex: entry.imageIndex,
                });
                const upUrl = await uploadReferencedImageEntry(entry, nanoUploadCtx);
                nanoUploadedByToken.set(entry.token, upUrl);
                imageUrls.push(upUrl);
            }

            if (imageUrls.length > 0) {
                const panelRefsBefore = nanoPanelRefsBefore;
                const mergedNanoRefs = mergeAndPrunePanelReferenceImagesAfterUpload(
                    panelRefsBefore,
                    nanoMediaPlan.images,
                    nanoUploadedByToken,
                    panelMergeOptionsForReferencedUpload(
                        nanoMediaPlan.images,
                        nanoUploadedByToken,
                        currentNode.data.imagePreview,
                        projectAssetBySlugRef.current,
                        currentNode.data.referenceImageLabels
                    )
                );
                const mergedNanoLabels = resolveReferenceImageLabelsAfterPanelRun({
                    panelBefore: panelRefsBefore,
                    labelsBefore: currentNode.data.referenceImageLabels,
                    panelAfter: mergedNanoRefs,
                    plan: nanoMediaPlan,
                    projectAssets: projectAssetResolveOptsRef.current.projectAssets,
                });
                const nanoPreviewPatch = buildPanelImagePreviewPatchAfterRun(
                    nanoMediaPlan.images,
                    nanoUploadedByToken,
                    {
                        nodeData: currentNode.data,
                        mergedPanelRefs: mergedNanoRefs,
                        mergedPanelLabels: mergedNanoLabels,
                        projectAssets: projectAssetResolveOptsRef.current.projectAssets,
                    }
                );
                await enrichPanelPreviewPatchWithFreshMainBackup(nanoPreviewPatch, currentNode.data);
                // Node Details / generationParams：记录本次 API 实际 imageUrls（含 @主图），而非仅面板 referenceImages 槽位
                nanoPanelMergedRefs = [...mergedNanoRefs];
                nanoPanelMergedLabels = mergedNanoLabels.some((l) => l.trim())
                    ? [...mergedNanoLabels]
                    : null;
                nanoRunReferenceSnapshot =
                    imageUrls.length > 0
                        ? [...imageUrls]
                        : mergedNanoRefs.length
                          ? [...mergedNanoRefs]
                          : null;
                // 面板保留全部拖入槽；generationParams / Node Details 仍用 imageUrls（仅 @ 到的素材）
                const effectiveNanoPanelRefs = mergedNanoRefs;
                setNodes((nds) =>
                    nds.map((n) => {
                        if (n.id !== idToRun) return n;
                        return {
                            ...n,
                            data: {
                                ...n.data,
                                ...nanoPreviewPatch,
                                referenceImages: effectiveNanoPanelRefs,
                                ...(mergedNanoLabels.some((l) => l.trim())
                                    ? { referenceImageLabels: mergedNanoLabels }
                                    : {}),
                            },
                        };
                    })
                );
                Object.assign(runCaptureForGp, {
                    ...nanoPreviewPatch,
                    referenceImages: nanoRunReferenceSnapshot ?? mergedNanoRefs,
                    ...(mergedNanoLabels.some((l) => l.trim())
                        ? { referenceImageLabels: mergedNanoLabels }
                        : {}),
                });
            }

            // 🔧 [测试模式] 暂时屏蔽 API 调用，使用模拟数据
            const USE_MOCK_DATA = false; // 设置为 true 来使用模拟数据
            
            if (USE_MOCK_DATA) {
                // 使用模拟图片 URL
                const mockImageUrls = [
                    'https://picsum.photos/512/512?random=1',
                    'https://picsum.photos/512/512?random=2',
                    'https://picsum.photos/512/512?random=3',
                    'https://picsum.photos/512/512?random=4'
                ].slice(0, finalImageCount);
                
                generatedImages = mockImageUrls;
            } else {
            // Create Multiple Concurrent Generation Tasks
            const resRaw = currentNode.data.resolution || '1K';
            const imageSize = (['1K', '2K', '4K'].includes(resRaw) ? resRaw : '1K') as '1K' | '2K' | '4K';
            const nanoPayload = { prompt, imageUrls, options: { aspectRatio, imageSize }, generateCount: finalImageCount };
            logModelRequest(MODEL_NANO_BANANA_2, nanoPayload);
            generatedImages = await runParallelGenerationTasks(
                finalImageCount,
                (i) =>
                    createNanoTask(prompt, imageUrls, {
                        aspectRatio,
                        imageSize,
                        clientBatchIndex: i + 1,
                        clientBatchTotal: finalImageCount,
                    }),
                (taskId) =>
                    pollImageTaskUntilUrl(taskId, {
                        failLabel: 'Nano Banana',
                        onProgress: () => bumpRunningNodeProgress(1, 95),
                    }),
                (taskId) => appendRunTaskId(taskId)
            );
            } // 结束 else 块（真实 API 调用）

        }
        // --- REAL API LOGIC FOR image2 ---
        else if (isImage2Model(model)) {
            const image2Ctx = buildRunPromptCtx(currentNode.data);
            const rawImage2Prompt =
                getCanonicalInspectorPromptText(
                  runStartDataSnapshot,
                  projectAssetResolveOptsRef.current.projectAssets
                ) || 'A cute cyber-punk cat';
            const image2MediaPlan = collectReferencedMediaFromPrompt(
                rawImage2Prompt,
                currentNode.data,
                image2Ctx,
                projectAssetBySlugRef.current,
                projectAssetResolveOptsRef.current.projectAssets
            );
            const image2PrOpts = buildReferenceIndexOptionsFromPlan(
                image2MediaPlan,
                projectAssetResolveOptsRef.current
            );
            const prompt = resolvePromptPlaceholders(
                rawImage2Prompt,
                currentNode.data,
                image2Ctx,
                image2PrOpts
            );
            const imageUrls: string[] = [];

            const aspectRatio = image2NormalizeAspectRatio(currentNode.data.image2AspectRatio);
            const image2Quality = image2ResolveQuality(
                currentNode.data.image2Quality,
                currentNode.data.image2ImageSize
            );
            const imageSize = image2CoerceSizeForAspect(
                aspectRatio,
                currentNode.data.image2ImageSize,
                image2Quality
            );
            const image2QualityLevel = image2NormalizeQualityLevel(currentNode.data.image2QualityLevel);
            const image2Style = currentNode.data.image2Style === 'natural' ? 'natural' : 'vivid';

            const finalImageCount = resolvePanelGenerateCount(currentNode.data);
            const numberOfImagesStr = currentNode.data.numberOfImages || '1张';

            const refs = panelReferenceImagesForUpload(currentNode.data) || [];
            const originals = getOriginals(idToRun);
            logImage2Debug('run-start', {
                nodeId: idToRun,
                mainPreview: summarizeImageRefUrlForDebug(currentNode.data.imagePreview, 0),
                refsUi: (refs || []).map((u, i) => summarizeImageRefUrlForDebug(u, i)),
                promptImageTokens: image2MediaPlan.images.map((e) => e.token),
            });
            const panelRefsBefore = [...refs];
            const image2UploadCtx: UploadReferencedImageContext = {
                originals,
                panelReferenceImages: panelRefsBefore,
                fileToDataUrlCached,
                prepareLocalImageSrcCached,
                uploadImageCached,
                flowgenAssetFileUrlFromMediaUrl,
                isFlowgenAssetThumbUrl,
            };
            const image2MergeOptsBase = panelMergeOptionsForReferencedUpload(
                image2MediaPlan.images,
                new Map(),
                currentNode.data.imagePreview,
                projectAssetBySlugRef.current,
                currentNode.data.referenceImageLabels
            );
            const image2PlanForUpload = enrichPlanImagesWithPanelSlotIndexes(
                panelRefsBefore,
                image2MediaPlan.images,
                image2MergeOptsBase
            );
            const uploadedByToken = new Map<string, string>();
            for (const entry of image2PlanForUpload.slice(0, IMAGE2_MAX_API_IMAGES)) {
                logPreloadDebug({
                    model: 'image 2',
                    stage: 'image2-ref-upload',
                    token: entry.token,
                    imageIndex: entry.imageIndex,
                });
                const upUrl = await uploadReferencedImageEntry(entry, image2UploadCtx);
                uploadedByToken.set(entry.token, upUrl);
                imageUrls.push(upUrl);
            }
            if (!imageUrls.length) {
                throw new Error('**❌ image 2 运行失败**\n\n提示词中 @ 到的图片未能上传，请检查主图/参考图是否有效。');
            }

            const nextImage2Refs = mergeAndPrunePanelReferenceImagesAfterUpload(
                panelRefsBefore,
                image2PlanForUpload,
                uploadedByToken,
                panelMergeOptionsForReferencedUpload(
                    image2PlanForUpload,
                    uploadedByToken,
                    currentNode.data.imagePreview,
                    projectAssetBySlugRef.current,
                    currentNode.data.referenceImageLabels
                )
            );
            const mergedImage2Labels = resolveReferenceImageLabelsAfterPanelRun({
                panelBefore: panelRefsBefore,
                labelsBefore: currentNode.data.referenceImageLabels,
                panelAfter: nextImage2Refs,
                plan: image2MediaPlan,
                projectAssets: projectAssetResolveOptsRef.current.projectAssets,
            });
            const image2PreviewPatch = buildPanelImagePreviewPatchAfterRun(
                image2PlanForUpload,
                uploadedByToken,
                {
                    nodeData: currentNode.data,
                    mergedPanelRefs: nextImage2Refs,
                    mergedPanelLabels: mergedImage2Labels,
                    projectAssets: projectAssetResolveOptsRef.current.projectAssets,
                }
            );
            await enrichPanelPreviewPatchWithFreshMainBackup(image2PreviewPatch, currentNode.data);

            const uploadedMainUrl = uploadedByToken.get('@主图') ?? uploadedByToken.get('@主体');
            logImage2Debug('after-upload', {
                nodeId: idToRun,
                uploadedMain: uploadedMainUrl ? summarizeImageRefUrlForDebug(uploadedMainUrl, 0) : null,
                mergedRefs: nextImage2Refs.map((u, i) => summarizeImageRefUrlForDebug(u, i)),
                apiImageUrls: imageUrls.map((u, i) => summarizeImageRefUrlForDebug(u, i)),
                previewPatch: summarizeImageRefUrlForDebug(image2PreviewPatch.imagePreview, 0),
            });

            image2PanelMergedRefs = nextImage2Refs.length ? [...nextImage2Refs] : null;
            image2PanelMergedLabels = mergedImage2Labels.some((l) => l.trim())
              ? [...mergedImage2Labels]
              : null;
            image2ReferenceSnapshot = [...imageUrls];
            logImage2Debug('snapshot-for-ui-gp', {
                nodeId: idToRun,
                image2ReferenceSnapshot: image2ReferenceSnapshot.map((u, i) =>
                    summarizeImageRefUrlForDebug(u, i)
                ),
                nextImage2Refs: nextImage2Refs.map((u, i) => summarizeImageRefUrlForDebug(u, i)),
            });
            const nextModelConfigs = {
              ...(currentNode.data.modelConfigs || {}),
              image2: {
                ...(((currentNode.data.modelConfigs || {}) as NonNullable<NodeData['modelConfigs']>).image2 || {}),
                prompt: prompt,
                negativePrompt: currentNode.data.negativePrompt,
                numberOfImages: numberOfImagesStr,
                referenceImages: nextImage2Refs,
                image2Style,
                image2AspectRatio: aspectRatio,
                image2ImageSize: imageSize,
                image2Quality,
                image2QualityLevel,
                ...(Object.prototype.hasOwnProperty.call(image2PreviewPatch, 'imagePreview')
                  ? { imagePreview: image2PreviewPatch.imagePreview }
                  : {}),
                ...(Object.prototype.hasOwnProperty.call(image2PreviewPatch, 'panelMainSlotVisible')
                  ? { panelMainSlotVisible: image2PreviewPatch.panelMainSlotVisible }
                  : {}),
                ...(Object.prototype.hasOwnProperty.call(image2PreviewPatch, 'panelMainImageUrl')
                  ? { panelMainImageUrl: image2PreviewPatch.panelMainImageUrl }
                  : {}),
              },
            };
            // 面板按槽位 prune 结果写回（保留下标与「图片n」标签）；API 顺序仅进 generationParams
            const effectiveImage2PanelRefs = nextImage2Refs;
            const image2GpRefLabels =
              image2ReferenceSnapshot?.length
                ? image2PlanForUpload
                    .slice(0, image2ReferenceSnapshot.length)
                    .map((e) => e.label?.trim() || '')
                : mergedImage2Labels;
            setNodes((nds) =>
                nds.map((n) => {
                    if (n.id !== idToRun) return n;
                    return {
                        ...n,
                        data: {
                            ...n.data,
                            ...image2PreviewPatch,
                            referenceImages: effectiveImage2PanelRefs,
                            ...(mergedImage2Labels.some((l) => l.trim())
                                ? { referenceImageLabels: mergedImage2Labels }
                                : {}),
                            modelConfigs: nextModelConfigs,
                        },
                    };
                })
            );
            Object.assign(runCaptureForGp, {
                ...image2PreviewPatch,
                referenceImages: image2ReferenceSnapshot,
                ...(image2GpRefLabels.some((l) => l.trim())
                    ? { referenceImageLabels: image2GpRefLabels }
                    : {}),
                image2AspectRatio: aspectRatio,
                image2ImageSize: imageSize,
                image2Style,
                image2Quality,
                image2QualityLevel,
                modelConfigs: nextModelConfigs,
            });

            const USE_MOCK_IMAGE2 = false;
            if (USE_MOCK_IMAGE2) {
                const mockImageUrls = [
                    'https://picsum.photos/512/512?random=11',
                    'https://picsum.photos/512/512?random=12',
                ].slice(0, finalImageCount);
                generatedImages = mockImageUrls;
            } else {
                const image2Payload = {
                    prompt,
                    imageUrls,
                    options: {
                        aspectRatio,
                        imageSize,
                        style: image2Style,
                        quality: image2Quality,
                        qualityLevel: image2QualityLevel,
                    },
                    generateCount: finalImageCount,
                };
                logModelRequest(MODEL_IMAGE_2, image2Payload);
                generatedImages = await runParallelGenerationTasks(
                    finalImageCount,
                    (i) =>
                        createImage2Task(prompt, imageUrls, {
                            aspectRatio,
                            imageSize,
                            style: image2Style,
                            quality: image2Quality,
                            qualityLevel: image2QualityLevel,
                            clientBatchIndex: i + 1,
                            clientBatchTotal: finalImageCount,
                        }),
                    (taskId) =>
                        pollImageTaskUntilUrl(taskId, {
                            failLabel: 'image 2',
                            intervalMs: 4000,
                            maxAttempts: Math.ceil((20 * 60 * 1000) / 4000),
                            onProgress: () => bumpRunningNodeProgress(1, 95),
                        }),
                    (taskId) => appendRunTaskId(taskId)
                );
                if (generatedImages[0]) {
                    image2ProbedOutputSize = await probeRemotePngDimensions(generatedImages[0]);
                }
                logImage2Debug('poll-results', {
                    nodeId: idToRun,
                    resultCount: generatedImages.length,
                    results: generatedImages.map((u, i) => summarizeImageRefUrlForDebug(u, i)),
                });
            }
        }
        // --- REAL API LOGIC FOR KLING VIDEO ---
        else if (model === '可灵3.0 Omni') {
            /** 上传视频/参考图 + 截帧可能耗时数分钟；与 Nano/image2 一致在全程 tick 进度，避免长期停在 0% */
            bumpRunningNodeProgress(3, 95);
            const omniProgressInterval = window.setInterval(() => {
                bumpRunningNodeProgress(1, 95);
            }, 1000);
            try {
            const originalsKeling = getOriginals(idToRun);

            const klingOmniTab = currentNode.data.klingOmniTab || 'multi';
            /** 与 NodeInspector 各 tab 的提示词字段一致，避免只读 data.prompt 导致指令/视频参考等 tab 为空 */
            const d = currentNode.data;
            let prompt =
                klingOmniTab === 'multi'
                    ? (d.klingOmniMultiPrompt ?? d.prompt ?? '')
                    : klingOmniTab === 'instruction'
                      ? (d.klingOmniInstructionPrompt ?? d.prompt ?? '')
                      : klingOmniTab === 'video'
                        ? (d.klingOmniVideoPrompt ?? d.prompt ?? '')
                        : (d.klingOmniFramesPrompt ?? d.prompt ?? '');
            let negativePrompt =
                klingOmniTab === 'multi'
                    ? (d.klingOmniMultiNegativePrompt ?? d.negativePrompt ?? '')
                    : klingOmniTab === 'instruction'
                      ? (d.klingOmniInstructionNegativePrompt ?? d.negativePrompt ?? '')
                      : klingOmniTab === 'video'
                        ? (d.klingOmniVideoNegativePrompt ?? d.negativePrompt ?? '')
                        : (d.klingOmniFramesNegativePrompt ?? d.negativePrompt ?? '');

            if (!String(prompt).trim()) {
                throw new Error(
                    '可灵3.0 Omni：请填写提示词后再运行（当前输入方式下提示词为空；官方接口要求 prompt 非空）'
                );
            }
            const omniPhCtx = buildRunPromptCtx(d);
            const omniMediaPlan = collectReferencedMediaFromPrompt(
                prompt,
                d,
                omniPhCtx,
                projectAssetBySlugRef.current,
                projectAssetResolveOptsRef.current.projectAssets
            );
            const omniPrOpts = buildReferenceIndexOptionsFromPlan(
                omniMediaPlan,
                projectAssetResolveOptsRef.current
            );
            prompt = resolvePromptPlaceholders(prompt, d, omniPhCtx, omniPrOpts);
            negativePrompt = resolvePromptPlaceholders(negativePrompt, d, omniPhCtx, omniPrOpts);
            const quality = currentNode.data.quality || '高质量';
            const mode: 'std' | 'pro' = quality === '高质量' ? 'pro' : 'std';
            const durationValue = (currentNode.data.duration || '5s').replace('s', '');
            const aspectRatio = ((currentNode.data.aspectRatio || '16:9') as '16:9' | '9:16' | '1:1');

            /**
             * 读取输入视频时长（只取 metadata，失败则返回 undefined）。
             * Kling Omni(base) 会校验视频时长是否与 duration 参数一致。
             */
            const getVideoDurationSeconds = async (
                videoUrl: string
            ): Promise<{ durationSec?: number; metaDurationSec?: number; playDurationSec?: number }> => {
                if (!videoUrl) return {};
                return new Promise((resolve) => {
                    const video = document.createElement('video');
                    video.muted = true;
                    video.playsInline = true;
                    video.preload = 'metadata';
                    // 只读 duration：通常不需要 canvas；加上 crossOrigin 兼容更多 CDN
                    video.crossOrigin = 'anonymous';

                    let done = false;
                    const timeout = window.setTimeout(() => {
                        if (done) return;
                        done = true;
                        cleanup();
                        logPreloadDebug({ model: '可灵3.0 Omni', event: 'timeout', url: videoUrl });
                        resolve(undefined);
                    }, 12000);

                    let metaDurationSec: number | undefined = undefined;
                    let playDurationSec: number | undefined = undefined;

                    const cleanup = () => {
                        window.clearTimeout(timeout);
                        video.removeEventListener('loadedmetadata', onLoadedMetadata);
                        video.removeEventListener('loadeddata', onLoadedData);
                        video.removeEventListener('error', onError);
                        video.src = '';
                        video.load();
                        video.remove();
                    };

                    const onError = () => {
                        if (done) return;
                        done = true;
                        cleanup();
                        logPreloadDebug({ model: '可灵3.0 Omni', event: 'error', url: videoUrl });
                        resolve(undefined);
                    };

                    const onLoadedMetadata = () => {
                        if (done) return;
                        const d = video.duration;
                        if (Number.isFinite(d) && d > 0) metaDurationSec = d;
                        logPreloadDebug({
                            model: '可灵3.0 Omni',
                            event: 'loadedmetadata',
                            url: videoUrl,
                            durationSec: metaDurationSec,
                        });
                        // 不立即 resolve：有些 CDN 的 duration 在 loadedmetadata 阶段可能不准确
                    };

                    const onLoadedData = () => {
                        if (done) return;
                        const d = video.duration;
                        if (Number.isFinite(d) && d > 0) playDurationSec = d;
                        logPreloadDebug({
                            model: '可灵3.0 Omni',
                            event: 'loadeddata',
                            url: videoUrl,
                            durationSec: playDurationSec,
                        });
                        done = true;
                        cleanup();
                        resolve({
                            durationSec: playDurationSec ?? metaDurationSec,
                            metaDurationSec,
                            playDurationSec,
                        });
                    };

                    video.addEventListener('loadedmetadata', onLoadedMetadata);
                    video.addEventListener('loadeddata', onLoadedData);
                    video.addEventListener('error', onError);
                    video.src = videoUrl;
                    video.load();
                });
            };

            const ensureImageUrl = async (src: string): Promise<string> => {
                if (!src) throw new Error('ensureImageUrl: empty src');
                if (src.includes('aitop100app-1251510006')) return src;
                const prepared = await prepareLocalImageSrcCached(src);
                const uploaded = await uploadImageCached(prepared);
                if (!uploaded) throw new Error('图片上传失败');
                return uploaded;
            };

            /** 与 @主图/@主视频 解析一致：勿把 blob 本地图预览、带 video 子串的图片 CDN 误判为视频 */
            const looksLikeVideoUrlForImage = (url?: string): boolean => isLikelyMainVideoUrl(url);

            /** 与 ensureImageUrl 一致：仅 AiTop COS 上的地址可直接用于接口；其它 http(s)/blob 一律 uploadVideo 再传 */
            const isAitopCosVideoUrl = (u?: string) => Boolean(u && u.includes('aitop100app-1251510006'));

            const looksLikeVideoUrl = (url?: string): boolean => {
                if (!url) return false;
                return (
                    /\.(mov|mp4|webm|avi|mkv|flv|wmv|m4v)(\?|$)/i.test(url) ||
                    url.startsWith('blob:') ||
                    /video/i.test(url)
                );
            };

            const ensureVideoUrl = async (params: { file?: File; previewUrl?: string; uploadedUrl?: string }): Promise<string> => {
                const { file, previewUrl, uploadedUrl } = params;

                const finalize = (u: string) => prepareVideoUrlForModelDimensions(u);

                if (isAitopCosVideoUrl(uploadedUrl)) return finalize(uploadedUrl as string);
                if (isAitopCosVideoUrl(previewUrl)) return finalize(previewUrl as string);

                if (file) {
                    const objUrl = URL.createObjectURL(file);
                    try {
                        const uploaded = await uploadVideoCached(objUrl);
                        if (!uploaded) throw new Error('视频上传 AiTop 失败');
                        return finalize(uploaded);
                    } finally {
                        URL.revokeObjectURL(objUrl);
                    }
                }

                // 非 COS 的预览/已存 URL（含上游 MOV 的第三方 CDN、本地 blob）：统一拉取并上传到 AiTop，避免把 kechuangai 等直传给可灵
                const tryUpload = async (src: string) => {
                    const uploaded = await uploadVideoCached(src);
                    if (!uploaded) {
                        throw new Error(
                            '视频需先上传到 AiTop。若来自远程链接且浏览器无法下载（跨域限制），请把视频保存到本地后再拖入节点。'
                        );
                    }
                    return uploaded;
                };

                if (previewUrl && looksLikeVideoUrl(previewUrl)) {
                    return finalize(await tryUpload(previewUrl));
                }
                if (uploadedUrl && looksLikeVideoUrl(uploadedUrl)) {
                    return finalize(await tryUpload(uploadedUrl));
                }

                throw new Error('可灵3.0 Omni：请先上传视频素材');
            };

            // 兜底：instruction/video tab 如果缺少视频输入，则尝试从上游 MOV 节点取视频 URL
            const findUpstreamMovVideoUrl = (): { url?: string; durationFromNode?: '5' | '10' } | undefined => {
                if (!['instruction', 'video'].includes(klingOmniTab)) return undefined;
                const nodes = getNodes();
                const edges = getEdges();
                const byId = new Map(nodes.map((n) => [n.id, n]));
                const visited = new Set<string>();
                let queue: Array<{ id: string; depth: number }> = edges
                    .filter((ed) => ed.target === idToRun)
                    .map((ed) => ({ id: ed.source, depth: 1 }));

                // 多父节点时优先从「视频节点 MOV」再 OUTPUT 取视频，减少误用其它分支上的素材
                queue.sort((a, b) => {
                    const na = byId.get(a.id);
                    const nb = byId.get(b.id);
                    const rank = (n: RFNode | undefined) => {
                        if (!n) return 0;
                        if (n.type === NodeType.MOV) return 3;
                        if (n.type === NodeType.OUTPUT) return 2;
                        if (n.type === NodeType.PROCESSOR) return 1;
                        return 0;
                    };
                    return rank(nb) - rank(na);
                });

                const parseDurationFromNode = (n: RFNode): '5' | '10' | undefined => {
                    const raw =
                        (n.data as any)?.generationParams?.duration ??
                        (n.data as any)?.duration;
                    if (!raw) return undefined;
                    const digits = String(raw).replace(/[^\d]/g, '');
                    if (digits === '5') return '5';
                    if (digits === '10') return '10';
                    return undefined;
                };

                const isVideoUrl = (url?: string): boolean => {
                    if (!url) return false;
                    return (
                        /\.(mov|mp4|webm|avi|mkv|flv|wmv|m4v)(\?|$)/i.test(url) ||
                        url.startsWith('blob:') ||
                        /video/i.test(url)
                    );
                };

                while (queue.length > 0) {
                    const cur = queue.shift();
                    if (!cur) break;
                    if (visited.has(cur.id)) continue;
                    visited.add(cur.id);
                    const n = byId.get(cur.id);
                    const url = (n?.data as any)?.imagePreview as string | undefined;
                    

                    // 如果上游节点是 INPUT/PROCESSOR，它可能把视频结果写在 data.generatedThumbnails 里
                    const thumbnails = (n?.data as any)?.generatedThumbnails;
                    if (Array.isArray(thumbnails)) {
                        const videoThumb = thumbnails.find((t: any) => t?.type === 'video' && isVideoUrl(t?.url));
                        if (videoThumb?.url) {
                            return {
                                url: videoThumb.url,
                                durationFromNode: parseDurationFromNode(n as RFNode),
                            };
                        }
                    }

                    if (isVideoUrl(url)) {
                        return {
                            url,
                            durationFromNode: parseDurationFromNode(n as RFNode),
                        };
                    }
                    if (cur.depth >= 8) continue;
                    const parents = edges.filter((ed) => ed.target === cur.id).map((ed) => ed.source);
                    for (const pid of parents) queue.push({ id: pid, depth: cur.depth + 1 });
                }
                return undefined;
            };

            let taskId: string | null = null;
            let omniBatchPayload: Record<string, unknown> | null = null;
            const omniGenerateCount = resolvePanelGenerateCount(currentNode.data);
            let firstFrameUrlForUi: string | undefined;
            let lastFrameUrlForUi: string | undefined;
            let klingOmniVideoUrlForUi: string | undefined;
            /** Omni multi：除首帧外参考图上传后的 URL，供 modelDrift 时 runCapture 与 Node Details 一致 */

            // 1) 首尾帧：首帧/尾帧图片生成
            if (klingOmniTab === 'frames') {
                let firstFrameImage: string | undefined;
                let lastFrameImage: string | undefined;
                for (const entry of omniMediaPlan.images) {
                    if (entry.token === '@尾帧图' || entry.token === '@图片2') {
                        lastFrameImage = entry.url;
                    } else if (
                        entry.token === '@主图' ||
                        entry.token === '@主体' ||
                        entry.token === '@首帧图' ||
                        entry.token === '@图片1' ||
                        entry.token === '@图片'
                    ) {
                        if (!firstFrameImage) firstFrameImage = entry.url;
                    }
                }
                if (!firstFrameImage && omniMediaPlan.images.length > 0) {
                    const first = omniMediaPlan.images[0];
                    if (first.token !== '@尾帧图' && first.token !== '@图片2') {
                        firstFrameImage = first.url;
                    }
                }
                if (!firstFrameImage) {
                    throw new Error(
                        '可灵3.0 Omni(frames)：请在创意描述中用 @首帧图、@图片1 或 @主图 至少引用一张首帧图片'
                    );
                }

                if (originalsKeling.firstFrame) {
                    try { firstFrameImage = await fileToDataUrlCached(originalsKeling.firstFrame); } catch (_) { /* keep */ }
                }
                if (originalsKeling.lastFrame && lastFrameImage) {
                    try { lastFrameImage = await fileToDataUrlCached(originalsKeling.lastFrame); } catch (_) { /* keep */ }
                }

                const firstFrameUrl = await ensureImageUrl(firstFrameImage);
                const lastFrameUrl = lastFrameImage ? await ensureImageUrl(lastFrameImage) : undefined;
                firstFrameUrlForUi = firstFrameUrl;
                lastFrameUrlForUi = lastFrameUrl;
                firstLastFramePanelPatch = buildFirstLastFramePanelPatchFromPlan(
                    omniMediaPlan.images,
                    { startUrl: firstFrameUrl, endUrl: lastFrameUrl }
                );

                const imageList = [
                    { image_url: firstFrameUrl, type: 'first_frame' as const },
                    ...(lastFrameUrl ? [{ image_url: lastFrameUrl, type: 'end_frame' as const }] : []),
                ] as Array<{ image_url: string; type?: 'first_frame' | 'end_frame' }>;

                const omniFramesPayload = {
                    prompt,
                    negativePrompt,
                    modelName: 'KLING_V3_OMNI',
                    mode,
                    duration: durationValue,
                    aspectRatio,
                    imageList
                };
                logModelRequest('可灵3.0 Omni(frames)', { ...omniFramesPayload, generateCount: omniGenerateCount });
                omniBatchPayload = { ...omniFramesPayload, generateNum: 1 };
                taskId = await createKlingOmniVideoTask(omniBatchPayload as any);
            }

            // 2) 多图参考：多张图片参考（不含视频）
            if (!taskId && klingOmniTab === 'multi') {
                const omniStartTokens = OMNI_MULTI_FIRST_FRAME_TOKENS;
                const omniFirstEntry =
                    omniMediaPlan.images.find((e) => omniStartTokens.has(e.token)) ??
                    omniMediaPlan.images.find((e) => e.token === '@图片1' || e.token === '@图片') ??
                    omniMediaPlan.images[0];
                if (!omniFirstEntry) {
                    throw new Error(
                        '可灵3.0 Omni(multi)：请在创意描述中用 @主图 或 @首帧图 指定首帧；参考格请用 @图片1、@图片2（勿与首帧混用同一 token）'
                    );
                }
                const panelMulti = Array.isArray(currentNode.data.klingOmniMultiReferenceImages)
                    ? [...currentNode.data.klingOmniMultiReferenceImages]
                    : [];
                const refElementIds = currentNode.data.klingOmniMultiReferenceElementIds ?? [];
                const maxRefImages = Math.max(0, 7 - 1);

                const omniMultiUploadCtx: UploadReferencedImageContext = {
                    originals: originalsKeling,
                    panelReferenceImages: panelMulti,
                    fileToDataUrlCached,
                    prepareLocalImageSrcCached,
                    uploadImageCached,
                    flowgenAssetFileUrlFromMediaUrl,
                    isFlowgenAssetThumbUrl,
                };

                let baseFirstImage = omniFirstEntry.url;
                const uploadMainFromOriginalFile =
                    MAIN_IMAGE_REF_TOKENS.has(omniFirstEntry.token) && Boolean(originalsKeling.main);
                let firstFrameUrl: string;
                if (uploadMainFromOriginalFile) {
                    firstFrameUrl = await uploadReferencedImageEntry(omniFirstEntry, omniMultiUploadCtx);
                } else {
                    if (looksLikeVideoUrlForImage(baseFirstImage) && currentNode.data.videoPosterDataUrl) {
                        baseFirstImage = currentNode.data.videoPosterDataUrl;
                    }
                    if (looksLikeVideoUrlForImage(baseFirstImage)) {
                        throw new Error(
                            '可灵3.0 Omni(multi)：首帧须为图片。若主预览是视频，请等待缩略图生成或换用图片主图；本地 JPEG/PNG 拖入主图槽后请直接运行。'
                        );
                    }
                    firstFrameUrl = await ensureImageUrl(baseFirstImage);
                }
                firstFrameUrlForUi = firstFrameUrl;
                const omniMultiUploadedByToken = new Map<string, string>();
                omniMultiUploadedByToken.set(omniFirstEntry.token, firstFrameUrl);
                for (const entry of omniMediaPlan.images) {
                    if (entry.token === omniFirstEntry.token) continue;
                    if (omniStartTokens.has(entry.token)) {
                        omniMultiUploadedByToken.set(entry.token, firstFrameUrl);
                        continue;
                    }
                    const upUrl = await uploadReferencedImageEntry(entry, omniMultiUploadCtx);
                    omniMultiUploadedByToken.set(entry.token, upUrl);
                }
                omniMediaPlanForGp = omniMediaPlan;
                omniMultiUploadedByTokenForGp = omniMultiUploadedByToken;
                omniMultiFirstFrameUrlForGp = firstFrameUrl;

                omniMultiMergedRefs = mergeAndPrunePanelReferenceImagesAfterUpload(
                    panelMulti,
                    omniMediaPlan.images,
                    omniMultiUploadedByToken,
                    panelMergeOptionsForReferencedUpload(
                        omniMediaPlan.images,
                        omniMultiUploadedByToken,
                        currentNode.data.imagePreview,
                        projectAssetBySlugRef.current,
                        currentNode.data.referenceImageLabels
                    )
                );
                omniMultiMergedLabels = resolveReferenceImageLabelsAfterPanelRun({
                    panelBefore: panelMulti,
                    labelsBefore: currentNode.data.referenceImageLabels,
                    panelAfter: omniMultiMergedRefs,
                    plan: omniMediaPlan,
                    projectAssets: projectAssetResolveOptsRef.current.projectAssets,
                });
                omniMultiPreviewPatch = buildPanelImagePreviewPatchAfterRun(
                    omniMediaPlan.images,
                    omniMultiUploadedByToken,
                    {
                        nodeData: currentNode.data,
                        mergedPanelRefs: omniMultiMergedRefs,
                        mergedPanelLabels: omniMultiMergedLabels,
                        projectAssets: projectAssetResolveOptsRef.current.projectAssets,
                    }
                );
                await enrichPanelPreviewPatchWithFreshMainBackup(omniMultiPreviewPatch, currentNode.data);

                const extraEntries = omniMediaPlan.images
                    .filter((e) => !omniStartTokens.has(e.token))
                    .slice(0, maxRefImages);
                const imageList = buildOmniMultiApiImageList({
                    firstFrameUrl,
                    extraEntries,
                    uploadedByToken: omniMultiUploadedByToken,
                    refElementIds,
                    maxRefImages,
                });

                /** 主体 id 在入参各行 element_id 上；createKlingOmniVideoTask 会拆成与 imageList 平级的 elementList */
                const omniMultiPayload = {
                    prompt,
                    negativePrompt,
                    modelName: 'KLING_V3_OMNI',
                    mode,
                    duration: durationValue,
                    aspectRatio,
                    imageList,
                    omniMultiReferenceNoType: true,
                };
                logPreloadDebug({
                    model: '可灵3.0 Omni(multi)',
                    event: 'request',
                    imageList,
                    duration: durationValue,
                    aspectRatio,
                });
                logModelRequest('可灵3.0 Omni(multi)', { ...omniMultiPayload, generateCount: omniGenerateCount });
                omniMultiApiRefSnapshot = imageList.map((row) => row.image_url).filter(Boolean);
                omniBatchPayload = { ...omniMultiPayload, generateNum: 1 };
                taskId = await createKlingOmniVideoTask(omniBatchPayload as any);
            }

            // 3) 指令变换 / 视频参考：支持图片 + 视频编辑/参考
            if (!taskId && (klingOmniTab === 'instruction' || klingOmniTab === 'video')) {
                // 已显式绑定在本节点的视频（含 referenceMovs）优先，勿在无预览时误用上游 BFS 的其它视频
                const refMovFirst = currentNode.data.referenceMovs?.find(
                    (m) => m?.url && looksLikeVideoUrl(m.url)
                )?.url;
                const resolvedOmniSlotUrl =
                    klingOmniTab === 'instruction'
                        ? resolveOmniInstructionRunVideoUrl(currentNode.data)
                        : resolveOmniVideoTabRunVideoUrl(currentNode.data);
                const hasExplicitOmniVideo = Boolean(resolvedOmniSlotUrl || refMovFirst);
                const upstreamMovVideoMeta = !hasExplicitOmniVideo ? findUpstreamMovVideoUrl() : undefined;
                const upstreamMovVideoUrl = upstreamMovVideoMeta?.url;

                const panelTabRefs =
                    klingOmniTab === 'instruction'
                        ? [
                              ...(currentNode.data.klingOmniInstructionReferenceImages ??
                                  currentNode.data.referenceImages ??
                                  []),
                          ]
                        : [
                              ...(currentNode.data.klingOmniVideoReferenceImages ??
                                  currentNode.data.referenceImages ??
                                  []),
                          ];
                const refElementIds =
                    klingOmniTab === 'instruction'
                        ? (currentNode.data.klingOmniInstructionReferenceElementIds ?? [])
                        : (currentNode.data.klingOmniVideoReferenceElementIds ?? []);
                // instruction/video 模式：至少需要 1 张图片（接口封装要求 imageList 非空）
                // 如果 referenceImages 为空，则用当前节点的 imagePreview 作为主体/示例图；
                // 当 imagePreview 是视频且截帧失败时，继续回退到首帧槽位/历史快照/参考视频 poster，避免 Node Details 的 Reference Images 为空。
                let baseImagePreview = currentNode.data.imagePreview;
                if (looksLikeVideoUrlForImage(baseImagePreview) && currentNode.data.videoPosterDataUrl) {
                    baseImagePreview = currentNode.data.videoPosterDataUrl;
                }
                if (looksLikeVideoUrlForImage(baseImagePreview)) {
                    const gpCur = (currentNode.data.generationParams || {}) as GenerationParams & {
                        referenceMovs?: Array<{ url: string; posterDataUrl?: string }>;
                    };
                    const fallbackImageCandidates = [
                        currentNode.data.firstFrameImageUrl,
                        currentNode.data.firstFrameImage,
                        gpCur.firstFrameImageUrl,
                        gpCur.firstFrameImage,
                        currentNode.data.referenceMovs?.find((m) => m?.posterDataUrl)?.posterDataUrl,
                        gpCur.referenceMovs?.find((m) => m?.posterDataUrl)?.posterDataUrl,
                        currentNode.data.videoPosterDataUrl,
                        (currentNode.data.generationParams as any)?.videoPosterDataUrl,
                    ].filter((u): u is string => typeof u === 'string' && !!u);
                    const firstStill = fallbackImageCandidates.find((u) => !looksLikeVideoUrlForImage(u));
                    if (firstStill) {
                        baseImagePreview = firstStill;
                    }
                }

                const refImageRows = panelTabRefs
                    .map((u, panelIndex) => ({
                        url: u,
                        elementId: refElementIds[panelIndex],
                        panelIndex,
                    }))
                    .filter(({ url }) => !!url && !looksLikeVideoUrlForImage(url));

                const omniTabUploadCtx: UploadReferencedImageContext = {
                    originals: originalsKeling,
                    panelReferenceImages: panelTabRefs,
                    fileToDataUrlCached,
                    prepareLocalImageSrcCached,
                    uploadImageCached,
                    flowgenAssetFileUrlFromMediaUrl,
                    isFlowgenAssetThumbUrl,
                };

                let imageList: Array<{
                    image_url: string;
                    type?: 'first_frame' | 'end_frame';
                    element_id?: string;
                }>;

                if (omniMediaPlan.images.length > 0) {
                    const omniTabUploadedByToken = new Map<string, string>();
                    for (const entry of omniMediaPlan.images) {
                        const upUrl = await uploadReferencedImageEntry(entry, omniTabUploadCtx);
                        omniTabUploadedByToken.set(entry.token, upUrl);
                    }
                    omniTabMergedRefs = mergeAndPrunePanelReferenceImagesAfterUpload(
                        panelTabRefs,
                        omniMediaPlan.images,
                        omniTabUploadedByToken,
                        panelMergeOptionsForReferencedUpload(
                            omniMediaPlan.images,
                            omniTabUploadedByToken,
                            currentNode.data.imagePreview,
                            projectAssetBySlugRef.current,
                            currentNode.data.referenceImageLabels
                        )
                    );
                    omniTabMergedLabels = resolveReferenceImageLabelsAfterPanelRun({
                        panelBefore: panelTabRefs,
                        labelsBefore: currentNode.data.referenceImageLabels,
                        panelAfter: omniTabMergedRefs,
                        plan: omniMediaPlan,
                        projectAssets: projectAssetResolveOptsRef.current.projectAssets,
                    });
                    omniTabPreviewPatch = buildPanelImagePreviewPatchAfterRun(
                        omniMediaPlan.images,
                        omniTabUploadedByToken,
                        {
                            nodeData: currentNode.data,
                            mergedPanelRefs: omniTabMergedRefs,
                            mergedPanelLabels: omniTabMergedLabels,
                            projectAssets: projectAssetResolveOptsRef.current.projectAssets,
                        }
                    );
                    await enrichPanelPreviewPatchWithFreshMainBackup(omniTabPreviewPatch, currentNode.data);
                    imageList = omniMediaPlan.images.slice(0, 4).map((entry) => {
                        const url = omniTabUploadedByToken.get(entry.token)!;
                        const idx = entry.refImageSlotIndex ?? 0;
                        const eid = refElementIds[idx];
                        return eid
                            ? { image_url: url, element_id: String(eid) }
                            : { image_url: url };
                    });
                } else {
                    const combinedImages =
                        refImageRows.length > 0
                            ? refImageRows.map((r) => r.url)
                            : baseImagePreview && !looksLikeVideoUrlForImage(baseImagePreview)
                              ? [baseImagePreview]
                              : [];
                    const uploadedRefBySlot = new Map<number, string>();
                    const uploadedRefUrls: string[] = [];
                    for (const row of refImageRows.slice(0, 4)) {
                        const up = await ensureImageUrl(row.url);
                        uploadedRefBySlot.set(row.panelIndex, up);
                        uploadedRefUrls.push(up);
                    }
                    omniTabMergedRefs = mergeSeedancePanelReferenceImagesAfterUpload(
                        panelTabRefs,
                        uploadedRefBySlot,
                        undefined,
                        currentNode.data.imagePreview
                    );
                    const sliceElementIds = refImageRows.slice(0, 4).map((r) => r.elementId);
                    imageList = uploadedRefUrls.map((url, i) => {
                        const eid = sliceElementIds[i];
                        return eid
                            ? { image_url: url, element_id: String(eid) }
                            : { image_url: url };
                    });
                    if (!omniTabMergedRefs.length && combinedImages.length > 0) {
                        omniTabMergedRefs = [...combinedImages];
                    }
                }

                if (!firstFrameUrlForUi && imageList.length > 0) {
                    firstFrameUrlForUi = imageList[0].image_url;
                }

                const dOmni = currentNode.data as NodeData & {
                    klingOmniInstructionVideoPreviewUrl?: string;
                    klingOmniInstructionVideoUrl?: string;
                };
                let videoUrl = await ensureVideoUrl({
                    file: originalsKeling.klingOmniVideo,
                    previewUrl:
                        (klingOmniTab === 'instruction'
                            ? dOmni.klingOmniInstructionVideoPreviewUrl
                            : currentNode.data.klingOmniVideoPreviewUrl) ||
                        refMovFirst ||
                        upstreamMovVideoUrl,
                    uploadedUrl:
                        klingOmniTab === 'instruction'
                            ? dOmni.klingOmniInstructionVideoUrl
                            : currentNode.data.klingOmniVideoUrl,
                });
                klingOmniVideoUrlForUi = videoUrl;
                const omniTabApiRefImages = imageList.map((row) => row.image_url).filter(Boolean);
                const normVid = (u: string) => u.split('#')[0].split('?')[0].replace(/\/+$/, '').toLowerCase();
                const omniRefMovPoster = pickReferenceMovPoster(
                    videoUrl,
                    currentNode.data.referenceMovs?.find(
                        (m) => m?.url && (m.url === videoUrl || normVid(m.url) === normVid(videoUrl))
                    )?.posterDataUrl,
                    currentNode.data.referenceMovs?.find((m) => m?.posterDataUrl)?.posterDataUrl,
                    currentNode.data.videoPosterDataUrl,
                    (currentNode.data.generationParams as any)?.referenceMovs?.find(
                        (m: { posterDataUrl?: string }) => m?.posterDataUrl
                    )?.posterDataUrl
                );
                let omniRefMovPosterFinal = omniRefMovPoster;
                if (!omniRefMovPosterFinal && videoUrl) {
                    const captured = await captureVideoMiddleFrameQueued(videoUrl);
                    omniRefMovPosterFinal = pickReferenceMovPoster(videoUrl, captured ?? undefined);
                }
                klingOmniReferenceSnapshot = {
                    referenceImages:
                        omniTabApiRefImages.length > 0
                            ? omniTabApiRefImages
                            : [...(omniTabMergedRefs || [])],
                    panelReferenceImages: omniTabMergedRefs?.length
                        ? [...omniTabMergedRefs]
                        : undefined,
                    referenceMovs: [
                        {
                            url: videoUrl,
                            ...(omniRefMovPosterFinal ? { posterDataUrl: omniRefMovPosterFinal } : {}),
                        },
                    ],
                };

                const refer_type = klingOmniTab === 'instruction' ? 'base' : 'feature';
                const keep_original_sound = currentNode.data.klingAudioSync ? 'yes' : 'no';

                let klingDurationValue = durationValue;

                if (refer_type === 'base' && videoUrl) {
                    // 由输入视频真实时长推导 duration：floor/round/ceil（3-15s）逐个尝试
                    const durationInfo = await getVideoDurationSeconds(videoUrl);
                    const inputDurSec = durationInfo?.durationSec;
                    const nodeDerived = upstreamMovVideoMeta?.durationFromNode;

                    const clampDurationInt = (n: number): number | undefined => {
                        if (!Number.isFinite(n)) return undefined;
                        const i = Math.round(n);
                        if (i < 3 || i > 15) return undefined;
                        return i;
                    };

                    const candidatesSet = new Set<string>();
                    const addCandidate = (sec: number | undefined) => {
                        if (sec == null || !Number.isFinite(sec)) return;
                        const f = Math.floor(sec);
                        const r = Math.round(sec);
                        const c = Math.ceil(sec);
                        for (const v of [f, r, c]) {
                            const ok = clampDurationInt(v);
                            if (ok != null) candidatesSet.add(String(ok));
                        }
                    };

                    addCandidate(inputDurSec);
                    if (nodeDerived) candidatesSet.add(String(nodeDerived));
                    if (klingDurationValue) candidatesSet.add(String(klingDurationValue));

                    const durationCandidates = Array.from(candidatesSet)
                        .map((s) => s.trim())
                        .filter((s) => /^\d+$/.test(s))
                        .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

                    logFlowGenGraph('klingOmni-duration-candidates', {
                        nodeId: currentNode.id,
                        klingOmniTab,
                        refer_type,
                        uiDuration: durationValue,
                        nodeDerivedDuration: nodeDerived,
                        inputDurSec,
                        metaDurationSec: durationInfo?.metaDurationSec,
                        playDurationSec: durationInfo?.playDurationSec,
                        durationCandidates,
                        videoUrlPrefix: videoUrl.slice(0, 60),
                    });

                    let lastErr: any = null;
                    for (const candDuration of durationCandidates) {
                        try {
                            const omniVideoPayload = {
                                prompt,
                                negativePrompt,
                                modelName: 'KLING_V3_OMNI',
                                mode,
                                duration: candDuration,
                                aspectRatio,
                                imageList,
                                videoList: [
                                    {
                                        video_url: videoUrl,
                                        refer_type,
                                        keep_original_sound,
                                    }
                                ],
                            };
                            logModelRequest('可灵3.0 Omni(instruction/video)', { ...omniVideoPayload, generateCount: omniGenerateCount });
                            omniBatchPayload = { ...omniVideoPayload, generateNum: 1 };
                            taskId = await createKlingOmniVideoTask(omniBatchPayload as any);
                            lastErr = null;
                            break;
                        } catch (err: any) {
                            lastErr = err;
                            const errMsg = err instanceof Error ? err.message : String(err);
                            if (/时长.*不一致|视频时长不一致|duration.*mismatch/i.test(errMsg)) {
                                logFlowGenGraph('klingOmni-duration-candidate-failed', {
                                    nodeId: currentNode.id,
                                    klingOmniTab,
                                    refer_type,
                                    triedDuration: candDuration,
                                    error: errMsg,
                                    videoUrlPrefix: videoUrl.slice(0, 60),
                                });
                                continue;
                            }
                            throw err;
                        }
                    }

                    if (!taskId && lastErr) {
                        throw lastErr;
                    }
                } else {
                    // feature 或其它：只按 UI 的 duration 传
                    const omniFeaturePayload = {
                        prompt,
                        negativePrompt,
                        modelName: 'KLING_V3_OMNI',
                        mode,
                        duration: klingDurationValue,
                        aspectRatio,
                        imageList,
                        videoList: [
                            {
                                video_url: videoUrl,
                                refer_type,
                                keep_original_sound,
                            }
                        ],
                    };
                    logModelRequest('可灵3.0 Omni(instruction/video)', { ...omniFeaturePayload, generateCount: omniGenerateCount });
                    omniBatchPayload = { ...omniFeaturePayload, generateNum: 1 };
                    taskId = await createKlingOmniVideoTask(omniBatchPayload as any);
                }
            }

            if (!taskId) throw new Error('可灵3.0 Omni 任务创建失败');
            appendRunTaskId(taskId);

            // 写回 UI 展示用的上传结果（首帧/尾帧与 URL 对齐，避免 blob+https 双轨导致 Omni 首尾帧角标/@图片1 与主图不一致）
            const shouldPatchOmniMainPreview =
                currentNode.type === NodeType.INPUT || currentNode.type === NodeType.PROCESSOR;
            const omniHasRefVideo =
              (klingOmniReferenceSnapshot?.referenceMovs?.length ?? 0) > 0;
            const omniFramePreview =
                firstLastFramePanelPatch?.firstFrameImageUrl ||
                firstLastFramePanelPatch?.firstFrameImage ||
                firstFrameUrlForUi;
            patchNodeDataById(currentNode.id, {
                ...(firstLastFramePanelPatch || {}),
                ...(omniFramePreview && shouldPatchOmniMainPreview ? { imagePreview: omniFramePreview } : {}),
                ...(!firstLastFramePanelPatch &&
                !omniHasRefVideo &&
                firstFrameUrlForUi
                    ? { firstFrameImageUrl: firstFrameUrlForUi, firstFrameImage: firstFrameUrlForUi }
                    : {}),
                ...(!firstLastFramePanelPatch && lastFrameUrlForUi
                    ? { lastFrameImageUrl: lastFrameUrlForUi, lastFrameImage: lastFrameUrlForUi }
                    : {}),
                ...(klingOmniVideoUrlForUi
                    ? klingOmniTab === 'instruction'
                        ? { klingOmniInstructionVideoUrl: klingOmniVideoUrlForUi }
                        : { klingOmniVideoUrl: klingOmniVideoUrlForUi }
                    : {}),
            });

            // 轮询前固化本次 Omni 实际上传结果（与其它视频模型 runCapture 策略一致）
            Object.assign(runCaptureForGp, {
                ...(firstLastFramePanelPatch || {}),
                ...(omniFramePreview && shouldPatchOmniMainPreview ? { imagePreview: omniFramePreview } : {}),
                ...(!firstLastFramePanelPatch &&
                !omniHasRefVideo &&
                firstFrameUrlForUi
                    ? { firstFrameImageUrl: firstFrameUrlForUi, firstFrameImage: firstFrameUrlForUi }
                    : {}),
                ...(!firstLastFramePanelPatch && lastFrameUrlForUi
                    ? { lastFrameImageUrl: lastFrameUrlForUi, lastFrameImage: lastFrameUrlForUi }
                    : {}),
                ...(klingOmniVideoUrlForUi
                    ? klingOmniTab === 'instruction'
                        ? { klingOmniInstructionVideoUrl: klingOmniVideoUrlForUi }
                        : { klingOmniVideoUrl: klingOmniVideoUrlForUi }
                    : {}),
            });
            if (
                (klingOmniTab === 'instruction' || klingOmniTab === 'video') &&
                (omniTabMergedRefs?.length || klingOmniReferenceSnapshot)
            ) {
                const tabRefPatch = omniTabMergedRefs?.length
                    ? klingOmniTab === 'instruction'
                        ? {
                              klingOmniInstructionReferenceImages: [...omniTabMergedRefs],
                          }
                        : { klingOmniVideoReferenceImages: [...omniTabMergedRefs] }
                    : klingOmniReferenceSnapshot?.panelReferenceImages?.length
                      ? klingOmniTab === 'instruction'
                          ? {
                                klingOmniInstructionReferenceImages: [
                                    ...klingOmniReferenceSnapshot.panelReferenceImages,
                                ],
                            }
                          : {
                                klingOmniVideoReferenceImages: [
                                    ...klingOmniReferenceSnapshot.panelReferenceImages,
                                ],
                            }
                      : {};
                const omniTabLabelPatch =
                    omniTabMergedLabels?.some((l) => l.trim())
                        ? { referenceImageLabels: [...omniTabMergedLabels] }
                        : {};
                Object.assign(runCaptureForGp, {
                    ...(omniTabPreviewPatch || {}),
                    ...tabRefPatch,
                    ...omniTabLabelPatch,
                    ...(klingOmniReferenceSnapshot?.referenceMovs?.length
                        ? { referenceMovs: klingOmniReferenceSnapshot.referenceMovs }
                        : {}),
                });
                patchNodeDataById(currentNode.id, {
                    ...(omniTabPreviewPatch || {}),
                    ...tabRefPatch,
                    ...omniTabLabelPatch,
                    ...(klingOmniReferenceSnapshot?.referenceMovs?.length
                        ? { referenceMovs: klingOmniReferenceSnapshot.referenceMovs }
                        : {}),
                });
            }
            if (klingOmniTab === 'multi' && omniMultiMergedRefs) {
                const omniMultiLabelPatch = (omniMultiMergedLabels || []).some((l) => l.trim())
                    ? { referenceImageLabels: [...(omniMultiMergedLabels || [])] }
                    : {};
                Object.assign(runCaptureForGp, {
                    ...(omniMultiPreviewPatch || {}),
                    klingOmniMultiReferenceImages: [...omniMultiMergedRefs],
                    ...omniMultiLabelPatch,
                });
                patchNodeDataById(currentNode.id, {
                    ...(omniMultiPreviewPatch || {}),
                    klingOmniMultiReferenceImages: [...omniMultiMergedRefs],
                    ...omniMultiLabelPatch,
                });
            }
            // 2) 轮询任务状态（数量>1 时创建多个独立任务，各 generateNum=1）
            const pollOmniVideo = (tid: string) =>
                pollVideoTaskUntilUrl(tid, {
                    failLabel: '可灵3.0 Omni',
                    intervalMs: 5000,
                    maxAttempts: 240,
                    onProgress: () => bumpRunningNodeProgress(1, 95),
                    stabilize: (url) =>
                        stabilizeVideoResourceUrl(url, { modelTag: '可灵3.0Omni', taskId: tid }),
                });
            if (omniGenerateCount > 1 && omniBatchPayload) {
                const omniTaskIds: string[] = [taskId];
                for (let i = 1; i < omniGenerateCount; i++) {
                    const extraPayload = {
                        ...omniBatchPayload,
                        generateNum: 1,
                        clientBatchIndex: i + 1,
                        clientBatchTotal: omniGenerateCount,
                    };
                    const extraId = await createKlingOmniVideoTask(extraPayload as any);
                    if (!extraId) {
                        throw new Error(`可灵3.0 Omni 任务 ${i + 1} 创建失败`);
                    }
                    omniTaskIds.push(extraId);
                    appendRunTaskId(extraId);
                }
                generatedImages = await Promise.all(omniTaskIds.map((tid) => pollOmniVideo(tid)));
            } else {
                generatedImages = [await pollOmniVideo(taskId)];
            }
            if (!generatedImages.length) throw new Error('可灵3.0 Omni 视频生成超时');
            } finally {
                window.clearInterval(omniProgressInterval);
            }
        }
        // --- REAL API LOGIC FOR KLING VIDEO ---
        else if (model.includes('可灵') || model.includes('Keling')) {
            // 🔧 [测试模式] 暂时屏蔽 API 调用，使用模拟数据
            const USE_MOCK_VIDEO = false; // 设置为 true 来使用模拟数据
            
            if (USE_MOCK_VIDEO) {
                // 使用模拟视频 URL（使用一个更可靠的测试视频 URL）
                const mockVideoUrl = 'https://sample-videos.com/video123/mp4/720/big_buck_bunny_720p_1mb.mp4';
                generatedImages = [mockVideoUrl];
            } else {
            const klingCtx = buildRunPromptCtx(currentNode.data);
            const rawKlingPrompt =
              getCanonicalInspectorPromptText(
                runStartDataSnapshot,
                projectAssetResolveOptsRef.current.projectAssets
              ) || '';
            const klingMediaPlan = collectReferencedMediaFromPrompt(
                rawKlingPrompt,
                currentNode.data,
                klingCtx,
                projectAssetBySlugRef.current,
                projectAssetResolveOptsRef.current.projectAssets
            );
            const klingPrOpts = buildReferenceIndexOptionsFromPlan(
                klingMediaPlan,
                projectAssetResolveOptsRef.current
            );
            const prompt = resolvePromptPlaceholders(
                rawKlingPrompt,
                currentNode.data,
                klingCtx,
                klingPrOpts
            );
            const negativePrompt = resolvePromptPlaceholders(
                currentNode.data.negativePrompt || '',
                currentNode.data,
                klingCtx,
                klingPrOpts
            );
            const originalsKeling = getOriginals(idToRun);

            let firstFrameImage: string | undefined;
            let lastFrameImage: string | undefined;
            for (const entry of klingMediaPlan.images) {
                if (entry.refFrameIndex === 1 || entry.token === '@尾帧图' || entry.token === '@图片2') {
                    lastFrameImage = entry.url;
                } else if (
                    entry.refFrameIndex === 0 ||
                    entry.token === '@主图' ||
                    entry.token === '@主体' ||
                    entry.token === '@首帧图' ||
                    entry.token === '@图片1' ||
                    entry.token === '@图片'
                ) {
                    if (!firstFrameImage) firstFrameImage = entry.url;
                }
            }
            if (!firstFrameImage && klingMediaPlan.images.length > 0) {
                const first = klingMediaPlan.images[0];
                if (
                    first.refFrameIndex !== 1 &&
                    first.token !== '@尾帧图' &&
                    first.token !== '@图片2'
                ) {
                    firstFrameImage = first.url;
                }
            }
            if (!firstFrameImage) {
                throw new Error(
                    '可灵视频生成：请在创意描述中用 @主图、@首帧图 或 @图片1 至少引用一张首帧图片'
                );
            }
            if (originalsKeling.firstFrame) {
                try { firstFrameImage = await fileToDataUrlCached(originalsKeling.firstFrame); } catch (_) { /* 用节点内 */ }
            }
            if (originalsKeling.lastFrame && lastFrameImage) {
                try { lastFrameImage = await fileToDataUrlCached(originalsKeling.lastFrame); } catch (_) { /* 用节点内 */ }
            }

            firstFrameImage = await prepareLocalImageSrcCached(firstFrameImage);
            if (lastFrameImage) {
                lastFrameImage = await prepareLocalImageSrcCached(lastFrameImage);
            }

            // 上传图片，确保只使用 URL（不允许 base64）
            // 辅助函数：将 base64 转换为 blob 并上传
            const base64ToUrl = async (base64Str: string): Promise<string> => {
                const u = await uploadImage(base64Str);
                if (!u) throw new Error('Base64 图片上传失败');
                return u;
            };

            // 处理首帧图：确保转换为 URL
            let firstFrameUrl = firstFrameImage;
            
            // 如果是 base64，必须转换为 URL
            if (firstFrameUrl.startsWith('data:image/')) {
                firstFrameUrl = await base64ToUrl(firstFrameUrl);
            }
            // 如果是 blob URL，尝试上传获取 URL
            else if (firstFrameUrl.startsWith('blob:')) {
                const uploadedUrl = await uploadImageCached(firstFrameUrl);
                if (!uploadedUrl) {
                    throw new Error("首帧图上传失败");
                }
                firstFrameUrl = uploadedUrl;
            }
            // 如果已经是 AiTop URL，直接使用
            else if (firstFrameUrl.includes('aitop100app-1251510006')) {
                // 已经是 URL，直接使用
            }
            // 其他 URL（http/https），尝试上传到 AiTop
            else {
                const uploadedUrl = await uploadImageCached(firstFrameUrl);
                if (uploadedUrl) {
                    firstFrameUrl = uploadedUrl;
                }
                // 如果上传失败，使用原始 URL（假设是有效的 http/https URL）
            }

            // 处理尾帧图：确保转换为 URL（如果存在）
            let lastFrameUrl: string | undefined = undefined;
            if (lastFrameImage) {
                // 如果是 base64，必须转换为 URL
                if (lastFrameImage.startsWith('data:image/')) {
                    try {
                        lastFrameUrl = await base64ToUrl(lastFrameImage);
                    } catch (error) {
                        throw new Error("尾帧图上传失败");
                    }
                }
                // 如果是 blob URL，尝试上传获取 URL
                else if (lastFrameImage.startsWith('blob:')) {
                    const uploadedUrl = await uploadImageCached(lastFrameImage);
                    if (!uploadedUrl) {
                        throw new Error("尾帧图上传失败");
                    }
                    lastFrameUrl = uploadedUrl;
                }
                // 如果已经是 AiTop URL，直接使用
                else if (lastFrameImage.includes('aitop100app-1251510006')) {
                    lastFrameUrl = lastFrameImage;
                }
                // 其他 URL（http/https），尝试上传到 AiTop
                else {
                    const uploadedUrl = await uploadImageCached(lastFrameImage);
                    if (uploadedUrl) {
                        lastFrameUrl = uploadedUrl;
                    } else {
                        // 如果上传失败，使用原始 URL（假设是有效的 http/https URL）
                        lastFrameUrl = lastFrameImage;
                    }
                }
            }

            const normalizeImageKey = (url: string) =>
                url.split('#')[0].split('?')[0].replace(/\/+$/, '').toLowerCase();
            const rawRefImages = Array.isArray(currentNode.data.referenceImages)
                ? currentNode.data.referenceImages.filter(Boolean)
                : [];
            const normalizedReferenceImages = [firstFrameUrl, ...rawRefImages]
                .map((u) => {
                    const val = String(u);
                    // 主图/首帧若还是本地 data/blob，统一替换为本次上传后的首帧 URL
                    if (
                        val === currentNode.data.imagePreview ||
                        val === currentNode.data.firstFrameImage ||
                        val === currentNode.data.firstFrameImageUrl ||
                        /^data:image\//i.test(val) ||
                        val.startsWith('blob:')
                    ) {
                        return firstFrameUrl;
                    }
                    return val;
                })
                .filter((u, idx, arr) => {
                    const key = normalizeImageKey(u);
                    return arr.findIndex((x) => normalizeImageKey(x) === key) === idx;
                });

            firstLastFramePanelPatch = buildFirstLastFramePanelPatchFromPlan(
                klingMediaPlan.images,
                { startUrl: firstFrameUrl, endUrl: lastFrameUrl }
            );
            // 对齐 1229：生成前就把可用的首/尾帧上传 URL 回写到节点；未 @ 的帧从面板清空
            const klingUploadedByToken = new Map<string, string>();
            for (const entry of klingMediaPlan.images) {
                if (entry.refFrameIndex === 1 || entry.token === '@尾帧图' || entry.token === '@图片2') {
                    if (lastFrameUrl) klingUploadedByToken.set(entry.token, lastFrameUrl);
                } else {
                    klingUploadedByToken.set(entry.token, firstFrameUrl);
                }
            }
            const klingPreviewPatch = buildRunNodeImagePreviewPatch(
                klingMediaPlan.images,
                klingUploadedByToken,
                { startUrl: firstFrameUrl, endUrl: lastFrameUrl }
            );
            setNodes((nds) => nds.map((n) => {
                if (n.id !== currentNode.id) return n;
                return {
                    ...n,
                    data: {
                        ...n.data,
                        ...klingPreviewPatch,
                        referenceImages: normalizedReferenceImages,
                        ...firstLastFramePanelPatch,
                    },
                };
            }));
            logRefDebug('keling-before-task', {
                nodeId: currentNode.id,
                model: currentNode.data.selectedModel,
                imagePreviewBefore: currentNode.data.imagePreview,
                firstFrameUrl,
                lastFrameUrl: lastFrameUrl || null,
                referenceImagesBefore: currentNode.data.referenceImages || [],
                normalizedReferenceImages,
            });

            Object.assign(runCaptureForGp, {
                imagePreview:
                    firstLastFramePanelPatch?.firstFrameImageUrl ||
                    firstLastFramePanelPatch?.firstFrameImage ||
                    firstFrameUrl,
                referenceImages: normalizedReferenceImages,
                ...firstLastFramePanelPatch,
            });

            // 映射设置参数
            const quality = currentNode.data.quality || '高质量';
            const isKlingOmni = currentNode.data.selectedModel === '可灵3.0 Omni';
            // 如果有尾帧图，必须使用 'pro' 模式（根据 API 文档，只有 pro 模式支持首尾帧图）
            // 如果没有尾帧图，根据质量设置选择模式
            let mode: 'std' | 'pro';
            if (lastFrameImage) {
                // 有尾帧图时，强制使用 pro 模式
                mode = 'pro';
            } else {
                // 没有尾帧图时，根据质量设置选择模式
                mode = quality === '高质量' ? 'pro' : 'std';
            }
            
            const duration = currentNode.data.duration || '5s';
            const durationValue = duration.replace('s', '');
            const sound: 'off' | 'on' = isKlingOmni && (currentNode.data.klingAudioSync ?? false) ? 'on' : 'off';
            const klingModelName = isKlingOmni ? 'KLING_V3_0_OMNI' : 'KLING_V2_5_TURBO';
            
            // 将 creativityLevel (0-100) 映射到 cfgScale (0-1)
            const creativityLevel = currentNode.data.creativityLevel ?? 70;
            const cfgScale = Math.max(0, Math.min(1, creativityLevel / 100));

            const finalGenerateNum = resolvePanelGenerateCount(currentNode.data);

            const klingBasePayload = {
                prompt: prompt,
                negativePrompt: negativePrompt,
                image: firstFrameUrl,
                imageTail: lastFrameUrl,
                modelName: klingModelName,
                mode: mode,
                duration: durationValue,
                cfgScale: cfgScale,
                sound: sound,
                generateNum: 1,
            };

            // 保存首帧图和尾帧图的上传后的 URL 到当前节点数据中（用于在 detail 中显示；与槽位图一致避免主图/图片1误判）
            patchNodeDataById(currentNode.id, {
                firstFrameImageUrl: firstFrameUrl,
                firstFrameImage: firstFrameUrl,
                lastFrameImageUrl: lastFrameUrl || undefined,
                ...(lastFrameUrl ? { lastFrameImage: lastFrameUrl } : {}),
            });

            logModelRequest('可灵视频', { ...klingBasePayload, generateCount: finalGenerateNum });
            generatedImages = await runParallelGenerationTasks(
                finalGenerateNum,
                () => createKlingVideoTask(klingBasePayload),
                (tid) =>
                    pollVideoTaskUntilUrl(tid, {
                        failLabel: 'Kling Video',
                        onProgress: () => bumpRunningNodeProgress(1, 95),
                        stabilize: (url) =>
                            stabilizeVideoResourceUrl(url, { modelTag: '可灵', taskId: tid }),
                    }),
                (tid) => appendRunTaskId(tid)
            );
            } // 结束 else 块（真实 API 调用）
        }
        // --- vidu 2.0 图生视频（参考 vidu_video_test.py）---
        else if (model === 'vidu 2.0') {
            const viduCtx = buildRunPromptCtx(currentNode.data);
            const rawViduPrompt =
              getCanonicalInspectorPromptText(
                runStartDataSnapshot,
                projectAssetResolveOptsRef.current.projectAssets
              ) || '';
            const viduMediaPlan = collectReferencedMediaFromPrompt(
                rawViduPrompt,
                currentNode.data,
                viduCtx,
                projectAssetBySlugRef.current,
                projectAssetResolveOptsRef.current.projectAssets
            );
            const viduPrOpts = buildReferenceIndexOptionsFromPlan(
                viduMediaPlan,
                projectAssetResolveOptsRef.current
            );
            const prompt = resolvePromptPlaceholders(
                rawViduPrompt,
                currentNode.data,
                viduCtx,
                viduPrOpts
            );
            const originalsVidu = getOriginals(idToRun);
            let firstFrameImage: string | undefined;
            let lastFrameImage: string | undefined;
            for (const entry of viduMediaPlan.images) {
                if (entry.token === '@尾帧图' || entry.token === '@图片2') {
                    lastFrameImage = entry.url;
                } else if (
                    entry.token === '@主图' ||
                    entry.token === '@主体' ||
                    entry.token === '@首帧图' ||
                    entry.token === '@图片1' ||
                    entry.token === '@图片'
                ) {
                    if (!firstFrameImage) firstFrameImage = entry.url;
                }
            }
            if (!firstFrameImage && viduMediaPlan.images.length > 0) {
                const first = viduMediaPlan.images[0];
                if (first.token !== '@尾帧图' && first.token !== '@图片2') {
                    firstFrameImage = first.url;
                }
            }
            if (!firstFrameImage) {
                throw new Error(
                    'vidu 2.0：请在创意描述中用 @主图、@首帧图 或 @图片1 至少引用一张首帧图片'
                );
            }
            if (originalsVidu.firstFrame) {
                try { firstFrameImage = await fileToDataUrlCached(originalsVidu.firstFrame); } catch (_) { /* 用节点内 */ }
            }
            if (originalsVidu.lastFrame && lastFrameImage) {
                try { lastFrameImage = await fileToDataUrlCached(originalsVidu.lastFrame); } catch (_) { /* 用节点内 */ }
            }
            firstFrameImage = await prepareLocalImageSrcCached(firstFrameImage);
            if (lastFrameImage) {
                lastFrameImage = await prepareLocalImageSrcCached(lastFrameImage);
            }
            const base64ToUrl = async (base64Str: string): Promise<string> => {
                const u = await uploadImage(base64Str);
                if (!u) throw new Error('图片上传失败');
                return u;
            };
            let firstUrl = firstFrameImage;
            if (firstUrl.startsWith('data:image/')) {
                firstUrl = await base64ToUrl(firstUrl);
            } else if (firstUrl.startsWith('blob:')) {
                const u = await uploadImageCached(firstUrl);
                if (!u) throw new Error('首帧图上传失败');
                firstUrl = u;
            }
            let lastUrl: string | undefined = undefined;
            if (lastFrameImage) {
                lastUrl = lastFrameImage;
                if (lastUrl.startsWith('data:image/')) {
                    lastUrl = await base64ToUrl(lastUrl);
                } else if (lastUrl.startsWith('blob:')) {
                    const u = await uploadImageCached(lastUrl);
                    if (u) lastUrl = u;
                }
            }
            const imageUrls = lastUrl ? [firstUrl, lastUrl] : [firstUrl];
            firstLastFramePanelPatch = buildFirstLastFramePanelPatchFromPlan(viduMediaPlan.images, {
                startUrl: firstUrl,
                endUrl: lastUrl,
            });
            const viduUploadedByToken = new Map<string, string>();
            for (const entry of viduMediaPlan.images) {
                if (entry.token === '@尾帧图' || entry.token === '@图片2') {
                    if (lastUrl) viduUploadedByToken.set(entry.token, lastUrl);
                } else {
                    viduUploadedByToken.set(entry.token, firstUrl);
                }
            }
            const viduPreviewPatch = buildRunNodeImagePreviewPatch(
                viduMediaPlan.images,
                viduUploadedByToken,
                { startUrl: firstUrl, endUrl: lastUrl }
            );
            setNodes((nds) =>
                nds.map((n) =>
                    n.id === idToRun
                        ? {
                              ...n,
                              data: {
                                  ...n.data,
                                  ...firstLastFramePanelPatch,
                                  ...viduPreviewPatch,
                              },
                          }
                        : n
                )
            );
            Object.assign(runCaptureForGp, {
                ...firstLastFramePanelPatch,
                ...viduPreviewPatch,
                referenceImages: imageUrls,
            });
            const durationNum = (currentNode.data.viduDuration || '4s') === '8s' ? 8 : 4;
            const resolution = (currentNode.data.viduClarity || '1080p') as '360p' | '720p' | '1080p';
            const aspectRatio = currentNode.data.aspectRatio || '16:9';
            const movementMap: Record<string, 'auto' | 'small' | 'medium' | 'large'> = {
                '自动': 'auto',
                '小': 'small',
                '中': 'medium',
                '大': 'large',
            };
            const movementAmplitude = movementMap[currentNode.data.viduMotionRange || '自动'] || 'auto';
            const viduGenerateCount = resolvePanelGenerateCount(currentNode.data);
            const viduBasePayload = {
                prompt,
                images: imageUrls,
                duration: durationNum,
                resolution,
                aspectRatio,
                movementAmplitude,
                generateNum: 1,
                seed: 0,
            };
            logModelRequest('vidu 2.0', { ...viduBasePayload, generateCount: viduGenerateCount });
            generatedImages = await runParallelGenerationTasks(
                viduGenerateCount,
                () => createViduVideoTask(viduBasePayload as any),
                (tid) =>
                    pollVideoTaskUntilUrl(tid, {
                        failLabel: 'vidu 2.0',
                        intervalMs: 5000,
                        maxAttempts: 240,
                        onProgress: () => bumpRunningNodeProgress(1, 95),
                        stabilize: (url) =>
                            stabilizeVideoResourceUrl(url, { modelTag: 'vidu2.0', taskId: tid }),
                    }),
                (tid) => appendRunTaskId(tid)
            );
            if (!generatedImages.length) {
                throw new Error('vidu 2.0 视频生成超时');
            }
        }
        // --- seedance1.5-pro 图生视频（豆包 Seedance，参考 doubao_video_test.py）---
        else if (['seedance1.5-pro', 'seedance2.0 (高质量版)', 'seedance2.0 (急速版)'].includes(model)) {
            let prompt =
              getCanonicalInspectorPromptText(
                runStartDataSnapshot,
                projectAssetResolveOptsRef.current.projectAssets
              ) || '镜头缓缓推进，人物自然走动';
            const isSeedance20Model = ['seedance2.0 (高质量版)', 'seedance2.0 (急速版)'].includes(model);
            const gp = (currentNode.data.generationParams || {}) as GenerationParams;
            const seedanceMode: 'text' | 'image' | 'reference' =
              isSeedance20Model
                ? ((currentNode.data.seedanceGenerationMode || gp.seedanceGenerationMode || 'text') as 'text' | 'image' | 'reference')
                : 'image';
            if (isSeedance20Model) {
              Object.assign(runCaptureForGp, {
                seedanceGenerationMode: seedanceMode,
                seedanceReferenceRatioMode:
                  seedanceMode === 'reference'
                    ? ((currentNode.data.seedanceReferenceRatioMode ||
                        gp.seedanceReferenceRatioMode ||
                        'force') as 'force' | 'auto')
                    : currentNode.data.seedanceReferenceRatioMode,
              });
            }
            const seedanceReferenceRatioMode: 'force' | 'auto' =
              isSeedance20Model && seedanceMode === 'reference'
                ? ((currentNode.data.seedanceReferenceRatioMode ||
                    gp.seedanceReferenceRatioMode ||
                    'force') as 'force' | 'auto')
                : 'force';
            const shouldAutoMatchReferenceRatio =
              isSeedance20Model &&
              seedanceMode === 'reference' &&
              seedanceReferenceRatioMode === 'auto';
            const originalsSeedance = getOriginals(idToRun);
            if (isSeedance20Model) {
              logPreloadDebug({
                model,
                stage: 'seedance-run-start',
                seedanceMode,
                imagePreview: (currentNode.data.imagePreview || '').slice(0, 160),
                hasOriginalsMain: Boolean(originalsSeedance.main),
                referenceImagesCount: Array.isArray(currentNode.data.referenceImages)
                  ? currentNode.data.referenceImages.length
                  : 0,
                referenceMovsCount: Array.isArray(currentNode.data.referenceMovs)
                  ? currentNode.data.referenceMovs.length
                  : 0,
              });
            }
            const pickFrameLikeImage = (candidate?: string): string | undefined => {
                if (!candidate) return undefined;
                const v = String(candidate).trim();
                if (!v) return undefined;
                if (looksLikeVideoUrlForSeedanceRef(v)) return undefined;
                return v;
            };
            const toShortUrl = (u?: string): string | undefined => {
                if (!u) return undefined;
                return u.length > 140 ? `${u.slice(0, 140)}...` : u;
            };
            const classifySource = (u?: string): 'empty' | 'data' | 'blob' | 'http' | 'other' => {
                if (!u) return 'empty';
                if (u.startsWith('data:')) return 'data';
                if (u.startsWith('blob:')) return 'blob';
                if (/^https?:\/\//i.test(u)) return 'http';
                return 'other';
            };
            const imagePreviewIsVideo = looksLikeVideoUrlForSeedanceRef(currentNode.data.imagePreview || '');
            let firstFrameImage =
                pickFrameLikeImage(currentNode.data.firstFrameImage) ||
                pickFrameLikeImage(currentNode.data.firstFrameImageUrl) ||
                pickFrameLikeImage(gp.firstFrameImage) ||
                pickFrameLikeImage(gp.firstFrameImageUrl) ||
                (!imagePreviewIsVideo ? pickFrameLikeImage(currentNode.data.imagePreview) : undefined);
            let lastFrameImage =
                pickFrameLikeImage(currentNode.data.lastFrameImage) ||
                pickFrameLikeImage(currentNode.data.lastFrameImageUrl) ||
                pickFrameLikeImage(gp.lastFrameImage) ||
                pickFrameLikeImage(gp.lastFrameImageUrl);
            // 第二次运行：完成态 setNodes 只深合并了 generationParams，顶层尾帧槽位常被清空；
            // mergedRefImages 的 dedupe 还会把「首尾同一 COS URL」压成 referenceImages 一条，导致这里读不到第二帧。
            if (seedanceMode === 'image') {
                const refList = dedupeReferenceImageUrlsForSlotFallback(
                    [
                        ...(Array.isArray(currentNode.data.referenceImages) ? currentNode.data.referenceImages : []),
                        ...(Array.isArray(gp.referenceImages) ? gp.referenceImages : []),
                    ].filter((u): u is string => typeof u === 'string' && !!String(u).trim())
                );
                const refImagesLike = refList.map((u) => pickFrameLikeImage(u)).filter((x): x is string => Boolean(x));
                if (!firstFrameImage && refImagesLike[0]) firstFrameImage = refImagesLike[0];
                if (!lastFrameImage) {
                    if (refImagesLike.length >= 2) lastFrameImage = refImagesLike[1];
                    else {
                        const gl =
                            pickFrameLikeImage(gp.lastFrameImageUrl) ||
                            pickFrameLikeImage(currentNode.data.lastFrameImageUrl);
                        if (gl) lastFrameImage = gl;
                    }
                }
            }
            if (seedanceMode === 'reference') {
                // 参考生视频对齐 doubao_video_test.py：走 referenceVideos/referenceImages/referenceAudios，不走 start/endImage
                firstFrameImage = undefined;
                lastFrameImage = undefined;
            }
            if (seedanceMode === 'text') {
                // Seedance 2.0 文生视频：不强制 startImage（与 doubao_video_test.py 一致）
                firstFrameImage = undefined;
                lastFrameImage = undefined;
            }
            if (originalsSeedance.firstFrame) {
                try { firstFrameImage = await fileToDataUrlCached(originalsSeedance.firstFrame); } catch (_) { /* 用节点内 */ }
            }
            if (originalsSeedance.lastFrame && lastFrameImage) {
                try { lastFrameImage = await fileToDataUrlCached(originalsSeedance.lastFrame); } catch (_) { /* 用节点内 */ }
            }
            // 首帧槽位为空但主图有本地文件（常见于 @首帧图 + 主图 blob 预览）
            if (seedanceMode === 'image' && !firstFrameImage && originalsSeedance.main) {
                try {
                    firstFrameImage = await fileToDataUrlCached(originalsSeedance.main);
                } catch (_) {
                    /* 用节点内 URL */
                }
            }
            if (seedanceMode === 'image' && !lastFrameImage && originalsSeedance.lastFrame) {
                try {
                    lastFrameImage = await fileToDataUrlCached(originalsSeedance.lastFrame);
                } catch (_) {
                    /* 用节点内 URL */
                }
            }
            if (seedanceMode === 'image' && !firstFrameImage) {
                throw new Error(`${model} 图生视频需要首帧图，请先上传图片`);
            }
            const rawSeedanceAspect = currentNode.data.seedanceAspectRatio || gp.seedanceAspectRatio;
            const ratioSetting =
              isSeedance20Model
                ? rawSeedanceAspect === '自动匹配' || !rawSeedanceAspect
                  ? seedanceMode === 'image'
                    ? '自动匹配'
                    : normalizeSeedanceAspectForTextRef(undefined)
                  : normalizeSeedanceAspectForTextRef(rawSeedanceAspect)
                : rawSeedanceAspect || '自动匹配';
            const ratioFromPanel = ratioSetting === '自动匹配' ? null : ratioSetting;
            const ratioLabelForNorm =
              ratioFromPanel ??
              (seedanceMode === 'image' && firstFrameImage
                ? (await getImageAspectRatioFromSource(firstFrameImage))
                : '16:9');
            // 图生首尾帧：先按首帧（或面板固定）比例统一裁切，避免 16:9+4:3 混用被前置校验拦下
            if (firstFrameImage) {
              firstFrameImage = await prepareLocalImageSrcCached(firstFrameImage, {
                  seedanceRatioLabel: ratioLabelForNorm,
              });
            }
            if (lastFrameImage) {
              lastFrameImage = await prepareLocalImageSrcCached(lastFrameImage, {
                  seedanceRatioLabel: ratioLabelForNorm,
              });
            }
            if (seedanceMode === 'image' && firstFrameImage && lastFrameImage && ratioFromPanel) {
                const firstRatio = await getImageAspectRatioFromSource(firstFrameImage).catch(() => undefined);
                const lastRatio = await getImageAspectRatioFromSource(lastFrameImage).catch(() => undefined);
                if (firstRatio && lastRatio && firstRatio !== lastRatio) {
                    throw new Error(
                        `${model} 首尾帧比例不一致（首帧 ${firstRatio} / 尾帧 ${lastRatio}）。请使用同一比例素材，或在面板里固定为与素材一致的比例后重试。`
                    );
                }
            }
            /** 与本次请求实际入参一致，供 @图片n / @视频n 展开（含参考模式自动补槽后的 referenceImages/Movs） */
            let seedanceDataForPromptExpand: NodeData = { ...currentNode.data };
            if (firstFrameImage) seedanceDataForPromptExpand = { ...seedanceDataForPromptExpand, firstFrameImage };
            if (lastFrameImage) seedanceDataForPromptExpand = { ...seedanceDataForPromptExpand, lastFrameImage };
            const base64ToUrl = async (base64Str: string): Promise<string> => {
                const u = await uploadImage(base64Str);
                if (!u) throw new Error('图片上传失败');
                return u;
            };
            const detectVideoRatioFromUrl = async (videoUrl: string): Promise<'16:9' | '9:16' | undefined> => {
                if (!videoUrl) return undefined;
                const src = resolveUrlForVideoCapture(videoUrl);
                return new Promise((resolve) => {
                    const v = document.createElement('video');
                    v.preload = 'metadata';
                    v.muted = true;
                    v.playsInline = true;
                    let done = false;
                    const t = window.setTimeout(() => {
                        if (done) return;
                        done = true;
                        cleanup();
                        logPreloadDebug({ model: 'Seedance', event: 'timeout', url: videoUrl });
                        resolve(undefined);
                    }, 12000);
                    const cleanup = () => {
                        window.clearTimeout(t);
                        v.removeEventListener('loadedmetadata', onLoaded);
                        v.removeEventListener('error', onErr);
                        v.src = '';
                        v.load();
                        v.remove();
                    };
                    const onErr = () => {
                        if (done) return;
                        done = true;
                        cleanup();
                        logPreloadDebug({ model: 'Seedance', event: 'error', url: videoUrl });
                        resolve(undefined);
                    };
                    const onLoaded = () => {
                        if (done) return;
                        done = true;
                        const w = v.videoWidth || 0;
                        const h = v.videoHeight || 0;
                        cleanup();
                        const ratio = w > 0 && h > 0 ? (h >= w ? '9:16' : '16:9') : undefined;
                        logPreloadDebug({ model: 'Seedance', event: 'loadedmetadata', url: videoUrl, ratio });
                        if (ratio) resolve(ratio);
                        else resolve(undefined);
                    };
                    v.addEventListener('loadedmetadata', onLoaded);
                    v.addEventListener('error', onErr);
                    v.src = src;
                    v.load();
                });
            };
            let startUrl: string | undefined = undefined;
            let endUrl: string | undefined = undefined;
            let seedanceResolveOptsForRun: ResolvePromptPlaceholdersOptions =
              projectAssetResolveOptsRef.current;
            if (seedanceMode === 'image') {
              const imagePlan = collectReferencedMediaFromPrompt(
                getCanonicalInspectorPromptText(
                  runStartDataSnapshot,
                  projectAssetResolveOptsRef.current.projectAssets
                ) || '',
                currentNode.data,
                buildRunPromptCtx(currentNode.data),
                projectAssetBySlugRef.current,
                projectAssetResolveOptsRef.current.projectAssets
              );
              if (imagePlan.images.length === 0) {
                throw new Error(
                  `${model} 图生视频：请在创意描述中用 @主图、@首帧图、@图片1 等至少引用一张图片`
                );
              }
              seedanceImagePlanForPanel = imagePlan;
              seedanceResolveOptsForRun = buildReferenceIndexOptionsFromPlan(
                imagePlan,
                projectAssetResolveOptsRef.current
              );
              const seedanceImagePanelRefs = panelReferenceImagesForUpload(currentNode.data) || [];
              const imageUploadCtx: UploadReferencedImageContext = {
                originals: originalsSeedance,
                panelReferenceImages: seedanceImagePanelRefs,
                projectAssetSlugToUrl: projectAssetBySlugRef.current,
                projectAssets: projectAssetResolveOptsRef.current.projectAssets,
                fileToDataUrlCached,
                prepareLocalImageSrcCached,
                uploadImageCached,
                flowgenAssetFileUrlFromMediaUrl,
                isFlowgenAssetThumbUrl,
                base64ToUrl,
                seedanceRatioLabel: ratioLabelForNorm,
              };
              const uploadedByToken = new Map<string, string>();
              for (const entry of imagePlan.images) {
                logPreloadDebug({
                  model,
                  stage: 'seedance-image-upload',
                  token: entry.token,
                  imageIndex: entry.imageIndex,
                });
                uploadedByToken.set(entry.token, await uploadReferencedImageEntry(entry, imageUploadCtx));
              }
              seedanceImageUploadedByToken = uploadedByToken;
              ({ startUrl, endUrl } = assignStartEndUrlsFromImagePlan(imagePlan, uploadedByToken));
              if (!startUrl) {
                throw new Error(
                  `${model} 图生视频：请在创意描述中用 @首帧图、@图片1 或 @主图 指定首帧`
                );
              }
            }
            if (isSeedance20Model) {
              logPreloadDebug({
                model,
                stage: 'seedance-image-frames',
                seedanceMode,
                startUrl: startUrl ? startUrl.slice(0, 160) : undefined,
                endUrl: endUrl ? endUrl.slice(0, 160) : undefined,
              });
            }
            if (seedanceMode === 'image' && (startUrl || endUrl) && seedanceImagePlanForPanel) {
                seedanceImageRunSnapshot = { startUrl, endUrl };
                const framePersist = buildSeedanceImageModePanelPersistPatchFromPlan(
                    currentNode.data,
                    seedanceImagePlanForPanel.images,
                    { startUrl, endUrl }
                );
                firstLastFramePanelPatch = framePersist;
                const seedanceImagePreviewPatch =
                    seedanceImageUploadedByToken && seedanceImagePlanForPanel
                        ? buildRunNodeImagePreviewPatch(
                              seedanceImagePlanForPanel.images,
                              seedanceImageUploadedByToken,
                              { startUrl, endUrl }
                          )
                        : {};
                Object.assign(runCaptureForGp, framePersist, seedanceImagePreviewPatch);
                setNodes((nds) =>
                    nds.map((n) =>
                        n.id === idToRun
                            ? {
                                  ...n,
                                  data: {
                                      ...n.data,
                                      ...framePersist,
                                      ...seedanceImagePreviewPatch,
                                  },
                              }
                            : n
                    )
                );
            }
            const rawSeedanceRes = (
              currentNode.data.seedanceResolution || getSeedanceDefaultResolution(model)
            ).trim();
            const resolution: '480p' | '720p' | '1080p' =
              rawSeedanceRes === '1080p' || rawSeedanceRes === '720p' || rawSeedanceRes === '480p'
                ? (rawSeedanceRes as '480p' | '720p' | '1080p')
                : getSeedanceDefaultResolution(model);
            const seedanceApiResolution: '480p' | '720p' | '1080p' =
              resolution === '1080p' && model !== 'seedance2.0 (高质量版)' ? '720p' : resolution;
            const durationNum = parseSeedanceDurationSeconds(currentNode.data.seedanceDuration);
            let ratio = ratioLabelForNorm;
            const camerafixed = isSeedance20Model ? false : (currentNode.data.seedanceFixedCamera ?? false);
            const generateAudio = currentNode.data.seedanceGenerateAudio ?? false;
            let referenceAudiosPayload: string[] | undefined;
            let referenceVideosPayload: string[] | undefined;
            let referenceImagesPayload: string[] | undefined;
            let ratioOverrideByReferenceVideo: '16:9' | '9:16' | undefined;
            let seedancePreloadPlanImages:
              | ReturnType<typeof collectReferencedMediaFromPrompt>['images']
              | undefined;
            let seedancePreloadUploadedByToken: Map<string, string> | undefined;
            if (seedanceMode === 'reference' && isSeedance20Model) {
              const getVideoDurationSeconds = async (videoUrl: string): Promise<number | undefined> => {
                if (!videoUrl) return undefined;
                const src = resolveUrlForVideoCapture(videoUrl);
                return new Promise((resolve) => {
                  const v = document.createElement('video');
                  v.preload = 'metadata';
                  v.muted = true;
                  v.playsInline = true;
                  let done = false;
                  const t = window.setTimeout(() => {
                    if (done) return;
                    done = true;
                    cleanup();
                    logPreloadDebug({ model: 'Seedance2.0', event: 'timeout', url: videoUrl });
                    resolve(undefined);
                  }, 12000);
                  const cleanup = () => {
                    window.clearTimeout(t);
                    v.removeEventListener('loadedmetadata', onLoaded);
                    v.removeEventListener('error', onErr);
                    v.src = '';
                    v.load();
                    v.remove();
                  };
                  const onErr = () => {
                    if (done) return;
                    done = true;
                    cleanup();
                    logPreloadDebug({ model: 'Seedance2.0', event: 'error', url: videoUrl });
                    resolve(undefined);
                  };
                  const onLoaded = () => {
                    if (done) return;
                    done = true;
                    const d = Number(v.duration);
                    cleanup();
                    const durationSec = Number.isFinite(d) && d > 0 ? d : undefined;
                    logPreloadDebug({
                      model: 'Seedance2.0',
                      event: 'loadedmetadata',
                      url: videoUrl,
                      durationSec,
                    });
                    resolve(durationSec);
                  };
                  v.addEventListener('loadedmetadata', onLoaded);
                  v.addEventListener('error', onErr);
                  v.src = src;
                  v.load();
                });
              };

              const seedanceRefCtx = buildRunPromptCtx(currentNode.data);
              const seedanceRefPrompt = getCanonicalInspectorPromptText(
                runStartDataSnapshot,
                projectAssetResolveOptsRef.current.projectAssets
              );
              const mediaPlan = collectReferencedMediaFromPrompt(
                seedanceRefPrompt,
                currentNode.data,
                seedanceRefCtx,
                projectAssetBySlugRef.current,
                projectAssetResolveOptsRef.current.projectAssets
              );
              if (mediaPlan.images.length === 0 && mediaPlan.videos.length === 0) {
                const promptText = getCanonicalInspectorPromptText(
                  runStartDataSnapshot,
                  projectAssetResolveOptsRef.current.projectAssets
                ).trim();
                const hasSideMedia =
                  Boolean(String(currentNode.data.imagePreview || '').trim()) ||
                  (currentNode.data.referenceImages || []).some((u) =>
                    String(u || '').trim()
                  ) ||
                  (currentNode.data.referenceMovs || []).some((m) =>
                    String(m?.url || '').trim()
                  );
                if (!promptText) {
                  throw new Error(
                    `${model} 参考生视频：请先填写创意描述，并用 @主图、@图片1、@资产:名称 或 @视频1 引用要参与生成的素材。`
                  );
                }
                if (hasSideMedia) {
                  throw new Error(
                    `${model} 参考生视频：创意描述中未使用 @ 引用任何图片或视频。侧栏/参考区里的素材不会自动上传，请在文案中写入例如 @主图、@图片1、@资产:白泽 或 @视频1。`
                  );
                }
                throw new Error(
                  `${model} 参考生视频：请在创意描述中用 @主图、@图片1 或 @资产:名称 至少引用一张图片；引用视频请用 @视频1 或 @主视频。`
                );
              }
              logPreloadDebug({
                model,
                stage: 'seedance-prompt-refs',
                imageTokens: mediaPlan.images.map((e) => ({
                  token: e.token,
                  imageIndex: e.imageIndex,
                  label: e.label,
                })),
                videoTokens: mediaPlan.videos.map((e) => e.token),
                audioTokens: mediaPlan.audios.map((e) => e.token),
              });

              const panelRefsRaw = panelReferenceImagesForUpload(currentNode.data) || [];
              /** 仅 @主图：勿把节点上残留参考格带入上传/合并（避免运行后又出现「图片1」） */
              const panelRefsBeforeUpload =
                promptPlanReferencesMainImage(mediaPlan.images) &&
                !promptPlanReferencesPanelImages(mediaPlan.images)
                  ? []
                  : panelRefsRaw;
              const seedanceUploadCtx: UploadReferencedImageContext = {
                originals: originalsSeedance,
                panelReferenceImages: panelRefsBeforeUpload,
                projectAssetSlugToUrl: projectAssetBySlugRef.current,
                projectAssets: projectAssetResolveOptsRef.current.projectAssets,
                fileToDataUrlCached,
                prepareLocalImageSrcCached,
                uploadImageCached,
                flowgenAssetFileUrlFromMediaUrl,
                isFlowgenAssetThumbUrl,
                base64ToUrl,
                seedanceRatioLabel: ratioLabelForNorm,
              };
              let uploadedMainImageUrl: string | undefined;
              const uploadedByToken = new Map<string, string>();
              seedancePreloadUploadedByToken = uploadedByToken;
              const uploadedRefBySlot = new Map<number, string>();
              const uploadedImgs: string[] = [];
              const seedancePanelSlotOpts = {
                projectAssetSlugToUrl: projectAssetBySlugRef.current,
                referenceImageLabels: currentNode.data.referenceImageLabels,
                imagePreview: currentNode.data.imagePreview,
                panelMainSlotVisible: currentNode.data.panelMainSlotVisible,
              };
              const planImagesForPanel = enrichPlanImagesWithPanelSlotIndexes(
                panelRefsBeforeUpload,
                mediaPlan.images,
                seedancePanelSlotOpts
              );
              seedancePreloadPlanImages = planImagesForPanel;
              for (const entry of planImagesForPanel) {
                const resolveUploadSrc = resolveReferencedImageUploadSource(
                  entry,
                  seedanceUploadCtx
                );
                logPreloadDebug({
                  model,
                  stage: 'seedance-ref-upload',
                  token: entry.token,
                  imageIndex: entry.imageIndex,
                  refImageSlotIndex: entry.refImageSlotIndex,
                  planUrl: String(entry.url || '').slice(0, 160),
                  resolveUploadSrc: resolveUploadSrc.slice(0, 160),
                  slotUrl:
                    entry.refImageSlotIndex != null
                      ? String(
                          panelRefsBeforeUpload[entry.refImageSlotIndex] || ''
                        ).slice(0, 160)
                      : undefined,
                });
                const upUrl = await uploadReferencedImageEntry(entry, seedanceUploadCtx);
                uploadedByToken.set(entry.token, upUrl);
                uploadedImgs.push(upUrl);
                bumpRunningNodeProgress(1, 40);
                if (
                  entry.refImageSlotIndex != null &&
                  !MAIN_IMAGE_REF_TOKENS.has(entry.token)
                ) {
                  uploadedRefBySlot.set(entry.refImageSlotIndex, upUrl);
                }
              }
              assignSeedanceUploadedRefsToPanelSlotsByUrlMatch(
                panelRefsBeforeUpload,
                planImagesForPanel,
                uploadedByToken,
                uploadedRefBySlot,
                seedancePanelSlotOpts
              );
              const seedancePanelMergeOpts = panelMergeOptionsForReferencedUpload(
                planImagesForPanel,
                uploadedByToken,
                currentNode.data.imagePreview,
                projectAssetBySlugRef.current,
                currentNode.data.referenceImageLabels,
                currentNode.data.panelMainSlotVisible
              );
              const splitUploads = splitSeedanceUploadedReferenceImages(mediaPlan, uploadedImgs, currentNode.data, projectAssetResolveOptsRef.current.projectAssets);
              uploadedMainImageUrl = splitUploads.mainImageUrl;
              assertDistinctUploadedRefsForPlan(planImagesForPanel, uploadedByToken);
              const uploadedRefOnlyImages = buildReferenceOnlyImagesForApiPayload(
                planImagesForPanel,
                uploadedByToken
              );
              const referenceImagesForApi = buildSeedanceReferenceImagesApiPayload(
                planImagesForPanel,
                uploadedByToken
              );
              if (referenceImagesForApi.length > 0) {
                referenceImagesPayload = referenceImagesForApi;
              }
              const mergedPanelRefs = mergeAndPrunePanelReferenceImagesAfterUpload(
                panelRefsBeforeUpload,
                planImagesForPanel,
                uploadedByToken,
                seedancePanelMergeOpts
              );
              const mergedPanelLabels = resolveReferenceImageLabelsAfterPanelRun({
                panelBefore: panelRefsBeforeUpload,
                labelsBefore: currentNode.data.referenceImageLabels,
                panelAfter: mergedPanelRefs,
                plan: { ...mediaPlan, images: planImagesForPanel },
                projectAssets: projectAssetResolveOptsRef.current.projectAssets,
              });
              seedancePanelMergedRefs = mergedPanelRefs.length ? [...mergedPanelRefs] : null;
              seedancePanelMergedLabels = mergedPanelLabels.some((l) => l.trim())
                ? [...mergedPanelLabels]
                : null;
              const seedancePreviewPatch = buildPanelImagePreviewPatchAfterRun(
                mediaPlan.images,
                uploadedByToken,
                {
                  nodeData: currentNode.data,
                  mergedPanelRefs,
                  mergedPanelLabels,
                  projectAssets: projectAssetResolveOptsRef.current.projectAssets,
                }
              );
              await enrichPanelPreviewPatchWithFreshMainBackup(seedancePreviewPatch, currentNode.data);

              const uploadedMovs: string[] = [];
              for (const entry of mediaPlan.videos) {
                const u = await ensureAitopCosVideoUrl(entry.url, uploadVideoCached, {
                  label: `${model} 参考视频「${entry.label}」`,
                  filename: `seedance-ref-${entry.label.replace(/[^\w\u4e00-\u9fff-]+/g, '_')}.mp4`,
                });
                uploadedMovs.push(u);
                bumpRunningNodeProgress(2, 50);
              }
              if (uploadedMovs.length > 0) referenceVideosPayload = uploadedMovs;
              if (uploadedMovs.length > 0 && shouldAutoMatchReferenceRatio) {
                ratioOverrideByReferenceVideo = await detectVideoRatioFromUrl(uploadedMovs[0]);
                const refDurationSec = await getVideoDurationSeconds(uploadedMovs[0]);
                if (refDurationSec != null && (refDurationSec < 2 || refDurationSec > 15)) {
                  throw new Error(
                    `${model}：参考生视频要求时长 2-15 秒，当前约 ${refDurationSec.toFixed(2)} 秒，请更换素材或先剪辑。`
                  );
                }
              }

              const uploaded: string[] = [];
              for (const entry of mediaPlan.audios) {
                const u = await ensureAitopCosAudioUrl(entry.url, uploadAudio, {
                  label: `${model} 参考音频「${entry.label}」`,
                  filename: `seedance-ref-audio-${entry.label.replace(/[^\w\u4e00-\u9fff-]+/g, '_')}.mp3`,
                });
                uploaded.push(u);
              }
              if (uploaded.length > 0) referenceAudiosPayload = uploaded;

              const mergedPanelMovs = mergeSeedancePanelReferenceMovsAfterUpload(
                currentNode.data.referenceMovs,
                mediaPlan.videos,
                uploadedMovs
              );

              const refOnlySourceUrls = mediaPlan.images
                .filter((e) => e.token !== '@主图' && e.token !== '@主体')
                .map((e) => e.url);
              seedanceDataForPromptExpand = {
                ...seedanceDataForPromptExpand,
                ...seedancePreviewPatch,
                referenceImages: mergedPanelRefs.length ? mergedPanelRefs : refOnlySourceUrls,
                referenceImageLabels: mergedPanelLabels.length ? [...mergedPanelLabels] : undefined,
                referenceMovs: mergedPanelMovs.length
                  ? mergedPanelMovs
                  : mediaPlan.videos.map((e) => ({ url: e.url })),
                referenceAudios: mediaPlan.audios.map((e) => ({ url: e.url })),
              };
              seedanceResolveOptsForRun = buildReferenceIndexOptionsFromPlan(mediaPlan, {
                ...projectAssetResolveOptsRef.current,
                projectAssets: filterProjectAssetsForReferencedPlan(
                  projectAssetResolveOptsRef.current.projectAssets,
                  mediaPlan
                ).map((a) => ({ slug: a.slug, name: a.name, url: a.url || '' })),
              });
              // Node Details / API：仅用 plan 中 @ 到的非主图上传 URL，不含空槽误拖或未 @ 素材
              const seedanceApiRefImages =
                referenceImagesForApi.length > 0
                  ? [...referenceImagesForApi]
                  : uploadedRefOnlyImages.length > 0
                    ? [...uploadedRefOnlyImages]
                    : [...mergedPanelRefs].filter((u) => String(u || '').trim());
              const seedanceApiRefLabels = buildSeedanceReferenceApiLabelsFromPlan(
                planImagesForPanel,
                uploadedByToken
              );
              seedanceReferenceSnapshot = {
                referenceImages: seedanceApiRefImages,
                referenceImageLabels: seedanceApiRefLabels.length
                  ? seedanceApiRefLabels
                  : undefined,
                panelReferenceImages: [...mergedPanelRefs],
                panelReferenceImageLabels: mergedPanelLabels.some((l) => l.trim())
                  ? [...mergedPanelLabels]
                  : undefined,
                referenceMovs: mergedPanelMovs.length
                  ? mergedPanelMovs
                  : mediaPlan.videos.map((e, i) => ({
                      url: uploadedMovs[i] ?? e.url,
                    })),
                referenceAudios: mediaPlan.audios.map((e, i) => ({ url: uploaded[i] ?? e.url })),
              };
              const seedanceHideMainSlotForCompactRefs =
                seedanceApiRefImages.length > 0 &&
                (seedanceApiRefLabels.some((l) => l.trim() === '主图') ||
                  promptPlanReferencesMainImage(planImagesForPanel));
              stageRunPersistPatch({
                seedanceGenerationMode: 'reference',
                generationParams: {
                  seedanceGenerationMode: 'reference',
                  referenceImages: seedanceApiRefImages.length
                    ? [...seedanceApiRefImages]
                    : undefined,
                  referenceImageLabels: seedanceApiRefLabels.length
                    ? [...seedanceApiRefLabels]
                    : undefined,
                },
              });
              const hasRefVideos = uploadedMovs.length > 0;
              const shouldPatchNodePreview =
                currentNode.type === NodeType.INPUT || currentNode.type === NodeType.PROCESSOR;
              Object.assign(runCaptureForGp, {
                ...(shouldPatchNodePreview ? seedancePreviewPatch : {}),
                ...(seedanceHideMainSlotForCompactRefs
                  ? { panelMainSlotVisible: false as const }
                  : !shouldPatchNodePreview &&
                      seedancePreviewPatch.panelMainSlotVisible !== undefined
                    ? { panelMainSlotVisible: seedancePreviewPatch.panelMainSlotVisible }
                    : {}),
                // seedance 参考生视频：使用与 API/Node Details 一致的参考图和标签
                referenceImages: seedanceReferenceSnapshot?.referenceImages?.length
                  ? [...seedanceReferenceSnapshot.referenceImages]
                  : [...mergedPanelRefs],
                referenceImageLabels: seedanceReferenceSnapshot?.referenceImageLabels?.length
                  ? [...seedanceReferenceSnapshot.referenceImageLabels]
                  : [...mergedPanelLabels],
                referenceMovs: seedanceReferenceSnapshot.referenceMovs,
                referenceAudios: seedanceReferenceSnapshot.referenceAudios,
              });
              if (
                shouldPatchNodePreview ||
                mergedPanelRefs.length > 0 ||
                mergedPanelMovs.length > 0 ||
                promptPlanReferencesMainImage(planImagesForPanel) ||
                planImagesReferenceMainImageAsset(planImagesForPanel, currentNode.data, projectAssetResolveOptsRef.current.projectAssets)
              ) {
                const seedancePromptAtRun = getCanonicalInspectorPromptText(
                  runStartDataSnapshot,
                  projectAssetResolveOptsRef.current.projectAssets
                );
                setNodes((nds) =>
                  nds.map((n) => {
                    if (n.id !== idToRun) return n;
                    const promptSyncPatch = buildNodePromptUpdatePatch(
                      n.data,
                      seedancePromptAtRun
                    );
                    const tabs = {
                      ...(n.data.seedanceTabConfigs || {}),
                      ...(promptSyncPatch.seedanceTabConfigs || {}),
                    } as Record<string, unknown>;
                    const refTab = { ...((tabs.reference as object) || {}) } as Record<string, unknown>;
                    refTab.prompt = seedancePromptAtRun;
                    const effectivePanelRefs = [...mergedPanelRefs];
                    const effectivePanelLabels = [...mergedPanelLabels];
                    refTab.referenceImages = effectivePanelRefs;
                    refTab.referenceImageLabels = effectivePanelLabels;
                    refTab.referenceMovs = seedanceReferenceSnapshot!.referenceMovs;
                    refTab.referenceAudios = seedanceReferenceSnapshot!.referenceAudios;
                    tabs.reference = refTab;
                    return {
                      ...n,
                      data: {
                        ...n.data,
                        ...promptSyncPatch,
                        seedanceTabConfigs: tabs,
                        ...(shouldPatchNodePreview ? seedancePreviewPatch : {}),
                        ...(seedanceHideMainSlotForCompactRefs
                          ? { panelMainSlotVisible: false as const }
                          : {}),
                        referenceImages: [...mergedPanelRefs],
                        referenceImageLabels: [...mergedPanelLabels],
                        referenceMovs: seedanceReferenceSnapshot!.referenceMovs,
                        referenceAudios: seedanceReferenceSnapshot!.referenceAudios,
                      },
                    };
                  })
                );
              }
              logPreloadDebug({
                model,
                stage: 'seedance-ref-upload-done',
                uploadedMainImageUrl: uploadedMainImageUrl?.slice(0, 160),
                referenceImages: uploadedRefOnlyImages.map((u) => u.slice(0, 160)),
                referenceVideos: uploadedMovs.map((u) => u.slice(0, 160)),
                referenceAudios: uploaded.map((u) => u.slice(0, 160)),
                ratioOverrideByReferenceVideo,
              });
              // 仅在“自动匹配”时才从首张参考图推断比例；用户手选比例必须优先。
              if (
                shouldAutoMatchReferenceRatio &&
                referenceImagesPayload?.[0] &&
                !ratioOverrideByReferenceVideo &&
                !ratioFromPanel
              ) {
                try {
                  ratio = await getImageAspectRatioFromSource(referenceImagesPayload[0]);
                  logPreloadDebug({
                    model,
                    stage: 'seedance-ratio-from-ref',
                    ratio,
                  });
                } catch {
                  /* 保留面板比例 */
                }
              }
              Object.assign(runCaptureForGp, {
                seedanceAspectRatio: ratioOverrideByReferenceVideo || ratio,
              });
            }
            const seedCtxForPrompt = buildRunPromptCtx(seedanceDataForPromptExpand);
            const seedancePromptBeforeResolve = prompt;
            prompt = resolvePromptPlaceholders(
              prompt,
              seedanceDataForPromptExpand,
              seedCtxForPrompt,
              seedanceResolveOptsForRun
            );
            if (seedanceMode === 'reference' && isSeedance20Model && seedancePreloadPlanImages) {
              const indexByToken: Record<string, number> = {};
              for (const img of seedancePreloadPlanImages) {
                indexByToken[img.token] = img.imageIndex;
              }
              logPreloadDebug({
                model,
                stage: 'seedance-preload-summary',
                promptBeforeResolve: seedancePromptBeforeResolve,
                promptAfterResolve: prompt,
                imageIndexByToken: indexByToken,
                planImages: seedancePreloadPlanImages.map((e) => ({
                  token: e.token,
                  imageIndex: e.imageIndex,
                  label: e.label,
                  refImageSlotIndex: e.refImageSlotIndex,
                  planUrl: String(e.url || '').slice(0, 200),
                  uploadedUrl: String(
                    seedancePreloadUploadedByToken?.get(e.token) || ''
                  ).slice(0, 200),
                })),
                referenceImagesPayload: (referenceImagesPayload || []).map((u, i) => ({
                  index: i + 1,
                  url: String(u).slice(0, 200),
                })),
                chiwenInPrompt:
                  seedancePromptBeforeResolve.includes('@资产:鸱吻') ||
                  seedancePromptBeforeResolve.includes('鸱吻@资产'),
                chiwenExpanded: prompt.includes('鸱吻') && prompt.includes('referenceImages'),
              });
            }
            const seedanceModelId =
              model === 'seedance2.0 (急速版)'
                ? 'DOUBAO_SEEDANCE_2_0_FAST'
                : model === 'seedance2.0 (高质量版)'
                  ? 'DOUBAO_SEEDANCE_2_0'
                  : 'DOUBAO_SEEDANCE_1_5_PRO';

            const seedanceGenerateCount = resolvePanelGenerateCount(currentNode.data);
            const seedancePayload = {
                model: seedanceModelId,
                prompt,
                ...(startUrl ? { startImage: startUrl } : {}),
                ...(endUrl ? { endImage: endUrl } : {}),
                resolution: seedanceApiResolution,
                ratio: ratioOverrideByReferenceVideo || ratio,
                duration: durationNum,
                camerafixed,
                generateAudio,
                seed: -1,
                generateNum: 1,
                ...(referenceAudiosPayload ? { referenceAudios: referenceAudiosPayload } : {}),
                ...(referenceVideosPayload ? { referenceVideos: referenceVideosPayload } : {}),
                ...(referenceImagesPayload ? { referenceImages: referenceImagesPayload } : {}),
            };
            logModelRequest(model, { ...seedancePayload, generateCount: seedanceGenerateCount });
            const pollCfg =
              seedanceModelId === 'DOUBAO_SEEDANCE_2_0_FAST'
                ? { maxAttempts: 720, intervalMs: 5000 }
                : seedanceModelId === 'DOUBAO_SEEDANCE_2_0'
                  ? { maxAttempts: 3600, intervalMs: 10000 }
                  : { maxAttempts: 240, intervalMs: 5000 };
            const pollSeedanceTask = async (taskId: string): Promise<string> => {
                let attempts = 0;
                const maxConsecutiveStatusErrors =
                  seedanceModelId === 'DOUBAO_SEEDANCE_2_0' ? 18 : 10;
                let consecutiveStatusErrors = 0;
                while (attempts < pollCfg.maxAttempts) {
                    await new Promise((r) => setTimeout(r, pollCfg.intervalMs));
                    attempts++;
                    bumpRunningNodeProgress(1, 95);
                    let statusData: any = null;
                    try {
                        statusData = await getTaskStatus(taskId);
                        if (statusData) consecutiveStatusErrors = 0;
                    } catch {
                        consecutiveStatusErrors++;
                        if (consecutiveStatusErrors >= maxConsecutiveStatusErrors) {
                            throw new Error(
                              `${model} 任务状态查询连续失败（Task ID: ${taskId}）。请稍后重试，或将该 Task ID 提交给 AiTop 排查。`
                            );
                        }
                        continue;
                    }
                    if (!statusData) continue;
                    const status = statusData.status;
                    if (status === 'FAIL' || status === 'TRANSFER_FAIL') {
                        const msg = statusData.errorDescription || statusData.errorMsg || '视频生成失败';
                        throw new Error(`${model} 任务失败：${msg}`);
                    }
                    const resourceUrl = pickVideoResourceUrlFromTaskStatus(statusData);
                    if (status === 'TRANSFER_SUCCESS' && resourceUrl) {
                        return isAitopCosUrl(resourceUrl)
                            ? resourceUrl
                            : await stabilizeVideoResourceUrl(resourceUrl, {
                                  modelTag: model,
                                  taskId,
                              });
                    }
                    if (
                        (status === 'SUCCESS' || status === '2' || status === '5') &&
                        resourceUrl &&
                        isAitopCosUrl(resourceUrl)
                    ) {
                        return resourceUrl;
                    }
                }
                const waitMinutes = Math.floor((pollCfg.maxAttempts * pollCfg.intervalMs) / 60000);
                throw new Error(`${model} 视频生成超时（约 ${waitMinutes} 分钟）`);
            };
            generatedImages = await runParallelGenerationTasks(
                seedanceGenerateCount,
                (i) =>
                    createDoubaoSeedanceVideoTask({
                        ...(seedancePayload as any),
                        clientBatchIndex: i + 1,
                        clientBatchTotal: seedanceGenerateCount,
                    }),
                (tid) => pollSeedanceTask(tid),
                (tid) => appendRunTaskId(tid)
            );
            bumpRunningNodeProgress(5, 50);
            if (!generatedImages.length) {
                const waitMinutes = Math.floor((pollCfg.maxAttempts * pollCfg.intervalMs) / 60000);
                throw new Error(`${model} 视频生成超时（约等待 ${waitMinutes} 分钟）。可改用急速版，或稍后用 Task ID 向 AiTop 查询。`);
            }
        }
        // --- 即梦3.0 Pro 图生视频 ---
        else if (model === '即梦3.0 Pro') {
            const jimengCtx = buildRunPromptCtx(currentNode.data);
            const rawJimengPrompt =
              getCanonicalInspectorPromptText(
                runStartDataSnapshot,
                projectAssetResolveOptsRef.current.projectAssets
              ) || '镜头缓缓推进，人物自然走动';
            const jimengMediaPlan = collectReferencedMediaFromPrompt(
                rawJimengPrompt,
                currentNode.data,
                jimengCtx,
                projectAssetBySlugRef.current,
                projectAssetResolveOptsRef.current.projectAssets
            );
            const jimengPrOpts = buildReferenceIndexOptionsFromPlan(
                jimengMediaPlan,
                projectAssetResolveOptsRef.current
            );
            const prompt = resolvePromptPlaceholders(
                rawJimengPrompt,
                currentNode.data,
                jimengCtx,
                jimengPrOpts
            );
            const originalsJimeng = getOriginals(idToRun);
            const jimengEntry =
                jimengMediaPlan.images.find(
                    (e) =>
                        e.token === '@主图' ||
                        e.token === '@主体' ||
                        e.token === '@首帧图' ||
                        e.token === '@图片1' ||
                        e.token === '@图片'
                ) ?? jimengMediaPlan.images[0];
            if (!jimengEntry) {
                throw new Error(
                    '即梦图生视频：请在创意描述中用 @主图、@首帧图 或 @图片1 至少引用一张图片'
                );
            }
            logPreloadDebug({
                model: '即梦3.0 Pro',
                stage: 'jimeng-ref-upload',
                token: jimengEntry.token,
                imageIndex: jimengEntry.imageIndex,
            });
            const jimengPanelRefs = panelReferenceImagesForUpload(currentNode.data) || [];
            const jimengUploadCtx: UploadReferencedImageContext = {
                originals: originalsJimeng,
                panelReferenceImages: jimengPanelRefs,
                fileToDataUrlCached,
                prepareLocalImageSrcCached,
                uploadImageCached,
                flowgenAssetFileUrlFromMediaUrl,
                isFlowgenAssetThumbUrl,
            };
            const primaryUrl = await uploadReferencedImageEntry(jimengEntry, jimengUploadCtx);
            jimengFirstFrameUrlForUi = primaryUrl;
            jimengMergedImages = [primaryUrl];
            firstLastFramePanelPatch = buildFirstLastFramePanelPatchFromPlan(
                jimengMediaPlan.images,
                { startUrl: primaryUrl }
            );
            const jimengUploadedByToken = new Map<string, string>([
                [jimengEntry.token, primaryUrl],
            ]);
            const jimengPreviewPatch = buildRunNodeImagePreviewPatch(
                jimengMediaPlan.images,
                jimengUploadedByToken,
                { startUrl: primaryUrl }
            );
            Object.assign(runCaptureForGp, {
                ...firstLastFramePanelPatch,
                ...jimengPreviewPatch,
                referenceImages: [primaryUrl],
            });
            patchNodeDataById(idToRun, {
                ...firstLastFramePanelPatch,
                ...jimengPreviewPatch,
            });
            const imageUrls = [primaryUrl];
            const duration = currentNode.data.duration || '5s';
            const seconds = (duration === '10s' ? 10 : 5) as 5 | 10;
            const quality = (currentNode.data.jimengResolution === '720p' ? '720p' : '1080p') as '720p' | '1080p';

            const jimengGenerateCount = resolvePanelGenerateCount(currentNode.data);
            const jimengBasePayload = {
                imageUrls,
                prompt,
                quality,
                seconds,
                generateNum: 1,
                seed: -1,
            };
            logModelRequest('即梦3.0 Pro', { ...jimengBasePayload, generateCount: jimengGenerateCount });
            generatedImages = await runParallelGenerationTasks(
                jimengGenerateCount,
                () => createJimengVideoTask(jimengBasePayload),
                (tid) =>
                    pollVideoTaskUntilUrl(tid, {
                        failLabel: '即梦3.0 Pro',
                        intervalMs: 2000,
                        maxAttempts: 240,
                        onProgress: () => bumpRunningNodeProgress(1, 95),
                        stabilize: (url) =>
                            stabilizeVideoResourceUrl(url, { modelTag: '即梦3.0Pro', taskId: tid }),
                    }),
                (tid) => appendRunTaskId(tid)
            );
            if (!generatedImages.length) {
                throw new Error("即梦视频生成超时");
            }
        }
        // --- SIMULATION FOR OTHER MODELS ---
        else {
            for (let i = 1; i <= 10; i++) {
                await new Promise(resolve => setTimeout(resolve, 200)); 
          updateNodeDataById(idToRun, { progress: i * 10 });
            }
            generatedImages = ['https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?auto=format&fit=crop&q=80&w=600'];
        }

        // 3. Mark Complete
        pendingRunPersistPatchesRef.current.delete(idToRun);
        updateNodeDataById(idToRun, {
          status: 'completed',
          progress: 100,
          runRecoveryPending: undefined,
          runRecoveryProgress: undefined,
        });

        // 4. Generate New Nodes（链路类型以「本次运行开始时」的模型为准，避免异步期间用户切换模型导致错挂 MOV/锚点）
        const currentModel = runStartDataSnapshot.selectedModel || MODEL_NANO_BANANA_2;
        const isVideoModel = ['Veo 3.1', '可灵', 'Keling', '即梦', 'vidu', 'seedance'].some((m) =>
            currentModel.includes(m)
        );

        // 对视频生成链路，若当前是 INPUT/PROCESSOR 且上游存在视频节点，则以该上游视频节点作为关系锚点
        // 这样连线与 generated outputs 都会落在“实际视频链”上，而不是错误地挂在最早输入图节点。
        let anchorResolutionTrace = '';
        const resolveVideoAnchorNode = (): RFNode => {
            if (!isVideoModel || !(currentNode.type === NodeType.INPUT || currentNode.type === NodeType.PROCESSOR)) {
                anchorResolutionTrace = `skip: isVideoModel=${isVideoModel} runType=${currentNode.type} → 锚点=当前运行节点`;
                return currentNode;
            }
            const allNodes = getNodes();
            const allEdges = getEdges();
            const byId = new Map(allNodes.map((n) => [n.id, n]));
            const visited = new Set<string>();
            const directParents = allEdges
                .filter((e) => e.target === currentNode.id)
                .map((e) => e.source);

            // 优先使用“直接上游”且最近新增的一条边
            for (let i = directParents.length - 1; i >= 0; i--) {
                const p = byId.get(directParents[i]);
                if (p && (p.type === NodeType.MOV || p.type === NodeType.OUTPUT)) {
                    anchorResolutionTrace = `direct-parent[${i}] ${p.id} (${p.type})`;
                    return p;
                }
            }

            const queue: string[] = [...directParents];

            while (queue.length > 0) {
                const nid = queue.shift()!;
                if (visited.has(nid)) continue;
                visited.add(nid);
                const node = byId.get(nid);
                if (!node) continue;
                if (node.type === NodeType.MOV || node.type === NodeType.OUTPUT) {
                    anchorResolutionTrace = `bfs-upstream ${node.id} (${node.type})`;
                    return node;
                }
                const parents = allEdges.filter((e) => e.target === nid).map((e) => e.source);
                queue.push(...parents);
            }
            anchorResolutionTrace = 'no MOV/OUTPUT upstream found → 锚点=当前运行节点';
            return currentNode;
        };

        const relationAnchorNode = resolveVideoAnchorNode();
        /** 与 Input Picture（INPUT/PROCESSOR）一致：视频链上连线源与缩略图父节点由锚点决定；MOV/OUTPUT 运行则始终用当前运行节点 */
        const isInputLikeNode =
            currentNode.type === NodeType.INPUT || currentNode.type === NodeType.PROCESSOR;
        const linkSourceNodeId = isVideoModel && isInputLikeNode ? relationAnchorNode.id : idToRun;
        const baseX = relationAnchorNode.position.x + 350;
        const baseY = relationAnchorNode.position.y;
        // 避免与该锚点历史输出节点重叠，导致“看起来连错到旧节点”
        const existingOutgoingCount = getEdges().filter((e) => e.source === relationAnchorNode.id).length;
        
        const newNodes: RFNode[] = [];
        const newEdges: Edge[] = [];
        /**
         * 构建 generationParams 用的节点视图：
         * - 固定使用 runStartDataSnapshot + runCaptureForGp，避免异步期间切 tab/改提示词/并发运行污染本次快照
         * - runCaptureForGp 只补本次实际上传后的 URL/引用素材，确保记录与请求一致
         */
        const liveSnap = getNodes().find((n) => n.id === idToRun) || currentNode;
        const gpData: NodeData = ({ ...runStartDataSnapshot, ...runCaptureForGp }) as NodeData;
        const mediaPatch: Record<string, unknown> = {};
        const patchableKeys = [
            'imagePreview',
            'panelMainSlotVisible',
            'panelMainImageUrl',
            'referenceImages',
            'referenceImageLabels',
            'referenceMovs',
            'referenceAudios',
            'modelConfigs',
            'firstFrameImage',
            'firstFrameImageUrl',
            'lastFrameImage',
            'lastFrameImageUrl',
            'klingOmniInstructionReferenceImages',
            'klingOmniVideoReferenceImages',
            'klingOmniMultiReferenceImages',
            'klingOmniInstructionVideoUrl',
            'klingOmniVideoUrl',
            'jimengImages',
        ];
        /** 面板保留全部拖入槽：勿用 runCaptureForGp 的 gp-only referenceImages/Labels 覆盖（Banana/image2/Seedance/Omni） */
        const skipPanelRefMediaPatchFromRunCapture =
          nanoPanelMergedRefs !== null ||
          image2PanelMergedRefs !== null ||
          seedancePanelMergedRefs !== null ||
          omniMultiMergedRefs !== null ||
          omniTabMergedRefs !== null;
        const skipOmniPanelRefMediaPatchFromRunCapture =
          omniMultiMergedRefs !== null || omniTabMergedRefs !== null;
        patchableKeys.forEach((key) => {
            if (
              skipPanelRefMediaPatchFromRunCapture &&
              (key === 'referenceImages' || key === 'referenceImageLabels')
            ) {
              return;
            }
            if (
              skipOmniPanelRefMediaPatchFromRunCapture &&
              (key === 'klingOmniMultiReferenceImages' ||
                key === 'klingOmniInstructionReferenceImages' ||
                key === 'klingOmniVideoReferenceImages')
            ) {
              return;
            }
            if (Object.prototype.hasOwnProperty.call(runCaptureForGp, key)) {
                mediaPatch[key] = (runCaptureForGp as Record<string, unknown>)[key];
            }
        });
        if (Object.keys(mediaPatch).length > 0) {
            setNodes((nds) =>
                nds.map((n) =>
                    n.id === idToRun
                        ? {
                              ...n,
                              data: {
                                  ...n.data,
                                  ...mediaPatch,
                              },
                          }
                        : n
                )
            );
        }
        const snapForGp: RFNode = { ...liveSnap, data: gpData };
        /** 可灵/vidu/即梦等：无 Seedance startUrl 时，用「本次入参首帧/尾帧图」作小缩略图 poster，避免 generated outputs 在截帧完成前长期灰块 */
        const stillImagePosterCandidate = (u?: string): string | undefined => {
            if (!u || typeof u !== 'string') return undefined;
            if (/\.(mov|mp4|webm|avi|mkv|flv|wmv|m4v)(\?|$)/i.test(u)) return undefined;
            if (/^data:video\//i.test(u)) return undefined;
            return u;
        };
        const gpSnap = snapForGp.data.generationParams as GenerationParams | undefined;
        const firstFramePosterFallback = stillImagePosterCandidate(
            snapForGp.data.firstFrameImageUrl || snapForGp.data.firstFrameImage || gpSnap?.firstFrameImageUrl || gpSnap?.firstFrameImage
        );
        const lastFramePosterFallback = stillImagePosterCandidate(
            snapForGp.data.lastFrameImageUrl || snapForGp.data.lastFrameImage || gpSnap?.lastFrameImageUrl || gpSnap?.lastFrameImage
        );
        // 非「本次新生成 MOV」时：可用参考图首张作静图兜底（刷新后、无结果 URL 等）
        const refImagePosterFallback = (() => {
            const refs = [
                ...(Array.isArray(snapForGp.data.referenceImages) ? snapForGp.data.referenceImages : []),
                ...(Array.isArray(gpSnap?.referenceImages) ? gpSnap.referenceImages : []),
            ];
            for (const r of refs) {
                const s = stillImagePosterCandidate(r);
                if (s) return s;
            }
            return undefined;
        })();
        const refMovPosterFallback =
            snapForGp.data.referenceMovs?.find((m) => m?.posterDataUrl)?.posterDataUrl ||
            ((snapForGp.data.generationParams as any)?.referenceMovs as Array<
                { url: string; posterDataUrl?: string } | undefined
            > | undefined)?.find((m) => m?.posterDataUrl)?.posterDataUrl;
        /** 本次运行会新建 MOV：优先用生成结果视频截帧；若截帧失败，允许回退静图避免节点长期黑屏 */
        const posterShouldComeFromGeneratedVideo = isVideoModel && generatedImages.length > 0;
        const pickFirstPoster = (...candidates: (string | undefined)[]): string | undefined => {
            for (const c of candidates) {
                if (c) return c;
            }
            return undefined;
        };
        const outputNodeFallbackPoster = pickFirstPoster(
            seedanceImageRunSnapshot?.startUrl,
            snapForGp.data.videoPosterDataUrl,
            refMovPosterFallback,
            firstFramePosterFallback,
            lastFramePosterFallback,
            refImagePosterFallback
        );
        const seedVideoPoster = posterShouldComeFromGeneratedVideo
            ? undefined
            : outputNodeFallbackPoster;
        const outputNodeInitialPoster = seedVideoPoster || outputNodeFallbackPoster;

        // Create a static snapshot of parameters actually used for this run (按模型区分，避免存错字段)
        const currentModelName = snapForGp.data.selectedModel || MODEL_NANO_BANANA_2;
        // 合并所有“输入图”供 Node Details 展示：主图、即梦多图、可灵首尾帧、参考图，避免输出节点详情里看不到拖入的图
        const dedupe = (arr: string[]) => {
            const seen = new Set<string>();
            return arr.filter((s) => s && !seen.has(s) && (seen.add(s), true));
        };
        const isLikelyImageUrl = (url?: string): boolean => {
            if (!url) return false;
            if (/^data:image\//i.test(url)) return true;
            if (/\.(png|jpe?g|webp|gif|bmp|svg)(\?|$)/i.test(url)) return true;
            if (isFlowgenProtectedAssetFileUrl(url) || isFlowgenAssetThumbUrl(url)) return true;
            return false;
        };
        const isVideoUrlForRefs = (url?: string): boolean => {
            if (!url) return false;
            if (isLikelyImageUrl(url)) return false;
            if (/^data:video\//i.test(url)) return true;
            return (
                /\.(mov|mp4|webm|avi|mkv|flv|wmv|m4v)(\?|$)/i.test(url) ||
                (/video/i.test(url) &&
                    !isFlowgenProtectedAssetFileUrl(url) &&
                    !isFlowgenAssetThumbUrl(url))
            );
        };
        const isStillImageGenModel =
            isImage2Model(currentModelName) || isNanoBanana2Model(currentModelName);

        const inputImages: string[] = [];
        const posterImages: string[] = [];
        const referenceMovs: { url: string; posterDataUrl?: string }[] = [];
        const knownVideoUrlSet = new Set<string>();
        const pushReferenceMov = (url?: string, posterDataUrl?: string, forceVideo = false) => {
            if (!url) return;
            const treatAsVideo = forceVideo || isVideoUrlForRefs(url) || (snapForGp.type === NodeType.MOV && !isLikelyImageUrl(url));
            if (!treatAsVideo) return;
            knownVideoUrlSet.add(url);
            const idx = referenceMovs.findIndex((m) => m.url === url);
            if (idx >= 0) {
                if (!referenceMovs[idx].posterDataUrl && posterDataUrl) {
                    referenceMovs[idx] = { ...referenceMovs[idx], posterDataUrl };
                }
                return;
            }
            referenceMovs.push({ url, ...(posterDataUrl ? { posterDataUrl } : {}) });
        };
        // 对视频节点：imagePreview 通常是 video URL，不应作为 referenceImages 展示；
        // 但其 poster 可作为 referenceImages 的“最后一项”（避免 ref-0 变成黑块/占位图）
        if (snapForGp.data.imagePreview) {
            if (
                !isNanoBanana2Model(currentModelName) &&
                !isImage2Model(currentModelName) &&
                !isVideoUrlForRefs(snapForGp.data.imagePreview) &&
                !(snapForGp.type === NodeType.MOV && !isLikelyImageUrl(snapForGp.data.imagePreview))
            ) {
                inputImages.push(snapForGp.data.imagePreview);
            } else if (snapForGp.data.videoPosterDataUrl) {
                posterImages.push(snapForGp.data.videoPosterDataUrl);
            }
        }
        // 单视频优先策略：Reference Videos 仅表示“参考输入视频”
        // - 优先使用属性面板里的 Omni 参考视频字段
        // - 仅 INPUT/PROCESSOR 节点允许退化为 imagePreview（它代表用户输入）
        // - MOV/OUTPUT 的 imagePreview 是生成结果，不应进入 Reference Videos
        const omniKtForRef = snapForGp.data.klingOmniTab || 'multi';
        const omniSlotVideoForRef =
            omniKtForRef === 'instruction'
                ? snapForGp.data.klingOmniInstructionVideoUrl ||
                  snapForGp.data.klingOmniInstructionVideoPreviewUrl
                : omniKtForRef === 'video'
                  ? snapForGp.data.klingOmniVideoUrl || snapForGp.data.klingOmniVideoPreviewUrl
                  : snapForGp.data.klingOmniVideoUrl || snapForGp.data.klingOmniVideoPreviewUrl;
        const primaryVideoRef =
            omniSlotVideoForRef ||
            (!isStillImageGenModel &&
            isInputLikeNode &&
            snapForGp.data.imagePreview &&
            isVideoUrlForRefs(snapForGp.data.imagePreview)
              ? snapForGp.data.imagePreview
              : undefined);
        pushReferenceMov(
            primaryVideoRef,
            pickReferenceMovPoster(
                primaryVideoRef || '',
                refMovPosterFallback,
                snapForGp.data.referenceMovs?.find(
                    (m) => m?.url && primaryVideoRef && m.url === primaryVideoRef
                )?.posterDataUrl,
                snapForGp.data.videoPosterDataUrl
            ),
            true
        );
        // 关键补全：把节点上已有的 referenceMovs 一并继承到本次 generationParams
        const existingRefMovs =
            ((snapForGp.data as any).referenceMovs as Array<{ url: string; posterDataUrl?: string }> | undefined) || [];
        for (const mov of existingRefMovs) {
            if (!mov?.url) continue;
            pushReferenceMov(mov.url, mov.posterDataUrl, true);
        }
        const existingGpRefMovs =
            ((snapForGp.data.generationParams as any)?.referenceMovs as Array<{ url: string; posterDataUrl?: string }> | undefined) || [];
        for (const mov of existingGpRefMovs) {
            if (!mov?.url) continue;
            pushReferenceMov(mov.url, mov.posterDataUrl, true);
        }
        if (snapForGp.data.jimengImages?.length) inputImages.push(...snapForGp.data.jimengImages);
        const skipFrameSlotsInRefImages = hasReferenceInputVideos(referenceMovs.length);
        if (currentModelName.includes('即梦') && !skipFrameSlotsInRefImages) {
            const jf = snapForGp.data.firstFrameImageUrl || snapForGp.data.firstFrameImage;
            if (jf) inputImages.push(jf);
        }
        if (
            !skipFrameSlotsInRefImages &&
            (currentModelName.includes('可灵') ||
            currentModelName === 'vidu 2.0' ||
            ['seedance1.5-pro', 'seedance2.0 (高质量版)', 'seedance2.0 (急速版)'].includes(currentModelName))
        ) {
            const f = snapForGp.data.firstFrameImageUrl || snapForGp.data.firstFrameImage;
            const l = snapForGp.data.lastFrameImageUrl || snapForGp.data.lastFrameImage;
            if (f) inputImages.push(f);
            if (l) inputImages.push(l);
        }
        const baseRefs =
            currentModelName === '可灵3.0 Omni'
                ? (
                    snapForGp.data.klingOmniTab === 'instruction'
                        ? (snapForGp.data.klingOmniInstructionReferenceImages ?? snapForGp.data.referenceImages ?? [])
                        : snapForGp.data.klingOmniTab === 'video'
                            ? (snapForGp.data.klingOmniVideoReferenceImages ?? snapForGp.data.referenceImages ?? [])
                            : snapForGp.data.klingOmniTab === 'multi'
                                ? (snapForGp.data.klingOmniMultiReferenceImages ?? snapForGp.data.referenceImages ?? [])
                                : (snapForGp.data.referenceImages ?? [])
                )
                : (snapForGp.data.referenceImages || []);
        // 兼容历史数据：如果 referenceImages 里误混入了视频 URL，把它们迁移到 referenceMovs
        baseRefs.forEach((u) => {
            if (isVideoUrlForRefs(u) || knownVideoUrlSet.has(u) || (snapForGp.type === NodeType.MOV && !isLikelyImageUrl(u))) {
                pushReferenceMov(u, snapForGp.data.videoPosterDataUrl, true);
            }
        });
        // referenceImages 只保留图片类 URL（避免 Node Details 里把 video URL 当参考图导致显示为 0）
        // 规则：只要存在 referenceMovs，视频 poster 不再混入 referenceImages（避免 ref-0 黑图）
        const mergedRefImages = dedupe([
            ...inputImages,
            ...baseRefs,
            ...(referenceMovs.length > 0 ? [] : posterImages),
        ]).filter((u) => !isVideoUrlForRefs(u) && !knownVideoUrlSet.has(u));
        const generatedAtIso = new Date().toISOString();
        // 从 runCaptureForGp 获取运行期间设置的标签（如果可用）
        const runCaptureLabels = (runCaptureForGp as { referenceImageLabels?: string[] }).referenceImageLabels;
        const generationParams: GenerationParams = {
            generatedAt: generatedAtIso,
            taskId: runTaskIds.length ? runTaskIds.join(', ') : undefined,
            prompt: getCanonicalInspectorPromptText(
              snapForGp.data,
              projectAssetResolveOptsRef.current.projectAssets
            ),
            negativePrompt: snapForGp.data.negativePrompt,
            numberOfImages: snapForGp.data.numberOfImages || "1张",
            referenceImages: mergedRefImages.length ? mergedRefImages : undefined,
            referenceMovs: referenceMovs.length ? referenceMovs : undefined,
            referenceAudios: snapForGp.data.referenceAudios?.length ? snapForGp.data.referenceAudios : undefined,
            model: currentModelName,
            creativityLevel: snapForGp.data.creativityLevel,
            // 优先使用 runCaptureForGp 中的标签（运行期间上传后的正确标签）
            referenceImageLabels: runCaptureLabels?.length ? [...runCaptureLabels] : undefined,
        };
        if (isNanoBanana2Model(currentModelName)) {
            const mainPrev = snapForGp.data.imagePreview;
            if (nanoRunReferenceSnapshot?.length) {
                generationParams.referenceImages = dedupe(nanoRunReferenceSnapshot);
            } else {
                const stripped = (generationParams.referenceImages || []).filter(
                    (u) => !isDuplicateOfMainImagePreview(u, mainPrev)
                );
                generationParams.referenceImages = stripped.length ? stripped : undefined;
            }
            generationParams.referenceMovs = undefined;
            generationParams.referenceAudios = undefined;
            const nanoRunLabels = (runCaptureForGp as { referenceImageLabels?: string[] }).referenceImageLabels;
            const apiRefCount = generationParams.referenceImages?.length ?? 0;
            const nanoPrompt = String(
                snapForGp.data.prompt ?? generationParams.prompt ?? ''
            ).trim();
            const inferredNanoLabels = inferSeedanceReferenceDetailLabelsFromPrompt(
                nanoPrompt,
                apiRefCount,
                projectAssetLabelRows
            );
            if (inferredNanoLabels.length === apiRefCount && apiRefCount > 0) {
                generationParams.referenceImageLabels = inferredNanoLabels;
            } else if (nanoRunLabels?.some((l) => String(l || '').trim())) {
                generationParams.referenceImageLabels = [...nanoRunLabels].slice(0, apiRefCount);
            }
        }
        if (seedanceReferenceSnapshot) {
            generationParams.referenceImages = seedanceReferenceSnapshot.referenceImages.length
              ? seedanceReferenceSnapshot.referenceImages
              : undefined;
            generationParams.referenceImageLabels = seedanceReferenceSnapshot.referenceImageLabels?.length
              ? [...seedanceReferenceSnapshot.referenceImageLabels]
              : undefined;
            generationParams.referenceMovs = seedanceReferenceSnapshot.referenceMovs.length
              ? seedanceReferenceSnapshot.referenceMovs
              : undefined;
            generationParams.referenceAudios = seedanceReferenceSnapshot.referenceAudios.length
              ? seedanceReferenceSnapshot.referenceAudios
              : undefined;
        }
        if (
            klingOmniReferenceSnapshot &&
            currentModelName === '可灵3.0 Omni' &&
            ((snapForGp.data.klingOmniTab || 'multi') === 'instruction' ||
                (snapForGp.data.klingOmniTab || 'multi') === 'video')
        ) {
            generationParams.referenceImages = klingOmniReferenceSnapshot.referenceImages.length
              ? klingOmniReferenceSnapshot.referenceImages
              : undefined;
            generationParams.referenceMovs = klingOmniReferenceSnapshot.referenceMovs.length
              ? klingOmniReferenceSnapshot.referenceMovs
              : undefined;
        }
        if (
            currentModelName === '可灵3.0 Omni' &&
            (snapForGp.data.klingOmniTab || 'multi') === 'multi' &&
            omniMultiApiRefSnapshot?.length
        ) {
            generationParams.referenceImages = sanitizeDetailsReferenceImageUrls([
                ...omniMultiApiRefSnapshot,
            ]);
            const dedupedRefCount = generationParams.referenceImages?.length ?? 0;
            if (
                omniMediaPlanForGp &&
                omniMultiUploadedByTokenForGp &&
                dedupedRefCount > 0
            ) {
                const apiLabels = buildOmniMultiGenerationParamsLabels(
                    generationParams.referenceImages || [],
                    omniMediaPlanForGp.images,
                    omniMultiUploadedByTokenForGp,
                    omniMultiFirstFrameUrlForGp
                );
                if (apiLabels.length === dedupedRefCount) {
                    generationParams.referenceImageLabels = apiLabels;
                }
            }
        }

        if (currentModelName === '可灵3.0 Omni') {
            const kt = snapForGp.data.klingOmniTab || 'multi';
            const d = snapForGp.data;
            generationParams.prompt =
                kt === 'multi'
                    ? (d.klingOmniMultiPrompt ?? d.prompt ?? '')
                    : kt === 'instruction'
                      ? (d.klingOmniInstructionPrompt ?? d.prompt ?? '')
                      : kt === 'video'
                        ? (d.klingOmniVideoPrompt ?? d.prompt ?? '')
                        : (d.klingOmniFramesPrompt ?? d.prompt ?? '');
            generationParams.negativePrompt =
                kt === 'multi'
                    ? (d.klingOmniMultiNegativePrompt ?? d.negativePrompt ?? '')
                    : kt === 'instruction'
                      ? (d.klingOmniInstructionNegativePrompt ?? d.negativePrompt ?? '')
                      : kt === 'video'
                        ? (d.klingOmniVideoNegativePrompt ?? d.negativePrompt ?? '')
                        : (d.klingOmniFramesNegativePrompt ?? d.negativePrompt ?? '');
        }
        // 显式保留 Omni 两路视频槽（指令变换 / 视频参考），避免 Node Details 与运行侧推断不一致
        {
            const snap = snapForGp.data;
            if (snap.klingOmniInstructionVideoUrl || snap.klingOmniInstructionVideoPreviewUrl) {
                (generationParams as any).klingOmniInstructionVideoUrl =
                    snap.klingOmniInstructionVideoUrl || snap.klingOmniInstructionVideoPreviewUrl;
                if (snap.klingOmniInstructionVideoPreviewUrl) {
                    (generationParams as any).klingOmniInstructionVideoPreviewUrl =
                        snap.klingOmniInstructionVideoPreviewUrl;
                }
            }
            if (snap.klingOmniVideoUrl || snap.klingOmniVideoPreviewUrl) {
                (generationParams as any).klingOmniVideoUrl = snap.klingOmniVideoUrl || snap.klingOmniVideoPreviewUrl;
                if (snap.klingOmniVideoPreviewUrl) {
                    (generationParams as any).klingOmniVideoPreviewUrl = snap.klingOmniVideoPreviewUrl;
                }
            }
        }
        if (currentModelName.includes('即梦')) {
            generationParams.duration = snapForGp.data.duration || '5s';
            generationParams.jimengResolution = snapForGp.data.jimengResolution || '1080p';
            generationParams.jimengVideoRatio = snapForGp.data.jimengVideoRatio || '自动匹配';
            generationParams.jimengGenerationMode = snapForGp.data.jimengGenerationMode || 'image';
            generationParams.quality = snapForGp.data.jimengResolution === '720p' ? '720p' : '1080p';
            const fallbackPreviewImage =
                snapForGp.data.imagePreview && !isVideoUrlForRefs(snapForGp.data.imagePreview)
                    ? snapForGp.data.imagePreview
                    : undefined;
            generationParams.firstFrameImage =
                snapForGp.data.firstFrameImage ||
                snapForGp.data.firstFrameImageUrl ||
                fallbackPreviewImage;
            generationParams.firstFrameImageUrl =
                jimengFirstFrameUrlForUi ||
                snapForGp.data.firstFrameImageUrl ||
                (fallbackPreviewImage && /^https?:\/\//i.test(fallbackPreviewImage) ? fallbackPreviewImage : undefined);
            generationParams.jimengImages = jimengMergedImages?.length
              ? [...jimengMergedImages]
              : snapForGp.data.jimengImages
                ? [...snapForGp.data.jimengImages]
                : [];
        } else if (currentModelName.includes('可灵') || currentModelName.includes('Keling')) {
            generationParams.quality = snapForGp.data.quality || '高质量';
            generationParams.duration = snapForGp.data.duration || '5s';
            generationParams.aspectRatio = snapForGp.data.aspectRatio || '1:1';
            generationParams.klingAudioSync = snapForGp.data.klingAudioSync;
            // 写入首尾帧到 generationParams，使 output 节点与 generated outputs 的 Node Details 与 input 一致
            generationParams.firstFrameImage = snapForGp.data.firstFrameImage;
            generationParams.lastFrameImage = snapForGp.data.lastFrameImage;
            generationParams.firstFrameImageUrl = snapForGp.data.firstFrameImageUrl;
            generationParams.lastFrameImageUrl = snapForGp.data.lastFrameImageUrl;
        } else if (currentModelName === 'vidu 2.0') {
            generationParams.aspectRatio = snapForGp.data.aspectRatio || '16:9';
            generationParams.numberOfImages = snapForGp.data.numberOfImages || '1条';
            generationParams.viduDuration = snapForGp.data.viduDuration || '4s';
            generationParams.viduClarity = snapForGp.data.viduClarity || '1080p';
            generationParams.viduMotionRange = snapForGp.data.viduMotionRange || '自动';
            generationParams.firstFrameImage = snapForGp.data.firstFrameImage;
            generationParams.lastFrameImage = snapForGp.data.lastFrameImage;
            generationParams.firstFrameImageUrl = snapForGp.data.firstFrameImageUrl;
            generationParams.lastFrameImageUrl = snapForGp.data.lastFrameImageUrl;
        } else if (['seedance1.5-pro', 'seedance2.0 (高质量版)', 'seedance2.0 (急速版)'].includes(currentModelName)) {
            const isSeedance20Model = ['seedance2.0 (高质量版)', 'seedance2.0 (急速版)'].includes(currentModelName);
            const modeSnap = (snapForGp.data.seedanceGenerationMode || 'text') as 'text' | 'image' | 'reference';
            const rawAsp = snapForGp.data.seedanceAspectRatio;
            const appliedAsp =
              typeof (runCaptureForGp as { seedanceAspectRatio?: string }).seedanceAspectRatio ===
              'string'
                ? (runCaptureForGp as { seedanceAspectRatio: string }).seedanceAspectRatio
                : undefined;
            generationParams.numberOfImages = snapForGp.data.numberOfImages || '1条';
            generationParams.seedanceResolution =
              snapForGp.data.seedanceResolution || getSeedanceDefaultResolution(currentModelName);
            generationParams.seedanceAspectRatio =
              isSeedance20Model && modeSnap !== 'image'
                ? normalizeSeedanceAspectForTextRef(
                    appliedAsp || (rawAsp === '自动匹配' || !rawAsp ? undefined : rawAsp)
                  )
                : rawAsp || '自动匹配';
            generationParams.seedanceDuration = snapForGp.data.seedanceDuration || SEEDANCE_DURATION_DEFAULT_LABEL;
            generationParams.seedanceGenerateAudio = snapForGp.data.seedanceGenerateAudio ?? false;
            generationParams.seedanceFixedCamera = isSeedance20Model ? undefined : (snapForGp.data.seedanceFixedCamera ?? false);
            generationParams.seedanceGenerationMode =
              (runCaptureForGp as Partial<NodeData>).seedanceGenerationMode ||
              snapForGp.data.seedanceGenerationMode ||
              'text';
            generationParams.seedanceReferenceRatioMode =
              isSeedance20Model ? (snapForGp.data.seedanceReferenceRatioMode || 'force') : undefined;
            generationParams.seedanceReferenceWebSearch = isSeedance20Model
              ? (snapForGp.data.seedanceReferenceWebSearch ??
                  (snapForGp.data as { seedanceImageWebSearch?: boolean }).seedanceImageWebSearch ??
                  false)
              : undefined;
            generationParams.firstFrameImage = snapForGp.data.firstFrameImage;
            generationParams.lastFrameImage = snapForGp.data.lastFrameImage;
            generationParams.firstFrameImageUrl = snapForGp.data.firstFrameImageUrl;
            generationParams.lastFrameImageUrl = snapForGp.data.lastFrameImageUrl;
        } else if (isImage2Model(currentModelName)) {
            const mainPrev = snapForGp.data.imagePreview;
            if (image2ReferenceSnapshot?.length) {
                generationParams.referenceImages = dedupe(image2ReferenceSnapshot);
            } else {
                const stripped = (generationParams.referenceImages || []).filter(
                    (u) =>
                        !u.startsWith('blob:') &&
                        !/^data:/i.test(u) &&
                        !isDuplicateOfMainImagePreview(u, mainPrev)
                );
                generationParams.referenceImages = stripped.length ? stripped : undefined;
            }
            generationParams.referenceMovs = undefined;
            generationParams.referenceAudios = undefined;
            generationParams.image2AspectRatio = snapForGp.data.image2AspectRatio || '1:1';
            generationParams.image2ImageSize = snapForGp.data.image2ImageSize || '1024x1024';
            generationParams.image2Style = snapForGp.data.image2Style === 'natural' ? 'natural' : 'vivid';
            generationParams.image2Quality = image2ResolveQuality(
                snapForGp.data.image2Quality,
                snapForGp.data.image2ImageSize
            );
            generationParams.image2QualityLevel = image2NormalizeQualityLevel(
                snapForGp.data.image2QualityLevel
            );
            if (image2ProbedOutputSize) {
                generationParams.outputImageSize = image2ProbedOutputSize;
            }
            const image2RunLabels = (runCaptureForGp as { referenceImageLabels?: string[] }).referenceImageLabels;
            if (image2RunLabels?.some((l) => String(l || '').trim())) {
                generationParams.referenceImageLabels = [...image2RunLabels];
            }
        } else {
            generationParams.aspectRatio = snapForGp.data.aspectRatio || "1:1";
            generationParams.resolution = snapForGp.data.resolution || "1K";
            if (isVideoModel) {
                generationParams.quality = snapForGp.data.quality || '高质量';
                generationParams.duration = snapForGp.data.duration || '5s';
            }
        }

        if (seedanceImageRunSnapshot && (seedanceImageRunSnapshot.startUrl || seedanceImageRunSnapshot.endUrl)) {
            const imgs = [seedanceImageRunSnapshot.startUrl, seedanceImageRunSnapshot.endUrl].filter(
                (u): u is string => Boolean(u)
            );
            if (imgs.length) generationParams.referenceImages = imgs;
            if (seedanceImageRunSnapshot.startUrl) {
                generationParams.firstFrameImageUrl = seedanceImageRunSnapshot.startUrl;
                generationParams.firstFrameImage = seedanceImageRunSnapshot.startUrl;
            }
            if (seedanceImageRunSnapshot.endUrl) {
                generationParams.lastFrameImageUrl = seedanceImageRunSnapshot.endUrl;
                generationParams.lastFrameImage = seedanceImageRunSnapshot.endUrl;
            }
        }

        const gpRefVideoCount =
          generationParams.referenceMovs?.length ?? referenceMovs.length ?? 0;
        if (hasReferenceInputVideos(gpRefVideoCount)) {
          generationParams.firstFrameImage = undefined;
          generationParams.lastFrameImage = undefined;
          generationParams.firstFrameImageUrl = undefined;
          generationParams.lastFrameImageUrl = undefined;
        }

        if (currentModelName === '可灵3.0 Omni') {
            (generationParams as GenerationParams & { klingOmniTab?: string }).klingOmniTab =
                (snapForGp.data.klingOmniTab as any) || 'multi';
        }

        applyRunPanelFieldsToGenerationParams(generationParams, snapForGp.data, currentModelName);

        if (generatedImages.length > 0) {
          generationParams.outputUrl = generatedImages[0];
          if (generatedImages.length > 1) {
            generationParams.outputUrls = [...generatedImages];
          }
        }

        const outputCount = generatedImages.length;
        generatedImages.forEach((imgUrl, idx) => {
            let newNodeType: NodeType;
            let newNodePreview = imgUrl;
            let nextDefaultModel = ''; 

            if (isVideoModel) {
                newNodeType = NodeType.MOV;
            } else {
                newNodeType = NodeType.OUTPUT;
            }
            nextDefaultModel = resolveSpawnOutputDefaultModel({
                isVideoModel,
                currentModelName,
            });

            const namingUpstream =
              batchRunKindRef.current === 'selected' && selectedBatchNamingPrevRef.current
                ? selectedBatchNamingPrevRef.current
                : snapForGp.data;
            const outputNaming = resolveOutputNodeNamingFromUpstream(namingUpstream, {
              isVideo: isVideoModel,
              index: idx,
              count: outputCount,
            });

            if (newNodeType) {
                const newNodeId = getId();
                const offsetY = idx * 250;

                const inheritedOutputData: Partial<NodeData> = buildInheritedOutputDataFromSnapshot(snapForGp.data);
                const stillImageOutputPatch = buildStillImageOutputSpawnPatch(
                    snapForGp.data,
                    nextDefaultModel
                );
                // OUTPUT/MOV 面板不继承创意描述与任何参考（图/视频/音频/首尾帧）；仅保留生成结果与模型配置
                const newNode: RFNode = {
                    id: newNodeId,
                    type: newNodeType,
                    position: { x: baseX, y: baseY + ((existingOutgoingCount + idx) * 250) }, 
                    data: {
                        ...inheritedOutputData,
                        ...stillImageOutputPatch,
                        label: outputNaming.label, 
                        ...(outputNaming.customName ? { customName: outputNaming.customName } : {}),
                        imagePreview: newNodePreview, 
                        selectedModel: nextDefaultModel,
                        status: 'idle',
                        generatedAt: generatedAtIso,
                        imageName: outputNaming.imageName,
                        generationParams: generationParams,
                        taskId: generationParams.taskId,
                        // 创意描述 / 图片 / 视频 / 音频 / 首尾帧参考不继承到 OUTPUT 面板（仅保留在 generationParams 快照供 Node Details）
                        prompt: undefined,
                        negativePrompt: undefined,
                        numberOfImages: generationParams.numberOfImages ?? inheritedOutputData.numberOfImages,
                        aspectRatio: generationParams.aspectRatio ?? inheritedOutputData.aspectRatio,
                        resolution: generationParams.resolution ?? inheritedOutputData.resolution,
                        referenceImages: undefined,
                        referenceImageLabels: undefined,
                        image2Style: generationParams.image2Style ?? inheritedOutputData.image2Style,
                        image2AspectRatio: generationParams.image2AspectRatio ?? inheritedOutputData.image2AspectRatio,
                        image2ImageSize: generationParams.image2ImageSize ?? inheritedOutputData.image2ImageSize,
                        image2Quality: generationParams.image2Quality ?? inheritedOutputData.image2Quality,
                        image2QualityLevel:
                            generationParams.image2QualityLevel ?? inheritedOutputData.image2QualityLevel,
                        // 首尾帧 / 参考视频 / 参考音频 / 即梦参考图：仅写入 generationParams，面板一律清空
                        firstFrameImage: undefined,
                        firstFrameImageUrl: undefined,
                        firstFrameLocalRef: undefined,
                        firstFrameImageLabel: undefined,
                        lastFrameImage: undefined,
                        lastFrameImageUrl: undefined,
                        lastFrameLocalRef: undefined,
                        lastFrameImageLabel: undefined,
                        jimengImages: undefined,
                        referenceMovs: undefined,
                        referenceAudios: undefined,
                        ...(isVideoModel && outputNodeInitialPoster ? { videoPosterDataUrl: outputNodeInitialPoster } : {}),
                        ...(generationParams.seedanceAspectRatio
                          ? { seedanceAspectRatio: generationParams.seedanceAspectRatio }
                          : {}),
                    }
                };

                // 生成唯一的边 ID，包含时间戳以避免重复（source 与连线一致，便于排查）
                const edgeId = `e${linkSourceNodeId}-${newNodeId}-${Date.now()}-${idx}`;
                const newEdge: Edge = {
                    id: edgeId,
                    source: linkSourceNodeId,
                    target: newNodeId,
                    animated: true,
                    style: { stroke: '#6366f1', strokeWidth: 2 },
                };
                
                newNodes.push(newNode);
                newEdges.push(newEdge);
            }
        });

        // 运行节点保留本次快照（含 Omni tab、参考图列表），便于 Node Details 与面板一致；不覆盖 klingOmni* 拖入状态
        const framePersistModels = [
            'seedance1.5-pro',
            'seedance2.0 (高质量版)',
            'seedance2.0 (急速版)',
            'vidu 2.0',
            '即梦3.0 Pro',
        ];
        const shouldPersistFrameFields =
            isVideoModel &&
            (framePersistModels.includes(currentModelName) ||
                currentModelName.includes('可灵') ||
                currentModelName.includes('Keling')) &&
            !!(
                generationParams.firstFrameImageUrl ||
                generationParams.lastFrameImageUrl ||
                generationParams.firstFrameImage ||
                generationParams.lastFrameImage
            );
        let image2CompletedPanelRefs: string[] | null = null;
        if (
            isImage2Model(currentModelName) &&
            (image2PanelMergedRefs?.length || image2ReferenceSnapshot?.length)
        ) {
            if (image2PanelMergedRefs?.length) {
                image2CompletedPanelRefs = [...image2PanelMergedRefs];
            } else if (image2ReferenceSnapshot?.length) {
                const fromSnap = panelReferenceSlotsFromGenerationParamsSnapshot(
                    {
                        generationParams: {
                            referenceImages: image2ReferenceSnapshot,
                            referenceImageLabels: (runCaptureForGp as { referenceImageLabels?: string[] })
                                .referenceImageLabels,
                        },
                        imagePreview:
                            (runCaptureForGp.imagePreview as string | undefined) ??
                            snapForGp.data.imagePreview,
                    },
                    getCanonicalInspectorPromptText(
                        snapForGp.data,
                        projectAssetResolveOptsRef.current.projectAssets
                    ) || String(snapForGp.data.prompt || '')
                );
                image2CompletedPanelRefs = fromSnap.length
                    ? fromSnap
                    : [...image2ReferenceSnapshot];
            }
        }
        const buildUpdatedRunNodeData = (n: RFNode): NodeData => {
            const runPanelPreviewPatch: Partial<NodeData> = {};
            if (Object.prototype.hasOwnProperty.call(runCaptureForGp, 'imagePreview')) {
                runPanelPreviewPatch.imagePreview = runCaptureForGp.imagePreview as string | undefined;
            }
            if (Object.prototype.hasOwnProperty.call(runCaptureForGp, 'panelMainSlotVisible')) {
                runPanelPreviewPatch.panelMainSlotVisible =
                    runCaptureForGp.panelMainSlotVisible as boolean | undefined;
            }
            if (Object.prototype.hasOwnProperty.call(runCaptureForGp, 'panelMainImageUrl')) {
                runPanelPreviewPatch.panelMainImageUrl =
                    runCaptureForGp.panelMainImageUrl as string | undefined;
            }
            const nextData: NodeData = {
              ...n.data,
              ...runPanelPreviewPatch,
              generationParams: { ...(n.data.generationParams || {}), ...generationParams },
              generatedAt: generationParams.generatedAt ?? n.data.generatedAt,
              taskId: generationParams.taskId,
              ...(generationParams.seedanceAspectRatio
                ? { seedanceAspectRatio: generationParams.seedanceAspectRatio }
                : {}),
              ...(isNanoBanana2Model(currentModelName) && nanoPanelMergedRefs !== null
                ? {
                    referenceImages: [...nanoPanelMergedRefs],
                    ...(nanoPanelMergedLabels?.some((l) => l.trim())
                      ? {
                          referenceImageLabels: [...nanoPanelMergedLabels],
                        }
                      : n.data.referenceImageLabels?.length
                        ? { referenceImageLabels: [...n.data.referenceImageLabels] }
                        : {}),
                    ...(Object.prototype.hasOwnProperty.call(runCaptureForGp, 'panelMainSlotVisible')
                      ? {
                          panelMainSlotVisible: (runCaptureForGp as { panelMainSlotVisible?: boolean })
                            .panelMainSlotVisible,
                        }
                      : {}),
                    ...(Object.prototype.hasOwnProperty.call(runCaptureForGp, 'panelMainImageUrl')
                      ? {
                          panelMainImageUrl: (runCaptureForGp as { panelMainImageUrl?: string })
                            .panelMainImageUrl,
                        }
                      : {}),
                  }
                : {}),
              ...(image2CompletedPanelRefs?.length
                ? {
                    referenceImages: [...image2CompletedPanelRefs],
                    ...(image2PanelMergedLabels?.some((l) => l.trim())
                      ? { referenceImageLabels: [...image2PanelMergedLabels] }
                      : (runCaptureForGp as { referenceImageLabels?: string[] }).referenceImageLabels
                          ?.length
                        ? {
                            referenceImageLabels: [
                              ...(runCaptureForGp as { referenceImageLabels: string[] })
                                .referenceImageLabels,
                            ],
                          }
                        : n.data.referenceImageLabels?.length
                          ? { referenceImageLabels: [...n.data.referenceImageLabels] }
                          : {}),
                    ...(Object.prototype.hasOwnProperty.call(runCaptureForGp, 'panelMainSlotVisible')
                      ? {
                          panelMainSlotVisible: (runCaptureForGp as { panelMainSlotVisible?: boolean })
                            .panelMainSlotVisible,
                        }
                      : {}),
                  }
                : {}),
              // 视频模型二次再生：仅合并 generationParams 容易让顶层首尾帧槽位丢失，导致下次运行/Node Details 只剩一张或为空
              ...(firstLastFramePanelPatch
                  ? firstLastFramePanelPatch
                  : shouldPersistFrameFields
                    ? {
                          firstFrameImageUrl:
                              generationParams.firstFrameImageUrl ?? n.data.firstFrameImageUrl,
                          lastFrameImageUrl:
                              generationParams.lastFrameImageUrl ?? n.data.lastFrameImageUrl,
                          firstFrameImage:
                              generationParams.firstFrameImage ??
                              generationParams.firstFrameImageUrl ??
                              n.data.firstFrameImage,
                          lastFrameImage:
                              generationParams.lastFrameImage ??
                              generationParams.lastFrameImageUrl ??
                              n.data.lastFrameImage,
                      }
                    : {}),
              ...(isVideoModel
                  ? (() => {
                        const modeSnap = (generationParams.seedanceGenerationMode ||
                          n.data.seedanceGenerationMode ||
                          'text') as 'text' | 'image' | 'reference';
                        const isSeedanceRefPersist =
                          ['seedance2.0 (高质量版)', 'seedance2.0 (急速版)'].includes(
                            currentModelName
                          ) && modeSnap === 'reference';
                        if (isSeedanceRefPersist && seedanceReferenceSnapshot) {
                          const mainFromRun =
                            (runCaptureForGp.imagePreview as string | undefined) || n.data.imagePreview;
                          const shouldPatchMainPreview =
                            (currentNode.type === NodeType.INPUT ||
                              currentNode.type === NodeType.PROCESSOR) &&
                            !!mainFromRun;
                          const panelRefsFromRun =
                            seedancePanelMergedRefs?.length
                              ? [...seedancePanelMergedRefs]
                              : seedanceReferenceSnapshot.panelReferenceImages?.length
                                ? [...seedanceReferenceSnapshot.panelReferenceImages]
                                : n.data.referenceImages?.length
                                  ? [...(n.data.referenceImages || [])]
                                  : [...seedanceReferenceSnapshot.referenceImages];
                          const panelLabelsFromRun =
                            seedancePanelMergedLabels?.some((l) => l.trim())
                              ? [...seedancePanelMergedLabels]
                              : seedanceReferenceSnapshot.panelReferenceImageLabels?.length
                                ? [...seedanceReferenceSnapshot.panelReferenceImageLabels]
                                : n.data.referenceImageLabels?.length
                                  ? [...n.data.referenceImageLabels]
                                  : seedanceReferenceSnapshot.referenceImageLabels?.length
                                    ? [...seedanceReferenceSnapshot.referenceImageLabels]
                                    : undefined;
                          const apiPanelRefs = [...seedanceReferenceSnapshot.referenceImages];
                          const apiPanelLabels = seedanceReferenceSnapshot.referenceImageLabels;
                          const hideMainForCompact =
                            apiPanelRefs.length > 0 &&
                            apiPanelLabels?.some((l) => String(l || '').trim() === '主图');
                          const panelMainVisible = (
                            runCaptureForGp as { panelMainSlotVisible?: boolean }
                          ).panelMainSlotVisible;
                          const refTab = {
                            ...((n.data.seedanceTabConfigs?.reference as object) || {}),
                            prompt: getCanonicalInspectorPromptText(
                              snapForGp.data,
                              projectAssetResolveOptsRef.current.projectAssets
                            ),
                            referenceImages: [...panelRefsFromRun],
                            ...(panelLabelsFromRun?.length
                              ? { referenceImageLabels: [...panelLabelsFromRun] }
                              : Object.prototype.hasOwnProperty.call(
                                    runCaptureForGp,
                                    'referenceImageLabels'
                                  )
                                ? {
                                    referenceImageLabels: [
                                      ...((runCaptureForGp as { referenceImageLabels?: string[] })
                                        .referenceImageLabels || []),
                                    ],
                                  }
                                : {}),
                            referenceMovs: seedanceReferenceSnapshot.referenceMovs,
                            referenceAudios: seedanceReferenceSnapshot.referenceAudios,
                          };
                          return {
                            ...(shouldPatchMainPreview ? { imagePreview: mainFromRun } : {}),
                            seedanceTabConfigs: {
                              ...(n.data.seedanceTabConfigs || {}),
                              reference: refTab,
                            },
                            ...(hideMainForCompact || panelMainVisible === false
                              ? { panelMainSlotVisible: false as const }
                              : panelMainVisible === true
                                ? { panelMainSlotVisible: true as const }
                                : {}),
                            referenceImages: [...panelRefsFromRun],
                            ...(panelLabelsFromRun?.length
                              ? { referenceImageLabels: [...panelLabelsFromRun] }
                              : Object.prototype.hasOwnProperty.call(
                                    runCaptureForGp,
                                    'referenceImageLabels'
                                  )
                                ? {
                                    referenceImageLabels: [
                                      ...((runCaptureForGp as { referenceImageLabels?: string[] })
                                        .referenceImageLabels || []),
                                    ],
                                  }
                                : {}),
                            referenceMovs: seedanceReferenceSnapshot.referenceMovs,
                            referenceAudios: seedanceReferenceSnapshot.referenceAudios,
                          };
                        }
                        if (currentModelName === '可灵3.0 Omni') {
                          const kt = (n.data.klingOmniTab || 'multi') as
                            | 'multi'
                            | 'instruction'
                            | 'video'
                            | 'frames';
                          if (kt === 'multi' && omniMultiMergedRefs?.length) {
                            return {
                              ...(omniMultiPreviewPatch || {}),
                              klingOmniMultiReferenceImages: [...omniMultiMergedRefs],
                              ...(omniMultiMergedLabels?.some((l) => l.trim())
                                ? { referenceImageLabels: [...omniMultiMergedLabels] }
                                : {}),
                            };
                          }
                          if (
                            (kt === 'instruction' || kt === 'video') &&
                            (omniTabMergedRefs?.length || klingOmniReferenceSnapshot?.panelReferenceImages?.length)
                          ) {
                            const mergedRefs = omniTabMergedRefs?.length
                              ? [...omniTabMergedRefs]
                              : [...(klingOmniReferenceSnapshot?.panelReferenceImages || [])];
                            const omniTabPersistPreview: Partial<NodeData> = {};
                            if (omniTabPreviewPatch?.imagePreview) {
                              omniTabPersistPreview.imagePreview = omniTabPreviewPatch.imagePreview;
                            }
                            if (
                              Object.prototype.hasOwnProperty.call(
                                omniTabPreviewPatch || {},
                                'panelMainSlotVisible'
                              )
                            ) {
                              omniTabPersistPreview.panelMainSlotVisible =
                                omniTabPreviewPatch!.panelMainSlotVisible;
                            }
                            if (
                              Object.prototype.hasOwnProperty.call(
                                omniTabPreviewPatch || {},
                                'panelMainImageUrl'
                              )
                            ) {
                              omniTabPersistPreview.panelMainImageUrl =
                                omniTabPreviewPatch!.panelMainImageUrl;
                            }
                            return {
                              ...omniTabPersistPreview,
                              ...(kt === 'instruction'
                                ? { klingOmniInstructionReferenceImages: mergedRefs }
                                : { klingOmniVideoReferenceImages: mergedRefs }),
                              ...(omniTabMergedLabels?.some((l) => l.trim())
                                ? { referenceImageLabels: [...omniTabMergedLabels] }
                                : {}),
                              ...(klingOmniReferenceSnapshot?.referenceMovs?.length
                                ? { referenceMovs: klingOmniReferenceSnapshot.referenceMovs }
                                : {}),
                            };
                          }
                        }
                        if (currentModelName === '即梦3.0 Pro' && jimengMergedImages?.length) {
                          return {
                            jimengImages: [...jimengMergedImages],
                            firstFrameImageUrl:
                              generationParams.firstFrameImageUrl ?? n.data.firstFrameImageUrl,
                            firstFrameImage:
                              generationParams.firstFrameImage ?? n.data.firstFrameImage,
                          };
                        }
                        if (
                          ['seedance2.0 (高质量版)', 'seedance2.0 (急速版)'].includes(
                            currentModelName
                          ) &&
                          modeSnap === 'image' &&
                          (seedanceImageRunSnapshot?.startUrl ||
                            seedanceImageRunSnapshot?.endUrl ||
                            generationParams.firstFrameImageUrl ||
                            generationParams.lastFrameImageUrl)
                        ) {
                          return firstLastFramePanelPatch?.firstFrameImage !== undefined ||
                            firstLastFramePanelPatch?.firstFrameImageUrl !== undefined ||
                            firstLastFramePanelPatch?.lastFrameImage !== undefined ||
                            firstLastFramePanelPatch?.lastFrameImageUrl !== undefined
                            ? { ...firstLastFramePanelPatch }
                            : buildSeedanceImageModePanelPersistPatchFromPlan(
                                n.data,
                                seedanceImagePlanForPanel?.images ?? [],
                                {
                                  startUrl:
                                    seedanceImageRunSnapshot?.startUrl ||
                                    generationParams.firstFrameImageUrl ||
                                    generationParams.firstFrameImage,
                                  endUrl:
                                    seedanceImageRunSnapshot?.endUrl ||
                                    generationParams.lastFrameImageUrl ||
                                    generationParams.lastFrameImage,
                                }
                              );
                        }
                        const firstUrl =
                            generationParams.firstFrameImageUrl ||
                            generationParams.firstFrameImage ||
                            n.data.firstFrameImageUrl ||
                            n.data.firstFrameImage;
                        const normalizeKey = (u?: string) =>
                            u ? u.split('#')[0].split('?')[0].replace(/\/+$/, '').toLowerCase() : '';
                        const firstKey = normalizeKey(firstUrl);
                        const refs = Array.isArray(generationParams.referenceImages)
                            ? generationParams.referenceImages
                            : Array.isArray(n.data.referenceImages)
                              ? n.data.referenceImages
                              : [];
                        const normalizedRefs = refs
                            .map((u) => {
                                if (!u) return '';
                                if (firstUrl && (/^data:image\//i.test(u) || u.startsWith('blob:'))) return firstUrl;
                                return u;
                            })
                            .filter(Boolean)
                            .filter((u, idx, arr) => {
                                const key = normalizeKey(u);
                                if (firstKey && key === firstKey) return idx === arr.findIndex((x) => normalizeKey(x) === firstKey);
                                return idx === arr.findIndex((x) => normalizeKey(x) === key);
                            });
                        logRefDebug('final-persist-run-node', {
                            nodeId: n.id,
                            model: currentModelName,
                            firstUrl: firstUrl || null,
                            imagePreviewBefore: n.data.imagePreview,
                            refsBefore: refs,
                            refsAfter: normalizedRefs,
                        });
                        const keepStoryboardCardPreview = Boolean(
                          String(n.data.storyboardShotPreviewText || '').trim()
                        );
                        const shouldPatchMainPreview =
                            !keepStoryboardCardPreview &&
                            (currentNode.type === NodeType.INPUT ||
                              currentNode.type === NodeType.PROCESSOR) &&
                            !!firstUrl &&
                            /aitop100app-\d+\.cos\./i.test(firstUrl);
                        return {
                            ...(shouldPatchMainPreview ? { imagePreview: firstUrl } : {}),
                            referenceImages: normalizedRefs,
                        };
                    })()
                  : {}),
            } as NodeData;
            if (isImage2Model(currentModelName)) {
                logImage2Debug('post-success-merge', {
                    nodeId: n.id,
                    beforeRefsUi: (n.data.referenceImages || []).map((u, i) =>
                        summarizeImageRefUrlForDebug(u, i)
                    ),
                    gpRefs: (generationParams.referenceImages || []).map((u, i) =>
                        summarizeImageRefUrlForDebug(u, i)
                    ),
                    nextPreview: summarizeImageRefUrlForDebug(nextData.imagePreview, 0),
                });
            }
            nextData.modelConfigs = syncModelConfigFromNodeData(nextData);
            if (isImage2Model(currentModelName)) {
                const img2 = nextData.modelConfigs?.image2;
                logImage2Debug('post-success-after-sync', {
                    nodeId: n.id,
                    topRefsStill: (nextData.referenceImages || []).map((u, i) =>
                        summarizeImageRefUrlForDebug(u, i)
                    ),
                    modelConfigsImage2Refs: Array.isArray(img2?.referenceImages)
                        ? img2!.referenceImages!.map((u, i) => summarizeImageRefUrlForDebug(u, i))
                        : [],
                });
            }
            return nextData;
        };
        if (newNodes.length === 0) {
            setNodes((nds) =>
                nds.map((n) =>
                    n.id === idToRun
                        ? {
                              ...n,
                              data: buildUpdatedRunNodeData(n),
                          }
                        : n
                )
            );
        }
        if (isImage2Model(currentModelName)) {
            logImage2Debug('setNodes-after-run-scheduled', {
                nodeId: idToRun,
                generatedImagesCount: generatedImages.length,
                newNodesCount: newNodes.length,
                runTaskIds,
            });
        }

        /** 与 linkSource 规则配套：INPUT/PROCESSOR 挂到 relationAnchor；MOV/OUTPUT 视频挂到 idToRun；生图仅 INPUT 类挂锚点 */
        const thumbnailTargetNodeId: string | null =
            generatedImages.length > 0
                ? isInputLikeNode
                    ? relationAnchorNode.id
                    : isVideoModel &&
                        (currentNode.type === NodeType.OUTPUT || currentNode.type === NodeType.MOV)
                      ? idToRun
                      : null
                : null;

        {
            const edgesNow = getEdges();
            const nodesNow = getNodes();
            const nodesNowById = new Map(nodesNow.map((n) => [n.id, n] as const));
            const directParentsToRun = edgesNow
                .filter((e) => e.target === idToRun)
                .map((e) => {
                    const src = nodesNowById.get(e.source);
                    return { edgeId: e.id, source: e.source, sourceType: src?.type ?? 'missing' };
                });
            const outFromAnchor = edgesNow.filter((e) => e.source === relationAnchorNode.id).map((e) => e.target);
            const outFromLinkSource = edgesNow.filter((e) => e.source === linkSourceNodeId).map((e) => e.target);
            logFlowGenGraph('generation-graph', {
                idToRun,
                runNodeType: currentNode.type,
                isVideoModel,
                isInputLikeNode,
                anchorResolutionTrace,
                anchor: {
                    id: relationAnchorNode.id,
                    type: relationAnchorNode.type,
                    label: relationAnchorNode.data?.label,
                    pos: relationAnchorNode.position,
                },
                anchorSameAsRun: relationAnchorNode.id === currentNode.id,
                linkSourceNodeId,
                linkMatchesAnchorId: linkSourceNodeId === relationAnchorNode.id,
                linkMatchesRunId: linkSourceNodeId === idToRun,
                thumbnailTargetNodeId,
                // 参考图调试：只输出长度和前缀，避免污染控制台
                referenceImagesCount: (generationParams.referenceImages || []).length,
                referenceImagesPreview: (generationParams.referenceImages || []).slice(0, 4).map((u) => {
                    if (!u) return '';
                    return `${u.slice(0, 42)}${u.length > 42 ? '...' : ''}`;
                }),
                layout: {
                    baseX,
                    baseY,
                    existingOutgoingCount,
                    note: '新节点 y = baseY + (existingOutgoingCount + idx) * 250',
                },
                directParentsToRun,
                existingTargetsFromAnchor: outFromAnchor,
                existingTargetsFromLinkSource: outFromLinkSource,
                newNodes: newNodes.map((n) => ({ id: n.id, type: n.type, pos: n.position })),
                newEdges: newEdges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
                generatedCount: generatedImages.length,
                newNodeCount: newNodes.length,
            });
        }

        if (newNodes.length > 0) {
            // 预先算出 poster 目标节点与待生成 poster 的列表，供后续异步生成中间帧缩略图（不阻塞 UI）
            const targetNodeIdForPosters =
                isVideoModel && thumbnailTargetNodeId ? thumbnailTargetNodeId : null;
            const movNodesForPoster = newNodes.filter((n) => n.type === NodeType.MOV) as Array<RFNode & { type: typeof NodeType.MOV }>;
            const videoThumbsForPoster: { id: string; url: string }[] = isVideoModel ? generatedImages.map((url, i) => ({ id: newNodes[i]?.id ?? '', url })) : [];

            // Use spread syntax for TS safety
            setNodes((nds) => {
                const updatedNodes = [
                    ...nds.map((n) =>
                        n.id === idToRun
                            ? {
                                  ...n,
                                  data: buildUpdatedRunNodeData(n),
                              }
                            : n
                    ),
                    ...newNodes,
                ];
                
                // 添加缩略图到节点（规则与 linkSource/thumbnailTargetNodeId 一致）
                if (generatedImages.length > 0) {
                    const targetNodeId = thumbnailTargetNodeId;
                    if (!targetNodeId) return updatedNodes;
                    if (!updatedNodes.some((n) => n.id === targetNodeId)) return updatedNodes;
                    
                    const result = updatedNodes.map((n) => {
                        if (n.id !== targetNodeId) return n;
                        const existingThumbnails = n.data.generatedThumbnails || [];
                        const seedPoster = seedVideoPoster;
                        const newThumbnails = generatedImages.map((imgUrl, idx) => {
                            const isVideo = isVideoModel;
                            const newNodeId = newNodes[idx]?.id || `${currentNode.id}_thumb_${idx}_${Date.now()}`;
                            const thumbNode = newNodes[idx];
                            const thumbName =
                                thumbNode?.data?.customName?.trim() ||
                                thumbNode?.data?.imageName?.trim() ||
                                thumbNode?.data?.label?.trim() ||
                                (isVideo ? 'Video.mov' : 'Generated.png');
                            return {
                                id: newNodeId,
                                url: imgUrl,
                                type: isVideo ? 'video' as const : 'image' as const,
                                nodeId: newNodeId,
                                name: thumbName,
                                generationParams: generationParams,
                                ...(isVideo && seedPoster ? { posterDataUrl: seedPoster } : {}),
                            };
                        });
                        return {
                            ...n,
                            data: {
                                ...n.data,
                                generatedThumbnails: [...existingThumbnails, ...newThumbnails]
                            }
                        };
                    });
                    return result;
                }
                return updatedNodes;
            });
            setEdges((eds) => {
                // 去重合并，避免并发写入时重复边或覆盖
                const existing = new Set(eds.map((e) => e.id));
                const toAppend = newEdges.filter((e) => !existing.has(e.id));
                const merged = [...eds, ...toAppend];

                return merged;
            });

            if (
                isStillImageGenModel &&
                newNodes.length === 1 &&
                newNodes[0].type === NodeType.OUTPUT
            ) {
                setSelectedNodeId(newNodes[0].id);
            }

            // 后台顺序生成视频中间帧缩略图并写入节点数据，完成后立即持久化，刷新后能显示
            (async () => {
                // 稍等再截帧，避免 CDN/vidu 刚返回的 URL 尚未可访问或首帧未就绪导致黑屏
                await new Promise((r) => setTimeout(r, 1200));
                const fallbackPoster = outputNodeInitialPoster;
                // 同一运行内对同一视频 URL 只截帧一次，避免重复 CPU/内存开销
                const posterCache = new Map<string, string | null>();
                const isLikelyCrossOriginHardUrl = (url: string): boolean => {
                    return /kechuangai\.com\/ksc2\//i.test(url);
                };
                /** 必须从「本次生成结果」视频 URL 截帧；utils/videoThumbnail 已对跨域走 /proxy-file，禁止用源节点 poster 冒充新视频缩略图 */
                const captureWithRetry = async (url: string): Promise<string | null> => {
                    if (posterCache.has(url)) return posterCache.get(url) || null;
                    const waits = [0, 1500, 3000, 4500];
                    for (let i = 0; i < waits.length; i++) {
                        if (waits[i] > 0) await new Promise((r) => setTimeout(r, waits[i]));
                        const p = await captureVideoMiddleFrameQueued(url);
                        if (p) {
                            posterCache.set(url, p);
                            return p;
                        }
                    }
                    posterCache.set(url, null);
                    return null;
                };

                const movPosterUpdates = new Map<string, string>();
                const fallbackMovPosterUpdates = new Map<string, string>();
                const targetThumbPosterUpdates = new Map<string, string>();
                const fallbackTargetThumbPosterUpdates = new Map<string, string>();

                // 1) 为每个 MOV 节点生成 poster，并同步到对应的 generatedThumbnails（保证大缩略图和小缩略图用的是同一帧）
                for (const node of movNodesForPoster) {
                    const url = node.data?.imagePreview;
                    if (!url) continue;
                    const poster = await captureWithRetry(url);
                    if (poster) {
                        movPosterUpdates.set(node.id, poster);
                    } else {
                        if (!isLikelyCrossOriginHardUrl(url)) {
                        }
                        if (fallbackPoster) {
                            // 截帧失败时兜底复用前一节点 poster，避免小缩略图长期灰色
                            fallbackMovPosterUpdates.set(node.id, fallbackPoster);
                        }
                    }
                }

                // 2) 兜底：如果还有未绑定 poster 的缩略图，再单独尝试为它们截帧
                if (targetNodeIdForPosters) {
                    for (const thumb of videoThumbsForPoster) {
                        if (!thumb.id) continue;
                        const poster = await captureWithRetry(thumb.url);
                        if (poster) {
                            targetThumbPosterUpdates.set(thumb.id, poster);
                        } else {
                            if (!isLikelyCrossOriginHardUrl(thumb.url)) {
                            }
                            if (fallbackPoster) {
                                fallbackTargetThumbPosterUpdates.set(thumb.id, fallbackPoster);
                            }
                        }
                    }
                }

                const persistPoster = async (raw: string) =>
                  (await materializePosterDataUrl(raw, serverProjectId)) || raw;
                for (const [nid, p] of [...movPosterUpdates.entries()]) {
                  movPosterUpdates.set(nid, await persistPoster(p));
                }
                for (const [nid, p] of [...fallbackMovPosterUpdates.entries()]) {
                  fallbackMovPosterUpdates.set(nid, await persistPoster(p));
                }
                for (const [tid, p] of [...targetThumbPosterUpdates.entries()]) {
                  targetThumbPosterUpdates.set(tid, await persistPoster(p));
                }
                for (const [tid, p] of [...fallbackTargetThumbPosterUpdates.entries()]) {
                  fallbackTargetThumbPosterUpdates.set(tid, await persistPoster(p));
                }

                if (
                    movPosterUpdates.size > 0 ||
                    fallbackMovPosterUpdates.size > 0 ||
                    targetThumbPosterUpdates.size > 0 ||
                    fallbackTargetThumbPosterUpdates.size > 0
                ) {
                    const affectedNodeIds = new Set<string>([
                        ...movPosterUpdates.keys(),
                        ...fallbackMovPosterUpdates.keys(),
                    ]);
                    if (targetNodeIdForPosters) {
                        affectedNodeIds.add(targetNodeIdForPosters);
                    }
                    setNodes((nds) =>
                        nds.map((n) => {
                            if (!affectedNodeIds.has(n.id)) return n;
                            let changed = false;
                            let nextData = n.data;

                            const directPoster = movPosterUpdates.get(n.id);
                            const fallbackDirectPoster = fallbackMovPosterUpdates.get(n.id);
                            if (directPoster && nextData.videoPosterDataUrl !== directPoster) {
                                nextData = { ...nextData, videoPosterDataUrl: directPoster };
                                changed = true;
                            } else if (fallbackDirectPoster && !nextData.videoPosterDataUrl) {
                                nextData = { ...nextData, videoPosterDataUrl: fallbackDirectPoster };
                                changed = true;
                            }

                            if (Array.isArray(nextData.generatedThumbnails) && nextData.generatedThumbnails.length > 0) {
                                let thumbsChanged = false;
                                const thumbs = nextData.generatedThumbnails.map((t) => {
                                    const byNodePoster = movPosterUpdates.get(String(t.nodeId || ''));
                                    if (t.type === 'video' && byNodePoster && t.posterDataUrl !== byNodePoster) {
                                        thumbsChanged = true;
                                        return { ...t, posterDataUrl: byNodePoster };
                                    }
                                    const byNodeFallbackPoster = fallbackMovPosterUpdates.get(String(t.nodeId || ''));
                                    if (t.type === 'video' && byNodeFallbackPoster && !t.posterDataUrl) {
                                        thumbsChanged = true;
                                        return { ...t, posterDataUrl: byNodeFallbackPoster };
                                    }
                                    const byThumbPoster = targetThumbPosterUpdates.get(t.id);
                                    if (t.type === 'video' && byThumbPoster && t.posterDataUrl !== byThumbPoster) {
                                        thumbsChanged = true;
                                        return { ...t, posterDataUrl: byThumbPoster };
                                    }
                                    const byThumbFallbackPoster = fallbackTargetThumbPosterUpdates.get(t.id);
                                    if (t.type === 'video' && byThumbFallbackPoster && !t.posterDataUrl) {
                                        thumbsChanged = true;
                                        return { ...t, posterDataUrl: byThumbFallbackPoster };
                                    }
                                    return t;
                                });
                                if (thumbsChanged) {
                                    nextData = { ...nextData, generatedThumbnails: thumbs };
                                    changed = true;
                                }
                            }

                            return changed ? { ...n, data: nextData } : n;
                        })
                    );
                    window.dispatchEvent(new CustomEvent('flowgen:persist-request'));
                }
            })();

            setTimeout(() => {
                    fitView({ 
                        nodes: [relationAnchorNode, ...newNodes], 
                        padding: 0.2, 
                        duration: 800 
                    });
            }, 100);
        }

      } catch (err: any) {
          if (isImage2Model(currentNode.data.selectedModel || '')) {
              logImage2Debug('handleNodeRun-catch', {
                  nodeId: idToRun,
                  message: err instanceof Error ? err.message : String(err),
                  stack: err instanceof Error ? err.stack : undefined,
                  runTaskIds,
              });
          }
          
          // 提取明确的错误信息
          let errorMessage = "未知错误";
          if (err instanceof Error) {
              // 如果错误信息已经包含明确的API错误标识，直接使用
              if (err.message.includes('API') || err.message.includes('HTTP') || err.message.includes('❌')) {
                  errorMessage = err.message;
              } else {
                  errorMessage = `**❌ 节点运行失败**\n\n**错误：** ${err.message}`;
              }
          } else {
              errorMessage = `**❌ 节点运行失败**\n\n**错误：** ${String(err)}`;
          }
          const uniqueTaskIds = Array.from(new Set(runTaskIds.filter(Boolean)));
          if (uniqueTaskIds.length > 0 && !/task\s*id/i.test(errorMessage)) {
              errorMessage += `\n\n**Task ID：** ${uniqueTaskIds.join(', ')}`;
          }
          const diagReason = errorMessage || (err instanceof Error ? err.message : String(err));
          const mediaDiagnostics = shouldAppendRunMediaDiagnostics(diagReason)
            ? await collectRunMediaDiagnostics(diagReason)
            : '';
          const aitopPlatformHint = formatAitopPlatformSupportHint(
            diagReason,
            getAitopBillingContext()
          );
          if (isImage2Model(currentNode.data.selectedModel || '')) {
              logImage2Debug('handleNodeRun-after-diagnostics', {
                  nodeId: idToRun,
                  hasDiagnostics: Boolean(mediaDiagnostics),
                  hasAitopHint: Boolean(aitopPlatformHint),
                  errorMessagePreview: errorMessage.slice(0, 280),
              });
          }
          if (mediaDiagnostics) {
              errorMessage += mediaDiagnostics;
          } else if (aitopPlatformHint) {
              errorMessage += aitopPlatformHint;
          }
          
          // 原始节点不进入 error 态；仅恢复为 idle，错误信息放到独立 Error Result Node
          // 清 taskId + runRecoveryPending 并立即持久化，避免删错节点/刷新后 recovery 重新拉起失败任务卡 5%
          pendingRunPersistPatchesRef.current.delete(idToRun);
          const latestRunNodeForError = getNodes().find((n) => n.id === idToRun) || currentNode;
          const errorRunClearPatch = clearStaleRunTaskBeforeFreshRun(latestRunNodeForError.data as NodeData);
          const errorIdlePatch = {
            ...errorRunClearPatch,
            status: 'idle' as const,
            progress: 0,
            errorMessage: undefined,
          };
          updateNodeDataById(idToRun, errorIdlePatch);
          stageRunPersistPatch(errorIdlePatch);
          window.dispatchEvent(
            new CustomEvent('flowgen:persist-request', { detail: { force: true } })
          );

          // 失败时创建“错误结果节点”，保留原节点不变，便于追溯与复制报错内容
          try {
              const latestNodes = getNodes();
              const runNode = latestNodes.find((n) => n.id === idToRun);
              if (runNode) {
                  const errorNodeId = getId();
                  const existingOutgoingCount = getEdges().filter((e) => e.source === idToRun).length;
                  const errorNode: RFNode = {
                      id: errorNodeId,
                      type: NodeType.OUTPUT,
                      position: {
                          x: runNode.position.x + 350,
                          y: runNode.position.y + (existingOutgoingCount * 250),
                      },
                      data: {
                          label: 'Error Result Node',
                          status: 'error',
                          selectedModel: runNode.data?.selectedModel,
                          prompt: runNode.data?.prompt || '',
                          errorMessage,
                          imageName: `Error_${Date.now()}.txt`,
                      }
                  };
                  const errorEdge: Edge = {
                      id: `e${idToRun}-${errorNodeId}-error-${Date.now()}`,
                      source: idToRun,
                      target: errorNodeId,
                      animated: true,
                      style: { stroke: '#ef4444', strokeWidth: 2.2 },
                  };
                  setNodes((nds) => [...nds, errorNode]);
                  setEdges((eds) => [...eds, errorEdge]);
              }
          } catch (_) {
              // ignore error-node creation failures
          }
      } finally {
          activeRunIdsRef.current.delete(idToRun);
      }

  }, [selectedNodeId, nodes, getNodes, getEdges, setNodes, setEdges, fitView, storyboardImages]);

  // 兜底触发链路：Inspector 可通过全局事件直接请求运行指定节点
  useEffect(() => {
    const runHandler = (e: Event) => {
      const detail = (e as CustomEvent<{ nodeId?: string }>).detail;
      const nodeId = detail?.nodeId;
      if (!nodeId) return;
      void handleNodeRun(nodeId);
    };
    window.addEventListener('flowgen:run-node', runHandler as EventListener);
    return () => window.removeEventListener('flowgen:run-node', runHandler as EventListener);
  }, [handleNodeRun]);

  // image2 调试：捕获页面级未处理异常，定位“点运行直接崩”时最后错误
  useEffect(() => {
    const onWindowError = (ev: ErrorEvent) => {
      const payload = {
        message: ev.message,
        filename: ev.filename,
        lineno: ev.lineno,
        colno: ev.colno,
        stack: ev.error instanceof Error ? ev.error.stack : undefined,
      };
      appendRuntimeCrashLog('window-error', payload);
      logImage2Debug('window-error', payload);
    };
    const onUnhandledRejection = (ev: PromiseRejectionEvent) => {
      const reason = ev.reason;
      const payload = {
        reason:
          reason instanceof Error
            ? { message: reason.message, stack: reason.stack }
            : String(reason),
      };
      appendRuntimeCrashLog('unhandled-rejection', payload);
      logImage2Debug('unhandled-rejection', payload);
    };
    window.addEventListener('error', onWindowError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    return () => {
      window.removeEventListener('error', onWindowError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, [appendRuntimeCrashLog]);

  const onNodeDoubleClick = useCallback((event: React.MouseEvent, node: RFNode) => {
    if (node.type === NodeType.CHAIN_FOLDER || node.type === NodeType.BACKDROP) return;
    const latestNode = getNodes().find(n => n.id === node.id) || node;
    setPreviewNode(latestNode);
  }, [getNodes]);

  const onNodeClick = useCallback((event: React.MouseEvent, node: RFNode) => {
    if (!shouldOpenInspectorForNode(node)) {
      inspectorAnchorIdRef.current = null;
      setFlowgenInspectorAnchorId(null);
      setSelectedNodeId(null);
      return;
    }
    if (
      shouldIgnoreNodeClickForInspector({
        anchorId: inspectorAnchorIdRef.current,
        clickedNodeId: node.id,
        multiCount: getNodes().filter((n) => n.selected).length,
        suppressClear: suppressInspectorClearRef.current,
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
      })
    ) {
      return;
    }
    inspectorAnchorIdRef.current = node.id;
    setFlowgenInspectorAnchorId(node.id);
    setSelectedNodeId(node.id);

    // Check if the expand button was clicked
    if ((event.target as Element).closest('.custom-node-expand-btn')) {
        // 确保使用最新的节点数据（从 getNodes 获取）
        const latestNode = getNodes().find(n => n.id === node.id) || node;
        setPreviewNode(latestNode);
    }
  }, [getNodes]);

  const clearCanvas = useCallback(() => {
      setNodes([]);
      setEdges([]);
      setStoryboardImages([]);
      setSelectedNodeId(null);
      setPreviewNode(null);
      try {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(STORAGE_BACKUP_KEY);
      } catch {
        /* ignore */
      }
      lastRemoteWorkspaceSigRef.current = '';
      persistImportedGraphSnapshot([], [], []);
  }, [
    setNodes,
    setEdges,
    setStoryboardImages,
    STORAGE_KEY,
    STORAGE_BACKUP_KEY,
    persistImportedGraphSnapshot,
  ]);

  const runStaggeredQueue = useCallback(
    async (queue: RFNode[], kind: 'storyboard' | 'selected') => {
      stopExecutionRef.current = false;
      setIsGlobalRunning(true);
      setBatchRunKind(kind);
      batchRunKindRef.current = kind;
      setBatchRunProgress({ current: 0, total: queue.length });

      const runPromises: Promise<void>[] = [];

      try {
        for (let i = 0; i < queue.length; i++) {
          if (stopExecutionRef.current) break;

          const node = queue[i];
          setBatchRunProgress({ current: i + 1, total: queue.length });
          setScheduledRunBadgeNodeIds((prev) =>
            removeScheduledRunQueueHighlightId(prev, node.id)
          );

          if (kind === 'selected') {
            selectedBatchNamingPrevRef.current =
              i > 0 ? (queue[i - 1].data as Partial<NodeData>) : undefined;
          } else {
            selectedBatchNamingPrevRef.current = undefined;
          }

          fitView({ nodes: [node], duration: 500, padding: 0.5 });

          runPromises.push(
            handleNodeRun(node.id).catch(() => {
              /* 单节点失败不阻断队列 */
            })
          );

          if (i < queue.length - 1 && !stopExecutionRef.current) {
            await new Promise((r) => setTimeout(r, BATCH_RUN_NODE_INTERVAL_MS));
          }
        }

        if (runPromises.length > 0) {
          await Promise.all(runPromises);
        }
      } finally {
        selectedBatchNamingPrevRef.current = undefined;
        setBatchRunProgress(null);
        setBatchRunKind(null);
        batchRunKindRef.current = 'storyboard';
        setIsGlobalRunning(false);
        setScheduledRunBadgeNodeIds(null);
      }
    },
    [fitView, handleNodeRun]
  );

  // --- Global Run Flow：分镜绿色节点，每 15s 启动下一镜（可多镜并行），队列结束后等待全部完成 ---
  const runFlow = useCallback(async (options?: { skipConfirm?: boolean; fixedNodeIds?: string[] }) => {
      const currentNodes = getNodes();
      const currentEdges = getEdges();
      const queue = options?.fixedNodeIds?.length
        ? resolveBatchRunQueueByIds(options.fixedNodeIds, currentNodes)
        : collectStoryboardGreenRunQueue(currentNodes, currentEdges);

      if (queue.length === 0) {
        alert(
          options?.fixedNodeIds?.length
            ? '定时队列中的节点已不可用（可能已删除、无创意描述或正在运行中）。'
            : '没有可运行的分镜节点。\n\n条件：绿色边框（分镜表已写入时长）、有创意描述、且尚未生成 OUTPUT/MOV 下游。'
        );
        return;
      }

      if (!options?.skipConfirm) {
        const confirmed = confirm(
          `将按镜头顺序启动 ${queue.length} 个绿色分镜节点：\n` +
            `• 每隔 ${BATCH_RUN_NODE_INTERVAL_MS / 1000} 秒启动下一镜（可与上一镜并行）\n` +
            `• 仅包含尚无 OUTPUT/MOV 下游的节点\n\n` +
            `确定开始？`
        );
        if (!confirmed) return;
      }

      await runStaggeredQueue(queue, 'storyboard');
  }, [getNodes, getEdges, runStaggeredQueue]);

  const runSelectedFlow = useCallback(async (options?: { skipConfirm?: boolean; fixedNodeIds?: string[] }) => {
      const queue = options?.fixedNodeIds?.length
        ? resolveBatchRunQueueByIds(options.fixedNodeIds, getNodes())
        : collectSelectedRunQueue(getNodes());

      if (queue.length === 0) {
        alert(
          options?.fixedNodeIds?.length
            ? '定时队列中的节点已不可用（可能已删除、无创意描述或正在运行中）。'
            : '没有可运行的选中节点。\n\n请用框选/多选选中 INPUT 或 PROCESSOR 节点，并确保已填写创意描述。'
        );
        return;
      }

      if (!options?.skipConfirm) {
        const confirmed = confirm(
          `将按顺序启动 ${queue.length} 个选中节点：\n` +
            `• 每隔 ${BATCH_RUN_NODE_INTERVAL_MS / 1000} 秒启动下一个（可与上一个并行）\n` +
            `• 生成的视频节点命名继承队列中上一节点的名称（首个节点用自身名称）\n\n` +
            `确定开始？`
        );
        if (!confirmed) return;
      }

      await runStaggeredQueue(queue, 'selected');
  }, [getNodes, runStaggeredQueue]);

  const selectedRunQueueCount = useMemo(
    () => collectSelectedRunQueue(nodes).length,
    [nodes]
  );

  const storyboardRunQueueCount = useMemo(
    () => collectStoryboardGreenRunQueue(nodes, edges).length,
    [nodes, edges]
  );

  /** 定时运行排队：画布节点琥珀色标记（瞬态，不写持久化）。
   *  等待到点：scheduledRunBadgeNodeIds 全队列打标。
   *  批量执行中：每启动一个节点才清除该节点角标，其余仍显示「定时」。
   *  不能因 isGlobalRunning 一次性清空；用户取消定时或队列结束才全清。
   */
  const flowDisplayNodes = useMemo(
    () => applyScheduledRunQueueHighlight(nodes, scheduledRunBadgeNodeIds),
    [nodes, scheduledRunBadgeNodeIds]
  );

  const getRunScheduleOptions = useCallback(() => {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const fmt = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return [
      { label: '马上运行', sub: `当前 ${fmt(now)}`, delayMs: 0 },
      { label: '5分钟后', sub: fmt(new Date(now.getTime() + 5 * 60 * 1000)), delayMs: 5 * 60 * 1000 },
      { label: '15分钟后', sub: fmt(new Date(now.getTime() + 15 * 60 * 1000)), delayMs: 15 * 60 * 1000 },
      { label: '30分钟后', sub: fmt(new Date(now.getTime() + 30 * 60 * 1000)), delayMs: 30 * 60 * 1000 },
      { label: '1小时后', sub: fmt(new Date(now.getTime() + 60 * 60 * 1000)), delayMs: 60 * 60 * 1000 },
      { label: '2小时后', sub: fmt(new Date(now.getTime() + 2 * 60 * 60 * 1000)), delayMs: 2 * 60 * 60 * 1000 },
    ];
  }, []);

  const handleScheduleRun = useCallback((action: 'selected' | 'all', delayMs: number) => {
    const runFn = action === 'selected' ? runSelectedFlow : runFlow;
    if (delayMs <= 0) {
      void runFn();
      return;
    }

    const nodeIds = snapshotBatchRunNodeIds(action, getNodes(), getEdges());
    if (nodeIds.length === 0) {
      alert(
        action === 'selected'
          ? '没有可定时的选中节点。请选中 INPUT/PROCESSOR 并填写创意描述。'
          : '没有可定时的分镜节点（绿色边框、有创意描述、尚无 OUTPUT/MOV 下游）。'
      );
      return;
    }

    if (scheduledRunTimeoutRef.current) {
      clearTimeout(scheduledRunTimeoutRef.current);
      scheduledRunTimeoutRef.current = null;
    }

    const fireAt = Date.now() + delayMs;
    const fireDate = new Date(fireAt);
    const pad = (n: number) => n.toString().padStart(2, '0');
    const timeLabel = `${pad(fireDate.getHours())}:${pad(fireDate.getMinutes())}`;

    setPendingScheduledRun({ action, nodeIds, fireAt });
    setScheduledRunBadgeNodeIds(nodeIds);
    scheduledRunTimeoutRef.current = setTimeout(() => {
      scheduledRunTimeoutRef.current = null;
      setPendingScheduledRun(null);
      void runFn({ skipConfirm: true, fixedNodeIds: nodeIds });
    }, delayMs);

    alert(
      `已定时「${action === 'selected' ? '选择运行' : '全部运行'}」\n\n` +
        `• 启动时间：${timeLabel}\n` +
        `• 队列节点：${nodeIds.length} 个\n` +
        `• 每隔 ${BATCH_RUN_NODE_INTERVAL_MS / 1000} 秒启动下一个（可并行）`
    );
  }, [runSelectedFlow, runFlow, getNodes, getEdges]);

  const openRunScheduleMenu = useCallback((e: React.MouseEvent, action: 'selected' | 'all') => {
    if (action === 'selected' && selectedRunQueueCount === 0) return;
    if (action === 'all' && storyboardRunQueueCount === 0) return;
    e.stopPropagation();
    setCustomTimePicker(null);
    setRunScheduleMenu({ x: e.clientX, y: e.clientY + 10, action });
  }, [selectedRunQueueCount, storyboardRunQueueCount]);

  /** 选择运行 / 全部运行：主按钮立即运行 + 右侧定时下拉（两按钮结构一致） */
  const renderRunQueueSplitButton = useCallback(
    (
      action: 'selected' | 'all',
      opts: {
        icon: React.ReactNode;
        label: string;
        count?: number;
        disabled?: boolean;
        mainTitle: string;
        scheduleTitle: string;
        shellClass: string;
        mainClass: string;
        chevronClass: string;
      }
    ) => {
      const runNow = () => {
        if (action === 'selected') void runSelectedFlow();
        else void runFlow();
      };
      return (
        <div
          className={`flex rounded-lg font-semibold shadow-lg transition-all active:scale-95 border overflow-hidden ${opts.shellClass}`}
        >
          <button
            type="button"
            disabled={opts.disabled}
            onClick={() => runNow()}
            title={opts.mainTitle}
            className={`flex items-center gap-2 px-4 py-2.5 transition-colors ${opts.mainClass}`}
          >
            {opts.icon}
            {opts.label}
            {opts.count != null && opts.count > 0 ? (
              <span className="text-xs font-mono text-brand-300/90">({opts.count})</span>
            ) : null}
          </button>
          <button
            type="button"
            disabled={opts.disabled}
            onClick={(e) => openRunScheduleMenu(e, action)}
            title={opts.scheduleTitle}
            className={`flex items-center justify-center px-2.5 py-2.5 border-l transition-colors ${opts.chevronClass}`}
          >
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>
      );
    },
    [runFlow, runSelectedFlow, openRunScheduleMenu]
  );

  const getDefaultDateTimeLocalValue = useCallback(() => {
    const d = new Date(Date.now() + 10 * 60 * 1000); // 默认 10 分钟后
    d.setSeconds(0, 0);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }, []);

  const openCustomTimePicker = useCallback((action: 'selected' | 'all') => {
    setRunScheduleMenu(null);
    setCustomTimePicker({ action, defaultValue: getDefaultDateTimeLocalValue() });
    // 下一帧聚焦输入框
    setTimeout(() => customTimeInputRef.current?.focus(), 0);
  }, [getDefaultDateTimeLocalValue]);

  const confirmCustomTime = useCallback(() => {
    if (!customTimePicker) return;
    const input = customTimeInputRef.current;
    if (!input || !input.value) {
      alert('请选择启动时间');
      return;
    }
    const chosen = new Date(input.value);
    const now = new Date();
    const delayMs = chosen.getTime() - now.getTime();
    if (delayMs < 0) {
      alert('所选时间已过期，请选择未来时间');
      return;
    }
    handleScheduleRun(customTimePicker.action, delayMs);
    setCustomTimePicker(null);
  }, [customTimePicker, handleScheduleRun]);

  const selectedDownloadableCount = useMemo(
    () => nodes.filter((n) => n.selected && n.data?.imagePreview).length,
    [nodes]
  );

  // Helper function to copy text to clipboard with fallback
  const copyToClipboard = useCallback(async (text: string): Promise<boolean> => {
      try {
          // Try modern clipboard API first
          if (navigator.clipboard && navigator.clipboard.writeText) {
              await navigator.clipboard.writeText(text);
              return true;
          }
      } catch (error) {
      }
      
      // Fallback: use traditional method
      try {
          const textArea = document.createElement('textarea');
          textArea.value = text;
          textArea.style.position = 'fixed';
          textArea.style.left = '-999999px';
          textArea.style.top = '-999999px';
          document.body.appendChild(textArea);
          textArea.focus();
          textArea.select();
          
          const successful = document.execCommand('copy');
          document.body.removeChild(textArea);
          
          if (successful) {
              return true;
          } else {
              throw new Error('execCommand failed');
          }
      } catch (error) {
          return false;
      }
  }, []);

  // Helper function to download a file from URL (handles CORS)
  const downloadFile = useCallback(async (url: string, filename: string) => {
      try {
          const fetchTarget = resolveDownloadFetchUrl(url);
          const resolveInnerProxyUrl = (input: string): string => {
              const raw = String(input || '').trim();
              if (!raw) return '';
              try {
                  const u = new URL(raw, window.location.origin);
                  const p = u.pathname.toLowerCase();
                  if ((p === '/proxy-file' || p === '/proxy-image') && u.searchParams.get('url')) {
                      return resolveInnerProxyUrl(u.searchParams.get('url') || '');
                  }
                  return u.toString();
              } catch {
                  return raw;
              }
          };
          const deriveFilenameFromUrl = (input: string): string => {
              const normalized = resolveInnerProxyUrl(input);
              if (!normalized) return '';
              try {
                  const u = new URL(normalized, window.location.origin);
                  const seg = decodeURIComponent((u.pathname.split('/').filter(Boolean).pop() || '').trim());
                  const bad = /^(proxy-file|proxy-image|file|thumb)$/i;
                  if (!seg || bad.test(seg)) return '';
                  return seg;
              } catch {
                  const bare = normalized.split('#')[0].split('?')[0];
                  const seg = decodeURIComponent((bare.split('/').filter(Boolean).pop() || '').trim());
                  return /^(proxy-file|proxy-image|file|thumb)$/i.test(seg) ? '' : seg;
              }
          };
          const pickSafeDownloadName = (inputUrl: string, preferredName: string): string => {
              const cleanPreferred = String(preferredName || '').trim();
              if (cleanPreferred && !/^(proxy-file|proxy-image|file|thumb)(\.[a-z0-9]+)?$/i.test(cleanPreferred)) {
                  return cleanPreferred;
              }
              const fromUrl = deriveFilenameFromUrl(inputUrl);
              if (fromUrl) return fromUrl;
              return cleanPreferred || 'download.bin';
          };
          const finalFilename = pickSafeDownloadName(fetchTarget, filename);
          const isVideoLikeUrl = (u: string): boolean =>
              /\.(mov|mp4|webm|avi|mkv|flv|wmv|m4v)(\?|$)/i.test(u) ||
              /kechuangai\.com\/ksc2\//i.test(u) ||
              /video/i.test(u);
          // Check if it's a blob URL or data URL (can download directly)
          if (fetchTarget.startsWith('blob:') || fetchTarget.startsWith('data:')) {
              const link = document.createElement('a');
              link.href = fetchTarget;
              link.download = finalFilename;
              link.style.display = 'none';
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              return;
          }

          // For remote URLs, always fetch as blob to force download
          const blobDownloadViaFetch = async (fetchUrl: string) => {
              const response = await fetch(fetchUrl, {
                  mode: fetchUrl.startsWith('/') ? 'same-origin' : 'cors',
                  credentials: 'omit',
                  cache: 'no-cache',
              });
              if (!response.ok) {
                  throw new Error(`Failed to fetch: ${response.statusText}`);
              }
              const blob = await response.blob();
              const blobUrl = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = blobUrl;
              link.download = finalFilename;
              link.style.display = 'none';
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
          };

          if (fetchTarget.startsWith('/proxy-file?') || remoteMediaUrlPreferSameOriginProxy(fetchTarget)) {
              try {
                  const proxyUrl = fetchTarget.startsWith('/')
                      ? fetchTarget
                      : `/proxy-file?url=${encodeURIComponent(fetchTarget)}`;
                  await blobDownloadViaFetch(proxyUrl);
                  return;
              } catch {
                  if (isVideoLikeUrl(fetchTarget)) {
                      throw new Error('Video download blocked by signed URL expiry or upstream anti-hotlink');
                  }
                  throw new Error('Proxy download failed');
              }
          }

          try {
              await blobDownloadViaFetch(fetchTarget);
          } catch {
              try {
                  await blobDownloadViaFetch(`/proxy-file?url=${encodeURIComponent(fetchTarget)}`);
              } catch {
                  if (isVideoLikeUrl(fetchTarget)) {
                      throw new Error('Video download blocked by signed URL expiry or upstream anti-hotlink');
                  }
                  throw new Error('Proxy download failed');
              }
          }
      } catch (error) {
          throw error instanceof Error ? error : new Error(String(error));
      }
  }, []);

  // 某些平台返回的是短时签名视频 URL，过期后会 403；下载前可按 taskId 刷新一次最新 resourceUrl
  const resolveFreshDownloadUrl = useCallback(async (node: RFNode): Promise<string> => {
      const currentUrl = node.data.imagePreview || '';
      const isVideoLike = /\.(mov|mp4|webm|avi|mkv|flv|wmv|m4v)(\?|$)/i.test(currentUrl) || /\/video\//i.test(currentUrl);
      if (!currentUrl || !isVideoLike) return currentUrl;

      const taskIdRaw =
          node.data.taskId ||
          node.data.generationParams?.taskId ||
          '';
      const taskIds = String(taskIdRaw)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      const latestTaskId = taskIds.length ? taskIds[taskIds.length - 1] : '';
      if (!latestTaskId) return currentUrl;

      try {
          const statusData = await getTaskStatus(latestTaskId);
          const freshUrl = pickVideoResourceUrlFromTaskStatus(statusData);
          if (typeof freshUrl === 'string' && freshUrl) {
              return freshUrl;
          }
      } catch (e) {
      }
      return currentUrl;
  }, []);

  const getLatestTaskIdFromNode = useCallback((node: RFNode): string => {
      const pickLatest = (raw?: string): string => {
          const taskIds = String(raw || '').split(',').map((s) => s.trim()).filter(Boolean);
          return taskIds.length ? taskIds[taskIds.length - 1] : '';
      };

      // 1) 当前预览节点
      const direct = pickLatest(node.data.taskId || node.data.generationParams?.taskId);
      if (direct) return direct;

      const allNodes = getNodes();

      // 2) 同一预览 URL 的其他节点（避免临时 previewNode 丢 taskId）
      const bySameUrl = allNodes.find((n) =>
          n.id !== node.id &&
          n.data?.imagePreview &&
          node.data?.imagePreview &&
          n.data.imagePreview === node.data.imagePreview &&
          (n.data.taskId || n.data.generationParams?.taskId)
      );
      if (bySameUrl) {
          const t = pickLatest(bySameUrl.data.taskId || bySameUrl.data.generationParams?.taskId);
          if (t) return t;
      }

      // 3) 取上游父节点（很多场景 taskId 保存在运行节点）
      const inEdge = edges.find((e) => e.target === node.id);
      if (inEdge) {
          const parent = allNodes.find((n) => n.id === inEdge.source);
          const t = pickLatest(parent?.data?.taskId || parent?.data?.generationParams?.taskId);
          if (t) return t;
      }

      return '';
  }, [getNodes, edges]);

  const downloadByTaskId = useCallback(async (taskId: string, filename: string): Promise<boolean> => {
      if (!taskId) return false;
      const response = await fetch(buildDownloadTaskFileUrl(taskId));
      if (!response.ok) {
          let detail = '';
          try {
              const data = await response.json();
              detail = data?.message || data?.error || data?.detail || '';
          } catch (_) { /* ignore */ }
          throw new Error(`task下载失败(${response.status})${detail ? `: ${detail}` : ''}`);
      }
      const blob = await response.blob();
      if (!blob || blob.size === 0) {
          throw new Error('task下载返回空文件');
      }
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
      return true;
  }, []);

  // 打开保存对话框
  const handleOpenSaveDialog = useCallback(() => {
    const defaultName = `flowgen-project-${new Date().toISOString().split('T')[0]}`;
    setSaveFileName((projectName || '').trim() || defaultName);
    const linked = projectJsonFileHandleRef.current?.name;
    setSaveFilePath(linked ? `将覆盖保存到：${linked}` : '');
    setShowSaveDialog(true);
  }, [projectName]);
  const closeSaveDialog = useCallback(() => {
    setShowSaveDialog(false);
    setPendingNewProjectAfterSave(false);
  }, []);

  const resetProjectCanvas = useCallback(() => {
    setNodes([]);
    setEdges([]);
    setStoryboardImages([]);
    setSelectedNodeId(null);
    setPreviewNode(null);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LAST_VIEWPORT_KEY);
    hasUnsavedManualChangesRef.current = false;
    setShowManualSaveReminder(false);
    projectJsonFileHandleRef.current = null;
    setSaveFilePath('');
  }, [setNodes, setEdges, setStoryboardImages]);

  const ensureProjectFileWritePermission = useCallback(async (handle: FileSystemFileHandle) => {
    try {
      const opts = { mode: 'readwrite' as const };
      const h = handle as FileSystemFileHandle & {
        queryPermission?: (o: { mode: 'readwrite' }) => Promise<PermissionState>;
        requestPermission?: (o: { mode: 'readwrite' }) => Promise<PermissionState>;
      };
      if (!h.queryPermission || !h.requestPermission) return true;
      const cur = await h.queryPermission(opts);
      if (cur === 'granted') return true;
      const req = await h.requestPermission(opts);
      return req === 'granted';
    } catch {
      return false;
    }
  }, []);

  const writeBlobToProjectFileHandle = useCallback(
    async (handle: FileSystemFileHandle, blob: Blob) => {
      if (!(await ensureProjectFileWritePermission(handle))) {
        throw new Error('没有写入该文件的权限');
      }
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
    },
    [ensureProjectFileWritePermission]
  );

  const finishManualProjectSave = useCallback(
    (fileName: string) => {
      lastManualSaveAtRef.current = Date.now();
      hasUnsavedManualChangesRef.current = false;
      setShowManualSaveReminder(false);
      setShowSaveDialog(false);
      onProjectNameChange?.(fileName.replace(/\.json$/i, ''));
      if (pendingNewProjectAfterSave) {
        resetProjectCanvas();
        setPendingNewProjectAfterSave(false);
      }
    },
    [onProjectNameChange, pendingNewProjectAfterSave, resetProjectCanvas]
  );

  // 手动保存工程（带自定义文件名和路径）
  const handleSaveProject = useCallback(async (opts?: { useLinkedFileOnly?: boolean }): Promise<boolean> => {
    try {
      const currentNodes = getNodes();
      const unfinished = currentNodes.filter((n) => n.data?.status === 'running');
      if (unfinished.length) {
        alert(`未完成：当前有 ${unfinished.length} 个节点正在生成中，无法保存工程。请等生成完成后再保存。`);
        setPendingNewProjectAfterSave(false);
        return false;
      }

      const dataToSave = {
        nodes: getNodes(),
        edges: getEdges(),
        storyboardImages: storyboardImages,
        savedAt: new Date().toISOString()
      };
      const jsonStr = JSON.stringify(dataToSave);
      const blob = new Blob([jsonStr], { type: 'application/json' });

      // 确保文件名有 .json 扩展名
      let fileName = saveFileName.trim();
      if (!fileName) {
        fileName = `flowgen-project-${new Date().toISOString().split('T')[0]}`;
      }
      if (!fileName.endsWith('.json')) {
        fileName += '.json';
      }

      const linkedHandle = projectJsonFileHandleRef.current;
      if (linkedHandle) {
        try {
          await writeBlobToProjectFileHandle(linkedHandle, blob);
          finishManualProjectSave(linkedHandle.name || fileName);
          alert(`✅ 工程已保存到原文件：${linkedHandle.name}`);
          return true;
        } catch (err) {
          if (opts?.useLinkedFileOnly) {
            alert(
              err instanceof Error
                ? `❌ 无法写回原文件：${err.message}\n请使用「保存」并重新选择保存位置。`
                : '❌ 无法写回原文件，请重新选择保存位置。'
            );
            setPendingNewProjectAfterSave(false);
            return false;
          }
        }
      } else if (opts?.useLinkedFileOnly) {
        setShowSaveDialog(true);
        return false;
      }

      // 尝试使用 File System Access API（现代浏览器，需要 HTTPS）
      if ('showSaveFilePicker' in window) {
        try {
          const fileHandle = await (window as any).showSaveFilePicker({
            suggestedName: fileName,
            types: [{
              description: 'JSON Files',
              accept: { 'application/json': ['.json'] }
            }]
          });
          
          await writeBlobToProjectFileHandle(fileHandle, blob);
          projectJsonFileHandleRef.current = fileHandle;
          setSaveFilePath(`将覆盖保存到：${fileHandle.name}`);
          finishManualProjectSave(fileHandle.name || fileName);
          alert('✅ 工程已保存到指定位置！下次保存将直接写回该文件。');
          return true;
        } catch (err: any) {
          // 用户取消选择，不显示错误
          if (err.name === 'AbortError') {
            setPendingNewProjectAfterSave(false);
            return false;
          }
        }
      }

      // 传统下载方式（用户可以在浏览器下载对话框中修改文件名和路径）
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      finishManualProjectSave(fileName);
      alert('✅ 工程已保存！请在浏览器下载对话框中确认保存位置。');
      return true;
    } catch (_error) {
      alert('❌ 保存工程失败，请重试或检查磁盘与浏览器权限');
      setPendingNewProjectAfterSave(false);
      return false;
    }
  }, [
    getNodes,
    getEdges,
    storyboardImages,
    saveFileName,
    finishManualProjectSave,
    writeBlobToProjectFileHandle,
  ]);

  const applyImportedProjectJson = useCallback(
    (parsed: { nodes?: RFNode[]; edges?: Edge[]; storyboardImages?: string[] }, sourceFileName: string) => {
      onProjectNameChange?.(sourceFileName.replace(/\.json$/i, ''));
      setSaveFileName(sourceFileName.replace(/\.json$/i, ''));

      try {
          
          // 获取当前节点和边
          const currentNodes = getNodes();
          const currentEdges = getEdges();
          const currentNodeIds = new Set(currentNodes.map(n => n.id));
          const currentEdgeIds = new Set(currentEdges.map(e => e.id));
          
          // 创建ID映射表（用于记录节点ID的变更）
          const nodeIdMap = new Map<string, string>();
          let adjustedNodes: RFNode[] = [];
          let finalNodes: RFNode[] = [];
          let finalEdges: Edge[] = [];
          
          // 处理节点：合并并处理ID冲突
          if (parsed.nodes && Array.isArray(parsed.nodes)) {
            const importedNodes = parsed.nodes.map((node: RFNode) => {
              // 如果节点ID冲突，生成新ID
              if (currentNodeIds.has(node.id)) {
                const newId = getId();
                nodeIdMap.set(node.id, newId); // 记录ID映射
                return { ...node, id: newId };
              }
              return node;
            });
            
            // 计算偏移量，将导入的节点放在右侧，避免重叠
            const currentMaxX = currentNodes.length > 0 
              ? Math.max(...currentNodes.map(n => n.position.x + (n.width || 200)))
              : 0;
            const offsetX = currentNodes.length > 0 ? currentMaxX + 100 : 0;
            
            // 调整导入节点的位置
            adjustedNodes = hydrateNodesImagePreviewFromPersisted(
              importedNodes.map((node: RFNode) => ({
                ...node,
                position: {
                  x: node.position.x + offsetX,
                  y: node.position.y
                }
              }))
            );
            
            // 构建最终节点列表（用于验证边的连接）
            finalNodes = [...currentNodes, ...adjustedNodes];
            
          } else {
            finalNodes = currentNodes;
          }
          
          // 处理边：合并并更新节点ID引用（在节点更新之前处理）
          if (parsed.edges && Array.isArray(parsed.edges)) {
            // 创建最终节点ID集合（用于快速查找）
            const finalNodeIds = new Set(finalNodes.map(n => n.id));
            
            
            const importedEdges = parsed.edges.map((edge: Edge) => {
              // 如果边ID冲突，生成新ID
              let newEdge = { ...edge };
              if (currentEdgeIds.has(edge.id)) {
                newEdge.id = `edge_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
              }
              
              // 更新节点ID引用（如果节点ID被更改了）
              const originalSource = edge.source;
              const originalTarget = edge.target;
              
              // 获取更新后的source和target ID
              const updatedSource = nodeIdMap.get(edge.source) || edge.source;
              const updatedTarget = nodeIdMap.get(edge.target) || edge.target;
              
              newEdge.source = updatedSource;
              newEdge.target = updatedTarget;
              
              // 检查边的源节点和目标节点是否都存在
              const sourceExists = finalNodeIds.has(updatedSource);
              const targetExists = finalNodeIds.has(updatedTarget);
              
              if (!sourceExists) {
                return null;
              }
              if (!targetExists) {
                return null;
              }
              
              return newEdge;
            }).filter((edge): edge is Edge => edge !== null);
            
            // 合并边
            finalEdges = [...currentEdges, ...importedEdges];
          } else {
            finalEdges = currentEdges;
          }
          
          // 一次性更新节点和边（确保同步）
          const mergedImported = mergeLegacyChainFolderNodesIntoRoots(finalNodes);
          const mediaHydratedImported = hydrateGraphMediaFromPersisted(mergedImported, finalEdges);
          const normalizedImportedNodes = normalizePersistedInputRowsWithFolders(
            mediaHydratedImported,
            finalEdges
          );
          // 处理故事板图片：合并并去重（须在持久化前算好）
          let mergedImages = storyboardImages;
          if (parsed.storyboardImages && Array.isArray(parsed.storyboardImages)) {
            const currentImages = storyboardImages;
            const importedImages = parsed.storyboardImages;
            // 合并并去重（基于URL或base64内容）
            mergedImages = [...currentImages];
            importedImages.forEach((img: string) => {
              if (!mergedImages.includes(img)) {
                mergedImages.push(img);
              }
            });
            setStoryboardImages(mergedImages);
          }

          const afterImportHydrateAndPersist = () => {
            hydratePersistedRemotePreviews();
            void hydrateLocalMediaPreviews();
          };

          if (adjustedNodes.length >= FLOW_LAZY_HYDRATION_NODE_THRESHOLD) {
            hydrateGraphWithLazyReveal(
              normalizedImportedNodes,
              finalEdges,
              adjustedNodes.map((n) => n.id),
              setNodes,
              setEdges,
              { onComplete: afterImportHydrateAndPersist }
            );
          } else {
            setNodes(normalizedImportedNodes);
            setEdges(finalEdges);
            afterImportHydrateAndPersist();
          }

          // 不依赖 React 提交时机：用已算好的图立即写入服务端，避免清空后导入仍保存空画布
          persistImportedGraphSnapshot(normalizedImportedNodes, finalEdges, mergedImages);
          
        const posHint =
          currentNodes.length > 0
            ? '已合并到当前工程（节点右移避免重叠），未覆盖现有内容。'
            : '已导入到画布，节点保持文件中的原始位置。';
        alert(
          `✅ 工程已导入！\n- 节点: ${parsed.nodes?.length || 0} 个\n- 边: ${parsed.edges?.length || 0} 条\n- 故事板图片: ${parsed.storyboardImages?.length || 0} 张\n\n${posHint}`
        );
      } catch {
        alert('❌ 加载工程失败，文件格式不正确');
      }
    },
    [
      getNodes,
      getEdges,
      setNodes,
      setEdges,
      setStoryboardImages,
      storyboardImages,
      onProjectNameChange,
      hydratePersistedRemotePreviews,
      hydrateLocalMediaPreviews,
      persistImportedGraphSnapshot,
    ]
  );

  // 加载工程文件（合并导入，不替换当前工程）
  const handleLoadProject = useCallback(async () => {
    if ('showOpenFilePicker' in window) {
      try {
        const [handle] = await (window as any).showOpenFilePicker({
          multiple: false,
          types: [
            {
              description: 'FlowGen 工程 JSON',
              accept: { 'application/json': ['.json'] },
            },
          ],
        });
        const file = await handle.getFile();
        projectJsonFileHandleRef.current = handle;
        setSaveFilePath(`将覆盖保存到：${handle.name}`);
        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            const content = ev.target?.result as string;
            const parsed = JSON.parse(content);
            applyImportedProjectJson(parsed, file.name);
          } catch {
            alert('❌ 加载工程失败，文件格式不正确');
          }
        };
        reader.readAsText(file);
        return;
      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'name' in err && (err as { name: string }).name === 'AbortError') {
          return;
        }
      }
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      projectJsonFileHandleRef.current = null;
      setSaveFilePath('（旧式选择无法记住路径，保存时请用 Chrome/Edge 重新「打开工程」或另存为）');
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const content = ev.target?.result as string;
          const parsed = JSON.parse(content);
          applyImportedProjectJson(parsed, file.name);
        } catch {
          alert('❌ 加载工程失败，文件格式不正确');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [applyImportedProjectJson]);

  useEffect(() => {
    onProjectActionsChange?.({
      openSaveDialog: handleOpenSaveDialog,
      quickSave: () => handleSaveProject({ useLinkedFileOnly: true }),
      loadProject: handleLoadProject,
      newProject: async () => {
        const nodeCount = getNodes().length;
        const edgeCount = getEdges().length;
        if (nodeCount === 0 && edgeCount === 0) {
          resetProjectCanvas();
          return;
        }

        const saveFirst = confirm(
          '当前画布有节点，是否先保存工程？\n\n点击「确定」：先保存再新建\n点击「取消」：不保存（下一步可确认是否继续新建）'
        );
        if (saveFirst) {
          setPendingNewProjectAfterSave(true);
          handleOpenSaveDialog();
          return;
        }

        const discardConfirmed = confirm('确定不保存并新建空白工程吗？当前画布将被清空且不可恢复。');
        if (!discardConfirmed) return;
        resetProjectCanvas();
      },
      canvasRefreshPaused: isCanvasRefreshPaused,
      canvasPerfAdvanced: isCanvasPerfAdvanced,
      toggleCanvasRefresh: toggleCanvasRefreshPaused,
      toggleCanvasPerfAdvanced,
    });
    return () => onProjectActionsChange?.(null);
  }, [
    onProjectActionsChange,
    handleOpenSaveDialog,
    handleSaveProject,
    handleLoadProject,
    getNodes,
    getEdges,
    resetProjectCanvas,
    isCanvasRefreshPaused,
    isCanvasPerfAdvanced,
    toggleCanvasRefreshPaused,
    toggleCanvasPerfAdvanced,
  ]);

  // 清除当前工程
  const handleClearProject = useCallback(() => {
    if (confirm('⚠️ 确定要清除当前工程吗？此操作不可恢复！')) {
      resetProjectCanvas();
      alert('✅ 工程已清除！');
    }
  }, [resetProjectCanvas]);

  const downloadNodePreviewMedia = useCallback(
    async (node: RFNode): Promise<void> => {
      const imagePreview = node.data?.imagePreview;
      if (!imagePreview) return;

      const filename = resolveNodeDownloadFilename(node.data, {
        nodeType: node.type,
        nodeId: node.id,
        imagePreview,
        urlFallback: imagePreview,
      });

      const nodeLabel =
        node.data.customName?.trim() || node.data.label?.trim() || node.id;

      const preferredUrl =
        resolvePreferredNodeDownloadUrl(node.data, node.type as NodeType) || imagePreview;

      const downloadFromUrl = async (urlForDownload: string): Promise<void> => {
        let url = urlForDownload;
        try {
          await downloadFile(url, filename);
        } catch {
          const retryUrl = await resolveFreshDownloadUrl(node);
          if (retryUrl && retryUrl !== url) {
            url = retryUrl;
          }
          await downloadFile(url, filename);
        }
      };

      // 优先下载节点已持久化的成品 URL（与画布预览一致），避免 task-status 返回 openApi 低分辨率链
      if (preferredUrl) {
        try {
          await downloadFromUrl(preferredUrl);
          return;
        } catch {
          /* 签名过期等再试 taskId / 刷新 URL */
        }
      }

      const latestTaskId = getLatestTaskIdFromNode(node);
      if (latestTaskId) {
        try {
          await downloadByTaskId(latestTaskId, filename);
          return;
        } catch {
          // task 接口暂无资源时，回退到节点预览 URL（与 CustomNode 卡片下载一致）
        }
      }

      try {
        await downloadFromUrl(preferredUrl);
      } catch {
        throw new Error(`链接可能已过期，请重新运行节点「${nodeLabel}」后再下载。`);
      }
    },
    [downloadFile, downloadByTaskId, getLatestTaskIdFromNode, resolveFreshDownloadUrl]
  );

  const handleDownloadSelected = useCallback(async () => {
    const selected = getNodes().filter((n) => n.selected);
    if (selected.length === 0) {
      alert('请先在画布上框选或单击选中要下载的节点。');
      return;
    }

    const targets = selected.filter((n) => n.data?.imagePreview);
    if (targets.length === 0) {
      alert('选中的节点中没有可下载的图片或视频。');
      return;
    }

    targets.sort((a, b) => {
      if (Math.abs(a.position.y - b.position.y) < 50) {
        return a.position.x - b.position.x;
      }
      return a.position.y - b.position.y;
    });

    const failures: string[] = [];
    for (let index = 0; index < targets.length; index++) {
      const node = targets[index];
      if (index > 0) {
        await new Promise((r) => setTimeout(r, 500));
      }
      try {
        await downloadNodePreviewMedia(node);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        failures.push(`${node.data.customName?.trim() || node.data.label || node.id}: ${msg}`);
      }
    }

    if (failures.length > 0) {
      alert(
        failures.length === targets.length
          ? `下载失败：\n${failures.join('\n')}`
          : `部分下载失败（${failures.length}/${targets.length}）：\n${failures.join('\n')}`
      );
    }
  }, [getNodes, downloadNodePreviewMedia]);

  // Derived Values for Preview Modal（与 Input Picture Node 一致：Output Mov / Output Picture 通过 generationParams 填充同一套字段）
  const previewParamsCore = previewNode ? (() => {
    const dedupeImageUrls = (arr: string[]) => {
      const seen = new Set<string>();
      return arr.filter((s) => {
        if (!s) return false;
        const isDataOrBlob = /^data:/i.test(s) || s.startsWith('blob:');
        const key = isDataOrBlob
          ? s
          : s.split('#')[0].split('?')[0].replace(/\/+$/, '').toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };
    /** 与 normalizeVideoUrlForDedupe 类似：去 query/hash 后比路径，避免「生成结果 URL」与快照里条目因参数不同未去重 */
    const normalizeImageUrlForDedupe = (url?: string): string => {
      if (!url) return '';
      const base = url.split('#')[0].split('?')[0];
      return base.replace(/\/+$/, '').toLowerCase();
    };
    const normalizeVideoUrlForDedupe = (url?: string): string => {
      if (!url) return '';
      const base = url.split('#')[0].split('?')[0];
      return base.replace(/\/+$/, '').toLowerCase();
    };
    const isLikelyImageUrl = (url?: string): boolean => {
      if (!url) return false;
      return /^data:image\//i.test(url) || /\.(png|jpe?g|webp|gif|bmp|svg)(\?|$)/i.test(url);
    };
    const isLikelyVideoUrl = (url?: string): boolean => {
      if (!url) return false;
      /** 带明确图片扩展名的 URL 不当视频，避免 CDN 路径含 video 字样误杀首帧图 */
      if (isLikelyImageUrl(url)) return false;
      return (
        /\.(mov|mp4|webm|avi|mkv|flv|wmv|m4v)(\?|$)/i.test(url) ||
        url.startsWith('blob:') ||
        /video/i.test(url) ||
        /kechuangai\.com\/ksc2\//i.test(url)
      );
    };
    /** Node Details 参考图列表：blob 常为本地预览图；无扩展名 CDN 图不应仅因路径含 video 被剔除 */
    const isLikelyVideoUrlStrictForRefPanel = (url: string): boolean => {
      if (!url) return true;
      if (isLikelyImageUrl(url)) return false;
      if (url.startsWith('blob:')) return false;
      return (
        /\.(mov|mp4|webm|avi|mkv|flv|wmv|m4v)(\?|$)/i.test(url) ||
        /kechuangai\.com\/ksc2\//i.test(url)
      );
    };
    /** 合并参考视频：按规范化 URL 去重；并合并「同文件名 blob: 与 https:」视为同一条，避免列表里出现两条 */
    const videoFilenameKey = (url: string): string => {
      try {
        const u = url.split('?')[0].split('#')[0];
        const seg = u.split('/').filter(Boolean).pop() || '';
        return seg.toLowerCase();
      } catch {
        return '';
      }
    };
    const isCosLikeVideoHost = (u: string) =>
      u.includes('aitop100app-') || u.includes('myqcloud.com') || /cos\.ap-/i.test(u);
    const isKechuangaiVideoHost = (u: string) => u.includes('kechuangai.com');

    const uuidSetFromUrl = (url: string): Set<string> => {
      const m = url.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi);
      return new Set((m || []).map((x) => x.toLowerCase()));
    };
    /** 判断参考图 URL 是否与「输出节点左侧预览」为同一资源（签名/CDN 参数不同也算同一） */
    const isSameImageOutputAsset = (refUrl: string, outputUrl: string): boolean => {
      if (!refUrl || !outputUrl) return false;
      if (refUrl === outputUrl) return true;
      const na = normalizeImageUrlForDedupe(refUrl);
      const nb = normalizeImageUrlForDedupe(outputUrl);
      if (na && nb && na === nb) return true;
      const Sa = uuidSetFromUrl(refUrl);
      const Sb = uuidSetFromUrl(outputUrl);
      for (const u of Sa) {
        if (Sb.has(u)) return true;
        if (outputUrl.toLowerCase().includes(u)) return true;
      }
      for (const u of Sb) {
        if (Sa.has(u)) return true;
        if (refUrl.toLowerCase().includes(u)) return true;
      }
      return false;
    };
    /** 是否视为同一参考视频：去 query 后路径相同 / 共享 UUID / 一条 URL 包含另一条中的 UUID（COS 与 CDN 镜像常见） */
    const isSameReferenceVideoAsset = (a: string, b: string): boolean => {
      const na = normalizeVideoUrlForDedupe(a);
      const nb = normalizeVideoUrlForDedupe(b);
      if (na && nb && na === nb) return true;
      const Sa = uuidSetFromUrl(a);
      const Sb = uuidSetFromUrl(b);
      for (const u of Sa) {
        if (Sb.has(u)) return true;
        if (b.includes(u)) return true;
      }
      for (const u of Sb) {
        if (Sa.has(u)) return true;
        if (a.includes(u)) return true;
      }
      return false;
    };
    const preferReferenceVideoUrl = (a: string, b: string): string => {
      if (a === b) return a;
      if (a.startsWith('blob:') && !b.startsWith('blob:')) return b;
      if (b.startsWith('blob:') && !a.startsWith('blob:')) return a;
      if (isCosLikeVideoHost(a) && !isCosLikeVideoHost(b)) return a;
      if (isCosLikeVideoHost(b) && !isCosLikeVideoHost(a)) return b;
      return a;
    };

    const dedupeReferenceMovsByUrl = (
      movs: Array<{ url: string; posterDataUrl?: string }>
    ): Array<{ url: string; posterDataUrl?: string }> => {
      const list = movs.filter((m) => m?.url).map((m) => ({
        url: m.url,
        posterDataUrl: m.posterDataUrl,
      }));
      if (list.length <= 1) return list;

      const out: Array<{ url: string; posterDataUrl?: string }> = [];
      for (const m of list) {
        let mergedIdx = -1;
        for (let i = 0; i < out.length; i++) {
          if (isSameReferenceVideoAsset(out[i].url, m.url)) {
            mergedIdx = i;
            break;
          }
        }
        if (mergedIdx >= 0) {
          const ex = out[mergedIdx];
          out[mergedIdx] = {
            url: preferReferenceVideoUrl(ex.url, m.url),
            posterDataUrl: ex.posterDataUrl || m.posterDataUrl,
          };
        } else {
          let blobMerged = false;
          const fk = videoFilenameKey(m.url);
          if (fk.length > 2) {
            for (let i = 0; i < out.length; i++) {
              const ex = out[i];
              if (videoFilenameKey(ex.url) !== fk) continue;
              const nextUrl =
                ex.url.startsWith('blob:') && !m.url.startsWith('blob:')
                  ? m.url
                  : m.url.startsWith('blob:') && !ex.url.startsWith('blob:')
                    ? ex.url
                    : ex.url;
              out[i] = { url: nextUrl, posterDataUrl: m.posterDataUrl || ex.posterDataUrl };
              blobMerged = true;
              break;
            }
          }
          if (!blobMerged) out.push({ ...m });
        }
      }

      if (out.length === 2) {
        const u0 = out[0].url;
        const u1 = out[1].url;
        if (
          (isCosLikeVideoHost(u0) && isKechuangaiVideoHost(u1)) ||
          (isCosLikeVideoHost(u1) && isKechuangaiVideoHost(u0))
        ) {
          return [
            {
              url: isCosLikeVideoHost(u0) ? u0 : u1,
              posterDataUrl: out[0].posterDataUrl || out[1].posterDataUrl,
            },
          ];
        }
      }
      return out;
    };
    const gp = previewNode.data.generationParams;
    const modelStr = (() => {
      const snap = gp?.model;
      const fromSnap = typeof snap === 'string' && snap.trim() ? snap.trim() : '';
      return fromSnap || (previewNode.data.selectedModel || '').trim();
    })();
    const isOmniModel = modelStr === '可灵3.0 Omni';

    // 输出节点补齐：从最近上游 INPUT/PROCESSOR 继承 Tab / 首尾帧 / 参考视频（须在 omniTab 与 merge 之前）
    const resolveNearestInputAncestorData = (): Partial<NodeData> | null => {
      if (previewNode.type !== NodeType.MOV && previewNode.type !== NodeType.OUTPUT) return null;
      const allNodes = getNodes();
      const allEdges = getEdges();
      const byId = new Map(allNodes.map((n) => [n.id, n]));
      const previewTaskId = String(
        previewNode.data.taskId || previewNode.data.generationParams?.taskId || ''
      ).trim();
      /** MOV 由同 task 的 OUTPUT/PROCESSOR 派生：Omni 面板槽在直接上游，不在更远的 INPUT */
      const directIncoming = allEdges
        .filter((e) => e.target === previewNode.id)
        .map((e) => e.source);
      for (const pid of directIncoming) {
        const p = byId.get(pid);
        if (!p) continue;
        if (
          p.type !== NodeType.OUTPUT &&
          p.type !== NodeType.PROCESSOR &&
          p.type !== NodeType.INPUT
        ) {
          continue;
        }
        const pTask = String(p.data?.taskId || p.data?.generationParams?.taskId || '').trim();
        if (previewTaskId && pTask === previewTaskId) {
          return (p.data || {}) as Partial<NodeData>;
        }
      }
      const q: string[] = [previewNode.id];
      const seen = new Set<string>();
      while (q.length) {
        const id = q.shift()!;
        if (seen.has(id)) continue;
        seen.add(id);
        const incoming = allEdges.filter((e) => e.target === id).map((e) => e.source);
        for (const pid of incoming) {
          const p = byId.get(pid);
          if (!p) continue;
          if (p.type === NodeType.INPUT || p.type === NodeType.PROCESSOR) {
            return (p.data || {}) as Partial<NodeData>;
          }
          q.push(pid);
        }
      }
      return null;
    };
    const ancestorData = resolveNearestInputAncestorData();
    const isOutputLikeForDetails =
      previewNode.type === NodeType.MOV || previewNode.type === NodeType.OUTPUT;
    const upstreamGp = (ancestorData?.generationParams || {}) as GenerationParams;
    const omniTab = (() => {
      const fromGp = (gp as GenerationParams & { klingOmniTab?: string })?.klingOmniTab;
      if (
        isOutputLikeForDetails &&
        typeof fromGp === 'string' &&
        fromGp.trim() &&
        (fromGp === 'multi' || fromGp === 'instruction' || fromGp === 'video' || fromGp === 'frames')
      ) {
        return fromGp as 'multi' | 'instruction' | 'video' | 'frames';
      }
      return (previewNode.data.klingOmniTab ??
        fromGp ??
        ancestorData?.klingOmniTab ??
        'multi') as 'multi' | 'instruction' | 'video' | 'frames';
    })();

    /** Node Details「Reference Images」：排除视频截帧 poster、视频 URL、与参考视频同源的条目 */
    const refImageExcludeVideoPosters = (() => {
      const drop = new Set<string>();
      const d = previewNode.data as any;
      const g = gp as any;
      if (typeof d.videoPosterDataUrl === 'string' && d.videoPosterDataUrl.length > 0) {
        drop.add(d.videoPosterDataUrl);
      }
      if (typeof g?.videoPosterDataUrl === 'string' && g.videoPosterDataUrl.length > 0) {
        drop.add(g.videoPosterDataUrl);
      }
      const movs = [
        ...(Array.isArray(d.referenceMovs) ? d.referenceMovs : []),
        ...(Array.isArray(g?.referenceMovs) ? g.referenceMovs : []),
      ];
      for (const m of movs) {
        if (m?.posterDataUrl) drop.add(m.posterDataUrl);
      }
      return drop;
    })();
    /** 本次运行 generationParams 中的参考图：poster 若与首张参考图相同，仍须在 Node Details 中展示 */
    const runSnapshotRefImageKeys = (() => {
      const keys = new Set<string>();
      const add = (u?: string) => {
        if (!u) return;
        keys.add(u);
        const k = normalizeImageUrlForDedupe(u);
        if (k) keys.add(k);
      };
      for (const u of Array.isArray(gp?.referenceImages) ? gp!.referenceImages! : []) {
        add(String(u));
      }
      return keys;
    })();
    const isRunSnapshotReferenceImage = (u: string): boolean => {
      if (!u) return false;
      if (runSnapshotRefImageKeys.has(u)) return true;
      const k = normalizeImageUrlForDedupe(u);
      return Boolean(k && runSnapshotRefImageKeys.has(k));
    };
    /** 参考视频 URL 规范化集合：误写入 referenceImages 的同一视频 URL 也剔除 */
    const refVideoNormKeysFromMovs = (() => {
      const d = previewNode.data as any;
      const g = gp as any;
      const s = new Set<string>();
      const addU = (u?: string) => {
        if (u && typeof u === 'string') {
          const k = normalizeVideoUrlForDedupe(u);
          if (k) s.add(k);
        }
      };
      for (const m of [
        ...(Array.isArray(d.referenceMovs) ? d.referenceMovs : []),
        ...(Array.isArray(g?.referenceMovs) ? g.referenceMovs : []),
        ...(Array.isArray(ancestorData?.referenceMovs) ? ancestorData!.referenceMovs! : []),
        ...(Array.isArray((ancestorData as any)?.seedanceTabConfigs?.reference?.referenceMovs)
          ? (ancestorData as any).seedanceTabConfigs.reference.referenceMovs
          : []),
      ]) {
        addU(m?.url);
      }
      addU(d.klingOmniVideoUrl);
      addU(d.klingOmniVideoPreviewUrl);
      addU(d.klingOmniInstructionVideoUrl);
      addU(d.klingOmniInstructionVideoPreviewUrl);
      addU(g?.klingOmniVideoUrl);
      addU(g?.klingOmniVideoPreviewUrl);
      addU(g?.klingOmniInstructionVideoUrl);
      addU(g?.klingOmniInstructionVideoPreviewUrl);
      return s;
    })();
    const sanitizeModelName = (
      ((previewNode.data.generationParams as any)?.model as string | undefined) ||
      previewNode.data.selectedModel ||
      ''
    ).trim();
    const isVideoModelForRefSanitize =
      previewNode.type === NodeType.MOV ||
      sanitizeModelName.includes('可灵') ||
      sanitizeModelName.includes('Keling') ||
      sanitizeModelName === 'vidu 2.0' ||
      ['seedance1.5-pro', 'seedance2.0 (高质量版)', 'seedance2.0 (急速版)', '即梦3.0 Pro'].includes(
        sanitizeModelName
      );
    /** 视频截帧多为 canvas 导出的 JPEG data URL，易混入 referenceImages 快照；仅视频链路做该过滤，避免误伤 image 2 本地参考图 */
    const isLikelyVideoCaptureDataUrl = (u: string): boolean => {
      if (!isVideoModelForRefSanitize) return false;
      if (!u.startsWith('data:image/jpeg') && !u.startsWith('data:image/jpg')) return false;
      return u.length > 48_000;
    };
    const mainPreviewForRefSanitize = String(previewNode.data.imagePreview || '').trim();
    const sanitizeRefImagesForDetails = (urls: string[]): string[] =>
      urls.filter((u) => {
        if (!u) return false;
        if (mainPreviewForRefSanitize && u === mainPreviewForRefSanitize) return true;
        if (refImageExcludeVideoPosters.has(u) && !isRunSnapshotReferenceImage(u)) return false;
        if (isLikelyVideoUrlStrictForRefPanel(u)) return false;
        if (isLikelyVideoCaptureDataUrl(u)) return false;
        const nk = normalizeVideoUrlForDedupe(u);
        if (nk && refVideoNormKeysFromMovs.has(nk)) return false;
        return true;
      });

    /** 合并参考图 URL：可灵3.0 Omni 按当前 tab 只取对应槽位；勿合并 gp.referenceImages（含运行快照里的视频截帧/混表）除非该 tab 面板无数据需兜底 */
    const mergeReferenceImagesSources = (): string[] => {
      if (isOmniModel) {
        const d = previewNode.data as any;
        const g = gp as any;
        if (omniTab === 'instruction') {
          const da = Array.isArray(d.klingOmniInstructionReferenceImages)
            ? d.klingOmniInstructionReferenceImages
            : [];
          if (da.length > 0) return dedupeImageUrls(da.filter(Boolean));
          const gb = Array.isArray(g?.referenceImages) ? g.referenceImages : [];
          return sanitizeRefImagesForDetails(dedupeImageUrls(gb.filter(Boolean)));
        }
        if (omniTab === 'video') {
          const da = Array.isArray(d.klingOmniVideoReferenceImages) ? d.klingOmniVideoReferenceImages : [];
          if (da.length > 0) return dedupeImageUrls(da.filter(Boolean));
          const gb = Array.isArray(g?.referenceImages) ? g.referenceImages : [];
          return sanitizeRefImagesForDetails(dedupeImageUrls(gb.filter(Boolean)));
        }
        if (omniTab === 'multi') {
          const outUrl = String(previewNode.data.imagePreview || '').trim();
          const refs = mergeOmniMultiTabReferenceImagesForDetails({
            nodeData: previewNode.data,
            generationParams: gp as GenerationParams,
            ancestorData: ancestorData ?? undefined,
            isOutputLike: isOutputLikeForDetails,
            isRunSnapshotRef: isRunSnapshotReferenceImage,
            isSameAsOutput: (ref, out) =>
              outUrl && !isLikelyVideoUrl(outUrl) ? isSameImageOutputAsset(ref, out) : false,
            outputImagePreview:
              isOutputLikeForDetails && isLikelyVideoUrl(previewNode.data.imagePreview)
                ? undefined
                : previewNode.data.imagePreview,
          });
          return sanitizeRefImagesForDetails(refs);
        }
        // 首尾帧：只展示首/尾帧图，不合并整份 referenceImages（避免混入截帧与其它 tab 残留）
        const ff =
          d.firstFrameImageUrl ||
          d.firstFrameImage ||
          g?.firstFrameImageUrl ||
          g?.firstFrameImage ||
          ancestorData?.firstFrameImageUrl ||
          ancestorData?.firstFrameImage;
        const lf =
          d.lastFrameImageUrl ||
          d.lastFrameImage ||
          g?.lastFrameImageUrl ||
          g?.lastFrameImage ||
          ancestorData?.lastFrameImageUrl ||
          ancestorData?.lastFrameImage;
        // frames tab keeps first/last slot semantics; do not dedupe here.
        return sanitizeRefImagesForDetails([ff, lf].filter(Boolean));
      }
      const seedanceImageMode =
        ['seedance1.5-pro', 'seedance2.0 (高质量版)', 'seedance2.0 (急速版)'].includes(
          sanitizeModelName
        ) &&
        ((previewNode.data.seedanceGenerationMode ??
          (gp as GenerationParams)?.seedanceGenerationMode ??
          'text') as string) === 'image';
      if (seedanceImageMode) {
        const d = previewNode.data;
        const g = gp as GenerationParams;
        const tab = d.seedanceTabConfigs?.image;
        const ff =
          g?.firstFrameImageUrl ||
          g?.firstFrameImage ||
          d.firstFrameImageUrl ||
          d.firstFrameImage ||
          tab?.firstFrameImageUrl ||
          tab?.firstFrameImage ||
          ancestorData?.firstFrameImageUrl ||
          ancestorData?.firstFrameImage;
        const lf =
          g?.lastFrameImageUrl ||
          g?.lastFrameImage ||
          d.lastFrameImageUrl ||
          d.lastFrameImage ||
          tab?.lastFrameImageUrl ||
          tab?.lastFrameImage ||
          ancestorData?.lastFrameImageUrl ||
          ancestorData?.lastFrameImage;
        return sanitizeRefImagesForDetails([ff, lf].filter(Boolean) as string[]);
      }
      const a = previewNode.data.referenceImages;
      const b = previewNode.data.generationParams?.referenceImages;
      const ancRefs = Array.isArray(ancestorData?.referenceImages) ? ancestorData!.referenceImages! : [];
      const listA = Array.isArray(a) ? a : [];
      const listB = Array.isArray(b) ? b : [];
      let merged = isOutputLikeForDetails
        ? dedupeImageUrls([...listB, ...ancRefs, ...listA].filter(Boolean))
        : dedupeImageUrls([...listA, ...listB].filter(Boolean));
      if (isImage2Model(sanitizeModelName)) {
        const mainPrev = previewNode.data.imagePreview;
        merged = merged.filter(
          (u) =>
            !u.startsWith('blob:') &&
            !/^data:/i.test(u) &&
            !isDuplicateOfMainImagePreview(u, mainPrev)
        );
      }
      // 生图 OUTPUT：左侧 imagePreview 即本次生成结果，不应出现在「参考图」列表（与可灵/即梦输出节点规则一致）
      if (previewNode.type === NodeType.OUTPUT && previewNode.data.imagePreview) {
        const out = previewNode.data.imagePreview;
        return merged.filter(
          (u) => isRunSnapshotReferenceImage(u) || !isSameImageOutputAsset(u, out)
        );
      }
      return sanitizeRefImagesForDetails(merged);
    };
    /** 合并参考视频：Omni 在 instruction/video 下仅本 tab 语义；首尾帧 tab 不展示参考视频（与官方「首尾帧生视频不用视频编辑」一致） */
    const mergeReferenceMovsSources = (): Array<{ url: string; posterDataUrl?: string }> => {
      if (isOmniModel) {
        const d = previewNode.data as any;
        const g = gp as any;
        if (omniTab === 'frames') {
          return [];
        }
        if (omniTab === 'instruction' || omniTab === 'video') {
          const tab = omniTab;
          const outputResultUrl = previewNode.data.imagePreview;
          const preferredVid =
            tab === 'instruction'
              ? d.klingOmniInstructionVideoUrl || d.klingOmniInstructionVideoPreviewUrl
              : d.klingOmniVideoUrl || d.klingOmniVideoPreviewUrl;
          const preferredVidSafe =
            preferredVid && outputResultUrl && isSameReferenceVideoAsset(preferredVid, outputResultUrl)
              ? undefined
              : preferredVid;

          // 展示策略：instruction/video 下只展示 1 条“主参考视频”
          // - 优先 tab 槽位（UI 当前选择/上传结果）
          // - 否则退化为快照 referenceMovs 的第一条（避免历史堆积显示成 2/3 条）
          const snapListRaw: Array<{ url: string; posterDataUrl?: string }> =
            Array.isArray(g?.referenceMovs) && g.referenceMovs.length > 0 && g.klingOmniTab === tab
              ? g.referenceMovs.map((m: { url: string; posterDataUrl?: string }) => ({
                  url: m.url,
                  posterDataUrl: m.posterDataUrl,
                }))
              : [];

          const isOutputLikeOmni =
            previewNode.type === NodeType.MOV || previewNode.type === NodeType.OUTPUT;
          const posterForOmniRefVideo = (videoUrl: string): string | undefined =>
            pickReferenceMovPoster(
              videoUrl,
              snapListRaw.find((m) => isSameReferenceVideoAsset(m.url, videoUrl))?.posterDataUrl,
              ...(!isOutputLikeOmni ? [d.videoPosterDataUrl, g?.videoPosterDataUrl] : [])
            );
          const deduped = dedupeReferenceMovsByUrl([
            ...(preferredVidSafe
              ? [
                  {
                    url: preferredVidSafe,
                    posterDataUrl: posterForOmniRefVideo(preferredVidSafe),
                  },
                ]
              : []),
            ...snapListRaw.map((m) => ({
              url: m.url,
              posterDataUrl: posterForOmniRefVideo(m.url) || pickReferenceMovPoster(m.url, m.posterDataUrl),
            })),
          ]);

          if (deduped.length <= 1) return deduped;

          if (preferredVidSafe) {
            const same = deduped.find((m) => isSameReferenceVideoAsset(m.url, preferredVidSafe));
            if (same) return [same];
          }
          return [deduped[0]];
        }
        const listA = Array.isArray(d.referenceMovs) ? d.referenceMovs : [];
        const listB = Array.isArray(g?.referenceMovs) ? g.referenceMovs : [];
        return dedupeReferenceMovsByUrl([...listA, ...listB]);
      }
      const a = (previewNode.data as any)?.referenceMovs;
      const b = (previewNode.data.generationParams as any)?.referenceMovs;
      const listA = Array.isArray(a) ? a : [];
      const listB = Array.isArray(b) ? b : [];
      const d = previewNode.data as any;
      const g = (previewNode.data.generationParams as any) || {};
      const outputResultUrlForRefMovs = String(previewNode.data.imagePreview || '').trim();
      const isOutputLikeForRefMovs =
        previewNode.type === NodeType.MOV || previewNode.type === NodeType.OUTPUT;
      const scrubGeneratedResultFromRefMovs = (
        items: Array<{ url: string; posterDataUrl?: string }>
      ): Array<{ url: string; posterDataUrl?: string }> => {
        if (!isOutputLikeForRefMovs || !outputResultUrlForRefMovs) return items;
        return items.filter(
          (m) => m?.url && !isSameReferenceVideoAsset(m.url, outputResultUrlForRefMovs)
        );
      };
      const fromDataSeedanceTab =
        d.seedanceTabConfigs &&
        d.seedanceTabConfigs.reference &&
        Array.isArray(d.seedanceTabConfigs.reference.referenceMovs)
          ? (d.seedanceTabConfigs.reference.referenceMovs as Array<{ url: string; posterDataUrl?: string }>)
          : [];
      const fromGpSeedanceTab =
        g.seedanceTabConfigs &&
        g.seedanceTabConfigs.reference &&
        Array.isArray(g.seedanceTabConfigs.reference.referenceMovs)
          ? (g.seedanceTabConfigs.reference.referenceMovs as Array<{ url: string; posterDataUrl?: string }>)
          : [];
      const mergedLists = [
        ...scrubGeneratedResultFromRefMovs(listA),
        ...scrubGeneratedResultFromRefMovs(listB),
        ...scrubGeneratedResultFromRefMovs(fromDataSeedanceTab),
        ...scrubGeneratedResultFromRefMovs(fromGpSeedanceTab),
      ];
      // 与 handleNodeRun 里构建 generationParams.referenceMovs 的策略对齐：INPUT/PROCESSOR 在「参考生视频」下，
      // 参考视频可能仅存在于主预览（视频）或上游 MOV/OUTPUT 链，未写入 referenceMovs；输出节点需从上游回填。
      const modelForSeedanceRef = String(g?.model || d?.selectedModel || '').trim();
      const seedanceGenMode = String(d.seedanceGenerationMode || g.seedanceGenerationMode || 'text');
      const isSeedance20RefDetails =
        (modelForSeedanceRef === 'seedance2.0 (高质量版)' || modelForSeedanceRef === 'seedance2.0 (急速版)') &&
        seedanceGenMode === 'reference';
      const isDetailsRunLikeNode =
        previewNode.type === NodeType.INPUT || previewNode.type === NodeType.PROCESSOR;
      if (isSeedance20RefDetails) {
        // 输出节点：仅以本次运行 generationParams.referenceMovs 为准（纯图参考生勿回填上游/生成链路视频）
        if (isOutputLikeForRefMovs) {
          return dedupeReferenceMovsByUrl(
            seedanceReferenceMovsForOutputDetails(g?.referenceMovs, outputResultUrlForRefMovs)
          );
        }
        const anc = ancestorData as Partial<NodeData> & {
          seedanceTabConfigs?: { reference?: { referenceMovs?: Array<{ url: string; posterDataUrl?: string }> } };
        };
        if (anc?.referenceMovs?.length) mergedLists.push(...scrubGeneratedResultFromRefMovs(anc.referenceMovs));
        if (anc?.seedanceTabConfigs?.reference?.referenceMovs?.length) {
          mergedLists.push(
            ...scrubGeneratedResultFromRefMovs(anc.seedanceTabConfigs.reference.referenceMovs)
          );
        }
        if (isDetailsRunLikeNode) {
          const mainPrev = String(d.imagePreview || '').trim();
          if (mainPrev && isLikelyVideoUrl(mainPrev)) {
            mergedLists.push({ url: mainPrev, posterDataUrl: d.videoPosterDataUrl });
          }
          const upstreamVid = findUpstreamVideoUrlForProcessorNode(previewNode.id, getNodes, getEdges);
          if (upstreamVid) mergedLists.push({ url: upstreamVid });
        }
      }
      // Seedance 原始节点偶发只在 tab 快照里保留 referenceMovs（顶层为 []），这里统一回填，确保 Node Details 与面板一致。
      return dedupeReferenceMovsByUrl(mergedLists);
    };
    const mergedRefImagesRaw = sanitizeRefImagesForDetails(mergeReferenceImagesSources());
    /** 输出节点优先按“本次生成快照 referenceImages”回排，避免合并/去重后顺序漂移 */
    const mergedRefImagesOrdered = (() => {
      const base = mergedRefImagesRaw;
      const isOutputLike = previewNode.type === NodeType.MOV || previewNode.type === NodeType.OUTPUT;
      const gpRefs = Array.isArray(gp?.referenceImages) ? gp!.referenceImages!.filter(Boolean) : [];
      if (!isOutputLike || gpRefs.length === 0 || base.length <= 1) return base;

      const used = new Set<number>();
      const out: string[] = [];
      const pickBySnapshotUrl = (u: string): string | undefined => {
        const nu = normalizeImageUrlForDedupe(u);
        if (!nu) return undefined;
        const idx = base.findIndex((b, i) => !used.has(i) && normalizeImageUrlForDedupe(b) === nu);
        if (idx >= 0) {
          used.add(idx);
          return base[idx];
        }
        return undefined;
      };

      for (const u of gpRefs) {
        const picked = pickBySnapshotUrl(String(u));
        if (picked) out.push(picked);
      }
      const gpOmniMulti =
        isOutputLike &&
        isOmniModel &&
        String(
          (gp as GenerationParams & { klingOmniTab?: string })?.klingOmniTab ??
            previewNode.data.klingOmniTab ??
            'multi'
        ) === 'multi';
      base.forEach((u, i) => {
        if (!used.has(i)) {
          if (gpOmniMulti && !isRunSnapshotReferenceImage(u)) return;
          out.push(u);
        }
      });
      return sanitizeDetailsReferenceImageUrls(out);
    })();
    const mergedRefMovsRaw = dedupeReferenceMovsByUrl(mergeReferenceMovsSources());

    const resolveOmniPromptForPreview = (): { prompt: string; negativePrompt: string } => {
      const d = previewNode.data as any;
      const g = gp as any;
      const pickNonEmpty = (...vals: Array<string | undefined>): string => {
        for (const v of vals) {
          if (typeof v === 'string' && v.trim().length > 0) return v;
        }
        return '';
      };
      if (!isOmniModel) {
        if (isOutputLikeForDetails) {
          return {
            prompt: pickNonEmpty(
              g?.prompt,
              ancestorData?.prompt,
              upstreamGp.prompt as string | undefined
            ),
            negativePrompt: pickNonEmpty(
              g?.negativePrompt,
              ancestorData?.negativePrompt,
              upstreamGp.negativePrompt as string | undefined
            ),
          };
        }
        return {
          prompt: pickNonEmpty(g?.prompt, previewNode.data.prompt),
          negativePrompt: pickNonEmpty(g?.negativePrompt, previewNode.data.negativePrompt),
        };
      }
      const promptFromTab = () => {
        if (omniTab === 'multi') return d.klingOmniMultiPrompt ?? d.prompt ?? '';
        if (omniTab === 'instruction') return d.klingOmniInstructionPrompt ?? d.prompt ?? '';
        if (omniTab === 'video') return d.klingOmniVideoPrompt ?? d.prompt ?? '';
        return d.klingOmniFramesPrompt ?? d.prompt ?? '';
      };
      const negFromTab = () => {
        if (omniTab === 'multi') return d.klingOmniMultiNegativePrompt ?? d.negativePrompt ?? '';
        if (omniTab === 'instruction') return d.klingOmniInstructionNegativePrompt ?? d.negativePrompt ?? '';
        if (omniTab === 'video') return d.klingOmniVideoNegativePrompt ?? d.negativePrompt ?? '';
        return d.klingOmniFramesNegativePrompt ?? d.negativePrompt ?? '';
      };
      return {
        prompt: pickNonEmpty(g?.prompt, promptFromTab()),
        negativePrompt: pickNonEmpty(g?.negativePrompt, negFromTab()),
      };
    };
    const { prompt: resolvedPreviewPrompt, negativePrompt: resolvedPreviewNeg } = resolveOmniPromptForPreview();

    const omitFirstFrameForRefVideoPreview = hasReferenceInputVideos(mergedRefMovsRaw.length);

    const runGp = (gp || {}) as GenerationParams;
    const hasDetailValue = (v: unknown): boolean =>
      v !== undefined && v !== null && !(typeof v === 'string' && !v.trim());
    /** 输出节点 Used Parameters：本次运行快照 → 上游运行节点 → 输出节点自身（selectedModel 常为下一步默认） */
    const pickNodeDetailsParam = <T,>(key: keyof NodeData & keyof GenerationParams): T | undefined => {
      const fromRun = runGp[key as keyof GenerationParams] as T | undefined;
      const fromUpstreamGp = upstreamGp[key as keyof GenerationParams] as T | undefined;
      const fromUpstream = ancestorData?.[key as keyof NodeData] as T | undefined;
      const fromSelf = previewNode.data[key as keyof NodeData] as T | undefined;
      if (isOutputLikeForDetails) {
        if (hasDetailValue(fromRun)) return fromRun;
        if (hasDetailValue(fromUpstreamGp)) return fromUpstreamGp;
        if (hasDetailValue(fromUpstream)) return fromUpstream;
        return hasDetailValue(fromSelf) ? fromSelf : undefined;
      }
      if (hasDetailValue(fromSelf)) return fromSelf;
      if (hasDetailValue(fromRun)) return fromRun;
      return hasDetailValue(fromUpstream) ? fromUpstream : undefined;
    };

    // 统一数据源：输出节点以 generationParams + 上游为准；运行节点以当前 data 为准
    const baseParams = {
      ...previewNode.data,
      ...(gp || {}),
      prompt: resolvedPreviewPrompt,
      negativePrompt: resolvedPreviewNeg,
      referenceImages: mergedRefImagesOrdered,
      referenceMovs: mergedRefMovsRaw,
      firstFrameImage: omitFirstFrameForRefVideoPreview
        ? undefined
        : pickNodeDetailsParam<string>('firstFrameImage') ??
          ancestorData?.imagePreview,
      lastFrameImage: omitFirstFrameForRefVideoPreview
        ? undefined
        : pickNodeDetailsParam<string>('lastFrameImage'),
      firstFrameImageUrl: omitFirstFrameForRefVideoPreview
        ? undefined
        : pickNodeDetailsParam<string>('firstFrameImageUrl'),
      lastFrameImageUrl: omitFirstFrameForRefVideoPreview
        ? undefined
        : pickNodeDetailsParam<string>('lastFrameImageUrl'),
      jimengImages:
        pickNodeDetailsParam<string[]>('jimengImages') ??
        (isOutputLikeForDetails ? undefined : previewNode.data.jimengImages),
      aspectRatio: pickNodeDetailsParam<string>('aspectRatio') || '1:1',
      resolution: pickNodeDetailsParam<string>('resolution') || '1K',
      numberOfImages: pickNodeDetailsParam<string>('numberOfImages') || '1张',
      model: (() => {
        const snap = previewNode.data.generationParams?.model;
        const fromSnap = typeof snap === 'string' && snap.trim() ? snap.trim() : '';
        if (fromSnap) return fromSnap;
        const fromUp = typeof upstreamGp.model === 'string' && upstreamGp.model.trim() ? upstreamGp.model.trim() : '';
        if (isOutputLikeForDetails && fromUp) return fromUp;
        const fromSel = (previewNode.data.selectedModel || '').trim();
        return fromSel || MODEL_NANO_BANANA_2;
      })(),
      quality: pickNodeDetailsParam<string>('quality'),
      duration: pickNodeDetailsParam<string>('duration'),
      creativityLevel: pickNodeDetailsParam<number>('creativityLevel'),
      jimengResolution: pickNodeDetailsParam<string>('jimengResolution'),
      jimengVideoRatio: pickNodeDetailsParam<string>('jimengVideoRatio'),
      jimengGenerationMode: pickNodeDetailsParam<'text' | 'image'>('jimengGenerationMode'),
      viduDuration: pickNodeDetailsParam<string>('viduDuration'),
      viduClarity: pickNodeDetailsParam<'360p' | '720p' | '1080p'>('viduClarity'),
      viduMotionRange: pickNodeDetailsParam<string>('viduMotionRange'),
      klingAudioSync: pickNodeDetailsParam<boolean>('klingAudioSync'),
      seedanceResolution: pickNodeDetailsParam<string>('seedanceResolution'),
      seedanceAspectRatio: pickNodeDetailsParam<string>('seedanceAspectRatio'),
      seedanceDuration:
        pickNodeDetailsParam<string>('seedanceDuration') ?? SEEDANCE_DURATION_DEFAULT_LABEL,
      seedanceGenerateAudio: pickNodeDetailsParam<boolean>('seedanceGenerateAudio'),
      seedanceFixedCamera: pickNodeDetailsParam<boolean>('seedanceFixedCamera'),
      seedanceGenerationMode: pickNodeDetailsParam<'text' | 'image' | 'reference'>('seedanceGenerationMode'),
      klingOmniTab: (pickNodeDetailsParam<string>('klingOmniTab') ??
        (gp as GenerationParams & { klingOmniTab?: string })?.klingOmniTab ??
        ancestorData?.klingOmniTab) as 'multi' | 'instruction' | 'video' | 'frames' | undefined,
      seedanceReferenceWebSearch:
        pickNodeDetailsParam<boolean>('seedanceReferenceWebSearch') ??
        (previewNode.data as { seedanceImageWebSearch?: boolean }).seedanceImageWebSearch ??
        (previewNode.data.generationParams as { seedanceImageWebSearch?: boolean } | undefined)
          ?.seedanceImageWebSearch,
      generatedAt:
        pickNodeDetailsParam<string>('generatedAt') ??
        previewNode.data.generatedAt,
    };
    const mainImage = previewNode.data.imagePreview;
    const jimengImgs = previewNode.data.jimengImages || [];
    /** 与 baseParams.referenceImages 一致（已合并 data+gp 并去重 URL） */
    const baseRefs = mergedRefImagesOrdered;
    const rawRefMovs = mergedRefMovsRaw;
    const isOutputNode = previewNode.type === NodeType.MOV || previewNode.type === NodeType.OUTPUT;
    // 展示层去重：按“规范化 URL”去重；同资源时优先保留 http(s) 而非 blob
    const baseRefMovs: Array<{ url: string; posterDataUrl?: string }> = (() => {
      const out: Array<{ url: string; posterDataUrl?: string }> = [];
      const keyToIndex = new Map<string, number>();
      const withSafeRefMovPoster = (m: { url: string; posterDataUrl?: string }) => {
        const poster = pickReferenceMovPoster(m.url, m.posterDataUrl);
        return poster ? { url: m.url, posterDataUrl: poster } : { url: m.url };
      };
      const outputResultUrl = previewNode.data.imagePreview;
      const outputResultKey = normalizeVideoUrlForDedupe(outputResultUrl);
      for (const m of rawRefMovs) {
        if (!m?.url) continue;
        const currentKey = normalizeVideoUrlForDedupe(m.url);
        // 强规则：输出节点的生成结果视频不是“参考视频”
        if (isOutputNode) {
          if (outputResultUrl && (m.url === outputResultUrl || (outputResultKey && currentKey === outputResultKey))) {
            continue;
          }
        }
        // Omni 指令/视频参考场景：Reference Videos 仅显示“参考输入视频”，不显示本次生成结果视频
        if (
          isOmniModel &&
          (omniTab === 'instruction' || omniTab === 'video') &&
          outputResultUrl &&
          (m.url === outputResultUrl || (outputResultKey && currentKey === outputResultKey))
        ) {
          continue;
        }
        const key = normalizeVideoUrlForDedupe(m.url) || m.url;
        const existingIdx = keyToIndex.get(key);
        if (existingIdx != null) {
          const existing = out[existingIdx];
          const existingIsBlob = existing.url.startsWith('blob:');
          const nextIsBlob = m.url.startsWith('blob:');
          // 同资源时优先用可持久化 URL；并补全 poster
          if (existingIsBlob && !nextIsBlob) {
            out[existingIdx] = withSafeRefMovPoster({
              ...m,
              posterDataUrl: pickReferenceMovPoster(m.url, m.posterDataUrl, existing.posterDataUrl),
            });
          } else if (!existing.posterDataUrl && m.posterDataUrl) {
            out[existingIdx] = withSafeRefMovPoster({
              ...existing,
              posterDataUrl: pickReferenceMovPoster(m.url, m.posterDataUrl),
            });
          }
          continue;
        }
        keyToIndex.set(key, out.length);
        out.push(withSafeRefMovPoster(m));
      }
      // 兜底：若 referenceMovs 丢失（如旧数据清洗过 blob），优先回填「参考视频来源」；首尾帧 tab 不展示参考视频，勿回填
      if (out.length === 0 && !(isOmniModel && omniTab === 'frames')) {
        const d0 = previewNode.data as any;
        const g0 = previewNode.data.generationParams as any;
        const seedanceMode0 = String(d0.seedanceGenerationMode || g0?.seedanceGenerationMode || 'text');
        const isSeedance20RefFallback =
          (modelStr === 'seedance2.0 (高质量版)' || modelStr === 'seedance2.0 (急速版)') &&
          seedanceMode0 === 'reference';
        if (isSeedance20RefFallback && isOutputNode) {
          return dedupeReferenceMovsByUrl(out);
        }
        const anc0 = ancestorData as Partial<NodeData> & {
          seedanceTabConfigs?: { reference?: { referenceMovs?: Array<{ url: string; posterDataUrl?: string }> } };
        };
        const ancRefMov =
          anc0?.referenceMovs?.find((m) => m?.url)?.url ||
          anc0?.seedanceTabConfigs?.reference?.referenceMovs?.find((m) => m?.url)?.url;
        const inferredRefVideoUrl =
          isSeedance20RefFallback && ancRefMov
            ? ancRefMov
            : isOmniModel && omniTab === 'instruction'
            ? d0.klingOmniInstructionVideoUrl ||
              d0.klingOmniInstructionVideoPreviewUrl ||
              g0?.klingOmniInstructionVideoUrl ||
              g0?.klingOmniInstructionVideoPreviewUrl
            : isOmniModel && omniTab === 'video'
              ? d0.klingOmniVideoUrl ||
                d0.klingOmniVideoPreviewUrl ||
                g0?.klingOmniVideoUrl ||
                g0?.klingOmniVideoPreviewUrl
              : d0.klingOmniVideoUrl ||
                d0.klingOmniVideoPreviewUrl ||
                g0?.klingOmniVideoUrl ||
                g0?.klingOmniVideoPreviewUrl;
        const treatAsVideo =
          isLikelyVideoUrl(inferredRefVideoUrl) ||
          (previewNode.type === NodeType.MOV && !!inferredRefVideoUrl && !isLikelyImageUrl(inferredRefVideoUrl));
        const isGeneratedResultVideo =
          !!outputResultUrl && !!inferredRefVideoUrl && isSameReferenceVideoAsset(inferredRefVideoUrl, outputResultUrl);
        if (treatAsVideo && !isGeneratedResultVideo) {
          const snapMovPoster = rawRefMovs.find((m) =>
            isSameReferenceVideoAsset(m.url, inferredRefVideoUrl)
          )?.posterDataUrl;
          out.push({
            url: inferredRefVideoUrl,
            posterDataUrl: pickReferenceMovPoster(
              inferredRefVideoUrl,
              snapMovPoster,
              ...(isOutputNode ? [] : [(previewNode.data as any).videoPosterDataUrl])
            ),
          });
        }
      }
      return dedupeReferenceMovsByUrl(out);
    })();
    // 输出节点(MOV/OUTPUT)的 imagePreview 是生成结果，不作为“参考图”；输入图来自 generationParams.referenceImages

    // Omni 首尾帧：仅展示 merge 后的首/尾帧参考图，不叠 keling 分支里的重复首尾帧；参考视频为空
    if (isOmniModel && omniTab === 'frames') {
      const movUrlSet = new Set((baseRefMovs || []).map((m) => m.url).filter(Boolean));
      if (baseRefMovs.length > 0) {
        const d: any = previewNode.data;
        const g: any = previewNode.data.generationParams;
        const snapRefs = Array.isArray(g?.referenceImages)
          ? (g.referenceImages as string[]).filter(Boolean)
          : [];
        const refsSource = snapRefs.length > 0 ? snapRefs : [...baseRefs];
        const finalRefImages = sanitizeRefImagesForDetails(
          dedupeImageUrls(refsSource.filter(Boolean)).filter((u) => !movUrlSet.has(u))
        );
        return {
          ...withoutFirstFrameFieldsWhenRefVideo(baseParams, true),
          referenceImages: finalRefImages.length
            ? finalRefImages
            : sanitizeRefImagesForDetails(baseRefs.filter((u) => !movUrlSet.has(u))),
          referenceMovs: baseRefMovs,
        };
      }
      // Keep first/last slot semantics with fallback to referenceImages[0/1] for historical snapshots.
      const d: any = previewNode.data;
      const g: any = previewNode.data.generationParams;
      let first = d.firstFrameImageUrl || d.firstFrameImage || g?.firstFrameImageUrl || g?.firstFrameImage;
      let last = d.lastFrameImageUrl || d.lastFrameImage || g?.lastFrameImageUrl || g?.lastFrameImage;
      // data 与 gp 快照常各带一份相同资源；按规范化路径去重，避免 refOrdered[0/1] 成同一张图（含 COS 签名不同）
      const refOrdered = dedupeReferenceImageUrlsForSlotFallback(
        [
          ...(Array.isArray(d.referenceImages) ? d.referenceImages : []),
          ...(Array.isArray(g?.referenceImages) ? g.referenceImages : []),
        ].filter(Boolean) as string[]
      );
      if (!first && refOrdered[0]) first = refOrdered[0];
      if (!last && refOrdered[1]) last = refOrdered[1];
      const frameSlots = [first, last].filter((u): u is string => Boolean(u)).filter((u) => !movUrlSet.has(u));
      const slotNormSet = new Set(frameSlots.map((u) => normalizeImageUrlForDedupe(u)));
      const extras = sanitizeRefImagesForDetails(
        baseRefs.filter((u) => {
          if (!u || movUrlSet.has(u)) return false;
          return !slotNormSet.has(normalizeImageUrlForDedupe(u));
        })
      );
      const finalRefImagesRaw = [...frameSlots, ...extras];
      const seenOmniFrames = new Set<string>();
      const finalRefImages = finalRefImagesRaw.filter((u) => {
        const key = normalizeImageUrlForDedupe(u);
        if (!key || seenOmniFrames.has(key)) return false;
        seenOmniFrames.add(key);
        return true;
      });
      const panelSourceFrames: Partial<NodeData> =
        isOutputLikeForDetails && ancestorData
          ? { ...ancestorData, selectedModel: modelStr, klingOmniTab: 'frames' }
          : { ...previewNode.data, selectedModel: modelStr, klingOmniTab: 'frames' };
      if (first) {
        panelSourceFrames.firstFrameImage = first;
        panelSourceFrames.firstFrameImageUrl = first;
      }
      if (last) {
        panelSourceFrames.lastFrameImage = last;
        panelSourceFrames.lastFrameImageUrl = last;
      }
      const refPreviewFrames = buildNodeDetailsReferencePreview({
        panelSource: panelSourceFrames,
        urlPool: dedupeImageUrls([...finalRefImages, first, last].filter(Boolean) as string[]),
        projectAssets: projectAssetLabelRows,
      });
      return {
        ...baseParams,
        referenceImages: refPreviewFrames.referenceImages,
        referenceImageDetailItems: refPreviewFrames.referenceImageDetailItems,
        referenceMovs: baseRefMovs,
      };
    }

    // 可灵3.0 Omni（非首尾帧 tab）：面板顺序 + 底栏标签；指令/视频参考在面板槽空时回退 gp 快照
    if (isOmniModel && omniTab !== 'frames') {
      const panelSource = buildOmniPanelSourceForNodeDetails({
        previewNodeData: previewNode.data,
        generationParams: gp as GenerationParams,
        ancestorData,
        isOutputLike: isOutputLikeForDetails,
        omniTab,
        modelStr,
        resolvedPrompt: resolvedPreviewPrompt,
      });
      const omniMultiMovs =
        omniTab === 'multi'
          ? collectOmniMultiTabReferenceMovsForDetails({
              panelSource,
              outputResultUrl: previewNode.data.imagePreview,
              isSameAsOutput: isSameReferenceVideoAsset,
            })
          : [];
      const mergedOmniRefMovs = dedupeReferenceMovsByUrl([
        ...baseRefMovs,
        ...omniMultiMovs.map((m) => ({
          url: m.url,
          posterDataUrl: pickReferenceMovPoster(m.url, m.posterDataUrl),
        })),
      ]);
      const movUrlSet = new Set((mergedOmniRefMovs || []).map((m) => m.url).filter(Boolean));
      const urlPool = dedupeImageUrls([
        ...(Array.isArray(gp?.referenceImages) ? (gp!.referenceImages as string[]) : []),
        ...baseRefs,
        ...(panelSource.imagePreview ? [panelSource.imagePreview] : []),
        ...(panelSource.klingOmniMultiReferenceImages || []),
        ...(panelSource.klingOmniInstructionReferenceImages || []),
        ...(panelSource.klingOmniVideoReferenceImages || []),
        ...(panelSource.referenceImages || []),
      ]).filter((u) => !movUrlSet.has(u));
      const omniSnapRefs =
        Array.isArray(gp?.referenceImages) && (gp!.referenceImages as string[]).filter(Boolean).length
          ? (gp!.referenceImages as string[])
          : baseRefs;
      const refPreview =
        omniTab === 'instruction' || omniTab === 'video'
          ? buildOmniInstructionVideoTabDetailsReferencePreview({
              panelSource,
              omniTab,
              urlPool,
              snapshotRefs: omniSnapRefs,
              movUrlSet,
              projectAssets: projectAssetLabelRows,
              prompt: resolvedPreviewPrompt,
            })
          : omniTab === 'multi'
          ? buildOmniMultiTabDetailsReferencePreview({
              panelSource,
              urlPool,
              snapshotRefs: omniSnapRefs,
              snapshotLabels: Array.isArray(gp?.referenceImageLabels)
                ? (gp!.referenceImageLabels as string[])
                : undefined,
              prompt: resolvedPreviewPrompt,
              movUrlSet,
              projectAssets: projectAssetLabelRows,
            })
          : buildNodeDetailsReferencePreview({
              panelSource,
              urlPool,
              projectAssets: projectAssetLabelRows,
              filterItem: (it) => Boolean(it.url) && !movUrlSet.has(it.url),
            });
      return {
        ...withoutFirstFrameFieldsWhenRefVideo(baseParams, mergedOmniRefMovs.length > 0),
        referenceImages: refPreview.referenceImages,
        referenceImageDetailItems: refPreview.referenceImageDetailItems,
        referenceMovs: mergedOmniRefMovs,
      };
    }

    // 对于可灵节点，将首帧图和尾帧图添加到参考图片中（与 input picture node 一致）
    // 必须用「本次生成快照」的 gp.model：OUTPUT 节点 selectedModel 默认为「可灵 2.5 Turbo」，否则会误判为可灵分支把首尾帧拼进参考图（Nano 等生图常见问题）
    const modelForMediaBranch = modelStr;
    const isKeling = modelForMediaBranch.includes('可灵') || modelForMediaBranch.includes('Keling');
    const isJimeng = modelForMediaBranch.includes('即梦');
    const isVidu = modelForMediaBranch === 'vidu 2.0';
    const isSeedance = ['seedance1.5-pro', 'seedance2.0 (高质量版)', 'seedance2.0 (急速版)'].includes(modelForMediaBranch);
    const resolveFramePair = () => {
      const d: any = previewNode.data;
      const g: any = previewNode.data.generationParams;
      let first = d.firstFrameImageUrl || d.firstFrameImage || g?.firstFrameImageUrl || g?.firstFrameImage;
      let last = d.lastFrameImageUrl || d.lastFrameImage || g?.lastFrameImageUrl || g?.lastFrameImage;
      if (baseRefMovs.length > 0) {
        return { first: undefined, last: undefined };
      }
      /** 仅合并 d+gp 时去重：避免快照重复或签名不同导致误填「首+尾」两张；显式 first/last 仍由 frameSlotsForDetails 保留双槽 */
      const refOrdered = dedupeReferenceImageUrlsForSlotFallback(
        [
          ...(Array.isArray(d.referenceImages) ? d.referenceImages : []),
          ...(Array.isArray(g?.referenceImages) ? g.referenceImages : []),
        ].filter(Boolean) as string[]
      );
      if (!first && refOrdered[0]) first = refOrdered[0];
      if (!last && refOrdered[1]) last = refOrdered[1];
      return { first, last };
    };
    const frameSlotsForDetails = (
      pair: { first?: string; last?: string },
      opts?: { allowDuplicateSameUrl?: boolean }
    ): string[] => {
      const out: string[] = [];
      const allowDuplicateSameUrl = opts?.allowDuplicateSameUrl ?? true;
      const tryPush = (u?: string) => {
        if (!u) return;
        // Keep slot semantics first; avoid over-filtering first/last frame entries.
        out.push(u);
      };
      const first = pair.first;
      const last = pair.last;
      tryPush(first);
      if (last) {
        const sameAsset =
          !!first && normalizeImageUrlForDedupe(first) === normalizeImageUrlForDedupe(last);
        // vidu / seedance1.5 不保留同图双槽：首尾同图时只显示一张，避免 Reference Images 里重复
        if (!sameAsset || allowDuplicateSameUrl) {
          tryPush(last);
        }
      }
      return out;
    };
    const compactRefImagesForDetails = (list: string[]): string[] => {
      const normalized = list.map((u) => String(u || '').trim()).filter(Boolean);
      if (normalized.length <= 1) return normalized;
      // 若同时存在可持久化 URL 与 data/blob，本地预览优先被替换/剔除，避免同图重复显示两次
      const hasPersistent = normalized.some((u) => !/^data:/i.test(u) && !u.startsWith('blob:'));
      const input = hasPersistent
        ? normalized.filter((u) => !/^data:/i.test(u) && !u.startsWith('blob:'))
        : normalized;
      const seen = new Set<string>();
      const out: string[] = [];
      for (const u of input) {
        const key = normalizeImageUrlForDedupe(u);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(u);
      }
      return out;
    };
    if (isOmniModel) {
      return {
        ...baseParams,
        referenceImages: compactRefImagesForDetails(mergedRefImagesOrdered),
        referenceMovs: baseRefMovs,
      };
    }
    if (isJimeng) {
      if (baseRefMovs.length > 0) {
        const movUrlSet = new Set((baseRefMovs || []).map((m) => m.url).filter(Boolean));
        const snapRefs = Array.isArray(gp?.referenceImages)
          ? (gp!.referenceImages as string[]).filter(Boolean)
          : [];
        const refsSource = snapRefs.length > 0 ? snapRefs : [...baseRefs];
        const finalRefImages = sanitizeRefImagesForDetails(
          dedupeImageUrls(refsSource.filter(Boolean)).filter((u) => !movUrlSet.has(u))
        );
        return {
          ...withoutFirstFrameFieldsWhenRefVideo(baseParams, true),
          referenceImages: finalRefImages.length
            ? finalRefImages
            : sanitizeRefImagesForDetails(baseRefs.filter((u) => !movUrlSet.has(u))),
          referenceMovs: baseRefMovs,
        };
      }
      const pickImageOnly = (...vals: Array<string | undefined>): string | undefined => {
        for (const v of vals) {
          if (!v) continue;
          if (sanitizeRefImagesForDetails([v]).length > 0) return v;
        }
        return undefined;
      };
      const jimengFirstUrl = previewNode.data.firstFrameImageUrl || previewNode.data.generationParams?.firstFrameImageUrl;
      const jimengFirstBase64 = previewNode.data.firstFrameImage || previewNode.data.generationParams?.firstFrameImage;
      const jimengImgsFromData = Array.isArray(previewNode.data.jimengImages) ? previewNode.data.jimengImages : [];
      const jimengImgsFromGp = Array.isArray((previewNode.data.generationParams as any)?.jimengImages)
        ? ((previewNode.data.generationParams as any).jimengImages as string[])
        : [];
      const pair = resolveFramePair();
      const ancestorFirst = pickImageOnly(
        ancestorData?.firstFrameImageUrl,
        ancestorData?.firstFrameImage,
        ancestorData?.imagePreview
      );
      const jimengFirst = pickImageOnly(
        jimengFirstUrl,
        jimengFirstBase64,
        pair.first,
        jimengImgsFromData[0],
        jimengImgsFromGp[0],
        ancestorFirst
      );
      const existingRefImages = baseRefs;
      const movUrlSet = new Set((baseRefMovs || []).map((m) => m.url).filter(Boolean));
      const withMain = isOutputNode ? [] : (mainImage ? [mainImage] : []);
      const frameSlots = frameSlotsForDetails({
        first: jimengFirst,
        last: pickImageOnly(pair.last),
      });
      const finalRefImages = sanitizeRefImagesForDetails(
        dedupeImageUrls([
          ...withMain,
          ...frameSlots,
          ...jimengImgsFromData,
          ...jimengImgsFromGp,
          ...existingRefImages,
        ].filter(Boolean)).filter((u) => !movUrlSet.has(u))
      );
      // 即梦：Reference Images 不保留重复首尾槽位（同 URL 只显示一张）
      const panelSourceJimeng: Partial<NodeData> =
        isOutputLikeForDetails && ancestorData
          ? { ...ancestorData, selectedModel: modelStr }
          : { ...previewNode.data, selectedModel: modelStr };
      if (jimengFirst) {
        panelSourceJimeng.firstFrameImage = jimengFirst;
        panelSourceJimeng.firstFrameImageUrl = jimengFirst;
      }
      const jimengUrlPool = dedupeImageUrls(
        [
          jimengFirst,
          pickImageOnly(pair.last),
          ...jimengImgsFromData,
          ...jimengImgsFromGp,
          ...(Array.isArray(gp?.referenceImages) ? (gp!.referenceImages as string[]) : []),
          ...existingRefImages,
        ].filter(Boolean) as string[]
      ).filter((u) => !movUrlSet.has(u));
      const refPreviewJimeng = buildNodeDetailsReferencePreview({
        panelSource: panelSourceJimeng,
        urlPool: jimengUrlPool,
        projectAssets: projectAssetLabelRows,
      });
      return {
        ...baseParams,
        referenceImages: refPreviewJimeng.referenceImages,
        referenceImageDetailItems: refPreviewJimeng.referenceImageDetailItems,
        referenceMovs: baseRefMovs,
      };
    }
    if (isNanoBanana2Model(modelForMediaBranch)) {
      const g = runGp;
      const snapRefs = Array.isArray(g.referenceImages)
        ? (g.referenceImages as string[]).filter(Boolean)
        : [];
      const outUrl = previewNode.data.imagePreview;
      if (snapRefs.length > 0) {
        const snapLabels = Array.isArray(g.referenceImageLabels)
          ? (g.referenceImageLabels as string[])
          : [];
        const fromSnap = buildImageGenOutputReferenceDetailsFromSnapshot({
          snapshotRefs: snapRefs,
          snapshotLabels: snapLabels,
          projectAssets: projectAssetLabelRows,
          prompt: baseParams.prompt,
          ...(isOutputLikeForDetails
            ? {
                outputImagePreview: outUrl,
                isRunSnapshotRef: isRunSnapshotReferenceImage,
                isSameAsOutput: isSameImageOutputAsset,
              }
            : {}),
        });
        return {
          ...baseParams,
          aspectRatio: pickNodeDetailsParam<string>('aspectRatio') || '1:1',
          resolution: pickNodeDetailsParam<string>('resolution') || '1K',
          referenceImages: compactRefImagesForDetails(fromSnap.referenceImages),
          referenceImageDetailItems: fromSnap.referenceImageDetailItems,
          referenceMovs: [],
        };
      }
      const panelSource: Partial<NodeData> = enrichPanelSourceFromGenerationSnapshot(
        isOutputLikeForDetails && ancestorData
          ? { ...ancestorData, selectedModel: modelStr }
          : { ...previewNode.data, selectedModel: modelStr },
        g
      );
      const urlPool = dedupeImageUrls([
        ...snapRefs,
        ...(Array.isArray(panelSource.referenceImages) ? panelSource.referenceImages! : []),
        ...(panelSource.imagePreview ? [panelSource.imagePreview] : []),
      ]);
      const refPreview = buildNodeDetailsReferencePreview({
        panelSource,
        urlPool,
        projectAssets: projectAssetLabelRows,
        filterItem: (it) =>
          isOutputLikeForDetails
            ? isRunSnapshotReferenceImage(it.url) || !isSameImageOutputAsset(it.url, outUrl || '')
            : true,
      });
      return {
        ...baseParams,
        aspectRatio: pickNodeDetailsParam<string>('aspectRatio') || '1:1',
        resolution: pickNodeDetailsParam<string>('resolution') || '1K',
        referenceImages: compactRefImagesForDetails(refPreview.referenceImages),
        referenceImageDetailItems: refPreview.referenceImageDetailItems,
        referenceMovs: [],
      };
    }
    if (isImage2Model(modelForMediaBranch)) {
      const d = previewNode.data;
      const g = previewNode.data.generationParams as GenerationParams | undefined;
      const snapRefs = Array.isArray(g?.referenceImages)
        ? (g.referenceImages as string[]).filter(Boolean)
        : [];
      const outUrl = String(previewNode.data.imagePreview || '').trim();
      const image2RefUrlOk = (u: string) => {
        const s = String(u || '').trim();
        if (!s || s.startsWith('blob:') || /^data:/i.test(s)) return false;
        if (isRunSnapshotReferenceImage(s)) return true;
        if (isOutputLikeForDetails && outUrl && isSameImageOutputAsset(s, outUrl)) return false;
        return true;
      };
      if (snapRefs.length > 0) {
        const snapLabels = Array.isArray(g?.referenceImageLabels)
          ? (g!.referenceImageLabels as string[])
          : Array.isArray(d.referenceImageLabels)
            ? d.referenceImageLabels
            : [];
        const fromSnap = buildImageGenOutputReferenceDetailsFromSnapshot({
          snapshotRefs: snapRefs,
          snapshotLabels: snapLabels,
          projectAssets: projectAssetLabelRows,
          prompt: baseParams.prompt,
          ...(isOutputLikeForDetails
            ? {
                outputImagePreview: outUrl,
                isRunSnapshotRef: isRunSnapshotReferenceImage,
                isSameAsOutput: isSameImageOutputAsset,
                urlAllowed: image2RefUrlOk,
              }
            : { urlAllowed: image2RefUrlOk }),
        });
        return {
          ...baseParams,
          referenceImages: fromSnap.referenceImages,
          referenceImageDetailItems: fromSnap.referenceImageDetailItems,
          referenceMovs: [],
        };
      }
      const panelSource: Partial<NodeData> = enrichPanelSourceFromGenerationSnapshot(
        isOutputLikeForDetails && ancestorData
          ? { ...ancestorData, selectedModel: modelStr }
          : { ...d, selectedModel: modelStr },
        g
      );
      const urlPool = dedupeImageUrls([
        ...snapRefs,
        ...(Array.isArray(panelSource.referenceImages) ? panelSource.referenceImages! : []),
        ...(panelSource.imagePreview ? [panelSource.imagePreview] : []),
      ]);
      const refPreview = buildNodeDetailsReferencePreview({
        panelSource,
        urlPool,
        projectAssets: projectAssetLabelRows,
        maxItems: 3,
        filterItem: (it) => image2RefUrlOk(it.url),
      });
      return {
        ...baseParams,
        referenceImages: refPreview.referenceImages,
        referenceImageDetailItems: refPreview.referenceImageDetailItems,
        referenceMovs: [],
      };
    }
    /** Seedance：首尾槽位单独保留（含同 URL 双槽）；extras 与槽位按规范化 URL 去重，避免少一张 */
    if (isSeedance) {
      const runSeedanceMode =
        previewNode.data.seedanceGenerationMode ??
        previewNode.data.generationParams?.seedanceGenerationMode ??
        'text';
      const buildSeedanceRefFallback = (): string[] => {
        const d = previewNode.data as any;
        const g = previewNode.data.generationParams as any;
        const includeFrameSlots = baseRefMovs.length === 0;
        const frameUrls = includeFrameSlots
          ? [
              d.firstFrameImageUrl,
              d.firstFrameImage,
              d.lastFrameImageUrl,
              d.lastFrameImage,
              g?.firstFrameImageUrl,
              g?.firstFrameImage,
              g?.lastFrameImageUrl,
              g?.lastFrameImage,
            ]
          : [];
        const refLists =
          runSeedanceMode === 'image'
            ? frameUrls
            : [
                ...frameUrls,
                ...(Array.isArray(d.referenceImages) ? d.referenceImages : []),
                ...(Array.isArray(g?.referenceImages) ? g.referenceImages : []),
              ];
        return sanitizeRefImagesForDetails(dedupeImageUrls(refLists.filter(Boolean) as string[]));
      };
      const passesRefImageDetailRules = (u: string): boolean => {
        if (!u) return false;
        if (refImageExcludeVideoPosters.has(u)) return false;
        if (isLikelyVideoUrlStrictForRefPanel(u)) return false;
        if (isLikelyVideoCaptureDataUrl(u)) return false;
        const nk = normalizeVideoUrlForDedupe(u);
        if (nk && refVideoNormKeysFromMovs.has(nk)) return false;
        return true;
      };
      const pair = resolveFramePair();
      if (runSeedanceMode === 'reference' || baseRefMovs.length > 0) {
        const movUrlSet = new Set((baseRefMovs || []).map((m) => m.url).filter(Boolean));
        const snapRefs = Array.isArray(gp?.referenceImages)
          ? (gp!.referenceImages as string[]).filter(Boolean)
          : [];
        if (snapRefs.length > 0) {
          const snapLabels = Array.isArray(gp?.referenceImageLabels)
            ? (gp!.referenceImageLabels as string[])
            : [];
          const fromSnap = buildSeedanceReferenceDetailsFromSnapshot({
            snapshotRefs: snapRefs.filter((u) => !movUrlSet.has(u)),
            snapshotLabels: snapLabels,
            projectAssets: projectAssetLabelRows,
            prompt: baseParams.prompt,
          });
          return {
            ...withoutFirstFrameFieldsWhenRefVideo(baseParams, true),
            referenceImages: fromSnap.referenceImages,
            referenceImageDetailItems: fromSnap.referenceImageDetailItems,
            referenceMovs: baseRefMovs,
          };
        }
        const panelSource: Partial<NodeData> =
          isOutputLikeForDetails && ancestorData
            ? { ...ancestorData, selectedModel: modelStr, seedanceGenerationMode: 'reference' }
            : { ...previewNode.data, selectedModel: modelStr, seedanceGenerationMode: 'reference' };
        const urlPool = dedupeImageUrls([
          ...snapRefs,
          ...(panelSource.imagePreview && shouldIncludeImagePreviewInNodeDetailsUrlPool(panelSource)
            ? [panelSource.imagePreview]
            : []),
        ]).filter((u) => !movUrlSet.has(u));
        const refPreview = buildNodeDetailsReferencePreview({
          panelSource,
          urlPool,
          projectAssets: projectAssetLabelRows,
          filterItem: (it) =>
            Boolean(it.url) && !movUrlSet.has(it.url) && !isLikelyVideoUrlStrictForRefPanel(it.url),
        });
        return {
          ...withoutFirstFrameFieldsWhenRefVideo(baseParams, true),
          referenceImages: refPreview.referenceImages,
          referenceImageDetailItems: refPreview.referenceImageDetailItems,
          referenceMovs: baseRefMovs,
        };
      }
      if (runSeedanceMode === 'image') {
        const movUrlSet = new Set((baseRefMovs || []).map((m) => m.url).filter(Boolean));
        const imageRefs = mergeSeedanceImageModeDetailsReferenceImages({
          nodeData: previewNode.data,
          generationParams: gp as GenerationParams,
          mergedPool: undefined,
        }).filter((u) => !movUrlSet.has(u) && passesRefImageDetailRules(u));
        const panelSource: Partial<NodeData> = {
          ...previewNode.data,
          selectedModel: modelStr,
          seedanceGenerationMode: 'image',
          firstFrameImageUrl: imageRefs[0],
          firstFrameImage: imageRefs[0],
          lastFrameImageUrl: imageRefs[1],
          lastFrameImage: imageRefs[1],
        };
        const refPreview = buildNodeDetailsReferencePreview({
          panelSource,
          urlPool: imageRefs.length ? imageRefs : buildSeedanceRefFallback(),
          projectAssets: projectAssetLabelRows,
          maxItems: 2,
        });
        return {
          ...baseParams,
          referenceImages: refPreview.referenceImages,
          referenceImageDetailItems: refPreview.referenceImageDetailItems,
          referenceMovs: baseRefMovs,
        };
      }
      const pairText = resolveFramePair();
      const panelSourceText: Partial<NodeData> =
        isOutputLikeForDetails && ancestorData
          ? { ...ancestorData, selectedModel: modelStr, seedanceGenerationMode: 'text' }
          : { ...previewNode.data, selectedModel: modelStr, seedanceGenerationMode: 'text' };
      if (pairText.first) {
        panelSourceText.firstFrameImage = pairText.first;
        panelSourceText.firstFrameImageUrl = pairText.first;
      }
      if (pairText.last) {
        panelSourceText.lastFrameImage = pairText.last;
        panelSourceText.lastFrameImageUrl = pairText.last;
      }
      const movUrlSetText = new Set((baseRefMovs || []).map((m) => m.url).filter(Boolean));
      const refPreviewText = buildNodeDetailsReferencePreview({
        panelSource: panelSourceText,
        urlPool: buildSeedanceRefFallback().filter((u) => !movUrlSetText.has(u)),
        projectAssets: projectAssetLabelRows,
        filterItem: (it) => passesRefImageDetailRules(it.url) && !movUrlSetText.has(it.url),
      });
      return {
        ...baseParams,
        referenceImages: refPreviewText.referenceImages,
        referenceImageDetailItems: refPreviewText.referenceImageDetailItems,
        referenceMovs: baseRefMovs,
      };
    }
    if (isKeling || isVidu) {
      if (baseRefMovs.length > 0) {
        const movUrlSet = new Set((baseRefMovs || []).map((m) => m.url).filter(Boolean));
        const snapRefs = Array.isArray(gp?.referenceImages)
          ? (gp!.referenceImages as string[]).filter(Boolean)
          : [];
        const refsSource = snapRefs.length > 0 ? snapRefs : [...baseRefs];
        const finalRefImages = sanitizeRefImagesForDetails(
          dedupeImageUrls(refsSource.filter(Boolean)).filter((u) => !movUrlSet.has(u))
        );
        return {
          ...withoutFirstFrameFieldsWhenRefVideo(baseParams, true),
          referenceImages: finalRefImages.length
            ? finalRefImages
            : sanitizeRefImagesForDetails(baseRefs.filter((u) => !movUrlSet.has(u))),
          referenceMovs: baseRefMovs,
        };
      }
      const pair = resolveFramePair();
      const movUrlSet = new Set((baseRefMovs || []).map((m) => m.url).filter(Boolean));
      const panelSourceKeling: Partial<NodeData> =
        isOutputLikeForDetails && ancestorData
          ? { ...ancestorData, selectedModel: modelStr }
          : { ...previewNode.data, selectedModel: modelStr };
      if (pair.first) {
        panelSourceKeling.firstFrameImage = pair.first;
        panelSourceKeling.firstFrameImageUrl = pair.first;
      }
      if (pair.last) {
        panelSourceKeling.lastFrameImage = pair.last;
        panelSourceKeling.lastFrameImageUrl = pair.last;
      }
      const refPreviewKeling = buildNodeDetailsReferencePreview({
        panelSource: panelSourceKeling,
        urlPool: dedupeImageUrls([
          ...(Array.isArray(gp?.referenceImages) ? (gp!.referenceImages as string[]) : []),
          ...baseRefs,
          pair.first,
          pair.last,
        ].filter(Boolean) as string[]).filter((u) => !movUrlSet.has(u)),
        projectAssets: projectAssetLabelRows,
      });
      logRefDebug('node-details-keling-build', {
        nodeId: previewNode.id,
        model: modelForMediaBranch,
        framePair: pair,
        finalRefImages: refPreviewKeling.referenceImages,
      });
      return {
        ...baseParams,
        referenceImages: refPreviewKeling.referenceImages,
        referenceImageDetailItems: refPreviewKeling.referenceImageDetailItems,
        referenceMovs: baseRefMovs,
      };
    }
    
    // 对于非可灵节点：处理节点展示主图+即梦多图+参考图；输出节点只展示 generationParams 中的参考图（已含当时输入图）
    const inputPart = isOutputNode ? [] : [mainImage, ...jimengImgs].filter(Boolean);
    const movUrlSet = new Set((baseRefMovs || []).map((m) => m.url).filter(Boolean));
    const displayRefImages = compactRefImagesForDetails(
      sanitizeRefImagesForDetails(
        dedupeImageUrls([...inputPart, ...baseRefs].filter(Boolean)).filter((u) => !movUrlSet.has(u))
      )
    );
    return {
      ...baseParams,
      referenceImages: displayRefImages,
      referenceMovs: baseRefMovs,
    };
  })() : {};

  const previewParams = previewNode
    ? {
        ...previewParamsCore,
        referenceVideoDetailItems: buildReferenceVideoDetailItems(
          buildNodeDetailsVideoLabelSource(previewNode.data, {
            prompt: String((previewParamsCore as { prompt?: string }).prompt || ''),
            model: String((previewParamsCore as { model?: string }).model || ''),
          }),
          (
            (previewParamsCore as {
              referenceMovs?: Array<{ url: string; posterDataUrl?: string }>;
            }).referenceMovs || []
          )
        ),
      }
    : {};

  const nodeDetailsHeroUrl = previewNode
    ? resolveNodeDetailsHeroImageUrl(previewNode.data, {
        referenceImageDetailItems: (
          previewParams as { referenceImageDetailItems?: Array<{ url: string; label: string }> }
        ).referenceImageDetailItems,
        projectAssets: projectAssetLabelRows,
      })
    : undefined;

  const sourceUrlForDetails = previewNode
    ? resolveNodeDetailsSourceUrl(previewNode.data, previewNode.type as NodeType)
    : '';

  const formatRefUrlForDetails = (url: string) =>
    formatMediaUrlForNodeDetails(url, {
      imageName: previewNode?.data.imageName,
      projectId: serverProjectId || undefined,
      projectAssetId: (previewNode?.data as NodeData & { projectAssetId?: string })
        ?.projectAssetId,
    });

  const previewVideoPosterUrl = previewNode
    ? (() => {
        const imagePreview = String(previewNode.data.imagePreview || '').trim();
        const isOutputVideo =
          previewNode.type === NodeType.MOV ||
          (imagePreview ? isVideoPreviewUrl(imagePreview) : false);
        const normImgKey = (u: string) =>
          u.split('#')[0].split('?')[0].replace(/\/+$/, '').toLowerCase();
        const refImageKeys = new Set(
          ((previewParams as { referenceImages?: string[] }).referenceImages || [])
            .filter(Boolean)
            .map((u) => normImgKey(String(u)))
        );
        /** 生成结果视频：禁止用参考图 URL 充当 poster（Node Details 左侧会误显示参考图首帧） */
        const pickVideoPosterCandidate = (candidate?: string): string | undefined => {
          const s = String(candidate || '').trim();
          if (!s || isEphemeralMediaUrl(s, 'videoPosterDataUrl')) return undefined;
          if (isOutputVideo && refImageKeys.has(normImgKey(s))) return undefined;
          return s;
        };
        const fromData = pickVideoPosterCandidate(previewNode.data.videoPosterDataUrl);
        if (fromData) return fromData;
        const fromGp = pickVideoPosterCandidate(
          (previewNode.data.generationParams as { videoPosterDataUrl?: string })?.videoPosterDataUrl
        );
        if (fromGp) return fromGp;
        if (isOutputVideo && imagePreview) {
          const previewKey = normImgKey(imagePreview);
          const thumbs = previewNode.data.generatedThumbnails || [];
          for (const t of thumbs) {
            if (t.type !== 'video' || !t.url || !t.posterDataUrl) continue;
            if (normImgKey(String(t.url)) !== previewKey) continue;
            const captured = pickVideoPosterCandidate(t.posterDataUrl);
            if (captured) return captured;
          }
          return undefined;
        }
        const refMovs = (previewParams as { referenceMovs?: Array<{ url: string; posterDataUrl?: string }> })
          .referenceMovs;
        if (refMovs?.length) {
          const movPoster = refMovs.find((m) => m?.posterDataUrl)?.posterDataUrl;
          const safe = pickVideoPosterCandidate(movPoster);
          if (safe) return safe;
        }
        return pickReferenceImagePosterUrl(previewNode.data as Record<string, unknown>);
      })()
    : undefined;

  return (
    <DragDropContext.Provider value={{ isGlobalDragOver: isDragOver, setGlobalDragOver: setIsDragOver }}>
        {/* Full Screen Node Detail Modal (Enhanced) */}
        {previewNode && (
            <div 
                className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-md animate-[fadeIn_0.2s_ease-out]"
                onClick={() => setPreviewNode(null)}
            >
                <div 
                    className="relative w-[90vw] h-[90vh] flex overflow-hidden rounded-2xl border border-gray-800 bg-gray-900 shadow-2xl"
                    onClick={(e) => e.stopPropagation()} // Stop click bubbling
                    onDoubleClick={() => setPreviewNode(null)} // Double click content to close
                >
                    {/* Left: Image/Video Preview */}
                    <div className="flex-1 bg-black flex items-center justify-center p-4 relative">
                         {nodeDetailsHeroUrl ? (
                         previewNode.type === NodeType.MOV ||
                         isVideoPreviewUrl(nodeDetailsHeroUrl) ? (
                             <video 
                                src={resolveUrlForVideoCapture(nodeDetailsHeroUrl)} 
                                poster={previewVideoPosterUrl}
                                controls 
                                preload="metadata"
                                className="max-w-full max-h-full object-contain"
                                onError={(e) => {
                                  const el = e.currentTarget;
                                  if (el.dataset.fallbackDirect === '1') return;
                                  const direct = nodeDetailsHeroUrl;
                                  if (!direct) return;
                                  el.dataset.fallbackDirect = '1';
                                  el.src = direct;
                                  el.load();
                                }}
                             />
                         ) : (
                             <img 
                                src={resolveDisplayMediaUrl(nodeDetailsHeroUrl)} 
                                alt="Preview" 
                                className="max-w-full max-h-full object-contain"
                             />
                         )
                         ) : (
                             <div className="w-full h-full flex flex-col items-center justify-center text-gray-500 gap-2">
                                 <FileText className="w-10 h-10 text-gray-600" />
                                 <div className="text-sm">No preview media</div>
                             </div>
                         )}
                         <div className="absolute top-4 left-4 text-white/50 text-xs font-mono bg-black/50 px-2 py-1 rounded pointer-events-none">
                             PREVIEW MODE (DOUBLE CLICK TO CLOSE)
                         </div>
                    </div>

                    {/* Right: Info Panel（与 Input Picture Node 完全一致：Prompt / Reference Images / Video Frame / Source URL / Used Parameters） */}
                    <div className="w-[400px] flex-none border-l border-gray-800 bg-gray-950 flex flex-col">
                        <div className="p-5 border-b border-gray-800 flex items-center justify-between">
                            <div>
                            <h2 className="text-lg font-bold text-white flex items-center gap-2">
                                <FileText className="text-brand-500 w-5 h-5" />
                                Node Details
                            </h2>
                            {(() => {
                                const runParams = (previewNode.data.generationParams || {}) as GenerationParams & {
                                  klingOmniTab?: string;
                                };
                                const tabLine = nodeDetailsTabSummaryLine({
                                  model: (
                                    runParams.model ||
                                    previewParams.model ||
                                    previewParams.selectedModel ||
                                    ''
                                  ).trim(),
                                    seedanceGenerationMode: runParams.seedanceGenerationMode || previewParams.seedanceGenerationMode,
                                    klingOmniTab:
                                      runParams.klingOmniTab ||
                                      (previewParams as GenerationParams & { klingOmniTab?: string }).klingOmniTab ||
                                      'multi',
                                    jimengGenerationMode: runParams.jimengGenerationMode || (previewParams as GenerationParams).jimengGenerationMode,
                                });
                                return tabLine ? (
                                    <p className="mt-1.5 text-xs text-brand-400/90 font-medium">{tabLine}</p>
                                ) : null;
                            })()}
                            </div>
                            <button 
                                onClick={() => setPreviewNode(null)}
                                className="p-2 hover:bg-gray-800 rounded-lg text-gray-500 hover:text-white transition-colors"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        
                        <div className="flex-1 overflow-y-auto p-5 space-y-6 custom-scrollbar">
                            {/* Prompt Section */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block">
                                    Prompt (Creative Description)
                                  </label>
                                  {previewParams.prompt ? (
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        const ok = await copyToClipboard(String(previewParams.prompt));
                                        if (!ok) alert('复制失败，请手动选中提示词文本后复制');
                                      }}
                                      className="shrink-0 px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white rounded border border-gray-700 transition-colors text-[10px] flex items-center gap-1"
                                      title="仅复制提示词纯文本（不含图片 Base64）"
                                    >
                                      <Copy size={10} />
                                      复制提示词
                                    </button>
                                  ) : null}
                                </div>
                                <div className="p-3 bg-gray-900 rounded-lg border border-gray-800 text-sm text-gray-300 leading-relaxed font-mono whitespace-pre-wrap max-h-40 overflow-y-auto custom-scrollbar select-text">
                                    {previewParams.prompt || <span className="text-gray-600 italic">No prompt data</span>}
                                </div>
                            </div>

                            {/* Negative Prompt */}
                            {previewParams.negativePrompt && (
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block text-red-400/80">Negative Prompt</label>
                                    <div className="p-3 bg-gray-900 rounded-lg border border-gray-800 text-sm text-gray-400 leading-relaxed font-mono">
                                        {previewParams.negativePrompt}
                                    </div>
                                </div>
                            )}

                            {/* Error Message */}
                            {previewNode.data.errorMessage && (
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block text-red-400/90">Error Message</label>
                                    <div className="p-3 bg-red-950/20 rounded-lg border border-red-900/40 text-sm text-red-200 leading-relaxed font-mono whitespace-pre-wrap max-h-48 overflow-y-auto custom-scrollbar">
                                        {previewNode.data.errorMessage}
                                    </div>
                                    <div className="flex justify-end">
                                        <button
                                            onClick={async () => {
                                                const ok = await copyToClipboard(previewNode.data.errorMessage || '');
                                                if (!ok) alert('复制失败，请手动复制');
                                            }}
                                            className="px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white rounded border border-gray-700 transition-colors text-xs flex items-center gap-1.5"
                                            title="复制报错内容"
                                        >
                                            <Copy size={12} />
                                            复制报错
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Reference Images Grid */}
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block">
                                    Reference Images ({(
                                      (previewParams as { referenceImageDetailItems?: Array<{ url: string; label: string }> })
                                        .referenceImageDetailItems?.length ??
                                      previewParams.referenceImages?.length ??
                                      0
                                    )})
                                </label>
                                {(() => {
                                  const refDetailItems =
                                    (previewParams as { referenceImageDetailItems?: Array<{ url: string; label: string }> })
                                      .referenceImageDetailItems ||
                                    previewParams.referenceImages?.map((url: string) => ({ url, label: '' })) ||
                                    [];
                                  return refDetailItems.length > 0 ? (
                                    <div className="grid grid-cols-4 gap-2">
                                        {refDetailItems.map((item: { url: string; label: string }, idx: number) => (
                                            <div key={`ref-${idx}-${item.label}`} className="relative aspect-square rounded overflow-hidden border border-gray-800 bg-black">
                                                <img src={resolveDisplayMediaUrl(item.url)} alt={item.label || `ref-${idx}`} className="w-full h-full object-cover" />
                                                {item.label ? (
                                                  <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white text-[9px] font-medium text-center py-0.5 pointer-events-none z-[1]">
                                                    {item.label}
                                                  </div>
                                                ) : null}
                                            </div>
                                        ))}
                                    </div>
                                  ) : (
                                    <div className="p-2 bg-gray-900/50 rounded border border-gray-800 border-dashed text-xs text-gray-600 text-center">
                                        No Reference Images
                                    </div>
                                  );
                                })()}
                                {(() => {
                                  const refDetailItems =
                                    (previewParams as { referenceImageDetailItems?: Array<{ url: string; label: string }> })
                                      .referenceImageDetailItems ||
                                    previewParams.referenceImages?.map((url: string) => ({ url, label: '' })) ||
                                    [];
                                  return refDetailItems.length > 0 ? (
                                    <div className="space-y-1">
                                        <div className="text-[10px] text-gray-500 uppercase tracking-wide">Reference Image URLs</div>
                                        {refDetailItems.map((item: { url: string; label: string }, idx: number) => {
                                            const ref = item.url;
                                            const refDisplay = formatRefUrlForDetails(ref);
                                            return (
                                            <div key={`ref-url-${idx}`} className="flex gap-1.5">
                                                <div className="flex-1 bg-gray-900 border border-gray-800 rounded px-2 py-1 text-[9px] text-gray-400 font-mono truncate select-all">
                                                    {refDisplay}
                                                </div>
                                                <button
                                                    onClick={async () => {
                                                        const ok = await copyToClipboard(refDisplay);
                                                        if (!ok) alert('复制失败，请手动复制');
                                                    }}
                                                    className="p-1 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white rounded border border-gray-700 transition-colors"
                                                    title="Copy URL"
                                                >
                                                    <Copy size={10} />
                                                </button>
                                            </div>
                                        );
                                        })}
                                    </div>
                                  ) : null;
                                })()}
                            </div>

                            {/* Reference Videos (non-autoplay) */}
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block">
                                    Reference Videos ({(
                                      (previewParams as { referenceVideoDetailItems?: Array<{ url: string; label: string }> })
                                        .referenceVideoDetailItems?.length ??
                                      (previewParams as any).referenceMovs?.length ??
                                      0
                                    )})
                                </label>
                                {(() => {
                                  const refVideoDetailItems =
                                    (previewParams as {
                                      referenceVideoDetailItems?: Array<{
                                        url: string;
                                        posterDataUrl?: string;
                                        label: string;
                                      }>;
                                    }).referenceVideoDetailItems ||
                                    (previewParams as any).referenceMovs?.map(
                                      (m: { url: string; posterDataUrl?: string }) => ({
                                        ...m,
                                        label: '视频',
                                      })
                                    ) ||
                                    [];
                                  return refVideoDetailItems.length > 0 ? (
                                    <div className="grid grid-cols-2 gap-2">
                                        {refVideoDetailItems.map((item: { url: string; posterDataUrl?: string; label: string }, idx: number) => (
                                            <button
                                                key={`${item.url}-${idx}`}
                                                className="relative aspect-video rounded overflow-hidden border border-gray-800 bg-black group"
                                                title="点击播放（不自动播放）"
                                                onClick={() => {
                                                    setInlineRefMovPlayingUrl((prev) => (prev === item.url ? null : item.url));
                                                }}
                                            >
                                                {inlineRefMovPlayingUrl === item.url ? (
                                                    <video
                                                        src={resolveUrlForVideoCapture(item.url)}
                                                        poster={item.posterDataUrl}
                                                        controls
                                                        autoPlay
                                                        className="w-full h-full object-cover"
                                                        onError={(e) => {
                                                            const el = e.currentTarget;
                                                            if (el.dataset.fallbackDirect === '1') return;
                                                            const direct = item.url;
                                                            if (!direct) return;
                                                            el.dataset.fallbackDirect = '1';
                                                            el.src = direct;
                                                            el.load();
                                                        }}
                                                        onClick={(e) => e.stopPropagation()}
                                                    />
                                                ) : (
                                                    <div className="absolute inset-0 w-full h-full pointer-events-none">
                                                        <NodeDetailsRefMovThumb
                                                            url={item.url}
                                                            posterDataUrl={item.posterDataUrl}
                                                            className="w-full h-full min-h-[80px] object-cover"
                                                            alt={`ref-mov-${idx}`}
                                                        />
                                                    </div>
                                                )}
                                                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-80"></div>
                                                <div className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/60 text-[10px] text-gray-200 border border-gray-700/60">
                                                    {item.label || '视频'}
                                                </div>
                                                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <div className="px-3 py-1.5 rounded-full bg-black/60 border border-gray-700/60 text-xs text-white">
                                                        {inlineRefMovPlayingUrl === item.url ? '点击收起' : '点击播放'}
                                                    </div>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                  ) : (
                                    <div className="p-2 bg-gray-900/50 rounded border border-gray-800 border-dashed text-xs text-gray-600 text-center">
                                        No Reference Videos
                                    </div>
                                  );
                                })()}
                                {(() => {
                                  const refVideoDetailItems =
                                    (previewParams as {
                                      referenceVideoDetailItems?: Array<{ url: string; label: string }>;
                                    }).referenceVideoDetailItems ||
                                    (previewParams as any).referenceMovs?.map(
                                      (m: { url: string }) => ({ ...m, label: '视频' })
                                    ) ||
                                    [];
                                  return refVideoDetailItems.length > 0 ? (
                                    <div className="space-y-1">
                                        <div className="text-[10px] text-gray-500 uppercase tracking-wide">Reference Video URLs</div>
                                        {refVideoDetailItems.map((item: { url: string; label: string }, idx: number) => (
                                            <div key={`ref-mov-url-${idx}`} className="flex gap-1.5 items-center">
                                                <span className="shrink-0 px-1.5 py-0.5 rounded bg-gray-800 text-[9px] text-gray-300 border border-gray-700">
                                                    {item.label}
                                                </span>
                                                <div className="flex-1 bg-gray-900 border border-gray-800 rounded px-2 py-1 text-[9px] text-gray-400 font-mono truncate select-all">
                                                    {item.url}
                                                </div>
                                                <button
                                                    onClick={async () => {
                                                        const ok = await copyToClipboard(item.url);
                                                        if (!ok) alert('复制失败，请手动复制');
                                                    }}
                                                    className="p-1 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white rounded border border-gray-700 transition-colors"
                                                    title="Copy URL"
                                                >
                                                    <Copy size={10} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                  ) : null;
                                })()}
                            </div>

                            {/* Source URL Section */}
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block flex items-center gap-2">
                                    <LinkIcon size={12} />
                                    Source URL
                                </label>
                                <div className="flex gap-2">
                                    <div className="flex-1 bg-gray-900 border border-gray-800 rounded px-3 py-2 text-xs text-gray-400 font-mono truncate select-all">
                                        {sourceUrlForDetails || 'No Source'}
                                    </div>
                                    <button 
                                        onClick={async (e) => {
                                            if (sourceUrlForDetails) {
                                                const btn = e.currentTarget as HTMLButtonElement;
                                                const success = await copyToClipboard(sourceUrlForDetails);
                                                
                                                if (success) {
                                                    // 显示临时提示
                                                    const originalTitle = btn.getAttribute('title');
                                                    btn.setAttribute('title', 'Copied!');
                                                    setTimeout(() => {
                                                        btn.setAttribute('title', originalTitle || 'Copy URL');
                                                    }, 2000);
                                                } else {
                                                    // 如果复制失败，选中文本让用户手动复制
                                                    const urlElement = btn.previousElementSibling as HTMLElement;
                                                    if (urlElement) {
                                                        const range = document.createRange();
                                                        range.selectNodeContents(urlElement);
                                                        const selection = window.getSelection();
                                                        if (selection) {
                                                            selection.removeAllRanges();
                                                            selection.addRange(range);
                                                        }
                                                        alert('自动复制失败，已选中URL文本，请按 Ctrl+C (或 Cmd+C) 手动复制');
                                                    } else {
                                                        alert('复制失败，请手动选择并复制URL');
                                                    }
                                                }
                                            }
                                        }}
                                        className="p-2 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white rounded border border-gray-700 transition-colors"
                                        title="Copy URL"
                                    >
                                        <Copy size={14} />
                                    </button>
                                </div>
                            </div>

                            {/* Parameters Grid：按模型显示实际使用的参数，避免即梦/可灵混用生图字段 */}
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block">Used Parameters</label>
                                <div className="grid grid-cols-2 gap-3">
                                    {(() => {
                                        // 与 baseParams.model 一致：优先快照 generationParams.model，避免输出节点 selectedModel 为「下一步默认」导致误判 Seedance 2.0 并出现「生成模式」
                                        const snapshotModel = (() => {
                                          const snap = previewNode.data.generationParams?.model;
                                          return typeof snap === 'string' && snap.trim()
                                            ? snap.trim()
                                            : '';
                                        })();
                                        const model = (
                                          snapshotModel ||
                                          (previewParams.model || previewParams.selectedModel || '').trim()
                                        );
                                        const isJimeng = model.includes('即梦');
                                        const isKeling = model.includes('可灵') || model.includes('Keling');
                                        const isViduParams = model === 'vidu 2.0';
                                        const isNanoParams = isNanoBanana2Model(model);
                                        const isImage2Params = isImage2Model(model);
                                        const isSeedanceParams = ['seedance1.5-pro', 'seedance2.0 (高质量版)', 'seedance2.0 (急速版)'].includes(model);
                                        const items: { label: string; value: string | number | undefined }[] = [
                                            { label: 'Model', value: model || undefined },
                                            { label: 'Task ID', value: (previewParams as any).taskId },
                                            { label: 'Generated At', value: formatGeneratedAtForDetails((previewParams as any).generatedAt) },
                                            { label: 'Count', value: previewParams.numberOfImages },
                                        ];
                                        if (isJimeng) {
                                            items.push(
                                                { label: 'Resolution', value: previewParams.jimengResolution || previewParams.quality },
                                                { label: 'Video Ratio', value: previewParams.jimengVideoRatio },
                                                { label: 'Duration', value: previewParams.duration },
                                            );
                                        } else if (isNanoParams) {
                                            items.push(
                                                { label: 'Aspect Ratio', value: previewParams.aspectRatio },
                                                { label: 'Image Size', value: previewParams.resolution },
                                            );
                                        } else if (isImage2Params) {
                                            const requestedSize =
                                                (previewParams as GenerationParams).image2ImageSize ||
                                                previewParams.resolution;
                                            const actualSize = (previewParams as GenerationParams).outputImageSize;
                                            items.push(
                                                {
                                                    label: 'Aspect Ratio',
                                                    value:
                                                        (previewParams as GenerationParams).image2AspectRatio ||
                                                        previewParams.aspectRatio,
                                                },
                                                {
                                                    label: 'Image Size',
                                                    value: requestedSize,
                                                },
                                                ...(actualSize && actualSize !== requestedSize
                                                    ? [{ label: 'Output Size', value: actualSize }]
                                                    : []),
                                                {
                                                    label: 'Style',
                                                    value: (previewParams as GenerationParams).image2Style,
                                                },
                                                {
                                                    label: 'Quality',
                                                    value: (previewParams as GenerationParams).image2Quality,
                                                },
                                                {
                                                    label: 'Quality Level',
                                                    value: (previewParams as GenerationParams).image2QualityLevel,
                                                },
                                            );
                                        } else if (isViduParams) {
                                            items.push(
                                                { label: 'Duration', value: previewParams.viduDuration },
                                                { label: 'Clarity', value: previewParams.viduClarity },
                                                { label: 'Motion', value: previewParams.viduMotionRange },
                                                { label: 'Aspect Ratio', value: previewParams.aspectRatio },
                                            );
                                        } else if (isSeedanceParams) {
                                            const runSeedanceMode =
                                                (previewNode.data.generationParams as GenerationParams | undefined)
                                                    ?.seedanceGenerationMode ?? previewParams.seedanceGenerationMode;
                                            const isSeedance15 = model === 'seedance1.5-pro';
                                            items.push(
                                                { label: 'Resolution', value: previewParams.seedanceResolution },
                                                { label: 'Video Ratio', value: previewParams.seedanceAspectRatio },
                                                { label: 'Duration', value: previewParams.seedanceDuration },
                                                { label: 'Generate Audio', value: previewParams.seedanceGenerateAudio != null ? (previewParams.seedanceGenerateAudio ? 'Yes' : 'No') : undefined },
                                                { label: 'Fixed Camera', value: previewParams.seedanceFixedCamera != null ? (previewParams.seedanceFixedCamera ? 'Yes' : 'No') : undefined },
                                                ...(!isSeedance15
                                                    ? [{
                                                        label: '生成模式',
                                                        value: formatSeedanceGenerationModeForDetails(
                                                            runSeedanceMode,
                                                            model
                                                        ),
                                                    }]
                                                    : []),
                                                {
                                                    label: 'Web Search',
                                                    value:
                                                        previewParams.seedanceReferenceWebSearch != null
                                                            ? previewParams.seedanceReferenceWebSearch
                                                                ? 'On'
                                                                : 'Off'
                                                            : undefined,
                                                },
                                            );
                                        } else if (isKeling) {
                                            const omniTabRaw = (previewParams as GenerationParams & { klingOmniTab?: string })
                                                .klingOmniTab;
                                            items.push(
                                                ...(model === '可灵3.0 Omni'
                                                    ? [
                                                        {
                                                            label: 'Omni 标签',
                                                            value: formatKlingOmniTabForDetails(omniTabRaw),
                                                        },
                                                    ]
                                                    : []),
                                                { label: 'Quality', value: previewParams.quality },
                                                { label: 'Duration', value: previewParams.duration },
                                                { label: 'Aspect Ratio', value: previewParams.aspectRatio },
                                                { label: 'Audio Sync', value: previewParams.klingAudioSync != null ? (previewParams.klingAudioSync ? 'On' : 'Off') : undefined },
                                            );
                                        } else {
                                            items.push(
                                                { label: 'Aspect Ratio', value: previewParams.aspectRatio },
                                                { label: 'Resolution', value: previewParams.resolution },
                                                { label: 'Duration', value: previewParams.duration },
                                                { label: 'Quality', value: previewParams.quality },
                                                { label: 'Creativity', value: previewParams.creativityLevel != null ? String(previewParams.creativityLevel) : undefined },
                                            );
                                        }
                                        return items.filter((item) => item.value !== undefined && item.value !== '').map((item, i) => (
                                            <div key={i} className="bg-gray-900 p-2.5 rounded border border-gray-800 flex flex-col">
                                                <span className="text-[10px] text-gray-500 uppercase">{item.label}</span>
                                                <span className="text-sm font-medium text-gray-200">{String(item.value)}</span>
                                            </div>
                                        ));
                                    })()}
                                </div>
                            </div>
                        </div>

                        <div className="p-4 border-t border-gray-800 bg-gray-900">
                             <button 
                                className="w-full py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded border border-gray-700 text-xs font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                onClick={async (e) => {
                                    const btn = e.currentTarget;
                                    if (!previewNode.data.imagePreview) {
                                        alert('没有可下载的文件。');
                                        return;
                                    }
                                    
                                    // 禁用按钮，显示加载状态
                                    btn.disabled = true;
                                    const originalContent = btn.innerHTML;
                                    btn.innerHTML = '<svg class="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg> 正在下载...';
                                    
                                    try {
                                        await downloadNodePreviewMedia(previewNode);
                                        btn.innerHTML = originalContent;
                                        btn.disabled = false;
                                    } catch (error) {
                                        const msg = error instanceof Error ? error.message : String(error);
                                        alert(`下载失败：${msg}`);
                                        btn.innerHTML = originalContent;
                                        btn.disabled = false;
                                    }
                                }}
                             >
                                 <Download size={16} />
                                 Download Original File
                             </button>
                        </div>
                    </div>
                </div>
            </div>
        )}

        {/* 故事板关联视频预览（非队列：仅切换预览） */}
        {isVideoPlayerOpen && (
            <div className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center">
                <div className="absolute top-4 right-4 flex gap-4">
                     <button 
                        onClick={() => setIsVideoPlayerOpen(false)}
                        className="text-white/50 hover:text-white p-2 rounded-full bg-white/10 hover:bg-white/20 transition-all"
                    >
                        <X size={24} />
                    </button>
                </div>

                <div className="w-full max-w-5xl aspect-video bg-black relative shadow-2xl ring-1 ring-gray-800">
                    <video 
                        src={videoPlaylist[currentVideoIndex]}
                        className="w-full h-full object-contain"
                        controls
                        autoPlay
                        onEnded={() => {
                            if (currentVideoIndex < videoPlaylist.length - 1) {
                                setCurrentVideoIndex(prev => prev + 1);
                            }
                        }}
                    />
                    {/* 缩略条：切换预览 */}
                    <div className="absolute bottom-4 left-4 right-4 flex gap-2 overflow-x-auto p-2 bg-black/50 backdrop-blur-sm rounded-lg">
                        {videoPlaylist.map((v, idx) => (
                            <button 
                                key={idx}
                                onClick={() => setCurrentVideoIndex(idx)}
                                className={`w-16 h-10 rounded border overflow-hidden flex-shrink-0 relative ${currentVideoIndex === idx ? 'border-brand-500 ring-1 ring-brand-500' : 'border-gray-700 opacity-50 hover:opacity-100'}`}
                            >
                                <div className="absolute inset-0 bg-gray-900 flex items-center justify-center text-[8px] text-gray-500">
                                    视频 {idx + 1}
                                </div>
                                {/* Simple indicator */}
                                {currentVideoIndex === idx && <div className="absolute inset-0 bg-brand-500/20" />}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="mt-4 flex items-center gap-4 text-white">
                     <button 
                        disabled={currentVideoIndex === 0}
                        onClick={() => setCurrentVideoIndex(prev => prev - 1)}
                        className="disabled:opacity-30 hover:text-brand-400"
                     >
                        上一个
                     </button>
                     <span className="font-mono text-sm">{currentVideoIndex + 1} / {videoPlaylist.length}</span>
                     <button 
                         disabled={currentVideoIndex === videoPlaylist.length - 1}
                         onClick={() => setCurrentVideoIndex(prev => prev + 1)}
                         className="disabled:opacity-30 hover:text-brand-400"
                     >
                        下一个
                     </button>
                </div>
            </div>
        )}

        {/* Main Flex Container */}
        <div className="flex w-full h-full">
            
            {/* Left: Sidebar - Now receiving props for state */}
            <Sidebar 
              key={`${chatStorageScope.userId}:${serverProjectId || 'local'}`}
              storyboardImages={storyboardImages} 
              setStoryboardImages={setStoryboardImages} 
              selectedNode={panelSelectedNode}
              selectedNodes={isGraphSideEffectPaused ? stablePanelSelectedNodes : selectedNodes}
              updateSelectedNodesData={updateSelectedNodesData}
              onSpawnStoryboardNodesFromTable={spawnStoryboardDownstreamNodes}
              getCanvasSelectedNodes={() => getNodes().filter((n) => n.selected)}
              getCanvasNodes={() => getNodes()}
              workspaceProjectId={serverProjectId || undefined}
              getLiveTemplateData={(templateNodeId) => {
                const n = getNodes().find((x) => x.id === templateNodeId);
                return n?.data as NodeData | undefined;
              }}
              onCreateNode={handleCreateInputNode}
              canvasChatPersistence={serverProjectId ? 'server' : 'local'}
              canvasChatStorageKey={canvasChatStorageKey}
              chatStorageScope={chatStorageScope}
              initialCanvasChatV1={sidebarInitialChatV1 === undefined ? undefined : sidebarInitialChatV1}
              onCanvasChatSnapshot={serverProjectId ? onCanvasChatSnapshot : undefined}
              projectSkill={projectSkill}
              projectAssetLabelRows={projectAssetLabelRows}
            />

            {/* Middle: Canvas Area */}
            <div 
                className={`flex-1 h-full bg-gray-800 relative outline-none min-w-0${isViewportMoving ? ' flowgen-viewport-moving' : ''}${isCanvasRefreshPaused ? ' flowgen-canvas-refresh-paused' : ''}`}
                ref={setFlowCanvasWrapperRef}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                tabIndex={0}
            >
                {/* Empty State Prompt */}
                {nodes.length === 0 && (
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none z-10">
                    <div className="flex flex-col items-center justify-center p-8 rounded-3xl border-2 border-dashed border-gray-700/50 bg-gray-900/40 backdrop-blur-sm animate-[scaleIn_0.3s_ease-out]">
                        <div className="p-5 bg-gray-800/80 rounded-full mb-4 shadow-xl ring-1 ring-white/5">
                        <Clapperboard className="w-10 h-10 text-brand-500" />
                        </div>
                        <h3 className="text-xl font-bold text-gray-300 tracking-wide">拖入图片</h3>
                        <p className="text-xs text-gray-500 mt-2 font-medium tracking-wider uppercase">Drop Images</p>
                    </div>
                </div>
                )}

                {/* Node Context Menu - 必须在覆盖层之前渲染，确保事件能正常触发 */}
                <input
                  ref={storyboardExcelInputRef}
                  type="file"
                  accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  className="hidden"
                  onChange={(e) => void handleStoryboardExcelFileChange(e)}
                />

                {nodeContextMenu && (() => {
                  const storyboardMenuSubjects = nodes.filter(
                    (n) =>
                      n.selected &&
                      n.type !== NodeType.BACKDROP &&
                      n.type !== NodeType.CHAIN_FOLDER
                  );
                  const backdropMenuSubjectCount = storyboardMenuSubjects.length;
                  const storyboardTemplateNode =
                    storyboardMenuSubjects.length === 1 ? storyboardMenuSubjects[0] : null;
                  const storyboardAssetCheck = storyboardTemplateNode
                    ? checkStoryboardTemplateAssetBinding(
                        storyboardTemplateNode.data as NodeData,
                        serverProjectId ?? undefined
                      )
                    : null;
                  const storyboardTemplateReady =
                    backdropMenuSubjectCount === 1 && storyboardAssetCheck?.ok === true;
                  return (
                    <div 
                        style={{ top: nodeContextMenu.y, left: nodeContextMenu.x }} 
                        className="node-context-menu absolute z-[100] origin-top-left"
                        onClick={(e) => {
                            // 阻止点击事件冒泡到覆盖层
                            e.stopPropagation();
                        }}
                        onContextMenu={(e) => {
                            // 阻止右键事件冒泡
                            e.stopPropagation();
                        }}
                        onMouseDown={(e) => {
                            // 阻止鼠标按下事件冒泡
                            e.stopPropagation();
                        }}
                    >
                        <div className="bg-gray-900 border border-gray-700 shadow-2xl rounded-lg w-56 overflow-hidden animate-[scaleIn_0.1s_ease-out]">
                            <div className="py-1">
                                <button
                                    type="button"
                                    disabled={backdropMenuSubjectCount === 0}
                                    onClick={() => {
                                        handleCreateBackdropFromSelection();
                                    }}
                                    className={`w-full text-left px-4 py-2.5 text-xs transition-colors flex items-center gap-3 group ${
                                      backdropMenuSubjectCount === 0
                                        ? 'text-gray-600 cursor-not-allowed'
                                        : 'text-gray-300 hover:bg-amber-600/90 hover:text-white'
                                    }`}
                                >
                                    <Frame className={`w-4 h-4 ${backdropMenuSubjectCount === 0 ? 'text-gray-600' : 'text-amber-300 group-hover:text-white'}`} />
                                    <div>
                                        <div className="font-semibold">创建背景框</div>
                                        <div className="text-[9px] text-gray-500 group-hover:text-gray-300">
                                          {backdropMenuSubjectCount > 0
                                            ? `包裹已选 ${backdropMenuSubjectCount} 个节点；拖入框内可联动移动`
                                            : '请先框选画布节点（不含背景框）'}
                                        </div>
                                    </div>
                                </button>
                                <div className="h-px bg-gray-800 my-1"></div>
                                <button
                                    type="button"
                                    disabled={!storyboardTemplateReady}
                                    onClick={beginSpawnStoryboardFromExcel}
                                    className={`w-full text-left px-4 py-2.5 text-xs transition-colors flex items-center gap-3 group border-l-[3px] ${
                                      storyboardTemplateReady
                                        ? 'text-gray-300 hover:bg-lime-900/40 hover:text-white border-l-lime-400/60'
                                        : 'text-gray-600 cursor-not-allowed border-l-transparent'
                                    }`}
                                    title={
                                      storyboardTemplateReady
                                        ? '选择 Excel 分镜表，以当前节点为模板批量生成下游节点'
                                        : backdropMenuSubjectCount !== 1
                                          ? '请先选中 1 个模板节点（不含背景框）'
                                          : storyboardAssetCheck && storyboardAssetCheck.ok === false
                                            ? storyboardAssetCheck.error
                                            : '模板须使用项目资产库图片，不支持本地拖入'
                                    }
                                >
                                    <GitBranch
                                      className={`w-4 h-4 shrink-0 ${
                                        storyboardTemplateReady
                                          ? 'text-lime-400 group-hover:text-lime-300'
                                          : 'text-gray-600'
                                      }`}
                                      strokeWidth={2.5}
                                    />
                                    <div>
                                        <div className="font-semibold">按分镜表生成下游节点</div>
                                        <div className="text-[9px] text-gray-500 group-hover:text-gray-300">
                                          {storyboardTemplateReady
                                            ? '从 Excel 导入分镜表（.xlsx）'
                                            : backdropMenuSubjectCount !== 1
                                              ? '需选中 1 个模板节点'
                                              : '须为项目资产库图片'}
                                        </div>
                                    </div>
                                </button>
                                <div className="h-px bg-gray-800 my-1"></div>
                                <button 
                                    onClick={handleExportNodes}
                                    className="w-full text-left px-4 py-2.5 text-xs text-gray-300 hover:bg-green-600 hover:text-white transition-colors flex items-center gap-3 group"
                                >
                                    <Download className="w-4 h-4 text-green-400 group-hover:text-white" />
                                    <div>
                                        <div className="font-semibold">导出节点</div>
                                        <div className="text-[9px] text-gray-500 group-hover:text-gray-300">Export Selected Nodes</div>
                                    </div>
                                </button>
                            </div>
                        </div>
                    </div>
                  );
                })()}

                {/* Search/Context Menu (Add Node) */}
                {menu && (
                <div 
                    style={{ top: menu.y, left: menu.x }} 
                    className="absolute z-50 origin-top-left"
                >
                    <div className="bg-gray-900 border border-gray-700 shadow-2xl rounded-xl w-64 overflow-hidden animate-[scaleIn_0.15s_ease-out]">
                    <div className="p-3 border-b border-gray-800 flex items-center justify-between bg-gray-850">
                        <div className="flex items-center gap-2">
                        <Search className="w-4 h-4 text-brand-500" />
                        <span className="text-xs text-gray-300 font-semibold tracking-wide">ADD NODE</span>
                        </div>
                        <button onClick={closeMenu} className="text-gray-500 hover:text-white"><X size={14}/></button>
                    </div>
                    
                    <div className="p-2 flex flex-col gap-1 max-h-64 overflow-y-auto custom-scrollbar">
                        <button 
                        onClick={() => addNodeFromMenu(NodeType.PROCESSOR, 'GenAI Node')}
                        className="flex items-center gap-3 px-3 py-2.5 text-sm text-gray-300 hover:bg-brand-600 hover:text-white rounded-lg transition-all text-left group"
                        >
                        <UploadCloud className="w-5 h-5 text-purple-400 group-hover:text-white" />
                        <div className="flex flex-col">
                            <span className="font-medium leading-none mb-1">Image Node</span>
                            <span className="text-[10px] text-gray-500 group-hover:text-gray-300">With Model & Copilot</span>
                        </div>
                        </button>
                    </div>
                    </div>
                </div>
                )}

                {/* Run Schedule Dropdown Menu */}
                {runScheduleMenu && (() => {
                  const options = getRunScheduleOptions();
                  const queueCount =
                    runScheduleMenu.action === 'selected'
                      ? selectedRunQueueCount
                      : storyboardRunQueueCount;
                  return (
                    <div
                      className="run-schedule-menu fixed z-[120] origin-top-left"
                      style={{ top: runScheduleMenu.y, left: runScheduleMenu.x }}
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <div className="bg-gray-900 border border-gray-700 shadow-2xl rounded-lg w-64 overflow-hidden animate-[scaleIn_0.1s_ease-out]">
                        <div className="px-3 py-2 text-[10px] text-gray-500 border-b border-gray-800 flex items-center gap-2">
                          <Clock className="w-3.5 h-3.5" /> 选择定时运行时间
                        </div>
                        <div className="py-1">
                          {options.map((opt, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => {
                                handleScheduleRun(runScheduleMenu.action, opt.delayMs);
                                setRunScheduleMenu(null);
                              }}
                              className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-800 flex items-center justify-between group"
                            >
                              <div className="flex items-center gap-2">
                                <Clock className="w-4 h-4 text-brand-400/70 group-hover:text-brand-400" />
                                <span className="font-medium">{opt.label}</span>
                              </div>
                              <span className="text-xs text-gray-500 font-mono tabular-nums">{opt.sub}</span>
                            </button>
                          ))}
                          <div className="h-px bg-gray-800 my-1 mx-2" />
                          <button
                            type="button"
                            onClick={() => openCustomTimePicker(runScheduleMenu.action)}
                            className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-800 flex items-center gap-2 group border-l-[3px] border-l-brand-500/60"
                          >
                            <Calendar className="w-4 h-4 text-brand-400/70 group-hover:text-brand-400" />
                            <span className="font-medium">自定义时间…</span>
                            <span className="ml-auto text-[10px] text-gray-500">手动设置</span>
                          </button>
                        </div>
                        <div className="px-3 py-1.5 text-[10px] text-gray-600 border-t border-gray-800">
                          将定时启动 {queueCount} 个节点，每隔 {BATCH_RUN_NODE_INTERVAL_MS / 1000}s 启动下一个
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Custom Time Picker */}
                {customTimePicker && (
                  <div
                    className="run-schedule-menu fixed z-[130] origin-top-left"
                    style={{ top: (runScheduleMenu?.y ?? window.innerHeight / 2) - 80, left: (runScheduleMenu?.x ?? window.innerWidth / 2) - 140 }}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <div className="bg-gray-900 border border-gray-700 shadow-2xl rounded-xl w-72 overflow-hidden">
                      <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2 text-sm text-gray-200">
                        <Calendar className="w-4 h-4 text-brand-400" /> 手动设置启动时间
                      </div>
                      <div className="p-4 space-y-3">
                        <div>
                          <div className="text-xs text-gray-500 mb-1">启动时间（本地时间）</div>
                          <input
                            ref={customTimeInputRef}
                            type="datetime-local"
                            step="60"
                            defaultValue={customTimePicker.defaultValue}
                            className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-brand-500"
                          />
                        </div>
                        <div className="text-[10px] text-gray-500">
                          将定时启动{' '}
                          {customTimePicker.action === 'selected'
                            ? selectedRunQueueCount
                            : storyboardRunQueueCount}{' '}
                          个节点（{customTimePicker.action === 'selected' ? '选择运行' : '全部运行'}）
                        </div>
                      </div>
                      <div className="flex border-t border-gray-800">
                        <button
                          type="button"
                          onClick={() => setCustomTimePicker(null)}
                          className="flex-1 py-2.5 text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
                        >
                          取消
                        </button>
                        <div className="w-px bg-gray-800" />
                        <button
                          type="button"
                          onClick={confirmCustomTime}
                          className="flex-1 py-2.5 text-sm text-brand-300 hover:text-white hover:bg-brand-600/80 transition-colors font-medium"
                        >
                          确定定时
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Drag Overlay */}
                {isDragOver && (
                <div className="absolute inset-0 z-40 pointer-events-none bg-brand-500/10 border-4 border-dashed border-brand-500/50 rounded-lg flex items-center justify-center backdrop-blur-[2px] transition-all">
                    <div className="flex flex-col items-center gap-4 animate-bounce">
                        <div className="p-6 bg-gray-900 rounded-full border-2 border-brand-500 shadow-[0_0_30px_rgba(99,102,241,0.3)]">
                        <UploadCloud className="w-16 h-16 text-brand-500" />
                        </div>
                        <p className="text-3xl font-bold text-white tracking-tight drop-shadow-lg">Drop Image to Create Node</p>
                    </div>
                </div>
                )}

                {/* 覆盖层：只在菜单显示时显示，用于点击空白区域关闭菜单 */}
                {/* 关键问题：覆盖层在菜单显示时就会出现，可能会拦截节点右键事件 */}
                {/* 解决方案：将覆盖层移到 ReactFlow 之后渲染，并确保不拦截节点右键事件 */}

                {/* 分镜队列运行：每 15s 启动下一镜，可多镜并行直至全部结束 */}
                {isGlobalRunning && (
                    <div className="absolute top-4 left-4 z-50 max-w-[min(calc(100%-2rem),420px)] bg-black/80 backdrop-blur-md border border-brand-500/50 px-4 py-2 rounded-full flex items-center gap-3 shadow-[0_0_20px_rgba(99,102,241,0.3)] animate-in fade-in slide-in-from-left-4 pointer-events-none">
                        <div className="relative">
                            <div className="w-2.5 h-2.5 bg-brand-500 rounded-full animate-ping absolute inset-0 opacity-75"></div>
                            <div className="w-2.5 h-2.5 bg-brand-500 rounded-full relative"></div>
                        </div>
                        <span className="text-xs font-semibold text-brand-100">
                          {batchRunProgress
                            ? batchRunKind === 'selected'
                              ? `选择运行 ${batchRunProgress.current}/${batchRunProgress.total}（间隔 ${BATCH_RUN_NODE_INTERVAL_MS / 1000}s）`
                              : `分镜队列 ${batchRunProgress.current}/${batchRunProgress.total}（间隔 ${BATCH_RUN_NODE_INTERVAL_MS / 1000}s）`
                            : batchRunKind === 'selected'
                              ? '选择运行收尾中…'
                              : '分镜队列收尾中…'}
                        </span>
                        <div className="h-4 w-px bg-white/20"></div>
                        <span className="text-[10px] text-gray-400">按 <span className="text-white font-bold border border-gray-600 rounded px-1">ESC</span> 可中断启动</span>
                    </div>
                )}

                <ReactFlow
                    nodes={flowDisplayNodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    onConnectStart={onConnectStart}
                    onConnectEnd={onConnectEnd}
                    onPaneClick={onPaneClick}
                    onPaneContextMenu={onPaneContextMenu}
                    onSelectionContextMenu={onSelectionContextMenu}
                    onSelectionStart={onSelectionStart}
                    onSelectionEnd={onSelectionEnd}
                    onSelectionChange={onSelectionChange}
                    onNodeContextMenu={onNodeContextMenu}
                    onNodeDragStart={handleNodeDragStart}
                    onNodeDrag={onBackdropDrag}
                    onNodeDragStop={handleNodeDragStop}
                    onMoveStart={handleViewportMoveStart}
                    onMove={handleViewportMove}
                    onMoveEnd={handleViewportMoveEnd}
                    onNodeDoubleClick={onNodeDoubleClick}
                    onNodeClick={onNodeClick}
                    nodeTypes={flowEditorNodeTypes}
                    edgeTypes={flowEditorEdgeTypes}
                    connectionLineComponent={CustomConnectionLine}
                    fitView={shouldFitViewOnInit}
                    onlyRenderVisibleElements
                    minZoom={0.08}
                    maxZoom={4}
                    zoomOnScroll
                    panOnDrag={isAltMiddlePanActive ? [1] : !isSelectionMode}
                    selectionOnDrag={isSelectionMode && !isAltMiddlePanActive}
                    selectionMode={SelectionMode.Partial}
                    selectionKeyCode={null}
                    selectNodesOnDrag={false}
                    className={`bg-gray-850 ${isAltMiddlePanActive ? 'alt-middle-pan-active' : ''}`}
                    proOptions={flowEditorProOptions}
                    deleteKeyCode={['Backspace', 'Delete']}
                    multiSelectionKeyCode={['Control', 'Meta', 'Shift']}
                >
                <Background 
                    variant={BackgroundVariant.Dots} 
                    gap={20} 
                    size={1.5} 
                    color="#4a5568" 
                />
                <Controls className="!bg-gray-800 !border-gray-700 !fill-gray-300 [&>button]:!border-b-gray-700 hover:[&>button]:!bg-gray-700 hover:[&>button]:!fill-white" />
                <FlowgenMiniMap
                  nodeColor={(n) => {
                    if (n.type === NodeType.BACKDROP) return '#78716c';
                    if (n.selected) return '#22d3ee';
                    return '#818cf8';
                  }}
                  nodeStrokeColor={(n) => (n.selected ? '#f0f9ff' : '#4338ca')}
                  nodeStrokeWidth={3}
                  nodeBorderRadius={4}
                  className="!absolute !bottom-[15px] !right-[230px] !left-auto !top-auto !m-0 !h-auto !w-[200px] !bg-gray-800 !border-gray-700 !rounded-lg !shadow-xl"
                  maskColor="rgba(15, 23, 42, 0.5)"
                  maskStrokeColor="rgb(34, 211, 238)"
                  maskStrokeWidth={2}
                  pannable
                  zoomable
                />
                
                {showManualSaveReminder && (
                <Panel position="top-left">
                        <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border border-amber-500/40 rounded-lg shadow-lg">
                            <div className="w-2 h-2 bg-amber-400 rounded-full animate-pulse"></div>
                            <span className="text-[11px] text-amber-200">建议保存工程，避免意外崩溃导致进度丢失</span>
                            <button
                                onClick={() => void handleSaveProject()}
                                className="text-[11px] text-amber-100 hover:text-white underline underline-offset-2"
                            >
                                立即保存
                            </button>
                            <button
                                onClick={() => {
                                    lastManualSaveReminderAtRef.current = Date.now();
                                    setShowManualSaveReminder(false);
                                }}
                                className="ml-1 text-amber-200 hover:text-white"
                                title="稍后提醒"
                            >
                                <X size={14} />
                            </button>
                        </div>
                </Panel>
                )}

                <Panel position="top-right" className="flex gap-4 items-start flex-wrap justify-end max-w-[min(100vw-1rem,960px)]">

                    {/* Organization Tools */}
                    <div className="flex bg-gray-800 rounded-lg p-1 border border-gray-700 shadow-lg">
                        <button 
                            type="button"
                            onClick={() => serverProjectId && setAssetLibraryOpen(true)}
                            disabled={!serverProjectId}
                            className={`p-2 rounded-md transition-all text-gray-400 hover:text-white hover:bg-gray-700/50 ${
                              !serverProjectId ? 'opacity-30 cursor-not-allowed' : ''
                            }`}
                            title={serverProjectId ? '项目资产库' : '登录并从项目列表进入后可使用资产库'}
                        >
                            <ImagePlus size={18} />
                        </button>
                        <div className="w-px bg-gray-700 mx-1 my-1" />
                        <button 
                            onClick={() => arrangeNodesByType(NodeType.INPUT)}
                            disabled={isLayouting}
                            className={`p-2 rounded-md transition-all text-gray-400 hover:text-white hover:bg-gray-700/50 ${
                              isLayouting ? 'opacity-40 cursor-not-allowed pointer-events-none' : ''
                            }`}
                            title="输入/处理网格：第 1 次为排序并打组；第 2 次为同序再排序后，按与单点「下游」相同规则依次展开各链（右侧纵向排布 + 自动让位）；之后交替。"
                        >
                            <LayoutGrid size={18} />
                        </button>
                        <button 
                            onClick={() => arrangeNodesByType(NodeType.MOV)}
                            disabled={isLayouting}
                            className={`p-2 rounded-md transition-all text-gray-400 hover:text-white hover:bg-gray-700/50 ${
                              isLayouting ? 'opacity-40 cursor-not-allowed pointer-events-none' : ''
                            }`}
                            title="末端输出网格：仅对最后一层 OUTPUT/MOV（无下游）排序。第 1 次打组其上游，第 2 次恢复可见并同序重排；之后交替。"
                        >
                            <Film size={18} />
                        </button>
                        <div className="w-px bg-gray-700 mx-1 my-1"></div>
                        <button 
                            onClick={handleAutoLayoutAll}
                            disabled={isLayouting}
                            className={`p-2 rounded-md transition-all text-purple-400 hover:text-white hover:bg-purple-500/20 ${
                              isLayouting ? 'opacity-40 cursor-not-allowed pointer-events-none' : ''
                            }`}
                            title="全图分层自动布局；再点一次还原。选中节点竖排请按 L 键"
                        >
                            <Workflow size={18} />
                        </button>
                    </div>

                    {/* Mode Toggle */}
                    <div className="flex bg-gray-800 rounded-lg p-1 border border-gray-700 shadow-lg">
                        <button 
                            onClick={() => setIsSelectionMode(false)}
                            className={`p-2 rounded-md transition-all ${!isSelectionMode ? 'bg-gray-700 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/50'}`}
                            title="Hand Tool (Pan)"
                        >
                            <Hand size={18} />
                        </button>
                        <button 
                            onClick={() => setIsSelectionMode(true)}
                            className={`p-2 rounded-md transition-all ${isSelectionMode ? 'bg-brand-600 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/50'}`}
                            title="Pointer Tool (Select)"
                        >
                            <MousePointer size={18} />
                        </button>
                    </div>

                    <div className="flex gap-2">
                        {isGlobalRunning ? (
                             <button 
                                onClick={() => stopExecutionRef.current = true}
                                className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white px-5 py-2.5 rounded-lg font-semibold shadow-lg transition-all animate-pulse"
                            >
                                <StopCircle size={18} fill="currentColor" /> 停止
                            </button>
                        ) : (
                            <>
                            {renderRunQueueSplitButton('selected', {
                              icon: <MousePointer size={18} />,
                              label: '选择运行',
                              count: selectedRunQueueCount,
                              disabled: selectedRunQueueCount === 0,
                              mainTitle:
                                selectedRunQueueCount === 0
                                  ? '请选中 INPUT/PROCESSOR 节点并填写创意描述'
                                  : `立即运行已选 ${selectedRunQueueCount} 个节点（每 ${BATCH_RUN_NODE_INTERVAL_MS / 1000}s 启动下一个）`,
                              scheduleTitle: '选择定时运行时间',
                              shellClass:
                                selectedRunQueueCount === 0
                                  ? 'border-gray-700 opacity-60'
                                  : 'border-gray-600 hover:border-brand-500/40',
                              mainClass:
                                selectedRunQueueCount === 0
                                  ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                                  : 'bg-gray-800 hover:bg-gray-700 text-white',
                              chevronClass:
                                selectedRunQueueCount === 0
                                  ? 'border-gray-700 bg-gray-800 text-gray-600 cursor-not-allowed'
                                  : 'border-gray-600 bg-gray-800/90 hover:bg-gray-700 text-gray-300 hover:text-white',
                            })}
                            {renderRunQueueSplitButton('all', {
                              icon: <Play size={18} fill="currentColor" />,
                              label: '全部运行',
                              count: storyboardRunQueueCount,
                              disabled: storyboardRunQueueCount === 0,
                              mainTitle:
                                storyboardRunQueueCount === 0
                                  ? '没有可运行的绿色分镜节点（需有创意描述且无 OUTPUT/MOV 下游）'
                                  : `立即运行 ${storyboardRunQueueCount} 个绿色分镜节点（每 ${BATCH_RUN_NODE_INTERVAL_MS / 1000}s 启动下一镜）`,
                              scheduleTitle: '选择定时运行时间',
                              shellClass:
                                storyboardRunQueueCount === 0
                                  ? 'border-gray-700 opacity-60'
                                  : 'border-brand-400/20',
                              mainClass:
                                storyboardRunQueueCount === 0
                                  ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                                  : 'bg-gradient-to-r from-brand-600 to-brand-500 hover:from-brand-500 hover:to-brand-400 text-white',
                              chevronClass:
                                storyboardRunQueueCount === 0
                                  ? 'border-gray-700 bg-gray-800 text-gray-600 cursor-not-allowed'
                                  : 'border-brand-400/30 bg-brand-600/90 hover:bg-brand-500 text-brand-100 hover:text-white',
                            })}
                            {pendingScheduledRun && (
                              <div
                                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-200/90 text-xs"
                                title={`${pendingScheduledRun.nodeIds.length} 个节点`}
                              >
                                <Clock className="w-3.5 h-3.5 shrink-0" />
                                <span className="font-mono tabular-nums">
                                  {new Date(pendingScheduledRun.fireAt).toLocaleTimeString([], {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </span>
                                <span>
                                  {pendingScheduledRun.action === 'selected' ? '选择' : '全部'}×
                                  {pendingScheduledRun.nodeIds.length}
                                </span>
                                <button
                                  type="button"
                                  className="text-amber-300/80 hover:text-white underline"
                                  onClick={() => {
                                    if (scheduledRunTimeoutRef.current) {
                                      clearTimeout(scheduledRunTimeoutRef.current);
                                      scheduledRunTimeoutRef.current = null;
                                    }
                                    setPendingScheduledRun(null);
                                    setScheduledRunBadgeNodeIds(null);
                                  }}
                                >
                                  取消
                                </button>
                              </div>
                            )}
                            </>
                        )}
                        
                        <button 
                            onClick={clearCanvas}
                            className="p-2.5 bg-gray-800 hover:bg-red-500/20 text-gray-400 hover:text-red-400 rounded-lg border border-gray-700 transition-colors"
                            title="Clear Canvas"
                        >
                            <Trash2 size={20} />
                        </button>
                        <button 
                            onClick={() => void handleDownloadSelected()}
                            disabled={selectedDownloadableCount === 0}
                            className={`p-2.5 rounded-lg border border-gray-700 transition-colors ${
                              selectedDownloadableCount === 0
                                ? 'bg-gray-800/60 text-gray-600 cursor-not-allowed'
                                : 'bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white'
                            }`}
                            title={
                              selectedDownloadableCount === 0
                                ? '请先框选带图片或视频预览的节点'
                                : `下载已选 ${selectedDownloadableCount} 个节点的图片或视频`
                            }
                        >
                            <Download size={20} />
                        </button>
                    </div>
                </Panel>
                </ReactFlow>
                
                {/* 覆盖层：只在菜单显示时出现，确保不拦截节点右键事件 */}
                {/* 关键：覆盖层应该在 ReactFlow 之后渲染，这样节点事件会先处理 */}
                {/* 但是，覆盖层不应该在框选后出现，只有在菜单显示时才出现 */}
                {(menu || nodeContextMenu || runScheduleMenu || customTimePicker) && (
                    <div 
                        className="absolute inset-0 z-40" 
                        style={{
                            // 关键：使用 pointer-events: none 让节点区域的事件能穿透
                            // 但这样会阻止点击关闭菜单，所以我们需要在 onClick 中检查
                            pointerEvents: 'auto',
                        }}
                        onClick={(e) => {
                            // 如果点击的是菜单本身或节点，不关闭菜单
                            const target = e.target as HTMLElement;
                            if (target.closest('.node-context-menu') || 
                                target.closest('.run-schedule-menu') ||
                                target.closest('.bg-gray-900.border.border-gray-700') ||
                                target.closest('.react-flow__node')) {
                                return;
                            }
                            setCustomTimePicker(null);
                            onPaneClick(e);
                        }}
                        // 关键：不添加 onContextMenu，让节点右键事件能正常触发
                        // ReactFlow 的节点事件会在覆盖层之前处理，所以节点右键应该能正常工作
                        // 但是，如果覆盖层在 DOM 中位于节点之后，它仍然可能拦截事件
                        // 所以我们需要确保覆盖层不会阻止节点上的右键事件
                        onContextMenu={(e) => {
                            // 如果右键点击的是节点，不处理，让节点右键事件处理
                            const target = e.target as HTMLElement;
                            if (target.closest('.react-flow__node')) {
                                // 不阻止默认行为，让节点右键事件处理
                                return;
                            }
                            // 如果右键点击的是空白区域，阻止默认行为
                            e.preventDefault();
                        }}
                    />
                )}
            </div>

            {/* Save Project Dialog */}
            {showSaveDialog && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[10000] flex items-center justify-center">
                    <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-6 w-96 max-w-[90vw]">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                                <Save className="w-5 h-5 text-green-400" />
                                保存工程
                            </h3>
                            <button
                                onClick={closeSaveDialog}
                                className="text-gray-400 hover:text-white transition-colors"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">
                                    文件名
                                </label>
                                <input
                                    type="text"
                                    value={saveFileName}
                                    onChange={(e) => setSaveFileName(e.target.value)}
                                    placeholder="flowgen-project-2024-01-01"
                                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                                    autoFocus
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            handleSaveProject();
                                        } else if (e.key === 'Escape') {
                                            closeSaveDialog();
                                        }
                                    }}
                                />
                                <p className="text-xs text-gray-500 mt-1">
                                    将自动添加 .json 扩展名
                                </p>
                            </div>
                            
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">
                                    保存路径
                                </label>
                                <div className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-400 text-sm">
                                    {saveFilePath
                                      ? saveFilePath
                                      : ('showOpenFilePicker' in window)
                                        ? '未关联本地文件：保存时可选择路径；用「打开工程」选文件后可写回原位置'
                                        : '将在浏览器默认下载文件夹中保存（可在下载对话框中修改路径）'}
                                </div>
                            </div>
                        </div>
                        
                        <div className="flex gap-3 mt-6">
                            <button
                                onClick={closeSaveDialog}
                                className="flex-1 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors"
                            >
                                取消
                            </button>
                            <button
                                onClick={() => void handleSaveProject()}
                                className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors font-medium"
                            >
                                保存
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Right: Inspector Area */}
            {inspectorPanelNode && (
                <div
                    className="flex-shrink-0 h-full min-h-0 border-l border-gray-800 bg-gray-900 relative overflow-hidden"
                    style={{ width: inspectorWidth }}
                >
                    {inspectorPanelNode.type === NodeType.CHAIN_FOLDER ? (
                        <div className="p-4 space-y-3 h-full overflow-y-auto custom-scrollbar">
                            <div className="flex items-center gap-2 border-b border-gray-800 pb-3">
                                <Layers className="text-violet-400 w-4 h-4" />
                                <h2 className="font-bold text-sm text-gray-200">链路折叠</h2>
                            </div>
                            <p className="text-xs text-gray-400 leading-relaxed">
                                收纳当前输入/处理节点之后的下游节点。在画布上点击「下游 (n)」将按既定顺序在根节点右侧展开，并移除本打组标识；与展开区域重叠的其它节点会自动右移。需要重新打组时可再点左侧网格排序按钮。
                            </p>
                            <p className="text-[10px] text-gray-500 font-mono">
                                子节点数：{(inspectorPanelNode.data.chainFolderChildIds || []).length}
                            </p>
                        </div>
                    ) : (
                    <ErrorBoundary>
                    <Suspense fallback={
                        <div className="p-4 text-xs text-gray-500">
                            正在加载节点面板...
                        </div>
                    }>
                    <NodeInspector 
                        nodeId={inspectorPanelNode!.id} 
                        data={inspectorPanelNode!.data} 
                        nodeType={inspectorPanelNode!.type}
                        onUpdate={(newData) => updateNodeDataById(inspectorPanelNode!.id, newData)}
                        onRun={async (nodeId: string) => handleNodeRun(nodeId)}
                        projectAssetRefItems={projectAssetRefItems}
                        projectAssetLabelRows={projectAssetLabelRows}
                        projectAssetLibraryEnabled={!!serverProjectId}
                    />
                    </Suspense>
                    </ErrorBoundary>
                    )}
                    <button
                        type="button"
                        aria-label="拖动调整属性面板宽度"
                        title="拖动调整宽度"
                        onMouseDown={startResizeInspector}
                        className="absolute top-0 left-0 z-40 h-full w-2 -ml-px cursor-col-resize border-0 bg-transparent p-0 hover:bg-brand-500/20 focus:outline-none focus-visible:bg-brand-500/25"
                    />
                </div>
            )}
        </div>
    {serverProjectId ? (
      <ProjectAssetLibrary
        projectId={serverProjectId}
        open={assetLibraryOpen}
        canManageAssets={canManageProjectAssets(getStoredUser()?.role)}
        onClose={() => setAssetLibraryOpen(false)}
        onChanged={() => void reloadProjectAssets()}
        onCreateNodesFromAssets={(items) => {
          const base = screenToFlowPosition({
            x: window.innerWidth / 2,
            y: window.innerHeight / 2,
          });
          void createNodesFromAssetItems(base, items);
        }}
      />
    ) : null}
    </DragDropContext.Provider>
  );
};

export default function FlowEditorWrapper(props: FlowEditorProps) {
  return (
    <ReactFlowProvider>
      <FlowEditor {...props} />
    </ReactFlowProvider>
  );
}