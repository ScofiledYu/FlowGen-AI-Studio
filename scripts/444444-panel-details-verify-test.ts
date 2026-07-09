/**
 * 444444.json：seedance 参考生 @主图+@图片3 — 加载后面板与 Node Details 三态一致。
 * npx tsx scripts/444444-panel-details-verify-test.ts
 */
import fs from 'node:fs';
import type { Node as RFNode } from 'reactflow';
import { NodeType, type NodeData } from '../types.ts';
import {
  buildPanelReferenceDisplayEntries,
  dedupePanelReferenceDisplayEntries,
  filterPanelReferenceDisplayEntriesExcludingMainPreview,
  panelRefDisplayDedupeKey,
  resolvePanelReferenceSlotDisplayUrl,
} from '../utils/referenceImageSlotLabels.ts';
import {
  shouldShowPanelMainImageSlot,
  shouldDedupePanelRefsAgainstMainPreview,
  pickSeedanceReferencePanelSnapshot,
} from '../utils/referencedMediaRun.ts';
import { buildSeedanceReferenceDetailsFromSnapshot } from '../utils/nodeDetailsPreview.ts';
import { prepareNodesAfterWorkspaceLoad } from '../utils/runRecovery.ts';
import { isLikelyMainVideoUrl } from '../utils/promptMediaRefs.ts';

const FIXTURE_PATHS = ['scripts/fixtures/444444.json', 'd:/444444.json'];

function loadFixture(): { nodes: RFNode[]; edges: { id: string; source: string; target: string }[] } {
  for (const p of FIXTURE_PATHS) {
    try {
      const raw = fs.readFileSync(p, 'utf8');
      return JSON.parse(raw) as { nodes: RFNode[]; edges: { id: string; source: string; target: string }[] };
    } catch {
      /* try next */
    }
  }
  throw new Error(`fixture not found: ${FIXTURE_PATHS.join(' | ')}`);
}

let pass = 0;
let fail = 0;
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function norm(u: string): string {
  return String(u || '').trim().split('?')[0].split('#')[0];
}

function buildSeedancePanelDisplayEntries(data: NodeData) {
  const seedanceRefs = data.referenceImages || [];
  const base = buildPanelReferenceDisplayEntries(seedanceRefs, {
    imagePreview: data.imagePreview,
    dedupeAgainstMain: shouldDedupePanelRefsAgainstMainPreview(data),
    referenceImageLabels: data.referenceImageLabels,
  });
  let entries = dedupePanelReferenceDisplayEntries(base, data.referenceImageLabels);
  if (shouldShowPanelMainImageSlot(data)) {
    entries = filterPanelReferenceDisplayEntriesExcludingMainPreview(
      entries,
      data.imagePreview,
      data.imageName,
      data.referenceImageLabels
    );
  }
  const p = data.imagePreview?.trim();
  const showMainInRefGrid =
    !!p &&
    !isLikelyMainVideoUrl(p) &&
    shouldShowPanelMainImageSlot(data) &&
    !entries.some(({ url }, i) => {
      const cap = data.referenceImageLabels?.[i];
      const k = panelRefDisplayDedupeKey(
        resolvePanelReferenceSlotDisplayUrl(url, cap),
        cap
      );
      const mainKey = panelRefDisplayDedupeKey(p, data.imageName);
      return mainKey && k === mainKey;
    });
  return { entries, showMainInRefGrid };
}

function panelLabels(data: NodeData): string[] {
  const { entries, showMainInRefGrid } = buildSeedancePanelDisplayEntries(data);
  const labels: string[] = [];
  if (showMainInRefGrid) labels.push('主图');
  for (const e of entries) {
    labels.push(data.referenceImageLabels?.[e.slotIndex]?.trim() || `slot${e.slotIndex}`);
  }
  return labels;
}

function panelUrls(data: NodeData): string[] {
  const { entries, showMainInRefGrid } = buildSeedancePanelDisplayEntries(data);
  const urls: string[] = [];
  if (showMainInRefGrid && data.imagePreview) urls.push(data.imagePreview);
  for (const e of entries) urls.push(e.url);
  return urls.map(norm);
}

function detailsFromGp(data: NodeData) {
  const gp = data.generationParams || {};
  return buildSeedanceReferenceDetailsFromSnapshot({
    snapshotRefs: (gp.referenceImages as string[]) || [],
    snapshotLabels: gp.referenceImageLabels as string[] | undefined,
    prompt: String(gp.prompt || data.prompt || ''),
  });
}

console.log('\n=== 444444 · 加载修复 + 面板 vs Node Details ===\n');

const fixture = loadFixture();
const runNodeId = 'node_7_1783046657731';
const movIds = ['node_0_1783049566099', 'node_1_1783049566099'];

const beforeRun = fixture.nodes.find((n) => n.id === runNodeId);
ok('fixture 含 node_7', !!beforeRun);

const staleGp = beforeRun!.data.generationParams?.referenceImages as string[] | undefined;
ok(
  'fixture 初始 gp 为 stale image2 URL',
  staleGp?.some((u) => u.includes('bdb52377')) === true
);

const { nodes: loaded, changed } = prepareNodesAfterWorkspaceLoad(fixture.nodes, fixture.edges);
ok('prepareNodesAfterWorkspaceLoad 触发修复', changed);

const runNode = loaded.find((n) => n.id === runNodeId)!;
const panelSnap = pickSeedanceReferencePanelSnapshot(runNode.data);
const gp = runNode.data.generationParams!;

ok('面板 referenceImages 2 张', panelSnap.referenceImages.length === 2);
ok(
  '加载后 gp.referenceImages 与面板一致',
  panelSnap.referenceImages.every(
    (u, i) => norm(u) === norm((gp.referenceImages || [])[i] || '')
  ),
  `panel=${panelSnap.referenceImages.map((u) => u.slice(-12)).join(',')} gp=${(gp.referenceImages || []).map((u) => String(u).slice(-12)).join(',')}`
);
ok(
  'gp 标签=[主图,图片3]',
  gp.referenceImageLabels?.[0] === '主图' && gp.referenceImageLabels?.[1] === '图片3',
  JSON.stringify(gp.referenceImageLabels)
);
ok('gp 不再含 image2 狐狸 URL', !gp.referenceImages?.some((u) => String(u).includes('bdb52377')));

  ok(
    '加载后 panelMainSlotVisible=false（无重复主图格）',
    runNode.data.panelMainSlotVisible === false
  );
  ok(
    'panelMainSlotVisible 未持久化时也不展示独立主图格',
    !shouldShowPanelMainImageSlot({ ...runNode.data, panelMainSlotVisible: undefined })
  );
  const panelLbls = panelLabels(runNode.data);
const panelRefUrls = panelUrls(runNode.data);
const details = detailsFromGp(runNode.data);

ok(
  '面板无重复主图格（合计 2 张：主图+图片3）',
  panelRefUrls.length === 2 && panelLbls.filter((l) => l === '主图').length === 1,
  `urls=${panelRefUrls.length} labels=${panelLbls.join('+')}`
);
ok(
  'Node Details 2 张参考图',
  details.referenceImageDetailItems.length === 2,
  `count=${details.referenceImageDetailItems.length}`
);
ok(
  'Details 标签=主图+图片3',
  details.referenceImageDetailItems[0]?.label === '主图' &&
    details.referenceImageDetailItems[1]?.label === '图片3',
  details.referenceImageDetailItems.map((i) => i.label).join(',')
);

for (let i = 0; i < 2; i++) {
  const dUrl = norm(details.referenceImageDetailItems[i]?.url || '');
  const pUrl = norm(panelSnap.referenceImages[i] || '');
  ok(`Details[${i}] URL 与面板/API 一致`, dUrl === pUrl, `${dUrl.slice(-24)} vs ${pUrl.slice(-24)}`);
}

for (const movId of movIds) {
  const mov = loaded.find((n) => n.id === movId)!;
  const movGp = mov.data.generationParams!;
  ok(
    `MOV ${movId.slice(-4)} gp 与面板一致`,
    movGp.referenceImages?.length === 2 &&
      norm(movGp.referenceImages![0]) === norm(panelSnap.referenceImages[0]) &&
      norm(movGp.referenceImages![1]) === norm(panelSnap.referenceImages[1])
  );
  const movDetails = detailsFromGp(mov.data);
  ok(
    `MOV ${movId.slice(-4)} Details 标签正确`,
    movDetails.referenceImageDetailItems[0]?.label === '主图' &&
      movDetails.referenceImageDetailItems[1]?.label === '图片3'
  );
}

const thumb = runNode.data.generatedThumbnails?.[0];
if (thumb?.generationParams) {
  ok(
    'generatedThumbnails[0] gp 已修复',
    !String(thumb.generationParams.referenceImages?.[0] || '').includes('bdb52377')
  );
}

console.log(`\n--- 444444 verify: ${pass} passed, ${fail} failed ---\n`);
if (fail > 0) process.exit(1);
