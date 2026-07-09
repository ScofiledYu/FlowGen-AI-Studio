/**
 * image2 画面比例 ↔ 图像尺寸联动 + API 4 图上限 + 满血版 quality 档位
 * npx tsx scripts/image2-model-aspect-size-test.ts
 */
import {
  AITOP_PLATFORM_IMAGE_2,
  IMAGE2_ASPECT_OPTIONS,
  IMAGE2_ASPECT_TO_SIZE,
  IMAGE2_MAX_API_IMAGES,
  IMAGE2_QUALITY_ASPECT_TO_SIZE,
  image2AspectForSize,
  image2CanonicalSizeForAspect,
  image2CoerceSizeForAspect,
  image2InferQualityFromSize,
  image2MigrateLegacyImageSize,
  image2NormalizeAspectRatio,
  image2NormalizeQuality,
  image2NormalizeQualityLevel,
  image2ResolveQuality,
  image2SizesForAspect,
} from '../utils/image2Model.ts';
import { image2MaxReferenceSlots, compactImage2PanelReferences } from '../utils/image2PanelRefs.ts';

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

ok('platform 满血版', AITOP_PLATFORM_IMAGE_2 === 'OPEN_AI_GPT_IMAGE_2_QUALITY');
ok('API 最多 4 张', IMAGE2_MAX_API_IMAGES === 4);
ok('支持 10 种比例', IMAGE2_ASPECT_OPTIONS.length === 10);
ok('1K 1:1 → 1024x1024', IMAGE2_ASPECT_TO_SIZE['1:1'] === '1024x1024');
ok('1K 16:9 → 1536x864', IMAGE2_ASPECT_TO_SIZE['16:9'] === '1536x864');
ok('2K 1:1 → 2048x2048', IMAGE2_QUALITY_ASPECT_TO_SIZE['2K']['1:1'] === '2048x2048');
ok('4K 16:9 → 3840x2160', IMAGE2_QUALITY_ASPECT_TO_SIZE['4K']['16:9'] === '3840x2160');
ok(
  '1K 1:1 尺寸选项含 canonical 与 auto',
  image2SizesForAspect('1:1', '1K').join(',') === '1024x1024,auto'
);
ok(
  '2K 16:9 尺寸选项',
  image2SizesForAspect('16:9', '2K').join(',') === '2048x1152,auto'
);
ok('9:16 canonical 864x1536', image2SizesForAspect('9:16', '1K')[0] === '864x1536');
ok('4:3 为合法比例', image2NormalizeAspectRatio('4:3') === '4:3');
ok('未知比例回退 1:1', image2NormalizeAspectRatio('7:5') === '1:1');
ok('quality 默认 1K', image2NormalizeQuality(undefined) === '1K');
ok('qualityLevel 默认 medium', image2NormalizeQualityLevel(undefined) === 'medium');
ok('2048x2048 推断 2K', image2InferQualityFromSize('2048x2048') === '2K');
ok('2880x2880 推断 4K', image2InferQualityFromSize('2880x2880') === '4K');
ok(
  'legacy 3840x2160 迁移后推断 1K',
  image2MigrateLegacyImageSize('3840x2160') === '1536x864' &&
    image2InferQualityFromSize('3840x2160') === '1K'
);
ok(
  '缺 quality 时从 size 推断',
  image2ResolveQuality(undefined, '2048x1152') === '2K'
);
ok(
  '切换 2K 16:9 纠正 1K 尺寸',
  image2CoerceSizeForAspect('16:9', '1536x864', '2K') === '2048x1152'
);
ok(
  '切换 16:9 纠正非法 1024x1024（1K）',
  image2CoerceSizeForAspect('16:9', '1024x1024', '1K') === '1536x864'
);
ok('auto 尺寸无隐含比例', image2AspectForSize('auto') === null);
ok('1536x864 反推 16:9', image2AspectForSize('1536x864', '1K') === '16:9');
ok('2048x1152 反推 16:9（2K）', image2AspectForSize('2048x1152', '2K') === '16:9');
ok('canonicalSizeForAspect 5:4 2K', image2CanonicalSizeForAspect('5:4', '2K') === '1920x1536');

ok(
  '有主图时 3 参考槽',
  image2MaxReferenceSlots({ imagePreview: 'https://a.png', panelMainSlotVisible: true }) === 3
);
ok(
  '无主图时 4 参考槽',
  image2MaxReferenceSlots({ imagePreview: '', panelMainSlotVisible: undefined }) === 4
);

console.log('\n=== compactImage2PanelReferences：同主图 URL 参考槽压紧（与 image2-panel-refs-test 一致）===\n');
{
  const mainUrl = 'https://cos.example.com/woods.png';
  const compacted = compactImage2PanelReferences({
    imagePreview: mainUrl,
    panelMainSlotVisible: true,
    referenceImages: [mainUrl, 'https://cos.example.com/lion.png'],
    referenceImageLabels: ['图片1', '图片2'],
  });
  ok(
    '同主图 URL 的图片1 压紧后移除（仅留 lion）',
    compacted.referenceImages.length === 1 &&
      compacted.referenceImages[0] === 'https://cos.example.com/lion.png',
    JSON.stringify(compacted.referenceImages)
  );
  ok(
    '标签跟随移除首槽',
    compacted.referenceImageLabels.length === 1 &&
      compacted.referenceImageLabels[0] === '图片2',
    JSON.stringify(compacted.referenceImageLabels)
  );
}
{
  const compacted = compactImage2PanelReferences({
    imagePreview: 'https://cos.example.com/main.png',
    panelMainSlotVisible: true,
    referenceImages: [],
    referenceImageLabels: [],
  });
  ok('空参考槽保持空', compacted.referenceImages.length === 0);
}

console.log(`\n通过 ${pass}，失败 ${fail}`);
if (fail > 0) process.exit(1);
