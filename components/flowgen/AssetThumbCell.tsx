import React, { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import {
  getCachedAssetThumbDisplayUrl,
  getDirectAssetThumbSrc,
  loadAssetThumbDisplayUrl,
} from '../../utils/assetThumbLoader';
import { isImageAssetMime, normalizeAssetMime } from '../../utils/assetMime';
import { withAssetAccessToken } from '../../services/flowgenApi';
/**
 * 资产库网格：图片走服务端 /thumb（小图 + HTTP 缓存）；视频仍懒加载原文件。
 */
export function AssetThumbCell({
  fileUrl,
  thumbUrl,
  mime,
  assetId,
  assetName,
  fileOnDisk = true,
  onMiddleDragStart,
}: {
  fileUrl: string;
  thumbUrl?: string;
  mime: string;
  assetId: string;
  assetName: string;
  fileOnDisk?: boolean;
  onMiddleDragStart: (e: React.PointerEvent) => void;
}) {
  const displayMime = normalizeAssetMime(mime, assetName || fileUrl);
  const directSrc = getDirectAssetThumbSrc(thumbUrl, displayMime);
  const rootRef = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null>(
    () => directSrc ?? getCachedAssetThumbDisplayUrl(fileUrl, thumbUrl) ?? null
  );
  const [failed, setFailed] = useState(false);
  const imgFallbackRef = useRef<'thumb' | 'file' | 'done'>('thumb');

  useEffect(() => {
    if (!fileOnDisk) {
      setSrc(null);
      setFailed(true);
      return;
    }
    imgFallbackRef.current = 'thumb';
    setFailed(false);
    const direct = getDirectAssetThumbSrc(thumbUrl, displayMime);
    if (direct) {
      setSrc(direct);
      return;
    }
    const cached = getCachedAssetThumbDisplayUrl(fileUrl, thumbUrl);
    if (cached) {
      setSrc(cached);
      return;
    }
    setSrc(null);

    const el = rootRef.current;
    if (!el) return;

    let cancelled = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        void loadAssetThumbDisplayUrl(fileUrl, displayMime, thumbUrl)
          .then((url) => {
            if (!cancelled) setSrc(url);
          })
          .catch(() => {
            if (!cancelled) setFailed(true);
          });
      },
      { root: null, rootMargin: '240px', threshold: 0.01 }
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [fileUrl, thumbUrl, mime, displayMime, assetName, fileOnDisk]);

  const handleImgError = () => {
    if (!isImageAssetMime(displayMime, assetName || fileUrl)) {
      setFailed(true);
      return;
    }
    if (imgFallbackRef.current === 'thumb') {
      imgFallbackRef.current = 'file';
      setSrc(withAssetAccessToken(fileUrl));
      return;
    }
    if (imgFallbackRef.current === 'file') {
      imgFallbackRef.current = 'done';
      void loadAssetThumbDisplayUrl(fileUrl, displayMime, thumbUrl)
        .then((url) => setSrc(url))
        .catch(() => setFailed(true));
      return;
    }
    setFailed(true);
  };

  return (
    <div
      ref={rootRef}
      className="absolute inset-0 flex items-center justify-center bg-gray-900 select-none"
      onDragStart={(e) => e.preventDefault()}
      onPointerDownCapture={(e) => {
        if (e.button !== 1) return;
        onMiddleDragStart(e);
      }}
    >
      {src && !failed ? (
        isImageAssetMime(displayMime, assetName || fileUrl) ? (
          <img
            src={src}
            alt=""
            draggable={false}
            className="w-full h-full object-cover pointer-events-none"
            decoding="async"
            loading="lazy"
            fetchPriority={directSrc ? 'high' : 'auto'}
            onError={handleImgError}
          />
        ) : (
          <video
            src={src}
            draggable={false}
            className="w-full h-full object-cover pointer-events-none"
            muted
            playsInline
            preload="metadata"
          />
        )
      ) : (
        <div className="w-full h-full animate-pulse bg-gradient-to-br from-gray-800 to-gray-900 flex flex-col items-center justify-center gap-1 px-2 text-center">
          <ImageIcon className="w-10 h-10 text-gray-700 shrink-0" />
          {!fileOnDisk ? (
            <span className="text-[9px] text-amber-500/90 leading-tight">文件缺失<br />请删除后重传</span>
          ) : null}
        </div>
      )}
    </div>
  );
}
