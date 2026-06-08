/** image2 模型：画面比例与图像尺寸（清晰度）联动规则 */

export const IMAGE2_ASPECT_OPTIONS = [
  '1:1',
  '4:3',
  '3:4',
  '3:2',
  '2:3',
  '16:9',
  '9:16',
  '21:9',
] as const;
export type Image2Aspect = (typeof IMAGE2_ASPECT_OPTIONS)[number];

export const IMAGE2_SIZE_OPTIONS = [
  '1024x1024',
  '1536x1024',
  '1024x1536',
  '2048x2048',
  '2048x1152',
  '3840x2160',
  '2160x3840',
  'auto',
] as const;
export type Image2ImageSize = (typeof IMAGE2_SIZE_OPTIONS)[number];

/** 某比例下可选的清晰度（列表外尺寸视为不合法，需纠正） */
const ASPECT_TO_SIZES: Record<string, readonly string[]> = {
  '1:1': ['1024x1024', '2048x2048', 'auto'],
  /** 列表内无严格 4:3/3:4/21:9 像素规格时仅保留 auto，避免比例与像素矛盾 */
  '4:3': ['auto'],
  '3:4': ['auto'],
  '21:9': ['auto'],
  '3:2': ['1536x1024', 'auto'],
  '2:3': ['1024x1536', 'auto'],
  '16:9': ['2048x1152', '3840x2160', 'auto'],
  '9:16': ['2160x3840', 'auto'],
};

/** 非 auto 尺寸隐含的画面比例 */
const SIZE_TO_ASPECT: Record<string, Image2Aspect> = {
  '1024x1024': '1:1',
  '2048x2048': '1:1',
  '1536x1024': '3:2',
  '1024x1536': '2:3',
  '2048x1152': '16:9',
  '3840x2160': '16:9',
  '2160x3840': '9:16',
};

export function image2SizesForAspect(aspect: string): string[] {
  return [...(ASPECT_TO_SIZES[aspect] || ['auto'])];
}

/** 返回 null 表示 auto 或与表无关 */
export function image2AspectForSize(size: string): Image2Aspect | null {
  if (!size || size === 'auto') return null;
  return SIZE_TO_ASPECT[size] ?? null;
}

/** 切换比例后：若当前尺寸不在允许集合则回退到该比例下第一项 */
export function image2CoerceSizeForAspect(aspect: string, currentSize: string | undefined): string {
  const allowed = image2SizesForAspect(aspect);
  const cur = (currentSize || '').trim();
  if (cur && allowed.includes(cur)) return cur;
  return allowed[0] || 'auto';
}
