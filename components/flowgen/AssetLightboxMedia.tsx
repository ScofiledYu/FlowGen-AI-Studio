import React, { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, Loader2 } from 'lucide-react';
import { getAssetFileBlob, withAssetAccessToken } from '../../services/flowgenApi';
type LightboxAsset = {
  id: string;
  name: string;
  url: string;
  thumbUrl?: string;
  mime: string;
};

/**
 * 大图预览：用 Authorization fetch 拉原文件（img 直链带 token 在部分环境会 401/裂图）。
 */
export function AssetLightboxMedia({ asset }: { asset: LightboxAsset }) {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    setSrc(null);
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }

    void (async () => {
      try {
        const blob = await getAssetFileBlob(asset.url);
        if (cancelled) return;
        const objectUrl = URL.createObjectURL(blob);
        blobUrlRef.current = objectUrl;
        setSrc(objectUrl);
      } catch {
        const fallback = asset.thumbUrl
          ? withAssetAccessToken(asset.thumbUrl)
          : withAssetAccessToken(asset.url);
        if (!cancelled) setSrc(fallback);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [asset.id, asset.url, asset.thumbUrl]);

  if (loading) {
    return (
      <div className="flex h-[40vh] min-w-[200px] items-center justify-center text-gray-400">
        <Loader2 className="h-10 w-10 animate-spin text-brand-400" />
      </div>
    );
  }

  if (failed || !src) {
    return (
      <div className="flex h-[40vh] min-w-[200px] flex-col items-center justify-center gap-2 text-gray-500">
        <ImageIcon className="h-12 w-12 opacity-40" />
        <p className="text-sm">预览加载失败</p>
      </div>
    );
  }

  if (asset.mime.startsWith('video/')) {
    return (
      <video
        src={src}
        controls
        autoPlay
        playsInline
        className="max-h-[78vh] max-w-[92vw] rounded-lg object-contain shadow-2xl"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <img
      src={src}
      alt={asset.name}
      className="max-h-[78vh] max-w-[92vw] rounded-lg object-contain shadow-2xl"
      draggable={false}
      onError={() => {
        const fallback = asset.thumbUrl ? withAssetAccessToken(asset.thumbUrl) : null;
        if (fallback && src !== fallback) {
          setSrc(fallback);
          return;
        }
        setFailed(true);
      }}
    />
  );
}
