/**
 * 2026-07-16 全面复现：从用户提供的「刷新前 / 刷新后」两份 JSON 走完整 prepareNodesAfterWorkspaceLoad → hydrateGraphMediaFromPersisted → Node Details 流程
 * 目标：定位"刷新后缩略图变成美女"和"用户当前说生成图片连缩略图都没"两个问题的根因。
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { prepareNodesAfterWorkspaceLoad } from '../utils/runRecovery';
import {
  hydrateGraphMediaFromPersisted,
  hydrateNodeImagePreviewFromPersisted,
} from '../utils/hydratePersistedNodePreviews';
import {
  buildSeedanceReferenceDetailsFromSnapshot,
  resolveNodeSelectionPreviewUrl,
  resolveNodeDetailsHeroImageUrl,
} from '../utils/nodeDetailsPreview';
import { NodeType } from '../types';
import type { NodeData } from '../types';
import { isPersistableMediaUrl } from '../utils/workspaceMediaPersist';
import { buildPanelImagePreviewPatchAfterRun } from '../utils/referencedMediaRun';
import {
  collectReferencedMediaFromPrompt,
  buildPromptMediaRefContextFromNode,
} from '../utils/promptMediaRefs';

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

const FIX = (n: string) =>
  path.join(__dirname, 'fixtures', n);

const BEFORE = FIX('refresh-before-user-20260716.json');
const AFTER = FIX('refresh-after-user-20260716.json');

function loadProcessNode(file: string): { id: string; type: string; data: NodeData } | undefined {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { nodes: any[] };
  return raw.nodes.find((n) => n.id?.startsWith('node_0_'));
}

console.log('\n=== 1. 刷新前 fixture：processNode 初始状态 ===\n');
const beforeNode = loadProcessNode(BEFORE);
if (beforeNode) {
  const d = beforeNode.data;
  console.log('  imagePreview =', shorten(d.imagePreview));
  console.log('  imageName =', d.imageName);
  console.log('  panelMainImageUrl =', shorten(d.panelMainImageUrl));
  console.log('  panelMainSlotVisible =', d.panelMainSlotVisible);
  console.log('  status =', d.status);
  console.log('  referenceImages =', (d.referenceImages || []).map((u) => shorten(u, 50)));
  console.log('  referenceImageLabels =', d.referenceImageLabels);
  console.log('  gp.referenceImages =', (d.generationParams?.referenceImages || []).map((u) => shorten(u, 50)));
  console.log('  gp.referenceImageLabels =', d.generationParams?.referenceImageLabels);
  ok('imagePreview 存在', Boolean(d.imagePreview));
  ok('panelMainImageUrl 存在', Boolean(d.panelMainImageUrl));
  ok('panelMainSlotVisible=false', d.panelMainSlotVisible === false);
  ok('status=completed', d.status === 'completed');
}

console.log('\n=== 2. 刷新后 fixture：processNode 当前状态 ===\n');
const afterNode = loadProcessNode(AFTER);
if (afterNode) {
  const d = afterNode.data;
  console.log('  imagePreview =', shorten(d.imagePreview));
  console.log('  imageName =', d.imageName);
  console.log('  panelMainImageUrl =', shorten(d.panelMainImageUrl));
  console.log('  panelMainSlotVisible =', d.panelMainSlotVisible);
  console.log('  status =', d.status);
  console.log('  referenceImages =', (d.referenceImages || []).map((u) => shorten(u, 50)));
  console.log('  referenceImageLabels =', d.referenceImageLabels);
  console.log('  gp.referenceImages =', (d.generationParams?.referenceImages || []).map((u) => shorten(u, 50)));
  console.log('  gp.referenceImageLabels =', d.generationParams?.referenceImageLabels);
  ok('imagePreview 存在', Boolean(d.imagePreview));
  ok('panelMainImageUrl 存在', Boolean(d.panelMainImageUrl));
  ok('panelMainSlotVisible=false', d.panelMainSlotVisible === false);
  ok('status=completed', d.status === 'completed');
}

console.log('\n=== 3. 跑完整刷新管线（用 刷新前 fixture） ===\n');
if (beforeNode) {
  const raw = JSON.parse(fs.readFileSync(BEFORE, 'utf8')) as { nodes: any[]; edges: any[] };
  const prepared = prepareNodesAfterWorkspaceLoad(raw.nodes, raw.edges);
    const proc = prepared.nodes.find((n) => n.id?.startsWith('node_0_'));
    if (proc) {
    const d = proc.data as Partial<NodeData>;
    console.log('  after prepare: imagePreview =', shorten(d.imagePreview));
    console.log('  after prepare: panelMainImageUrl =', shorten(d.panelMainImageUrl));
    console.log('  after prepare: panelMainSlotVisible =', d.panelMainSlotVisible);
    console.log('  after prepare: gp.referenceImages =', (d.generationParams?.referenceImages || []).map((u) => shorten(u, 50)));
    console.log('  after prepare: gp.referenceImageLabels =', d.generationParams?.referenceImageLabels);
    console.log('  after prepare: referenceImages (panel) =', (d.referenceImages || []).map((u) => shorten(u, 50)));
    console.log('  after prepare: referenceImageLabels (panel) =', d.referenceImageLabels);
    ok('prepare 不改写 imagePreview 为空', Boolean(String(d.imagePreview || '').trim()),
       `imagePreview=${shorten(d.imagePreview)}`);

    // 跑 hydrate
    const hydrated = hydrateGraphMediaFromPersisted(prepared.nodes, raw.edges);
    const hProc = hydrated.find((n) => n.id?.startsWith('node_0_'));
    if (hProc) {
      const hd = hProc.data as Partial<NodeData>;
      console.log('\n  after hydrate: imagePreview =', shorten(hd.imagePreview));
      console.log('  after hydrate: panelMainImageUrl =', shorten(hd.panelMainImageUrl));
      console.log('  after hydrate: panelMainSlotVisible =', hd.panelMainSlotVisible);
      ok('hydrate 后 imagePreview 仍存在', Boolean(String(hd.imagePreview || '').trim()),
         `imagePreview=${shorten(hd.imagePreview)}`);
      ok('hydrate 不变成美女（62803dee）', !String(hd.imagePreview || '').includes('62803dee'),
         `imagePreview=${shorten(hd.imagePreview)}`);
    }

    // Node Details
    const enriched = { ...d, generationParams: d.generationParams } as Partial<NodeData>;
    const details = buildSeedanceReferenceDetailsFromSnapshot({
      snapshotRefs: (d.generationParams?.referenceImages as string[]) || [],
      snapshotLabels: d.generationParams?.referenceImageLabels as string[] | undefined,
      projectAssets: undefined,
      prompt: d.prompt,
    });
    console.log('\n  Node Details:');
    console.log('  items =', details.referenceImageDetailItems.map((it) => ({ label: it.label, url: shorten(it.url, 50) })));
    ok('Node Details 数量 ≥ 2', details.referenceImageDetailItems.length >= 2,
       `length=${details.referenceImageDetailItems.length}`);
    const stone = details.referenceImageDetailItems.find((it) => it.label === '石头');
    ok('Node Details 含"石头"', Boolean(stone));
    ok('"石头"对应 795c8b66', Boolean(stone?.url?.includes('795c8b66')), `url=${shorten(stone?.url, 60)}`);
    const pic1 = details.referenceImageDetailItems.find((it) => it.label === '图片1');
    ok('Node Details 含"图片1"', Boolean(pic1));
    ok('"图片1"对应 9d65585c', Boolean(pic1?.url?.includes('9d65585c')), `url=${shorten(pic1?.url, 60)}`);
  }
}

console.log('\n=== 4. 用户当前问题：生成图片后连缩略图都没 ===\n');
{
  // 模拟场景：刚刚运行完，imagePreview 应该被设为 gp.firstRef（石头）
  // 但用户说"连缩略图都没了"，意思是 imagePreview 变空
  // 走完整流程看 imagePreview 是否被清空
  const raw = JSON.parse(fs.readFileSync(BEFORE, 'utf8')) as { nodes: any[]; edges: any[] };
  // 模拟"用户开始一次新的运行"：先清空 imagePreview 模拟运行时
  // 不动 generationParams，让它有正确的 gp
  // 然后运行 prepareNodesAfterWorkspaceLoad → hydrate 看结果
  const prepared = prepareNodesAfterWorkspaceLoad(raw.nodes, raw.edges);
  const hydrated = hydrateGraphMediaFromPersisted(prepared.nodes, raw.edges);
  const proc = hydrated.find((n) => n.id?.startsWith('node_0_'));
  if (proc) {
    const d = proc.data as Partial<NodeData>;
    console.log('  hydrated imagePreview =', shorten(d.imagePreview));
    ok('用户视角：刷新后画布缩略图应存在', Boolean(String(d.imagePreview || '').trim()),
       `imagePreview=${shorten(d.imagePreview)}`);
  }
}

console.log('\n=== 5. 模拟 buildPanelImagePreviewPatchAfterRun（关键：画布 imagePreview 来源）===\n');
{
  // 重新调一次，看 runCaptureForGp.imagePreview 怎么算
  // projectAssets 包含"石头"，否则 @资产:石头 无法解析
  const projectAssets = [{ name: '石头', slug: 'stone', url: 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/795c8b66-6e21-4f77-a6a2-27b13dac7c81.png' }];
  const raw = JSON.parse(fs.readFileSync(BEFORE, 'utf8')) as { nodes: any[] };
  const proc = raw.nodes.find((n) => n.id?.startsWith('node_0_'));
  if (proc) {
    const d = proc.data as any;
    const ctx = buildPromptMediaRefContextFromNode(d);
    const plan = collectReferencedMediaFromPrompt(d.prompt, d, ctx, new Map(), projectAssets);
    console.log('  plan.images =', plan.images.map((it: any) => ({ token: it.token, label: it.label, url: shorten(it.url, 50) })));
    // 假设 uploadedByToken 包含 token -> URL 映射（直接用 plan 里的 url 模拟）
    const uploadedByToken = new Map<string, string>();
    for (const it of plan.images) uploadedByToken.set(it.token, it.url);
    const patch = buildPanelImagePreviewPatchAfterRun(plan.images, uploadedByToken, {
      nodeData: d,
      mergedPanelRefs: d.referenceImages,
      mergedPanelLabels: d.referenceImageLabels,
      projectAssets,
    });
    console.log('  buildPanelImagePreviewPatchAfterRun ->', patch);
    ok('imagePreview patch = 石头 (795c8b66)', String(patch.imagePreview || '').includes('795c8b66'),
       `imagePreview=${shorten(patch.imagePreview, 60)}`);
  }
}

console.log('\n=== 汇总: ' + pass + ' 通过, ' + fail + ' 失败 ===\n');
process.exit(fail > 0 ? 1 : 0);
