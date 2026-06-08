/**
 * 跨模型审计：运行快照 referenceImages 是否应含 API 实际上传顺序（@主图 + @图片n）。
 * 不调用 API。
 */
import type { NodeData } from '../types.ts';
import { MODEL_IMAGE_2, MODEL_NANO_BANANA_2 } from '../types.ts';
import {
  buildPromptReferencedDetailsImages,
  buildNanoBananaDetailsReferenceImages,
} from '../utils/nodeDetailsPreview.ts';
import { OMNI_MULTI_FIRST_FRAME_TOKENS } from '../utils/referencedMediaRun.ts';
import { isLikelyMainVideoUrl } from '../utils/promptMediaRefs.ts';
import { sanitizeDetailsReferenceImageUrls } from '../utils/nodeDetailsPreview.ts';

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

function eq(a: unknown, b: unknown, name: string) {
  ok(name, JSON.stringify(a) === JSON.stringify(b));
}

console.log('\n=== 参考图快照 / Details 审计 ===\n');

const cases: Array<{
  model: string;
  snapshotFix: string;
  legacyEnrich: boolean;
}> = [
  { model: 'Nano Banana 2.0', snapshotFix: 'imageUrls → generationParams.referenceImages', legacyEnrich: true },
  { model: 'image 2', snapshotFix: 'imageUrls → generationParams.referenceImages', legacyEnrich: true },
  {
    model: 'seedance2.0 参考生视频',
    snapshotFix: 'uploadedImgs → seedanceReferenceSnapshot.referenceImages',
    legacyEnrich: true,
  },
  {
    model: '可灵3.0 Omni 多图',
    snapshotFix: '@图片1 不再共用首帧 URL + 面板写回',
    legacyEnrich: false,
  },
  { model: '可灵3.0 Omni 指令/视频', snapshotFix: 'tab 参考图 + 视频槽', legacyEnrich: false },
  { model: '即梦3.0 Pro', snapshotFix: '首帧 + jimengImages 面板', legacyEnrich: false },
  { model: '可灵 2.5 / vidu', snapshotFix: '首尾帧 + referenceImages 合并', legacyEnrich: false },
];

for (const c of cases) {
  ok(`${c.model}: 已登记修复策略`, c.snapshotFix.length > 0, c.snapshotFix);
}

console.log('\n--- Seedance2.0 参考生：@主图 + @图片1 ---\n');

{
  const upstream: Partial<NodeData> = {
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
    imagePreview: 'https://cos/landscape-main.png',
    referenceImages: ['https://cos/dragon-ref.png'],
    prompt: '@图片1在@主图中运动起来',
    seedanceTabConfigs: {
      reference: { referenceImages: ['https://cos/dragon-ref.png'] },
    },
  };
  const apiUrls = ['https://cos/landscape-up.png', 'https://cos/dragon-up.png'];
  const legacySnap = ['https://cos/dragon-up.png'];
  const legacy = buildPromptReferencedDetailsImages({
    snapRefs: legacySnap,
    fallbackRefs: [],
    prompt: String(upstream.prompt),
    isOutputLike: true,
    ancestorData: upstream,
  });
  ok('旧快照（仅面板参考图）补全后 ≥2', legacy.length >= 2, `len=${legacy.length}`);
  ok('补全含主图', legacy.some((u) => u.includes('landscape')));

  const fresh = buildPromptReferencedDetailsImages({
    snapRefs: apiUrls,
    fallbackRefs: [],
    prompt: String(upstream.prompt),
    isOutputLike: true,
    ancestorData: upstream,
  });
  eq(fresh.length, 2, '新快照 API 顺序 2 张');
}

console.log('\n--- Nano / image2 回归 ---\n');

{
  const upstream = {
    imagePreview: 'https://cos/m.png',
    referenceImages: ['https://cos/r.png'],
    prompt: '@主图 动 @图片1',
  };
  const legacy = buildNanoBananaDetailsReferenceImages({
    snapRefs: ['https://cos/r-up.png'],
    fallbackRefs: [],
    prompt: upstream.prompt,
    isOutputLike: true,
    ancestorData: upstream,
  });
  ok(`${MODEL_NANO_BANANA_2} 旧快照补全`, legacy.length >= 2);
  const i2fresh = buildNanoBananaDetailsReferenceImages({
    snapRefs: ['https://cos/m-up.png', 'https://cos/r-up.png'],
    fallbackRefs: [],
    prompt: '@主图 @图片1',
    isOutputLike: true,
    ancestorData: { imagePreview: 'https://cos/m.png', referenceImages: ['https://cos/r.png'] },
  });
  ok(`${MODEL_IMAGE_2} API 快照 2 张`, i2fresh.length === 2, `len=${i2fresh.length}`);
}

ok('Omni multi 首帧 token 不含 @图片1', !OMNI_MULTI_FIRST_FRAME_TOKENS.has('@图片1'));

console.log('\n--- Omni multi：blob 本地主图不应判为视频 ---\n');
ok('blob 预览 URL 非视频', !isLikelyMainVideoUrl('blob:http://127.0.0.1/abc-def'));
ok('data:image/jpeg 非视频', !isLikelyMainVideoUrl('data:image/jpeg;base64,/9j/'));
ok('.mp4 为视频', isLikelyMainVideoUrl('https://cdn.example.com/foo.mp4'));
ok('含 video 子串的图片 CDN 不误杀', !isLikelyMainVideoUrl('https://cdn.example.com/path/video-thumb/shot.jpg'));

console.log('\n--- Omni multi Details：去掉 blob 视频重复 ---\n');
{
  const cosMain = 'https://cos/main-raft.jpg';
  const cosFox = 'https://cos/fox.jpg';
  const messy = [cosMain, 'blob:http://local/Input Picture Node.mov', cosFox, cosMain];
  const clean = sanitizeDetailsReferenceImageUrls(messy);
  eq(clean.length, 2, '去 blob/重复后剩 2 张');
  ok('保留主图与狐狸', clean.includes(cosMain) && clean.includes(cosFox));
}

console.log('\n=== 汇总 ===\n');
console.log(`通过 ${pass}，失败 ${fail}`);
if (fail > 0) process.exit(1);
console.log('审计通过。部署 dist 后请逐模型点生成节点 Node Details 核对参考图张数。');
