/** image2 模型：画面比例与图像尺寸联动（对齐 OPEN_AI_GPT_IMAGE_2_QUALITY API） */

/** API image[] 与面板可见格合计上限 */
export const IMAGE2_MAX_API_IMAGES = 4;

/** AiTop platform（满血版） */
export const AITOP_PLATFORM_IMAGE_2 = 'OPEN_AI_GPT_IMAGE_2_QUALITY';

export const IMAGE2_QUALITY_OPTIONS = ['1K', '2K', '4K'] as const;
export type Image2Quality = (typeof IMAGE2_QUALITY_OPTIONS)[number];

export const IMAGE2_QUALITY_LEVEL_OPTIONS = ['low', 'medium', 'high'] as const;
export type Image2QualityLevel = (typeof IMAGE2_QUALITY_LEVEL_OPTIONS)[number];

/** 各清晰度 × 比例 → API size 像素 */
export const IMAGE2_QUALITY_ASPECT_TO_SIZE: Record<Image2Quality, Record<string, string>> = {
  '1K': {
    '1:1': '1024x1024',
    '5:4': '1520x1216',
    '9:16': '864x1536',
    '21:9': '1456x624',
    '16:9': '1536x864',
    '4:3': '1536x1152',
    '3:2': '1536x1024',
    '4:5': '1216x1520',
    '3:4': '1152x1536',
    '2:3': '1024x1536',
  },
  '2K': {
    '1:1': '2048x2048',
    '5:4': '1920x1536',
    '9:16': '1152x2048',
    '21:9': '2016x864',
    '16:9': '2048x1152',
    '4:3': '2048x1536',
    '3:2': '2016x1344',
    '4:5': '1536x1920',
    '3:4': '1536x2048',
    '2:3': '1344x2016',
  },
  '4K': {
    '1:1': '2880x2880',
    '5:4': '3200x2560',
    '9:16': '2160x3840',
    '21:9': '3696x1584',
    '16:9': '3840x2160',
    '4:3': '3264x2448',
    '3:2': '3504x2336',
    '4:5': '2560x3200',
    '3:4': '2448x3264',
    '2:3': '2336x3504',
  },
};

/** 1K 比例表（向后兼容别名） */
export const IMAGE2_ASPECT_TO_SIZE = IMAGE2_QUALITY_ASPECT_TO_SIZE['1K'];

export const IMAGE2_ASPECT_OPTIONS = Object.keys(IMAGE2_ASPECT_TO_SIZE) as Array<
  keyof typeof IMAGE2_ASPECT_TO_SIZE
>;
export type Image2Aspect = (typeof IMAGE2_ASPECT_OPTIONS)[number];

export const IMAGE2_SIZE_OPTIONS = [...Object.values(IMAGE2_ASPECT_TO_SIZE), 'auto'] as const;
export type Image2ImageSize = (typeof IMAGE2_SIZE_OPTIONS)[number];

/** 旧版 OPEN_AI_GPT_IMAGE_2 误用尺寸 → 1K canonical（不含现网 2K/4K 合法值） */
const LEGACY_IMAGE2_SIZE_TO_CANONICAL: Record<string, string> = {
  '3840x2160': '1536x864',
  '2160x3840': '864x1536',
  '1792x1024': '1536x864',
};

function aspectTableForQuality(quality: Image2Quality): Record<string, string> {
  return IMAGE2_QUALITY_ASPECT_TO_SIZE[quality];
}

/** 非 auto 尺寸 → 所属清晰度（含 legacy 映射后） */
export function image2InferQualityFromSize(size: string | undefined): Image2Quality | null {
  const cur = String(size || '').trim();
  if (!cur || cur === 'auto') return null;
  const migrated = image2MigrateLegacyImageSize(cur);
  for (const q of IMAGE2_QUALITY_OPTIONS) {
    if (Object.values(aspectTableForQuality(q)).includes(migrated)) return q;
  }
  return null;
}

/** 构建全 tier 尺寸 → 比例 反查表 */
function buildSizeToAspectMap(): Record<string, Image2Aspect> {
  const out: Record<string, Image2Aspect> = {};
  for (const q of IMAGE2_QUALITY_OPTIONS) {
    for (const [ar, sz] of Object.entries(aspectTableForQuality(q))) {
      out[sz] = ar as Image2Aspect;
    }
  }
  for (const [legacySz, canonical] of Object.entries(LEGACY_IMAGE2_SIZE_TO_CANONICAL)) {
    if (out[canonical]) out[legacySz] = out[canonical];
  }
  return out;
}

const SIZE_TO_ASPECT: Record<string, Image2Aspect> = buildSizeToAspectMap();

export function image2NormalizeQuality(quality: string | undefined): Image2Quality {
  const q = String(quality || '').trim().toUpperCase();
  if ((IMAGE2_QUALITY_OPTIONS as readonly string[]).includes(q)) return q as Image2Quality;
  return '1K';
}

export function image2NormalizeQualityLevel(level: string | undefined): Image2QualityLevel {
  const lv = String(level || '').trim().toLowerCase();
  if ((IMAGE2_QUALITY_LEVEL_OPTIONS as readonly string[]).includes(lv)) return lv as Image2QualityLevel;
  return 'medium';
}

/** 缺 quality 字段时：优先从 size 推断，否则 1K */
export function image2ResolveQuality(
  quality: string | undefined,
  imageSize: string | undefined
): Image2Quality {
  const normalized = String(quality || '').trim();
  if ((IMAGE2_QUALITY_OPTIONS as readonly string[]).includes(normalized.toUpperCase())) {
    return normalized.toUpperCase() as Image2Quality;
  }
  return image2InferQualityFromSize(imageSize) ?? '1K';
}

function image2AspectForSizeInQuality(size: string, quality: Image2Quality): Image2Aspect | null {
  const migrated = image2MigrateLegacyImageSize(size);
  if (!migrated || migrated === 'auto') return null;
  const table = aspectTableForQuality(quality);
  for (const [ar, sz] of Object.entries(table)) {
    if (sz === migrated) return ar as Image2Aspect;
  }
  return SIZE_TO_ASPECT[migrated] ?? null;
}

export function image2CanonicalSizeForAspect(
  aspect: string,
  quality: string | undefined = '1K'
): string {
  const normalized = image2NormalizeAspectRatio(aspect);
  const q = image2NormalizeQuality(quality);
  return aspectTableForQuality(q)[normalized] ?? IMAGE2_ASPECT_TO_SIZE[normalized];
}

/** 某比例 + 清晰度下可选尺寸：canonical + auto */
export function image2SizesForAspect(aspect: string, quality: string | undefined = '1K'): string[] {
  const normalized = image2NormalizeAspectRatio(aspect);
  const q = image2NormalizeQuality(quality);
  const canonical = aspectTableForQuality(q)[normalized];
  return canonical ? [canonical, 'auto'] : ['auto'];
}

/** 未知比例回退 1:1 */
export function image2NormalizeAspectRatio(aspect: string | undefined): Image2Aspect {
  const ar = String(aspect || '').trim();
  if ((IMAGE2_ASPECT_OPTIONS as readonly string[]).includes(ar)) return ar as Image2Aspect;
  return '1:1';
}

export function image2MigrateLegacyImageSize(size: string | undefined): string {
  const cur = String(size || '').trim();
  if (!cur || cur === 'auto') return cur;
  return LEGACY_IMAGE2_SIZE_TO_CANONICAL[cur] || cur;
}

/** 返回 null 表示 auto 或与表无关 */
export function image2AspectForSize(size: string, quality?: string): Image2Aspect | null {
  const migrated = image2MigrateLegacyImageSize(size);
  if (!migrated || migrated === 'auto') return null;
  if (quality) {
    return image2AspectForSizeInQuality(migrated, image2NormalizeQuality(quality));
  }
  return SIZE_TO_ASPECT[migrated] ?? null;
}

/** 切换比例/清晰度后：若当前尺寸不在允许集合则回退到该比例 canonical 尺寸 */
export function image2CoerceSizeForAspect(
  aspect: string,
  currentSize: string | undefined,
  quality: string | undefined = '1K'
): string {
  const normalized = image2NormalizeAspectRatio(aspect);
  const q = image2NormalizeQuality(quality);
  const allowed = image2SizesForAspect(normalized, q);
  const cur = image2MigrateLegacyImageSize(currentSize);
  if (cur && allowed.includes(cur)) return cur;
  return aspectTableForQuality(q)[normalized] || 'auto';
}
