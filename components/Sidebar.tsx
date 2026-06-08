import React, { Suspense, useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { X, Clapperboard, GripVertical, Film, Loader2, Video, Play, Pause, MessageSquare } from 'lucide-react';
import type { UpdateSelectedNodesDataFn, SpawnStoryboardNodesFromTableFn } from './ChatPanel';
import type { PersistedCanvasChatV1 } from './ChatPanel';
import type { ChatStorageScope } from '../utils/chatStorageScope';
import type { ProjectSkillConfig } from '../utils/projectSkill';
import type { ProjectAssetLabelRow } from '../utils/referenceImageSlotLabels';
import { FLOWGEN_MEDIA_URL_DROP, type FlowgenMediaUrlDropDetail } from '../utils/middleButtonMediaDrag';
import { resolveUrlForVideoCapture } from '../utils/videoThumbnail';

// --- Helper: Format Time ---
const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
};

import { Node as RFNode } from 'reactflow';
import { NodeData } from '../types';

interface SidebarProps {
    storyboardImages: string[];
    setStoryboardImages: React.Dispatch<React.SetStateAction<string[]>>;
    selectedNode: RFNode | null;
    selectedNodes: RFNode[];
    updateSelectedNodesData: UpdateSelectedNodesDataFn;
    onSpawnStoryboardNodesFromTable?: SpawnStoryboardNodesFromTableFn;
    getCanvasSelectedNodes?: () => RFNode[];
    getCanvasNodes?: () => RFNode[];
    workspaceProjectId?: string;
    getLiveTemplateData?: (templateNodeId: string) => NodeData | undefined;
    onCreateNode?: (imageUrl: string) => void; // 创建节点的回调函数
    canvasChatPersistence?: 'local' | 'server';
    canvasChatStorageKey?: string;
    chatStorageScope?: ChatStorageScope;
    initialCanvasChatV1?: PersistedCanvasChatV1 | null;
    onCanvasChatSnapshot?: (body: PersistedCanvasChatV1) => void;
    projectSkill?: ProjectSkillConfig | null;
    projectAssetLabelRows?: ProjectAssetLabelRow[];
}

function revokeIfBlobUrl(url: string | null | undefined) {
  if (typeof url === 'string' && url.startsWith('blob:')) {
    URL.revokeObjectURL(url);
  }
}

const SIDEBAR_WIDTH_LS_KEY = 'flowgen:sidebar-width-px';
/** 与原先 Tailwind w-96 一致 */
const SIDEBAR_W_DEFAULT = 384;
const SIDEBAR_W_MIN = 280;
/** 绝对上限；实际宽度还受视口约束（见 clamp） */
const SIDEBAR_W_MAX = 1200;
const ChatPanel = React.lazy(() => import('./ChatPanel').then((mod) => ({ default: mod.ChatPanel })));

function clampSidebarWidth(px: number): number {
  if (typeof window === 'undefined') {
    return Math.min(SIDEBAR_W_MAX, Math.max(SIDEBAR_W_MIN, px));
  }
  const w = window.innerWidth;
  // 画布至少保留约 180px；宽屏上侧栏最多约占窗口 82%，避免单栏占满
  const maxByViewport = Math.max(SIDEBAR_W_MIN + 40, Math.min(Math.floor(w * 0.82), w - 180));
  const cap = Math.min(SIDEBAR_W_MAX, maxByViewport);
  return Math.min(cap, Math.max(SIDEBAR_W_MIN, Math.round(px)));
}

function readStoredSidebarWidth(): number {
  if (typeof window === 'undefined') return SIDEBAR_W_DEFAULT;
  const raw = localStorage.getItem(SIDEBAR_WIDTH_LS_KEY);
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return SIDEBAR_W_DEFAULT;
  return clampSidebarWidth(n);
}

// --- Main Sidebar Component ---
export const Sidebar = ({
  storyboardImages,
  setStoryboardImages,
  selectedNode,
  selectedNodes,
  updateSelectedNodesData,
  onSpawnStoryboardNodesFromTable,
  getCanvasSelectedNodes,
  getCanvasNodes,
  workspaceProjectId,
  getLiveTemplateData,
  onCreateNode,
  canvasChatPersistence = 'local',
  canvasChatStorageKey,
  chatStorageScope,
  initialCanvasChatV1,
  onCanvasChatSnapshot,
  projectSkill = null,
  projectAssetLabelRows,
}: SidebarProps) => {
  // Drag State
  const [isDragOverStoryboard, setIsDragOverStoryboard] = useState(false);
  const [draggedStoryboardIndex, setDraggedStoryboardIndex] = useState<number | null>(null);

  // Selection State
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const lastSelectedIndex = useRef<number | null>(null);

  // --- Video Extraction State ---
  const [videoModalOpen, setVideoModalOpen] = useState(false);
  const [pendingVideo, setPendingVideo] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  
  // Player State
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Tab State
  const [activeTab, setActiveTab] = useState<'storyboard' | 'chat'>('chat');
  const STORYBOARD_DROP_TARGET_ID = 'sidebar-storyboard-drop';

  const [sidebarWidth, setSidebarWidth] = useState(readStoredSidebarWidth);
  const sidebarWidthRef = useRef(sidebarWidth);
  sidebarWidthRef.current = sidebarWidth;

  useEffect(() => {
    const onResize = () => setSidebarWidth((w) => clampSidebarWidth(w));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const startResizeSidebar = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidthRef.current;
    let last = startW;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      last = clampSidebarWidth(startW + (ev.clientX - startX));
      setSidebarWidth(last);
    };
    const onUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      try {
        localStorage.setItem(SIDEBAR_WIDTH_LS_KEY, String(last));
      } catch {
        /* ignore */
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  // Clean up object URL when modal closes
  useEffect(() => {
    if (!videoModalOpen && videoUrl) {
      // 仅回收本地 blob URL；远程 http(s) URL 不需要回收
      revokeIfBlobUrl(videoUrl);
      setVideoUrl(null);
      setPendingVideo(null);
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
    }
  }, [videoModalOpen, videoUrl]);

  // 组件卸载或 videoUrl 切换时释放上一条 blob URL（不影响远程 URL）
  useEffect(() => {
    return () => {
      revokeIfBlobUrl(videoUrl);
    };
  }, [videoUrl]);

  // 中键从节点拖出视频 URL，投放到「分镜视频」区域
  useEffect(() => {
    const onWin = (ev: Event) => {
      const d = (ev as CustomEvent<FlowgenMediaUrlDropDetail>).detail;
      if (!d || d.dropZone !== 'storyboard-video' || d.targetNodeId !== STORYBOARD_DROP_TARGET_ID) return;
      if (d.kind !== 'video') return;
      setPendingVideo(null);
      setVideoUrl(d.url);
      setVideoModalOpen(true);
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
    };
    window.addEventListener(FLOWGEN_MEDIA_URL_DROP, onWin);
    return () => window.removeEventListener(FLOWGEN_MEDIA_URL_DROP, onWin);
  }, []);

  // --- STORYBOARD DRAG & DROP ---  
  const handleStoryboardDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOverStoryboard(false);
    
    const files = Array.from(e.dataTransfer.files);
    const videoFiles = files.filter(file => file.type.startsWith('video/'));
    
    if (videoFiles.length > 0) {
      const videoFile = videoFiles[0];
      setPendingVideo(videoFile);
      // 创建视频 URL 用于播放
      const url = URL.createObjectURL(videoFile);
      setVideoUrl(url);
      setVideoModalOpen(true);
    }
  };

  // --- STORYBOARD SORTING ---
  const handleStoryboardSortStart = (e: React.DragEvent, index: number) => {
    setDraggedStoryboardIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleStoryboardSortOver = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggedStoryboardIndex === null || draggedStoryboardIndex === targetIndex) return;
    
    const newImages = [...storyboardImages];
    const [draggedImage] = newImages.splice(draggedStoryboardIndex, 1);
    newImages.splice(targetIndex, 0, draggedImage);
    
    setStoryboardImages(newImages);
    setDraggedStoryboardIndex(targetIndex);
  };

  const handleStoryboardDragEnd = () => {
    setDraggedStoryboardIndex(null);
  };

  // --- STORYBOARD SELECTION ---
  const handleImageClick = (e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    
    if (e.shiftKey && lastSelectedIndex.current !== null) {
      // Shift+Click: Select range
      const start = Math.min(lastSelectedIndex.current, index);
      const end = Math.max(lastSelectedIndex.current, index);
      const newSel = new Set<number>();
      for (let i = start; i <= end; i++) newSel.add(i);
      setSelectedIndices(newSel);
    } else if (e.ctrlKey || e.metaKey) {
      // Ctrl/Cmd+Click: Toggle selection
      const newSel = new Set(selectedIndices);
      if (newSel.has(index)) newSel.delete(index);
      else newSel.add(index);
      setSelectedIndices(newSel);
    } else {
      // Single Click: Select only this item
      const alreadySingleSelected =
        selectedIndices.size === 1 && selectedIndices.has(index);
      if (!alreadySingleSelected) {
        setSelectedIndices(new Set([index]));
      }
    }
    
    lastSelectedIndex.current = index;
  };

  /** 播放与截帧同源 URL：远程视频走 /proxy-file，避免 canvas 被 CORS 污染导致 toBlob 失败 */
  const videoCaptureSrc = useMemo(
    () => (videoUrl ? resolveUrlForVideoCapture(videoUrl) : undefined),
    [videoUrl]
  );

  // --- VIDEO PROCESSING ---
  const handleExtractCurrentFrame = async () => {
    if (!videoRef.current) return;

    setIsExtracting(true);

    try {
      const video = videoRef.current;
      if (video.videoWidth <= 0 || video.videoHeight <= 0) {
        throw new Error('视频尚未解码出画面，请稍候再试或先播放几秒');
      }
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('无法创建画布上下文');

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise<Blob | null>((resolve, reject) => {
        try {
          canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.8);
        } catch (e) {
          reject(e);
        }
      });
      if (!blob) {
        throw new Error(
          '导出帧失败（可能仍为跨域资源）。请确认开发/部署环境已启用 /proxy-file 代理，或改用本地上传的视频文件。'
        );
      }

      const url = URL.createObjectURL(blob);
      setStoryboardImages((prev) => [...prev, url]);

      if (onCreateNode) {
        onCreateNode(url);
      }

      setVideoModalOpen(false);
    } catch (error) {
    } finally {
      setIsExtracting(false);
    }
  };

  // --- VIDEO PLAYER CONTROLS ---
  const togglePlay = () => {
    if (!videoRef.current) return;
    
    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play();
    }
    setIsPlaying((prev) => !prev);
  };

  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const t = videoRef.current.currentTime;
    setCurrentTime((prev) => (Math.abs(prev - t) > 0.02 ? t : prev));
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!videoRef.current) return;
    
    const newTime = parseFloat(e.target.value);
    videoRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const handleLoadedMetadata = () => {
    if (!videoRef.current) return;
    const d = videoRef.current.duration;
    setDuration((prev) => (Math.abs(prev - d) > 0.001 ? d : prev));
  };

  // --- REMOVE STORYBOARD IMAGE ---
  const removeStoryboardImage = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const newImages = [...storyboardImages];
    const toRemove = newImages[index];
    revokeIfBlobUrl(typeof toRemove === 'string' ? toRemove : null);
    newImages.splice(index, 1);
    setStoryboardImages(newImages);
    
    // Update selection indices
    const newSel = new Set<number>();
    selectedIndices.forEach(i => {
      if (i < index) newSel.add(i);
      else if (i > index) newSel.add(i - 1);
    });
    setSelectedIndices(newSel);
    
    if (lastSelectedIndex.current === index) {
      lastSelectedIndex.current = null;
    } else if (lastSelectedIndex.current !== null && lastSelectedIndex.current > index) {
      lastSelectedIndex.current--;
    }
  };

  return (
    <aside
      className="flex-shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col h-full z-10 shadow-2xl overflow-hidden select-none relative"
      style={{ width: sidebarWidth }}
    >
      
      {/* Tab Navigation - 高级设计 */}
      <div className="border-b border-gray-800/50 bg-gradient-to-r from-gray-900 via-gray-900 to-gray-950 relative backdrop-blur-sm">
        <div className="flex relative">
          {/* 活动指示器 */}
          <div 
            className={`absolute bottom-0 h-0.5 bg-gradient-to-r from-brand-500 to-purple-500 transition-all duration-300 ease-in-out ${
              activeTab === 'storyboard' ? 'left-0 w-1/2' : 'left-1/2 w-1/2'
            }`}
          />
          <button
            onClick={() => setActiveTab('storyboard')}
            className={`flex-1 py-3.5 px-4 flex items-center justify-center gap-2 text-sm font-semibold transition-all duration-300 ease-in-out relative ${
              activeTab === 'storyboard'
                ? 'text-white'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            <Clapperboard 
              className={`w-4 h-4 transition-all duration-300 ${
                activeTab === 'storyboard' ? 'text-orange-400' : 'text-gray-500'
              }`} 
              strokeWidth={activeTab === 'storyboard' ? 2.5 : 2}
            />
            <span>分镜视频</span>
          </button>
          <button
            onClick={() => setActiveTab('chat')}
            className={`flex-1 py-3.5 px-4 flex items-center justify-center gap-2 text-sm font-semibold transition-all duration-300 ease-in-out relative ${
              activeTab === 'chat'
                ? 'text-white'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            <MessageSquare 
              className={`w-4 h-4 transition-all duration-300 ${
                activeTab === 'chat' ? 'text-brand-400' : 'text-gray-500'
              }`} 
              strokeWidth={activeTab === 'chat' ? 2.5 : 2}
            />
            <span>AI对话</span>
          </button>
        </div>
      </div>

      {/* Tab Content */}
      <div
        className={`flex-1 min-h-0 bg-gray-900 overflow-hidden relative ${
          activeTab === 'storyboard' ? 'flex flex-col' : 'hidden'
        }`}
      >
          <div className="p-4 pb-2 flex-none">
            <div className="flex items-center gap-2">
              <Clapperboard className="text-orange-400 w-4 h-4" />
              <h2 className="font-bold text-xs tracking-wider text-gray-400 uppercase">分镜视频 Storyboard</h2>
            </div>
            <p className="text-[10px] text-gray-500 mt-1">拖入视频文件或中键拖入视频节点，截取关键帧</p>
          </div>

          <div 
            className="flex-1 mx-3 mb-4 rounded-lg border-2 border-dashed overflow-y-auto custom-scrollbar relative transition-all"
            data-flowgen-media-drop="1"
            data-flowgen-node-id={STORYBOARD_DROP_TARGET_ID}
            data-flowgen-drop-zone="storyboard-video"
            onDrop={handleStoryboardDrop}
            onDragOver={(e) => {
              e.preventDefault();
              if (!isDragOverStoryboard) setIsDragOverStoryboard(true);
            }}
            onDragLeave={() => {
              if (isDragOverStoryboard) setIsDragOverStoryboard(false);
            }}
            onClick={() => {
              if (selectedIndices.size > 0) setSelectedIndices(new Set());
            }}
          >
            {storyboardImages.length === 0 ? (
               <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-600 gap-2 pointer-events-none">
                  <Video className="w-8 h-8 opacity-40 mb-1" />
                  <span className="text-[10px] opacity-60 font-medium">拖入分镜视频</span>
                  <span className="text-[9px] opacity-40">Drop Video Only</span>
               </div>
            ) : (
              <div className="p-2 space-y-2">
                {storyboardImages.map((img, idx) => {
                  const isSelected = selectedIndices.has(idx);
                  return (
                      <div 
                        key={idx}
                        draggable
                        onDragStart={(e) => handleStoryboardSortStart(e, idx)}
                        onDragOver={(e) => handleStoryboardSortOver(e, idx)}
                        onDragEnd={handleStoryboardDragEnd}
                        onClick={(e) => handleImageClick(e, idx)}
                        className="relative flex items-center gap-3 p-2 rounded border group cursor-pointer transition-colors"
                      >
                        <GripVertical className="w-4 h-4 flex-shrink-0 cursor-grab active:cursor-grabbing" />
                        
                        {/* Thumbnail */}
                        <div className="w-16 h-12 rounded overflow-hidden bg-black flex-shrink-0 border shadow-sm">
                           <img src={img} className="w-full h-full object-cover" alt="storyboard frame" />
                        </div>
                        
                        {/* Info */}
                        <div className="flex-1 min-w-0 flex flex-col justify-center">
                           <div className="text-[10px] font-bold font-mono">FRAME {String(idx + 1).padStart(2, '0')}</div>
                           <div className="text-[9px] text-gray-500 truncate">Extracted Keyframe</div>
                        </div>
                        
                        {/* Actions */}
                        <button 
                          onClick={(e) => removeStoryboardImage(idx, e)}
                          className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-500/20 rounded text-gray-500 hover:text-red-400 transition-all"
                        >
                          <X size={14} />
                        </button>
                      </div>
                  );
                })}
              </div>
            )}
          </div>
      </div>

      <div
        className={`h-full min-h-0 bg-gray-900 overflow-hidden select-text ${
          activeTab === 'chat' ? 'flex flex-col' : 'hidden'
        }`}
      >
        <Suspense
          fallback={
            <div className="h-full flex items-center justify-center text-xs text-gray-500">
              正在加载聊天面板...
            </div>
          }
        >
          <ChatPanel 
            selectedNode={selectedNode} 
            selectedNodes={selectedNodes}
            getCanvasSelectedNodes={getCanvasSelectedNodes}
            getCanvasNodes={getCanvasNodes}
            workspaceProjectId={workspaceProjectId}
            updateSelectedNodesData={updateSelectedNodesData}
            getLiveTemplateData={getLiveTemplateData}
            onSpawnStoryboardNodesFromTable={onSpawnStoryboardNodesFromTable}
            canvasChatPersistence={canvasChatPersistence}
            canvasChatStorageKey={canvasChatStorageKey}
            chatStorageScope={chatStorageScope}
            initialCanvasChatV1={initialCanvasChatV1}
            onCanvasChatSnapshot={onCanvasChatSnapshot}
            projectSkill={projectSkill}
            projectAssetLabelRows={projectAssetLabelRows}
          />
        </Suspense>
      </div>

      {/* Video Extraction Modal - 显示在侧边栏上方 */}
      {videoModalOpen && (pendingVideo || videoUrl) && (
        <div
          className="fixed left-0 top-0 h-full bg-black/60 backdrop-blur-sm z-[200] flex items-start justify-center pt-20"
          style={{ width: sidebarWidth }}
        >
          <div className="bg-gray-900 rounded-xl border border-gray-700 shadow-2xl w-[calc(100%-2rem)] max-w-sm overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-3 border-b border-gray-800">
              <div className="flex items-center gap-2">
                <Film className="text-orange-400 w-4 h-4" />
                <h3 className="text-xs font-bold text-white">视频帧提取</h3>
              </div>
              <button
                onClick={() => setVideoModalOpen(false)}
                className="p-1 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Video Player */}
            <div className="p-4">
              <div className="relative bg-black rounded-lg overflow-hidden mb-3 aspect-video">
                <video
                  ref={videoRef}
                  src={videoCaptureSrc}
                  className="w-full h-full object-contain"
                  muted
                  playsInline
                  preload="auto"
                  onLoadedMetadata={handleLoadedMetadata}
                  onTimeUpdate={handleTimeUpdate}
                  onEnded={() => setIsPlaying(false)}
                />
              </div>

              {/* Controls */}
              <div className="space-y-3">
                {/* Time Slider */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-400 font-mono min-w-[50px]">
                    {formatTime(currentTime)}
                  </span>
                  <input
                    type="range"
                    min="0"
                    max={duration || 0}
                    value={currentTime}
                    onChange={handleSeek}
                    className="flex-1 h-1.5 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-orange-500"
                  />
                  <span className="text-[10px] text-gray-400 font-mono min-w-[50px]">
                    {formatTime(duration)}
                  </span>
                </div>

                {/* Control Buttons */}
                <div className="flex items-center justify-center gap-2">
                  <button
                    onClick={togglePlay}
                    className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-orange-600 to-orange-500 hover:from-orange-500 hover:to-orange-400 text-white font-semibold text-xs flex items-center gap-1.5 transition-all shadow-lg hover:shadow-orange-500/30"
                  >
                    {isPlaying ? (
                      <>
                        <Pause size={14} />
                        <span>暂停</span>
                      </>
                    ) : (
                      <>
                        <Play size={14} />
                        <span>播放</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={handleExtractCurrentFrame}
                    disabled={isExtracting}
                    className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-brand-600 to-purple-600 hover:from-brand-500 hover:to-purple-500 text-white font-semibold text-xs flex items-center gap-1.5 transition-all shadow-lg hover:shadow-brand-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isExtracting ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        <span>提取中...</span>
                      </>
                    ) : (
                      <>
                        <Film size={14} />
                        <span>提取当前帧</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <button
        type="button"
        aria-label="拖动调整侧栏宽度"
        title="拖动调整宽度"
        onMouseDown={startResizeSidebar}
        className="absolute top-0 right-0 z-40 h-full w-2 -mr-px cursor-col-resize border-0 bg-transparent p-0 hover:bg-brand-500/20 focus:outline-none focus-visible:bg-brand-500/25"
      />
    </aside>
  );
};