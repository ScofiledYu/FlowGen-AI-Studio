import type { NodeData } from '../types';

/** 指令变换 tab 专用视频（待编辑 base），与「视频参考」槽位字段独立 */
export function getOmniInstructionVideoDisplayUrl(d: NodeData): string | undefined {
  const x = d as NodeData & {
    klingOmniInstructionVideoPreviewUrl?: string;
    klingOmniInstructionVideoUrl?: string;
  };
  return x.klingOmniInstructionVideoPreviewUrl || x.klingOmniInstructionVideoUrl;
}

/** 视频参考 tab 专用视频（feature），不含指令槽 */
export function getOmniVideoTabDisplayUrl(d: NodeData): string | undefined {
  return d.klingOmniVideoPreviewUrl || d.klingOmniVideoUrl;
}

/**
 * 旧数据只有 klingOmniVideoUrl：迁入指令槽并清空原字段，使两 tab 独立展示。
 * 若已存在指令专用字段则不动。
 */
export function migrateLegacyOmniVideoToInstructionSlot(data: NodeData): Partial<NodeData> | null {
  const x = data as NodeData & {
    klingOmniInstructionVideoPreviewUrl?: string;
    klingOmniInstructionVideoUrl?: string;
  };
  if (x.klingOmniInstructionVideoUrl || x.klingOmniInstructionVideoPreviewUrl) return null;
  if (!x.klingOmniVideoUrl && !x.klingOmniVideoPreviewUrl) return null;
  return {
    klingOmniInstructionVideoUrl: x.klingOmniVideoUrl,
    klingOmniInstructionVideoPreviewUrl: x.klingOmniVideoPreviewUrl,
    klingOmniVideoUrl: undefined,
    klingOmniVideoPreviewUrl: undefined,
  };
}

/** 指令变换 API：指令槽优先，否则兼容旧单字段 */
export function resolveOmniInstructionRunVideoUrl(d: NodeData): string | undefined {
  const x = d as NodeData & {
    klingOmniInstructionVideoPreviewUrl?: string;
    klingOmniInstructionVideoUrl?: string;
  };
  return (
    x.klingOmniInstructionVideoUrl ||
    x.klingOmniInstructionVideoPreviewUrl ||
    x.klingOmniVideoUrl ||
    x.klingOmniVideoPreviewUrl
  );
}

/** 视频参考 API：仅用视频参考槽（勿混入指令槽） */
export function resolveOmniVideoTabRunVideoUrl(d: NodeData): string | undefined {
  return d.klingOmniVideoUrl || d.klingOmniVideoPreviewUrl;
}
