import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Film } from 'lucide-react';
import { isLikelyMainVideoUrl } from '../utils/promptMediaRefs';
import { isUsableReferenceMovPoster } from '../utils/nodeDetailsPreview';
import { resolveUrlForVideoCapture } from '../utils/videoThumbnail';
import { captureVideoMiddleFrameQueued } from '../utils/videoPosterQueue';

/** 避免 Inspector 重渲染时同一 src 反复回到 loading 态 */
const omniThumbPosterCache = new Map<string, string>();

/** 参考格内是否为视频（勿将 blob 图片误判为视频；与 isLikelyMainVideoUrl 一致） */
export function isOmniVideoItemUrl(url: string): boolean {
  if (!url) return false;
  if (url.startsWith('data:image/')) return false;
  return isLikelyMainVideoUrl(url);
}

/**
 * 可灵 Omni 侧栏：用多时间点截帧生成 poster，避免 <video> 首帧黑屏 / <img> 加载视频 URL 无效。
 */
export const KlingOmniVideoThumb = React.memo(function KlingOmniVideoThumb({
  src,
  className = '',
  alt = '',
}: {
  src: string;
  className?: string;
  alt?: string;
}) {
  const [poster, setPoster] = useState<string | null>(() => omniThumbPosterCache.get(src) ?? null);
  const [failed, setFailed] = useState(false);
  const fallbackTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const cached = omniThumbPosterCache.get(src);
    if (cached) {
      setPoster(cached);
      setFailed(false);
      return;
    }
    setPoster(null);
    setFailed(false);
    if (fallbackTimerRef.current != null) {
      window.clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
    // 快速降级：避免属性面板长时间“转圈”
    fallbackTimerRef.current = window.setTimeout(() => {
      if (!cancelled) setFailed(true);
    }, 1200);
    // 对 blob URL 仍尝试截帧生成 poster：拖入本地视频时 blob 通常短期可用；
    // 刷新后失效的问题已通过“自动保存时清理 blob”兜底。
    captureVideoMiddleFrameQueued(src).then((u) => {
      if (cancelled) return;
      if (fallbackTimerRef.current != null) {
        window.clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
      if (u) {
        omniThumbPosterCache.set(src, u);
        setPoster(u);
      } else setFailed(true);
    });
    return () => {
      cancelled = true;
      if (fallbackTimerRef.current != null) {
        window.clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
    };
  }, [src]);

  if (poster) {
    return <img src={poster} alt={alt} className={className} />;
  }
  if (failed) {
    const displaySrc = resolveUrlForVideoCapture(src);
    return (
      <div className={`relative overflow-hidden bg-gray-900 ${className}`}>
        <video
          src={displaySrc}
          className="absolute inset-0 w-full h-full object-cover"
          muted
          playsInline
          preload="auto"
          controls
          autoPlay
          loop
          onError={() => {
            // 静默失败：blob 失效/跨域等不再向控制台抛噪音
          }}
        />
        <div className="absolute right-1 bottom-1 rounded bg-black/45 p-0.5 pointer-events-none">
          <Film className="w-3.5 h-3.5 text-white/80" />
        </div>
      </div>
    );
  }
  return (
    <div className={`flex items-center justify-center bg-gray-900 ${className}`}>
      <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
    </div>
  );
});

/** Node Details「Reference Videos」：优先 poster；无效或加载失败时回退截帧 */
export function NodeDetailsRefMovThumb({
  url,
  posterDataUrl,
  className = '',
  alt = '',
}: {
  url: string;
  posterDataUrl?: string;
  className?: string;
  alt?: string;
}) {
  const poster = isUsableReferenceMovPoster(posterDataUrl, url) ? posterDataUrl!.trim() : undefined;
  const [posterBroken, setPosterBroken] = useState(false);

  if (poster && !posterBroken) {
    return (
      <img
        src={poster}
        alt={alt}
        className={className}
        onError={() => setPosterBroken(true)}
      />
    );
  }
  return <KlingOmniVideoThumb src={url} className={className} alt={alt} />;
}
