/**
 * §11.90r movNode/OUTPUT 拖入图片覆盖主视频 修复验证
 *
 * 根因（NodeInspector.tsx handleSeedanceReferenceFiles）：
 *   movNode 运行完成后 imagePreview = 主视频 URL（.mp4），
 *   拖入图片时 resolvePanelMainSlotPreviewUrl(d0) 会排除视频 URL 返回 undefined，
 *   导致 needsMain = true，进入「首张做主图」分支，imagePreview 被图片覆盖 → 主视频消失。
 *
 * 修复：在 needsMain 判定前增加 hasMainVideo = isLikelyMainVideoUrl(d0.imagePreview)，
 *   当 hasMainVideo === true 时 needsMain = false，拖入图片全部走参考图分支。
 *
 * npx tsx scripts/mov-node-drag-image-no-clobber-video-test.ts
 */
import type { NodeData } from '../types.ts';
import { isLikelyMainVideoUrl } from '../utils/promptMediaRefs.ts';
import { resolvePanelMainSlotPreviewUrl } from '../utils/referencedMediaRun.ts';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  [OK] ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const MP4_URL = 'https://cos.example.com/videosGenerations/cd568013-fccb-4e57-9863-ffe1f6ebc665.mp4';
const MOV_URL = 'https://cos.example.com/result.mov';
const WEBM_URL = 'blob:http://localhost:3001/preview-video.webm';
const IMAGE_URL = 'https://cos.example.com/existing-image.png';
const BLOB_IMAGE = 'blob:http://localhost:3001/user-dragged-image';

console.log('=== §11.90r movNode/OUTPUT 拖入图片覆盖主视频 修复验证 ===\n');

/**
 * 模拟修复后的 needsMain 判定逻辑（提取自 NodeInspector.tsx handleSeedanceReferenceFiles）
 */
function simulateNeedsMain(d0: Partial<NodeData>): boolean {
  const main = resolvePanelMainSlotPreviewUrl(d0);
  // §11.90r 修复：已有主视频时不视为需要主图
  const hasMainVideo = isLikelyMainVideoUrl(d0.imagePreview);
  return !hasMainVideo && (!main || isLikelyMainVideoUrl(main));
}

// ───────────────────────────────────────────────────────────────────
// 场景1：movNode 运行后 imagePreview = .mp4 → 拖入图片不覆盖主视频
// ───────────────────────────────────────────────────────────────────
console.log('场景1：movNode imagePreview=.mp4 → needsMain=false（不覆盖主视频）');
{
  const d0: Partial<NodeData> = {
    imagePreview: MP4_URL,
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
  };
  const needsMain = simulateNeedsMain(d0);
  ok(
    'needsMain = false（主视频不视为需要主图）',
    needsMain === false,
    `actual=${needsMain}`
  );
  ok(
    'isLikelyMainVideoUrl(.mp4) = true',
    isLikelyMainVideoUrl(MP4_URL) === true
  );
  ok(
    'resolvePanelMainSlotPreviewUrl 返回 undefined（视频被排除）',
    resolvePanelMainSlotPreviewUrl(d0) === undefined
  );
}
console.log();

// ───────────────────────────────────────────────────────────────────
// 场景2：movNode imagePreview=.mov → 同样不覆盖
// ───────────────────────────────────────────────────────────────────
console.log('场景2：movNode imagePreview=.mov → needsMain=false');
{
  const d0: Partial<NodeData> = {
    imagePreview: MOV_URL,
    selectedModel: 'seedance2.0 (高质量版)',
    seedanceGenerationMode: 'reference',
  };
  const needsMain = simulateNeedsMain(d0);
  ok(
    'needsMain = false',
    needsMain === false,
    `actual=${needsMain}`
  );
  ok(
    'isLikelyMainVideoUrl(.mov) = true',
    isLikelyMainVideoUrl(MOV_URL) === true
  );
}
console.log();

// ───────────────────────────────────────────────────────────────────
// 场景3：movNode imagePreview=blob:.webm → 同样不覆盖
// ───────────────────────────────────────────────────────────────────
console.log('场景3：movNode imagePreview=blob:.webm → needsMain=false');
{
  const d0: Partial<NodeData> = {
    imagePreview: WEBM_URL,
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
  };
  const needsMain = simulateNeedsMain(d0);
  ok(
    'needsMain = false',
    needsMain === false,
    `actual=${needsMain}`
  );
  ok(
    'isLikelyMainVideoUrl(blob:.webm) = true',
    isLikelyMainVideoUrl(WEBM_URL) === true
  );
}
console.log();

// ───────────────────────────────────────────────────────────────────
// 场景4：imagePreview 是图片 URL → needsMain=false（已有主图）
// ───────────────────────────────────────────────────────────────────
console.log('场景4：imagePreview 是图片 URL → needsMain=false（已有主图）');
{
  const d0: Partial<NodeData> = {
    imagePreview: IMAGE_URL,
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
  };
  const needsMain = simulateNeedsMain(d0);
  ok(
    'needsMain = false（已有图片主图）',
    needsMain === false,
    `actual=${needsMain}`
  );
  ok(
    'isLikelyMainVideoUrl(.png) = false',
    isLikelyMainVideoUrl(IMAGE_URL) === false
  );
}
console.log();

// ───────────────────────────────────────────────────────────────────
// 场景5：imagePreview 为空 → needsMain=true（需要主图）
// ───────────────────────────────────────────────────────────────────
console.log('场景5：imagePreview 为空 → needsMain=true（需要主图）');
{
  const d0: Partial<NodeData> = {
    imagePreview: undefined,
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
  };
  const needsMain = simulateNeedsMain(d0);
  ok(
    'needsMain = true（无主图，需要首张做主图）',
    needsMain === true,
    `actual=${needsMain}`
  );
}
console.log();

// ───────────────────────────────────────────────────────────────────
// 场景6：imagePreview 是 data:video → 同样不覆盖
// ───────────────────────────────────────────────────────────────────
console.log('场景6：imagePreview=data:video → needsMain=false');
{
  const d0: Partial<NodeData> = {
    imagePreview: 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28y',
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
  };
  const needsMain = simulateNeedsMain(d0);
  ok(
    'needsMain = false',
    needsMain === false,
    `actual=${needsMain}`
  );
}
console.log();

// ───────────────────────────────────────────────────────────────────
// 场景7：对照组 — 修复前逻辑（无 hasMainVideo 判断）
//   修复前：needsMain = !main || isLikelyMainVideoUrl(main)
//   当 main=undefined（视频被排除）→ needsMain=true → 覆盖主视频
// ───────────────────────────────────────────────────────────────────
console.log('场景7：对照组 — 修复前逻辑（会覆盖主视频）');
{
  const d0: Partial<NodeData> = {
    imagePreview: MP4_URL,
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
  };
  // 修复前逻辑
  const mainBefore = resolvePanelMainSlotPreviewUrl(d0); // undefined（视频被排除）
  const needsMainBefore = !mainBefore || isLikelyMainVideoUrl(mainBefore); // true（bug）
  // 修复后逻辑
  const needsMainAfter = simulateNeedsMain(d0); // false
  ok(
    '[对照] 修复前 needsMain = true（bug：会覆盖主视频）',
    needsMainBefore === true,
    `actual=${needsMainBefore}`
  );
  ok(
    '[对照] 修复后 needsMain = false（正确：保留主视频）',
    needsMainAfter === false,
    `actual=${needsMainAfter}`
  );
  ok(
    '[对照] 修复前 main=undefined（resolvePanelMainSlotPreviewUrl 排除视频）',
    mainBefore === undefined,
    '视频 URL 被 resolvePanelMainSlotPreviewUrl 排除'
  );
}
console.log();

// ───────────────────────────────────────────────────────────────────
// 场景8：使用真实节点数据（丢主图.json 场景）验证
// ───────────────────────────────────────────────────────────────────
console.log('场景8：真实节点数据（丢主图.json）验证');
{
  // 从 E:\问题\0810\seedance2.0.json 提取的关键字段
  const d0: Partial<NodeData> = {
    imagePreview: 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/videosGenerations/videosGenerations/cd568013-fccb-4e57-9863-ffe1f6ebc665.mp4',
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
    referenceMovs: [
      { url: 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/videosGenerations/videosGenerations/cd568013-fccb-4e57-9863-ffe1f6ebc665.mp4' }
    ],
    imageLocalRef: 'flowgen-local:uid_pid:node_5:main',
  };
  const needsMain = simulateNeedsMain(d0);
  ok(
    '真实场景 needsMain = false（主视频不被覆盖）',
    needsMain === false,
    `actual=${needsMain}`
  );
  ok(
    'imagePreview 是视频 URL',
    isLikelyMainVideoUrl(d0.imagePreview) === true
  );
}

console.log(`\n=== 汇总：${pass} 通过, ${fail} 失败 ===`);
if (fail > 0) {
  process.exit(1);
}
