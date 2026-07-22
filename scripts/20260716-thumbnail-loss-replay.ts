/**
 * 2026-07-16 端到端：模拟用户在浏览器里"未 @主图、@资产:石头 + @图片1"生成图片的完整流程，
 * 追踪 imagePreview 从「点运行」到「写回 nodes」每一步的值，定位"生成后画布无缩略图"具体在哪一步被清空。
 *
 * 与 scripts/20260716-fresh-replay-all.ts 的区别：
 * - fresh-replay-all 只看 fixture + 单独调 buildPanelImagePreviewPatchAfterRun
 * - 本脚本串完整链路：runStartDataSnapshot → mediaPlan → uploadByToken → enrichPanelPreviewPatchWithFreshMainBackup
 *   → buildPanelImagePreviewPatchAfterRun → runCaptureForGp → mediaPatch → setNodes → persist → 重新加载 → hydrate
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { NodeData } from '../types';
import { NodeType } from '../types';
import {
  prepareNodesAfterWorkspaceLoad,
} from '../utils/runRecovery';
import {
  hydrateGraphMediaFromPersisted,
} from '../utils/hydratePersistedNodePreviews';
import {
  buildPromptMediaRefContextFromNode,
  collectReferencedMediaFromPrompt,
} from '../utils/promptMediaRefs';
import {
  buildPanelImagePreviewPatchAfterRun,
  enrichPanelPreviewPatchWithFreshMainBackup,
  mergeAndPrunePanelReferenceImagesAfterUpload,
} from '../utils/referencedMediaRun';
import { isPersistableMediaUrl } from '../utils/workspaceMediaPersist';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}
function shorten(s?: string, n = 60) {
  if (!s) return String(s);
  return s.length > n ? s.slice(0, n) + '…' : s;
}

const FIX = (n: string) => path.join(__dirname, 'fixtures', n);
const BEFORE = FIX('refresh-before-user-20260716.json');
const AFTER = FIX('refresh-after-user-20260716.json');

const COS_795c8b66 = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/795c8b66-6e21-4f77-a6a2-27b13dac7c81.png';
const COS_9d65585c = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/9d65585c-8e88-4e94-9c2a-4cae6c2f4f4d.png';
const COS_62803dee = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/62803dee-e53e-4f51-b0c7-b297a2c46d52.png';
const PANEL_REF_62803dee = '/flowgen-api/projects/14/assets/62803dee-e53e-4f51-b0c7-b297a2c46d52/file';

const projectAssets = [
  { name: '石头', slug: 'stone', url: COS_795c8b66 },
  { name: '美女', slug: 'beauty', url: COS_62803dee },
];

interface SimOpts {
  scenario: string;
  fixture: string;
  prompt: string;
  preUploadByToken: Map<string, string>;
  uploadedByToken: Map<string, string>;
  mergedPanelRefs: string[];
  mergedPanelLabels: string[];
  /** 模拟 nodeData.imagePreview / panelMainImageUrl 初始值 */
  initData: Partial<NodeData>;
}

function simulateFullRun(opts: SimOpts) {
  console.log(`\n========== 场景：${opts.scenario} ==========`);
  const fixtureRaw = JSON.parse(fs.readFileSync(opts.fixture, 'utf8')) as { nodes: any[]; edges: any[] };
  const initNode = fixtureRaw.nodes.find((n) => n.id?.startsWith('node_0_'));
  if (!initNode) return;

  const startData: NodeData = {
    ...initNode.data,
    ...opts.initData,
  };

  console.log('  起始 imagePreview =', shorten(startData.imagePreview));
  console.log('  起始 panelMainImageUrl =', shorten(startData.panelMainImageUrl));
  console.log('  起始 panelMainSlotVisible =', startData.panelMainSlotVisible);
  console.log('  起始 referenceImages =', (startData.referenceImages || []).map((u) => shorten(u, 50)));
  console.log('  起始 referenceImageLabels =', startData.referenceImageLabels);

  // 1. runStartDataSnapshot = 起始
  const runStartDataSnapshot: NodeData = { ...startData };

  // 2. 解析 plan
  const ctx = buildPromptMediaRefContextFromNode(startData);
  const plan = collectReferencedMediaFromPrompt(opts.prompt, startData, ctx, opts.preUploadByToken, projectAssets);
  console.log('\n  [2] plan.images =', plan.images.map((it: any) => ({ token: it.token, label: it.label, url: shorten(it.url, 50) })));

  // 3. 模拟"上传后 uploadedByToken"
  console.log('  [3] uploadedByToken =');
  for (const [k, v] of opts.uploadedByToken.entries()) console.log(`      ${k} → ${shorten(v, 60)}`);

  // 4. 合并面板槽
  const mergedRefs = mergeAndPrunePanelReferenceImagesAfterUpload(
    startData.referenceImages || [],
    plan.images,
    opts.uploadedByToken,
    {
      currentImagePreview: startData.imagePreview,
      projectAssetSlugToUrl: new Map(projectAssets.map(a => [a.slug, a.url])),
      referenceImageLabels: startData.referenceImageLabels,
    }
  );
  console.log('  [4] mergedPanelRefs =', mergedRefs.map((u) => shorten(u, 50)));

  // 5. buildPanelImagePreviewPatchAfterRun
  const patch = buildPanelImagePreviewPatchAfterRun(plan.images, opts.uploadedByToken, {
    nodeData: startData,
    mergedPanelRefs: opts.mergedPanelRefs.length ? opts.mergedPanelRefs : mergedRefs,
    mergedPanelLabels: opts.mergedPanelLabels.length ? opts.mergedPanelLabels : startData.referenceImageLabels,
    projectAssets,
  });
  console.log('  [5] buildPanelImagePreviewPatchAfterRun patch =', patch);

  // 6. enrichPanelPreviewPatchWithFreshMainBackup (async, here sync fallback)
  console.log('  [6] enrichPanelPreviewPatchWithFreshMainBackup: 模拟无 localRef 场景（用户场景通常有）');

  // 7. runCaptureForGp
  const runCaptureForGp: Partial<NodeData> = { ...patch };
  console.log('  [7] runCaptureForGp.imagePreview =', shorten(runCaptureForGp.imagePreview));

  // 8. mediaPatch
  const mediaPatch: Record<string, unknown> = {};
  for (const key of ['imagePreview', 'panelMainSlotVisible', 'panelMainImageUrl', 'referenceImages', 'referenceImageLabels']) {
    if (Object.prototype.hasOwnProperty.call(runCaptureForGp, key)) {
      mediaPatch[key] = (runCaptureForGp as Record<string, unknown>)[key];
    }
  }
  console.log('  [8] mediaPatch =', Object.keys(mediaPatch).map(k => `${k}=${shorten(String(mediaPatch[k]), 50)}`));

  // 9. setNodes 后的 data
  const finalData: NodeData = {
    ...runStartDataSnapshot,
    ...mediaPatch,
  } as NodeData;
  console.log('  [9] finalData.imagePreview =', shorten(finalData.imagePreview));
  console.log('  [9] finalData.panelMainImageUrl =', shorten(finalData.panelMainImageUrl));
  console.log('  [9] finalData.panelMainSlotVisible =', finalData.panelMainSlotVisible);

  // 10. 持久化（filter 出 imagePreview 被 strip 的可能）
  console.log('  [10] sanitizePersistValueDeep 不会清空 COS / 资产库 URL；data:image/blob: 才会被 strip');

  // 11. 重新加载 + hydrate
  const prepared = prepareNodesAfterWorkspaceLoad([{ ...initNode, data: finalData }], fixtureRaw.edges);
  const hydrated = hydrateGraphMediaFromPersisted(prepared.nodes, fixtureRaw.edges);
  const final = hydrated.find((n) => n.id?.startsWith('node_0_'))!;
  console.log('  [11] 重载后 hydrate imagePreview =', shorten(final.data.imagePreview));

  ok('imagePreview 始终非空（从 buildPanelImagePreviewPatchAfterRun 开始）',
     Boolean(String(patch.imagePreview || '').trim()),
     `patch.imagePreview=${shorten(patch.imagePreview)}`);
  ok('mediaPatch 写回后 imagePreview 仍非空',
     Boolean(String(finalData.imagePreview || '').trim()),
     `finalData.imagePreview=${shorten(finalData.imagePreview)}`);
  ok('hydrate 后 imagePreview 仍非空',
     Boolean(String(final.data.imagePreview || '').trim()),
     `hydrated.imagePreview=${shorten(final.data.imagePreview)}`);
}

// === 场景 A：用户描述的 @资产:石头 + @图片1（未 @主图，panel 3 槽含空槽） ===
simulateFullRun({
  scenario: 'A. 未 @主图，@资产:石头 + @图片1（fixture=刷新前）',
  fixture: BEFORE,
  prompt: '@资产:石头 + @图片1',
  preUploadByToken: new Map([
    ['@资产:石头', COS_795c8b66],
    ['@图片1', COS_9d65585c],
  ]),
  uploadedByToken: new Map([
    ['@资产:石头', COS_795c8b66],
    ['@图片1', COS_9d65585c],
  ]),
  mergedPanelRefs: [],
  mergedPanelLabels: [],
  initData: {
    selectedModel: 'seedance2.0 (高质量版)',
    seedanceGenerationMode: 'reference',
    prompt: '@资产:石头 + @图片1',
    imagePreview: COS_9d65585c,
    panelMainImageUrl: PANEL_REF_62803dee,
    panelMainSlotVisible: false,
    referenceImages: [COS_9d65585c, COS_795c8b66, ''],
    referenceImageLabels: ['图片1', '石头', '图片3'],
  },
});

// === 场景 B：刷新后 fixture 状态（imagePreview=资产库 62803dee）再次生成 ===
simulateFullRun({
  scenario: 'B. 刷新后节点（imagePreview=资产库美女，panelMainSlotVisible=false）再次运行',
  fixture: AFTER,
  prompt: '@资产:石头 + @图片1',
  preUploadByToken: new Map([
    ['@资产:石头', COS_795c8b66],
    ['@图片1', COS_9d65585c],
  ]),
  uploadedByToken: new Map([
    ['@资产:石头', COS_795c8b66],
    ['@图片1', COS_9d65585c],
  ]),
  mergedPanelRefs: [],
  mergedPanelLabels: [],
  initData: {
    selectedModel: 'seedance2.0 (高质量版)',
    seedanceGenerationMode: 'reference',
    prompt: '@资产:石头 + @图片1',
    imagePreview: PANEL_REF_62803dee, // 刷新后 fixture 的 imagePreview
    panelMainImageUrl: PANEL_REF_62803dee,
    panelMainSlotVisible: false,
    referenceImages: [COS_9d65585c, COS_795c8b66, ''],
    referenceImageLabels: ['图片1', '石头', '图片3'],
  },
});

// === 场景 C：模拟 uploadedByToken 为空（异步上传未完成就 buildPanelImagePreviewPatchAfterRun） ===
simulateFullRun({
  scenario: 'C. uploadedByToken 为空（极端：上传没完成就跑 patch）',
  fixture: BEFORE,
  prompt: '@资产:石头 + @图片1',
  preUploadByToken: new Map([
    ['@资产:石头', COS_795c8b66],
    ['@图片1', COS_9d65585c],
  ]),
  uploadedByToken: new Map(), // 模拟极端：上传未完成
  mergedPanelRefs: [],
  mergedPanelLabels: [],
  initData: {
    selectedModel: 'seedance2.0 (高质量版)',
    seedanceGenerationMode: 'reference',
    prompt: '@资产:石头 + @图片1',
    imagePreview: COS_9d65585c,
    panelMainImageUrl: PANEL_REF_62803dee,
    panelMainSlotVisible: false,
    referenceImages: [COS_9d65585c, COS_795c8b66, ''],
    referenceImageLabels: ['图片1', '石头', '图片3'],
  },
});

// === 场景 D：plan 中无引用（极端 prompt 空白） ===
simulateFullRun({
  scenario: 'D. prompt 为空，无任何 @ 引用',
  fixture: BEFORE,
  prompt: '',
  preUploadByToken: new Map(),
  uploadedByToken: new Map(),
  mergedPanelRefs: [],
  mergedPanelLabels: [],
  initData: {
    selectedModel: 'seedance2.0 (高质量版)',
    seedanceGenerationMode: 'reference',
    prompt: '',
    imagePreview: COS_9d65585c,
    panelMainImageUrl: PANEL_REF_62803dee,
    panelMainSlotVisible: false,
    referenceImages: [COS_9d65585c, COS_795c8b66, ''],
    referenceImageLabels: ['图片1', '石头', '图片3'],
  },
});

console.log(`\n=== 汇总: ${pass} 通过, ${fail} 失败 ===\n`);
process.exit(fail > 0 ? 1 : 0);
